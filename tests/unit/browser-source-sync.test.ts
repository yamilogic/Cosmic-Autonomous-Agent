import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { DashboardInsightSyncEngine, DashboardSyncEngine } from '../../src/main/dashboard/sync-engine'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import { HistoryStore } from '../../src/main/dashboard/history-store'
import { InsightEngine } from '../../src/main/dashboard/insight-engine'
import { resolveProjectMessageSources } from '../../src/main/dashboard/message-sources'
import type { DashboardProject, ProjectSource } from '../../src/shared/dashboard-contract'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true }).catch(() => {})))
  dirs.length = 0
})

function browserProject(): DashboardProject {
  const now = new Date().toISOString()
  const source: ProjectSource = {
    id: 'src-browser-1',
    kind: 'browser',
    platform: 'slack',
    profileId: 'prof-browser',
    workspaceId: 'T-BROWSER',
    workspaceName: 'Browser Workspace',
    channels: [
      { id: 'C1', name: 'general', enabled: true, kind: 'public' },
      { id: 'C2', name: 'not-selected', enabled: false, kind: 'public' }
    ],
    role: 'client',
    enabled: true,
    backfillDays: 7,
    createdAt: now,
    updatedAt: now
  }
  return {
    id: 'proj-browser',
    name: 'Browser Card',
    clientName: 'Client',
    profileId: 'prof-browser',
    teamId: 'T-BROWSER',
    teamName: 'Browser Workspace',
    appId: 'slack',
    tokenSource: 'oauth',
    sourcePreference: 'browser_only',
    monitors: [],
    sources: [source],
    createdAt: now
  }
}

async function stores(): Promise<{
  monitors: MonitorStore
  delta: DashboardDeltaStore
  dir: string
}> {
  const dir = await mkdtemp(join(tmpdir(), 'browser-source-sync-'))
  dirs.push(dir)
  return {
    dir,
    monitors: new MonitorStore({ rootDir: dir, encryptionAvailable: false }),
    delta: new DashboardDeltaStore({ rootDir: dir })
  }
}

function engine(monitors: MonitorStore, delta: DashboardDeltaStore): DashboardSyncEngine {
  return new DashboardSyncEngine({
    monitorStore: monitors,
    deltaStore: delta,
    oauthTokenProvider: { tryGet: async () => null },
    pollerFactory: () => ({ fetchHistory: async () => ({ messages: [], hasMore: false }) })
  })
}

function insightEngine(
  monitors: MonitorStore,
  delta: DashboardDeltaStore,
  dir: string
): DashboardInsightSyncEngine {
  const historyStore = new HistoryStore({ rootDir: dir })
  return new DashboardInsightSyncEngine({
    monitorStore: monitors,
    deltaStore: delta,
    oauthTokenProvider: { tryGet: async () => null },
    pollerFactory: () => ({ fetchHistory: async () => ({ messages: [], hasMore: false }) }),
    insightEngine: new InsightEngine({
      provider: null,
      historyStore,
      deltaStore: delta,
      resolveSources: (project) => Promise.resolve(resolveProjectMessageSources(project))
    })
  })
}

describe('browser source read path', () => {
  it('builds a dashboard snapshot from stored browser-source messages without a token', async () => {
    const { monitors, delta } = await stores()
    await monitors.upsertProject({ project: browserProject() })
    await delta.appendMessages({
      profileId: 'prof-browser',
      teamId: 'T-BROWSER',
      channelId: 'C1',
      channelName: 'general',
      source: 'client',
      messages: [
        { ts: '1730000000.000001', user: 'Priya', text: 'Can we ship this?' },
        { ts: '1730000060.000001', user: 'Alex', text: 'Yes, ready.' }
      ]
    })
    await delta.appendMessages({
      profileId: 'prof-browser',
      teamId: 'T-BROWSER',
      channelId: 'C2',
      channelName: 'not-selected',
      source: 'client',
      messages: [{ ts: '1730000120.000001', user: 'Noise', text: 'should stay invisible' }]
    })

    const snapshot = (await engine(monitors, delta).buildSnapshot('proj-browser'))[0]

    expect(snapshot?.totalMessageCount).toBe(2)
    expect(snapshot?.perChannel.map((channel) => channel.channelId)).toEqual(['C1'])
    expect(snapshot?.perChannel[0]?.messageCount).toBe(2)
  })

  it('refreshes the snapshot after a source run so new stored messages are visible', async () => {
    const { monitors, delta } = await stores()
    await monitors.upsertProject({ project: browserProject() })
    const syncEngine = engine(monitors, delta)

    await delta.appendMessages({
      profileId: 'prof-browser',
      teamId: 'T-BROWSER',
      channelId: 'C1',
      channelName: 'general',
      source: 'client',
      messages: [{ ts: '1730000000.000001', user: 'Priya', text: 'first' }]
    })
    const before = (await syncEngine.buildSnapshot('proj-browser'))[0]
    expect(before?.totalMessageCount).toBe(1)

    await delta.appendMessages({
      profileId: 'prof-browser',
      teamId: 'T-BROWSER',
      channelId: 'C1',
      channelName: 'general',
      source: 'client',
      messages: [{ ts: '1730000060.000001', user: 'Priya', text: 'second' }]
    })
    const refreshed = await syncEngine.refreshProjectSnapshot('proj-browser')

    expect(refreshed?.totalMessageCount).toBe(2)
  })

  it('generates a heuristic insight for a browser-only card with no token', async () => {
    const { monitors, delta, dir } = await stores()
    await monitors.upsertProject({ project: browserProject() })
    await delta.appendMessages({
      profileId: 'prof-browser',
      teamId: 'T-BROWSER',
      channelId: 'C1',
      channelName: 'general',
      source: 'client',
      messages: [
        { ts: '1730000000.000001', user: 'Priya', text: 'Can we ship this?' },
        { ts: '1730000060.000001', user: 'Alex', text: 'Yes, ready.' }
      ]
    })

    const snapshot = await insightEngine(monitors, delta, dir).refreshInsightForProject(
      'proj-browser'
    )

    expect(snapshot?.insight).not.toBeNull()
    expect(snapshot?.insightSource).toBe('heuristic')
    expect(snapshot?.totalMessageCount).toBe(2)
  })
})
