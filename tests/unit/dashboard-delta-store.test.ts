import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'

const dirs: string[] = []

async function tmpStore(): Promise<DashboardDeltaStore> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-delta-'))
  dirs.push(dir)
  return new DashboardDeltaStore({ rootDir: dir })
}

const msg = (ts: string, text = 'hello'): { ts: string; user: string; text: string } => ({
  ts,
  user: 'U1',
  text
})

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true }).catch(() => {})))
  dirs.length = 0
})

describe('DashboardDeltaStore', () => {
  it('appends messages and returns cursor + counts', async () => {
    const store = await tmpStore()
    const res = await store.appendMessages({
      profileId: 'p1',
      teamId: 't1',
      channelId: 'c1',
      channelName: 'acme-dev',
      messages: [msg('100.0'), msg('200.0', 'second')]
    })
    expect(res.added).toBe(2)
    expect(res.cursor).toBe('200.0')
    const delta = await store.load('p1', 't1', 'c1')
    expect(delta?.channel.name).toBe('acme-dev')
    expect(delta?.messages).toHaveLength(2)
  })

  it('dedupes by ts and keeps ascending order', async () => {
    const store = await tmpStore()
    await store.appendMessages({
      profileId: 'p',
      teamId: 't',
      channelId: 'c',
      channelName: 'x',
      messages: [msg('300.0', 'newer'), msg('100.0', 'older')]
    })
    const res = await store.appendMessages({
      profileId: 'p',
      teamId: 't',
      channelId: 'c',
      channelName: 'x',
      messages: [msg('100.0'), msg('200.0', 'mid')]
    })
    expect(res.added).toBe(1)
    const delta = await store.load('p', 't', 'c')
    expect(delta?.messages.map((m) => m.ts)).toEqual(['100.0', '200.0', '300.0'])
    expect(delta?.cursor).toBe('300.0')
  })

  it('tracks lastSyncAt and per-channel netNewCounts', async () => {
    const store = await tmpStore()
    await store.appendMessages({
      profileId: 'p',
      teamId: 't',
      channelId: 'c',
      channelName: 'x',
      messages: [msg('100.0')]
    })
    const net = await store.getNetNewSinceCursor('p', 't', 'c', '100.0')
    expect(net.count).toBe(0)
    const snapshot = await store.readSnapshotMeta('p', 't', 'c1_notexist')
    expect(snapshot).toBeNull()
  })

  it('roundtrips a persisted file', async () => {
    const store = await tmpStore()
    await store.appendMessages({
      profileId: 'pp',
      teamId: 'tt',
      channelId: 'cc',
      channelName: 'chan',
      messages: [msg('42.0', 'persisted')]
    })
    const raw = await readFile(join(store.rootDir, 'channels', 'pp', 'tt', 'cc.json'), 'utf8')
    expect(JSON.parse(raw).messages[0].ts).toBe('42.0')
  })

  it('lists all stored channel deltas for a profile', async () => {
    const store = await tmpStore()
    await store.appendMessages({
      profileId: 'px',
      teamId: 't1',
      channelId: 'ca',
      channelName: 'a',
      messages: [msg('1.0')]
    })
    await store.appendMessages({
      profileId: 'px',
      teamId: 't2',
      channelId: 'cb',
      channelName: 'b',
      messages: [msg('2.0')]
    })
    const all = await store.listForProfile('px')
    expect(all.map((d) => d.channel.id)).toEqual(['ca', 'cb'])
  })
})
