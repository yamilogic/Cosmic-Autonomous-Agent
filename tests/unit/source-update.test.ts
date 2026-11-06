import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import type { DashboardProject, ProjectSource } from '../../src/shared/dashboard-contract'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true }).catch(() => {})))
  dirs.length = 0
})

function source(id: string): ProjectSource {
  const now = new Date().toISOString()
  return {
    id,
    kind: 'browser',
    platform: 'slack',
    profileId: 'prof-1',
    workspaceId: 'T1',
    workspaceName: 'Acme',
    channels: [],
    role: 'client',
    enabled: true,
    backfillDays: 7,
    scheduleEnabled: false,
    allowDms: 'off',
    createdAt: now,
    updatedAt: now
  }
}

function project(sources: ProjectSource[]): DashboardProject {
  return {
    id: 'proj-1',
    name: 'Acme',
    clientName: 'Acme',
    profileId: 'prof-1',
    teamId: 'T1',
    teamName: 'Acme',
    appId: 'slack',
    tokenSource: 'oauth',
    sourcePreference: 'browser_only',
    monitors: [],
    sources,
    createdAt: new Date().toISOString()
  }
}

describe('MonitorStore.updateSource', () => {
  it('updates two sources concurrently without clobbering either patch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'source-update-'))
    dirs.push(dir)
    const store = new MonitorStore({ rootDir: dir, encryptionAvailable: false })
    await store.upsertProject({ project: project([source('src-1'), source('src-2')]) })

    await Promise.all([
      store.updateSource('proj-1', 'src-1', {
        channels: [{ id: 'C1', name: 'general', enabled: true }],
        channelsReviewedAt: '2026-11-02T10:00:00.000Z'
      }),
      store.updateSource('proj-1', 'src-2', {
        channels: [{ id: 'C2', name: 'private', enabled: true }],
        scheduleEnabled: true
      })
    ])

    const saved = (await store.listProjects()).find((p) => p.id === 'proj-1')
    expect(saved?.sources?.find((s) => s.id === 'src-1')?.channels.map((c) => c.id)).toEqual([
      'C1'
    ])
    expect(saved?.sources?.find((s) => s.id === 'src-1')?.channelsReviewedAt).toBe(
      '2026-11-02T10:00:00.000Z'
    )
    expect(saved?.sources?.find((s) => s.id === 'src-2')?.channels.map((c) => c.id)).toEqual([
      'C2'
    ])
    expect(saved?.sources?.find((s) => s.id === 'src-2')?.scheduleEnabled).toBe(true)
  })

  it('throws when the source does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'source-update-'))
    dirs.push(dir)
    const store = new MonitorStore({ rootDir: dir, encryptionAvailable: false })
    await store.upsertProject({ project: project([source('src-1')]) })

    await expect(
      store.updateSource('proj-1', 'missing', { scheduleEnabled: true })
    ).rejects.toThrow('Source not found')
  })
})
