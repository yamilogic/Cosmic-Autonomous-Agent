import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DashboardProject,
  DashboardProjectSnapshot,
  DashboardScheduleRun,
  DashboardUpdateSchedulePayload
} from '../../src/shared/dashboard-contract'
import {
  DEFAULT_SCHEDULE_SETTINGS,
  mergeScheduleSettings,
  type StoredSchedules
} from '../../src/main/dashboard/schedule-store'
import { DashboardScheduler } from '../../src/main/dashboard/scheduler'
import type { DashboardSyncEngine } from '../../src/main/dashboard/sync-engine'

const T0 = new Date(2026, 9, 25, 10, 0, 0, 0)
const MINUTE = 60_000

function snapshot(name: string, newMessages = 0): DashboardProjectSnapshot {
  return {
    project: { id: name, name } as DashboardProjectSnapshot['project'],
    summary: '',
    newMessageCount: newMessages,
    totalMessageCount: 0,
    completion: 0,
    pace: 'on-track',
    mood: { state: 'neutral', signal: '' },
    extractedDates: {},
    effectiveDates: {},
    perChannel: [],
    lastUpdatedAt: T0.toISOString(),
    syncState: 'idle'
  }
}

class FakeStore {
  data: StoredSchedules

  constructor(initial: Partial<StoredSchedules> = {}) {
    this.data = {
      settings: DEFAULT_SCHEDULE_SETTINGS,
      lastRunAt: { 'slack-sync': null, 'agent-analysis': null, 'daily-recheck': null },
      runs: [],
      ...initial
    }
  }

  async read(): Promise<StoredSchedules> {
    return this.data
  }

  async update(patch: DashboardUpdateSchedulePayload): Promise<StoredSchedules> {
    this.data = {
      ...this.data,
      settings: mergeScheduleSettings(this.data.settings, patch)
    }
    return this.data
  }

  async recordRun(run: DashboardScheduleRun): Promise<StoredSchedules> {
    this.data = {
      ...this.data,
      runs: [run, ...this.data.runs],
      lastRunAt: { ...this.data.lastRunAt, [run.kind]: run.finishedAt }
    }
    return this.data
  }

  async recordSourceRun(sourceId: string, atIso: string): Promise<void> {
    this.data = {
      ...this.data,
      sourceLastRunAt: { ...(this.data.sourceLastRunAt ?? {}), [sourceId]: atIso }
    }
  }

  async pruneSourceRuns(activeSourceIds: string[]): Promise<void> {
    const active = new Set(activeSourceIds)
    const next: Record<string, string> = {}
    for (const [id, at] of Object.entries(this.data.sourceLastRunAt ?? {})) {
      if (active.has(id)) next[id] = at
    }
    this.data = { ...this.data, sourceLastRunAt: next }
  }
}

function engineWith(results: DashboardProjectSnapshot[]): {
  engine: DashboardSyncEngine
  syncAll: ReturnType<typeof vi.fn>
} {
  const syncAll = vi.fn(async () => results)
  return { engine: { syncAll } as unknown as DashboardSyncEngine, syncAll }
}

