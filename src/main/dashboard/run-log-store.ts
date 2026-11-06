import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { log } from '../logging'
import type {
  ScrapeChannelKind,
  ScrapeRunChannel,
  ScrapeRunLog,
  ScrapeRunMessageSnippet,
  ScrapeRunPerson,
  ScrapeRunQuery,
  ScrapeRunStatus
} from '../../shared/dashboard-contract'

/** Kept as aliases so older imports keep compiling. */
export type RunLogMessageSnippet = ScrapeRunMessageSnippet
export type RunLogEntry = ScrapeRunLog

const CHANNEL_KINDS: ScrapeChannelKind[] = ['public', 'private', 'dm', 'group-dm']

function kindOf(
  value: unknown,
  channel?: { isPrivate?: boolean; isDm?: boolean }
): ScrapeChannelKind {
  if (typeof value === 'string' && (CHANNEL_KINDS as string[]).includes(value)) {
    return value as ScrapeChannelKind
  }
  if (channel?.isDm) return 'dm'
  if (channel?.isPrivate) return 'private'
  return 'public'
}

function statusOf(raw: unknown): ScrapeRunStatus {
  switch (raw) {
    case 'success':
    case 'partial':
    case 'error':
    case 'stopped':
      return raw
    case 'connected':
      return 'success'
    case 'paused':
      return 'stopped'
    case 'needs-login':
    case 'challenge':
    case 'adapter-broken':
    case 'running':
      return 'error'
    default:
      return 'error'
  }
}

function peopleFromSnippets(snippets: ScrapeRunMessageSnippet[]): ScrapeRunPerson[] {
  const counts = new Map<string, number>()
  for (const snip of snippets) {
    const name = snip.sender || 'Anonymous'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, messages]) => ({ name, messages }))
    .sort((a, b) => b.messages - a.messages)
}

/** Old log lines predate the rich shape; normalize instead of dropping them. */
function normalizeEntry(raw: unknown): ScrapeRunLog | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<ScrapeRunLog> & Record<string, unknown>
  if (typeof r.runId !== 'string' || typeof r.ts !== 'string') return null

  const snippets = Array.isArray(r.snippets) ? (r.snippets as ScrapeRunMessageSnippet[]) : []
  const channels = Array.isArray(r.channels)
    ? (r.channels as Array<Partial<ScrapeRunChannel>>).map((ch) => ({
        channelId: String(ch.channelId ?? ''),
        channelName: String(ch.channelName ?? ch.channelId ?? ''),
        kind: kindOf(ch.kind, { isPrivate: ch.kind === 'private' }),
        messagesRead: Number(ch.messagesRead ?? 0),
        newMessages: Number(ch.newMessages ?? 0),
        status: ch.status ?? 'read',
        skippedReason: ch.skippedReason,
        error: ch.error
      }))
    : []
  const people = Array.isArray(r.people)
    ? (r.people as ScrapeRunPerson[])
    : peopleFromSnippets(snippets)

  return {
    runId: r.runId,
    ts: r.ts,
    startedAt: typeof r.startedAt === 'string' ? r.startedAt : r.ts,
    trigger: r.trigger === 'scheduled' ? 'scheduled' : 'manual',
    projectId: String(r.projectId ?? ''),
    projectName: typeof r.projectName === 'string' ? r.projectName : String(r.projectId ?? ''),
    sourceId: String(r.sourceId ?? ''),
    sourceKind: r.sourceKind === 'token' ? 'token' : 'browser',
    engineMode: r.engineMode === 'browser' ? 'browser' : 'direct_api',
    workspaceId: String(r.workspaceId ?? ''),
    workspaceName:
      typeof r.workspaceName === 'string' ? r.workspaceName : String(r.workspaceId ?? ''),
    channelsRead: Number(r.channelsRead ?? channels.length),
    messagesRead: Number(
      r.messagesRead ?? channels.reduce((sum, ch) => sum + (ch.messagesRead ?? 0), 0)
    ),
    newMessages: Number(r.newMessages ?? 0),
    snippets,
    window:
      r.window && typeof r.window === 'object'
        ? {
            startTs: String(r.window.startTs ?? ''),
            endTs: String(r.window.endTs ?? r.ts),
            backfillHours: Number(r.window.backfillHours ?? 0),
            gapSeconds: typeof r.window.gapSeconds === 'number' ? r.window.gapSeconds : undefined
          }
        : { startTs: '', endTs: r.ts, backfillHours: 0 },
    channels,
    people,
    filters:
      r.filters && typeof r.filters === 'object'
        ? {
            includeKinds: Array.isArray(r.filters.includeKinds)
              ? (r.filters.includeKinds as ScrapeChannelKind[])
              : ['public', 'private'],
            channelIds: r.filters.channelIds,
            people: r.filters.people
          }
        : { includeKinds: ['public', 'private'] },
    durationMs: Number(r.durationMs ?? 0),
    llmCalls: Number(r.llmCalls ?? 0),
    status: statusOf(r.status),
    error: typeof r.error === 'string' ? r.error : undefined,
    errorCode: typeof r.errorCode === 'string' ? r.errorCode : undefined
  }
}

function matchesQuery(entry: ScrapeRunLog, query: ScrapeRunQuery): boolean {
  if (query.status && query.status !== 'all' && entry.status !== query.status) return false
  if (query.trigger && query.trigger !== 'all' && entry.trigger !== query.trigger) return false
  if (query.engineMode && query.engineMode !== 'all' && entry.engineMode !== query.engineMode) return false
  return true
}

export class RunLogStore {
  private readonly dirPath: string

  constructor(options: { rootDir: string }) {
    this.dirPath = join(options.rootDir, 'run-logs')
  }

  private logFilePath(projectId: string): string {
    return join(this.dirPath, `${projectId}.jsonl`)
  }

  async append(entry: ScrapeRunLog): Promise<void> {
    try {
      await mkdir(this.dirPath, { recursive: true })
      const line = JSON.stringify(entry) + '\n'
      await appendFile(this.logFilePath(entry.projectId), line, 'utf-8')
    } catch (err) {
      log.warn('failed to append run log entry', { err: String(err) })
    }
  }

  async read(projectId: string, limit = 50, query: ScrapeRunQuery = {}): Promise<ScrapeRunLog[]> {
    const all = await this.readFile(this.logFilePath(projectId), limit * 2)
    return all.filter((entry) => matchesQuery(entry, query)).slice(0, limit)
  }

  /** Read across cards (unified Scrape Logs surface). */
  async readMany(projectIds: string[], query: ScrapeRunQuery = {}): Promise<ScrapeRunLog[]> {
    const limit = clampLimit(query.limit)
    const perProject = Math.min(limit, 200)
    const all: ScrapeRunLog[] = []
    for (const projectId of projectIds) {
      const rows = await this.readFile(this.logFilePath(projectId), perProject)
      all.push(...rows)
    }
    all.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    return all.filter((entry) => matchesQuery(entry, query)).slice(0, limit)
  }

  private async readFile(filePath: string, limit: number): Promise<ScrapeRunLog[]> {
    try {
      const content = await readFile(filePath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)
      const entries: ScrapeRunLog[] = []
      for (const line of lines) {
        try {
          const normalized = normalizeEntry(JSON.parse(line))
          if (normalized) entries.push(normalized)
        } catch {
          // ignore corrupted line
        }
      }
      return entries.reverse().slice(0, clampLimit(limit))
    } catch {
      return []
    }
  }
}

function clampLimit(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 50
  return Math.min(200, Math.floor(n))
}
