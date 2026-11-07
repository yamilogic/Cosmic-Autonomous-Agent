import React, { useState } from 'react'

export type BorderState = 'reading' | 'waiting_for_user' | 'paused' | 'challenge' | 'idle'

interface LiveSessionBorderProps {
  state: BorderState
  visible: boolean
  borderStyle?: 'thin' | 'glow'
  onPause?: () => void
  onResume?: () => void
  onStop?: () => void
  onBackToDashboard?: () => void
  statusText?: string
  snippets?: Array<{ sender: string; snippet: string; channelName?: string; ts: string }>
}

const STATE_COLORS: Record<BorderState, { border: string; shadow: string; label: string }> = {
  reading: {
    border: '#22c55e',
    shadow: '0 0 12px rgba(34, 197, 94, 0.45)',
    label: 'Scraping Active'
  },
  waiting_for_user: {
    border: '#f59e0b',
    shadow: '0 0 12px rgba(245, 158, 11, 0.45)',
    label: 'Waiting for You (User Active)'
  },
  paused: {
    border: '#94a3b8',
    shadow: 'none',
    label: 'Scraping Paused'
  },
  challenge: {
    border: '#ef4444',
    shadow: '0 0 14px rgba(239, 68, 68, 0.55)',
    label: 'Action Required (Captcha/Login)'
  },
  idle: {
    border: 'transparent',
    shadow: 'none',
    label: 'Idle'
  }
}

export const LiveSessionBorder: React.FC<LiveSessionBorderProps> = ({
  state,
  visible,
  borderStyle = 'thin',
  onPause,
  onResume,
  onStop,
  onBackToDashboard,
  statusText,
  snippets = []
}) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showLiveFeed, setShowLiveFeed] = useState(false)

  if (!visible || state === 'idle') return null

  const colorCfg = STATE_COLORS[state]

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1000,
        border: `3px solid ${colorCfg.border}`,
        boxShadow: borderStyle === 'glow' ? colorCfg.shadow : 'none',
        transition: 'border-color 0.3s ease, box-shadow 0.3s ease'
      }}
    >
      {/* Slim Top Control Strip */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          pointerEvents: 'auto',
          background: isExpanded ? 'rgba(15, 23, 42, 0.95)' : colorCfg.border,
          borderBottom: isExpanded ? `1px solid ${colorCfg.border}` : 'none',
          boxShadow: isExpanded ? '0 4px 20px rgba(0, 0, 0, 0.6)' : 'none',
          backdropFilter: isExpanded ? 'blur(8px)' : 'none',
          height: isExpanded ? 'auto' : '6px',
          minHeight: isExpanded ? '36px' : '6px',
          cursor: isExpanded ? 'default' : 'pointer',
          transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={() => {
          if (!isExpanded) setIsExpanded(true)
        }}
        title={!isExpanded ? 'Click to expand Scraping Control Strip' : undefined}
      >
        {/* Expanded Controls Header */}
        {isExpanded && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 14px',
              fontSize: '12px',
              color: '#f8fafc'
            }}
          >
            {/* Status indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: colorCfg.border,
                  boxShadow: `0 0 6px ${colorCfg.border}`
                }}
              />
              <span style={{ fontWeight: 600 }}>{colorCfg.label}:</span>
              <span style={{ color: '#cbd5e1' }}>
                {statusText || 'Scraping messages in real-time…'}
              </span>
            </div>

            {/* Actions & Toggles */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setShowLiveFeed((v) => !v)}
                style={{
                  background: showLiveFeed ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#f8fafc',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
              >
                {showLiveFeed ? 'Hide Live Feed' : 'Live Feed'}
              </button>

              {state === 'reading' && onPause && (
                <button
                  type="button"
                  onClick={onPause}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#f8fafc',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px'
                  }}
                >
                  ⏸ Pause
                </button>
              )}

              {state === 'paused' && onResume && (
                <button
                  type="button"
                  onClick={onResume}
                  style={{
                    background: 'rgba(34, 197, 94, 0.2)',
                    border: '1px solid #22c55e',
                    color: '#4ade80',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px'
                  }}
                >
                  ▶ Resume
                </button>
              )}

              {onBackToDashboard && (
                <button
                  type="button"
                  onClick={onBackToDashboard}
                  style={{
                    background: 'rgba(99, 102, 241, 0.25)',
                    border: '1px solid #6366f1',
                    color: '#c7d2fe',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 500
                  }}
                  title="Return to Dashboard view"
                >
                  ← Dashboard
                </button>
              )}
              {onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  style={{
                    background: 'rgba(239, 68, 68, 0.2)',
                    border: '1px solid #ef4444',
                    color: '#f87171',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px'
                  }}
                >
                  ⏹ Stop
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  padding: '2px 6px',
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
                title="Collapse strip"
              >
                ▲
              </button>
            </div>
          </div>
        )}

        {/* Live Feed Snippets Dropdown */}
        {isExpanded && showLiveFeed && (
          <div
            style={{
              maxHeight: '160px',
              overflowY: 'auto',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'rgba(2, 6, 23, 0.9)',
              padding: '8px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            {snippets.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: '11px', textAlign: 'center' }}>
                Listening for messages...
              </div>
            ) : (
              snippets.slice(-10).map((s, idx) => (
                <div
                  key={idx}
                  style={{
                    fontSize: '11px',
                    display: 'flex',
                    gap: '6px',
                    alignItems: 'baseline'
                  }}
                >
                  <span style={{ color: '#818cf8', fontWeight: 600 }}>
                    #{s.channelName || 'channel'}:
                  </span>
                  <span style={{ color: '#94a3b8' }}>{s.sender}</span>
                  <span style={{ color: '#e2e8f0', flex: 1 }}>{s.snippet}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

