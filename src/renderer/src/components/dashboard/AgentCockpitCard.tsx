import React, { useEffect, useMemo, useState } from 'react'
import type { DashboardProject } from '../../../../shared/dashboard-contract'
import { useDashboardStore } from '../../hooks/useDashboard'

interface AgentCockpitCardProps {
  project: DashboardProject
  nextStep?: string | null
  situationLine?: string | null
  onOpenControl?: () => void
}

export function AgentCockpitCard({
  project,
  nextStep,
  onOpenControl
}: AgentCockpitCardProps): React.JSX.Element {
  const loadSnapshot = useDashboardStore((s) => s.loadSnapshot)

  // Channels with explicit agentWrite permission
  const authorizedChannels = useMemo(() => {
    const list: Array<{ id: string; name: string; isDm: boolean }> = []
    for (const source of project.sources ?? []) {
      for (const channel of source.channels ?? []) {
        if (channel.agentWrite === true) {
          list.push({
            id: channel.id,
            name: channel.name,
            isDm: Boolean(channel.isDm || channel.kind === 'dm')
          })
        }
      }
    }
    return list
  }, [project.sources])

  const [targetChannelId, setTargetChannelId] = useState<string>(
    authorizedChannels[0]?.id || ''
  )
  const [messageText, setMessageText] = useState<string>('')
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  // Sync selected channel when authorized channels change
  useEffect(() => {
    if (authorizedChannels.length > 0) {
      if (!targetChannelId || !authorizedChannels.some((c) => c.id === targetChannelId)) {
        setTargetChannelId(authorizedChannels[0].id)
      }
    } else {
      setTargetChannelId('')
    }
  }, [authorizedChannels, targetChannelId])

  // Pre-fill nextStep if messageText is empty
  useEffect(() => {
    if (nextStep && !messageText) {
      setMessageText(nextStep)
    }
  }, [nextStep])

  const handleSendMessage = async () => {
    if (!targetChannelId) {
      setFeedback({ type: 'error', message: 'Please select an authorized channel.' })
      return
    }
    const text = messageText.trim()
    if (!text) {
      setFeedback({ type: 'error', message: 'Message cannot be empty.' })
      return
    }

    setSending(true)
    setFeedback(null)
    try {
      const res = await window.api.dashboard.sendAgentMessage({
        projectId: project.id,
        channelId: targetChannelId,
        text
      })

      if (!res.ok) {
        setFeedback({
          type: 'error',
          message: res.error || 'Failed to dispatch message to Slack.'
        })
      } else {
        const ch = authorizedChannels.find((c) => c.id === targetChannelId)
        const name = ch ? (ch.isDm ? ch.name : `#${ch.name}`) : targetChannelId
        setFeedback({
          type: 'success',
          message: `Dispatched to ${name} via Direct API in ~150ms!`
        })
        setMessageText('')
        void loadSnapshot()
        setTimeout(() => setFeedback(null), 5000)
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error sending message.'
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <section
      className="dash-block dash-agent-cockpit"
      aria-label="Agent Messaging & Dispatcher"
      style={{
        borderRadius: 12,
        background: 'linear-gradient(180deg, rgba(30, 27, 75, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%)',
        border: '1px solid rgba(99, 102, 241, 0.25)',
        padding: '16px 20px',
        marginBottom: 16
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 10
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <div>
            <h5
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 700,
                color: '#f8fafc',
                letterSpacing: '0.02em'
              }}
            >
              Agent Control &amp; Slack Dispatcher
            </h5>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              Autonomous &amp; on-demand message execution with Zero-DOM Direct API
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {authorizedChannels.length > 0 ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#4ade80',
                background: 'rgba(74, 222, 128, 0.12)',
                padding: '3px 8px',
                borderRadius: 6,
                border: '1px solid rgba(74, 222, 128, 0.3)'
              }}
            >
              ● {authorizedChannels.length} Channel{authorizedChannels.length > 1 ? 's' : ''} Authorized
            </span>
          ) : (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#f59e0b',
                background: 'rgba(245, 158, 11, 0.12)',
                padding: '3px 8px',
                borderRadius: 6,
                border: '1px solid rgba(245, 158, 11, 0.3)'
              }}
            >
              ○ 0 Channels Authorized
            </span>
          )}

          {onOpenControl && (
            <button
              type="button"
              onClick={onOpenControl}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#a5b4fc',
                background: 'rgba(99, 102, 241, 0.16)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                borderRadius: 6,
                padding: '4px 10px',
                cursor: 'pointer',
                transition: 'all 0.12s ease'
              }}
            >
              ⚙️ Manage Permissions
            </button>
          )}
        </div>
      </div>

      {authorizedChannels.length === 0 ? (
        <div
          style={{
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            borderRadius: 8,
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 650, color: '#fbbf24' }}>
              No channels authorized for Agent Write
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
              To protect your workspace, the agent will never post messages without explicit permission.
              Enable &quot;Agent Write&quot; on channels or DMs in Workspace Control.
            </div>
          </div>
          {onOpenControl && (
            <button
              type="button"
              onClick={onOpenControl}
              style={{
                flexShrink: 0,
                fontSize: 12,
                fontWeight: 650,
                padding: '6px 14px',
                borderRadius: 6,
                background: '#f59e0b',
                color: '#000',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Grant Permissions
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Target Channel Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', flexShrink: 0 }}>
              Send to:
            </span>
            <select
              value={targetChannelId}
              onChange={(e) => setTargetChannelId(e.target.value)}
              style={{
                background: '#1e293b',
                color: '#f8fafc',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 6,
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                outline: 'none',
                minWidth: 220
              }}
            >
              {authorizedChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.isDm ? '👤 ' : '# '}
                  {c.name}
                </option>
              ))}
            </select>

            <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>
              Direct API (~150ms · Zero-DOM)
            </span>
          </div>

          {/* Quick Action Chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#64748b' }}>Quick prompts:</span>
            {nextStep && (
              <button
                type="button"
                onClick={() => setMessageText(nextStep)}
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: 'rgba(99, 102, 241, 0.15)',
                  border: '1px solid rgba(99, 102, 241, 0.35)',
                  color: '#a5b4fc',
                  cursor: 'pointer'
                }}
              >
                ⚡ Suggested: {nextStep.slice(0, 36)}…
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                setMessageText(
                  'Hi! Just checking in on project specifications and requirements. Let us know how we can assist.'
                )
              }
              style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 4,
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#cbd5e1',
                cursor: 'pointer'
              }}
            >
              Check-in on Requirements
            </button>
            <button
              type="button"
              onClick={() =>
                setMessageText(
                  'Project Status Update: All deliverables for the current sprint are on track. Awaiting review.'
                )
              }
              style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 4,
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#cbd5e1',
                cursor: 'pointer'
              }}
            >
              Sprint Update
            </button>
          </div>

          {/* Text Editor */}
          <div style={{ position: 'relative' }}>
            <textarea
              rows={3}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Type a message or select a recommended action above…"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'rgba(15, 23, 42, 0.8)',
                color: '#f8fafc',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 13,
                fontFamily: 'inherit',
                resize: 'vertical',
                outline: 'none',
                lineHeight: 1.5
              }}
            />
          </div>

          {/* Footer Controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10
            }}
          >
            <div>
              {feedback && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: feedback.type === 'success' ? '#4ade80' : '#f87171',
                    background:
                      feedback.type === 'success'
                        ? 'rgba(74, 222, 128, 0.12)'
                        : 'rgba(248, 113, 113, 0.12)',
                    padding: '4px 10px',
                    borderRadius: 6
                  }}
                >
                  {feedback.type === 'success' ? '✓ ' : '✕ '}
                  {feedback.message}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              {messageText && (
                <button
                  type="button"
                  onClick={() => setMessageText('')}
                  style={{
                    fontSize: 12,
                    color: '#94a3b8',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '6px 10px'
                  }}
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSendMessage()}
                disabled={sending || !messageText.trim()}
                style={{
                  fontSize: 12,
                  fontWeight: 650,
                  padding: '7px 18px',
                  background: '#6366f1',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: sending || !messageText.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <span>{sending ? '⏳ Posting to Slack…' : '🚀 Send to Slack Now'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

