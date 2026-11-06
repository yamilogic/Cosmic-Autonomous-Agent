import type React from 'react'
import { useEffect, useState } from 'react'
import type {
  DashboardChatTokenStatus,
  DashboardProject,
  PersonRole
} from '../../../../shared/dashboard-contract'
import { DASHBOARD_SCHEDULE_INTERVALS } from '../../../../shared/dashboard-contract'
import { useDashboardStore } from '../../hooks/useDashboard'
import { useProjectActivity } from '../../hooks/useProjectActivity'
import AiSettingsForm from './AiSettingsForm'
import DashboardWizard from './DashboardWizard'
import { RunLogsModal } from './RunLogsModal'
import { SidebarLayoutView } from './SidebarLayoutView'
import {
  LayoutMode,
  DEFAULT_LAYOUT
} from './sidebar-layout'
import { useSidebarLayout } from './use-sidebar-layout'
import {
  SourceStatusBadge
} from './sources'
import { useProfileStore } from '../../hooks/useProfiles'
import type { ProjectSource } from '../../../../shared/dashboard-contract'
import { CardAddModal } from './CardAddModal'
import { SourceChannelPicker } from './SourceChannelPicker'
import { WorkspaceControlModal } from './WorkspaceControlModal'

export type SettingsTabKey = 'general' | 'ai' | 'documents' | 'sources' | 'channels' | 'schedule' | 'sidebar' | 'danger'

interface ProjectSettingsTabProps {
  project: DashboardProject
  onDelete?: (projectId: string) => void
}

