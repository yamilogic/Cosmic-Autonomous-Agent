/**
 * One scheduler for the whole dashboard (ADR-0007, extended in v3).
 *
 * - Slack sync runs on a 1/5/15/30/60-minute cadence while Orbit is open.
 * - A startup catch-up runs once if the last sync is older than the interval.
 * - Agent analysis is logged only when a sync found new messages; the insight
 *   refresh itself stays inside the sync pipeline.
 * - The daily re-check is off by default and re-grounds once a day.
 *
 * There is no background daemon: when the app quits, the process dies.
 */

import type {
  DashboardProject,
  DashboardScheduleRun,
  DashboardScheduleRunSource,
  DashboardScheduleSettings,
  DashboardSchedulesState,
  DashboardSourceScheduleState,
  DashboardUpdateSchedulePayload
} from '../../shared/dashboard-contract'
import type { DashboardProjectSnapshot } from '../../shared/dashboard-contract'
import type { DashboardSyncEngine } from './sync-engine'
import type { StoredSchedules } from './schedule-store'

const DAY_MS = 24 * 60 * 60 * 1000

type SlackTrigger = 'scheduled' | 'startup' | 'manual'

export interface DailyRecheckResult {
  checked: number
  skipped: number
  detail?: string
}

export interface ScheduleStoreLike {
  read(): Promise<StoredSchedules>
  update(patch: DashboardUpdateSchedulePayload): Promise<StoredSchedules>
  recordRun(run: DashboardScheduleRun): Promise<StoredSchedules>
  recordSourceRun?(sourceId: string, atIso: string): Promise<void>
  pruneSourceRuns?(activeSourceIds: string[]): Promise<void>
}

export interface DashboardSchedulerDeps {
  /** Runs the morning re-ground for every project that has a token. */
  runDailyRecheck?: () => Promise<DailyRecheckResult>
  /** Card sources, so the per-source scheduler can read schedule fields. */
  listProjects?: () => Promise<DashboardProject[]>
  /** Called after every state transition so the renderer can refresh. */
  onChanged?: (state: DashboardSchedulesState) => void
  /** Broadcasts the updated snapshot to all windows so the UI updates automatically. */
  broadcastSnapshot?: (projectId?: string) => Promise<void>
  /** Injectable clock for tests. */
  now?: () => number
  /** Injectable id factory for tests. */
  newId?: () => string
}

export class DashboardScheduler {
  private readonly engine: DashboardSyncEngine
  private readonly store: ScheduleStoreLike
  private readonly deps: DashboardSchedulerDeps
  private readonly now: () => number
  private readonly newId: () => string

  private slackTimer: ReturnType<typeof setTimeout> | null = null
  private dailyTimer: ReturnType<typeof setTimeout> | null = null
  private sourceTimer: ReturnType<typeof setInterval> | null = null
  private sourcesRunning = false
  private nextAt: number | null = null
  private nextDailyAt: number | null = null
  private running = false
  private started = false
  private pendingSlackTrigger: SlackTrigger = 'scheduled'
  private hasRunStartupSourceCatchUp = false
  private broadcastSnapshotCallback?: (projectId?: string) => Promise<void>

