import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LogCategory, LogEntry, LogLevel } from '../../../../shared/ipc-contract'

function formatRelativeTime(isoString: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000))
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  return `${diffHr}h ago`
}

function formatExactTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

export function LogsObservabilityTab(): React.JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<LogCategory | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [retentionMinutes, setRetentionMinutes] = useState<number>(15)
  const [autoScroll, setAutoScroll] = useState(true)
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({})
  const [exportNotice, setExportNotice] = useState<string | null>(null)

  const streamEndRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Load initial logs
  const refreshLogs = useCallback(async () => {
    try {
      const recent = await window.api.logs.getRecent()
      setLogs(recent || [])
    } catch (err) {
      console.error('Failed to load logs', err)
    }
  }, [])

  useEffect(() => {
    void refreshLogs()
  }, [refreshLogs])

  // Real-time live log subscription
  useEffect(() => {
    const unsubscribe = window.api.logs.onLogEntry((entry: LogEntry) => {
      setLogs((prev) => {
        const cutoff = retentionMinutes > 0 ? Date.now() - retentionMinutes * 60 * 1000 : 0
        const filtered = cutoff > 0 ? prev.filter((e) => new Date(e.ts).getTime() >= cutoff) : prev
        return [...filtered, entry]
      })
    })
    return () => unsubscribe()
  }, [retentionMinutes])

  // Periodic sweeper & relative timer updater every 5s
  useEffect(() => {
    const timer = setInterval(() => {
      if (retentionMinutes > 0) {
        const cutoff = Date.now() - retentionMinutes * 60 * 1000
        setLogs((prev) => prev.filter((e) => new Date(e.ts).getTime() >= cutoff))
      } else {
        setLogs((prev) => [...prev])
      }
    }, 5000)
    return () => clearInterval(timer)
  }, [retentionMinutes])

  // Auto-scroll when new logs arrive and autoScroll is active
  useEffect(() => {
    if (autoScroll && streamEndRef.current) {
      streamEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs.length, autoScroll])

  const handleRetentionChange = async (minutes: number): Promise<void> => {
    setRetentionMinutes(minutes)
    try {
      await window.api.logs.setRetention(minutes)
      await refreshLogs()
    } catch (err) {
      console.error('Failed to set retention', err)
    }
  }

  const handleClearLogs = async (): Promise<void> => {
    try {
      await window.api.logs.clear()
      setLogs([])
    } catch (err) {
      console.error('Failed to clear logs', err)
    }
  }

  const handleExportLogs = async (): Promise<void> => {
    try {
      const res = await window.api.logs.export()
      if (res?.content) {
        const blob = new Blob([res.content], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `orbit-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        setExportNotice(`Exported ${res.count} logs to download file!`)
        setTimeout(() => setExportNotice(null), 3500)
      }
    } catch (err) {
      console.error('Failed to export logs', err)
    }
  }

  const toggleExpand = (id: string): void => {
    setExpandedLogIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  // Filter logs for view
  const filteredLogs = useMemo(() => {
    return logs.filter((entry) => {
      if (levelFilter !== 'all' && entry.level !== levelFilter) return false
      if (categoryFilter !== 'all' && entry.category !== categoryFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const msgMatch = entry.message.toLowerCase().includes(q)
        const catMatch = entry.category.toLowerCase().includes(q)
        const metaMatch = entry.meta
          ? JSON.stringify(entry.meta).toLowerCase().includes(q)
          : false
        if (!msgMatch && !catMatch && !metaMatch) return false
      }
      return true
    })
  }, [logs, levelFilter, categoryFilter, searchQuery])

  const errorCount = useMemo(() => logs.filter((e) => e.level === 'error').length, [logs])
  const warnCount = useMemo(() => logs.filter((e) => e.level === 'warn').length, [logs])

  return (
    <div className="logs-hub-container" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. Top Section: Header & Telemetry Cards */}
      <div className="logs-header-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>📜</span> Application Observability &amp; Logs
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
              Full end-to-end real-time diagnostics, background sync telemetry, and security audit feed.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '11.5px',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '20px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: errorCount > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                color: errorCount > 0 ? '#fca5a5' : '#86efac',
                border: errorCount > 0 ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid rgba(34, 197, 94, 0.35)'
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: errorCount > 0 ? '#ef4444' : '#22c55e',
                  display: 'inline-block'
                }}
              />
              {errorCount > 0 ? `${errorCount} Active Errors` : 'System Healthy'}
            </span>

            <span
              style={{
                fontSize: '11.5px',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '20px',
                background: 'rgba(30, 41, 59, 0.8)',
                color: '#cbd5e1',
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}
            >
              {logs.length} Live Entries
            </span>
          </div>
        </div>

        {/* Structured 4-Card Telemetry Grid */}
        <div className="logs-metric-grid">
          <div className="logs-metric-card">
            <span className="logs-metric-label">📊 Total Tracked</span>
            <div className="logs-metric-value" style={{ color: '#f8fafc' }}>
              {logs.length}
              <span style={{ fontSize: '11px', fontWeight: 500, color: '#64748b' }}>events</span>
            </div>
          </div>

          <div className="logs-metric-card">
            <span className="logs-metric-label">⚠️ Errors &amp; Warnings</span>
            <div
              className="logs-metric-value"
              style={{ color: errorCount > 0 ? '#f87171' : warnCount > 0 ? '#fbbf24' : '#94a3b8' }}
            >
              {errorCount} <span style={{ fontSize: '11px', color: '#64748b' }}>err</span> · {warnCount}{' '}
              <span style={{ fontSize: '11px', color: '#64748b' }}>warn</span>
            </div>
          </div>

          <div className="logs-metric-card">
            <span className="logs-metric-label">⏳ Retention Window</span>
            <div className="logs-metric-value" style={{ color: '#a5b4fc' }}>
              {retentionMinutes > 0 ? `${retentionMinutes} min` : 'Session'}
              <span style={{ fontSize: '11px', fontWeight: 500, color: '#64748b' }}>auto-purge</span>
            </div>
          </div>

          <div className="logs-metric-card">
            <span className="logs-metric-label">🛡️ Security Redaction</span>
            <div className="logs-metric-value" style={{ color: '#4ade80' }}>
              Active
              <span style={{ fontSize: '11px', fontWeight: 500, color: '#64748b' }}>tokens masked</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Controls & Filtering Bar */}
      <div className="logs-control-bar">
        {/* Left Side: Filters & Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Level Filter */}
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as any)}
            className="logs-select"
            aria-label="Filter by log level"
          >
            <option value="all">Level: All</option>
            <option value="error">Level: Error</option>
            <option value="warn">Level: Warn</option>
            <option value="info">Level: Info</option>
            <option value="security">Level: Security</option>
            <option value="debug">Level: Debug</option>
          </select>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as any)}
            className="logs-select"
            aria-label="Filter by category"
          >
            <option value="all">Category: All</option>
            <option value="ui">UI Clicks &amp; Modals [UI]</option>
            <option value="nav">Navigation [NAV]</option>
            <option value="ipc">IPC Bridge [IPC]</option>
            <option value="sync">Sync Engine [SYNC]</option>
            <option value="auth">Authentication [AUTH]</option>
            <option value="sec">Security Audit [SEC]</option>
            <option value="error">Errors [ERROR]</option>
            <option value="system">System Core [SYS]</option>
          </select>

          {/* Search Box */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search logs &amp; payload…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="logs-input"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '8px',
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Right Side: Retention, Live Toggle, Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#94a3b8' }}>
            <span>Expire after:</span>
            <select
              value={retentionMinutes}
              onChange={(e) => void handleRetentionChange(Number(e.target.value))}
              className="logs-select"
              aria-label="Log retention duration"
            >
              <option value={5}>5 min</option>
              <option value={15}>15 min (Default)</option>
              <option value={30}>30 min</option>
              <option value={60}>1 hour</option>
              <option value={0}>Until App Closes</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => setAutoScroll((prev) => !prev)}
            className={`logs-btn ${autoScroll ? 'logs-btn-primary' : 'logs-btn-secondary'}`}
            title={autoScroll ? 'Auto-scroll active — click to pause' : 'Stream paused — click to resume live scroll'}
          >
            <span>{autoScroll ? '● Live Stream' : '⏸ Paused'}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleExportLogs()}
            className="logs-btn logs-btn-secondary"
            title="Download sanitized logs file"
          >
            <span>📥 Export</span>
          </button>

          <button
            type="button"
            onClick={() => void handleClearLogs()}
            className="logs-btn logs-btn-danger"
            title="Clear all live logs"
          >
            <span>🗑️ Clear</span>
          </button>
        </div>
      </div>

      {exportNotice && (
        <div
          style={{
            padding: '8px 14px',
            borderRadius: '8px',
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.35)',
            color: '#86efac',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <span>{exportNotice}</span>
          <button
            type="button"
            onClick={() => setExportNotice(null)}
            style={{ background: 'transparent', border: 'none', color: '#86efac', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 3. Structured Console Window */}
      <div className="logs-console-window">
        {/* Terminal Header Bar */}
        <div className="logs-console-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ display: 'inline-flex', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }} />
            </span>
            <span style={{ fontWeight: 600, color: '#94a3b8' }}>LIVE EVENT CONSOLE</span>
          </div>
          <div>
            <span>
              Showing {filteredLogs.length} of {logs.length} events · Auto-purge: {retentionMinutes > 0 ? `${retentionMinutes}m TTL` : 'Off'}
            </span>
          </div>
        </div>

        {/* Log Entries Viewport */}
        <div ref={containerRef} className="logs-stream-viewport">
          {filteredLogs.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#94a3b8' }}>
                No log entries found
              </p>
              <p style={{ margin: '6px 0 0', fontSize: '12px' }}>
                Events will appear here in real time as actions, sync jobs, or errors occur.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {filteredLogs.map((entry) => {
                const isExpanded = Boolean(expandedLogIds[entry.id])
                const hasMeta = Boolean(
                  entry.meta &&
                    typeof entry.meta === 'object' &&
                    Object.keys(entry.meta as Record<string, unknown>).length > 0
                )

                // Level colors
                let levelBadgeStyle: React.CSSProperties = {
                  background: 'rgba(51, 65, 85, 0.6)',
                  color: '#cbd5e1',
                  border: '1px solid rgba(255, 255, 255, 0.1)'
                }
                let msgColor = '#f1f5f9'

                if (entry.level === 'error') {
                  levelBadgeStyle = {
                    background: 'rgba(239, 68, 68, 0.2)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.4)'
                  }
                  msgColor = '#f87171'
                } else if (entry.level === 'warn') {
                  levelBadgeStyle = {
                    background: 'rgba(245, 158, 11, 0.2)',
                    color: '#fde68a',
                    border: '1px solid rgba(245, 158, 11, 0.4)'
                  }
                  msgColor = '#fbbf24'
                } else if (entry.level === 'security') {
                  levelBadgeStyle = {
                    background: 'rgba(168, 85, 247, 0.2)',
                    color: '#e9d5ff',
                    border: '1px solid rgba(168, 85, 247, 0.4)'
                  }
                  msgColor = '#c084fc'
                }

                // Category colors
                let catBadgeStyle: React.CSSProperties = {
                  background: 'rgba(30, 41, 59, 0.8)',
                  color: '#94a3b8',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }

                if (entry.category === 'ui') {
                  catBadgeStyle = { background: 'rgba(59, 130, 246, 0.15)', color: '#93c5fd', border: '1px solid rgba(59, 130, 246, 0.3)' }
                } else if (entry.category === 'nav') {
                  catBadgeStyle = { background: 'rgba(147, 51, 234, 0.15)', color: '#d8b4fe', border: '1px solid rgba(147, 51, 234, 0.3)' }
                } else if (entry.category === 'sync') {
                  catBadgeStyle = { background: 'rgba(6, 182, 212, 0.15)', color: '#67e8f9', border: '1px solid rgba(6, 182, 212, 0.3)' }
                } else if (entry.category === 'ipc') {
                  catBadgeStyle = { background: 'rgba(20, 184, 166, 0.15)', color: '#5eead4', border: '1px solid rgba(20, 184, 166, 0.3)' }
                } else if (entry.category === 'auth') {
                  catBadgeStyle = { background: 'rgba(16, 185, 129, 0.15)', color: '#6ee7b7', border: '1px solid rgba(16, 185, 129, 0.3)' }
                } else if (entry.category === 'sec') {
                  catBadgeStyle = { background: 'rgba(245, 158, 11, 0.15)', color: '#fcd34d', border: '1px solid rgba(245, 158, 11, 0.3)' }
                } else if (entry.category === 'error') {
                  catBadgeStyle = { background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.3)' }
                }

                return (
                  <div key={entry.id} className={`log-item-row ${entry.level === 'error' ? 'is-error' : ''}`}>
                    <div className="log-row-main">
                      <div className="log-row-left">
                        {/* Time */}
                        <span className="log-time" title={entry.ts}>
                          {formatExactTime(entry.ts)} ({formatRelativeTime(entry.ts)})
                        </span>

                        {/* Level */}
                        <span className="log-badge-level" style={levelBadgeStyle}>
                          {entry.level}
                        </span>

                        {/* Category */}
                        <span className="log-badge-cat" style={catBadgeStyle}>
                          [{entry.category.toUpperCase()}]
                        </span>

                        {/* Message */}
                        <span className="log-message-text" style={{ color: msgColor }}>
                          {entry.message}
                        </span>
                      </div>

                      {/* Payload toggle button */}
                      {hasMeta ? (
                        <button
                          type="button"
                          onClick={() => toggleExpand(entry.id)}
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '3px 8px',
                            borderRadius: '4px',
                            background: isExpanded ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                            color: isExpanded ? '#c7d2fe' : '#94a3b8',
                            border: isExpanded ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {isExpanded ? 'Hide Payload ▲' : 'Payload { }'}
                        </button>
                      ) : null}
                    </div>

                    {/* Expandable JSON Metadata */}
                    {hasMeta && isExpanded ? (
                      <div className="log-payload-box">
                        <pre style={{ margin: 0 }}>{JSON.stringify(entry.meta, null, 2)}</pre>
                      </div>
                    ) : null}
                  </div>
                )
              })}
              <div ref={streamEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
