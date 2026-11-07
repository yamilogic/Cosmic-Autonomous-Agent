import React, { useEffect, useMemo, useState } from 'react'
import type {
  DashboardProject,
  ProjectSource,
  ProjectSourceChannel,
  ProjectSourceSelectionMode
} from '../../../../shared/dashboard-contract'
import { useDashboardStore } from '../../hooks/useDashboard'
import { ScrapeLogExplorer } from './RunLogsModal'

interface WorkspaceControlModalProps {
  open: boolean
  onClose: () => void
  project: DashboardProject
  source: ProjectSource
  onSaved?: () => void
}

type ControlTab = 'channels' | 'schedules' | 'logs'

function kindLabel(channel: ProjectSourceChannel): string {
  if (channel.isDm || channel.kind === 'dm') return 'DM'
  if (channel.isPrivate || channel.kind === 'private') return 'Private'
  return 'Public'
}

export function WorkspaceControlModal({
  open,
  onClose,
  project,
  source,
  onSaved
}: WorkspaceControlModalProps): React.JSX.Element | null {
  const syncNow = useDashboardStore((s) => s.syncNow)
  const updateSource = useDashboardStore((s) => s.updateSource)
  const loadSnapshot = useDashboardStore((s) => s.loadSnapshot)

  const [activeTab, setActiveTab] = useState<ControlTab>('channels')

  // Channels 4-tier stacked permissions state
  const [channels, setChannels] = useState<ProjectSourceChannel[]>([])
  const [selectedDashboard, setSelectedDashboard] = useState<Set<string>>(new Set())
  const [selectedAgentRead, setSelectedAgentRead] = useState<Set<string>>(new Set())
  const [selectedAgentWrite, setSelectedAgentWrite] = useState<Set<string>>(new Set())
  const [selectedAutoReply, setSelectedAutoReply] = useState<Set<string>>(new Set())
  const [channelSearch, setChannelSearch] = useState('')
  const [selectionMode, setSelectionMode] = useState<ProjectSourceSelectionMode>(
    source.selectionMode ?? 'include'
  )
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [savingChannels, setSavingChannels] = useState(false)
  const [channelsError, setChannelsError] = useState<string | null>(null)

  // Schedules state
  const [scheduleEnabled, setScheduleEnabled] = useState(source.scheduleEnabled ?? true)
  const [intervalMinutes, setIntervalMinutes] = useState<number>(
    source.scheduleIntervalMinutes ?? 0.333
  )
  const [engineMode, setEngineMode] = useState<'direct_api' | 'browser'>(
    source.engineMode ?? 'direct_api'
  )
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [manualSyncing, setManualSyncing] = useState(false)
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setChannelsLoading(true)
    setChannelsError(null)
    setSelectionMode(source.selectionMode ?? 'include')
    setScheduleEnabled(source.scheduleEnabled ?? true)
    setIntervalMinutes(source.scheduleIntervalMinutes ?? 0.333)
    setEngineMode(source.engineMode ?? 'direct_api')

    const existing = new Map((source.channels ?? []).map((c) => [c.id, c]))
    const dashSet = new Set<string>()
    const agentReadSet = new Set<string>()
    const agentWriteSet = new Set<string>()
    const autoReplySet = new Set<string>()
    for (const c of source.channels ?? []) {
      if (c.enabled === true) dashSet.add(c.id)
      if (c.agentRead === true) agentReadSet.add(c.id)
      if (c.agentWrite === true) agentWriteSet.add(c.id)
      if (c.autoReply === true) autoReplySet.add(c.id)
    }
    setSelectedDashboard(dashSet)
    setSelectedAgentRead(agentReadSet)
    setSelectedAgentWrite(agentWriteSet)
    setSelectedAutoReply(autoReplySet)

    void window.api.dashboard
      .discoverSourceChannels({
        projectId: project.id,
        sourceId: source.id,
        profileId: source.profileId,
        workspaceId: source.workspaceId
      })
      .then((result) => {
        if (!alive) return
        if (result.error) setChannelsError(result.error)
        if (result.channels.length === 0) {
          setChannels(source.channels ?? [])
          return
        }
        setChannels(
          result.channels.map((channel) => {
            const previous = existing.get(channel.id)
            return {
              ...channel,
              enabled: previous ? previous.enabled === true : false,
              agentRead: previous ? previous.agentRead === true : false,
              agentWrite: previous ? previous.agentWrite === true : false,
              autoReply: previous ? previous.autoReply === true : false
            }
          })
        )
      })
      .catch((err) => {
        if (!alive) return
        setChannelsError(err instanceof Error ? err.message : 'Channel discovery failed')
        setChannels(source.channels ?? [])
      })
      .finally(() => {
        if (alive) setChannelsLoading(false)
      })

    return () => {
      alive = false
    }
  }, [open, project.id, source])

  const filteredChannels = useMemo(() => {
    const q = channelSearch.trim().toLowerCase()
    if (!q) return channels
    return channels.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
  }, [channels, channelSearch])

  const grouped = useMemo(() => {
    const publicChannels: ProjectSourceChannel[] = []
    const privateChannels: ProjectSourceChannel[] = []
    const dms: ProjectSourceChannel[] = []
    for (const channel of filteredChannels) {
      if (channel.isDm || channel.kind === 'dm') dms.push(channel)
      else if (channel.isPrivate || channel.kind === 'private') privateChannels.push(channel)
      else publicChannels.push(channel)
    }
    return { publicChannels, privateChannels, dms }
  }, [filteredChannels])

  if (!open) return null

  const toggleDashboard = (id: string) => {
    setSelectedDashboard((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAgentRead = (id: string) => {
    setSelectedAgentRead((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAgentWrite = (id: string) => {
    setSelectedAgentWrite((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAutoReply = (id: string) => {
    setSelectedAutoReply((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearAllPermissions = () => {
    setSelectedDashboard(new Set())
    setSelectedAgentRead(new Set())
    setSelectedAgentWrite(new Set())
    setSelectedAutoReply(new Set())
  }

  const selectAllDashboard = () => {
    setSelectedDashboard(new Set(channels.map((c) => c.id)))
  }

  const selectAllAgentRead = () => {
    setSelectedAgentRead(new Set(channels.map((c) => c.id)))
  }

  const selectAllAgentWrite = () => {
    setSelectedAgentWrite(new Set(channels.map((c) => c.id)))
  }

  const selectAllAutoReply = () => {
    setSelectedAutoReply(new Set(channels.map((c) => c.id)))
  }

  const handleSaveChannels = async () => {
    setSavingChannels(true)
    try {
      const updatedChannels: ProjectSourceChannel[] = channels.map((channel) => ({
        ...channel,
        enabled: selectedDashboard.has(channel.id),
        agentRead: selectedAgentRead.has(channel.id),
        agentWrite: selectedAgentWrite.has(channel.id),
        autoReply: selectedAutoReply.has(channel.id)
      }))

      await updateSource({
        projectId: project.id,
        sourceId: source.id,
        patch: {
          channels: updatedChannels,
          selectionMode,
          channelsReviewedAt: new Date().toISOString()
        }
      })
      await loadSnapshot()
      onSaved?.()
      setSyncFeedback('Channel permissions saved successfully.')
      setTimeout(() => setSyncFeedback(null), 3000)
    } catch (err) {
      setChannelsError(err instanceof Error ? err.message : 'Failed to save channels')
    } finally {
      setSavingChannels(false)
    }
  }

  const handleUpdateSchedule = async (enabled: boolean, interval: number) => {
    setSavingSchedule(true)
    setScheduleEnabled(enabled)
    setIntervalMinutes(interval)
    try {
      await updateSource({
        projectId: project.id,
        sourceId: source.id,
        patch: {
          scheduleEnabled: enabled,
          scheduleIntervalMinutes: interval as any
        }
      })
      await loadSnapshot()
      onSaved?.()
      setSyncFeedback('Schedule settings updated.')
      setTimeout(() => setSyncFeedback(null), 3000)
    } catch (err) {
      setSyncFeedback(err instanceof Error ? err.message : 'Failed to update schedule')
    } finally {
      setSavingSchedule(false)
    }
  }

  const handleUpdateEngineMode = async (mode: 'direct_api' | 'browser') => {
    setEngineMode(mode)
    try {
      await updateSource({
        projectId: project.id,
        sourceId: source.id,
        patch: {
          engineMode: mode
        }
      })
      await loadSnapshot()
      onSaved?.()
      setSyncFeedback(
        `Engine switched to ${mode === 'direct_api' ? '⚡ Direct API' : '🌐 Browser DOM'}.`
      )
      setTimeout(() => setSyncFeedback(null), 3500)
    } catch (err) {
      setSyncFeedback(err instanceof Error ? err.message : 'Failed to update engine mode')
    }
  }

  const handleManualScrapeNow = async () => {
    setManualSyncing(true)
    setSyncFeedback('Scraping initiated across selected channels…')
    try {
      await syncNow(project.id)
      await loadSnapshot()
      setSyncFeedback('Scrape finished. Dashboard updated!')
      setTimeout(() => setSyncFeedback(null), 4000)
    } catch (err) {
      setSyncFeedback(err instanceof Error ? err.message : 'Scrape encountered an issue.')
    } finally {
      setManualSyncing(false)
    }
  }

  const renderGroup = (
    label: string,
    items: ProjectSourceChannel[],
    emptyMessage: string
  ) => {
    if (items.length === 0) {
      return (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            {label} (0)
          </div>
          <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', padding: '6px 0' }}>
            {emptyMessage}
          </div>
        </div>
      )
    }

    return (
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{label} ({items.length})</span>
        </div>

        <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(255, 255, 255, 0.02)' }}>
          {/* Stacked Matrix Table Header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 1fr) 125px 125px 125px 125px',
              padding: '8px 16px',
              background: 'rgba(255, 255, 255, 0.04)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              fontSize: 11,
              fontWeight: 700,
              color: '#94a3b8',
              letterSpacing: '0.04em'
            }}
          >
            <div>Channel / Person</div>
            <div style={{ textAlign: 'center' }}>📊 Dashboard Scrape</div>
            <div style={{ textAlign: 'center' }}>🤖 Agent Read</div>
            <div style={{ textAlign: 'center' }}>✍️ Agent Write</div>
            <div style={{ textAlign: 'center' }} title="Real-time automated reply in 1-on-1 DMs and when mentioned in channels">
              ⚡ Auto-Reply
            </div>
          </div>

          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {items.map((channel) => {
              const isDash = selectedDashboard.has(channel.id)
              const isRead = selectedAgentRead.has(channel.id)
              const isWrite = selectedAgentWrite.has(channel.id)
              const isAutoReply = selectedAutoReply.has(channel.id)
              return (
                <div
                  key={channel.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(220px, 1fr) 125px 125px 125px 125px',
                    alignItems: 'center',
                    padding: '8px 16px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                    background:
                      isDash || isRead || isWrite || isAutoReply
                        ? 'rgba(99, 102, 241, 0.05)'
                        : 'transparent',
                    transition: 'background 0.12s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, paddingRight: 12 }}>
                    <span style={{ fontSize: 14, color: channel.isDm ? '#38bdf8' : channel.isPrivate ? '#f59e0b' : '#a855f7' }}>
                      {channel.isDm ? '👤' : channel.isPrivate ? '🔒' : '#'}
                    </span>
                    <div style={{ minWidth: 0, overflow: 'hidden' }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#f8fafc',
                          textOverflow: 'ellipsis',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {channel.name}
                      </div>
                      {channel.topic && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#64748b',
                            textOverflow: 'ellipsis',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {channel.topic}
                        </div>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        color: '#94a3b8',
                        background: 'rgba(255, 255, 255, 0.06)',
                        padding: '2px 6px',
                        borderRadius: 4,
                        marginLeft: 'auto',
                        flexShrink: 0
                      }}
                    >
                      {kindLabel(channel)}
                    </span>
                  </div>

                  {/* Dashboard Scrape Toggle */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: isDash ? 'rgba(99, 102, 241, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                        border: isDash ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                        transition: 'all 0.12s ease'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isDash}
                        onChange={() => toggleDashboard(channel.id)}
                        style={{ cursor: 'pointer', accentColor: '#6366f1' }}
                      />
                      <span style={{ fontSize: 11, fontWeight: 600, color: isDash ? '#a5b4fc' : '#64748b' }}>
                        {isDash ? 'Enabled' : 'Off'}
                      </span>
                    </label>
                  </div>

                  {/* Agent Read Toggle */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: isRead ? 'rgba(16, 185, 129, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                        border: isRead ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                        transition: 'all 0.12s ease'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isRead}
                        onChange={() => toggleAgentRead(channel.id)}
                        style={{ cursor: 'pointer', accentColor: '#10b981' }}
                      />
                      <span style={{ fontSize: 11, fontWeight: 600, color: isRead ? '#6ee7b7' : '#64748b' }}>
                        {isRead ? 'Read' : 'Off'}
                      </span>
                    </label>
                  </div>

                  {/* Agent Write Toggle */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: isWrite ? 'rgba(245, 158, 11, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                        border: isWrite ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                        transition: 'all 0.12s ease'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isWrite}
                        onChange={() => toggleAgentWrite(channel.id)}
                        style={{ cursor: 'pointer', accentColor: '#f59e0b' }}
                      />
                      <span style={{ fontSize: 11, fontWeight: 600, color: isWrite ? '#fcd34d' : '#64748b' }}>
                        {isWrite ? 'Write' : 'Off'}
                      </span>
                    </label>
                  </div>

                  {/* Real-Time Auto-Reply Toggle */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <label
                      title="Real-time automated reply in 1-on-1 DMs and when mentioned in channels"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: isAutoReply ? 'rgba(6, 182, 212, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                        border: isAutoReply ? '1px solid rgba(6, 182, 212, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                        transition: 'all 0.12s ease'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isAutoReply}
                        onChange={() => toggleAutoReply(channel.id)}
                        style={{ cursor: 'pointer', accentColor: '#06b6d4' }}
                      />
                      <span style={{ fontSize: 11, fontWeight: 600, color: isAutoReply ? '#67e8f9' : '#64748b' }}>
                        {isAutoReply ? 'Auto' : 'Off'}
                      </span>
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="add-platform-backdrop" onClick={onClose} style={{ zIndex: 1200 }}>
      <div
        className="add-platform-panel accounts-hub-panel"
        style={{
          width: 'min(1440px, 98vw)',
          height: 'min(92vh, 920px)',
          maxHeight: 'min(92vh, 920px)',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: '#090d16',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.65)'
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Workspace Control"
      >
        {/* Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(15, 23, 42, 0.85)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 24 }}>⚙️</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>
                Workspace Control · {source.workspaceName || project.name}
              </h2>
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
                Channel discovery &amp; selection • Automated scrape scheduling • Detailed scraping logs
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {syncFeedback && (
              <span style={{ fontSize: 12, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', padding: '4px 10px', borderRadius: 6 }}>
                {syncFeedback}
              </span>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleManualScrapeNow()}
              disabled={manualSyncing}
              style={{
                fontSize: 12,
                fontWeight: 650,
                padding: '6px 14px',
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: manualSyncing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span>{manualSyncing ? '⏳ Scraping…' : '▶ Scrape Now'}</span>
            </button>
            <button
              type="button"
              className="btn ghost btn-sm"
              onClick={onClose}
              style={{ fontSize: 13, color: '#94a3b8', padding: '6px 12px' }}
            >
              ✕ Close
            </button>
          </div>
        </header>

        {/* 2-Column Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left Navigation Rail */}
          <aside
            style={{
              width: 260,
              borderRight: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(15, 23, 42, 0.5)',
              padding: '18px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              overflowY: 'auto'
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 8px 4px' }}>
              Control Options
            </div>

            <button
              type="button"
              onClick={() => setActiveTab('channels')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 8,
                background: activeTab === 'channels' ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                color: activeTab === 'channels' ? '#a5b4fc' : '#cbd5e1',
                border: activeTab === 'channels' ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'left',
                transition: 'all 0.12s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>📋</span>
                <span>Select Channels</span>
              </div>
              <span style={{ fontSize: 10, color: '#4ade80', background: 'rgba(74, 222, 128, 0.12)', padding: '2px 6px', borderRadius: 4 }}>
                {selectedDashboard.size} Dash · {selectedAgentRead.size} Read · {selectedAgentWrite.size} Write · {selectedAutoReply.size} Auto-Reply
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('schedules')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 8,
                background: activeTab === 'schedules' ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                color: activeTab === 'schedules' ? '#a5b4fc' : '#cbd5e1',
                border: activeTab === 'schedules' ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'left',
                transition: 'all 0.12s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>⏱️</span>
                <span>Schedules &amp; Trigger</span>
              </div>
              <span style={{ fontSize: 11, color: scheduleEnabled ? '#4ade80' : '#94a3b8', background: 'rgba(255, 255, 255, 0.06)', padding: '2px 6px', borderRadius: 4 }}>
                {scheduleEnabled ? `${intervalMinutes}m` : 'Paused'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('logs')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 8,
                background: activeTab === 'logs' ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                color: activeTab === 'logs' ? '#a5b4fc' : '#cbd5e1',
                border: activeTab === 'logs' ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'left',
                transition: 'all 0.12s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>🕷️</span>
                <span>Scrape Logs</span>
              </div>
            </button>

            {/* Active Engine Switch */}
            <div
              style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  padding: '0 8px 8px'
                }}
              >
                Active Ingestion Engine
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 4px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background:
                      engineMode === 'direct_api'
                        ? 'rgba(16, 185, 129, 0.15)'
                        : 'rgba(255,255,255,0.02)',
                    border:
                      engineMode === 'direct_api'
                        ? '1px solid rgba(16, 185, 129, 0.4)'
                        : '1px solid rgba(255,255,255,0.06)',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="radio"
                    name="workspaceEngineMode"
                    value="direct_api"
                    checked={engineMode === 'direct_api'}
                    onChange={() => void handleUpdateEngineMode('direct_api')}
                    style={{ accentColor: '#10b981' }}
                  />
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: engineMode === 'direct_api' ? '#a7f3d0' : '#cbd5e1'
                      }}
                    >
                      ⚡ Direct API Engine
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>
                      ~150ms · Zero missed messages
                    </div>
                  </div>
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background:
                      engineMode === 'browser'
                        ? 'rgba(59, 130, 246, 0.15)'
                        : 'rgba(255,255,255,0.02)',
                    border:
                      engineMode === 'browser'
                        ? '1px solid rgba(59, 130, 246, 0.4)'
                        : '1px solid rgba(255,255,255,0.06)',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="radio"
                    name="workspaceEngineMode"
                    value="browser"
                    checked={engineMode === 'browser'}
                    onChange={() => void handleUpdateEngineMode('browser')}
                    style={{ accentColor: '#3b82f6' }}
                  />
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: engineMode === 'browser' ? '#bfdbfe' : '#cbd5e1'
                      }}
                    >
                      🌐 Browser DOM Engine
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>
                      Headless WebContentsView
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </aside>

          {/* Right Main Content Panel */}
          <main
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '24px 32px',
              background: '#090d16',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* TAB 1: CHANNELS */}
            {activeTab === 'channels' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
                      Stacked Channel Matrix &amp; Permissions
                    </h3>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>
                      Configure independent permissions for Dashboard Analytics, Agent Read Context, and Agent Write Dispatch. Unchecked channels remain inactive by default.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      onClick={clearAllPermissions}
                      disabled={selectedDashboard.size === 0 && selectedAgentRead.size === 0 && selectedAgentWrite.size === 0 && selectedAutoReply.size === 0}
                      style={{ fontSize: 12, padding: '5px 10px' }}
                    >
                      Clear all
                    </button>
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      onClick={selectAllDashboard}
                      style={{ fontSize: 11, padding: '5px 10px', color: '#818cf8', borderColor: 'rgba(129, 140, 248, 0.3)' }}
                    >
                      All to Dashboard
                    </button>
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      onClick={selectAllAgentRead}
                      style={{ fontSize: 11, padding: '5px 10px', color: '#34d399', borderColor: 'rgba(52, 211, 153, 0.3)' }}
                    >
                      All to Agent Read
                    </button>
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      onClick={selectAllAgentWrite}
                      style={{ fontSize: 11, padding: '5px 10px', color: '#fbbf24', borderColor: 'rgba(251, 191, 36, 0.3)' }}
                    >
                      All to Agent Write
                    </button>
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      onClick={selectAllAutoReply}
                      style={{ fontSize: 11, padding: '5px 10px', color: '#67e8f9', borderColor: 'rgba(6, 182, 212, 0.3)' }}
                    >
                      All to Auto-Reply
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void handleSaveChannels()}
                      disabled={savingChannels || channelsLoading}
                      style={{ fontSize: 12, fontWeight: 650, padding: '6px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6 }}
                    >
                      {savingChannels
                        ? 'Saving…'
                        : `Save Permissions (${selectedDashboard.size} Dash · ${selectedAgentRead.size} Read · ${selectedAgentWrite.size} Write · ${selectedAutoReply.size} Auto-Reply)`}
                    </button>
                  </div>
                </div>

                {/* Search Bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 8, padding: '6px 12px' }}>
                  <span style={{ fontSize: 13, color: '#94a3b8' }}>🔍</span>
                  <input
                    type="text"
                    value={channelSearch}
                    onChange={(e) => setChannelSearch(e.target.value)}
                    placeholder="Search channels or DMs…"
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      color: '#f8fafc',
                      fontSize: 13,
                      outline: 'none'
                    }}
                  />
                  {channelSearch && (
                    <button
                      type="button"
                      onClick={() => setChannelSearch('')}
                      style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 12 }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {channelsLoading ? (
                  <div style={{ padding: '36px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                    ⏳ Reading workspace channel list from Slack session…
                  </div>
                ) : (
                  <>
                    {channelsError && (
                      <div style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', fontSize: 12 }}>
                        {channelsError}
                      </div>
                    )}
                    {renderGroup('Public Channels', grouped.publicChannels, 'No public channels found.')}
                    {renderGroup('Private Channels', grouped.privateChannels, 'No private channels found.')}
                    {renderGroup('Direct Messages (DMs)', grouped.dms, 'No direct messages found.')}
                  </>
                )}
              </div>
            )}

            {/* TAB 2: SCHEDULES & TRIGGER */}
            {activeTab === 'schedules' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 840 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
                    Scrape Schedules &amp; Automation
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>
                    Configure automatic background polling frequency or immediately trigger a fresh scrape to update the entire dashboard.
                  </p>
                </div>

                {/* Manual Trigger Card */}
                <div style={{ padding: 20, borderRadius: 10, background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 650, color: '#f8fafc' }}>
                      Manual Scrape Now
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                      Immediately scrapes messages from all selected channels for this workspace and refreshes insights across cards.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleManualScrapeNow()}
                    disabled={manualSyncing}
                    style={{
                      padding: '8px 20px',
                      fontSize: 13,
                      fontWeight: 650,
                      background: '#6366f1',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      cursor: manualSyncing ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {manualSyncing ? 'Scraping in progress…' : '▶ Scrape Now'}
                  </button>
                </div>

                {/* Automatic Scheduling Card */}
                <div style={{ padding: 20, borderRadius: 10, background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 650, color: '#f8fafc' }}>
                        Automatic Background Scrape
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                        When enabled, the app automatically runs incremental message capture at the selected frequency.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleUpdateSchedule(!scheduleEnabled, intervalMinutes)}
                      disabled={savingSchedule}
                      style={{
                        padding: '6px 14px',
                        fontSize: 12,
                        fontWeight: 650,
                        borderRadius: 6,
                        border: `1px solid ${scheduleEnabled ? 'rgba(74, 222, 128, 0.4)' : 'rgba(255, 255, 255, 0.15)'}`,
                        background: scheduleEnabled ? 'rgba(74, 222, 128, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                        color: scheduleEnabled ? '#4ade80' : '#94a3b8',
                        cursor: 'pointer'
                      }}
                    >
                      {scheduleEnabled ? '● AUTO SCRAPE: ON' : '○ AUTO SCRAPE: OFF'}
                    </button>
                  </div>

                  {/* Interval Dropdown */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 10, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                    <span style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 500 }}>
                      Scrape Frequency:
                    </span>
                    <select
                      value={intervalMinutes}
                      disabled={savingSchedule || !scheduleEnabled}
                      onChange={(e) => void handleUpdateSchedule(scheduleEnabled, Number(e.target.value))}
                      style={{
                        padding: '6px 12px',
                        background: '#1e293b',
                        color: '#f8fafc',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: scheduleEnabled ? 'pointer' : 'not-allowed'
                      }}
                    >
                      <option value={0.083}>Every 5 seconds (⚡ Ultra-Rapid)</option>
                      <option value={0.167}>Every 10 seconds (⚡ Rapid)</option>
                      <option value={0.25}>Every 15 seconds (⚡ Rapid)</option>
                      <option value={0.333}>Every 20 seconds (⚡ Standard)</option>
                      <option value={0.5}>Every 30 seconds</option>
                      <option value={1}>Every 1 minute</option>
                      <option value={5}>Every 5 minutes</option>
                      <option value={10}>Every 10 minutes</option>
                      <option value={15}>Every 15 minutes</option>
                      <option value={30}>Every 30 minutes</option>
                      <option value={60}>Every 60 minutes (1 hour)</option>
                    </select>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {scheduleEnabled ? intervalMinutes < 1 ? `Next cycle in ~${Math.round(intervalMinutes * 60)} seconds.` : `Next cycle in ~${intervalMinutes} minutes.` : 'Automation is currently paused.'}
                    </span>
                  </div>
                  {scheduleEnabled && (
                    <div style={{ fontSize: 12, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>🛡️</span>
                      <span>
                        <strong>Smart Offline & 24–40h Catch-Up Active:</strong> When your computer turns back on after being off or closed, any missed messages are automatically caught up and deduplicated without missing history.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: SCRAPE LOGS */}
            {activeTab === 'logs' && (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <header>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
                    🕷️ Workspace Scrape Audit Logs
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>
                    Live execution history for {project.name}. Shows fetched messages, channel statuses, and timing.
                  </p>
                </header>
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  <ScrapeLogExplorer projectId={project.id} projectName={project.name} />
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

