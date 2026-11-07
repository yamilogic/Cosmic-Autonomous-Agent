import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  type DashboardScheduleKind,
  type DashboardScheduleInterval,
  type DashboardScheduleRun,
  type DashboardScheduleRunSource,
  type DashboardSchedulesState,
  type DashboardSourceSchedulePayload,
  type DashboardSourceScheduleState,
  DASHBOARD_SCHEDULE_INTERVALS
} from '../../../../shared/dashboard-contract'

const INTERVALS = DASHBOARD_SCHEDULE_INTERVALS

const KIND_LABEL: Record<DashboardScheduleKind, string> = {
  'slack-sync': 'Slack sync',
  'agent-analysis': 'Agent analysis',
  'daily-recheck': 'Daily re-check'
}

function age(iso: string | null | undefined, now: number): string {
  if (!iso) return 'never'
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 'never'
  const mins = Math.max(0, Math.round((now - ms) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function countdown(iso: string | null, now: number): string {
  if (!iso) return 'paused'
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms)) return '—'
  if (ms <= 0) return 'any moment now'
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60)
    return `${mins}:${String(seconds % 60).padStart(2, '0')}`
  }
  const hours = Math.floor(seconds / 3600)
  return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`
}

function stamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function SourceStatus({ source }: { source: DashboardScheduleRunSource }): React.ReactElement {
  return (
    <span
      className={`sched-source${source.ok ? ' is-ok' : ' is-bad'}`}
      title={source.error ?? undefined}
    >
      {source.source === 'ours' ? 'Our Slack' : 'Client Slack'} {source.ok ? 'ok' : 'failed'}
    </span>
  )
}

function RunRow({ run, now }: { run: DashboardScheduleRun; now: number }): React.ReactElement {
  return (
    <li className="sched-run">
      <div className="sched-run-head">
        <span className={`sched-status is-${run.status}`}>{run.status}</span>
        <span className="sched-run-kind">{KIND_LABEL[run.kind]}</span>
        <span className="sched-run-time">{age(run.finishedAt, now)}</span>
      </div>
      <p className="sched-run-detail">{run.detail}</p>
      <div className="sched-run-meta">
        <span>{stamp(run.finishedAt)}</span>
        {run.sources?.map((source) => (
          <SourceStatus key={source.source} source={source} />
        ))}
      </div>
    </li>
  )
}

export default function SchedulesPage(): React.ReactElement {
  const [state, setState] = useState<DashboardSchedulesState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    window.api.dashboard
      .getSchedules()
      .then((next) => {
        if (alive) setState(next)
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load schedules.')
      })
    const off = window.api.dashboard.onSchedulesChanged((next) => {
      if (alive) setState(next)
    })
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      alive = false
      off()
      window.clearInterval(tick)
    }
  }, [])

  const update = useCallback(
    async (patch: Parameters<typeof window.api.dashboard.updateSchedules>[0]) => {
      setBusy(true)
      setError(null)
      try {
        setState(await window.api.dashboard.updateSchedules(patch))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save the schedule.')
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const updateSource = useCallback(
    async (
      source: DashboardSourceScheduleState,
      patch: Omit<DashboardSourceSchedulePayload, 'projectId' | 'sourceId'>
    ) => {
      setBusy(true)
      setError(null)
      try {
        await window.api.dashboard.setSourceSchedule({ ...patch, projectId: source.projectId, sourceId: source.sourceId })
        setState(await window.api.dashboard.getSchedules())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save the source schedule.')
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const runNow = useCallback(async (kind: 'slack-sync' | 'daily-recheck') => {
    setBusy(true)
    setError(null)
    try {
      setState(await window.api.dashboard.runSchedule({ kind }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The run could not start.')
    } finally {
      setBusy(false)
    }
  }, [])

  if (!state) {
    return <p className="dash-muted">{error ?? 'Loading schedules…'}</p>
  }

  const slack = state.settings.slackSync
  const daily = state.settings.dailyRecheck
  const latestSlack = state.runs.find((run) => run.kind === 'slack-sync')
  const latestAgent = state.runs.find((run) => run.kind === 'agent-analysis')
  const latestDaily = state.runs.find((run) => run.kind === 'daily-recheck')
  const disabled = busy || state.running

  return (
    <div className="sched-page">
      {error ? <p className="sched-error">{error}</p> : null}
      <p className="dash-muted sched-note">
        Schedules run for every card while Cosmic is open. Nothing runs in the background after the
        app quits.
      </p>

      {(state.sources ?? []).length > 0 ? (
        <section className="sched-card">
          <div className="sched-card-head">
            <div>
              <h5>Card sources</h5>
              <p className="dash-muted">
                Each browser source scrapes on its own cadence. Turning a source off stops automatic
                runs but keeps manual Scrape available on the card.
              </p>
            </div>
          </div>
          <ul className="sched-runs">
            {(state.sources ?? []).map((source) => (
              <li className="sched-run" key={source.sourceId}>
                <div className="sched-run-head">
                  <span className={`sched-status ${source.enabled && source.scheduleEnabled ? 'is-ok' : 'is-skipped'}`}>
                    {source.running
                      ? 'running'
                      : !source.enabled
                        ? 'source off'
                        : source.scheduleEnabled
                          ? 'active'
                          : 'manual only'}
                  </span>
                  <span className="sched-run-kind">{source.workspaceName}</span>
                  <span className="sched-run-time">{source.lastStatus ?? '—'}</span>
                </div>
                <p className="sched-run-detail">{source.projectName}</p>
                <div className="sched-run-meta" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>Last: {age(source.lastRunAt, now)}</span>
                  <span>Next: {countdown(source.nextRunAt, now)}</span>
                  <label className="sched-field">
                    <span>Every</span>
                    <select
                      value={source.intervalMinutes}
                      disabled={disabled}
                      onChange={(event) =>
                        void updateSource(source, {
                          scheduleIntervalMinutes: Number(event.target.value) as DashboardScheduleInterval
                        })
                      }
                    >
                      {INTERVALS.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes < 1 ? `${Math.round(minutes * 60)} sec` : `${minutes} min`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="dash-link"
                    disabled={disabled}
                    onClick={() =>
                      void updateSource(source, { scheduleEnabled: !source.scheduleEnabled })
                    }
                  >
                    {source.scheduleEnabled ? 'Pause auto' : 'Enable auto'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="sched-card">
        <div className="sched-card-head">
          <div>
            <h5>Slack sync</h5>
            <p className="dash-muted">
              Reads the client workspace and our pinned team channels, then refreshes each card.
            </p>
          </div>
          <span className={`sched-state${slack.enabled ? ' is-on' : ''}`}>
            {slack.enabled ? 'Active' : 'Paused'}
          </span>
        </div>

        <div className="sched-controls">
          <label className="sched-field">
            <span>Every</span>
            <select
              value={slack.intervalMinutes}
              disabled={disabled}
              onChange={(event) =>
                void update({
                  slackSync: { intervalMinutes: Number(event.target.value) }
                })
              }
            >
              {INTERVALS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes < 1 ? `${Math.round(minutes * 60)} sec` : `${minutes} min`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="dash-link"
            disabled={disabled}
            onClick={() => void update({ slackSync: { enabled: !slack.enabled } })}
          >
            {slack.enabled ? 'Pause' : 'Resume'}
          </button>
          <button
            type="button"
            className="sched-run-button"
            disabled={disabled || !slack.enabled}
            onClick={() => void runNow('slack-sync')}
          >
            {state.running ? 'Running…' : 'Run now'}
          </button>
        </div>

        <div className="sched-facts">
          <span>
            <b>{slack.enabled ? countdown(state.nextRunAt, now) : 'paused'}</b> to next run
          </span>
          <span>last ran {age(state.lastRunAt['slack-sync'], now)}</span>
        </div>

        <div className="sched-sources">
          <span className="dash-muted">Last run sources</span>
          {latestSlack?.sources?.length ? (
            latestSlack.sources.map((source) => (
              <SourceStatus key={source.source} source={source} />
            ))
          ) : (
            <span className="dash-muted">not run yet</span>
          )}
        </div>
      </section>

      <section className="sched-card">
        <div className="sched-card-head">
          <div>
            <h5>Agent analysis</h5>
            <p className="dash-muted">
              Automatic. Runs only when a sync finds new messages — quiet syncs cost nothing.
            </p>
          </div>
          <span className="sched-state is-auto">
            {latestAgent ? `last ${age(latestAgent.finishedAt, now)}` : 'waiting for messages'}
          </span>
        </div>
        <p className="sched-detail">
          {latestAgent
            ? latestAgent.detail
            : 'No analysis has been triggered yet. It will appear here after new messages arrive.'}
        </p>
      </section>

      <section className="sched-card">
        <div className="sched-card-head">
          <div>
            <h5>Daily re-check</h5>
            <p className="dash-muted">
              Once a day, re-grounds each project with its model even when nothing new arrived. Off
              by default.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={daily.enabled}
            aria-label="Daily re-check"
            className={`sched-switch${daily.enabled ? ' is-on' : ''}`}
            disabled={disabled}
            onClick={() => void update({ dailyRecheck: { enabled: !daily.enabled } })}
          >
            <span />
          </button>
        </div>

        <div className="sched-controls">
          <label className="sched-field">
            <span>At</span>
            <select
              value={daily.hour}
              disabled={disabled || !daily.enabled}
              onChange={(event) =>
                void update({ dailyRecheck: { hour: Number(event.target.value) } })
              }
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="sched-run-button"
            disabled={disabled || !daily.enabled}
            onClick={() => void runNow('daily-recheck')}
          >
            Run now
          </button>
        </div>

        <div className="sched-facts">
          <span>
            <b>{daily.enabled ? countdown(state.nextDailyRunAt, now) : 'off'}</b> to next check
          </span>
          <span>last ran {age(state.lastRunAt['daily-recheck'], now)}</span>
        </div>
        {latestDaily ? <p className="sched-detail">{latestDaily.detail}</p> : null}
      </section>

      <section className="sched-history">
        <div className="sched-history-head">
          <h5>Run history</h5>
          <span className="dash-muted">last 20</span>
        </div>
        {state.runs.length === 0 ? (
          <p className="dash-muted">No runs yet.</p>
        ) : (
          <ul className="sched-runs">
            {state.runs.map((run) => (
              <RunRow key={run.id} run={run} now={now} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
