import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

function makeMockView(overrides: Partial<{
  destroyed: boolean
  url: string
  jsResult: unknown
}> = {}) {
  const url = overrides.url ?? 'https://app.slack.com/client/T123/C123'
  const destroyed = overrides.destroyed ?? false
  const jsResult = overrides.jsResult ?? null

  return {
    webContents: {
      isDestroyed: () => destroyed,
      getURL: () => url,
      loadURL: vi.fn().mockResolvedValue(undefined),
      executeJavaScript: vi.fn().mockResolvedValue(jsResult),
      setBackgroundThrottling: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      close: vi.fn()
    },
    setBounds: vi.fn()
  }
}

const mockWebContentsView = vi.fn().mockImplementation(function () {
  return makeMockView({ jsResult: 'logged_in' })
})

vi.mock('electron', () => ({
  WebContentsView: (...args: any[]) => mockWebContentsView(...args),
  session: {
    fromPartition: vi.fn().mockReturnValue({
      setUserAgent: vi.fn(),
      cookies: {
        get: vi.fn().mockResolvedValue([
          { name: 'd', value: 'xoxd-test-cookie-456', domain: '.slack.com' }
        ])
      }
    })
  }
}))

import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { DashboardInsightSyncEngine } from '../../src/main/dashboard/sync-engine'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import { HistoryStore } from '../../src/main/dashboard/history-store'
import { InsightEngine } from '../../src/main/dashboard/insight-engine'
import { RunLogStore } from '../../src/main/dashboard/run-log-store'
import { resolveProjectMessageSources } from '../../src/main/dashboard/message-sources'
import type { DashboardProject, ProjectSource } from '../../src/shared/dashboard-contract'
import { sessionTokenExtractor } from '../../src/main/slack-reader/session-token-extractor'
import { SlackApiClient } from '../../src/main/dashboard/slack-api-client'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true }).catch(() => {})))
  dirs.length = 0
  vi.restoreAllMocks()
})

function testProject(engineMode: 'direct_api' | 'browser' = 'direct_api'): DashboardProject {
  const now = new Date().toISOString()
  const source: ProjectSource = {
    id: 'src-test-1',
    kind: 'browser',
    engineMode,
    platform: 'slack',
    profileId: 'prof-test',
    workspaceId: 'T-TEST',
    workspaceName: 'AgentWork Workspace',
    channels: [
      { id: 'C_ACTIVE', name: 'agentworkprojecttesting', enabled: true, kind: 'public' }
    ],
    role: 'client',
    enabled: true,
    channelsReviewedAt: now,
    backfillDays: 7,
    createdAt: now,
    updatedAt: now
  }
  return {
    id: 'proj-test',
    name: 'Ashutosh-Project-01',
    clientName: 'Ashutosh',
    profileId: 'prof-test',
    teamId: 'T-TEST',
    teamName: 'AgentWork Workspace',
    appId: 'slack',
    tokenSource: 'oauth',
    sourcePreference: 'browser_only',
    monitors: [],
    sources: [source],
    createdAt: now
  }
}

async function createStores(): Promise<{
  monitors: MonitorStore
  delta: DashboardDeltaStore
  runLogs: RunLogStore
  history: HistoryStore
  dir: string
}> {
  const dir = await mkdtemp(join(tmpdir(), 'dual-engine-test-'))
  dirs.push(dir)
  return {
    dir,
    monitors: new MonitorStore({ rootDir: dir, encryptionAvailable: false }),
    delta: new DashboardDeltaStore({ rootDir: dir }),
    runLogs: new RunLogStore({ rootDir: dir }),
    history: new HistoryStore({ rootDir: dir })
  }
}

