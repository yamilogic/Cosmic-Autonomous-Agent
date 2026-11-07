import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DashboardScheduleRun } from '../../src/shared/dashboard-contract'
import {
  DEFAULT_SCHEDULE_SETTINGS,
  DashboardScheduleStore,
  mergeScheduleSettings
} from '../../src/main/dashboard/schedule-store'

function run(id: string, finishedAt = '2026-10-25T10:00:00.000Z'): DashboardScheduleRun {
  return {
    id,
    kind: 'slack-sync',
    startedAt: finishedAt,
    finishedAt,
    status: 'ok',
    detail: `run ${id}`
  }
}

describe('DashboardScheduleStore', () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  it('starts from honest defaults: 5-minute sync, daily re-check off', async () => {
    dir = await mkdtemp(join(tmpdir(), 'orbit-schedules-'))
    const store = new DashboardScheduleStore({ rootDir: dir })
    const stored = await store.read()
    expect(stored.settings).toEqual(DEFAULT_SCHEDULE_SETTINGS)
    expect(stored.settings.dailyRecheck.enabled).toBe(false)
    expect(stored.settings.slackSync.intervalMinutes).toBe(5)
    expect(stored.runs).toEqual([])
    expect(stored.lastRunAt['slack-sync']).toBeNull()
  })

  it('persists settings across a restart', async () => {
    dir = await mkdtemp(join(tmpdir(), 'orbit-schedules-'))
    const store = new DashboardScheduleStore({ rootDir: dir })
    await store.update({ slackSync: { intervalMinutes: 15 }, dailyRecheck: { enabled: true } })
    const reopened = new DashboardScheduleStore({ rootDir: dir })
    const stored = await reopened.read()
    expect(stored.settings.slackSync.intervalMinutes).toBe(15)
    expect(stored.settings.dailyRecheck.enabled).toBe(true)
  })

  it('rejects an interval outside the offered set instead of guessing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'orbit-schedules-'))
    const store = new DashboardScheduleStore({ rootDir: dir })
    const stored = await store.update({ slackSync: { intervalMinutes: 7 } })
    expect(stored.settings.slackSync.intervalMinutes).toBe(5)
  })

  it('clamps the daily hour to 0–23', () => {
    const merged = mergeScheduleSettings(DEFAULT_SCHEDULE_SETTINGS, {
      dailyRecheck: { hour: 99 }
    })
    expect(merged.dailyRecheck.hour).toBe(9)
  })

  it('keeps the newest 20 runs and stamps the last-run time in the same write', async () => {
    dir = await mkdtemp(join(tmpdir(), 'orbit-schedules-'))
    const store = new DashboardScheduleStore({ rootDir: dir })
    for (let i = 0; i < 25; i += 1) {
      await store.recordRun(run(`r${i}`, `2026-10-25T10:${String(i).padStart(2, '0')}:00.000Z`))
    }
    const stored = await store.read()
    expect(stored.runs).toHaveLength(20)
    expect(stored.runs[0].id).toBe('r24')
    expect(stored.runs[19].id).toBe('r5')
    expect(stored.lastRunAt['slack-sync']).toBe('2026-10-25T10:24:00.000Z')
  })

  it('ignores malformed runs in the file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'orbit-schedules-'))
    const store = new DashboardScheduleStore({ rootDir: dir })
    await store.recordRun(run('ok-run'))
    const fs = await import('node:fs/promises')
    const path = join(dir, 'schedules.json')
    const parsed = JSON.parse(await fs.readFile(path, 'utf8'))
    parsed.runs = [parsed.runs[0], { id: 'bad' }, null]
    await fs.writeFile(path, JSON.stringify(parsed), 'utf8')
    const stored = await store.read()
    expect(stored.runs.map((r) => r.id)).toEqual(['ok-run'])
  })
})
