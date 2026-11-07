import type React from 'react'
import { useEffect, useState } from 'react'
import type {
  DashboardActivityMessage,
  DashboardAttentionItem,
  DashboardProject,
  DashboardProjectSnapshot,
  DashboardSource,
  InsightMood,
  InsightStatus
} from '../../../../shared/dashboard-contract'
import { useProjectActivity } from '../../hooks/useProjectActivity'
import { dashboardApi } from '../../lib/dashboard-api'
import type { CardSummary, CardView } from './card-view'
import { requestMessageJump } from './jump-to-message'
import type { SelectionId } from './workspace-nav'
import { DecisionVaultCard } from './DecisionVaultCard'
import { AgentCockpitCard } from './AgentCockpitCard'
import { classifyMessageIntent } from './message-reasoning'

interface DashboardPageProps {
  view: CardView
  summary: CardSummary
  project: DashboardProject
  snapshot: DashboardProjectSnapshot
  syncing: boolean
  onSync: () => void
  onOpenSettings: () => void
  onSelect: (selection: SelectionId) => void
  onOpenControl?: () => void
}

const STATUS_LABEL: Record<InsightStatus, string> = {
  'on-track': 'On track',
  'at-risk': 'At risk',
  blocked: 'Blocked',
  'waiting-on-client': 'Waiting on client'
}
const STATUS_TONE: Record<InsightStatus, string> = {
  'on-track': 'good',
  'at-risk': 'warn',
  blocked: 'danger',
  'waiting-on-client': 'warn'
}
const MOOD_LABEL: Record<InsightMood, string> = {
  good: 'Good',
  neutral: 'Neutral',
  tense: 'Tense'
}
const MOOD_TONE: Record<InsightMood, string> = {
  good: 'good',
  neutral: 'neutral',
  tense: 'danger'
}
const KIND_LABEL: Record<DashboardAttentionItem['kind'], string> = {
  'needs-reply': 'Reply',
  question: 'Question',
  blocker: 'Blocker',
  risk: 'Risk',
  requirement: 'Requirement',
  decision: 'Decision',
  commitment: 'Commitment',
  file: 'File',
  status: 'Status'
}

