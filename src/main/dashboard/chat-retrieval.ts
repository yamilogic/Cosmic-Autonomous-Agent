import type { DashboardSource } from '../../shared/dashboard-contract'
import type { ConfigService } from './config-service'
import type { DashboardDeltaStore } from './delta-store'
import type { MonitorStore } from './monitor-store'

export interface ChatMessageCandidate {
  source: DashboardSource
  channelId: string
  channelName: string
  ts: string
  user?: string
  text: string
  permalink?: string
  atMs: number
}

export interface ChatRetrievalResult {
  /** Newest messages across both workspaces — always in context. */
  recent: ChatMessageCandidate[]
  /** Keyword matches ranked by BM25 + recency; excludes the recent window. */
  matches: ChatMessageCandidate[]
}

/** Swappable seam: embeddings can replace the body of retrieve() later. */
export interface ProjectChatRetriever {
  retrieve(projectId: string, query: string): Promise<ChatRetrievalResult>
}

export const RECENT_MESSAGE_COUNT = 30
export const MATCH_CHUNK_LIMIT = 12

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'are',
  'was',
  'were',
  'have',
  'has',
  'had',
  'you',
  'your',
  'a',
  'an',
  'is',
  'it',
  'to',
  'of',
  'in',
  'on',
  'at',
  'be',
  'i',
  'we',
  'they',
  'he',
  'she',
  'as',
  'by',
  'kya',
  'hai',
  'ka',
  'ki',
  'ke',
  'me',
  'mein',
  'ko',
  'se',
  'par',
  'aur',
  'ye',
  'yeh',
  'wo',
  'woh',
  'ho',
  'hua',
  'hain',
  'kuch',
  'kaise',
  'kitna',
  'kab',
  'kahan',
  'kaun',
  'nahi',
  'na',
  'bhi',
  'ab'
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
}

function keyOf(message: ChatMessageCandidate): string {
  return `${message.source}:${message.channelId}:${message.ts}`
}

function tsToMs(ts: string): number {
  const seconds = Number(ts)
  return Number.isFinite(seconds) ? seconds * 1000 : 0
}

/**
 * BM25 over message text, plus a small recency boost used only to order
 * messages that already matched at least one query token.
 */
export function rankMatches(
  candidates: ChatMessageCandidate[],
  query: string,
  exclude: ReadonlySet<string>,
  nowMs: number,
  limit = MATCH_CHUNK_LIMIT
): ChatMessageCandidate[] {
  const queryTokens = [...new Set(tokenize(query))]
  if (queryTokens.length === 0) return []

  const docs = candidates
    .filter((candidate) => !exclude.has(keyOf(candidate)))
    .map((candidate) => ({ candidate, tokens: tokenize(candidate.text) }))
    .filter((doc) => doc.tokens.length > 0)
  if (docs.length === 0) return []

  const averageLength = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / docs.length
  const documentFrequency = new Map<string, number>()
  for (const doc of docs) {
    for (const token of new Set(doc.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
    }
  }

  const k1 = 1.2
  const b = 0.75
  const scored = docs.map((doc) => {
    const counts = new Map<string, number>()
    for (const token of doc.tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
    let score = 0
    for (const token of queryTokens) {
      const frequency = counts.get(token) ?? 0
      if (frequency === 0) continue
      const df = documentFrequency.get(token) ?? 0
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))
      score +=
        (idf * (frequency * (k1 + 1))) /
        (frequency + k1 * (1 - b + (b * doc.tokens.length) / averageLength))
    }
    if (score > 0) {
      const ageDays = Math.max(0, (nowMs - doc.candidate.atMs) / 86_400_000)
      score += 0.25 * Math.exp(-ageDays / 7)
    }
    return { candidate: doc.candidate, score }
  })

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, bEntry) => {
      if (bEntry.score !== a.score) return bEntry.score - a.score
      return bEntry.candidate.atMs - a.candidate.atMs
    })
    .slice(0, limit)
    .map((entry) => entry.candidate)
}

