import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
const fakeVault = { encrypt: (p: string) => Buffer.from(p).toString('base64'), decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8') }
import type { DashboardProject } from '../../src/shared/dashboard-contract'

const dirs: string[] = []
const project = (id: string, overrides: Record<string, unknown> = {}): DashboardProject => ({
  id,
  name: `Project ${id}`,
  clientName: 'Bob',
  profileId: 'pf1',
  teamId: 't1',
  appId: 'slack' as const,
  tokenSource: 'oauth' as const,
  monitors: [{ channelId: 'c1', channelName: 'acme' }],
  createdAt: new Date().toISOString(),
  ...overrides
})

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true }).catch(() => {})))
  dirs.length = 0
})

async function tmpStore(): Promise<MonitorStore> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-monitor-'))
  dirs.push(dir)
  return new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
}

describe('MonitorStore', () => {
  it('creates, replaces (upsert by id), deletes projects', async () => {
    const store = await tmpStore()
    await store.upsertProject({ project: { ...project('a'), id: '' } })
    let projects = await store.listProjects()
    expect(projects).toHaveLength(1)
    const id = projects[0].id

    await store.upsertProject({ project: { ...project('a'), id, name: 'Renamed' } })
    projects = await store.listProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('Renamed')

    await store.deleteProject(id)
    expect(await store.listProjects()).toHaveLength(0)
  })

  it('stores manual tokens encrypted when os encryption available', async () => {
    const store = await tmpStore()
    const saved = await store.saveManualToken('DASH_TOKEN_ACME', 'xoxp-000')
    expect(saved.plaintext).toBe(false)
    const token = await store.getManualToken('DASH_TOKEN_ACME')
    expect(token).toBe('xoxp-000')
    const listed = await store.listManualTokens()
    expect(listed).toEqual([{ key: 'DASH_TOKEN_ACME', persisted: true }])
  })

  it('blocks token save when OS encryption unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dash-monitor-'))
    dirs.push(dir)
    const store = new MonitorStore({ rootDir: dir, encryptionAvailable: false })
    await expect(store.saveManualToken('K', 'tok')).rejects.toThrow('OS encryption unavailable')
    expect(await store.getManualToken('K')).toBeNull()
  })

  it('persists sync interval override', async () => {
    const store = await tmpStore()
    expect(await store.syncIntervalSeconds()).toBe(300)
    await store.setSyncIntervalSeconds(120)
    expect(await store.syncIntervalSeconds()).toBe(120)
  })

  it('persists pinned order, ignores unknown ids and cleans deleted projects', async () => {
    const store = await tmpStore()
    const a = await store.upsertProject({ project: { ...project('a'), id: '' } })
    const b = await store.upsertProject({ project: { ...project('b'), id: '' } })
    const c = await store.upsertProject({ project: { ...project('c'), id: '' } })
    expect(await store.setPinnedOrder([b.id, 'missing', a.id, b.id])).toEqual([b.id, a.id])
    expect(await store.readPinnedOrder()).toEqual([b.id, a.id])

    await store.deleteProject(a.id)
    expect(await store.readPinnedOrder()).toEqual([b.id])
    expect((await store.listProjects()).map((p) => p.id)).toEqual([b.id, c.id])
  })

  it('unassigns profile from projects without deleting cards', async () => {
    const store = await tmpStore()
    const a = await store.upsertProject({ project: { ...project('a'), id: '', profileId: 'prof-1' } })
    const b = await store.upsertProject({ project: { ...project('b'), id: '', profileId: 'prof-1' } })
    const c = await store.upsertProject({ project: { ...project('c'), id: '', profileId: 'prof-2' } })

    await store.unassignProjectsForProfile('prof-1')

    const list = await store.listProjects()
    expect(list).toHaveLength(3)
    const projA = list.find((p) => p.id === a.id)
    const projB = list.find((p) => p.id === b.id)
    const projC = list.find((p) => p.id === c.id)

    expect(projA?.profileId).toBe('')
    expect(projB?.profileId).toBe('')
    expect(projC?.profileId).toBe('prof-2')
  })

  it('deletes all projects belonging to a profile and cleans pinned order', async () => {
    const store = await tmpStore()
    const a = await store.upsertProject({ project: { ...project('a'), id: '', profileId: 'prof-1' } })
    const b = await store.upsertProject({ project: { ...project('b'), id: '', profileId: 'prof-1' } })
    const c = await store.upsertProject({ project: { ...project('c'), id: '', profileId: 'prof-2' } })
    await store.setPinnedOrder([a.id, b.id, c.id])

    const deleted = await store.deleteProjectsForProfile('prof-1')
    expect(deleted.sort()).toEqual([a.id, b.id].sort())

    const list = await store.listProjects()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(c.id)

    expect(await store.readPinnedOrder()).toEqual([c.id])
  })

  it('allows creating project card under client profile before Slack is linked (pending teamId)', async () => {
    const store = await tmpStore()
    const card = await store.upsertProject({
      project: {
        id: '',
        name: 'Ashutosh-testing-01',
        clientName: 'Client-Test-01',
        profileId: 'profile-ashutosh',
        teamId: '',
        teamName: '',
        appId: 'slack',
        tokenSource: 'oauth',
        monitors: []
      }
    })

    expect(card.id).toBeTruthy()
    expect(card.name).toBe('Ashutosh-testing-01')
    expect(card.teamId).toMatch(/^pending-/)
    expect(card.teamName).toBe('Ashutosh-testing-01')

    const list = await store.listProjects()
    expect(list).toHaveLength(1)
    expect(list[0].teamId).toMatch(/^pending-/)
  })
})