export default function ProjectSettingsTab({
  project,
  onDelete
}: ProjectSettingsTabProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<SettingsTabKey>('ai')
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [editWorkspace, setEditWorkspace] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Sources management state
  const profiles = useProfileStore((s) => s.profiles)
  const [sourceNotice, setSourceNotice] = useState<string | null>(null)
  const [scrapingSourceId, setScrapingSourceId] = useState<string | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [cardAddModalOpen, setCardAddModalOpen] = useState(false)
  const [cardAddModalTab, setCardAddModalTab] = useState<'global' | 'my' | 'client'>('my')
  const [pickerSourceId, setPickerSourceId] = useState<string | null>(null)
  const [controlSourceId, setControlSourceId] = useState<string | null>(null)

  // Schedule state
  const [startDate, setStartDate] = useState(project.startDate ?? '')
  const [endDate, setEndDate] = useState(project.endDate ?? '')
  const [completion, setCompletion] = useState(
    project.manualCompletion != null ? String(project.manualCompletion) : ''
  )
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  // Activity & advance participant roles
  const activityState = useProjectActivity(project.id)
  const [manualPersonName, setManualPersonName] = useState('')
  const [manualPersonRole, setManualPersonRole] = useState<PersonRole>('client')

  const handleToggleAdvanceControl = async (): Promise<void> => {
    const nextVal = !project.advanceDashboardControl
    await useDashboardStore.getState().upsertProject({
      ...project,
      advanceDashboardControl: nextVal
    })
  }

  const handleUpdatePersonRole = async (personName: string, role: PersonRole): Promise<void> => {
    const key = personName.trim().toLowerCase()
    const nextRoles = { ...(project.personRoles || {}), [key]: role }
    await useDashboardStore.getState().upsertProject({
      ...project,
      personRoles: nextRoles
    })
  }

  const handleRemovePersonRole = async (personName: string): Promise<void> => {
    const key = personName.trim().toLowerCase()
    const nextRoles = { ...(project.personRoles || {}) }
    delete nextRoles[key]
    await useDashboardStore.getState().upsertProject({
      ...project,
      personRoles: nextRoles
    })
  }

  // Layout state
  const { layout, updateLayout } = useSidebarLayout(project.id)

  // Token status
  const [tokenStatus, setTokenStatus] = useState<DashboardChatTokenStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.dashboard
      .getChatTokenStatus(project.id)
      .then((status) => {
        if (!cancelled) setTokenStatus(status)
      })
      .catch(() => {
        if (!cancelled) setTokenStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [project.id])

  useEffect(() => {
    if (pickerSourceId || controlSourceId) {
      void window.api?.profiles?.setEmbedVisible?.(false)
    } else {
      void window.api?.profiles?.setEmbedVisible?.(true)
    }
  }, [pickerSourceId, controlSourceId])

  const closeChannelPicker = (): void => {
    setPickerSourceId(null)
  }

  const handleModeChange = (mode: LayoutMode): void => {
    updateLayout({ ...layout, mode })
  }

  const handleToggleSection = (sectionKey: string): void => {
    const hidden = new Set(layout.custom.hiddenSections)
    if (hidden.has(sectionKey)) {
      hidden.delete(sectionKey)
    } else {
      hidden.add(sectionKey)
    }
    updateLayout({
      ...layout,
      custom: { ...layout.custom, hiddenSections: Array.from(hidden) }
    })
  }

  const handleResetLayout = (): void => {
    updateLayout(DEFAULT_LAYOUT)
  }

  const handleToggleActiveGlobalItem = (itemId: string, allItemIds: string[]): void => {
    // If activeGlobalItems is undefined, currently all items are active
    const current = layout.custom.activeGlobalItems !== undefined
      ? [...layout.custom.activeGlobalItems]
      : [...allItemIds]

    let updatedActive: string[]
    if (current.includes(itemId)) {
      // Deactivating: remove from activeGlobalItems AND remove from allowedGlobalLinks (hidden)
      updatedActive = current.filter((id) => id !== itemId)
    } else {
      // Activating: add to activeGlobalItems
      updatedActive = [...current, itemId]
    }

    // Keep allowedGlobalLinks consistent: if active items updated, keep allowed in sync
    const currentAllowed = layout.custom.allowedGlobalLinks !== undefined
      ? [...layout.custom.allowedGlobalLinks]
      : [...allItemIds]
    const updatedAllowed = current.includes(itemId)
      ? currentAllowed.filter((id) => id !== itemId)
      : (currentAllowed.includes(itemId) ? currentAllowed : [...currentAllowed, itemId])

    updateLayout({
      ...layout,
      custom: {
        ...layout.custom,
        activeGlobalItems: updatedActive,
        allowedGlobalLinks: updatedAllowed
      }
    })
  }

  const handleToggleAllowedGlobalLink = (linkId: string, allGlobalItemIds: string[]): void => {
    // If allowedGlobalLinks is undefined, currently all active links are shown.
    const current = layout.custom.allowedGlobalLinks !== undefined
      ? [...layout.custom.allowedGlobalLinks]
      : [...allGlobalItemIds]

    let updated: string[]
    if (current.includes(linkId)) {
      updated = current.filter((id) => id !== linkId)
    } else {
      updated = [...current, linkId]
    }

    updateLayout({
      ...layout,
      custom: {
        ...layout.custom,
        allowedGlobalLinks: updated
      }
    })
  }

  const handleToggleHideAddButton = (): void => {
    const isCurrentlyHidden = layout.custom.hideAddButton ?? true
    updateLayout({
      ...layout,
      custom: {
        ...layout.custom,
        hideAddButton: !isCurrentlyHidden
      }
    })
  }

  const handleToggleSubItem = (parentKey: string, subItemKey: string): void => {
    const currentHidden = new Set(layout.custom.hiddenItems?.[parentKey] ?? [])
    if (currentHidden.has(subItemKey)) {
      currentHidden.delete(subItemKey)
    } else {
      currentHidden.add(subItemKey)
    }
    updateLayout({
      ...layout,
      custom: {
        ...layout.custom,
        hiddenItems: {
          ...layout.custom.hiddenItems,
          [parentKey]: Array.from(currentHidden)
        }
      }
    })
  }

  const saveSchedule = async (): Promise<void> => {
    setScheduleSaving(true)
    setScheduleNotice(null)
    setScheduleError(null)
    try {
      const parsed = completion === '' ? undefined : Number(completion)
      await useDashboardStore.getState().upsertProject({
        ...project,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        manualCompletion:
          parsed === undefined || !Number.isFinite(parsed)
            ? undefined
            : Math.max(0, Math.min(100, Math.round(parsed)))
      })
      setScheduleNotice('Schedule saved')
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Could not save the schedule')
    } finally {
      setScheduleSaving(false)
    }
  }

  const handleDeleteProject = async (): Promise<void> => {
    if (onDelete) {
      onDelete(project.id)
    } else {
      await useDashboardStore.getState().deleteProject(project.id)
    }
  }

  const isScheduleChanged =
    startDate !== (project.startDate ?? '') ||
    endDate !== (project.endDate ?? '') ||
    completion !== (project.manualCompletion != null ? String(project.manualCompletion) : '')

  const navItems: Array<{ key: SettingsTabKey; label: string; icon: string; danger?: boolean }> = [
    { key: 'general', label: 'General', icon: 'ℹ' },
    { key: 'ai', label: 'AI Configuration', icon: '✨' },
    { key: 'documents', label: 'Documents & Specs', icon: '📄' },
    { key: 'sources', label: 'Sources', icon: '🔌' },
    { key: 'channels', label: 'Channels', icon: '#' },
    { key: 'schedule', label: 'Schedule', icon: '📅' },
    { key: 'sidebar', label: 'Sidebar layout', icon: '◫' },
    { key: 'danger', label: 'Danger zone', icon: '⚠', danger: true }
  ]

  const handleToggleSourceEnabled = async (sourceId: string, currentEnabled: boolean): Promise<void> => {
    await useDashboardStore.getState().updateSource({
      projectId: project.id,
      sourceId,
      patch: { enabled: !currentEnabled }
    })
    setSourceNotice(`Source ${currentEnabled ? 'paused' : 'resumed'}`)
    setTimeout(() => setSourceNotice(null), 3000)
  }

  const handleToggleChannelPermission = async (
    sourceId: string,
    channelId: string,
    tier: 'dash' | 'read' | 'write' | 'auto_reply',
    currentValue: boolean
  ): Promise<void> => {
    const source = (project.sources ?? []).find((item) => item.id === sourceId)
    if (!source) return
    const nextValue = !currentValue
    await useDashboardStore.getState().updateSource({
      projectId: project.id,
      sourceId,
      patch: {
        channels: source.channels.map((channel) => {
          if (channel.id !== channelId) return channel
          if (tier === 'dash') return { ...channel, enabled: nextValue }
          if (tier === 'read') return { ...channel, agentRead: nextValue }
          if (tier === 'write') return { ...channel, agentWrite: nextValue }
          if (tier === 'auto_reply') return { ...channel, autoReply: nextValue }
          return channel
        }),
        channelsReviewedAt: source.channelsReviewedAt ?? new Date().toISOString()
      }
    })
    const label =
      tier === 'dash'
        ? 'Dashboard Scrape'
        : tier === 'read'
          ? 'Agent Read'
          : tier === 'write'
            ? 'Agent Write'
            : 'Auto-Reply'
    setSourceNotice(`${label} ${nextValue ? 'enabled' : 'disabled'} for channel`)
    setTimeout(() => setSourceNotice(null), 3000)
  }

  const handleUpdateSourceSettings = async (
    sourceId: string,
    patch: Partial<ProjectSource>
  ): Promise<void> => {
    await useDashboardStore.getState().updateSource({
      projectId: project.id,
      sourceId,
      patch
    })
    setSourceNotice('Scrape settings saved')
    setTimeout(() => setSourceNotice(null), 2500)
  }

  const handleAddWorkspaceSourceDirect = async (
    targetProfileId: string,
    teamId: string,
    teamName: string,
    role: 'client' | 'ours'
  ): Promise<string> => {
    const existing = (project.sources ?? []).find(
      (s) => s.workspaceId === teamId && (s.profileId === targetProfileId || !s.profileId)
    )
    if (existing) {
      if (existing.enabled === false) {
        await handleToggleSourceEnabled(existing.id, false)
      }
      if (!existing.channelsReviewedAt) setPickerSourceId(existing.id)
      return existing.id
    }

    const newSourceId = `src-browser-${Date.now().toString(36)}`
    const now = new Date().toISOString()
    const newSource: ProjectSource = {
      id: newSourceId,
      kind: 'browser',
      platform: 'slack',
      profileId: targetProfileId,
      workspaceId: teamId,
      workspaceName: teamName,
      // First attach is intentionally empty. The picker decides what is read.
      channels: [],
      role,
      backfillDays: 7,
      enabled: true,
      status: 'connected',
      selectionMode: 'include',
      createdAt: now,
      updatedAt: now
    }
    const currentSources = project.sources ?? []
    await useDashboardStore.getState().upsertProject({
      ...project,
      sources: [...currentSources, newSource]
    })
    setPickerSourceId(newSourceId)
    setSourceNotice(`Added ${teamName}. Choose the channels to scrape.`)
    setTimeout(() => setSourceNotice(null), 4000)
    return newSourceId
  }

  const handleScrapeWorkspaceDirect = async (
    targetProfileId: string,
    teamId: string,
    teamName: string,
    role: 'client' | 'ours'
  ): Promise<void> => {
    const sourceId = await handleAddWorkspaceSourceDirect(targetProfileId, teamId, teamName, role)
    const source = (useDashboardStore.getState().snapshot?.projects ?? [])
      .find((item) => item.project.id === project.id)
      ?.project.sources?.find((item) => item.id === sourceId)
    if (!source?.channelsReviewedAt) {
      setPickerSourceId(sourceId)
      setSourceNotice('Choose at least one channel before the first scrape.')
      return
    }
    await handleScrapeSource(sourceId)
  }

  const handleScrapeSource = async (sourceId: string): Promise<void> => {
    const source = (project.sources ?? []).find((item) => item.id === sourceId)
    if (!source?.channelsReviewedAt) {
      setPickerSourceId(sourceId)
      setSourceNotice('Review and select channels before scraping this workspace.')
      return
    }
    if (
      (source.selectionMode ?? 'include') === 'include' &&
      !source.channels.some((channel) => channel.enabled !== false)
    ) {
      setPickerSourceId(sourceId)
      setSourceNotice('No channels selected. Choose at least one channel first.')
      return
    }
    setScrapingSourceId(sourceId)
    setSourceNotice('Scraping workspace messages via browser...')
    try {
      const res = await useDashboardStore.getState().syncSource({
        projectId: project.id,
        sourceId
      })
      if (res.status === 'success') {
        setSourceNotice(`Scraped successfully: ${res.newMessages} new messages found across ${res.channelsRead} channels.`)
      } else {
        setSourceNotice(res.error ? `Scrape failed: ${res.error}` : 'Scrape completed with issues.')
      }
    } catch (err) {
      setSourceNotice(err instanceof Error ? `Scrape error: ${err.message}` : 'Scrape failed')
    } finally {
      setScrapingSourceId(null)
      setTimeout(() => setSourceNotice(null), 5000)
    }
  }

  const handleRemoveSource = async (sourceId: string): Promise<void> => {
    const updatedSources = (project.sources ?? []).filter((s) => s.id !== sourceId)
    await useDashboardStore.getState().upsertProject({
      ...project,
      sources: updatedSources
    })
    setSourceNotice('Source removed')
    setTimeout(() => setSourceNotice(null), 3000)
  }

  return (
    <div className="ws-settings" data-testid="project-settings-tab">
      <div className="ws-settings-shell">
        {/* Sticky Header */}
        <header className="ws-settings-header" data-testid="settings-header">
          <div className="ws-settings-title-row">
            <div className="ws-settings-title-group">
              <h2 className="ws-settings-title">
                <span className="proj-name">{project.name}</span>
                <span className="proj-sep">/</span>
                <span className="proj-sub">Settings</span>
              </h2>
            </div>
          </div>
        </header>

        {/* Vertical Layout with Collapsible Nav Sidebar */}
        <div className="ws-settings-layout">
          <aside className={`ws-settings-nav-sidebar${navCollapsed ? ' is-collapsed' : ''}`} aria-label="Settings navigation">
            <div className="ws-settings-nav-toggle">
              <button
                type="button"
                className="ws-settings-nav-toggle-btn"
                onClick={() => setNavCollapsed((v) => !v)}
                title={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              >
                {navCollapsed ? '»' : '«'}
              </button>
            </div>
            <ul className="ws-settings-nav-list" role="tablist">
              {navItems.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === item.key}
                    className={`ws-settings-nav-item${activeTab === item.key ? ' is-active' : ''}${item.danger ? ' is-danger' : ''}`}
                    onClick={() => setActiveTab(item.key)}
                    data-testid={`tab-${item.key}`}
                    title={navCollapsed ? item.label : undefined}
                  >
                    <span className="ws-settings-nav-icon">{item.icon}</span>
                    {!navCollapsed && <span className="ws-settings-nav-label">{item.label}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="ws-settings-main-pane">
            {/* Single Scroll Container */}
            <div className="ws-settings-content" data-testid="settings-content">
          {/* TAB: GENERAL */}
          {activeTab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section className="ws-settings-section">
                <header className="ws-settings-head">
                  <h4>General information</h4>
                  <p>Basic workspace metadata and card identity.</p>
                </header>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                      Project name
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={project.name}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-input)',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                        fontSize: '14px'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                      Client workspace
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={project.clientName || project.teamName || '—'}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-input)',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                        fontSize: '14px'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                      Project ID
                    </label>
                    <code
                      style={{
                        display: 'inline-block',
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-chip)',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-muted)',
                        fontSize: '12px'
                      }}
                    >
                      {project.id}
                    </code>
                  </div>
                </div>
              </section>

              {/* Advance Dashboard Control Section */}
              <section className="ws-settings-section">
                <header className="ws-settings-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h4>Advance dashboard control</h4>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                      Enable participant role tagging (Client, Me, Team, Bot). When OFF (default), Orbit automatically scrapes and builds the dashboard without manual tagging.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleToggleAdvanceControl()}
                    style={{
                      background: project.advanceDashboardControl ? '#10b981' : 'var(--surface)',
                      color: project.advanceDashboardControl ? '#fff' : 'var(--text-muted)',
                      border: '1px solid var(--border)',
                      borderRadius: '16px',
                      padding: '6px 14px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <span>{project.advanceDashboardControl ? '● ON' : '○ OFF'}</span>
                  </button>
                </header>

                {project.advanceDashboardControl ? (
                  <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'var(--surface)', padding: '10px 14px', borderRadius: 'var(--radius-chip)', border: '1px solid var(--border)' }}>
                      Tag each participant with their role. The AI uses these roles to distinguish the client asks, response times, and team deliverables. Bots are excluded from sentiment.
                    </div>

                    {Array.from(new Set([
                      ...(activityState.activity?.participants ?? []).map((p) => p.name),
                      ...Object.keys(project.personRoles || {})
                    ])).filter(Boolean).length === 0 ? (
                      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '8px 0' }}>
                        No participants detected yet. Scrape a channel to discover participants, or add them manually below.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {Array.from(new Set([
                          ...(activityState.activity?.participants ?? []).map((p) => p.name),
                          ...Object.keys(project.personRoles || {})
                        ])).filter(Boolean).map((name) => {
                          const currentRole: PersonRole = (project.personRoles || {})[name.toLowerCase()] || (
                            project.selfUserId && name.toLowerCase() === project.selfUserId.toLowerCase()
                              ? 'me'
                              : 'client'
                          )
                          const pInfo = (activityState.activity?.participants ?? []).find(
                            (p) => p.name.toLowerCase() === name.toLowerCase()
                          )

                          return (
                            <div
                              key={name}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 12px',
                                background: 'var(--surface)',
                                borderRadius: 'var(--radius-chip)',
                                border: '1px solid var(--border)'
                              }}
                            >
                              <div>
                                <strong style={{ fontSize: '13px' }}>{name}</strong>
                                {pInfo ? (
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                                    ({pInfo.count} msgs)
                                  </span>
                                ) : null}
                              </div>

                              <div style={{ display: 'flex', gap: '6px' }}>
                                {(['client', 'me', 'team', 'bot'] as const).map((r) => {
                                  const isActive = currentRole === r
                                  return (
                                    <button
                                      key={r}
                                      type="button"
                                      onClick={() => void handleUpdatePersonRole(name, r)}
                                      style={{
                                        background: isActive
                                          ? r === 'client'
                                            ? '#10b981'
                                            : r === 'me'
                                              ? '#3b82f6'
                                              : r === 'team'
                                                ? '#8b5cf6'
                                                : '#64748b'
                                          : 'transparent',
                                        color: isActive ? '#fff' : 'var(--text-muted)',
                                        border: `1px solid ${isActive ? 'transparent' : 'var(--border)'}`,
                                        borderRadius: '12px',
                                        padding: '3px 10px',
                                        fontSize: '11px',
                                        cursor: 'pointer',
                                        fontWeight: isActive ? 600 : 400
                                      }}
                                    >
                                      {r === 'client'
                                        ? 'Client'
                                        : r === 'me'
                                          ? 'Me'
                                          : r === 'team'
                                            ? 'Team'
                                            : 'Bot'}
                                    </button>
                                  )
                                })}
                                {(project.personRoles || {})[name.toLowerCase()] ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleRemovePersonRole(name)}
                                    title="Reset to auto"
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      color: 'var(--text-muted)',
                                      cursor: 'pointer',
                                      fontSize: '13px',
                                      marginLeft: '4px'
                                    }}
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Add manual person */}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
                      <input
                        type="text"
                        placeholder="Add person name…"
                        value={manualPersonName}
                        onChange={(e) => setManualPersonName(e.target.value)}
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          borderRadius: 'var(--radius-input)',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          color: 'var(--text)',
                          fontSize: '13px'
                        }}
                      />
                      <select
                        value={manualPersonRole}
                        onChange={(e) => setManualPersonRole(e.target.value as PersonRole)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 'var(--radius-input)',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          color: 'var(--text)',
                          fontSize: '13px'
                        }}
                      >
                        <option value="client">Client</option>
                        <option value="me">Me</option>
                        <option value="team">Team / Freelancer</option>
                        <option value="bot">Bot</option>
                      </select>
                      <button
                        type="button"
                        disabled={!manualPersonName.trim()}
                        onClick={() => {
                          if (manualPersonName.trim()) {
                            void handleUpdatePersonRole(manualPersonName.trim(), manualPersonRole)
                            setManualPersonName('')
                          }
                        }}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 'var(--radius-input)',
                          background: '#3b82f6',
                          color: '#fff',
                          border: 'none',
                          fontSize: '13px',
                          cursor: 'pointer'
                        }}
                      >
                        Add Tag
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          )}

          {/* TAB: AI */}
          {activeTab === 'ai' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section
                className="ws-settings-section"
                id="project-ai-settings"
                tabIndex={-1}
                aria-label="AI settings"
              >
                <header className="ws-settings-head">
                  <h4>AI configuration</h4>
                  <p>
                    Used by this card&apos;s insight refresh and project chat. Leave{' '}
                    <b>Use global settings</b> on to inherit the dashboard workspace key and model.
                  </p>
                </header>
                <AiSettingsForm projectId={project.id} />
              </section>
            </div>
          )}

          {/* TAB: DOCUMENTS & SPECS */}
          {activeTab === 'documents' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section className="ws-settings-section">
                <header className="ws-settings-head">
                  <h4>Project Specifications & Documents</h4>
                  <p>
                    Upload client specifications, SOWs, deliverables docs (.docx, .pdf, .txt, .md).
                    The AI integrates these into requirements, milestones, and deliverable tracking.
                  </p>
                </header>

                <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div
                    style={{
                      border: '2px dashed var(--border)',
                      borderRadius: '8px',
                      padding: '24px',
                      textAlign: 'center',
                      background: 'rgba(255, 255, 255, 0.02)',
                      cursor: 'pointer'
                    }}
                    onClick={() => {
                      const input = document.createElement('input')
                      input.type = 'file'
                      input.accept = '.docx,.pdf,.txt,.md,.json,.csv'
                      input.onchange = async (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0]
                        if (!file) return
                        const reader = new FileReader()
                        reader.onload = async () => {
                          const base64 = (reader.result as string).split(',')[1]
                          setSourceNotice(`Uploading ${file.name}...`)
                          try {
                            const res = await window.api.dashboard.uploadDocument({
                              projectId: project.id,
                              name: file.name,
                              mimeType: file.type || 'application/octet-stream',
                              dataBase64: base64
                            })
                            if (res.ok) {
                              setSourceNotice(`Uploaded and indexed ${file.name}`)
                              await useDashboardStore.getState().loadSnapshot()
                            } else {
                              setSourceNotice(`Failed: ${res.error}`)
                            }
                          } catch (err) {
                            setSourceNotice(`Error: ${err instanceof Error ? err.message : String(err)}`)
                          }
                          setTimeout(() => setSourceNotice(null), 4000)
                        }
                        reader.readAsDataURL(file)
                      }
                      input.click()
                    }}
                  >
                    <span style={{ fontSize: '28px', display: 'block', marginBottom: '8px' }}>📤</span>
                    <strong style={{ fontSize: '14px', color: 'var(--text)' }}>Click to upload client specification</strong>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                      Supports Word (.docx), PDF (.pdf), Text (.txt), Markdown (.md)
                    </p>
                  </div>

                  {sourceNotice ? (
                    <div style={{ padding: '8px 12px', background: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa', borderRadius: '6px', fontSize: '13px' }}>
                      {sourceNotice}
                    </div>
                  ) : null}

                  <div style={{ marginTop: '10px' }}>
                    <h5 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 10px', color: 'var(--text-muted)' }}>
                      Uploaded Documents ({(project.documents || []).length})
                    </h5>

                    {(project.documents || []).length === 0 ? (
                      <p style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        No documents uploaded yet.
                      </p>
                    ) : (
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {(project.documents || []).map((doc) => (
                          <li
                            key={doc.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '10px 14px',
                              background: 'var(--surface)',
                              borderRadius: 'var(--radius-chip)',
                              border: '1px solid var(--border)'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ fontSize: '16px' }}>📄</span>
                              <div>
                                <strong style={{ fontSize: '13px', color: 'var(--text)', display: 'block' }}>
                                  {doc.name}
                                </strong>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                  {doc.sizeBytes ? `${Math.round(doc.sizeBytes / 1024)} KB • ` : ''}
                                  Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
                                  {doc.extractedText ? ` • ${doc.extractedText.length} chars parsed` : ''}
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={async () => {
                                if (confirm(`Delete document "${doc.name}"?`)) {
                                  await window.api.dashboard.deleteDocument({
                                    projectId: project.id,
                                    documentId: doc.id
                                  })
                                  await useDashboardStore.getState().loadSnapshot()
                                }
                              }}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#ef4444',
                                cursor: 'pointer',
                                fontSize: '14px',
                                padding: '4px 8px'
                              }}
                              title="Delete document"
                            >
                              🗑
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* TAB: SOURCES */}
          {activeTab === 'sources' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section className="ws-settings-section">
                <header className="ws-settings-head">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h4>Connected Sources</h4>
                      <p>Active token and passive browser automation sources feeding this project.</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="dash-subtle"
                        onClick={() => setLogsOpen(true)}
                        style={{ fontSize: 13, padding: '6px 12px' }}
                      >
                        📋 View Run Logs
                      </button>
                    </div>
                  </div>
                </header>

                {sourceNotice && (
                  <div style={{ padding: '8px 12px', background: 'rgba(34, 197, 94, 0.1)', color: '#4ade80', borderRadius: 6, fontSize: 13 }}>
                    {sourceNotice}
                  </div>
                )}

                {/* 1. GLOBAL ACCOUNTS & WORKSPACES */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15 }}>🌐</span>
                      <h5 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                        Global Accounts &amp; Workspaces
                      </h5>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Available across all profiles (Slack, Custom Links)
                    </span>
                  </div>

                  {(() => {
                    const globalProfiles = profiles.filter(
                      (p) => p.isGlobalProfile || p.accountScope === 'global' || p.accountScope === 'both'
                    )
                    const hasAny = globalProfiles.some(
                      (p) => (p.apps?.slack?.availableWorkspaces?.length ?? 0) > 0 || (p.customLinks?.length ?? 0) > 0
                    )
                    if (!hasAny) {
                      return (
                        <div style={{ padding: 14, border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
                          No connected Slack workspaces or links found in global profiles.
                        </div>
                      )
                    }

                    return globalProfiles.map((p) => {
                      const pName = p.customName || p.displayName
                      const slackWorkspaces = p.apps?.slack?.availableWorkspaces ?? []
                      const customLinks = p.customLinks ?? []
                      if (slackWorkspaces.length === 0 && customLinks.length === 0) return null

                      return (
                        <div
                          key={`global-${p.id}`}
                          style={{
                            background: 'rgba(0, 0, 0, 0.2)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: 8,
                            padding: 12,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 10
                          }}
                        >
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-faint, #94a3b8)' }}>
                            👤 {pName}
                          </div>

                          {slackWorkspaces.map((gw) => {
                            const existingSource = (project.sources ?? []).find(
                              (s) => s.workspaceId === gw.teamId && (s.profileId === p.id || !s.profileId)
                            )
                            const isAttached = Boolean(existingSource)
                            const isActive = isAttached && existingSource?.enabled !== false
                            const isScraping = scrapingSourceId === existingSource?.id

                            return (
                              <div
                                key={`gw-${p.id}-${gw.teamId}`}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '10px 14px',
                                  background: 'var(--surface)',
                                  border: `1px solid ${isActive ? 'rgba(99, 102, 241, 0.3)' : 'var(--border)'}`,
                                  borderRadius: 6
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span style={{ fontSize: 14 }}>🏢</span>
                                  <div>
                                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                                      {gw.teamName}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                      Slack Workspace · ID: {gw.teamId}
                                    </div>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  {isAttached ? (
                                    <>
                                      <button
                                        type="button"
                                        className="dash-subtle"
                                        disabled={!isActive || isScraping}
                                        style={{
                                          fontSize: 12,
                                          padding: '4px 10px',
                                          color: isActive ? '#4ade80' : 'var(--text-muted)',
                                          cursor: isActive && !isScraping ? 'pointer' : 'not-allowed'
                                        }}
                                        onClick={() => existingSource && void handleScrapeSource(existingSource.id)}
                                        title={`Scrape messages from ${gw.teamName}`}
                                      >
                                        {isScraping ? '⏳ Scraping…' : '🕷 Scrape'}
                                      </button>
                                      <button
                                        type="button"
                                        style={{
                                          fontSize: 12,
                                          padding: '4px 10px',
                                          borderRadius: 4,
                                          border: `1px solid ${isActive ? '#22c55e' : '#64748b'}`,
                                          background: isActive ? 'rgba(34, 197, 94, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                                          color: isActive ? '#4ade80' : '#94a3b8',
                                          fontWeight: 600,
                                          cursor: 'pointer'
                                        }}
                                        onClick={() => existingSource && void handleToggleSourceEnabled(existingSource.id, existingSource.enabled !== false)}
                                      >
                                        {isActive ? '● Active' : '○ Inactive'}
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      className="dash-subtle"
                                      style={{
                                        fontSize: 12,
                                        padding: '4px 10px',
                                        color: '#60a5fa',
                                        border: '1px solid rgba(96, 165, 250, 0.3)',
                                        borderRadius: 4
                                      }}
                                      onClick={() => void handleScrapeWorkspaceDirect(p.id, gw.teamId, gw.teamName, 'client')}
                                    >
                                      + Attach &amp; Scrape
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })}

                          {customLinks.map((link) => (
                            <div
                              key={`link-${p.id}-${link.id}`}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 14px',
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                borderRadius: 6
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontSize: 14 }}>🔗</span>
                                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                                  {link.name}
                                </div>
                              </div>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Custom Link</span>
                            </div>
                          ))}
                        </div>
                      )
                    })
                  })()}
                </div>

                {/* 2. MY ACCOUNTS & 3. CLIENT ACCOUNTS (Attached Card Sources) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15 }}>💼</span>
                      <h5 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                        Attached Card Sources (My Accounts &amp; Client Accounts)
                      </h5>
                    </div>
                  </div>

                  {(!project.sources || project.sources.length === 0) && (
                    <div style={{ padding: 14, border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
                      Using default project token connection ({project.tokenSource}).
                    </div>
                  )}

                  {(project.sources ?? []).map((src) => {
                    const isActive = src.enabled !== false
                    const isScraping = scrapingSourceId === src.id

                    return (
                      <div key={src.id} style={{ display: 'flex', flexDirection: 'column' }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 16px',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            background: 'var(--surface)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <SourceStatusBadge status={src.status ?? 'connected'} lastReadAt={src.lastReadAt} />
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span>{src.role === 'ours' ? '👤 [My Account]' : '💼 [Client Account]'}</span>
                                <span>{src.workspaceName || src.workspaceId}</span>
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {src.kind === 'browser' ? 'Browser session' : 'Token'} · {src.channels.length} channels monitored
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            {src.kind === 'browser' ? (
                              <>
                                <button
                                  type="button"
                                  style={{
                                    fontSize: 12,
                                    padding: '4px 10px',
                                    borderRadius: 6,
                                    border: `1px solid ${src.scheduleEnabled ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255, 255, 255, 0.15)'}`,
                                    background: src.scheduleEnabled ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                    color: src.scheduleEnabled ? '#4ade80' : '#94a3b8',
                                    fontWeight: 650,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4
                                  }}
                                  onClick={() =>
                                    void handleUpdateSourceSettings(src.id, {
                                      scheduleEnabled: !src.scheduleEnabled,
                                      scheduleIntervalMinutes: src.scheduleIntervalMinutes ?? 15
                                    })
                                  }
                                  title={src.scheduleEnabled ? 'Click to turn off scheduled background scraping' : 'Click to turn on scheduled background scraping'}
                                >
                                  ⏱ Schedule: {src.scheduleEnabled ? 'ON' : 'OFF'}
                                </button>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: 6, padding: '2px 6px' }}>
                                  <span style={{ fontSize: 11, color: '#94a3b8' }}>Every</span>
                                  <select
                                    value={src.scheduleIntervalMinutes ?? 15}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      color: '#cbd5e1',
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      padding: '2px 0'
                                    }}
                                    onChange={(e) =>
                                      void handleUpdateSourceSettings(src.id, {
                                        scheduleIntervalMinutes: Number(
                                          e.target.value
                                        ) as ProjectSource['scheduleIntervalMinutes']
                                      })
                                    }
                                  >
                                    {DASHBOARD_SCHEDULE_INTERVALS.map((m) => (
                                      <option key={m} value={m} style={{ background: '#0f172a', color: '#fff' }}>
                                        {m < 1 ? `${Math.round(m * 60)}s` : `${m}m`}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <button
                                  type="button"
                                  className="dash-subtle"
                                  style={{ fontSize: 12, padding: '4px 10px' }}
                                  onClick={() => setPickerSourceId(src.id)}
                                  title="Discover the sidebar and choose exactly which channels this card reads"
                                >
                                  ☑ Channels ({src.channels.filter((c) => c.enabled !== false).length})
                                </button>
                                <button
                                  type="button"
                                  className="dash-subtle"
                                  style={{ fontSize: 12, padding: '4px 10px' }}
                                  onClick={() => setControlSourceId(src.id)}
                                  title="Open 3-tier Channel Matrix & Permissions"
                                >
                                  ⚙️ Matrix &amp; Agent
                                </button>
                              </>
                            ) : null}
                            {/* Capability Gating: ONLY show Scrape on Slack browser workspaces where our scraper is implemented */}
                            {src.kind === 'browser' && (src.platform === 'slack' || (!src.platform && src.workspaceId?.startsWith('T'))) ? (
                              <button
                                type="button"
                                className="dash-subtle"
                                disabled={isScraping || !isActive}
                                style={{
                                  fontSize: 12,
                                  padding: '4px 10px',
                                  color: isActive ? '#4ade80' : 'var(--text-muted)',
                                  cursor: isActive && !isScraping ? 'pointer' : 'not-allowed'
                                }}
                                onClick={() => void handleScrapeSource(src.id)}
                                title="Scrape the selected channels (with 2-minute delta buffer)"
                              >
                                {isScraping ? '⏳ Scraping…' : '🕷 Scrape Now'}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              style={{
                                fontSize: 12,
                                padding: '4px 10px',
                                borderRadius: 4,
                                border: `1px solid ${isActive ? '#22c55e' : '#64748b'}`,
                                background: isActive ? 'rgba(34, 197, 94, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                                color: isActive ? '#4ade80' : '#94a3b8',
                                fontWeight: 600,
                                cursor: 'pointer'
                              }}
                              onClick={() => void handleToggleSourceEnabled(src.id, isActive)}
                            >
                              {isActive ? '● Active' : '○ Inactive'}
                            </button>
                            <button
                              type="button"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--danger)',
                                fontSize: 12,
                                cursor: 'pointer',
                                padding: '4px 8px'
                              }}
                              onClick={() => void handleRemoveSource(src.id)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        {/* Per-source scrape policy (DMs, backfill, people) */}
                        {src.kind === 'browser' && (
                          <div
                            style={{
                              marginTop: 6,
                              padding: '10px 14px',
                              background: 'rgba(255, 255, 255, 0.02)',
                              border: '1px solid var(--border)',
                              borderRadius: 8,
                              display: 'flex',
                              gap: 14,
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              fontSize: 12
                            }}
                          >
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              Engine
                              <select
                                value={src.engine ?? 'direct_api'}
                                onChange={(e) =>
                                  void handleUpdateSourceSettings(src.id, {
                                    engine: e.target.value as 'direct_api' | 'browser_dom'
                                  })
                                }
                                style={{ background: '#0f172a', color: '#fff', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}
                              >
                                <option value="direct_api">⚡ Direct API (~150ms)</option>
                                <option value="browser_dom">🌐 Browser DOM</option>
                              </select>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              DMs
                              <select
                                value={src.allowDms ?? 'inherit'}
                                onChange={(e) =>
                                  void handleUpdateSourceSettings(src.id, {
                                    allowDms: e.target.value as ProjectSource['allowDms']
                                  })
                                }
                              >
                                <option value="inherit">Inherit global</option>
                                <option value="on">Include</option>
                                <option value="off">Exclude</option>
                              </select>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              Backfill
                              <select
                                value={src.backfillHours ?? 6}
                                onChange={(e) =>
                                  void handleUpdateSourceSettings(src.id, {
                                    backfillHours: Number(e.target.value)
                                  })
                                }
                              >
                                {[
                                  { h: 1, label: '1h' },
                                  { h: 3, label: '3h' },
                                  { h: 6, label: '6h' },
                                  { h: 12, label: '12h' },
                                  { h: 24, label: '24h (1d)' },
                                  { h: 72, label: '3d' },
                                  { h: 168, label: '7d' },
                                  { h: 336, label: '14d' },
                                  { h: 720, label: '30d' },
                                  { h: 0, label: 'All History' }
                                ].map(({ h, label }) => (
                                  <option key={h} value={h}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 220 }}>
                              People
                              <input
                                type="text"
                                defaultValue={(src.selectedPeople ?? []).join(', ')}
                                placeholder="Everyone (comma-separated names)"
                                style={{ flex: 1, minWidth: 150 }}
                                onBlur={(e) => {
                                  const people = e.target.value
                                    .split(',')
                                    .map((name) => name.trim())
                                    .filter(Boolean)
                                  void handleUpdateSourceSettings(src.id, {
                                    selectedPeople: people.length > 0 ? people : undefined
                                  })
                                }}
                              />
                            </label>
                            {src.lastScrapeStatus ? (
                              <span
                                style={{
                                  fontSize: 11,
                                  padding: '2px 8px',
                                  borderRadius: 10,
                                  background:
                                    src.lastScrapeStatus === 'success'
                                      ? 'rgba(34, 197, 94, 0.15)'
                                      : src.lastScrapeStatus === 'error'
                                        ? 'rgba(239, 68, 68, 0.15)'
                                        : 'rgba(251, 191, 36, 0.15)',
                                  color:
                                    src.lastScrapeStatus === 'success'
                                      ? '#4ade80'
                                      : src.lastScrapeStatus === 'error'
                                        ? '#f87171'
                                        : '#fbbf24'
                                }}
                                title={src.lastScrapeError ?? ''}
                              >
                                last: {src.lastScrapeStatus}
                              </span>
                            ) : null}
                          </div>
                        )}

                        {/* Discovered Channels Checklist for Browser Source */}
                        {src.kind === 'browser' && src.channels && src.channels.length > 0 && (
                          <div
                            style={{
                              marginTop: -4,
                              marginBottom: 8,
                              padding: '12px 16px',
                              background: 'rgba(255, 255, 255, 0.02)',
                              borderRadius: '0 0 8px 8px',
                              border: '1px solid var(--border)',
                              borderTop: 'none'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                                  Monitored Channels ({src.channels.filter((c) => c.enabled !== false).length}/{src.channels.length} active)
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                  Auto-discovered public &amp; private locked channels
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setControlSourceId(src.id)}
                                style={{
                                  fontSize: 11,
                                  padding: '3px 8px',
                                  background: 'rgba(99, 102, 241, 0.15)',
                                  border: '1px solid rgba(99, 102, 241, 0.4)',
                                  color: '#a5b4fc',
                                  borderRadius: 4,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4
                                }}
                              >
                                <span>⚙️</span>
                                <span>Full Matrix &amp; Permissions</span>
                              </button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
                              {src.channels.map((ch) => (
                                <div
                                  key={ch.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 6,
                                    fontSize: 12,
                                    padding: '5px 8px',
                                    background: 'rgba(255, 255, 255, 0.03)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 6
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}>
                                    <span style={{ fontSize: 11, opacity: 0.8 }}>
                                      {ch.isDm || ch.kind === 'dm'
                                        ? '💬'
                                        : ch.isPrivate || ch.kind === 'private'
                                          ? '🔒'
                                          : '#'}
                                    </span>
                                    <span
                                      style={{
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        fontWeight: 500,
                                        color:
                                          ch.enabled !== false || ch.agentRead || ch.agentWrite
                                            ? 'var(--text)'
                                            : 'var(--text-muted)'
                                      }}
                                      title={ch.name || ch.id}
                                    >
                                      {ch.name || ch.id}
                                    </span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleChannelPermission(src.id, ch.id, 'dash', ch.enabled !== false)}
                                      title="Toggle Dashboard Scrape monitoring"
                                      style={{
                                        padding: '2px 5px',
                                        fontSize: 10,
                                        borderRadius: 3,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        border: `1px solid ${ch.enabled !== false ? '#8b5cf6' : 'rgba(255,255,255,0.1)'}`,
                                        background: ch.enabled !== false ? 'rgba(139, 92, 246, 0.25)' : 'transparent',
                                        color: ch.enabled !== false ? '#c4b5fd' : 'var(--text-muted)'
                                      }}
                                    >
                                      📊 Dash
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleChannelPermission(src.id, ch.id, 'read', Boolean(ch.agentRead))}
                                      title="Toggle Agent Read context permission"
                                      style={{
                                        padding: '2px 5px',
                                        fontSize: 10,
                                        borderRadius: 3,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        border: `1px solid ${ch.agentRead ? '#10b981' : 'rgba(255,255,255,0.1)'}`,
                                        background: ch.agentRead ? 'rgba(16, 185, 129, 0.25)' : 'transparent',
                                        color: ch.agentRead ? '#6ee7b7' : 'var(--text-muted)'
                                      }}
                                    >
                                      🤖 Read
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleChannelPermission(src.id, ch.id, 'write', Boolean(ch.agentWrite))}
                                      title="Toggle Agent Write permission (autonomous Slack posting)"
                                      style={{
                                        padding: '2px 5px',
                                        fontSize: 10,
                                        borderRadius: 3,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        border: `1px solid ${ch.agentWrite ? '#f59e0b' : 'rgba(255,255,255,0.1)'}`,
                                        background: ch.agentWrite ? 'rgba(245, 158, 11, 0.25)' : 'transparent',
                                        color: ch.agentWrite ? '#fcd34d' : 'var(--text-muted)'
                                      }}
                                    >
                                      ✍️ Write
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleChannelPermission(src.id, ch.id, 'auto_reply', Boolean(ch.autoReply))}
                                      title="Toggle Real-Time Auto-Reply authorization"
                                      style={{
                                        padding: '2px 5px',
                                        fontSize: 10,
                                        borderRadius: 3,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        border: `1px solid ${ch.autoReply ? '#06b6d4' : 'rgba(255,255,255,0.1)'}`,
                                        background: ch.autoReply ? 'rgba(6, 182, 212, 0.25)' : 'transparent',
                                        color: ch.autoReply ? '#67e8f9' : 'var(--text-muted)'
                                      }}
                                    >
                                      ⚡ Reply
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            </div>
          )}

          {/* TAB: CHANNELS */}
          {activeTab === 'channels' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section className="ws-settings-section">
                <header className="ws-settings-head">
                  <h4>Workspace &amp; channels</h4>
                  <p>
                    Connector: <b>{project.tokenSource === 'oauth' ? 'OAuth app' : 'manual token'}</b> ·{' '}
                    {project.teamName ?? project.teamId} ·{' '}
                    {project.monitors.map((m) => `#${m.channelName}`).join(', ') || 'no channels'}
                  </p>
                </header>
                {editWorkspace ? (
                  <DashboardWizard inline projectId={project.id} onDone={() => setEditWorkspace(false)} />
                ) : (
                  <button type="button" className="dash-subtle" onClick={() => setEditWorkspace(true)}>
                    Edit workspace &amp; channels
                  </button>
                )}
              </section>

              <section className="ws-settings-section">
                <header className="ws-settings-head">
                  <h4>Slack token &amp; permissions</h4>
                  <p>
                    Read-only here. Slack Chat reads history with this token; sending replies additionally
                    needs the <b>chat:write</b> scope.
                  </p>
                </header>
                {tokenStatus === null ? (
                  <p className="ws-settings-token-state">Checking token…</p>
                ) : (
                  <div className="ws-settings-token">
                    <p className="ws-settings-token-state">
                      {tokenStatus.connected ? (
                        <span className="ws-settings-token-dot ok" aria-hidden="true" />
                      ) : (
                        <span className="ws-settings-token-dot off" aria-hidden="true" />
                      )}
                      <b>
                        {tokenStatus.connected
                          ? tokenStatus.source === 'oauth'
                            ? 'Connected via OAuth app'
                            : 'Connected via manual token'
                          : 'Not connected'}
                      </b>
                      {tokenStatus.teamName ? ` · ${tokenStatus.teamName}` : ''}
                    </p>
                    {tokenStatus.maskedToken ? (
                      <p className="ws-settings-token-line">
                        Token:{' '}
                        <span className="proj-token-chip selectable">
                          {tokenStatus.maskedToken.replace(/[`'"]/g, '')}
                        </span>{' '}
                        (full token stays encrypted in this app)
                      </p>
                    ) : null}
                    {tokenStatus.scopes ? (
                      <p className="ws-settings-token-line">
                        Scopes: <code className="selectable">{tokenStatus.scopes.join(', ')}</code>
                      </p>
                    ) : tokenStatus.connected ? (
                      <p className="ws-settings-token-line">
                        Slack doesn&apos;t report scopes for this token type — sending is decided by the
                        token; errors surface when you send.
                      </p>
                    ) : null}
                    {tokenStatus.canSend === true ? (
                      <p className="ai-settings-notice">Sending is enabled — chat:write is granted.</p>
                    ) : null}
                    {tokenStatus.canSend === false ? (
                      <p className="ai-settings-error">
                        Read-only: this token is missing the <b>chat:write</b> scope, so Cosmic cannot post
                        replies. Add <b>chat:write</b> to the Slack app&apos;s User Token Scopes (OAuth
                        &amp; Permissions), reinstall or reconnect the workspace, then try again.
                      </p>
                    ) : null}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* TAB: SCHEDULE */}
          {activeTab === 'schedule' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section className="ws-settings-section">
                <header className="ws-settings-head">
                  <h4>Schedule &amp; completion</h4>
                  <p>Manual values win over dates and percentages the AI finds in chat.</p>
                </header>
                <div className="ws-settings-grid">
                  <label className="ai-settings-field">
                    <span>Start date</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value)
                        setScheduleNotice(null)
                      }}
                    />
                  </label>
                  <label className="ai-settings-field">
                    <span>End date / deadline</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => {
                        setEndDate(e.target.value)
                        setScheduleNotice(null)
                      }}
                    />
                  </label>
                  <label className="ai-settings-field">
                    <span>Completion % (0–100)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="auto"
                      value={completion}
                      onChange={(e) => {
                        setCompletion(e.target.value)
                        setScheduleNotice(null)
                      }}
                    />
                    <small style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Leave empty to auto-calculate from project activity.
                    </small>
                  </label>
                </div>
                {scheduleError ? <p className="ai-settings-error">{scheduleError}</p> : null}
                {scheduleNotice ? <p className="ai-settings-notice">{scheduleNotice}</p> : null}
                <div className="ai-settings-actions" style={{ marginTop: '16px' }}>
                  <button
                    type="button"
                    className="dash-primary"
                    disabled={scheduleSaving || !isScheduleChanged}
                    onClick={() => void saveSchedule()}
                  >
                    {scheduleSaving ? 'Saving…' : 'Save schedule'}
                  </button>
                </div>
              </section>
            </div>
          )}

          {/* TAB: SIDEBAR LAYOUT */}
          {activeTab === 'sidebar' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section className="ws-settings-section" style={{ background: 'transparent', border: 'none', padding: 0 }}>
                <SidebarLayoutView
                  layout={layout}
                  onModeChange={handleModeChange}
                  onToggleSection={handleToggleSection}
                  onReset={handleResetLayout}
                />

                {/* 1. Card Sidebar Buttons & Footer */}
                <div style={{ marginTop: '24px', padding: '16px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border)', borderRadius: '10px' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
                    Card Sidebar Buttons & Footer
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                      <input
                        type="checkbox"
                        checked={layout.custom.hideAddButton === false}
                        onChange={handleToggleHideAddButton}
                      />
                      <span><b>Show "+ Add" button</b> in this card's sidebar footer (alongside Settings)</span>
                    </label>
                  </div>
                </div>

                {/* 2. Global Accounts Section (sidebar-acc-global-accounts) */}
                <div
                  id="sidebar-acc-global-accounts"
                  style={{
                    marginTop: '16px',
                    padding: '16px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 650, color: 'var(--text)' }}>
                        🌐 Global Accounts (sidebar-acc-global-accounts)
                      </h4>
                      <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                        Global workspaces &amp; links. Only <b>Active</b> accounts are accessible to this card &amp; its AI agent.
                      </p>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '12.5px' }}>
                      <input
                        type="checkbox"
                        checked={!layout.custom.hiddenItems?.['slack']?.includes('global_accounts')}
                        onChange={() => handleToggleSubItem('slack', 'global_accounts')}
                      />
                      <span>Show in sidebar</span>
                    </label>
                  </div>

                  {/* List of profiles, their workspaces & links */}
                  {profiles.length === 0 ? (
                    <div style={{ padding: 12, border: '1px dashed var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                      No global profiles configured yet.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {profiles.map((p) => {
                        const pName = p.customName || p.displayName
                        const customLinks = p.customLinks ?? []
                        const slackWorkspaces = p.apps?.slack?.availableWorkspaces ?? []

                        // Across all profiles for bulk actions
                        const allGlobalItemIds = profiles.flatMap((prof) => [
                          ...(prof.apps?.slack?.availableWorkspaces ?? []).map((w) => `ws:${prof.id}:${w.teamId}`),
                          ...(prof.customLinks ?? []).map((l) => l.id)
                        ])

                        const active = layout.custom.activeGlobalItems
                        const allowed = layout.custom.allowedGlobalLinks

                        return (
                          <div
                            key={p.id}
                            style={{
                              background: 'rgba(0, 0, 0, 0.25)',
                              border: '1px solid rgba(255, 255, 255, 0.06)',
                              borderRadius: 8,
                              padding: '14px'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                                  👤 {pName}
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className="dash-subtle"
                                  style={{ fontSize: 11, padding: '2px 8px' }}
                                  onClick={() => {
                                    updateLayout({
                                      ...layout,
                                      custom: {
                                        ...layout.custom,
                                        activeGlobalItems: allGlobalItemIds,
                                        allowedGlobalLinks: allGlobalItemIds
                                      }
                                    })
                                  }}
                                  title="Activate and show all workspaces and links for this card"
                                >
                                  Activate All
                                </button>
                                <button
                                  type="button"
                                  className="dash-subtle"
                                  style={{ fontSize: 11, padding: '2px 8px' }}
                                  onClick={() => {
                                    updateLayout({
                                      ...layout,
                                      custom: {
                                        ...layout.custom,
                                        allowedGlobalLinks: []
                                      }
                                    })
                                  }}
                                  title="Hide all global workspaces and links from this card's sidebar"
                                >
                                  Hide All
                                </button>
                                <button
                                  type="button"
                                  className="dash-subtle"
                                  style={{ fontSize: 11, padding: '2px 8px', color: 'var(--danger)' }}
                                  onClick={() => {
                                    updateLayout({
                                      ...layout,
                                      custom: {
                                        ...layout.custom,
                                        activeGlobalItems: [],
                                        allowedGlobalLinks: []
                                      }
                                    })
                                  }}
                                  title="Deactivate all global accounts for this card (No AI / No sidebar access)"
                                >
                                  Deactivate All
                                </button>
                              </div>
                            </div>

                            {/* Workspaces Section with Active / Deactive & Show / Hide controls */}
                            {slackWorkspaces.length > 0 && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ fontSize: 11, fontWeight: 650, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                                  Slack Workspaces
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                                  {slackWorkspaces.map((w) => {
                                    const wsKey = `ws:${p.id}:${w.teamId}`
                                    const isActive = active === undefined ? true : active.includes(wsKey)
                                    const isShown = allowed === undefined ? true : allowed.includes(wsKey)

                                    return (
                                      <div
                                        key={w.teamId}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          padding: '8px 10px',
                                          borderRadius: 6,
                                          background: !isActive
                                            ? 'rgba(0, 0, 0, 0.4)'
                                            : isShown ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                                          border: `1px solid ${!isActive ? 'rgba(255, 255, 255, 0.04)' : isShown ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.06)'}`,
                                          gap: 8,
                                          opacity: !isActive ? 0.6 : 1
                                        }}
                                      >
                                        <div style={{ minWidth: 0 }}>
                                          <div style={{ fontSize: 12, fontWeight: 600, color: isActive ? '#fff' : '#64748b' }}>
                                            🏢 {w.teamName}
                                          </div>
                                          <div style={{ fontSize: 10, color: '#64748b' }}>Slack Workspace</div>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                          {/* 1. Active / Deactive Toggle Button */}
                                          <button
                                            type="button"
                                            className="dash-subtle"
                                            style={{
                                              fontSize: 10.5,
                                              padding: '2px 6px',
                                              color: isActive ? '#22c55e' : '#94a3b8'
                                            }}
                                            onClick={() => handleToggleActiveGlobalItem(wsKey, allGlobalItemIds)}
                                            title={isActive ? 'Click to deactivate for this card and AI' : 'Click to activate for this card'}
                                          >
                                            {isActive ? '⚡ Active' : '⏸ Inactive'}
                                          </button>

                                          {/* 2. Show / Hide (only when Active) */}
                                          {isActive && (
                                            <>
                                              <button
                                                type="button"
                                                className="dash-subtle"
                                                style={{
                                                  fontSize: 10.5,
                                                  padding: '2px 6px',
                                                  color: isShown ? 'var(--accent-btn)' : '#94a3b8'
                                                }}
                                                onClick={() => handleToggleAllowedGlobalLink(wsKey, allGlobalItemIds)}
                                                title={isShown ? 'Hide from this card sidebar' : 'Show in this card sidebar'}
                                              >
                                                {isShown ? '👁 Shown' : '👁‍🗨 Hidden'}
                                              </button>
                                              {isShown && (
                                                <button
                                                  type="button"
                                                  style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    color: 'var(--danger)',
                                                    fontSize: 12,
                                                    cursor: 'pointer',
                                                    padding: '2px 4px'
                                                  }}
                                                  onClick={() => handleToggleAllowedGlobalLink(wsKey, allGlobalItemIds)}
                                                  title="Remove from sidebar"
                                                >
                                                  ✕
                                                </button>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Links list with Active / Deactive & Show / Hide controls */}
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 650, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                                Custom Tabs &amp; AI Agents
                              </div>
                              {customLinks.length === 0 ? (
                                <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                  No custom links added to this profile.
                                </p>
                              ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                                  {customLinks.map((link) => {
                                    const isActive = active === undefined ? true : active.includes(link.id)
                                    const isShown = allowed === undefined ? true : allowed.includes(link.id)

                                    return (
                                      <div
                                        key={link.id}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          padding: '8px 10px',
                                          borderRadius: 6,
                                          background: !isActive
                                            ? 'rgba(0, 0, 0, 0.4)'
                                            : isShown ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                                          border: `1px solid ${!isActive ? 'rgba(255, 255, 255, 0.04)' : isShown ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.06)'}`,
                                          gap: 8,
                                          opacity: !isActive ? 0.6 : 1
                                        }}
                                      >
                                        <span
                                          style={{
                                            fontSize: 12,
                                            fontWeight: 500,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            color: isActive ? (isShown ? 'var(--text)' : 'var(--text-muted)') : '#64748b'
                                          }}
                                          title={`${link.name}: ${link.url}`}
                                        >
                                          🔗 {link.name}
                                        </span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                          {/* 1. Active / Deactive Toggle Button */}
                                          <button
                                            type="button"
                                            className="dash-subtle"
                                            style={{
                                              fontSize: 10.5,
                                              padding: '2px 6px',
                                              color: isActive ? '#22c55e' : '#94a3b8'
                                            }}
                                            onClick={() => handleToggleActiveGlobalItem(link.id, allGlobalItemIds)}
                                            title={isActive ? 'Click to deactivate for this card and AI' : 'Click to activate for this card'}
                                          >
                                            {isActive ? '⚡ Active' : '⏸ Inactive'}
                                          </button>

                                          {/* 2. Show / Hide (only when Active) */}
                                          {isActive && (
                                            <>
                                              <button
                                                type="button"
                                                className="dash-subtle"
                                                style={{
                                                  fontSize: 10.5,
                                                  padding: '2px 6px',
                                                  color: isShown ? 'var(--accent-btn)' : 'var(--text-muted)'
                                                }}
                                                onClick={() => handleToggleAllowedGlobalLink(link.id, allGlobalItemIds)}
                                                title={isShown ? 'Hide from this card sidebar' : 'Show in this card sidebar'}
                                              >
                                                {isShown ? '👁 Shown' : '👁‍🗨 Hidden'}
                                              </button>
                                              {isShown && (
                                                <button
                                                  type="button"
                                                  style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    color: 'var(--danger)',
                                                    fontSize: 12,
                                                    cursor: 'pointer',
                                                    padding: '2px 4px'
                                                  }}
                                                  onClick={() => handleToggleAllowedGlobalLink(link.id, allGlobalItemIds)}
                                                  title="Remove from this card sidebar"
                                                >
                                                  ✕
                                                </button>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* 3. My Accounts Section (sidebar-acc-my-accounts) */}
                <div
                  id="sidebar-acc-my-accounts"
                  style={{
                    marginTop: '16px',
                    padding: '16px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 650, color: 'var(--text)' }}>
                        👤 My Accounts (sidebar-acc-my-accounts)
                      </h4>
                      <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                        Internal team workspaces, platforms (Discord, Upwork, Teams), and custom links.
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '12.5px' }}>
                        <input
                          type="checkbox"
                          checked={!layout.custom.hiddenItems?.['slack']?.includes('our_slack')}
                          onChange={() => handleToggleSubItem('slack', 'our_slack')}
                        />
                        <span>Show in sidebar</span>
                      </label>
                      <button
                        type="button"
                        className="dash-primary"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => {
                          setCardAddModalTab('my')
                          setCardAddModalOpen(true)
                        }}
                      >
                        + Add Platform / Link
                      </button>
                    </div>
                  </div>

                  {/* Sources belonging to 'ours' */}
                  {(() => {
                    const mySources = (project.sources ?? []).filter((s) => s.role === 'ours')
                    if (mySources.length === 0) {
                      return (
                        <div style={{ padding: 12, border: '1px dashed var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                          No custom sources added under My Accounts yet. Click "+ Add Platform / Link" to attach one.
                        </div>
                      )
                    }
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {mySources.map((src) => (
                          <div
                            key={src.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px 12px',
                              borderRadius: 6,
                              background: 'rgba(0, 0, 0, 0.25)',
                              border: '1px solid rgba(255, 255, 255, 0.06)'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontSize: 14 }}>{src.url ? '🌐' : '🔌'}</span>
                              <div>
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                                  {src.workspaceName}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                                  {src.url ? src.url : (src.platform ?? 'channel')}
                                </span>
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <button
                                type="button"
                                className="dash-subtle"
                                style={{ fontSize: 11, padding: '3px 8px' }}
                                onClick={() => void handleToggleSourceEnabled(src.id, src.enabled !== false)}
                              >
                                {src.enabled !== false ? '👁 Active' : '👁‍🗨 Paused'}
                              </button>
                              <button
                                type="button"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--danger)',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  padding: '3px 6px'
                                }}
                                onClick={() => void handleRemoveSource(src.id)}
                                title="Remove from this card"
                              >
                                ✕ Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>

                {/* 4. Client Accounts Section (sidebar-acc-client-accounts) */}
                <div
                  id="sidebar-acc-client-accounts"
                  style={{
                    marginTop: '16px',
                    padding: '16px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 650, color: 'var(--text)' }}>
                        🤝 Client Accounts (sidebar-acc-client-accounts)
                      </h4>
                      <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                        Client communications, direct workspace tokens, or external client portals.
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '12.5px' }}>
                        <input
                          type="checkbox"
                          checked={!layout.custom.hiddenItems?.['slack']?.includes('client_slack')}
                          onChange={() => handleToggleSubItem('slack', 'client_slack')}
                        />
                        <span>Show in sidebar</span>
                      </label>
                      <button
                        type="button"
                        className="dash-primary"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => {
                          setCardAddModalTab('client')
                          setCardAddModalOpen(true)
                        }}
                      >
                        + Add Platform / Link
                      </button>
                    </div>
                  </div>

                  {/* Sources belonging to 'client' */}
                  {(() => {
                    const clientSources = (project.sources ?? []).filter((s) => s.role === 'client')
                    if (clientSources.length === 0) {
                      return (
                        <div style={{ padding: 12, border: '1px dashed var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                          No client sources added yet. Click "+ Add Platform / Link" to connect one.
                        </div>
                      )
                    }
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {clientSources.map((src) => (
                          <div
                            key={src.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px 12px',
                              borderRadius: 6,
                              background: 'rgba(0, 0, 0, 0.25)',
                              border: '1px solid rgba(255, 255, 255, 0.06)'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontSize: 14 }}>{src.url ? '🌐' : '🔌'}</span>
                              <div>
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                                  {src.workspaceName}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                                  {src.url ? src.url : (src.platform ?? 'channel')}
                                </span>
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <button
                                type="button"
                                className="dash-subtle"
                                style={{ fontSize: 11, padding: '3px 8px' }}
                                onClick={() => void handleToggleSourceEnabled(src.id, src.enabled !== false)}
                              >
                                {src.enabled !== false ? '👁 Active' : '👁‍🗨 Paused'}
                              </button>
                              <button
                                type="button"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--danger)',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  padding: '3px 6px'
                                }}
                                onClick={() => void handleRemoveSource(src.id)}
                                title="Remove from this card"
                              >
                                ✕ Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              </section>
            </div>
          )}

          {/* TAB: DANGER ZONE */}
          {activeTab === 'danger' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section className="ws-settings-section is-danger">
                <header className="ws-settings-head">
                  <h4 style={{ color: 'var(--danger)' }}>Danger zone</h4>
                  <p>Irreversible actions for this project card.</p>
                </header>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <p style={{ fontSize: '13px', color: 'var(--text)', margin: 0 }}>
                    Deleting this card will stop all automated syncing, clear its insight cache, and remove it from the dashboard.
                  </p>
                  {confirmDelete ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <button
                        type="button"
                        style={{
                          background: 'var(--danger)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '10px 16px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                        onClick={() => void handleDeleteProject()}
                        data-testid="confirm-delete-project"
                      >
                        Yes, permanently delete {project.name}
                      </button>
                      <button
                        type="button"
                        className="dash-subtle"
                        onClick={() => setConfirmDelete(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        style={{
                          background: 'transparent',
                          color: 'var(--danger)',
                          border: '1px solid var(--danger)',
                          borderRadius: '8px',
                          padding: '8px 14px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                        onClick={() => setConfirmDelete(true)}
                        data-testid="delete-project-btn"
                      >
                        Delete this project
                      </button>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
            </div>
          </div>
        </div>

        {/* Sticky Footer */}
        <footer className="ws-settings-footer" data-testid="settings-footer">
          <div className="ws-settings-footer-left">
            {isScheduleChanged && activeTab === 'schedule' ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--warn)' }}>
                <span className="ws-settings-unsaved-dot" />
                <span>Unsaved changes</span>
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>
                Settings are saved per section.
              </span>
            )}
          </div>
          <div className="ws-settings-footer-right">
            {activeTab === 'schedule' ? (
              <button
                type="button"
                className="dash-primary"
                disabled={scheduleSaving || !isScheduleChanged}
                onClick={() => void saveSchedule()}
              >
                {scheduleSaving ? 'Saving…' : 'Save schedule'}
              </button>
            ) : null}
          </div>
        </footer>
      </div>

      <RunLogsModal
        open={logsOpen}
        projectId={project.id}
        projectName={project.name}
        onClose={() => setLogsOpen(false)}
      />

      <CardAddModal
        open={cardAddModalOpen}
        project={project}
        defaultTab={cardAddModalTab}
        onClose={() => setCardAddModalOpen(false)}
        onSuccess={() => setCardAddModalOpen(false)}
      />

      {pickerSourceId
        ? (() => {
            const pickerSource = (project.sources ?? []).find((source) => source.id === pickerSourceId)
            if (!pickerSource) return null
            return (
              <SourceChannelPicker
                projectId={project.id}
                source={pickerSource}
                open
                onClose={closeChannelPicker}
                onSaved={() => {
                  setSourceNotice('Channel selection saved')
                  setTimeout(() => setSourceNotice(null), 3000)
                }}
              />
            )
          })()
        : null}

      {controlSourceId
        ? (() => {
            const ctrlSource = (project.sources ?? []).find((s) => s.id === controlSourceId)
            if (!ctrlSource) return null
            return (
              <WorkspaceControlModal
                open
                project={project}
                source={ctrlSource}
                onClose={() => setControlSourceId(null)}
              />
            )
          })()
        : null}
    </div>
  )
}
