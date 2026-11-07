const fakeVault = { encrypt: (p: string) => Buffer.from(p).toString('base64'), decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8') }
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { DashboardSyncEngine } from '../../src/main/dashboard/sync-engine'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import type { DashboardProject } from '../../src/shared/dashboard-contract'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true }).catch(() => {})))
  dirs.length = 0
})

function fakeProject(overrides: Partial<DashboardProject> = {}): DashboardProject {
  return {
    id: 'proj_x',
    name: 'Acme site',
    clientName: 'Bob',
    profileId: 'pf1',
    teamId: 'tt',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [{ channelId: 'chanone', channelName: 'acme-dev' }],
    createdAt: new Date().toISOString(),
    ...overrides
  }
}

type TokenLookup = (profileId: string, teamId: string) => Promise<string | null>

function makeEngine(
  monitors: MonitorStore,
  delta: DashboardDeltaStore,
  tokens: TokenLookup
): DashboardSyncEngine {
  return new DashboardSyncEngine({
    monitorStore: monitors,
    deltaStore: delta,
    oauthTokenProvider: { tryGet: (p, t) => tokens(p, t) },
    pollerFactory: () => ({
      fetchHistory: async ({ channelId, afterTs }: { channelId: string; afterTs?: string }) => ({
        messages:
          channelId === 'chanone'
            ? afterTs
              ? []
              : [
                  { ts: '100.0', user: 'U1', text: 'kickoff notes' },
                  { ts: '200.0', user: 'U2', text: 'deadline is on Nov 12' },
                  { ts: '300.0', user: 'U1', text: 'thanks, great work! 🎉' }
                ]
            : [{ ts: '50.0', user: 'U3', text: 'other channel msg' }],
        hasMore: false
      })
    })
  })
}

async function stores(): Promise<{ monitors: MonitorStore; delta: DashboardDeltaStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-sync-'))
  dirs.push(dir)
  const monitors = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
  const delta = new DashboardDeltaStore({ rootDir: dir })
  return { monitors, delta }
}

describe('DashboardSyncEngine', () => {
  it('syncs a project and builds a snapshot', async () => {
    const { monitors, delta } = await stores()
    await monitors.upsertProject({ project: fakeProject() })
    const engine = makeEngine(monitors, delta, async () => 'xoxp-oauth')
    const snapshot = await engine.syncProject('proj_x')
    expect(snapshot).not.toBeNull()
    expect(snapshot?.project.name).toBe('Acme site')
    expect(snapshot?.totalMessageCount).toBe(3)
    expect(snapshot?.completion).toBeGreaterThan(0)
    expect(snapshot?.mood.state).toBe('good')
    expect(snapshot?.effectiveDates.endDate).toBe('2026-11-12')

    // cursor dedupe: second sync is a no-op on message counts
    const again = await engine.syncProject('proj_x')
    expect(again?.totalMessageCount).toBe(3)
    expect(again?.perChannel[0].messageCount).toBe(3)
  })

  it('uses manual token when configured, and errors surface on syncState', async () => {
    const { monitors, delta } = await stores()
    await monitors.saveManualToken('DASH_TOKEN_ACME', 'xoxp-manual')
    await monitors.upsertProject({
      project: fakeProject({ tokenSource: 'manual', manualTokenKey: 'DASH_TOKEN_ACME' })
    })
    const seenTokens: string[] = []
    const engine = new DashboardSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => 'xoxp-oauth' },
      manualTokenProvider: monitors,
      pollerFactory: () => ({
        fetchHistory: async function (args: { token?: string }) {
          if (args?.token) seenTokens.push(args.token)
          return { messages: [], hasMore: false }
        }
      })
    })
    const snap = await engine.syncProject('proj_x')
    expect(seenTokens[0]).toBe('xoxp-manual')
    expect(snap?.syncState).toBe('idle')
  })

  it('missing token → error snapshot, no throw', async () => {
    const { monitors, delta } = await stores()
    await monitors.upsertProject({ project: fakeProject() })
    const engine = makeEngine(monitors, delta, async () => null)
    const snap = await engine.syncProject('proj_x')
    expect(snap?.syncState).toBe('error')
  })

  it('syncAll syncs every project and reports snapshots for all', async () => {
    const { monitors, delta } = await stores()
    await monitors.upsertProject({ project: fakeProject({ id: 'p1' }) })
    await monitors.upsertProject({ project: fakeProject({ id: 'p2', profileId: 'pf2' }) })
    const engine = makeEngine(monitors, delta, async () => 'xoxp')
    const all = await engine.syncAll()
    expect(all).toHaveLength(2)
    expect(all.every((s) => s.syncState === 'idle')).toBe(true)
  })

  it('dispatches autonomous auto-reply when new messages arrive on autoReply channel', async () => {
    const { monitors, delta } = await stores()
    const proj = fakeProject({
      monitors: [{ channelId: 'C_DM', channelName: '@Ankita Manna' }],
      sources: [
        {
          id: 'src_1',
          kind: 'browser',
          platform: 'slack',
          profileId: 'pf1',
          workspaceId: 'tt',
          workspaceName: 'Acme',
          role: 'client',
          backfillDays: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          enabled: true,
          channels: [
            {
              id: 'C_DM',
              name: '@Ankita Manna',
              isDm: true,
              enabled: true,
              autoReply: true
            }
          ]
        }
      ]
    })
    await monitors.upsertProject({ project: proj })

    const sendMessageMock = vi.fn().mockResolvedValue({ ok: true })
    const chatServiceMock = {
      invalidateActivityCache: vi.fn(),
      sendMessage: sendMessageMock
    }

    const engine = new DashboardSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      chatService: chatServiceMock,
      oauthTokenProvider: { tryGet: async () => 'xoxp' },
      pollerFactory: () => ({
        fetchHistory: async () => ({
          messages: [{ ts: '1793970000.001', user: 'Ankita', text: 'Hello, are you there?' }],
          hasMore: false
        })
      })
    })

    const snapshot = await engine.syncProject('proj_x')
    expect(snapshot).not.toBeNull()
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj_x',
        channelId: 'C_DM',
        isAgent: true,
        text: expect.stringContaining('Hi @Ankita! I received your message.')
      })
    )
  })
})
