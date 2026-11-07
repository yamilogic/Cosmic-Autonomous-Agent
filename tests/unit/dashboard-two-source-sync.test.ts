const fakeVault = { encrypt: (p: string) => Buffer.from(p).toString('base64'), decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8') }
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { DashboardSyncEngine } from '../../src/main/dashboard/sync-engine'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

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
    profileId: 'pf_client',
    teamId: 'T_CLIENT',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [{ channelId: 'C_CLIENT', channelName: 'client-dev' }],
    createdAt: new Date().toISOString(),
    ...overrides
  }
}

const TEAM_CHANNELS = [{ channelId: 'C_TEAM', channelName: 'team-project' }]

function teamReader(overrides: Partial<{ token: string | null; channels: typeof TEAM_CHANNELS }> = {}) {
  return {
    getConnection: async () => ({
      profileId: 'pf_team',
      teamId: 'T_TEAM',
      token: overrides.token === undefined ? 'xoxp-team' : overrides.token,
      channels: overrides.channels ?? TEAM_CHANNELS
    })
  }
}

function poller(failChannels: string[] = []): {
  fetchHistory: (input: { channelId: string; afterTs?: string }) => Promise<{
    messages: Array<{ ts: string; user: string; text: string }>
    hasMore: boolean
  }>
} {
  return {
    fetchHistory: async ({ channelId, afterTs }) => {
      if (failChannels.includes(channelId)) throw new Error(`slack down for ${channelId}`)
      const all =
        channelId === 'C_CLIENT'
          ? [
              { ts: '100.0', user: 'U_C1', text: 'client kickoff' },
              { ts: '200.0', user: 'U_C2', text: 'client deadline Nov 12' }
            ]
          : [
              { ts: '150.0', user: 'U_T1', text: 'team standup' },
              { ts: '160.0', user: 'U_T2', text: 'team blocker' },
              { ts: '170.0', user: 'U_T3', text: 'team decision' }
            ]
      return { messages: afterTs ? [] : all, hasMore: false }
    }
  }
}

async function setup(): Promise<{
  monitors: MonitorStore
  delta: DashboardDeltaStore
}> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-two-'))
  dirs.push(dir)
  const monitors = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
  const delta = new DashboardDeltaStore({ rootDir: dir })
  await monitors.upsertProject({ project: fakeProject() })
  return { monitors, delta }
}

function engineWith(
  monitors: MonitorStore,
  delta: DashboardDeltaStore,
  team: ReturnType<typeof teamReader> | undefined,
  failChannels: string[] = []
): DashboardSyncEngine {
  return new DashboardSyncEngine({
    monitorStore: monitors,
    deltaStore: delta,
    oauthTokenProvider: { tryGet: async () => 'xoxp-client' },
    teamWorkspace: team,
    pollerFactory: () => poller(failChannels)
  })
}

describe('DashboardSyncEngine — two sources', () => {
  it('syncs the client workspace and our team workspace into one snapshot', async () => {
    const { monitors, delta } = await setup()
    const snapshot = await engineWith(monitors, delta, teamReader()).syncProject('proj_x')

    expect(snapshot?.syncState).toBe('idle')
    expect(snapshot?.ourWorkspaceError).toBeNull()
    expect(snapshot?.totalMessageCount).toBe(5)
    expect(snapshot?.perChannel).toHaveLength(2)
    expect(snapshot?.perChannel.map((c) => c.source).sort()).toEqual(['client', 'ours'])
    expect(snapshot?.perChannel.find((c) => c.channelId === 'C_TEAM')?.messageCount).toBe(3)
  })

  it('tags every stored message with its workspace, so the panels cannot mix them', async () => {
    const { monitors, delta } = await setup()
    await engineWith(monitors, delta, teamReader()).syncProject('proj_x')

    const client = await delta.messagesSince('pf_client', 'T_CLIENT', 'C_CLIENT')
    const ours = await delta.messagesSince('pf_team', 'T_TEAM', 'C_TEAM')
    expect(client.every((m) => m.source === 'client')).toBe(true)
    expect(ours.every((m) => m.source === 'ours')).toBe(true)
    expect(client.map((m) => m.ts)).not.toContain('150.0')
  })

  it('keeps the client sync when our workspace fails, and records the failure', async () => {
    const { monitors, delta } = await setup()
    const snapshot = await engineWith(monitors, delta, teamReader(), ['C_TEAM']).syncProject(
      'proj_x'
    )

    expect(snapshot?.syncState).toBe('idle')
    expect(snapshot?.ourWorkspaceError).toMatch(/slack down for C_TEAM/)
    expect(snapshot?.totalMessageCount).toBe(2)
    expect(snapshot?.perChannel.map((c) => c.channelId)).toEqual(['C_CLIENT'])
    expect(await delta.messagesSince('pf_team', 'T_TEAM', 'C_TEAM')).toEqual([])
  })

  it('does not call Slack for our workspace when no token resolved', async () => {
    const { monitors, delta } = await setup()
    const seen: string[] = []
    const engine = new DashboardSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => 'xoxp-client' },
      teamWorkspace: teamReader({ token: null }),
      pollerFactory: () => ({
        fetchHistory: async ({ token, channelId }) => {
          seen.push(`${token}:${channelId}`)
          return { messages: [], hasMore: false }
        }
      })
    })

    const snapshot = await engine.syncProject('proj_x')
    expect(seen).toEqual(['xoxp-client:C_CLIENT'])
    expect(snapshot?.ourWorkspaceError).toMatch(/no usable token/i)
  })

  it('survives a broken team reader without failing the card', async () => {
    const { monitors, delta } = await setup()
    const engine = engineWith(monitors, delta, {
      getConnection: async () => {
        throw new Error('team-workspace.json is unreadable')
      }
    })

    const snapshot = await engine.syncProject('proj_x')
    expect(snapshot?.syncState).toBe('idle')
    expect(snapshot?.ourWorkspaceError).toMatch(/unreadable/)
    expect(snapshot?.totalMessageCount).toBe(2)
  })

  it('behaves exactly as before when no team workspace is configured', async () => {
    const { monitors, delta } = await setup()
    const snapshot = await engineWith(monitors, delta, undefined).syncProject('proj_x')

    expect(snapshot?.ourWorkspaceError).toBeNull()
    expect(snapshot?.perChannel).toHaveLength(1)
    expect(snapshot?.perChannel[0].source).toBe('client')
  })

  it('includes our workspace in cold reads (buildSnapshot) without a new sync', async () => {
    const { monitors, delta } = await setup()
    const engine = engineWith(monitors, delta, teamReader())
    await engine.syncProject('proj_x')

    const snapshots = await engine.buildSnapshot('proj_x')
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].perChannel).toHaveLength(2)
    expect(snapshots[0].totalMessageCount).toBe(5)
  })
})
