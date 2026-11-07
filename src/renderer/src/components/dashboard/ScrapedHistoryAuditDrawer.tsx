import type React from 'react'
import { useEffect, useState, useMemo } from 'react'
import type { DashboardChannelHistoryResult, ScrapedChannelMessage } from '../../../../shared/dashboard-contract'
import { dashboardApi } from '../../lib/dashboard-api'
import { useDashboardStore } from '../../hooks/useDashboard'

interface ScrapedHistoryAuditDrawerProps {
  open: boolean
  onClose: () => void
  projectId: string
  projectName: string
  selectedChannelId?: string
}

export default function ScrapedHistoryAuditDrawer({
  open,
  onClose,
  projectId,
  projectName,
  selectedChannelId
}: ScrapedHistoryAuditDrawerProps): React.ReactElement | null {
  const [loading, setLoading] = useState(false)
  const [reScraping, setReScraping] = useState(false)
  const [historyData, setHistoryData] = useState<DashboardChannelHistoryResult[]>([])
  const [activeChannelId, setActiveChannelId] = useState<string>('')
  const [filterText, setFilterText] = useState('')
  const [selectedDays, setSelectedDays] = useState<number>(30)
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({})

  const toggleThread = (parentTs: string): void => {
    setExpandedThreads((prev) => ({
      ...prev,
      [parentTs]: !prev[parentTs]
    }))
  }

  const handleRescrapeWindow = async (days: number): Promise<void> => {
    if (!projectId || !activeChannelId) return
    setReScraping(true)
    try {
      await useDashboardStore.getState().syncSource({
        projectId,
        options: {
          channelIds: [activeChannelId],
          days: days > 0 ? days : undefined,
          forceGenesis: days === 0,
          force30Days: days === 30
        }
      })
      await loadHistory()
    } finally {
      setReScraping(false)
    }
  }

  const loadHistory = async (): Promise<void> => {
    if (!projectId) return
    const api = dashboardApi()
    if (!api || typeof api.getChannelHistory !== 'function') {
      return
    }
    setLoading(true)
    try {
      const data = await api.getChannelHistory({ projectId })
      setHistoryData(data)
      if (data.length > 0) {
        if (selectedChannelId && data.some((d) => d.channelId === selectedChannelId)) {
          setActiveChannelId(selectedChannelId)
        } else if (!activeChannelId || !data.some((d) => d.channelId === activeChannelId)) {
          setActiveChannelId(data[0].channelId)
        }
      }
    } catch {
      setHistoryData([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      void loadHistory()
    }
  }, [open, projectId, selectedChannelId])

  const activeChannel = useMemo(() => {
    return historyData.find((d) => d.channelId === activeChannelId) ?? historyData[0]
  }, [historyData, activeChannelId])

  const { topLevelMessages, repliesByParent } = useMemo(() => {
    if (!activeChannel) return { topLevelMessages: [], repliesByParent: new Map<string, ScrapedChannelMessage[]>() }
    const topLevel: ScrapedChannelMessage[] = []
    const replies = new Map<string, ScrapedChannelMessage[]>()

    const parentIds = new Set<string>()
    for (const msg of activeChannel.messages) {
      if (!msg.threadTs || msg.threadTs === msg.ts) {
        parentIds.add(msg.ts)
      }
    }

    for (const msg of activeChannel.messages) {
      if (msg.threadTs && msg.threadTs !== msg.ts) {
        const list = replies.get(msg.threadTs) || []
        list.push(msg)
        replies.set(msg.threadTs, list)
        if (!parentIds.has(msg.threadTs)) {
          // If parent is not present in this message batch, keep orphan reply visible at top level
          topLevel.push(msg)
        }
      } else {
        topLevel.push(msg)
      }
    }

    return { topLevelMessages: topLevel, repliesByParent: replies }
  }, [activeChannel])

  const filteredTopLevelMessages = useMemo(() => {
    if (!activeChannel) return []
    const q = filterText.trim().toLowerCase()
    if (!q) return topLevelMessages
    return topLevelMessages.filter((m) => {
      const matchSelf = (m.text ?? '').toLowerCase().includes(q) || (m.user ?? '').toLowerCase().includes(q)
      if (matchSelf) return true
      const children = repliesByParent.get(m.ts) || []
      return children.some((c) => (c.text ?? '').toLowerCase().includes(q) || (c.user ?? '').toLowerCase().includes(q))
    })
  }, [activeChannel, topLevelMessages, repliesByParent, filterText])

  const timeWindowLabel = useMemo(() => {
    const end = new Date()
    const fmt = (d: Date): string => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    if (selectedDays === 0) {
      return `📅 Genesis: Inception – Present`
    }
    const start = new Date(Date.now() - selectedDays * 86400 * 1000)
    return `📅 ${selectedDays}-Day Window: ${fmt(start)} – ${fmt(end)}`
  }, [selectedDays])

  if (!open) return null

  const formatTs = (tsStr: string): string => {
    const num = Number(tsStr)
    if (!Number.isNaN(num) && num > 0) {
      return new Date(num * 1000).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    }
    return tsStr
  }

  const roleColor = (role?: string): string => {
    switch (role) {
      case 'client':
        return '#10b981' // emerald/green
      case 'me':
        return '#3b82f6' // blue
      case 'team':
        return '#8b5cf6' // purple
      case 'bot':
        return '#94a3b8' // slate/gray
      default:
        return '#10b981'
    }
  }

  return (
    <div
      className="dash-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'flex-end',
        animation: 'fadeIn 0.15s ease'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '720px',
          maxWidth: '90vw',
          height: '100vh',
          backgroundColor: '#111827',
          color: '#f9fafb',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.5)',
          borderLeft: '1px solid #374151'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #374151',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#1f2937'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>📜</span>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Scraped Channel History</h3>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#9ca3af' }}>
              {projectName} · Read from channel genesis for dashboard generation
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => void loadHistory()}
              disabled={loading}
              style={{
                background: '#374151',
                border: 'none',
                color: '#e5e7eb',
                borderRadius: '6px',
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              {loading ? 'Refreshing…' : '↻ Refresh'}
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9ca3af',
                fontSize: '20px',
                cursor: 'pointer',
                padding: '4px 8px'
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Channel Selector Pills & Filter */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #374151',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            backgroundColor: '#182234'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: '#9ca3af' }}>Channels:</span>
            {historyData.length === 0 && !loading ? (
              <span style={{ fontSize: '12px', color: '#6b7280' }}>No scraped channels found</span>
            ) : (
              historyData.map((ch) => (
                <button
                  key={ch.channelId}
                  onClick={() => setActiveChannelId(ch.channelId)}
                  style={{
                    backgroundColor: ch.channelId === activeChannel?.channelId ? '#3b82f6' : '#283548',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '16px',
                    padding: '4px 12px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontWeight: ch.channelId === activeChannel?.channelId ? 600 : 400
                  }}
                >
                  #{ch.channelName} ({ch.messages.length})
                </button>
              ))
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Filter messages or sender…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={{
                flex: 1,
                backgroundColor: '#111827',
                border: '1px solid #374151',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '13px',
                color: '#f9fafb'
              }}
            />
            {activeChannel ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: '11px',
                    color: '#60a5fa',
                    backgroundColor: '#1e3a8a33',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    border: '1px solid #1e40af55',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {timeWindowLabel}
                </span>
                <span style={{ fontSize: '12px', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                  Showing {filteredTopLevelMessages.length} msgs ({activeChannel.messages.length} total incl. replies)
                </span>

                {/* Segmented Time Window Selector */}
                <div
                  style={{
                    display: 'inline-flex',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    border: '1px solid #374151',
                    backgroundColor: '#111827'
                  }}
                >
                  {[
                    { label: '30d', days: 30 },
                    { label: '90d', days: 90 },
                    { label: '230d', days: 230 },
                    { label: 'Genesis', days: 0 }
                  ].map((tab) => (
                    <button
                      key={tab.days}
                      type="button"
                      onClick={() => setSelectedDays(tab.days)}
                      disabled={reScraping}
                      style={{
                        border: 'none',
                        padding: '3px 8px',
                        fontSize: '11px',
                        fontWeight: selectedDays === tab.days ? 600 : 400,
                        backgroundColor: selectedDays === tab.days ? '#2563eb' : 'transparent',
                        color: selectedDays === tab.days ? '#ffffff' : '#9ca3af',
                        cursor: reScraping ? 'not-allowed' : 'pointer'
                      }}
                      title={`Select ${tab.label} scraping horizon`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => void handleRescrapeWindow(selectedDays)}
                  disabled={reScraping}
                  style={{
                    backgroundColor: selectedDays === 0 ? '#4f46e5' : '#1e40af',
                    color: '#ffffff',
                    border: '1px solid #3b82f6',
                    borderRadius: '4px',
                    padding: '3px 10px',
                    fontSize: '11px',
                    cursor: reScraping ? 'not-allowed' : 'pointer',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title={`Re-scrape this channel for ${selectedDays === 0 ? 'full channel genesis' : `the last ${selectedDays} days`}`}
                >
                  {reScraping
                    ? `⏳ Scraping ${selectedDays === 0 ? 'Genesis' : `${selectedDays}d`}…`
                    : `🔄 Re-scrape ${selectedDays === 0 ? 'Genesis' : `${selectedDays} Days`}`}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Message Feed Container */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          {loading && historyData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
              Loading scraped channel history…
            </div>
          ) : !activeChannel || activeChannel.messages.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '60px 20px',
                color: '#9ca3af',
                backgroundColor: '#1f2937',
                borderRadius: '8px',
                border: '1px dashed #374151',
                margin: '20px 0'
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
              <h4 style={{ margin: '0 0 6px', color: '#e5e7eb' }}>No Scraped Messages Yet</h4>
              <p style={{ margin: 0, fontSize: '13px' }}>
                Click <strong>Scrape Now</strong> on this channel in the Sources modal to scrape all messages and documents from genesis.
              </p>
            </div>
          ) : filteredTopLevelMessages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
              No messages match filter &quot;{filterText}&quot;
            </div>
          ) : (
            filteredTopLevelMessages.map((msg: ScrapedChannelMessage, idx: number) => {
              const hasDocs = (msg.text ?? '').includes('[Document:')
              const childReplies = repliesByParent.get(msg.ts) || []
              const totalRepliesCount = Math.max(msg.replyCount || 0, childReplies.length)
              const isExpanded = !!expandedThreads[msg.ts]
              const isOrphanReply = !!(msg.threadTs && msg.threadTs !== msg.ts)

              return (
                <div
                  key={`${msg.ts}-${idx}`}
                  style={{
                    backgroundColor: '#1e293b',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    border: '1px solid #334155',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong style={{ fontSize: '13px', color: '#f1f5f9' }}>{msg.user || 'Anonymous'}</strong>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: `${roleColor(msg.role)}22`,
                          color: roleColor(msg.role),
                          border: `1px solid ${roleColor(msg.role)}55`,
                          fontWeight: 600,
                          textTransform: 'uppercase'
                        }}
                      >
                        {msg.role || 'client'}
                      </span>
                      {isOrphanReply ? (
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: '#3b82f622',
                            color: '#60a5fa',
                            border: '1px solid #3b82f655'
                          }}
                        >
                          ↳ Thread Reply
                        </span>
                      ) : null}
                    </div>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>{formatTs(msg.ts)}</span>
                  </div>

                  <div style={{ fontSize: '13px', lineHeight: 1.5, color: '#e2e8f0', wordBreak: 'break-word' }}>
                    {msg.text}
                  </div>

                  {hasDocs ? (
                    <div
                      style={{
                        marginTop: '4px',
                        padding: '6px 10px',
                        backgroundColor: '#0f172a',
                        borderRadius: '6px',
                        border: '1px solid #38bdf844',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '12px',
                        color: '#38bdf8'
                      }}
                    >
                      <span>📎</span>
                      <strong>Attached File / Word Document Extracted for AI Requirements</strong>
                    </div>
                  ) : null}

                  {totalRepliesCount > 0 ? (
                    <div style={{ marginTop: '6px' }}>
                      <button
                        type="button"
                        onClick={() => toggleThread(msg.ts)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          backgroundColor: isExpanded ? '#1e3a8a' : '#0f172a',
                          border: '1px solid #3b82f6',
                          color: '#93c5fd',
                          borderRadius: '6px',
                          padding: '4px 10px',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        <span>💬</span>
                        <span>
                          {totalRepliesCount} {totalRepliesCount === 1 ? 'reply' : 'replies'}
                        </span>
                        <span style={{ fontSize: '9px', marginLeft: '2px' }}>{isExpanded ? '▲' : '▼'}</span>
                      </button>
                    </div>
                  ) : null}

                  {isExpanded && (
                    <div
                      style={{
                        marginTop: '8px',
                        marginLeft: '8px',
                        paddingLeft: '14px',
                        borderLeft: '2px solid #3b82f6',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}
                    >
                      {childReplies.length === 0 ? (
                        <div style={{ fontSize: '11px', color: '#94a3b8', fontStyle: 'italic', padding: '4px 0' }}>
                          No reply content captured yet ({msg.replyCount} recorded in Slack). Click <strong>🔄 Re-scrape 30 Days</strong> to fetch live thread replies.
                        </div>
                      ) : (
                        childReplies.map((reply: ScrapedChannelMessage, rIdx: number) => {
                          const replyHasDocs = (reply.text ?? '').includes('[Document:')
                          return (
                            <div
                              key={`${reply.ts}-${rIdx}`}
                              style={{
                                backgroundColor: '#0f172a',
                                borderRadius: '6px',
                                padding: '8px 12px',
                                border: '1px solid #1e293b',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ color: '#3b82f6', fontSize: '12px' }}>↳</span>
                                  <strong style={{ fontSize: '12px', color: '#cbd5e1' }}>{reply.user || 'Anonymous'}</strong>
                                  <span
                                    style={{
                                      fontSize: '10px',
                                      padding: '1px 6px',
                                      borderRadius: '10px',
                                      backgroundColor: `${roleColor(reply.role)}22`,
                                      color: roleColor(reply.role),
                                      border: `1px solid ${roleColor(reply.role)}55`,
                                      fontWeight: 600,
                                      textTransform: 'uppercase'
                                    }}
                                  >
                                    {reply.role || 'client'}
                                  </span>
                                </div>
                                <span style={{ fontSize: '10px', color: '#64748b' }}>{formatTs(reply.ts)}</span>
                              </div>
                              <div style={{ fontSize: '12px', lineHeight: 1.45, color: '#cbd5e1', wordBreak: 'break-word', paddingLeft: '18px' }}>
                                {reply.text}
                              </div>
                              {replyHasDocs ? (
                                <div
                                  style={{
                                    marginLeft: '18px',
                                    marginTop: '2px',
                                    padding: '4px 8px',
                                    backgroundColor: '#020617',
                                    borderRadius: '4px',
                                    border: '1px solid #38bdf844',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '11px',
                                    color: '#38bdf8'
                                  }}
                                >
                                  <span>📎</span>
                                  <strong>Document Attachment in Thread</strong>
                                </div>
                              ) : null}
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer info bar */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #374151',
            backgroundColor: '#1f2937',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            color: '#9ca3af'
          }}
        >
          <span>
            {activeChannel?.lastSyncAt ? `Last scraped: ${new Date(activeChannel.lastSyncAt).toLocaleString()}` : ''}
          </span>
          <span>{activeChannel ? `${activeChannel.messages.length} message(s) & replies loaded` : '0 messages loaded'}</span>
        </div>
      </div>
    </div>
  )
}
