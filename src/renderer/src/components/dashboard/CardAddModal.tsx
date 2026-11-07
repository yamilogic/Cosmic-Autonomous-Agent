import React, { useState } from 'react'
import { useProfileStore } from '../../hooks/useProfiles'
import { useDashboardStore } from '../../hooks/useDashboard'
import type { DashboardProject, ProjectSource } from '../../../../shared/dashboard-contract'
import { POPULAR_PRESETS } from './AddPlatformPage'
import { useSidebarLayout } from './use-sidebar-layout'

interface CardAddModalProps {
  open: boolean
  project: DashboardProject
  defaultTab?: 'global' | 'my' | 'client'
  onClose: () => void
  onSuccess?: (msg: string) => void
}

export function CardAddModal({
  open,
  project,
  defaultTab = 'global',
  onClose,
  onSuccess
}: CardAddModalProps): React.JSX.Element | null {
  const [tab, setTab] = useState<'global' | 'my' | 'client'>(defaultTab)

  React.useEffect(() => {
    if (open && defaultTab) {
      setTab(defaultTab)
    }
  }, [open, defaultTab])
  const profiles = useProfileStore((s) => s.profiles)
  const upsertProject = useDashboardStore((s) => s.upsertProject)
  const { layout, updateLayout } = useSidebarLayout(project.id)

  const handleToggleActiveGlobalItem = (itemId: string, allItemIds: string[]) => {
    const current = layout.custom.activeGlobalItems !== undefined
      ? [...layout.custom.activeGlobalItems]
      : [...allItemIds]

    let updatedActive: string[]
    if (current.includes(itemId)) {
      updatedActive = current.filter((id) => id !== itemId)
    } else {
      updatedActive = [...current, itemId]
    }

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

  const handleToggleAllowedGlobalLink = (linkId: string, allGlobalItemIds: string[]) => {
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

  // Profile-grouped structure of all available workspaces and links
  const profileGroups = profiles.map((p) => {
    const pName = p.customName || p.displayName
    const slackWorkspaces = p.apps?.slack?.availableWorkspaces ?? []
    const customLinks = p.customLinks ?? []
    return {
      profileId: p.id,
      profileName: pName,
      slackWorkspaces,
      customLinks,
      hasItems: slackWorkspaces.length > 0 || customLinks.length > 0
    }
  }).filter((g) => g.hasItems)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form states for My Accounts & Client Accounts
  const [itemPlatform, setItemPlatform] = useState<string>('slack')
  const [itemName, setItemName] = useState('')
  const [itemUrl, setItemUrl] = useState('')

  if (!open) return null

  const handleAddWorkspaceFromGlobal = async (
    profileId: string,
    teamId: string,
    teamName: string,
    role: 'client' | 'ours'
  ) => {
    setBusy(true)
    setError(null)
    try {
      const existingSources = project.sources ?? []
      const duplicate = existingSources.some(
        (s) => s.workspaceId === teamId && s.profileId === profileId
      )
      if (duplicate) {
        setError(`${teamName} is already added as a source for this project.`)
        return
      }

      const now = new Date().toISOString()
      const newSource: ProjectSource = {
        id: `src-browser-${Date.now().toString(36)}`,
        kind: 'browser',
        platform: 'slack',
        profileId,
        workspaceId: teamId,
        workspaceName: teamName,
        channels: [],
        role,
        backfillDays: 7,
        enabled: true,
        status: 'connected',
        selectionMode: 'include',
        createdAt: now,
        updatedAt: now
      }

      const updatedSources = [...existingSources, newSource]

      // If draft-project, do not persist to disk, only pass in memory
      if (project.id === 'draft-project' || project.id.startsWith('draft-')) {
        project.sources = updatedSources
        onSuccess?.(`Added ${teamName} to ${project.name}`)
        onClose()
        return
      }

      await upsertProject({
        ...project,
        sources: updatedSources
      })

      onSuccess?.(`Added ${teamName} to ${project.name}`)
      onClose()
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to add source')
    } finally {
      setBusy(false)
    }
  }

  const handleAddCustomAccount = async (role: 'client' | 'ours') => {
    if (!itemName.trim()) {
      setError('Please provide an account or channel name')
      return
    }

    // Resolve a real profile ID (never pass virtual manual: tokens to profile store APIs)
    const validProfile =
      profiles.find((p) => p.id === project.profileId && !p.id.startsWith('manual:')) ||
      profiles.find((p) => !p.id.startsWith('manual:') && (p.isGlobalProfile || p.id === 'global-account-profile')) ||
      profiles.find((p) => !p.id.startsWith('manual:')) ||
      profiles[0]

    const targetProfileId = validProfile?.id
    if (!targetProfileId) {
      setError('No profile available to attach to')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const formattedUrl = itemUrl.trim()
        ? (itemUrl.trim().startsWith('http') ? itemUrl.trim() : `https://${itemUrl.trim()}`)
        : undefined

      // Register source on the card's project.sources[] directly (isolated to this card)
      const now = new Date().toISOString()
      const existingSources = project.sources ?? []
      const newSource: ProjectSource = {
        id: `src-custom-${Date.now().toString(36)}`,
        kind: 'browser',
        platform: itemPlatform || 'slack',
        profileId: targetProfileId,
        workspaceId: `custom-${Date.now().toString(36)}`,
        workspaceName: itemName.trim(),
        url: formattedUrl,
        channels: [],
        role,
        backfillDays: 7,
        enabled: true,
        status: 'connected',
        createdAt: now,
        updatedAt: now
      }

      const updatedSources = [...existingSources, newSource]

      // If draft-project, do not persist to disk, only pass in memory
      if (project.id === 'draft-project' || project.id.startsWith('draft-')) {
        project.sources = updatedSources
        onSuccess?.(`Added ${itemName.trim()} to ${role === 'client' ? 'Client Accounts' : 'My Accounts'}`)
        onClose()
        return
      }

      await upsertProject({
        ...project,
        sources: updatedSources
      })

      onSuccess?.(`Added ${itemName.trim()} to ${role === 'client' ? 'Client Accounts' : 'My Accounts'}`)
      onClose()
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to save account')
    } finally {
      setBusy(false)
    }
  }

  const mySourcesCount = (project.sources ?? []).filter((s) => s.role === 'ours').length
  const clientSourcesCount = (project.sources ?? []).filter((s) => s.role === 'client').length
  const totalGlobalItems = profileGroups.reduce(
    (acc, g) => acc + g.slackWorkspaces.length + g.customLinks.length,
    0
  )

  const handleToggleSourceEnabled = async (sourceId: string, currentEnabled: boolean) => {
    try {
      const updatedSources = (project.sources ?? []).map((s) =>
        s.id === sourceId ? { ...s, enabled: !currentEnabled } : s
      )
      await upsertProject({
        ...project,
        sources: updatedSources
      })
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to update source')
    }
  }

  const handleRemoveSource = async (sourceId: string) => {
    try {
      const updatedSources = (project.sources ?? []).filter((s) => s.id !== sourceId)
      await upsertProject({
        ...project,
        sources: updatedSources
      })
      onSuccess?.('Source removed from card')
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to remove source')
    }
  }

  return (
    <div
      className="platform-settings-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        zIndex: 1400,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(8px)'
      }}
    >
      <div
        className="add-platform-panel accounts-hub-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Add to ${project.name}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1440px, 98vw)',
          height: 'min(92vh, 920px)',
          maxHeight: 'min(92vh, 920px)',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          backgroundColor: 'var(--surface-2)',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.85)'
        }}
      >
        {/* Top Navbar Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(12, 17, 33, 0.98)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '22px' }}>➕</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f8fafc' }}>
                Add to {project.name}
              </h2>
              <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>
                Attach global profiles, configure team accounts, or add client communication channels for this project card.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                fontSize: '11px',
                padding: '4px 10px',
                borderRadius: '6px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#cbd5e1'
              }}
            >
              Card: <b>{project.name}</b>
            </span>
            <button
              type="button"
              className="btn ghost btn-sm"
              onClick={onClose}
              aria-label="Close"
              style={{ fontSize: '13px', color: '#94a3b8' }}
            >
              ✕ Close
            </button>
          </div>
        </header>

        {error && (
          <div
            style={{
              padding: '10px 24px',
              background: 'rgba(239, 68, 68, 0.15)',
              borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontSize: '13px'
            }}
          >
            {error}
          </div>
        )}

        {/* 2-Column Main Layout: Left Navigation Rail & Right Content Canvas */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left Navigation Rail */}
          <aside
            style={{
              width: '280px',
              borderRight: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(10, 15, 29, 0.96)',
              padding: '18px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              overflowY: 'auto'
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 650, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 8px 4px' }}>
              Card Categories
            </div>

            {/* 1. Global Workspaces & Links */}
            <button
              type="button"
              onClick={() => { setTab('global'); setError(null) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderRadius: '8px',
                background: tab === 'global' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                color: tab === 'global' ? '#60a5fa' : '#cbd5e1',
                border: tab === 'global' ? '1px solid rgba(59, 130, 246, 0.35)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: tab === 'global' ? 600 : 400,
                textAlign: 'left',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '16px' }}>🌐</span>
                <span>Global Accounts</span>
              </div>
              <span style={{ fontSize: '11px', color: '#60a5fa', background: 'rgba(96, 165, 250, 0.1)', padding: '2px 7px', borderRadius: '4px', fontWeight: 600 }}>
                {totalGlobalItems}
              </span>
            </button>

            {/* 2. My Accounts */}
            <button
              type="button"
              onClick={() => { setTab('my'); setError(null) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderRadius: '8px',
                background: tab === 'my' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                color: tab === 'my' ? '#60a5fa' : '#cbd5e1',
                border: tab === 'my' ? '1px solid rgba(59, 130, 246, 0.35)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: tab === 'my' ? 600 : 400,
                textAlign: 'left',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '16px' }}>👥</span>
                <span>My Accounts</span>
              </div>
              <span style={{ fontSize: '11px', color: '#4ade80', background: 'rgba(74, 222, 128, 0.1)', padding: '2px 7px', borderRadius: '4px', fontWeight: 600 }}>
                {mySourcesCount}
              </span>
            </button>

            {/* 3. Client Accounts */}
            <button
              type="button"
              onClick={() => { setTab('client'); setError(null) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderRadius: '8px',
                background: tab === 'client' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                color: tab === 'client' ? '#60a5fa' : '#cbd5e1',
                border: tab === 'client' ? '1px solid rgba(59, 130, 246, 0.35)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: tab === 'client' ? 600 : 400,
                textAlign: 'left',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '16px' }}>🏢</span>
                <span>Client Accounts</span>
              </div>
              <span style={{ fontSize: '11px', color: '#a78bfa', background: 'rgba(167, 139, 250, 0.1)', padding: '2px 7px', borderRadius: '4px', fontWeight: 600 }}>
                {clientSourcesCount}
              </span>
            </button>

            {/* Card Scope Badge Widget */}
            <div
              style={{
                marginTop: 'auto',
                padding: '14px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', fontWeight: 650 }}>
                Project Overview
              </span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                {project.name}
              </span>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Client: {project.clientName || 'Unassigned'}
              </span>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Total Sources: {(project.sources ?? []).length}
              </span>
            </div>
          </aside>

          {/* Right Main Content Canvas */}
          <main
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '24px 32px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              background: 'var(--bg-page)'
            }}
          >
            {/* TAB 1: GLOBAL WORKSPACES & LINKS */}
            {tab === 'global' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <h3 style={{ margin: '0 0 6px 0', fontSize: '17px', fontWeight: 600, color: '#f8fafc' }}>
                    🌐 Global Accounts &amp; Profiles
                  </h3>
                  <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                    Attach any signed-in workspace or custom link directly to <b>{project.name}</b>.
                  </p>
                </div>

                {profileGroups.length === 0 ? (
                  <div style={{ padding: '36px', textAlign: 'center', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '10px', color: '#94a3b8' }}>
                    No global accounts or workspaces authenticated yet.
                  </div>
                ) : (
                  profileGroups.map((group) => (
                    <div
                      key={group.profileId}
                      style={{
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '10px',
                        padding: '18px 20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 14
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: '18px' }}>👤</span>
                          <span style={{ fontSize: '15px', fontWeight: 650, color: '#f8fafc' }}>
                            {group.profileName}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {(() => {
                            const allGlobalItemIds = profiles.flatMap((prof) => [
                              ...(prof.apps?.slack?.availableWorkspaces ?? []).map((w) => `ws:${prof.id}:${w.teamId}`),
                              ...(prof.customLinks ?? []).map((l) => l.id)
                            ])
                            return (
                              <>
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
                                >
                                  Deactivate All
                                </button>
                              </>
                            )
                          })()}
                        </div>
                      </div>

                      {/* Workspaces List with Active/Inactive and Show/Hide Controls */}
                      {group.slackWorkspaces.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>
                            Slack Workspaces
                          </span>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 10 }}>
                            {group.slackWorkspaces.map((w) => {
                              const wsKey = `ws:${group.profileId}:${w.teamId}`
                              const active = layout.custom.activeGlobalItems
                              const allowed = layout.custom.allowedGlobalLinks
                              const isActive = active === undefined ? true : active.includes(wsKey)
                              const isShown = allowed === undefined ? true : allowed.includes(wsKey)
                              const allGlobalItemIds = profiles.flatMap((prof) => [
                                ...(prof.apps?.slack?.availableWorkspaces ?? []).map((x) => `ws:${prof.id}:${x.teamId}`),
                                ...(prof.customLinks ?? []).map((l) => l.id)
                              ])

                              return (
                                <div
                                  key={`${group.profileId}:${w.teamId}`}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '10px 14px',
                                    background: !isActive ? 'rgba(0, 0, 0, 0.4)' : isShown ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                                    border: `1px solid ${!isActive ? 'rgba(255, 255, 255, 0.04)' : isShown ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.06)'}`,
                                    borderRadius: '8px',
                                    opacity: !isActive ? 0.6 : 1
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span style={{ fontSize: '16px' }}>🏢</span>
                                    <div>
                                      <div style={{ fontSize: '13px', fontWeight: 600, color: isActive ? '#fff' : '#64748b' }}>
                                        {w.teamName}
                                      </div>
                                      <div style={{ fontSize: '11px', color: '#64748b' }}>Slack Workspace</div>
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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

                                    {isActive && (
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
                                    )}

                                    <button
                                      type="button"
                                      className="btn ghost"
                                      style={{ fontSize: '11px', padding: '3px 7px' }}
                                      disabled={busy}
                                      onClick={() => void handleAddWorkspaceFromGlobal(group.profileId, w.teamId, w.teamName, 'ours')}
                                      title="Add to My Accounts on this card"
                                    >
                                      + My Acc
                                    </button>
                                    <button
                                      type="button"
                                      className="btn primary"
                                      style={{ fontSize: '11px', padding: '3px 7px' }}
                                      disabled={busy}
                                      onClick={() => void handleAddWorkspaceFromGlobal(group.profileId, w.teamId, w.teamName, 'client')}
                                      title="Add to Client Accounts on this card"
                                    >
                                      + Client Acc
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Custom Links List with Active/Inactive and Show/Hide Controls */}
                      {group.customLinks.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>
                            Custom Tabs &amp; AI Agents
                          </span>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                            {group.customLinks.map((link) => {
                              const active = layout.custom.activeGlobalItems
                              const allowed = layout.custom.allowedGlobalLinks
                              const isActive = active === undefined ? true : active.includes(link.id)
                              const isShown = allowed === undefined ? true : allowed.includes(link.id)
                              const allGlobalItemIds = profiles.flatMap((prof) => [
                                ...(prof.apps?.slack?.availableWorkspaces ?? []).map((x) => `ws:${prof.id}:${x.teamId}`),
                                ...(prof.customLinks ?? []).map((l) => l.id)
                              ])

                              return (
                                <div
                                  key={link.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '10px 14px',
                                    background: !isActive ? 'rgba(0, 0, 0, 0.4)' : isShown ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                                    border: `1px solid ${!isActive ? 'rgba(255, 255, 255, 0.04)' : isShown ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.06)'}`,
                                    borderRadius: '8px',
                                    opacity: !isActive ? 0.6 : 1
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                    <span style={{ fontSize: '15px' }}>🔗</span>
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontSize: '13px', fontWeight: 600, color: isActive ? '#fff' : '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {link.name}
                                      </div>
                                      <div style={{ fontSize: '11px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {link.url}
                                      </div>
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
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

                                    {isActive && (
                                      <button
                                        type="button"
                                        className="dash-subtle"
                                        style={{
                                          fontSize: 10.5,
                                          padding: '2px 6px',
                                          color: isShown ? 'var(--accent-btn)' : '#94a3b8'
                                        }}
                                        onClick={() => handleToggleAllowedGlobalLink(link.id, allGlobalItemIds)}
                                        title={isShown ? 'Hide from this card sidebar' : 'Show in this card sidebar'}
                                      >
                                        {isShown ? '👁 Shown' : '👁‍🗨 Hidden'}
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      className="btn ghost"
                                      style={{ fontSize: '11px', padding: '4px 8px', flexShrink: 0 }}
                                      onClick={() => window.open(link.url, '_blank')}
                                    >
                                      Open ↗
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 2: MY ACCOUNTS */}
            {tab === 'my' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div>
                  <h3 style={{ margin: '0 0 6px 0', fontSize: '17px', fontWeight: 600, color: '#f8fafc' }}>
                    👥 My Accounts (Internal Channels &amp; Platforms)
                  </h3>
                  <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                    Connect internal team channels, portals, or monitoring platforms to <b>{project.name}</b>.
                  </p>
                </div>

                {/* Form to Add New */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '10px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16
                  }}
                >
                  <span style={{ fontSize: '13.5px', fontWeight: 650, color: '#f8fafc' }}>
                    Attach New Platform / Service
                  </span>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 2fr', gap: 14 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: 6 }}>
                        Platform
                      </label>
                      <select
                        value={itemPlatform}
                        onChange={(e) => setItemPlatform(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '9px 12px',
                          borderRadius: '6px',
                          background: '#020617',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: '#fff',
                          fontSize: '13px'
                        }}
                      >
                        <option value="slack">Slack</option>
                        <option value="upwork">Upwork</option>
                        <option value="teams">Microsoft Teams</option>
                        <option value="discord">Discord</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="googlechat">Google Chat</option>
                        <option value="custom">Other Web Platform</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: 6 }}>
                        Account / Workspace Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Core Team Workspace, Internal Chat"
                        value={itemName}
                        onChange={(e) => setItemName(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '9px 12px',
                          borderRadius: '6px',
                          background: '#020617',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: '#fff',
                          fontSize: '13px',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: 6 }}>
                        URL or Portal Link (optional)
                      </label>
                      <input
                        type="text"
                        placeholder="https://..."
                        value={itemUrl}
                        onChange={(e) => setItemUrl(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '9px 12px',
                          borderRadius: '6px',
                          background: '#020617',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: '#fff',
                          fontSize: '13px',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                  </div>

                  {/* Quick Preset Buttons */}
                  <div>
                    <span style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 8, fontWeight: 600 }}>
                      Quick Suggestions:
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {POPULAR_PRESETS.map((preset) => (
                        <button
                          key={preset.name}
                          type="button"
                          onClick={() => {
                            setItemName(preset.name)
                            setItemUrl(preset.url)
                          }}
                          style={{
                            padding: '5px 10px',
                            fontSize: '11.5px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '5px',
                            color: '#cbd5e1',
                            cursor: 'pointer'
                          }}
                        >
                          {preset.icon} {preset.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!itemName.trim() || busy}
                      onClick={() => void handleAddCustomAccount('ours')}
                      style={{ padding: '8px 18px', fontSize: '13px' }}
                    >
                      {busy ? 'Adding…' : 'Add to My Accounts'}
                    </button>
                  </div>
                </div>

                {/* Existing Attached Sources in My Accounts */}
                <div>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                    Currently Connected in My Accounts ({mySourcesCount})
                  </h4>
                  {mySourcesCount === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '8px', color: '#64748b', fontSize: '13px' }}>
                      No internal platforms attached to this card yet.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {(project.sources ?? []).filter((s) => s.role === 'ours').map((src) => (
                        <div
                          key={src.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 16px',
                            borderRadius: '8px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid rgba(255, 255, 255, 0.08)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: '18px' }}>{src.url ? '🌐' : '🔌'}</span>
                            <div>
                              <div style={{ fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                                {src.workspaceName}
                              </div>
                              <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                                {src.url ? src.url : `Platform: ${src.platform ?? 'slack'}`}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                              type="button"
                              className="dash-subtle"
                              style={{ fontSize: '11.5px', padding: '4px 10px' }}
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
                                fontSize: '12px',
                                cursor: 'pointer',
                                padding: '4px 8px'
                              }}
                              onClick={() => void handleRemoveSource(src.id)}
                            >
                              ✕ Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: CLIENT ACCOUNTS */}
            {tab === 'client' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div>
                  <h3 style={{ margin: '0 0 6px 0', fontSize: '17px', fontWeight: 600, color: '#f8fafc' }}>
                    🏢 Client Accounts (Communication Channels &amp; Portals)
                  </h3>
                  <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                    Connect client workspaces, portals, or specific project communication links to <b>{project.name}</b>.
                  </p>
                </div>

                {/* Form to Add Client Source */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '10px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16
                  }}
                >
                  <span style={{ fontSize: '13.5px', fontWeight: 650, color: '#f8fafc' }}>
                    Attach Client Workspace or Channel
                  </span>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 2fr', gap: 14 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: 6 }}>
                        Platform
                      </label>
                      <select
                        value={itemPlatform}
                        onChange={(e) => setItemPlatform(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '9px 12px',
                          borderRadius: '6px',
                          background: '#020617',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: '#fff',
                          fontSize: '13px'
                        }}
                      >
                        <option value="slack">Slack</option>
                        <option value="teams">Microsoft Teams</option>
                        <option value="discord">Discord</option>
                        <option value="upwork">Upwork</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="googlechat">Google Chat</option>
                        <option value="custom">Client Portal / Web</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: 6 }}>
                        Client Account / Workspace Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Client Slack, #client-updates"
                        value={itemName}
                        onChange={(e) => setItemName(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '9px 12px',
                          borderRadius: '6px',
                          background: '#020617',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: '#fff',
                          fontSize: '13px',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: 6 }}>
                        URL or Portal Link (optional)
                      </label>
                      <input
                        type="text"
                        placeholder="https://..."
                        value={itemUrl}
                        onChange={(e) => setItemUrl(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '9px 12px',
                          borderRadius: '6px',
                          background: '#020617',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: '#fff',
                          fontSize: '13px',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!itemName.trim() || busy}
                      onClick={() => void handleAddCustomAccount('client')}
                      style={{ padding: '8px 18px', fontSize: '13px' }}
                    >
                      {busy ? 'Adding…' : 'Add to Client Accounts'}
                    </button>
                  </div>
                </div>

                {/* Existing Attached Sources in Client Accounts */}
                <div>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                    Currently Connected in Client Accounts ({clientSourcesCount})
                  </h4>
                  {clientSourcesCount === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '8px', color: '#64748b', fontSize: '13px' }}>
                      No client platforms attached to this card yet.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {(project.sources ?? []).filter((s) => s.role === 'client').map((src) => (
                        <div
                          key={src.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 16px',
                            borderRadius: '8px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid rgba(255, 255, 255, 0.08)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: '18px' }}>{src.url ? '🌐' : '🔌'}</span>
                            <div>
                              <div style={{ fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                                {src.workspaceName}
                              </div>
                              <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                                {src.url ? src.url : `Platform: ${src.platform ?? 'slack'}`}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                              type="button"
                              className="dash-subtle"
                              style={{ fontSize: '11.5px', padding: '4px 10px' }}
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
                                fontSize: '12px',
                                cursor: 'pointer',
                                padding: '4px 8px'
                              }}
                              onClick={() => void handleRemoveSource(src.id)}
                            >
                              ✕ Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