describe('Dual-Engine End-to-End Testing', () => {
  it('correctly ingests new messages via Direct API, updates dashboard snapshot and records engineMode in audit logs', async () => {
    const { monitors, delta, runLogs, history } = await createStores()
    const project = testProject('direct_api')
    await monitors.upsertProject({ project })

    // Mock session token extraction from view
    vi.spyOn(sessionTokenExtractor, 'extractSlackSessionTokens').mockResolvedValue({
      token: 'xoxc-test-token-123',
      cookie: 'xoxd-test-cookie-456'
    })

    // Mock Direct API client fetch
    const mockMessages = [
      {
        ts: '1793945549.751439',
        user: 'Ashutosh',
        text: 'hiii can we together',
        source: 'client' as const
      },
      {
        ts: '1793945569.620039',
        user: 'Ashutosh',
        text: 'tell me what is the progress of our current project',
        source: 'client' as const
      },
      {
        ts: '1793945620.560479',
        user: 'Ashutosh',
        text: 'i think that not take too much time so you can did it',
        source: 'client' as const
      }
    ]

    vi.spyOn(SlackApiClient.prototype, 'fetchChannelMessages').mockResolvedValue({
      messages: mockMessages,
      oldestTs: 1793945549.751439,
      newestTs: 1793945620.560479,
      hasMore: false
    })

    const engine = new DashboardInsightSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => null },
      pollerFactory: () => ({ fetchHistory: async () => ({ messages: [], hasMore: false }) }),
      insightEngine: new InsightEngine({
        provider: null,
        historyStore: history,
        deltaStore: delta,
        resolveSources: (p) => Promise.resolve(resolveProjectMessageSources(p))
      })
    })

    // Execute sync
    const result = await engine.syncProjectSource('proj-test', 'src-test-1', {
      trigger: 'scheduled'
    })

    console.log('SYNC RESULT:', JSON.stringify(result, null, 2))
    expect(result.status).toBe('success')
    expect(result.newMessages).toBe(3)
    expect(result.channelsRead).toBe(1)

    // 1. Verify messages stored in deltaStore
    const stored = await delta.load('prof-test', 'T-TEST', 'C_ACTIVE')
    expect(stored?.messages).toHaveLength(3)
    expect(stored?.cursor).toBe('1793945620.560479')
    expect(stored?.messages[0].text).toBe('hiii can we together')
    expect(stored?.messages[2].text).toBe('i think that not take too much time so you can did it')

    // 2. Verify dashboard snapshot is updated with latest messages
    const snapshot = (await engine.buildSnapshot('proj-test'))[0]
    expect(snapshot?.totalMessageCount).toBe(3)
    expect(snapshot?.perChannel[0].messageCount).toBe(3)
    expect(snapshot?.perChannel[0].channelId).toBe('C_ACTIVE')

    // 3. Verify audit run log was saved with engineMode === 'direct_api'
    const logs = await runLogs.read('proj-test')
    expect(logs).toHaveLength(1)
    expect(logs[0].engineMode).toBe('direct_api')
    expect(logs[0].newMessages).toBe(3)
    expect(logs[0].snippets).toHaveLength(3)
    expect(logs[0].snippets?.[0].snippet).toBe('hiii can we together')
  })

  it('skips expensive LLM analysis when 0 new messages arrive, conserving 100% of AI tokens', async () => {
    const { monitors, delta, history } = await createStores()
    const project = testProject('direct_api')
    await monitors.upsertProject({ project })

    vi.spyOn(sessionTokenExtractor, 'extractSlackSessionTokens').mockResolvedValue({
      token: 'xoxc-test-token-123',
      cookie: 'xoxd-test-cookie-456'
    })

    // First run returns 2 messages
    vi.spyOn(SlackApiClient.prototype, 'fetchChannelMessages').mockResolvedValueOnce({
      messages: [
        { ts: '1793945549.751439', user: 'Ashutosh', text: 'message 1', source: 'client' },
        { ts: '1793945569.620039', user: 'Ashutosh', text: 'message 2', source: 'client' }
      ],
      oldestTs: 1793945549.751439,
      newestTs: 1793945569.620039,
      hasMore: false
    })

    const insightEngineMock = new InsightEngine({
      provider: null,
      historyStore: history,
      deltaStore: delta,
      resolveSources: (p) => Promise.resolve(resolveProjectMessageSources(p))
    })
    const refreshSpy = vi.spyOn(insightEngineMock, 'refresh').mockImplementation((_p, _t, s) => Promise.resolve(s))

    const engine = new DashboardInsightSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => null },
      pollerFactory: () => ({ fetchHistory: async () => ({ messages: [], hasMore: false }) }),
      insightEngine: insightEngineMock
    })

    // Run 1: new messages = 2 -> LLM SHOULD run
    const run1 = await engine.syncProjectSource('proj-test', 'src-test-1', { trigger: 'scheduled' })
    expect(run1.newMessages).toBe(2)
    expect(refreshSpy).toHaveBeenCalledTimes(1)

    // Run 2: subsequent check returns same messages (deduplicated -> newMessages = 0)
    vi.spyOn(SlackApiClient.prototype, 'fetchChannelMessages').mockResolvedValueOnce({
      messages: [
        { ts: '1793945549.751439', user: 'Ashutosh', text: 'message 1', source: 'client' },
        { ts: '1793945569.620039', user: 'Ashutosh', text: 'message 2', source: 'client' }
      ],
      oldestTs: 1793945549.751439,
      newestTs: 1793945569.620039,
      hasMore: false
    })

    const run2 = await engine.syncProjectSource('proj-test', 'src-test-1', { trigger: 'scheduled' })
    expect(run2.newMessages).toBe(0)
    // LLM should NOT have been called a second time! Still only 1 call
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('runs startup catch-up after sleep/shutdown, pulling missed messages across the offline gap', async () => {
    const { monitors, delta, history } = await createStores()
    const project = testProject('direct_api')
    await monitors.upsertProject({ project })

    vi.spyOn(sessionTokenExtractor, 'extractSlackSessionTokens').mockResolvedValue({
      token: 'xoxc-test-token-123',
      cookie: 'xoxd-test-cookie-456'
    })

    // Mock sleep-time messages arriving
    vi.spyOn(SlackApiClient.prototype, 'fetchChannelMessages').mockResolvedValueOnce({
      messages: [
        { ts: '1793940000.000001', user: 'Ashutosh', text: 'offline sleep message 1', source: 'client' },
        { ts: '1793942000.000001', user: 'Ashutosh', text: 'offline sleep message 2', source: 'client' }
      ],
      oldestTs: 1793940000.000001,
      newestTs: 1793942000.000001,
      hasMore: false
    })

    const insightEngineMock = new InsightEngine({
      provider: null,
      historyStore: history,
      deltaStore: delta,
      resolveSources: (p) => Promise.resolve(resolveProjectMessageSources(p))
    })
    const refreshSpy = vi.spyOn(insightEngineMock, 'refresh').mockImplementation((_p, _t, s) => Promise.resolve(s))

    const engine = new DashboardInsightSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => null },
      pollerFactory: () => ({ fetchHistory: async () => ({ messages: [], hasMore: false }) }),
      insightEngine: insightEngineMock
    })

    // Simulate startup trigger after sleep
    const runStartup = await engine.syncProjectSource('proj-test', 'src-test-1', {
      trigger: 'startup'
    })

    expect(runStartup.status).toBe('success')
    expect(runStartup.newMessages).toBe(2)
    // On startup catch-up, insight refresh must be triggered to update dashboard
    expect(refreshSpy).toHaveBeenCalledTimes(1)

    const stored = await delta.load('prof-test', 'T-TEST', 'C_ACTIVE')
    expect(stored?.messages).toHaveLength(2)
    expect(stored?.messages[0].text).toBe('offline sleep message 1')
  })

  it('automatically triggers 24-hour lookback window when time gap exceeds 60 seconds', async () => {
    const { monitors, delta, history } = await createStores()
    const project = testProject('direct_api')
    // Set last sync to 3 minutes ago (> 60s gap)
    const threeMinsAgoIso = new Date(Date.now() - 180_000).toISOString()
    project.sources![0].lastScrapeAt = threeMinsAgoIso
    project.sources![0].lastReadAt = threeMinsAgoIso
    await monitors.upsertProject({ project })

    vi.spyOn(sessionTokenExtractor, 'extractSlackSessionTokens').mockResolvedValue({
      token: 'xoxc-test-token-123',
      cookie: 'xoxd-test-cookie-456'
    })

    let requestedSinceTs: number | undefined
    vi.spyOn(SlackApiClient.prototype, 'fetchChannelMessages').mockImplementation(async (opts) => {
      requestedSinceTs = opts.sinceTs
      return {
        messages: [
          { ts: '1793950000.000001', user: 'Ashutosh', text: 'gap caught up message', source: 'client' }
        ],
        oldestTs: 1793950000.000001,
        newestTs: 1793950000.000001,
        hasMore: false
      }
    })

    const insightEngineMock = new InsightEngine({
      provider: null,
      historyStore: history,
      deltaStore: delta,
      resolveSources: (p) => Promise.resolve(resolveProjectMessageSources(p))
    })
    vi.spyOn(insightEngineMock, 'refresh').mockImplementation((_p, _t, s) => Promise.resolve(s))

    const engine = new DashboardInsightSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => null },
      pollerFactory: () => ({ fetchHistory: async () => ({ messages: [], hasMore: false }) }),
      insightEngine: insightEngineMock
    })

    const run = await engine.syncProjectSource('proj-test', 'src-test-1', {
      trigger: 'scheduled'
    })

    expect(run.status).toBe('success')
    expect(run.newMessages).toBe(1)
    // requestedSinceTs must be at least ~24 hours ago (>= 86,000 seconds lookback)
    const nowSec = Math.floor(Date.now() / 1000)
    expect(nowSec - (requestedSinceTs ?? 0)).toBeGreaterThanOrEqual(86000)
  })

  it('Zero-DOM: executes Direct API scrape without creating WebContentsView when credentials resolve', async () => {
    const { monitors, delta, history } = await createStores()
    const project = testProject('direct_api')
    await monitors.upsertProject({ project })

    mockWebContentsView.mockClear()

    vi.spyOn(sessionTokenExtractor, 'extractSlackSessionTokens').mockResolvedValue({
      token: 'xoxc-test-token-123',
      cookie: 'xoxd-test-cookie-456'
    })

    vi.spyOn(SlackApiClient.prototype, 'fetchChannelMessages').mockResolvedValueOnce({
      messages: [
        { ts: '1793960000.000001', user: 'Ashutosh', text: 'zero dom message', source: 'client' }
      ],
      oldestTs: 1793960000.000001,
      newestTs: 1793960000.000001,
      hasMore: false
    })

    const insightEngineMock = new InsightEngine({
      provider: null,
      historyStore: history,
      deltaStore: delta,
      resolveSources: (p) => Promise.resolve(resolveProjectMessageSources(p))
    })
    vi.spyOn(insightEngineMock, 'refresh').mockImplementation((_p, _t, s) => Promise.resolve(s))

    const engine = new DashboardInsightSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => null },
      pollerFactory: () => ({ fetchHistory: async () => ({ messages: [], hasMore: false }) }),
      insightEngine: insightEngineMock
    })

    const result = await engine.syncProjectSource('proj-test', 'src-test-1', {
      trigger: 'scheduled'
    })

    expect(result.status).toBe('success')
    expect(result.newMessages).toBe(1)
    // In Zero-DOM mode, no WebContentsView was instantiated!
    expect(mockWebContentsView).not.toHaveBeenCalled()
  })

  it('Strict AI Decoupling: skips LLM analysis on startup catch-up when 0 new messages arrive', async () => {
    const { monitors, delta, history } = await createStores()
    const project = testProject('direct_api')
    await monitors.upsertProject({ project })

    vi.spyOn(sessionTokenExtractor, 'extractSlackSessionTokens').mockResolvedValue({
      token: 'xoxc-test-token-123',
      cookie: 'xoxd-test-cookie-456'
    })

    // Return empty messages on startup catch-up
    vi.spyOn(SlackApiClient.prototype, 'fetchChannelMessages').mockResolvedValueOnce({
      messages: [],
      oldestTs: null,
      newestTs: null,
      hasMore: false
    })

    const insightEngineMock = new InsightEngine({
      provider: null,
      historyStore: history,
      deltaStore: delta,
      resolveSources: (p) => Promise.resolve(resolveProjectMessageSources(p))
    })
    const refreshSpy = vi.spyOn(insightEngineMock, 'refresh').mockImplementation((_p, _t, s) => Promise.resolve(s))

    const engine = new DashboardInsightSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => null },
      pollerFactory: () => ({ fetchHistory: async () => ({ messages: [], hasMore: false }) }),
      insightEngine: insightEngineMock
    })

    const runStartupEmpty = await engine.syncProjectSource('proj-test', 'src-test-1', {
      trigger: 'startup'
    })

    expect(runStartupEmpty.status).toBe('success')
    expect(runStartupEmpty.newMessages).toBe(0)
    // Strictly 0 AI tokens spent when 0 new messages arrived on startup
    expect(refreshSpy).not.toHaveBeenCalled()
  })

  it('Strict AI Decoupling: triggers LLM analysis on manual trigger even with 0 new messages', async () => {
    const { monitors, delta, history } = await createStores()
    const project = testProject('direct_api')
    await monitors.upsertProject({ project })

    vi.spyOn(sessionTokenExtractor, 'extractSlackSessionTokens').mockResolvedValue({
      token: 'xoxc-test-token-123',
      cookie: 'xoxd-test-cookie-456'
    })

    vi.spyOn(SlackApiClient.prototype, 'fetchChannelMessages').mockResolvedValueOnce({
      messages: [],
      oldestTs: null,
      newestTs: null,
      hasMore: false
    })

    const insightEngineMock = new InsightEngine({
      provider: null,
      historyStore: history,
      deltaStore: delta,
      resolveSources: (p) => Promise.resolve(resolveProjectMessageSources(p))
    })
    const refreshSpy = vi.spyOn(insightEngineMock, 'refresh').mockImplementation((_p, _t, s) => Promise.resolve(s))

    const engine = new DashboardInsightSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => null },
      pollerFactory: () => ({ fetchHistory: async () => ({ messages: [], hasMore: false }) }),
      insightEngine: insightEngineMock
    })

    const runManual = await engine.syncProjectSource('proj-test', 'src-test-1', {
      trigger: 'manual'
    })

    expect(runManual.status).toBe('success')
    expect(runManual.newMessages).toBe(0)
    // Manual click MUST trigger AI insight refresh
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('Strict AI Decoupling: triggers LLM analysis when 6-hour heartbeat timer expires', async () => {
    const { monitors, delta, history } = await createStores()
    const project = testProject('direct_api')
    await monitors.upsertProject({ project })

    vi.spyOn(sessionTokenExtractor, 'extractSlackSessionTokens').mockResolvedValue({
      token: 'xoxc-test-token-123',
      cookie: 'xoxd-test-cookie-456'
    })

    vi.spyOn(SlackApiClient.prototype, 'fetchChannelMessages').mockResolvedValue({
      messages: [],
      oldestTs: null,
      newestTs: null,
      hasMore: false
    })

    const insightEngineMock = new InsightEngine({
      provider: null,
      historyStore: history,
      deltaStore: delta,
      resolveSources: (p) => Promise.resolve(resolveProjectMessageSources(p))
    })
    const refreshSpy = vi.spyOn(insightEngineMock, 'refresh').mockImplementation((_p, _t, s) => Promise.resolve(s))

    const engine = new DashboardInsightSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => null },
      pollerFactory: () => ({ fetchHistory: async () => ({ messages: [], hasMore: false }) }),
      insightEngine: insightEngineMock
    })

    // Simulate an initial AI analysis done 6.5 hours ago
    const sixAndHalfHoursAgo = Date.now() - 6.5 * 60 * 60 * 1000
    ;(engine as any).lastAiAnalysisAt.set('proj-test', sixAndHalfHoursAgo)

    const runHeartbeat = await engine.syncProjectSource('proj-test', 'src-test-1', {
      trigger: 'scheduled'
    })

    expect(runHeartbeat.status).toBe('success')
    expect(runHeartbeat.newMessages).toBe(0)
    // 6-hour heartbeat expiration MUST trigger AI insight refresh
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('UI Reactivity: invalidates chatService activityCache and stamps lastUpdatedAt on new messages', async () => {
    const { monitors, delta, history } = await createStores()
    const project = testProject('direct_api')
    await monitors.upsertProject({ project })

    vi.spyOn(sessionTokenExtractor, 'extractSlackSessionTokens').mockResolvedValue({
      token: 'xoxc-test-token-123',
      cookie: 'xoxd-test-cookie-456'
    })

    vi.spyOn(SlackApiClient.prototype, 'fetchChannelMessages').mockResolvedValueOnce({
      messages: [
        { ts: '1793970000.000001', user: 'Ashutosh', text: 'reactive UI message', source: 'client' }
      ],
      oldestTs: 1793970000.000001,
      newestTs: 1793970000.000001,
      hasMore: false
    })

    const mockChatService = {
      invalidateActivityCache: vi.fn()
    }

    let syncedSnapshot: any = null
    const engine = new DashboardInsightSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      chatService: mockChatService,
      oauthTokenProvider: { tryGet: async () => null },
      pollerFactory: () => ({ fetchHistory: async () => ({ messages: [], hasMore: false }) }),
      onSynced: (snapshots) => {
        syncedSnapshot = snapshots[0]
      },
      insightEngine: new InsightEngine({
        provider: null,
        historyStore: history,
        deltaStore: delta,
        resolveSources: (p) => Promise.resolve(resolveProjectMessageSources(p))
      })
    })

    const result = await engine.syncProjectSource('proj-test', 'src-test-1', {
      trigger: 'scheduled'
    })

    expect(result.status).toBe('success')
    expect(result.newMessages).toBe(1)
    // Activity cache must be invalidated
    expect(mockChatService.invalidateActivityCache).toHaveBeenCalledWith('proj-test')
    // Snapshot lastUpdatedAt must be stamped
    expect(syncedSnapshot).not.toBeNull()
    expect(syncedSnapshot?.lastUpdatedAt).toBeDefined()
  })
})