describe('DashboardScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs a startup catch-up when the last sync is overdue, then follows the interval', async () => {
    const store = new FakeStore()
    const { engine, syncAll } = engineWith([snapshot('A')])
    const scheduler = new DashboardScheduler(engine, store, {
      now: () => Date.now(),
      newId: () => `id-${Math.random()}`
    })
    await scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(syncAll).toHaveBeenCalledTimes(1)
    expect(store.data.runs[0]).toMatchObject({
      kind: 'slack-sync',
      status: 'ok'
    })
    expect(store.data.runs[0].detail).toContain('Startup catch-up')

    const state = await scheduler.getState()
    expect(state.nextRunAt).toBe(new Date(T0.getTime() + 5 * MINUTE).toISOString())

    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(syncAll).toHaveBeenCalledTimes(2)
    expect(store.data.runs[0].detail).toContain('Scheduled run')
    scheduler.stop()
  })

  it('does not catch up when the last sync is still inside the interval', async () => {
    const store = new FakeStore({
      lastRunAt: {
        'slack-sync': new Date(T0.getTime() - MINUTE).toISOString(),
        'agent-analysis': null,
        'daily-recheck': null
      }
    })
    const { engine, syncAll } = engineWith([snapshot('A')])
    const scheduler = new DashboardScheduler(engine, store, { now: () => Date.now() })
    await scheduler.start()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(syncAll).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(4 * MINUTE)
    expect(syncAll).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('pauses cleanly and clears the next run', async () => {
    const store = new FakeStore({
      lastRunAt: {
        'slack-sync': T0.toISOString(),
        'agent-analysis': null,
        'daily-recheck': null
      }
    })
    const { engine, syncAll } = engineWith([snapshot('A')])
    const scheduler = new DashboardScheduler(engine, store, { now: () => Date.now() })
    await scheduler.start()
    const paused = await scheduler.updateSettings({ slackSync: { enabled: false } })
    expect(paused.nextRunAt).toBeNull()
    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    expect(syncAll).not.toHaveBeenCalled()
    scheduler.stop()
  })

  it('applies a new interval immediately', async () => {
    const store = new FakeStore({
      lastRunAt: {
        'slack-sync': T0.toISOString(),
        'agent-analysis': null,
        'daily-recheck': null
      }
    })
    const { engine, syncAll } = engineWith([snapshot('A')])
    const scheduler = new DashboardScheduler(engine, store, { now: () => Date.now() })
    await scheduler.start()
    const state = await scheduler.updateSettings({ slackSync: { intervalMinutes: 1 } })
    expect(state.nextRunAt).toBe(new Date(T0.getTime() + MINUTE).toISOString())
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(syncAll).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('logs agent analysis only when a sync found new messages', async () => {
    const quiet = engineWith([snapshot('A', 0)])
    const quietStore = new FakeStore()
    const quietScheduler = new DashboardScheduler(quiet.engine, quietStore, {
      now: () => Date.now()
    })
    await quietScheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(quietStore.data.runs.map((run) => run.kind)).toEqual(['slack-sync'])
    quietScheduler.stop()

    const noisy = engineWith([snapshot('A', 4), snapshot('B', 2)])
    const noisyStore = new FakeStore()
    const noisyScheduler = new DashboardScheduler(noisy.engine, noisyStore, {
      now: () => Date.now()
    })
    await noisyScheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    const agent = noisyStore.data.runs.find((run) => run.kind === 'agent-analysis')
    expect(agent).toMatchObject({ status: 'ok', newMessages: 6 })
    expect(agent?.detail).toContain('6 new messages')
    noisyScheduler.stop()
  })

  it('records per-source failures without losing the successful side', async () => {
    const failed: DashboardProjectSnapshot = {
      ...snapshot('A'),
      ourWorkspaceError: 'our token expired'
    }
    const store = new FakeStore()
    const { engine } = engineWith([failed])
    const scheduler = new DashboardScheduler(engine, store, { now: () => Date.now() })
    await scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    const run = store.data.runs[0]
    expect(run.sources).toEqual([
      { source: 'client', ok: true, error: null },
      { source: 'ours', ok: false, error: 'our token expired' }
    ])
    scheduler.stop()
  })

  it('records a failed run and keeps scheduling', async () => {
    const store = new FakeStore()
    const syncAll = vi.fn(async () => {
      throw new Error('network down')
    })
    const scheduler = new DashboardScheduler({ syncAll } as unknown as DashboardSyncEngine, store, {
      now: () => Date.now()
    })
    await scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.data.runs[0]).toMatchObject({ status: 'error' })
    expect(store.data.runs[0].detail).toContain('network down')
    const state = await scheduler.getState()
    expect(state.nextRunAt).not.toBeNull()
    scheduler.stop()
  })

  it('runs "Run now" manually and resets the cadence', async () => {
    const store = new FakeStore({
      lastRunAt: {
        'slack-sync': T0.toISOString(),
        'agent-analysis': null,
        'daily-recheck': null
      }
    })
    const { engine, syncAll } = engineWith([snapshot('A')])
    const scheduler = new DashboardScheduler(engine, store, { now: () => Date.now() })
    await scheduler.start()
    const state = await scheduler.runNow('slack-sync')
    expect(syncAll).toHaveBeenCalledTimes(1)
    expect(store.data.runs[0].detail).toContain('Manual run')
    expect(state.nextRunAt).toBe(new Date(T0.getTime() + 5 * MINUTE).toISOString())
    scheduler.stop()
  })

  it('scrapes each due browser source on its own cadence', async () => {
    const source = {
      id: 'src-1',
      kind: 'browser' as const,
      name: 'Acme',
      workspaceId: 'T1',
      workspaceName: 'Acme',
      profileId: 'prof-1',
      enabled: true,
      scheduleEnabled: true,
      scheduleIntervalMinutes: 5 as const,
      channels: []
    }
    const project = {
      id: 'proj-1',
      name: 'Project 1',
      sources: [source]
    } as unknown as DashboardProject
    const syncProjectSource = vi.fn(async () => ({ status: 'success' as const }))
    const engine = {
      syncAll: vi.fn(async () => []),
      syncProjectSource,
      isSourceRunning: vi.fn(() => false)
    } as unknown as DashboardSyncEngine
    const store = new FakeStore()
    const scheduler = new DashboardScheduler(engine, store, {
      now: () => Date.now(),
      listProjects: async () => [project]
    })

    await scheduler.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(syncProjectSource).toHaveBeenCalledWith('proj-1', 'src-1', {
      trigger: 'scheduled'
    })
    expect(store.data.sourceLastRunAt?.['src-1']).toBe(T0.toISOString())

    const state = await scheduler.getState()
    expect(state.sources).toHaveLength(1)
    expect(state.sources?.[0]).toMatchObject({
      projectId: 'proj-1',
      projectName: 'Project 1',
      sourceId: 'src-1',
      workspaceName: 'Acme',
      scheduleEnabled: true,
      intervalMinutes: 5
    })

    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(syncProjectSource.mock.calls.length).toBeGreaterThanOrEqual(2)
    scheduler.stop()
  })

  it('triggers incremental scraping every 5 minutes and records runs with metrics', async () => {
    let mockNow = 1793880000000
    const source = {
      id: 'src-test-5min',
      kind: 'browser',
      workspaceId: 'T1',
      workspaceName: 'AgentWork',
      profileId: 'prof-1',
      enabled: true,
      scheduleEnabled: true,
      scheduleIntervalMinutes: 5 as const,
      channels: []
    }
    const project = {
      id: 'proj-1',
      name: 'Ashutosh-Project-01',
      sources: [source]
    } as unknown as DashboardProject

    let callCount = 0
    const syncProjectSource = vi.fn(async () => {
      callCount++
      return {
        runId: `run-call-${callCount}`,
        channelsRead: 1,
        newMessages: callCount === 1 ? 5 : 0,
        status: 'success' as const
      }
    })

    const engine = {
      syncAll: vi.fn(async () => []),
      syncProjectSource,
      isSourceRunning: vi.fn(() => false)
    } as unknown as DashboardSyncEngine
    const store = new FakeStore({
      settings: {
        slackSync: { enabled: false, intervalMinutes: 5 },
        dailyRecheck: { enabled: false, hour: 9 }
      }
    })
    const scheduler = new DashboardScheduler(engine, store, {
      now: () => mockNow,
      listProjects: async () => [project]
    })

    await scheduler.start()
    // Initial immediate tick at t=0
    await vi.advanceTimersByTimeAsync(0)
    expect(syncProjectSource).toHaveBeenCalledTimes(1)
    expect(store.data.runs).toHaveLength(2) // 1 slack-sync + 1 agent-analysis (newMessages: 5)
    expect(store.data.runs[1]).toMatchObject({
      kind: 'slack-sync',
      status: 'ok',
      newMessages: 5
    })
    expect(store.data.runs[0]).toMatchObject({
      kind: 'agent-analysis',
      status: 'ok',
      newMessages: 5
    })

    // Advance 4 minutes (not due yet)
    mockNow += 4 * 60_000
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(syncProjectSource).toHaveBeenCalledTimes(1)

    // Advance 1 more minute (total 5 minutes -> due)
    mockNow += 1 * 60_000
    await vi.advanceTimersByTimeAsync(1 * 60_000)
    expect(syncProjectSource).toHaveBeenCalledTimes(2)

    // Advance another 5 minutes (total 10 minutes -> due again)
    mockNow += 5 * 60_000
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(syncProjectSource).toHaveBeenCalledTimes(3)

    scheduler.stop()
  })

  it('skips paused sources and leaves their last-run stamp alone', async () => {
    const project = {
      id: 'proj-1',
      name: 'Project 1',
      sources: [
        {
          id: 'src-paused',
          kind: 'browser',
          workspaceId: 'T1',
          profileId: 'prof-1',
          enabled: true,
          scheduleEnabled: false,
          scheduleIntervalMinutes: 5,
          channels: []
        }
      ]
    } as unknown as DashboardProject
    const syncProjectSource = vi.fn(async () => ({ status: 'success' as const }))
    const engine = {
      syncAll: vi.fn(async () => []),
      syncProjectSource,
      isSourceRunning: vi.fn(() => false)
    } as unknown as DashboardSyncEngine
    const store = new FakeStore()
    const scheduler = new DashboardScheduler(engine, store, {
      now: () => Date.now(),
      listProjects: async () => [project]
    })

    await scheduler.start()
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    expect(syncProjectSource).not.toHaveBeenCalled()
    expect(store.data.sourceLastRunAt?.['src-paused']).toBeUndefined()
    scheduler.stop()
  })

  it('keeps the daily re-check off by default and runs it at the chosen hour', async () => {
    const runDailyRecheck = vi.fn(async () => ({ checked: 2, skipped: 0 }))
    const store = new FakeStore({
      lastRunAt: {
        'slack-sync': T0.toISOString(),
        'agent-analysis': null,
        'daily-recheck': null
      }
    })
    const { engine } = engineWith([])
    const scheduler = new DashboardScheduler(engine, store, {
      now: () => Date.now(),
      runDailyRecheck
    })
    await scheduler.start()
    expect((await scheduler.getState()).nextDailyRunAt).toBeNull()

    const enabled = await scheduler.updateSettings({ dailyRecheck: { enabled: true, hour: 12 } })
    expect(enabled.nextDailyRunAt).toBe(new Date(2026, 9, 25, 12, 0, 0, 0).toISOString())

    await vi.advanceTimersByTimeAsync(2 * 60 * MINUTE)
    expect(runDailyRecheck).toHaveBeenCalledTimes(1)
    const dailyRun = store.data.runs.find((run) => run.kind === 'daily-recheck')
    expect(dailyRun).toMatchObject({ kind: 'daily-recheck', status: 'ok' })
    scheduler.stop()
  })

  it('triggers startup catch-up when a browser source is overdue on boot', async () => {
    const T_LAST = new Date(T0.getTime() - 20 * 60_000) // 20m ago (overdue for 5m interval)
    const source = {
      id: 'src-overdue',
      kind: 'browser' as const,
      workspaceId: 'T1',
      workspaceName: 'Acme',
      profileId: 'prof-1',
      enabled: true,
      scheduleEnabled: true,
      scheduleIntervalMinutes: 5 as const,
      channels: []
    }
    const project = {
      id: 'proj-1',
      name: 'Project 1',
      sources: [source]
    } as unknown as DashboardProject

    const syncProjectSource = vi.fn(async () => ({ status: 'success' as const }))
    const engine = {
      syncAll: vi.fn(async () => []),
      syncProjectSource,
      isSourceRunning: vi.fn(() => false)
    } as unknown as DashboardSyncEngine
    const store = new FakeStore({
      sourceLastRunAt: {
        'src-overdue': T_LAST.toISOString()
      }
    })
    const scheduler = new DashboardScheduler(engine, store, {
      now: () => T0.getTime(),
      listProjects: async () => [project]
    })

    await scheduler.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(syncProjectSource).toHaveBeenCalledWith('proj-1', 'src-overdue', {
      trigger: 'startup'
    })
    scheduler.stop()
  })

  it('auto-enables Direct API sources with rapid 20-second interval by default', async () => {
    let mockNow = T0.getTime()
    const project = {
      id: 'proj-rapid',
      name: 'Project Rapid',
      sources: [
        {
          id: 'src-direct',
          kind: 'browser',
          engineMode: 'direct_api',
          workspaceId: 'T1',
          profileId: 'prof-1',
          enabled: true,
          // scheduleEnabled and scheduleIntervalMinutes omitted - should auto-enable with 0.333m (20s)
          channels: []
        }
      ]
    } as unknown as DashboardProject

    const syncProjectSource = vi.fn(async () => ({ status: 'success' as const }))
    const engine = {
      syncAll: vi.fn(async () => []),
      syncProjectSource,
      isSourceRunning: vi.fn(() => false)
    } as unknown as DashboardSyncEngine
    const store = new FakeStore()
    const scheduler = new DashboardScheduler(engine, store, {
      now: () => mockNow,
      listProjects: async () => [project]
    })

    await scheduler.start()
    // Initial immediate tick at t=0
    await vi.advanceTimersByTimeAsync(0)
    expect(syncProjectSource).toHaveBeenCalledTimes(1)

    // Advance 10 seconds (not due yet: interval is 20s)
    mockNow += 10_000
    await vi.advanceTimersByTimeAsync(10_000)
    expect(syncProjectSource).toHaveBeenCalledTimes(1)

    // Advance 10 more seconds (total 20s -> due)
    mockNow += 10_000
    await vi.advanceTimersByTimeAsync(10_000)
    expect(syncProjectSource).toHaveBeenCalledTimes(2)

    scheduler.stop()
  })

  it('broadcasts snapshot over IPC when background source sync completes', async () => {
    const project = {
      id: 'proj-broadcast',
      name: 'Project Broadcast',
      sources: [
        {
          id: 'src-broadcast',
          kind: 'browser',
          engineMode: 'direct_api',
          workspaceId: 'T1',
          profileId: 'prof-1',
          enabled: true,
          scheduleEnabled: true,
          scheduleIntervalMinutes: 0.333,
          channels: []
        }
      ]
    } as unknown as DashboardProject

    const broadcastSnapshot = vi.fn(async () => {})
    const syncProjectSource = vi.fn(async () => ({
      status: 'success' as const,
      newMessages: 2,
      channelsRead: 1
    }))
    const engine = {
      syncAll: vi.fn(async () => []),
      syncProjectSource,
      isSourceRunning: vi.fn(() => false)
    } as unknown as DashboardSyncEngine
    const store = new FakeStore()
    const scheduler = new DashboardScheduler(engine, store, {
      now: () => T0.getTime(),
      listProjects: async () => [project],
      broadcastSnapshot
    })

    await scheduler.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(syncProjectSource).toHaveBeenCalledTimes(1)
    expect(broadcastSnapshot).toHaveBeenCalledWith('proj-broadcast')

    scheduler.stop()
  })

  it('respects 15-second (0.25m) interval for rapid background polling', async () => {
    let mockNow = T0.getTime()
    const project = {
      id: 'proj-15s',
      name: 'Project 15s',
      sources: [
        {
          id: 'src-15s',
          kind: 'browser',
          engineMode: 'direct_api',
          workspaceId: 'T1',
          profileId: 'prof-1',
          enabled: true,
          scheduleEnabled: true,
          scheduleIntervalMinutes: 0.25, // 15 seconds
          channels: []
        }
      ]
    } as unknown as DashboardProject

    const syncProjectSource = vi.fn(async () => ({ status: 'success' as const }))
    const engine = {
      syncAll: vi.fn(async () => []),
      syncProjectSource,
      isSourceRunning: vi.fn(() => false)
    } as unknown as DashboardSyncEngine
    const store = new FakeStore()
    const scheduler = new DashboardScheduler(engine, store, {
      now: () => mockNow,
      listProjects: async () => [project]
    })

    await scheduler.start()
    // Initial immediate tick at t=0
    await vi.advanceTimersByTimeAsync(0)
    expect(syncProjectSource).toHaveBeenCalledTimes(1)

    // Advance 10 seconds (not due yet: interval is 15s)
    mockNow += 10_000
    await vi.advanceTimersByTimeAsync(10_000)
    expect(syncProjectSource).toHaveBeenCalledTimes(1)

    // Advance 5 more seconds (total 15s -> due)
    mockNow += 5_000
    await vi.advanceTimersByTimeAsync(5_000)
    expect(syncProjectSource).toHaveBeenCalledTimes(2)

    scheduler.stop()
  })
})
