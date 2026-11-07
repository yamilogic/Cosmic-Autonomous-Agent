/**
 * Persisted schedule settings and the last 20 runs. The scheduler owns timers;
 * this file only stores what a restart must remember.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DASHBOARD_SCHEDULE_INTERVALS,
  type DashboardScheduleKind,
  type DashboardScheduleRun,
  type DashboardScheduleSettings,
  type DashboardUpdateSchedulePayload
} from '../../shared/dashboard-contract'

export const DEFAULT_SCHEDULE_SETTINGS: DashboardScheduleSettings = {
  slackSync: { enabled: true, intervalMinutes: 5 },
  dailyRecheck: { enabled: false, hour: 9 }
}

const MAX_RUNS = 20
const KINDS: DashboardScheduleKind[] = ['slack-sync', 'agent-analysis', 'daily-recheck']

export interface StoredSchedules {
  settings: DashboardScheduleSettings
  lastRunAt: Record<DashboardScheduleKind, string | null>
  /** sourceId → last successful/attempted run ISO (per-source scheduler). */
  sourceLastRunAt?: Record<string, string>
  runs: DashboardScheduleRun[]
}

function emptyLastRun(): Record<DashboardScheduleKind, string | null> {
  return { 'slack-sync': null, 'agent-analysis': null, 'daily-recheck': null }
}

function intervalOf(raw: unknown): DashboardScheduleSettings['slackSync']['intervalMinutes'] {
  const n = Number(raw)
  return (DASHBOARD_SCHEDULE_INTERVALS as readonly number[]).includes(n)
    ? (n as DashboardScheduleSettings['slackSync']['intervalMinutes'])
    : DEFAULT_SCHEDULE_SETTINGS.slackSync.intervalMinutes
}

function hourOf(raw: unknown): number {
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : DEFAULT_SCHEDULE_SETTINGS.dailyRecheck.hour
}

function normaliseSettings(raw: unknown): DashboardScheduleSettings {
  const value = (raw ?? {}) as Partial<DashboardScheduleSettings>
  return {
    slackSync: {
      enabled:
        typeof value.slackSync?.enabled === 'boolean'
          ? value.slackSync.enabled
          : DEFAULT_SCHEDULE_SETTINGS.slackSync.enabled,
      intervalMinutes: intervalOf(value.slackSync?.intervalMinutes)
    },
    dailyRecheck: {
      enabled:
        typeof value.dailyRecheck?.enabled === 'boolean'
          ? value.dailyRecheck.enabled
          : DEFAULT_SCHEDULE_SETTINGS.dailyRecheck.enabled,
      hour: hourOf(value.dailyRecheck?.hour)
    }
  }
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime())
}

export function mergeScheduleSettings(
  current: DashboardScheduleSettings,
  patch: DashboardUpdateSchedulePayload
): DashboardScheduleSettings {
  return normaliseSettings({
    slackSync: { ...current.slackSync, ...patch.slackSync },
    dailyRecheck: { ...current.dailyRecheck, ...patch.dailyRecheck }
  })
}

export class DashboardScheduleStore {
  private readonly filePath: string
  private queue: Promise<void> = Promise.resolve()

  constructor(options: { rootDir: string }) {
    this.filePath = join(options.rootDir, 'schedules.json')
  }

  async read(): Promise<StoredSchedules> {
    const raw = await this.readFile()
    const settings = normaliseSettings(raw.settings)
    const lastRunAt = emptyLastRun()
    for (const kind of KINDS) {
      const iso = raw.lastRunAt?.[kind]
      if (isIso(iso)) lastRunAt[kind] = iso
    }
    const runs = Array.isArray(raw.runs)
      ? raw.runs
          .filter((run): run is DashboardScheduleRun => {
            if (!run || typeof run !== 'object') return false
            const r = run as Partial<DashboardScheduleRun>
            return (
              typeof r.id === 'string' &&
              KINDS.includes(r.kind as DashboardScheduleKind) &&
              typeof r.startedAt === 'string' &&
              typeof r.finishedAt === 'string' &&
              (r.status === 'ok' || r.status === 'error' || r.status === 'skipped')
            )
          })
          .slice(0, MAX_RUNS)
      : []
    const sourceLastRunAt: Record<string, string> = {}
    if (raw.sourceLastRunAt && typeof raw.sourceLastRunAt === 'object') {
      for (const [sourceId, iso] of Object.entries(raw.sourceLastRunAt)) {
        if (isIso(iso)) sourceLastRunAt[sourceId] = iso
      }
    }
    return { settings, lastRunAt, sourceLastRunAt, runs }
  }

  async update(patch: DashboardUpdateSchedulePayload): Promise<StoredSchedules> {
    let result: StoredSchedules | null = null
    await this.mutate((current) => {
      const settings = mergeScheduleSettings(current.settings, patch)
      result = { ...current, settings }
      return result
    })
    return result ?? (await this.read())
  }

  /** Append a run and stamp its kind's last-run time in the same write. */
  async recordRun(run: DashboardScheduleRun): Promise<StoredSchedules> {
    let result: StoredSchedules | null = null
    await this.mutate((current) => {
      const runs = [run, ...current.runs].slice(0, MAX_RUNS)
      const lastRunAt = { ...current.lastRunAt, [run.kind]: run.finishedAt }
      result = { ...current, runs, lastRunAt }
      return result
    })
    return result ?? (await this.read())
  }

  /** Record one source's last run so per-source catch-up survives a restart. */
  async recordSourceRun(sourceId: string, atIso: string): Promise<void> {
    await this.mutate((current) => ({
      ...current,
      sourceLastRunAt: { ...(current.sourceLastRunAt ?? {}), [sourceId]: atIso }
    }))
  }

  /** Drop stale per-source timestamps when a source is removed. */
  async pruneSourceRuns(activeSourceIds: string[]): Promise<void> {
    const active = new Set(activeSourceIds)
    await this.mutate((current) => {
      const next: Record<string, string> = {}
      for (const [id, iso] of Object.entries(current.sourceLastRunAt ?? {})) {
        if (active.has(id)) next[id] = iso
      }
      return { ...current, sourceLastRunAt: next }
    })
  }

  private async mutate(fn: (current: StoredSchedules) => StoredSchedules): Promise<void> {
    const run = async (): Promise<void> => {
      const next = fn(await this.read())
      await mkdir(join(this.filePath, '..'), { recursive: true })
      const tmp = `${this.filePath}.tmp`
      await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
      await rename(tmp, this.filePath)
    }
    this.queue = this.queue.then(run, run)
    return this.queue
  }

  private async readFile(): Promise<{
    settings?: unknown
    lastRunAt?: Partial<Record<DashboardScheduleKind, unknown>>
    sourceLastRunAt?: Record<string, unknown>
    runs?: unknown[]
  }> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Record<string, unknown>
      return {
        settings: parsed.settings,
        lastRunAt: (parsed.lastRunAt ?? {}) as Partial<Record<DashboardScheduleKind, unknown>>,
        sourceLastRunAt: (parsed.sourceLastRunAt ?? {}) as Record<string, unknown>,
        runs: Array.isArray(parsed.runs) ? parsed.runs : []
      }
    } catch {
      return {}
    }
  }
}