function age(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '—'
  const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (diffSec < 15) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const mins = Math.round(diffSec / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Short age for the waiting sub-line: "16d", "4h", "12m". */
function compactAge(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Sort timestamp; missing or invalid dates sink to the bottom. */
function isoMs(iso: string | null | undefined): number {
  if (!iso) return 0
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

const COURT_LABEL = {
  you: 'Ball in your court',
  client: 'Ball in client’s court'
} as const
const COURT_RULE = {
  you: 'Rule: the client sent the newest message in the last 14 days.',
  client: 'Rule: our team replied after the client’s newest message.'
} as const

function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

/** 400ms count-up; instantly final under prefers-reduced-motion. */
function CountUp({ value, suffix = '' }: { value: number; suffix?: string }): React.ReactElement {
  const [shown, setShown] = useState(value)
  useEffect(() => {
    if (reducedMotion() || value <= 0) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - start) / 400)
      setShown(Math.round(value * progress))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  // Under reduced motion (or at zero) the final number is rendered directly;
  // no synchronous setState is needed just to settle it.
  const display = reducedMotion() || value <= 0 ? value : shown
  return (
    <span>
      {display}
      {suffix}
    </span>
  )
}

function Ring({ value }: { value: number | null }): React.ReactElement {
  const percent = value === null ? 0 : Math.min(100, Math.max(0, value))
  const radius = 20
  const circumference = 2 * Math.PI * radius
  return (
    <div className="dash-ring" aria-hidden="true">
      <svg viewBox="0 0 48 48" width="48" height="48">
        <circle cx="24" cy="24" r={radius} className="dash-ring-track" />
        {value !== null ? (
          <circle
            cx="24"
            cy="24"
            r={radius}
            className="dash-ring-value"
            strokeDasharray={`${(percent / 100) * circumference} ${circumference}`}
            transform="rotate(-90 24 24)"
          />
        ) : null}
      </svg>
      <span className="dash-ring-label">{value === null ? '—' : `${percent}%`}</span>
    </div>
  )
}

function MoodSpark({
  points
}: {
  points: Array<{ atIso: string; mood: InsightMood }>
}): React.ReactElement {
  const width = 150
  const height = 40
  const level: Record<InsightMood, number> = { tense: 0, neutral: 1, good: 2 }
  const step = points.length > 1 ? width / (points.length - 1) : width
  const coords = points.map((point, index) => {
    const x = index * step
    const y = height - 6 - (level[point.mood] / 2) * (height - 12)
    return `${x},${y}`
  })
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="dash-spark"
      role="img"
      aria-label="Client mood trend"
    >
      <polyline points={coords.join(' ')} className="dash-spark-line" />
      {coords.map((coord, index) => {
        const [x, y] = coord.split(',')
        return <circle key={index} cx={x} cy={y} r="2" className="dash-spark-dot" />
      })}
    </svg>
  )
}

function FreshnessLine({
  lastUpdatedAt,
  syncState,
  busy,
  onOpen,
  onSync
}: {
  lastUpdatedAt: string | null
  syncState: 'idle' | 'syncing' | 'error'
  busy: boolean
  onOpen: () => void
  onSync: () => void
}): React.ReactElement {
  const [nextRunAt, setNextRunAt] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    dashboardApi()
      .getSchedules()
      .then((state) => {
        if (!alive) return
        setEnabled(state.settings.slackSync.enabled)
        setNextRunAt(state.nextRunAt)
      })
      .catch(() => undefined)
    const off = dashboardApi().onSchedulesChanged((state) => {
      if (!alive) return
      setEnabled(state.settings.slackSync.enabled)
      setNextRunAt(state.nextRunAt)
    })
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      alive = false
      off()
      window.clearInterval(tick)
    }
  }, [])

  const seconds = nextRunAt ? Math.ceil((new Date(nextRunAt).getTime() - now) / 1000) : null
  const countdown =
    seconds === null
      ? null
      : seconds <= 0
        ? 'any moment'
        : seconds < 60
          ? `${seconds}s`
          : seconds < 3600
            ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
            : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`

  return (
    <div className="dash-fresh">
      <button
        type="button"
        className="dash-fresh-main"
        onClick={onOpen}
        title="Open schedules"
        data-testid="dash-freshness"
      >
        <span className={`dash-fresh-dot${busy ? ' is-live' : ''}`} aria-hidden="true" />
        {busy ? (
          <span>Syncing now…</span>
        ) : lastUpdatedAt ? (
          <span>Updated {age(lastUpdatedAt)}</span>
        ) : (
          <span>No sync yet</span>
        )}
        <span className="dash-fresh-sep">·</span>
        <span className="dash-fresh-muted">
          {syncState === 'error'
            ? 'sync needs attention'
            : enabled === false
              ? 'sync paused'
              : countdown
                ? `next sync in ${countdown}`
                : 'auto-sync on'}
        </span>
      </button>
      <button
        type="button"
        className="dash-fresh-sync"
        onClick={onSync}
        disabled={busy}
        title="Sync this project now"
      >
        {busy ? 'Syncing…' : 'Sync'}
      </button>
    </div>
  )
}

function SourceChip({
  source,
  onJump
}: {
  source: DashboardSource
  onJump?: () => void
}): React.ReactElement {
  const label = source === 'ours' ? 'Our Slack' : 'Client Slack'
  const className = `dash-source ${source === 'ours' ? 'is-ours' : 'is-client'}`
  if (!onJump) return <span className={className}>{label}</span>
  return (
    <button
      type="button"
      className={className}
      onClick={onJump}
      title="Open and highlight this message"
    >
      {label}
    </button>
  )
}

export default function DashboardPage({
  view,
  summary,
  project,
  snapshot,
  syncing,
  onSync,
  onOpenSettings,
  onSelect,
  onOpenControl
}: DashboardPageProps): React.ReactElement {
  const { centre, leftSidebar, rightSidebar } = view
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const insight = snapshot.insight ?? null
  const hasInsight = Boolean(insight)
  const metrics = snapshot.metrics
  const busy = syncing || snapshot.syncState === 'syncing'

  // Live 5-second ticker ensures relative timestamps ("just now", "15s ago", "30s ago")
  // and latest messages re-query automatically without clicking any button
  const [, setTick] = useState(0)
  const [autoTick, setAutoTick] = useState(0)
  const [ipcTick, setIpcTick] = useState(0)

  useEffect(() => {
    if (!window.api?.dashboard?.onSnapshotChanged) return
    const off = window.api.dashboard.onSnapshotChanged(() => {
      setIpcTick((t) => t + 1)
    })
    return () => off()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setAutoTick((t) => t + 1)
      setTick((t) => t + 1)
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      dashboardApi()
        .getProjectChatStatus(summary.projectId)
        .then((status) => {
          if (alive) setHasKey(status.hasKey)
        })
        .catch(() => undefined)
    }
    refresh()
    const off = dashboardApi().onConfigChanged(refresh)
    return () => {
      alive = false
      off()
    }
  }, [summary.projectId])

  const manual = typeof project.manualCompletion === 'number'
  const evidence = insight?.progressEvidence?.trim() ?? ''
  const estimate = !manual && insight && evidence ? Math.round(insight.progress) : null
  const progressValue = manual ? (project.manualCompletion ?? 0) : estimate
  const progressLabel = manual
    ? 'set by you'
    : estimate !== null
      ? 'agent estimate'
      : 'not stated in chat'

  const time = centre.visuals.timeElapsed
  const activityState = useProjectActivity(
    summary.projectId,
    `${snapshot.lastUpdatedAt}:${snapshot.totalMessageCount}:${ipcTick}:${autoTick}`
  )
  const activity = activityState.activity
  const waiting = metrics?.waiting
  const response = metrics?.ourResponse
  const lastContact = metrics?.lastClientContactAt ?? summary.lastClientAt
  const mood = rightSidebar.moodSignals
  const moodKnown = hasInsight && Boolean(mood.moodReason || mood.moodQuote)
  const trend = metrics?.moodTrend ?? []
  const attention = waiting?.items ?? []
  const newSince = metrics?.newSince
  const newTotal = newSince ? Object.values(newSince.counts).reduce((sum, n) => sum + n, 0) : 0

  const requirements = leftSidebar.requirements
  const latestRequirements = [...requirements]
    .sort((a, b) => isoMs(b.whenIso) - isoMs(a.whenIso))
    .slice(0, 3)

  const [deliverableOverrides, setDeliverableOverrides] = useState<
    Record<string, 'done' | 'in-progress' | 'pending' | 'not-started'>
  >({})

  const toggleDeliverable = (name: string, current: string): void => {
    const cycle: Record<string, 'done' | 'in-progress' | 'pending' | 'not-started'> = {
      'not-started': 'in-progress',
      pending: 'in-progress',
      'in-progress': 'done',
      done: 'not-started'
    }
    const next = cycle[current] || 'in-progress'
    setDeliverableOverrides((prev) => ({ ...prev, [name]: next }))
  }

  const rawDeliverables = leftSidebar.scopeDeliverables.deliverables
  const deliverables = rawDeliverables.map((d) => ({
    ...d,
    status: deliverableOverrides[d.name] || d.status
  }))
  const deliverableCounts = {
    done: deliverables.filter((d) => d.status === 'done').length,
    'in-progress': deliverables.filter((d) => d.status === 'in-progress').length,
    pending: deliverables.filter((d) => d.status === 'pending').length,
    'not-started': deliverables.filter((d) => d.status === 'not-started').length
  }

  const errorLine =
    snapshot.ourWorkspaceError ||
    (snapshot.syncState === 'error'
      ? 'The last sync failed. Showing the last data that arrived.'
      : null)

  const maxDay = Math.max(1, ...(metrics?.daily.map((d) => d.client + d.ours) ?? [0]))
  const daily = metrics?.daily ?? []
  const hasDaily = daily.some((day) => day.client + day.ours > 0)
  const totals14d = daily.reduce(
    (sum, day) => ({ client: sum.client + day.client, ours: sum.ours + day.ours }),
    { client: 0, ours: 0 }
  )
  const recentMessages = activity?.recent ?? []
  const ballInCourt = activity?.ballInCourt ?? null
  const showPace = time.hasDates
  const showMood = trend.length >= 3

  const jumpToMessage = (message: DashboardActivityMessage): void => {
    requestMessageJump({
      projectId: summary.projectId,
      source: message.source,
      channelId: message.channelId,
      ts: message.ts
    })
    onSelect(
      (message.source === 'ours'
        ? `c:team:${message.channelId}`
        : `c:client:${message.channelId}`) as SelectionId
    )
  }

  const attentionRows = attention.slice(0, 5)
  const newSinceRows = newSince?.items.slice(0, 6) ?? []

  const openAttention = (item: DashboardAttentionItem): void => {
    if (!item.channelId) return
    const source = item.source ?? 'client'
    if (item.ts) {
      requestMessageJump({
        projectId: summary.projectId,
        source,
        channelId: item.channelId,
        ts: item.ts
      })
    }
    onSelect(
      (source === 'ours' ? `c:team:${item.channelId}` : `c:client:${item.channelId}`) as SelectionId
    )
  }

  const setupRows = [
    {
      key: 'sync',
      label: 'Client sync',
      done: snapshot.lastUpdatedAt !== null,
      action: 'Sync now',
      run: onSync
    },
    {
      key: 'channels',
      label: 'Client channels',
      done: project.monitors.length > 0,
      action: 'Set up',
      run: onOpenSettings
    },
    {
      key: 'ours',
      label: 'Our Slack channels',
      done: (project.ourSlackChannels?.length ?? 0) > 0,
      action: 'Set up',
      run: onOpenSettings
    },
    {
      key: 'dates',
      label: 'Project dates',
      done: Boolean(snapshot.effectiveDates.startDate && snapshot.effectiveDates.endDate),
      action: 'Add dates',
      run: onOpenSettings
    },
    {
      key: 'key',
      label: 'AI key',
      done: hasKey === true,
      action: 'Add key',
      run: onOpenSettings
    }
  ]
  const setupDone = setupRows.filter((row) => row.done).length

  return (
    <div className="dash-page">
      <div className="dash-scroll">
        <div className="dash-inner">
          <div className="dash-top">
            <FreshnessLine
              lastUpdatedAt={snapshot.lastUpdatedAt}
              syncState={snapshot.syncState}
              busy={busy}
              onOpen={() => onSelect('m:schedules')}
              onSync={onSync}
            />
            {errorLine ? <p className="dash-error">{errorLine}</p> : null}
          </div>

          <section className="dash-kpis" aria-label="Key numbers">
            <div className="dash-tile">
              <div className="dash-tile-head">
                <span>Progress</span>
              </div>
              <div className="dash-tile-row">
                <Ring value={progressValue} />
                <div>
                  <p className={`dash-kpi-value${progressValue === null ? ' is-soft' : ''}`}>
                    {progressValue === null ? '—' : `${progressValue}%`}
                  </p>
                  <p className="dash-muted">{progressLabel}</p>
                </div>
              </div>
            </div>

            <div className="dash-tile">
              <div className="dash-tile-head">
                <span>Status</span>
              </div>
              {summary.status ? (
                <>
                  <p className={`dash-chip is-${STATUS_TONE[summary.status]}`}>
                    {STATUS_LABEL[summary.status]}
                  </p>
                  <p className="dash-muted">
                    {metrics?.statusSince
                      ? `since ${shortDate(metrics.statusSince)}`
                      : 'no change logged'}
                  </p>
                </>
              ) : (
                <>
                  <p className="dash-kpi-value is-soft">—</p>
                  <p className="dash-muted">Not analysed yet</p>
                </>
              )}
            </div>

            <div className={`dash-tile${summary.needsReply ? ' is-attention' : ''}`}>
              <div className="dash-tile-head">
                <span>Waiting on you</span>
              </div>
              {!hasInsight || !waiting ? (
                <>
                  <p className="dash-kpi-value is-soft">—</p>
                  <p className="dash-muted">
                    {hasInsight ? 'Not enough info' : 'Not analysed yet'}
                  </p>
                </>
              ) : (
                <>
                  <p className="dash-kpi-value">
                    <CountUp value={waiting?.count ?? 0} />
                  </p>
                  <p className="dash-muted">
                    {waiting?.oldestIso
                      ? `Oldest: ${compactAge(waiting.oldestIso)}`
                      : 'Age unknown'}
                  </p>
                  {waiting && waiting.blockers + waiting.risks > 0 ? (
                    <p className="dash-muted">
                      {[
                        waiting.blockers
                          ? `${waiting.blockers} blocker${waiting.blockers === 1 ? '' : 's'}`
                          : '',
                        waiting.risks
                          ? `${waiting.risks} risk${waiting.risks === 1 ? '' : 's'}`
                          : ''
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  ) : null}
                </>
              )}
            </div>

            <div className="dash-tile">
              <div className="dash-tile-head">
                <span>Client mood</span>
              </div>
              {moodKnown ? (
                <>
                  <p className={`dash-chip is-${MOOD_TONE[mood.mood]}`}>{MOOD_LABEL[mood.mood]}</p>
                  <p className="dash-muted dash-clip">{mood.moodReason}</p>
                </>
              ) : (
                <>
                  <p className="dash-kpi-value is-soft">—</p>
                  <p className="dash-muted">Not enough signals</p>
                </>
              )}
            </div>

            <div className={`dash-tile${waiting && waiting.count > 0 ? ' is-attention' : ''}`}>
              <div className="dash-tile-head">
                <span>Our response time</span>
              </div>
              {waiting && waiting.count > 0 ? (
                <>
                  <p className="dash-kpi-value dash-sla-live">
                    {waiting.oldestIso ? compactAge(waiting.oldestIso) : 'Active'}
                  </p>
                  <p className="dash-muted">
                    <span className="dash-sla-pill">Target &lt; 30m</span> · Awaiting reply
                  </p>
                </>
              ) : (
                <>
                  <p className={`dash-kpi-value${response?.medianSeconds == null ? ' is-soft' : ''}`}>
                    {duration(response?.medianSeconds ?? null)}
                  </p>
                  <p className="dash-muted">
                    {response && response.medianSeconds !== null
                      ? `median · ${response.pairs} replies / ${response.windowDays}d`
                      : 'Needs 3+ replies to measure'}
                  </p>
                </>
              )}
            </div>

            <div className="dash-tile">
              <div className="dash-tile-head">
                <span>Last client contact</span>
              </div>
              <p className={`dash-kpi-value${lastContact ? '' : ' is-soft'}`}>
                {lastContact ? age(lastContact) : '—'}
              </p>
              <p className="dash-muted">
                {lastContact ? shortDate(lastContact) : 'No message yet'}
              </p>
            </div>
          </section>

          <div className="dash-columns">
            <div className="dash-main">
              <section className="dash-hero" aria-label="Situation">
                <div className="dash-hero-top">
                  <p className="dash-hero-eyebrow">Where it stands</p>
                  {ballInCourt ? (
                    <span
                      className={`dash-court is-${ballInCourt}`}
                      title={COURT_RULE[ballInCourt]}
                      data-testid="dash-court"
                    >
                      {COURT_LABEL[ballInCourt]}
                    </span>
                  ) : null}
                </div>
                <p className={`dash-hero-line${centre.situationLine ? '' : ' is-soft'}`}>
                  {centre.situationLine ||
                    (hasInsight ? 'No situation line yet.' : 'Not analysed yet.')}
                </p>
                {centre.recentLine ? (
                  <p className="dash-hero-changed">
                    <span>Just changed</span> {centre.recentLine}
                  </p>
                ) : null}
                {centre.nextStep ? (
                  <p className="dash-next">
                    <span>Next step</span> {centre.nextStep}
                  </p>
                ) : null}
              </section>

              <AgentCockpitCard
                project={project}
                nextStep={centre.nextStep}
                situationLine={centre.situationLine}
                onOpenControl={onOpenControl}
              />

              {hasDaily ? (
                <section className="dash-panel" aria-label="Activity">
                  <div className="dash-panel-head">
                    <h5>Activity</h5>
                    <span className="dash-muted">Last 14 days</span>
                  </div>
                  <div className="dash-bars" aria-hidden="true">
                    {daily.map((day) => {
                      const total = day.client + day.ours
                      const height =
                        total === 0 ? 2 : Math.max(6, Math.round((total / maxDay) * 156))
                      return (
                        <div
                          key={day.date}
                          className={`dash-bar${day.isToday ? ' is-today' : ''}${total === 0 ? ' is-empty' : ''}`}
                          title={`${day.date}: ${day.client} client, ${day.ours} ours`}
                        >
                          <div style={{ height }} className="dash-bar-stack">
                            {total > 0 ? (
                              <>
                                <div
                                  className="dash-bar-ours"
                                  style={{ flexGrow: day.ours || 0 }}
                                />
                                <div
                                  className="dash-bar-client"
                                  style={{ flexGrow: day.client || 0 }}
                                />
                              </>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="dash-legend">
                    <span className="dash-legend-client">Client · {totals14d.client}</span>
                    <span className="dash-legend-ours">Ours · {totals14d.ours}</span>
                    <span className="dash-legend-total">
                      {totals14d.client + totals14d.ours} in 14d
                    </span>
                  </div>
                </section>
              ) : null}

              {showPace || showMood ? (
                <section
                  className={`dash-duo${showPace && showMood ? '' : ' is-single'}`}
                  aria-label="Time, pace and mood"
                >
                  {showPace ? (
                    <div className="dash-panel">
                      <div className="dash-panel-head">
                        <h5>Time and pace</h5>
                        {time.daysLeft !== undefined ? (
                          <span className="dash-muted">{time.daysLeft}d left</span>
                        ) : null}
                      </div>
                      <p className="dash-pace-line">
                        <b>{time.daysUsed}</b> of <b>{time.totalDays}</b> days used
                      </p>
                      <div className="dash-track" aria-hidden="true">
                        <div
                          className={`dash-track-fill is-${time.pace}`}
                          style={{ width: `${Math.min(100, time.progressPercent ?? 0)}%` }}
                        />
                      </div>
                      <p className={`dash-pace is-${time.pace}`}>{time.paceLabel}</p>
                      <p className="dash-muted">
                        {shortDate(time.startDate)} → {shortDate(time.endDate)}
                      </p>
                    </div>
                  ) : null}

                  {showMood ? (
                    <div className="dash-panel">
                      <div className="dash-panel-head">
                        <h5>Mood trend</h5>
                        <span className="dash-muted">{trend.length} runs</span>
                      </div>
                      <MoodSpark points={trend} />
                      <p className="dash-muted">since {shortDate(trend[0]?.atIso)}</p>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {recentMessages.length > 0 ? (
                <section className="dash-panel" aria-label="Latest messages">
                  <div className="dash-panel-head">
                    <h5>Latest messages</h5>
                    <span className="dash-muted">Client + our Slack</span>
                  </div>
                  <ul className="dash-msgs">
                    {recentMessages.map((message) => (
                      <li key={`${message.source}-${message.channelId}-${message.ts}`}>
                        <button
                          type="button"
                          className="dash-msg"
                          onClick={() => jumpToMessage(message)}
                          title={`Open in #${message.channelName || message.channelId}`}
                        >
                          <span className="dash-avatar" aria-hidden="true">
                            {initials(message.userName)}
                          </span>
                          <span className="dash-msg-body">
                            <span className="dash-msg-meta">
                              <span className="dash-msg-name">{message.userName}</span>
                              <span>{age(message.atIso)}</span>
                              <span className="dash-msg-channel">
                                #{message.channelName || message.channelId}
                              </span>
                              <SourceChip source={message.source} />
                              {(() => {
                                const intent = classifyMessageIntent(message.text)
                                return (
                                  <span
                                    className={`dash-intent-badge is-${intent.tone}`}
                                    title={intent.label}
                                  >
                                    {intent.icon ? `${intent.icon} ` : ''}
                                    {intent.label}
                                  </span>
                                )
                              })()}
                            </span>
                            <span className="dash-msg-text">{message.text}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="dash-msg-foot">
                    <button
                      type="button"
                      className="dash-link"
                      onClick={() => onSelect('s:client')}
                    >
                      View all
                    </button>
                  </div>
                </section>
              ) : null}
            </div>

            <div className="dash-rail">
              {metrics ? (
                <section className="dash-block" aria-label="Needs your attention">
                  <div className="dash-block-head">
                    <h5>Needs your attention</h5>
                    {waiting && waiting.count > 0 ? (
                      <span className="dash-muted">{waiting.count} open</span>
                    ) : null}
                  </div>
                  {attentionRows.length === 0 ? (
                    <p className="dash-muted">
                      {waiting && hasInsight
                        ? 'Nothing needs you right now.'
                        : hasInsight
                          ? 'Not enough info.'
                          : 'Not analysed yet.'}
                    </p>
                  ) : (
                    <ul className="dash-list">
                      {attentionRows.map((item, index) => (
                        <li className="dash-row" key={`${item.kind}-${index}`}>
                          <span className={`dash-kind is-${item.kind}`}>
                            {KIND_LABEL[item.kind] ?? item.kind}
                          </span>
                          <span className="dash-row-text">{item.text}</span>
                          {item.source ? (
                            <SourceChip
                              source={item.source}
                              onJump={item.canJump ? () => openAttention(item) : undefined}
                            />
                          ) : null}
                          <span className="dash-row-age">{item.atIso ? age(item.atIso) : '—'}</span>
                          {item.channelId ? (
                            <button
                              type="button"
                              className="dash-link"
                              onClick={() => openAttention(item)}
                            >
                              Open
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}

              <DecisionVaultCard
                decisions={insight?.decisions}
                situationLine={insight?.situationLine}
                recentLine={insight?.recentLine}
                onJump={(ch) =>
                  jumpToMessage({ source: 'client', channelId: ch || '', ts: '' } as any)
                }
              />

              {newSince && newTotal > 0 ? (
                <section className="dash-block" aria-label="New since your last visit">
                  <div className="dash-block-head">
                    <h5>New since your last visit</h5>
                  </div>
                  <div className="dash-counts">
                    {newSince.counts.requirements > 0 ? (
                      <span>{newSince.counts.requirements} requirements</span>
                    ) : null}
                    {newSince.counts.decisions > 0 ? (
                      <span>{newSince.counts.decisions} decisions</span>
                    ) : null}
                    {newSince.counts.commitments > 0 ? (
                      <span>{newSince.counts.commitments} commitments</span>
                    ) : null}
                    {newSince.counts.files > 0 ? <span>{newSince.counts.files} files</span> : null}
                    {newSince.counts.questions > 0 ? (
                      <span>{newSince.counts.questions} questions</span>
                    ) : null}
                    {newSince.counts.statusChanges > 0 ? (
                      <span>{newSince.counts.statusChanges} status changes</span>
                    ) : null}
                  </div>
                  <ul className="dash-list">
                    {newSinceRows.map((item, index) => (
                      <li className="dash-row" key={`${item.kind}-${index}`}>
                        <span className={`dash-kind is-${item.kind}`}>
                          {KIND_LABEL[item.kind] ?? item.kind}
                        </span>
                        <span className="dash-row-text">{item.text}</span>
                        {item.atIso ? (
                          <span className="dash-row-age">{age(item.atIso)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {setupDone < setupRows.length ? (
                <section className="dash-block" aria-label="Finish project setup">
                  <div className="dash-block-head">
                    <h5>Finish setup</h5>
                    <span className="dash-muted">
                      {setupDone} of {setupRows.length}
                    </span>
                  </div>
                  <ul className="dash-check">
                    {setupRows.map((row) => (
                      <li key={row.key} className={row.done ? 'is-done' : ''}>
                        <span className="dash-check-mark" aria-hidden="true">
                          {row.done ? '✓' : '○'}
                        </span>
                        <span className="dash-check-label">{row.label}</span>
                        {!row.done ? (
                          <button
                            type="button"
                            className="dash-link"
                            onClick={row.run}
                            disabled={row.key === 'sync' && busy}
                          >
                            {row.action}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="dash-block" aria-label="Client ask">
                <div className="dash-block-head">
                  <h5>Client ask</h5>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {(project.documents || []).length > 0 ? (
                      <span className="dash-muted">{(project.documents || []).length} docs</span>
                    ) : null}
                    {requirements.length > 0 ? (
                      <span className="dash-muted">{requirements.length} total</span>
                    ) : null}
                  </div>
                </div>

                {/* Quick Document Upload / Badge */}
                <div style={{ margin: '8px 0 12px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="dash-link"
                    style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    onClick={() => {
                      const input = document.createElement('input')
                      input.type = 'file'
                      input.accept = '.docx,.pdf,.txt,.md,.json'
                      input.onchange = async (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0]
                        if (!file) return
                        const reader = new FileReader()
                        reader.onload = async () => {
                          const base64 = (reader.result as string).split(',')[1]
                          await window.api.dashboard.uploadDocument({
                            projectId: project.id,
                            name: file.name,
                            mimeType: file.type || 'application/octet-stream',
                            dataBase64: base64
                          })
                          await onSync()
                        }
                        reader.readAsDataURL(file)
                      }
                      input.click()
                    }}
                  >
                    + Upload spec/doc
                  </button>
                  {(project.documents || []).map((doc) => (
                    <span
                      key={doc.id}
                      style={{
                        fontSize: '11px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--border)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        color: 'var(--text-muted)'
                      }}
                      title={`${doc.name} (${Math.round((doc.sizeBytes || 0) / 1024)} KB)`}
                    >
                      📄 {doc.name.length > 18 ? doc.name.slice(0, 15) + '…' : doc.name}
                    </span>
                  ))}
                </div>

                {latestRequirements.length === 0 ? (
                  <p className="dash-muted">No requirements stated yet.</p>
                ) : (
                  <ul className="dash-asks">
                    {latestRequirements.map((requirement, index) => (
                      <li key={`${requirement.text}-${index}`}>
                        <span className="dash-ask-text">{requirement.text}</span>
                        {requirement.whenIso && isoMs(requirement.whenIso) > 0 ? (
                          <span className="dash-row-age">{age(requirement.whenIso)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {deliverables.length > 0 ? (
                  <>
                    <div
                      style={{
                        margin: '10px 0 8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px'
                      }}
                    >
                      {deliverables.map((d, index) => {
                        const currentStatus = d.status || 'not-started'
                        return (
                          <div
                            key={`${d.name}-${index}`}
                            className="dash-deliverable-row"
                            onClick={() => toggleDeliverable(d.name, currentStatus)}
                            title="Click to toggle status: Not started → In progress → Done"
                          >
                            <span className="dash-deliverable-name">
                              <span aria-hidden="true">
                                {currentStatus === 'done'
                                  ? '☑'
                                  : currentStatus === 'in-progress'
                                    ? '⏳'
                                    : '☐'}
                              </span>
                              {d.name}
                            </span>
                            <span className={`dash-deliverable-badge is-${currentStatus}`}>
                              {currentStatus === 'in-progress' ? 'In progress' : currentStatus}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <div className="dash-seg" aria-hidden="true">
                      {(['done', 'in-progress', 'pending', 'not-started'] as const).map(
                        (status) => (
                          <span
                            key={status}
                            className={`dash-seg-part is-${status}`}
                            style={{ flexGrow: deliverableCounts[status] }}
                          />
                        )
                      )}
                    </div>
                    <div className="dash-legend">
                      <span>{deliverableCounts.done} done</span>
                      <span>{deliverableCounts['in-progress']} in progress</span>
                      <span>{deliverableCounts.pending} pending</span>
                      <span>{deliverableCounts['not-started']} not started</span>
                    </div>
                  </>
                ) : null}
              </section>

              {activity && (activity.participants.length > 0 || activity.channels.length > 0) ? (
                <section className="dash-block" aria-label="People and channels">
                  <div className="dash-block-head">
                    <h5>People and channels</h5>
                    <span className="dash-muted">14 days</span>
                  </div>
                  <div className="dash-mini-cols">
                    {activity.participants.length > 0 ? (
                      <div>
                        <p className="dash-mini-label">People</p>
                        <ul className="dash-mini">
                          {activity.participants.map((person) => (
                            <li key={`${person.source}-${person.userId}`}>
                              <span>{person.name}</span>
                              <span className="dash-mini-count">{person.count}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {activity.channels.length > 0 ? (
                      <div>
                        <p className="dash-mini-label">Channels</p>
                        <ul className="dash-mini">
                          {activity.channels.map((channel) => (
                            <li key={`${channel.source}-${channel.channelId}`}>
                              <span className="dash-mini-name">
                                #{channel.channelName || channel.channelId}
                              </span>
                              <span className="dash-mini-count">{channel.count}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
