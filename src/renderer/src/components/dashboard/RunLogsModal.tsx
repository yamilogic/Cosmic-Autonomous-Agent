import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ScrapeRunChannel,
  ScrapeRunLog,
  ScrapeRunStatus,
  ScrapeTrigger
} from '../../../../shared/dashboard-contract'

const STATUS_LABEL: Record<ScrapeRunStatus, string> = {
  success: 'Success',
  partial: 'Partial',
  error: 'Error',
  stopped: 'Stopped'
}

const STATUS_COLOR: Record<ScrapeRunStatus, { bg: string; fg: string }> = {
  success: { bg: 'rgba(34, 197, 94, 0.15)', fg: '#22c55e' },
  partial: { bg: 'rgba(251, 191, 36, 0.15)', fg: '#fbbf24' },
  error: { bg: 'rgba(239, 68, 68, 0.15)', fg: '#ef4444' },
  stopped: { bg: 'rgba(148, 163, 184, 0.15)', fg: '#94a3b8' }
}

function channelKindLabel(kind: ScrapeRunChannel['kind']): string {
  if (kind === 'dm') return 'DM'
  if (kind === 'group-dm') return 'Group DM'
  if (kind === 'private') return 'Private'
  return 'Public'
}

function timeOf(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export interface ScrapeLogExplorerProps {
  /** undefined = every card (unified logs tab). */
  projectId?: string
  projectName?: string
  showProjectColumn?: boolean
  compact?: boolean
}

export function ScrapeLogExplorer({
  projectId,
  projectName,
  showProjectColumn = false,
  compact = false
}: ScrapeLogExplorerProps): React.JSX.Element {
  const [runs, setRuns] = useState<ScrapeRunLog[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ScrapeRunStatus | 'all'>('all')
  const [triggerFilter, setTriggerFilter] = useState<ScrapeTrigger | 'all'>('all')
  const [engineFilter, setEngineFilter] = useState<'all' | 'direct_api' | 'browser'>('all')
  const [hideEmptyChannels, setHideEmptyChannels] = useState<boolean>(true)
  const [busy, setBusy] = useState(false)

  const fetchRuns = useCallback(async () => {
    try {
      const data = await window.api.dashboard.getScrapeRuns({
        projectId,
        limit: 100,
        status: statusFilter,
        trigger: triggerFilter
      })
      const rows = (data ?? []) as ScrapeRunLog[]
      setRuns(rows)
      setSelectedRunId((current) => current ?? rows[0]?.runId ?? null)
    } catch {
      setRuns([])
    }
  }, [projectId, statusFilter, triggerFilter])

  useEffect(() => {
    void fetchRuns()
    if (!window.api?.dashboard?.onScrapeEvent) return undefined
    const unsubscribe = window.api.dashboard.onScrapeEvent((event: { type?: string }) => {
      if (
        event.type === 'run_started' ||
        event.type === 'run_finished' ||
        event.type === 'run_failed' ||
        event.type === 'run_cancelled'
      ) {
        void fetchRuns()
      }
    })
    return () => unsubscribe()
  }, [fetchRuns])

  const displayedRuns = useMemo(() => {
    return runs.filter((run) => {
      if (engineFilter === 'all') return true
      if (engineFilter === 'direct_api') {
        return run.engineMode === 'direct_api' || (run as any).sourceKind === 'token'
      }
      if (engineFilter === 'browser') {
        return run.engineMode === 'browser' || (!run.engineMode && (run as any).sourceKind === 'browser')
      }
      return true
    })
  }, [runs, engineFilter])

  const activeRun = useMemo(
    () => displayedRuns.find((run) => run.runId === selectedRunId) ?? displayedRuns[0] ?? null,
    [displayedRuns, selectedRunId]
  )

  const displayedChannels = useMemo(() => {
    if (!activeRun) return []
    if (!hideEmptyChannels) return activeRun.channels
    const withMessages = activeRun.channels.filter((c) => (c.messagesRead || 0) > 0)
    return withMessages.length > 0 ? withMessages : activeRun.channels
  }, [activeRun, hideEmptyChannels])

  const skippedCount = useMemo(() => {
    if (!activeRun) return 0
    return activeRun.channels.filter((c) => (c.messagesRead || 0) === 0).length
  }, [activeRun])

  const activeChannel = useMemo(() => {
    if (!activeRun) return null
    return (
      displayedChannels.find((channel) => channel.channelId === selectedChannelId) ??
      displayedChannels.find((channel) => (channel.messagesRead || 0) > 0) ??
      displayedChannels[0] ??
      activeRun.channels[0] ??
      null
    )
  }, [activeRun, displayedChannels, selectedChannelId])

  const snippets = useMemo(() => {
    if (!activeRun || !activeChannel) return []
    return (activeRun.snippets ?? []).filter(
      (snippet) => snippet.channelId === activeChannel.channelId
    )
  }, [activeRun, activeChannel])

  const cancelRun = async (): Promise<void> => {
    if (!activeRun) return
    setBusy(true)
    try {
      await window.api.dashboard.cancelScrape({ runId: activeRun.runId, projectId })
      await fetchRuns()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
          {projectName ? `${projectName} · ` : ''}Scrape run history ({runs.length})
        </span>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as ScrapeRunStatus | 'all')}
          style={{ fontSize: 12, padding: '4px 8px' }}
        >
          <option value="all">All statuses</option>
          <option value="success">Success</option>
          <option value="partial">Partial</option>
          <option value="error">Error</option>
          <option value="stopped">Stopped</option>
        </select>
        <select
          value={triggerFilter}
          onChange={(event) => setTriggerFilter(event.target.value as ScrapeTrigger | 'all')}
          style={{ fontSize: 12, padding: '4px 8px' }}
        >
          <option value="all">All triggers</option>
          <option value="manual">Manual</option>
          <option value="scheduled">Scheduled</option>
        </select>
        <button type="button" className="btn ghost btn-sm" onClick={() => void fetchRuns()}>
          ⟳ Refresh
        </button>
        {activeRun ? (
          <button
            type="button"
            className="btn ghost btn-sm"
            disabled={busy}
            onClick={() => void cancelRun()}
            title="Stop this scrape run"
          >
            ■ Stop
          </button>
        ) : null}
      </div>

      {/* Engine Filter Sub-Tabs */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 6 }}>
        <button
          type="button"
          onClick={() => {
            setEngineFilter('all')
            setSelectedRunId(null)
          }}
          style={{
            background: engineFilter === 'all' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
            border: engineFilter === 'all' ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.1)',
            color: engineFilter === 'all' ? '#c7d2fe' : '#94a3b8',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          All Runs ({runs.length})
        </button>
        <button
          type="button"
          onClick={() => {
            setEngineFilter('direct_api')
            setSelectedRunId(null)
          }}
          style={{
            background: engineFilter === 'direct_api' ? 'rgba(16, 185, 129, 0.25)' : 'transparent',
            border: engineFilter === 'direct_api' ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
            color: engineFilter === 'direct_api' ? '#a7f3d0' : '#94a3b8',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          ⚡ Direct API Runs (
          {runs.filter((r) => r.engineMode === 'direct_api' || (r as any).sourceKind === 'token').length}
          )
        </button>
        <button
          type="button"
          onClick={() => {
            setEngineFilter('browser')
            setSelectedRunId(null)
          }}
          style={{
            background: engineFilter === 'browser' ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
            border: engineFilter === 'browser' ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
            color: engineFilter === 'browser' ? '#bfdbfe' : '#94a3b8',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          🌐 Browser Scraper Runs (
          {
            runs.filter(
              (r) => r.engineMode === 'browser' || (!r.engineMode && (r as any).sourceKind === 'browser')
            ).length
          }
          )
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 12 }}>
        <div
          style={{
            width: compact ? 260 : 320,
            flexShrink: 0,
            overflowY: 'auto',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            background: 'rgba(15, 23, 42, 0.35)',
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          {displayedRuns.length === 0 ? (
            <div style={{ padding: 18, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
              No scrape runs matching filter.
            </div>
          ) : (
            displayedRuns.map((run) => {
              const selected = activeRun?.runId === run.runId
              const colors = STATUS_COLOR[run.status]
              return (
                <button
                  key={run.runId}
                  type="button"
                  onClick={() => {
                    setSelectedRunId(run.runId)
                    setSelectedChannelId(null)
                  }}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: `1px solid ${selected ? '#38bdf8' : 'rgba(255,255,255,0.06)'}`,
                    background: selected ? 'rgba(56,189,248,0.1)' : 'rgba(255,255,255,0.02)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3
                  }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 3,
                          background: colors.bg,
                          color: colors.fg
                        }}
                      >
                        {STATUS_LABEL[run.status]}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background:
                            run.engineMode === 'direct_api' || (run as any).sourceKind === 'token'
                              ? 'rgba(16, 185, 129, 0.2)'
                              : 'rgba(59, 130, 246, 0.2)',
                          color:
                            run.engineMode === 'direct_api' || (run as any).sourceKind === 'token'
                              ? '#34d399'
                              : '#60a5fa'
                        }}
                      >
                        {run.engineMode === 'direct_api' || (run as any).sourceKind === 'token'
                          ? '⚡ Direct API'
                          : '🌐 Browser'}
                      </span>
                    </span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{timeOf(run.ts)}</span>
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#f8fafc' }}>
                    {showProjectColumn ? `${run.projectName} · ` : ''}
                    {run.workspaceName}
                  </span>
                  {(() => {
                    const totalRead =
                      run.messagesRead ??
                      (Array.isArray(run.channels)
                        ? run.channels.reduce((sum, ch) => sum + (ch.messagesRead || 0), 0)
                        : 0)
                    return (
                      <span
                        style={{
                          fontSize: 11,
                          color: '#64748b',
                          display: 'flex',
                          justifyContent: 'space-between'
                        }}
                      >
                        <span>
                          {run.trigger} · {run.channelsRead} ch · {totalRead} read
                        </span>
                        <span style={{ color: run.newMessages > 0 ? '#22c55e' : 'inherit' }}>
                          {run.newMessages > 0 ? `+${run.newMessages}` : '+0'}
                        </span>
                      </span>
                    )
                  })()}
                </button>
              )
            })
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!activeRun ? (
            <div style={{ padding: 30, color: '#64748b', fontSize: 13, textAlign: 'center' }}>
              Select a run to inspect what was scraped.
            </div>
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  gap: 14,
                  flexWrap: 'wrap',
                  fontSize: 12,
                  padding: '10px 12px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.02)'
                }}
              >
                <span>
                  Window:{' '}
                  <b>
                    {activeRun.window.backfillHours}h
                    {activeRun.window.gapSeconds ? ` · gap ${activeRun.window.gapSeconds}s` : ''}
                  </b>
                </span>
                <span>
                  Channels: <b>{activeRun.channelsRead}</b>
                </span>
                <span>
                  Read:{' '}
                  <b>
                    {typeof activeRun.messagesRead === 'number'
                      ? activeRun.messagesRead
                      : activeRun.channels.reduce((sum, ch) => sum + (ch.messagesRead || 0), 0)}
                  </b>
                </span>
                <span>
                  New: <b>{activeRun.newMessages}</b>
                </span>
                <span>
                  Duration: <b>{(activeRun.durationMs / 1000).toFixed(1)}s</b>
                </span>
                <span>
                  Engine:{' '}
                  <b
                    style={{
                      color:
                        activeRun.engineMode === 'direct_api' ||
                        (activeRun as any).sourceKind === 'token'
                          ? '#34d399'
                          : '#60a5fa'
                    }}
                  >
                    {activeRun.engineMode === 'direct_api' ||
                    (activeRun as any).sourceKind === 'token'
                      ? '⚡ Direct API (~150ms Zero-DOM)'
                      : '🌐 Browser DOM (Headless View)'}
                  </b>
                </span>
                <span style={{ color: '#64748b' }}>Run {activeRun.runId}</span>
              </div>

              {activeRun.error ? (
                <div
                  style={{
                    fontSize: 12,
                    color: '#f87171',
                    background: 'rgba(239,68,68,0.08)',
                    padding: '8px 12px',
                    borderRadius: 6,
                    borderLeft: '4px solid #ef4444'
                  }}
                >
                  {activeRun.error}
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 10, minHeight: 0, flex: 1 }}>
                <div
                  style={{
                    width: 260,
                    flexShrink: 0,
                    overflowY: 'auto',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8,
                    padding: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '2px 4px 6px',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em'
                      }}
                    >
                      Channels ({displayedChannels.length})
                    </span>
                    {skippedCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => setHideEmptyChannels((prev) => !prev)}
                        title={
                          hideEmptyChannels
                            ? `Show ${skippedCount} skipped channels`
                            : 'Hide 0-message skipped channels'
                        }
                        style={{
                          background: hideEmptyChannels
                            ? 'rgba(99, 102, 241, 0.15)'
                            : 'rgba(255, 255, 255, 0.08)',
                          border: `1px solid ${
                            hideEmptyChannels
                              ? 'rgba(99, 102, 241, 0.35)'
                              : 'rgba(255, 255, 255, 0.12)'
                          }`,
                          color: hideEmptyChannels ? '#a5b4fc' : '#cbd5e1',
                          borderRadius: 4,
                          padding: '2px 6px',
                          fontSize: 10,
                          fontWeight: 600,
                          cursor: 'pointer',
                          transition: 'all 0.12s ease'
                        }}
                      >
                        {hideEmptyChannels ? `+${skippedCount} skipped` : 'Hide 0-read'}
                      </button>
                    ) : null}
                  </div>
                  {displayedChannels.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#64748b', padding: 8 }}>
                      No channels with messages in this run.
                    </div>
                  ) : (
                    displayedChannels.map((channel) => {
                      const selected = activeChannel?.channelId === channel.channelId
                      const channelEngine =
                        channel.engineMode ??
                        activeRun.engineMode ??
                        ((activeRun as any).sourceKind === 'token' ? 'direct_api' : 'browser')
                      const isDirect = channelEngine === 'direct_api'

                      return (
                        <button
                          key={channel.channelId}
                          type="button"
                          onClick={() => setSelectedChannelId(channel.channelId)}
                          style={{
                            textAlign: 'left',
                            padding: '7px 9px',
                            borderRadius: 6,
                            border: `1px solid ${selected ? '#38bdf8' : 'rgba(255,255,255,0.04)'}`,
                            background: selected ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.02)',
                            cursor: 'pointer',
                            color: '#e2e8f0',
                            fontSize: 12,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 3,
                            transition: 'all 0.1s ease'
                          }}
                        >
                          <span
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}
                          >
                            <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span>
                                {channel.kind === 'dm'
                                  ? '💬'
                                  : channel.kind === 'private'
                                    ? '🔒'
                                    : '#'}
                              </span>
                              <span style={{ color: selected ? '#bae6fd' : '#f1f5f9' }}>
                                {channel.channelName}
                              </span>
                            </span>
                            <span
                              style={{
                                color: (channel.messagesRead || 0) > 0 ? '#34d399' : '#64748b',
                                fontSize: 11,
                                fontWeight: 600
                              }}
                            >
                              {channel.messagesRead} read
                              {channel.newMessages > 0 ? ` (+${channel.newMessages})` : ''}
                            </span>
                          </span>
                          <span
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: 10,
                              color: '#64748b'
                            }}
                          >
                            <span>
                              {channelKindLabel(channel.kind)} · {channel.status}
                              {channel.skippedReason ? ` · ${channel.skippedReason}` : ''}
                            </span>
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                padding: '1px 5px',
                                borderRadius: 3,
                                background: isDirect
                                  ? 'rgba(16, 185, 129, 0.15)'
                                  : 'rgba(59, 130, 246, 0.15)',
                                color: isDirect ? '#6ee7b7' : '#93c5fd'
                              }}
                            >
                              {isDirect ? '⚡ Direct API' : '🌐 Browser DOM'}
                            </span>
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>

                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase'
                    }}
                  >
                    People ({activeRun.people.length})
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {activeRun.people.length === 0 ? (
                      <span style={{ fontSize: 12, color: '#64748b' }}>No messages captured.</span>
                    ) : (
                      activeRun.people.map((person) => (
                        <span
                          key={person.name}
                          style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 12,
                            background: 'rgba(99,102,241,0.12)',
                            border: '1px solid rgba(99,102,241,0.3)',
                            color: '#c7d2fe'
                          }}
                        >
                          {person.name} · {person.messages}
                        </span>
                      ))
                    )}
                  </div>

                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <span>
                      Messages {activeChannel ? `· #${activeChannel.channelName}` : ''}
                    </span>
                    {activeChannel && (activeChannel.messagesRead || 0) > 0 && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 3,
                          background:
                            (activeChannel.engineMode ?? activeRun?.engineMode) === 'direct_api'
                              ? 'rgba(16, 185, 129, 0.15)'
                              : 'rgba(59, 130, 246, 0.15)',
                          color:
                            (activeChannel.engineMode ?? activeRun?.engineMode) === 'direct_api'
                              ? '#34d399'
                              : '#60a5fa'
                        }}
                      >
                        {(activeChannel.engineMode ?? activeRun?.engineMode) === 'direct_api'
                          ? '⚡ Direct API (~150ms)'
                          : '🌐 Browser DOM'}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6
                    }}
                  >
                    {snippets.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        No snippets for this channel in this run.
                      </div>
                    ) : (
                      snippets.map((snippet, index) => (
                        <div
                          key={`${snippet.channelId}-${snippet.ts}-${index}`}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 6,
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.06)'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <b style={{ fontSize: 12, color: '#f8fafc' }}>{snippet.sender}</b>
                            <span style={{ fontSize: 10, color: '#64748b' }}>{snippet.ts}</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>
                            {snippet.snippet}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface RunLogsModalProps {
  open: boolean
  projectId: string
  projectName: string
  onClose: () => void
}

export function RunLogsModal({
  open,
  projectId,
  projectName,
  onClose
}: RunLogsModalProps): React.JSX.Element | null {
  if (!open) return null
  return (
    <div
      className="platform-settings-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      style={{ zIndex: 1200 }}
    >
      <div
        className="platform-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Scrape logs"
        style={{
          width: '98%',
          maxWidth: 1440,
          height: '92vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#0b0f19',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.12)',
          padding: 16,
          gap: 12
        }}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, color: '#f8fafc' }}>Scrape logs</h2>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{projectName}</div>
          </div>
          <button type="button" className="btn ghost btn-sm" onClick={onClose}>
            ✕ Close
          </button>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ScrapeLogExplorer projectId={projectId} projectName={projectName} />
        </div>
      </div>
    </div>
  )
}
