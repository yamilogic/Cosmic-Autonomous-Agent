import React, { useState } from 'react'

export type NavbarState = 'reading' | 'waiting_for_user' | 'paused' | 'challenge' | 'finished' | 'queued' | 'idle'

export interface ScrapeSnippet {
  sender: string
  snippet: string
  channelName?: string
  ts: string
}

export interface ScrapeNavbarProps {
  state: NavbarState
  workspaceName?: string
  channelName?: string
  progressText?: string
  statusText?: string
  snippets?: ScrapeSnippet[]
  onPause?: () => void
  onResume?: () => void
  onStop?: () => void
  onBackToDashboard?: () => void
  onOpenLogs?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

const STATE_DOTS: Record<NavbarState, { color: string; label: string }> = {
  reading: { color: '#22c55e', label: 'Reading' },
  waiting_for_user: { color: '#f59e0b', label: 'Waiting for you' },
  paused: { color: '#94a3b8', label: 'Paused' },
  challenge: { color: '#ef4444', label: 'Action required' },
  finished: { color: '#22c55e', label: 'Finished' },
  queued: { color: '#a855f7', label: 'Queued' },
  idle: { color: '#64748b', label: 'Idle' }
}

export const ScrapeNavbar: React.FC<ScrapeNavbarProps> = ({
  state,
  workspaceName = 'AgentWork',
  channelName,
  progressText,
  statusText,
  snippets = [],
  onPause,
  onResume,
  onStop,
  onBackToDashboard,
  onOpenLogs,
  collapsed = false,
  onToggleCollapse
}) => {
  const [showFeedDropdown, setShowFeedDropdown] = useState(false)

  if (state === 'idle') {
    return null
  }

  if (collapsed) {
    return (
      <div
        data-testid="scrape-navbar-collapsed"
        onClick={onToggleCollapse}
        title="Click to expand Cosmic Reader Navbar"
        style={{
          height: '5px',
          width: '100%',
          backgroundColor: STATE_DOTS[state].color,
          cursor: 'pointer',
          zIndex: 100,
          transition: 'height 0.15s ease'
        }}
      />
    )
  }

  const dot = STATE_DOTS[state]

  return (
    <div
      data-testid="scrape-navbar"
      style={{
        height: '32px',
        minHeight: '32px',
        width: '100%',
        backgroundColor: 'rgba(15, 23, 42, 0.96)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        color: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        fontSize: '12px',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
        zIndex: 100,
        position: 'relative',
        userSelect: 'none'
      }}
    >
      {/* Left Section: Status Dot & Progress Info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
        <span
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: dot.color,
            boxShadow: `0 0 6px ${dot.color}`
          }}
        />
        <strong style={{ color: '#e2e8f0', letterSpacing: '-0.01em' }}>Cosmic Reader</strong>
        <span style={{ color: 'rgba(255, 255, 255, 0.25)' }}>·</span>
        <span style={{ color: '#94a3b8' }}>{workspaceName}</span>
        {channelName && (
          <>
            <span style={{ color: 'rgba(255, 255, 255, 0.25)' }}>·</span>
            <span style={{ color: '#38bdf8', fontWeight: 500 }}>{channelName}</span>
          </>
        )}
        {(progressText || statusText) && (
          <>
            <span style={{ color: 'rgba(255, 255, 255, 0.25)' }}>·</span>
            <span
              style={{
                color: state === 'waiting_for_user' ? '#f59e0b' : state === 'challenge' ? '#ef4444' : '#94a3b8',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                maxWidth: '280px'
              }}
              title={statusText || progressText}
            >
              {statusText || progressText}
            </span>
          </>
        )}
      </div>

      {/* Right Section: Action Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {state === 'reading' && onPause && (
          <button
            type="button"
            onClick={onPause}
            style={buttonStyle}
            title="Pause scraping"
          >
            ⏸ Pause
          </button>
        )}
        {state === 'paused' && onResume && (
          <button
            type="button"
            onClick={onResume}
            style={{ ...buttonStyle, color: '#22c55e' }}
            title="Resume scraping"
          >
            ▶ Resume
          </button>
        )}
        {onStop && (
          <button
            type="button"
            onClick={onStop}
            style={{ ...buttonStyle, color: '#f87171' }}
            title="Stop automation run"
          >
            ⏹ Stop
          </button>
        )}

        {/* Live Feed Toggle */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setShowFeedDropdown((v) => !v)}
            style={{ ...buttonStyle, color: showFeedDropdown ? '#38bdf8' : '#94a3b8' }}
            title="View recently read message snippets"
          >
            Feed ▾
          </button>

          {/* Feed Dropdown Popover */}
          {showFeedDropdown && (
            <div
              style={{
                position: 'absolute',
                top: '34px',
                right: 0,
                width: '320px',
                maxHeight: '260px',
                overflowY: 'auto',
                backgroundColor: 'rgba(15, 23, 42, 0.98)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '6px',
                padding: '8px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                zIndex: 200,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '4px' }}>
                Recent Read Messages ({snippets.length})
              </div>
              {snippets.length === 0 ? (
                <div style={{ fontSize: '11px', color: '#64748b', textAlign: 'center', padding: '12px 0' }}>
                  No snippets collected yet
                </div>
              ) : (
                snippets.slice(-8).reverse().map((s, idx) => (
                  <div
                    key={idx}
                    style={{
                      fontSize: '11px',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      padding: '6px 8px',
                      borderRadius: '4px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#38bdf8', marginBottom: '2px' }}>
                      <strong>{s.sender}</strong>
                      <span style={{ color: '#64748b', fontSize: '10px' }}>{s.channelName || ''}</span>
                    </div>
                    <div style={{ color: '#cbd5e1', wordBreak: 'break-word' }}>{s.snippet}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {onOpenLogs && (
          <button
            type="button"
            onClick={onOpenLogs}
            style={buttonStyle}
            title="Open Run Logs"
          >
            Logs
          </button>
        )}

        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            style={buttonStyle}
            title="Collapse navbar to slim line"
          >
            Hide ▴
          </button>
        )}

        {onBackToDashboard && (
          <button
            type="button"
            onClick={onBackToDashboard}
            style={{ ...buttonStyle, background: 'rgba(255, 255, 255, 0.08)', color: '#f8fafc' }}
            title="Return to Projects Dashboard"
          >
            ← Dashboard
          </button>
        )}
      </div>
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '4px',
  color: '#cbd5e1',
  fontSize: '11px',
  padding: '2px 8px',
  cursor: 'pointer',
  outline: 'none',
  transition: 'background 0.15s ease, color 0.15s ease'
}

