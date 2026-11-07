import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { DashboardSyncEngine } from '../../src/main/dashboard/sync-engine'
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

function card(id: string, profileId: string): DashboardProject {
  return {
    id,
    name: `Card ${id}`,
    clientName: 'Bob',
    profileId,
    teamId: 'T1',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [{ channelId: 'C_SHARED', channelName: 'shared-dev' }],
    createdAt: new Date().toISOString()
  }
}

describe('syncAll cycle history memo', () => {
  it('fetches one channel page once when two cards watch the same channel', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dash-memo-'))
    dirs.push(dir)
    const monitors = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    const delta = new DashboardDeltaStore({ rootDir: dir })
    await monitors.upsertProject({ project: card('p1', 'pf1') })
    await monitors.upsertProject({ project: card('p2', 'pf2') })

    const fetchHistory = vi.fn(async () => ({
      messages: [{ ts: '100.0', user: 'U1', text: 'shared page' }],
      hasMore: false
    }))
    const engine = new DashboardSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      // both cards resolve the SAME token — the memo key is the token identity
      oauthTokenProvider: { tryGet: async () => 'xoxp-shared' },
      pollerFactory: () => ({ fetchHistory })
    })

    const all = await engine.syncAll()
    expect(fetchHistory).toHaveBeenCalledTimes(1)
    expect(all).toHaveLength(2)
    for (const snap of all) {
      expect(snap.syncState).toBe('idle')
      expect(snap.totalMessageCount).toBe(1)
      expect(snap.perChannel[0]?.channelId).toBe('C_SHARED')
    }

    // Per-cycle only: the next cycle re-fetches with the moved cursor.
    await engine.syncAll()
    expect(fetchHistory).toHaveBeenCalledTimes(2)
  })

  it('keeps separate fetches when the two cards watch different channels', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dash-memo-'))
    dirs.push(dir)
    const monitors = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    const delta = new DashboardDeltaStore({ rootDir: dir })
    await monitors.upsertProject({ project: card('p1', 'pf1') })
    await monitors.upsertProject({
      project: {
        ...card('p2', 'pf2'),
        monitors: [{ channelId: 'C_OTHER', channelName: 'other-dev' }]
      }
    })
    const fetchHistory = vi.fn(async () => ({ messages: [], hasMore: false }))
    const engine = new DashboardSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => 'xoxp-shared' },
      pollerFactory: () => ({ fetchHistory })
    })
    await engine.syncAll()
    expect(fetchHistory).toHaveBeenCalledTimes(2)
  })
})