interface DashboardChatRetrieverDeps {
  monitorStore: Pick<MonitorStore, 'listProjects'>
  configService: Pick<ConfigService, 'resolveSettings'>
  deltaStore: Pick<DashboardDeltaStore, 'load'>
  teamWorkspace: {
    getConnection(): Promise<{ profileId: string; teamId: string } | null>
  }
  /** Injectable clock so ranking is deterministic in tests. */
  now?: () => number
}

interface WorkspaceSource {
  source: DashboardSource
  profileId: string
  teamId: string
  channels: Array<{ channelId: string; channelName: string }>
}

export class DashboardChatRetriever implements ProjectChatRetriever {
  private readonly monitorStore: DashboardChatRetrieverDeps['monitorStore']
  private readonly configService: DashboardChatRetrieverDeps['configService']
  private readonly deltaStore: DashboardChatRetrieverDeps['deltaStore']
  private readonly teamWorkspace: DashboardChatRetrieverDeps['teamWorkspace']
  private readonly now: () => number

  constructor(deps: DashboardChatRetrieverDeps) {
    this.monitorStore = deps.monitorStore
    this.configService = deps.configService
    this.deltaStore = deps.deltaStore
    this.teamWorkspace = deps.teamWorkspace
    this.now = deps.now ?? (() => Date.now())
  }

  private async workspaceSources(projectId: string): Promise<WorkspaceSource[]> {
    const project = (await this.monitorStore.listProjects()).find((p) => p.id === projectId)
    if (!project) throw new Error('PROJECT_NOT_FOUND')

    const settings = await this.configService.resolveSettings(projectId)
    const sources: WorkspaceSource[] = [
      {
        source: 'client',
        profileId: project.profileId,
        teamId: settings.client.teamId || project.teamId,
        channels: settings.client.channels
      }
    ]

    if (settings.ourSlack.channels.length > 0) {
      const connection = await this.teamWorkspace.getConnection().catch(() => null)
      sources.push({
        source: 'ours',
        profileId: connection?.profileId ?? project.profileId,
        teamId: connection?.teamId ?? project.teamId,
        channels: settings.ourSlack.channels
      })
    }
    return sources
  }

  private async loadCandidates(projectId: string): Promise<ChatMessageCandidate[]> {
    const sources = await this.workspaceSources(projectId)
    const seen = new Set<string>()
    const candidates: ChatMessageCandidate[] = []

    for (const workspace of sources) {
      for (const channel of workspace.channels) {
        const delta = await this.deltaStore.load(
          workspace.profileId,
          workspace.teamId,
          channel.channelId
        )
        if (!delta) continue
        for (const message of delta.messages) {
          const text = (message.text ?? '').trim()
          if (!text) continue
          const candidate: ChatMessageCandidate = {
            source: workspace.source,
            channelId: channel.channelId,
            channelName: delta.channel.name || channel.channelName,
            ts: message.ts,
            user: message.user,
            text,
            permalink: message.permalink,
            atMs: tsToMs(message.ts)
          }
          const key = keyOf(candidate)
          if (seen.has(key)) continue
          seen.add(key)
          candidates.push(candidate)
        }
      }
    }
    return candidates
  }

  async retrieve(projectId: string, query: string): Promise<ChatRetrievalResult> {
    const candidates = await this.loadCandidates(projectId)
    const recent = [...candidates]
      .sort((a, b) => {
        if (b.atMs !== a.atMs) return b.atMs - a.atMs
        return b.ts.localeCompare(a.ts)
      })
      .slice(0, RECENT_MESSAGE_COUNT)
      .reverse()

    const recentKeys = new Set(recent.map(keyOf))
    const matches = rankMatches(candidates, query, recentKeys, this.now())
    return { recent, matches }
  }
}
