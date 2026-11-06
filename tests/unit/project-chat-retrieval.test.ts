import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DashboardChatRetriever,
  MATCH_CHUNK_LIMIT,
  RECENT_MESSAGE_COUNT,
  rankMatches,
  tokenize,
  type ChatMessageCandidate
} from '../../src/main/dashboard/chat-retrieval'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import type { DashboardMonitor, DashboardProject } from '../../src/shared/dashboard-contract'
import type { ResolvedProjectSettings } from '../../src/main/dashboard/config-service'
import type { ResolvedAiSettings } from '../../src/main/dashboard/ai-settings'

const dirs: string[] = []
const NOW = Date.parse('2026-10-25T12:00:00.000Z')

const ai: ResolvedAiSettings = {
  provider: 'nvidia-nim',
  model: 'test-model',
  chatModel: 'test-model',
  embeddingModel: 'test-embed',
  apiKey: 'nvapi-test',
  modelSource: 'global',
  chatModelSource: 'global',
  embeddingModelSource: 'global',
  keySource: 'global'
}

function project(overrides: Partial<DashboardProject> = {}): DashboardProject {
  return {
    id: 'p1',
    name: 'Acme',
    clientName: 'Acme',
    profileId: 'pf1',
    teamId: 'T1',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [{ channelId: 'C1', channelName: 'client-dev' }],
    ourSlackChannels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function settings(input: {
  clientChannels: DashboardMonitor[]
  ourChannels?: DashboardMonitor[]
}): ResolvedProjectSettings {
  return {
    client: {
      token: 'xoxb-client',
      workspaceName: 'Acme',
      teamId: 'T1',
      channels: input.clientChannels,
      source: 'project',
      mappedWorkspaceId: null,
      mappedWorkspaceName: null
    },
    ourSlack: {
      token: input.ourChannels?.length ? 'xoxp-ours' : null,
      workspaceName: 'Our Team',
      teamId: input.ourChannels?.length ? 'T_OURS' : null,
      channels: input.ourChannels ?? [],
      source: input.ourChannels?.length ? 'global' : 'none'
    },
    ai
  }
}

function candidate(
  overrides: Partial<ChatMessageCandidate> & Pick<ChatMessageCandidate, 'ts' | 'text'>
): ChatMessageCandidate {
  return {
    source: 'client',
    channelId: 'C1',
    channelName: 'client-dev',
    user: 'U1',
    atMs: Number(overrides.ts) * 1000,
    ...overrides
  }
}

describe('tokenize', () => {
  it('lowercases, drops punctuation, short tokens and stopwords', () => {
    expect(tokenize('The client WILL pay for the budget, kya hai?')).toEqual([
      'client',
      'will',
      'pay',
      'budget'
    ])
  })
})

describe('rankMatches', () => {
  it('ranks repeated query terms above a single mention', () => {
    const docs = [
      candidate({ ts: '100.0', text: 'budget was mentioned once' }),
      candidate({ ts: '100.0', text: 'budget budget budget' })
    ]
    const ranked = rankMatches(docs, 'budget', new Set(), NOW)
    expect(ranked).toHaveLength(2)
    expect(ranked[0].text).toBe('budget budget budget')
  })

  it('uses recency only to break otherwise equal scores', () => {
    const older = candidate({ ts: '100.0', text: 'alpha' })
    const newer = candidate({ ts: '200.0', text: 'alpha' })
    const ranked = rankMatches([older, newer], 'alpha', new Set(), NOW)
    expect(ranked.map((row) => row.ts)).toEqual(['200.0', '100.0'])
  })

  it('never returns messages that are already in the recent window', () => {
    const recent = candidate({ ts: '200.0', text: 'alpha' })
    const older = candidate({ ts: '100.0', text: 'alpha' })
    const ranked = rankMatches([recent, older], 'alpha', new Set(['client:C1:200.0']), NOW)
    expect(ranked.map((row) => row.ts)).toEqual(['100.0'])
  })

  it('returns nothing for a stopword-only query', () => {
    const docs = [candidate({ ts: '100.0', text: 'the client said kya hai' })]
    expect(rankMatches(docs, 'kya hai the', new Set(), NOW)).toEqual([])
  })

  it('caps the result at the chunk limit', () => {
    const docs = Array.from({ length: MATCH_CHUNK_LIMIT + 5 }, (_, index) =>
      candidate({ ts: `${100 + index}.0`, text: `alpha ${index}` })
    )
    expect(rankMatches(docs, 'alpha', new Set(), NOW)).toHaveLength(MATCH_CHUNK_LIMIT)
  })
})

describe('DashboardChatRetriever', () => {
  let dir: string
  let deltaStore: DashboardDeltaStore
  let projects: DashboardProject[]
  let resolved: ResolvedProjectSettings
  let connection: { profileId: string; teamId: string } | null
  let retriever: DashboardChatRetriever

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dash-retrieval-'))
    dirs.push(dir)
    deltaStore = new DashboardDeltaStore({ rootDir: dir })
    projects = [project()]
    resolved = settings({ clientChannels: [{ channelId: 'C1', channelName: 'client-dev' }] })
    connection = null
    retriever = new DashboardChatRetriever({
      monitorStore: { listProjects: async () => projects },
      configService: { resolveSettings: async () => resolved },
      deltaStore,
      teamWorkspace: { getConnection: async () => connection },
      now: () => NOW
    })
  })

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  })

  it('keeps the newest messages in chronological order and ranks the older ones', async () => {
    await deltaStore.appendMessages({
      profileId: 'pf1',
      teamId: 'T1',
      channelId: 'C1',
      channelName: 'client-dev',
      messages: Array.from({ length: 35 }, (_, index) => ({
        ts: `${1000 + index}.000001`,
        user: 'U_CLIENT',
        text: index < 5 ? `alpha older-${index}` : `recent-${index}`
      }))
    })

    const result = await retriever.retrieve('p1', 'alpha')

    expect(result.recent).toHaveLength(RECENT_MESSAGE_COUNT)
    expect(result.recent[0].text).toBe('recent-5')
    expect(result.recent.at(-1)?.text).toBe('recent-34')
    const atMs = result.recent.map((row) => row.atMs)
    expect([...atMs].sort((left, right) => left - right)).toEqual(atMs)

    expect(result.matches.map((row) => row.text).sort()).toEqual([
      'alpha older-0',
      'alpha older-1',
      'alpha older-2',
      'alpha older-3',
      'alpha older-4'
    ])
  })

  it('reads our workspace channels with the ours source', async () => {
    resolved = settings({
      clientChannels: [{ channelId: 'C1', channelName: 'client-dev' }],
      ourChannels: [{ channelId: 'C2', channelName: 'team-dev' }]
    })
    connection = { profileId: 'pf_ours', teamId: 'T_OURS' }
    await deltaStore.appendMessages({
      profileId: 'pf_ours',
      teamId: 'T_OURS',
      channelId: 'C2',
      channelName: 'team-dev',
      messages: [{ ts: '3000.000001', user: 'U_SELF', text: 'our internal note about alpha' }]
    })

    const result = await retriever.retrieve('p1', 'alpha')

    expect(result.recent).toHaveLength(1)
    expect(result.recent[0]).toMatchObject({
      source: 'ours',
      channelId: 'C2',
      channelName: 'team-dev'
    })
  })

  it('does not read channels that are not configured for this project', async () => {
    projects = [
      project(),
      project({
        id: 'p2',
        profileId: 'pf2',
        teamId: 'T2',
        monitors: [{ channelId: 'C9', channelName: 'other-client' }]
      })
    ]
    await deltaStore.appendMessages({
      profileId: 'pf2',
      teamId: 'T2',
      channelId: 'C9',
      channelName: 'other-client',
      messages: [{ ts: '4000.000001', user: 'U_X', text: 'other project secret alpha' }]
    })

    const result = await retriever.retrieve('p1', 'alpha')

    expect(result.recent).toEqual([])
    expect(result.matches).toEqual([])
  })

  it('rejects an unknown project', async () => {
    await expect(retriever.retrieve('missing', 'alpha')).rejects.toThrow('PROJECT_NOT_FOUND')
  })

  it('skips blank messages and falls back to the configured channel name', async () => {
    await deltaStore.appendMessages({
      profileId: 'pf1',
      teamId: 'T1',
      channelId: 'C1',
      channelName: '',
      messages: [
        { ts: '5000.000001', user: 'U1', text: '   ' },
        { ts: '5001.000001', user: 'U1', text: 'alpha from an unnamed channel' }
      ]
    })

    const result = await retriever.retrieve('p1', 'alpha')

    expect(result.recent).toHaveLength(1)
    expect(result.recent[0].channelName).toBe('client-dev')
  })
})