  constructor(
    engine: DashboardSyncEngine,
    store: ScheduleStoreLike,
    deps: DashboardSchedulerDeps = {}
  ) {
    this.engine = engine
    this.store = store
    this.deps = deps
    this.now = deps.now ?? (() => Date.now())
    this.newId = deps.newId ?? (() => `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  }

  /** Wire up external snapshot broadcaster so UI updates automatically on scrape. */
  setBroadcastSnapshot(fn: (projectId?: string) => Promise<void>): void {
    this.broadcastSnapshotCallback = fn
  }

  private async triggerBroadcastSnapshot(projectId?: string): Promise<void> {
    try {
      if (this.broadcastSnapshotCallback) {
        await this.broadcastSnapshotCallback(projectId)
      } else if (this.deps.broadcastSnapshot) {
        await this.deps.broadcastSnapshot(projectId)
      }
    } catch {
      // ignore
    }
  }

  /** Start timers; an overdue sync runs immediately as the catch-up. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const stored = await this.store.read()
    this.armDaily(stored.settings)
    this.armSlack(stored, this.catchUpDue(stored))
    this.armSources()
  }

  stop(): void {
    this.started = false
    if (this.slackTimer) clearTimeout(this.slackTimer)
    if (this.dailyTimer) clearTimeout(this.dailyTimer)
    if (this.sourceTimer) clearInterval(this.sourceTimer)
    this.slackTimer = null
    this.dailyTimer = null
    this.sourceTimer = null
    this.nextAt = null
    this.nextDailyAt = null
    this.running = false
    this.sourcesRunning = false
    this.hasRunStartupSourceCatchUp = false
  }

  async getState(): Promise<DashboardSchedulesState> {
    const stored = await this.store.read()
    const state = this.stateOf(stored)
    state.sources = await this.buildSourceStates(stored)
    return state
  }

  async updateSettings(patch: DashboardUpdateSchedulePayload): Promise<DashboardSchedulesState> {
    const stored = await this.store.update(patch)
    if (this.started) {
      this.armDaily(stored.settings)
      this.armSlack(stored, false)
    }
    await this.emit()
    return this.stateOf(stored)
  }

  /** "Run now": manual Slack sync or a manual daily re-check. */
  async runNow(kind: 'slack-sync' | 'daily-recheck'): Promise<DashboardSchedulesState> {
    if (this.running) throw new Error('A scheduled run is already in progress.')
    if (kind === 'daily-recheck') await this.runDaily('manual')
    else await this.runSlack('manual')
    if (this.started) {
      const stored = await this.store.read()
      this.armSlack(stored, false)
      this.armDaily(stored.settings)
    }
    await this.emit()
    return this.getState()
  }

  private stateOf(stored: StoredSchedules): DashboardSchedulesState {
    return {
      settings: stored.settings,
      lastRunAt: stored.lastRunAt,
      nextRunAt: this.nextAt === null ? null : new Date(this.nextAt).toISOString(),
      nextDailyRunAt: this.nextDailyAt === null ? null : new Date(this.nextDailyAt).toISOString(),
      running: this.running,
      runs: stored.runs
    }
  }

  private catchUpDue(stored: StoredSchedules): boolean {
    if (!stored.settings.slackSync.enabled) return false
    const last = stored.lastRunAt['slack-sync']
    if (!last) return true
    const elapsed = this.now() - new Date(last).getTime()
    return (
      !Number.isFinite(elapsed) || elapsed >= stored.settings.slackSync.intervalMinutes * 60_000
    )
  }

  /** Per-source cadence: tick often, scrape only what is due. */
  private armSources(): void {
    if (this.sourceTimer) clearInterval(this.sourceTimer)
    // Check cadence every 2 seconds to promptly trigger fast 3s, 5s, 10s, and standard intervals
    this.sourceTimer = setInterval(() => void this.tickSources(), 2_000)
    void this.tickSources()
  }

  private async tickSources(): Promise<void> {
    if (!this.started || this.sourcesRunning || !this.deps.listProjects) return
    this.sourcesRunning = true
    try {
      const projects = await this.deps.listProjects()
      const stored = await this.store.read()
      const activeIds: string[] = []

      for (const project of projects) {
        for (const source of project.sources ?? []) {
          if (source.kind !== 'browser' || source.enabled === false) continue
          if (source.scheduleEnabled === false) continue
          const isDirectApi = (source.engineMode ?? 'direct_api') === 'direct_api'
          const isEnabled = source.scheduleEnabled ?? isDirectApi
          if (!isEnabled) continue
          const profileId = source.profileId || project.profileId
          const workspaceId = source.workspaceId || project.teamId
          if (!profileId || !workspaceId) continue

          activeIds.push(source.id)
          if (this.engine.isSourceRunning(source.id)) continue

          const defaultInterval = isDirectApi ? 0.333 : 15
          let intervalMinutes = source.scheduleIntervalMinutes ?? defaultInterval
          if (isDirectApi && intervalMinutes === 15) {
            intervalMinutes = 0.333
          }
          const intervalMs = Math.round(intervalMinutes * 60_000)
          const last =
            stored.sourceLastRunAt?.[source.id] ??
            source.lastScrapeAt ??
            source.lastReadAt ??
            null
          const lastMs = last ? new Date(last).getTime() : null
          const isOverdue =
            lastMs === null ||
            !Number.isFinite(lastMs) ||
            lastMs > this.now() ||
            this.now() >= lastMs + intervalMs
          const isStartupCatchUp =
            !this.hasRunStartupSourceCatchUp &&
            lastMs !== null &&
            Number.isFinite(lastMs) &&
            this.now() - lastMs > intervalMs
          const due = isOverdue
          if (!due) continue

          const trigger: SlackTrigger = isStartupCatchUp ? 'startup' : 'scheduled'
          const result = await this.engine.syncProjectSource(project.id, source.id, {
            trigger
          })
          await this.store.recordSourceRun?.(
            source.id,
            new Date(this.now()).toISOString()
          )
          if (result.status === 'success' || result.status === 'partial') {
            await this.triggerBroadcastSnapshot(project.id)
            await this.store.recordRun({
              id: result.runId || this.newId(),
              kind: 'slack-sync',
              startedAt: new Date(this.now()).toISOString(),
              finishedAt: new Date(this.now()).toISOString(),
              status: 'ok',
              detail: `Scheduled scrape for ${source.workspaceName || source.workspaceId}: ${result.channelsRead} channel${result.channelsRead === 1 ? '' : 's'}, ${result.newMessages} new message${result.newMessages === 1 ? '' : 's'}.`,
              projects: 1,
              newMessages: result.newMessages
            })

            if ((result.newMessages ?? 0) > 0) {
              await this.store.recordRun({
                id: this.newId(),
                kind: 'agent-analysis',
                startedAt: new Date(this.now()).toISOString(),
                finishedAt: new Date(this.now()).toISOString(),
                status: 'ok',
                detail: `Triggered by ${result.newMessages} new message${result.newMessages === 1 ? '' : 's'}; the insight refresh runs inside the sync.`,
                projects: 1,
                newMessages: result.newMessages
              })
            }
          }
          if (result.status === 'error') {
            await this.store.recordRun({
              id: this.newId(),
              kind: 'slack-sync',
              startedAt: new Date(this.now()).toISOString(),
              finishedAt: new Date(this.now()).toISOString(),
              status: 'error',
              detail: `Scheduled scrape failed for ${source.workspaceName || source.workspaceId}: ${result.error ?? 'unknown error'}`,
              projects: 1
            })
          }
        }
      }

      await this.store.pruneSourceRuns?.(activeIds)
      this.hasRunStartupSourceCatchUp = true
      await this.emit()
    } catch {
      // A malformed project must not kill the scheduler loop.
    } finally {
      this.sourcesRunning = false
    }
  }

  private async buildSourceStates(
    stored: StoredSchedules
  ): Promise<DashboardSourceScheduleState[]> {
    if (!this.deps.listProjects) return []
    const projects = await this.deps.listProjects()
    const out: DashboardSourceScheduleState[] = []
    for (const project of projects) {
      for (const source of project.sources ?? []) {
        if (source.kind !== 'browser') continue
        const isDirectApi = (source.engineMode ?? 'direct_api') === 'direct_api'
        let intervalMinutes = source.scheduleIntervalMinutes ?? (isDirectApi ? 0.333 : 15)
        if (isDirectApi && intervalMinutes === 15) {
          intervalMinutes = 0.333
        }
        const lastRunAt =
          stored.sourceLastRunAt?.[source.id] ??
          source.lastScrapeAt ??
          source.lastReadAt ??
          null
        const scheduleEnabled = source.scheduleEnabled ?? isDirectApi
        out.push({
          projectId: project.id,
          projectName: project.name,
          sourceId: source.id,
          workspaceName: source.workspaceName || source.workspaceId,
          enabled: source.enabled !== false,
          scheduleEnabled,
          intervalMinutes,
          lastRunAt,
          lastStatus: source.lastScrapeStatus,
          nextRunAt:
            scheduleEnabled && source.enabled !== false
              ? new Date(
                  (lastRunAt ? new Date(lastRunAt).getTime() : this.now()) +
                    intervalMinutes * 60_000
                ).toISOString()
              : null,
          running: this.engine.isSourceRunning(source.id)
        })
      }
    }
    return out
  }

  private armSlack(stored: StoredSchedules, immediate: boolean): void {
    if (this.slackTimer) clearTimeout(this.slackTimer)
    this.slackTimer = null
    this.pendingSlackTrigger = immediate ? 'startup' : 'scheduled'
    if (!stored.settings.slackSync.enabled) {
      this.nextAt = null
      return
    }
    const intervalMs = stored.settings.slackSync.intervalMinutes * 60_000
    const last = stored.lastRunAt['slack-sync']
    const lastMs = last ? new Date(last).getTime() : null
    const due = immediate || lastMs === null ? this.now() : lastMs + intervalMs
    const delay = Math.max(0, due - this.now())
    this.nextAt = this.now() + delay
    this.slackTimer = setTimeout(() => {
      void this.onSlackTimer()
    }, delay)
  }

  private async onSlackTimer(): Promise<void> {
    const trigger = this.pendingSlackTrigger
    try {
      await this.runSlack(trigger)
    } finally {
      if (this.started) this.armSlack(await this.store.read(), false)
      await this.emit()
    }
  }

  private async runSlack(trigger: SlackTrigger): Promise<void> {
    if (this.running) return
    this.running = true
    await this.emit()
    const startedAt = new Date(this.now()).toISOString()
    try {
      const results = await this.engine.syncAll({ includeBrowserSources: false })
      await this.triggerBroadcastSnapshot()
      const finishedAt = new Date(this.now()).toISOString()
      const run = this.slackRun(trigger, results, startedAt, finishedAt)
      await this.store.recordRun(run)

      if ((run.newMessages ?? 0) > 0) {
        await this.store.recordRun({
          id: this.newId(),
          kind: 'agent-analysis',
          startedAt,
          finishedAt,
          status: 'ok',
          detail: `Triggered by ${run.newMessages} new message${run.newMessages === 1 ? '' : 's'}; the insight refresh runs inside the sync.`,
          projects: run.projects,
          newMessages: run.newMessages
        })
      }
    } catch (err) {
      const finishedAt = new Date(this.now()).toISOString()
      await this.store.recordRun({
        id: this.newId(),
        kind: 'slack-sync',
        startedAt,
        finishedAt,
        status: 'error',
        detail: `Sync failed: ${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      this.running = false
      await this.emit()
    }
  }

  private slackRun(
    trigger: SlackTrigger,
    results: DashboardProjectSnapshot[],
    startedAt: string,
    finishedAt: string
  ): DashboardScheduleRun {
    const newMessages = results.reduce((sum, snap) => sum + (snap.newMessageCount ?? 0), 0)
    const projects = results.length
    const clientError = results
      .map((snap) => (snap.syncState === 'error' ? `${snap.project.name} could not sync` : null))
      .find((value): value is string => Boolean(value))
    const oursError = results
      .map((snap) => snap.ourWorkspaceError ?? null)
      .find((value): value is string => Boolean(value))
    const sources: DashboardScheduleRunSource[] = [
      { source: 'client', ok: !clientError, error: clientError ?? null },
      { source: 'ours', ok: !oursError, error: oursError ?? null }
    ]
    const prefix =
      trigger === 'startup'
        ? 'Startup catch-up'
        : trigger === 'manual'
          ? 'Manual run'
          : 'Scheduled run'
    const detail =
      projects === 0
        ? `${prefix}: no projects to sync.`
        : `${prefix}: ${projects} project${projects === 1 ? '' : 's'}, ${newMessages} new message${newMessages === 1 ? '' : 's'}.`
    return {
      id: this.newId(),
      kind: 'slack-sync',
      startedAt,
      finishedAt,
      status: projects === 0 ? 'skipped' : 'ok',
      detail,
      projects,
      newMessages,
      sources
    }
  }

  private armDaily(settings: DashboardScheduleSettings): void {
    if (this.dailyTimer) clearTimeout(this.dailyTimer)
    this.dailyTimer = null
    if (!settings.dailyRecheck.enabled) {
      this.nextDailyAt = null
      return
    }
    const now = new Date(this.now())
    const next = new Date(now)
    next.setHours(settings.dailyRecheck.hour, 0, 0, 0)
    if (next.getTime() <= now.getTime()) next.setTime(next.getTime() + DAY_MS)
    this.nextDailyAt = next.getTime()
    this.dailyTimer = setTimeout(
      () => {
        void this.onDailyTimer()
      },
      Math.max(0, this.nextDailyAt - this.now())
    )
  }

  private async onDailyTimer(): Promise<void> {
    try {
      await this.runDaily('scheduled')
    } finally {
      if (this.started) this.armDaily((await this.store.read()).settings)
      await this.emit()
    }
  }

  private async runDaily(trigger: 'scheduled' | 'manual'): Promise<void> {
    if (this.running) return
    if (!this.deps.runDailyRecheck) {
      await this.store.recordRun({
        id: this.newId(),
        kind: 'daily-recheck',
        startedAt: new Date(this.now()).toISOString(),
        finishedAt: new Date(this.now()).toISOString(),
        status: 'skipped',
        detail: 'Daily re-check is not available yet.'
      })
      return
    }
    this.running = true
    await this.emit()
    const startedAt = new Date(this.now()).toISOString()
    try {
      const result = await this.deps.runDailyRecheck()
      const finishedAt = new Date(this.now()).toISOString()
      await this.store.recordRun({
        id: this.newId(),
        kind: 'daily-recheck',
        startedAt,
        finishedAt,
        status: 'ok',
        detail:
          result.detail ??
          `${trigger === 'manual' ? 'Manual' : 'Scheduled'} re-check: ${result.checked} checked, ${result.skipped} skipped.`,
        projects: result.checked
      })
    } catch (err) {
      await this.store.recordRun({
        id: this.newId(),
        kind: 'daily-recheck',
        startedAt,
        finishedAt: new Date(this.now()).toISOString(),
        status: 'error',
        detail: `Daily re-check failed: ${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      this.running = false
    }
  }

  private async emit(): Promise<void> {
    if (!this.deps.onChanged) return
    try {
      this.deps.onChanged(await this.getState())
    } catch {
      // A renderer that is gone must not break the scheduler.
    }
  }
}
