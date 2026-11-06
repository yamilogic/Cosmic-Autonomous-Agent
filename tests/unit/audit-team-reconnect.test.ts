import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { DashboardSyncEngine, type TeamWorkspaceReader } from '../../src/main/dashboard/sync-engine'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

const fakeVault = {
  encrypt: (p: string) => Buffer.from(p).toString('base64'),
  decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8')
}

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true }).catch(() => {})))
  dirs.length = 0
})

function slackError(error: string): Error {
  return Object.assign(new Error(`slack conversations.history: ${error}`), { slackError: error })
}

type TeamMode = 'ok' | 'auth-fail' | 'network-fail'

async function setup(mode: TeamMode): Promise<{
  delta: DashboardDeltaStore
  engine: DashboardSyncEngine
  writes: Array<{ status: string; atIso?: string }>
  mode: { current: TeamMode }
}> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-reconnect-'))
  dirs.push(dir)
  const monitors = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
  const delta = new DashboardDeltaStore({ rootDir: dir })
  const project: DashboardProject = {
    id: 'p1',
    name: 'Acme site',
    clientName: 'Bob',
    profileId: 'pf1',
    teamId: 'T1',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [{ channelId: 'C_CLIENT', channelName: 'client-dev' }],
    createdAt: new Date().toISOString()
  }
  await monitors.upsertProject({ project })
  // Stored team insight from an earlier cycle — an auth failure must not lose it.
  await delta.appendMessages({
    profileId: 'team_pf',
    teamId: 'T_TEAM',
    channelId: 'C_TEAM',
    channelName: 'team-ops',
    source: 'ours',
    messages: [{ ts: '90.0', user: 'U9', text: 'keep me' }]
  })

  const writes: Array<{ status: string; atIso?: string }> = []
  const teamState = { status: 'connected' as 'connected' | 'needs-reconnect' }
  const team: TeamWorkspaceReader = {
    getConnection: async () => ({
      profileId: 'team_pf',
      teamId: 'T_TEAM',
      token: 'xoxb-team',
      channels: [{ channelId: 'C_TEAM', channelName: 'team-ops' }],
      status: teamState.status
    }),
    setStatus: async (status, atIso) => {
      teamState.status = status
      writes.push({ status, atIso })
    }
  }
  const current = { current: mode }
  const engine = new DashboardSyncEngine({
    monitorStore: monitors,
    deltaStore: delta,
    oauthTokenProvider: { tryGet: async () => 'xoxp-client' },
    teamWorkspace: team,
    pollerFactory: () => ({
      fetchHistory: async ({ channelId }) => {
        if (channelId === 'C_CLIENT') {
          return { messages: [{ ts: '80.0', user: 'U1', text: 'client msg' }], hasMore: false }
        }
        if (current.current === 'auth-fail') throw slackError('account_inactive')
        if (current.current === 'network-fail') {
          throw new Error('slack conversations.history: fetch failed')
        }
        return { messages: [{ ts: '95.0', user: 'U5', text: 'team reply' }], hasMore: false }
      }
    })
  })
  return { delta, engine, writes, mode: current }
}

describe('team workspace reconnect status', () => {
  it('flips to needs-reconnect on a Slack auth failure and keeps stored data', async () => {
    const { delta, engine, writes } = await setup('auth-fail')
    const [snap] = await engine.syncAll()
    expect(writes).toHaveLength(1)
    expect(writes[0].status).toBe('needs-reconnect')
    expect(typeof writes[0].atIso).toBe('string')
    expect(Date.parse(String(writes[0].atIso))).not.toBeNaN()
    expect(snap?.ourWorkspaceError).toContain('account_inactive')
    // Previous insight/data survives: nothing is cleared on an auth failure.
    const stored = await delta.load('team_pf', 'T_TEAM', 'C_TEAM')
    expect(stored?.messages.map((m) => m.text)).toContain('keep me')
  })

  it('returns to connected on a later successful team poll', async () => {
    const { engine, writes, mode } = await setup('auth-fail')
    await engine.syncAll()
    expect(writes.map((w) => w.status)).toEqual(['needs-reconnect'])
    mode.current = 'ok'
    await engine.syncAll()
    expect(writes.map((w) => w.status)).toEqual(['needs-reconnect', 'connected'])
  })

  it('does not touch the status for a plain network error', async () => {
    const { engine, writes, mode } = await setup('ok')
    await engine.syncAll()
    // a healthy poll of an already-connected workspace writes nothing either
    expect(writes).toHaveLength(0)
    mode.current = 'network-fail'
    await engine.syncAll()
    expect(writes).toHaveLength(0)
  })
})
