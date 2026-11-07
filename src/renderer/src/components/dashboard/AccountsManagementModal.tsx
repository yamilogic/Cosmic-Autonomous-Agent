import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { DashboardProject, ProjectWorkflowStatus } from '../../../../shared/dashboard-contract'
import {
  CustomLink,
  Profile,
  isGlobalAccountProfile,
  isIndividualProfile,
  profileDisplayLabel
} from '../../../../shared/types'
import { useDashboardStore } from '../../hooks/useDashboard'
import { useProfileStore } from '../../hooks/useProfiles'
import {
  DeleteConfirmNoticeModal,
  CardDeleteTarget,
  ProfileDeleteTarget
} from './DeleteConfirmNoticeModal'

export type HubNavSection = 'observer' | 'global' | 'individual'

interface AccountsManagementModalProps {
  open: boolean
  onClose: () => void
  onAddWebsite?: () => void
  onNewProject?: () => void
  onNewProfile?: () => void
  onAddGoogleAccount?: () => void
  onSelectProfile?: (profileId: string) => void
  onOpenCustomLink?: (profileId: string, link: CustomLink) => void
  onOpenObserver?: () => void
}

export function AccountsManagementModal({
  open,
  onClose,
  onAddWebsite,
  onNewProject,
  onNewProfile,
  onAddGoogleAccount,
  onSelectProfile: _onSelectProfile,
  onOpenCustomLink: _onOpenCustomLink,
  onOpenObserver
}: AccountsManagementModalProps): React.JSX.Element | null {
  const profiles = useProfileStore((s) => s.profiles)
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const snapshot = useDashboardStore((s) => s.snapshot)
  const loadSnapshot = useDashboardStore((s) => s.loadSnapshot)
  const upsertProject = useDashboardStore((s) => s.upsertProject)

  // Strict Scopes Separation:
  // Global company accounts (e.g. Rajesh)
  const globalProfiles = useMemo(() => profiles.filter(isGlobalAccountProfile), [profiles])
  // Genuine individual client profiles (e.g. ashutosh, unknown)
  const individualProfiles = useMemo(() => profiles.filter(isIndividualProfile), [profiles])

  // Navigation State in Hub: default to individual if available, else global
  const [activeSection, setActiveSection] = useState<HubNavSection>('individual')
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [profilesDropdownExpanded, setProfilesDropdownExpanded] = useState(true)

  // Project Filter State: 'all' | 'active' | 'stopped' | 'archived'
  const [projectStatusFilter, setProjectStatusFilter] = useState<'all' | 'active' | 'stopped' | 'archived'>('all')
  const [errorMsg] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<
    | { type: 'card'; card: CardDeleteTarget }
    | { type: 'profile'; profile: ProfileDeleteTarget }
    | null
  >(null)

  const handleConfirmCardDelete = async (cardId: string): Promise<void> => {
    await useDashboardStore.getState().deleteProject(cardId)
    await loadSnapshot()
  }

  const handleConfirmProfileDelete = async (profileId: string, deleteCards: boolean): Promise<void> => {
    await useProfileStore.getState().deleteProfile(profileId, deleteCards)
    await loadSnapshot()
    const remaining = individualProfiles.filter((p) => p.id !== profileId)
    if (remaining.length > 0) {
      setSelectedProfileId(remaining[0]!.id)
    } else {
      setActiveSection('global')
    }
  }

  // Ensure snapshot is loaded when hub opens
  useEffect(() => {
    if (open) {
      void loadSnapshot()
    }
  }, [open, loadSnapshot])

  // Select initial individual profile strictly
  useEffect(() => {
    if (individualProfiles.length > 0) {
      if (!selectedProfileId || !individualProfiles.some((p) => p.id === selectedProfileId)) {
        setSelectedProfileId(individualProfiles[0]!.id)
      }
    } else {
      setSelectedProfileId(null)
    }
  }, [individualProfiles, selectedProfileId])

  // Current selected individual profile
  const currentProfile = useMemo(() => {
    return individualProfiles.find((p) => p.id === selectedProfileId) || individualProfiles[0] || null
  }, [individualProfiles, selectedProfileId])

  // All projects across entire app
  const allProjects: DashboardProject[] = useMemo(() => {
    return (snapshot?.projects ?? []).map((p) => p.project)
  }, [snapshot])

  // Projects belonging to current selected profile
  const profileProjects: DashboardProject[] = useMemo(() => {
    if (!currentProfile) return []
    return allProjects.filter((p) => p.profileId === currentProfile.id)
  }, [allProjects, currentProfile])

  // Filtered projects by workflow status
  const filteredProjects = useMemo(() => {
    return profileProjects.filter((p) => {
      const status: ProjectWorkflowStatus = p.workflowStatus || 'active'
      if (projectStatusFilter === 'all') return true
      if (projectStatusFilter === 'active') return status === 'active'
      if (projectStatusFilter === 'stopped') return status === 'stopped'
      if (projectStatusFilter === 'archived') return status === 'completed' || status === 'removed'
      return true
    })
  }, [profileProjects, projectStatusFilter])

  // Count metrics for filters
  const projectMetrics = useMemo(() => {
    let active = 0
    let stopped = 0
    let archived = 0
    for (const p of profileProjects) {
      const st = p.workflowStatus || 'active'
      if (st === 'active') active++
      else if (st === 'stopped') stopped++
      else if (st === 'completed' || st === 'removed') archived++
    }
    return { all: profileProjects.length, active, stopped, archived }
  }, [profileProjects])

  // Handler for updating a project's workflow status
  const handleUpdateProjectStatus = useCallback(
    async (project: DashboardProject, newStatus: ProjectWorkflowStatus) => {
      try {
        await upsertProject({
          ...project,
          workflowStatus: newStatus
        })
      } catch (err) {
        console.error('Failed to update project status:', err)
      }
    },
    [upsertProject]
  )

  const handleToggleCardSidebarVisibility = useCallback(
    async (project: DashboardProject) => {
      try {
        const isHidden = project.hiddenInSidebar || project.workflowStatus === 'removed'
        const nextHidden = !isHidden
        await upsertProject({
          ...project,
          hiddenInSidebar: nextHidden,
          workflowStatus: !nextHidden && project.workflowStatus === 'removed' ? 'active' : project.workflowStatus
        })
      } catch (err) {
        console.error('Failed to toggle card sidebar visibility:', err)
      }
    },
    [upsertProject]
  )

  const handleToggleSidebarVisibility = useCallback(async (profile: Profile) => {
    try {
      const nextHidden = !profile.hiddenInSidebar
      const updated = await window.api.profiles.setHiddenInSidebar(profile.id, nextHidden)
      useProfileStore.setState((prev) => ({
        profiles: prev.profiles.map((p) => (p.id === updated.id ? updated : p))
      }))
    } catch (err) {
      console.error('Failed to toggle profile sidebar visibility', err)
    }
  }, [])

  if (!open) return null

  return (
    <div className="add-platform-backdrop" onClick={onClose}>
      <div
        className="add-platform-panel accounts-hub-panel"
        style={{
          width: 'min(1440px, 98vw)',
          height: 'min(92vh, 920px)',
          maxHeight: 'min(92vh, 920px)',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Accounts and Workspaces Hub"
      >
        {/* Top Navbar Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-2)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '22px' }}>👥</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f8fafc' }}>
                All Your Accounts
              </h2>
              <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>
                Unified workspace manager • {profiles.length} connected profiles • {allProjects.length} total projects
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {onAddWebsite && (
              <button
                type="button"
                className="btn ghost btn-sm"
                onClick={() => {
                  onClose()
                  onAddWebsite()
                }}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                🌐 + Website
              </button>
            )}
            {onNewProject && (
              <button
                type="button"
                className="btn ghost btn-sm"
                onClick={() => {
                  onClose()
                  onNewProject()
                }}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                📁 + Project
              </button>
            )}
            {onNewProfile && (
              <button
                type="button"
                className="btn primary btn-sm"
                onClick={() => {
                  onClose()
                  onNewProfile()
                }}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                👤 + Profile
              </button>
            )}
            {!onNewProfile && onAddGoogleAccount && (
              <button
                type="button"
                className="btn primary btn-sm"
                onClick={() => {
                  onClose()
                  onAddGoogleAccount()
                }}
                style={{ fontSize: '12px', padding: '6px 14px' }}
              >
                + Add Google Account
              </button>
            )}
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

        {errorMsg && (
          <div
            style={{
              padding: '8px 16px',
              background: 'rgba(239, 68, 68, 0.15)',
              borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontSize: '0.85rem'
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* 2-Column Main Workspace Area */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left Hub Navigation Rail */}
          <aside
            style={{
              width: '280px',
              borderRight: '1px solid var(--border)',
              background: 'var(--surface)',
              padding: '16px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              overflowY: 'auto'
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 650, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 8px 4px' }}>
              Navigation &amp; Scopes
            </div>

            {/* 1. Observer Mode */}
            <button
              type="button"
              onClick={() => setActiveSection('observer')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 12px',
                borderRadius: '8px',
                background: activeSection === 'observer' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                color: activeSection === 'observer' ? '#60a5fa' : '#cbd5e1',
                border: activeSection === 'observer' ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                textAlign: 'left',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '15px' }}>🔭</span>
                <span>Observer</span>
              </div>
              <span style={{ fontSize: '10px', color: '#64748b', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                Streams
              </span>
            </button>

            {/* 2. Global Accounts (Non-dropdown, all connected accounts) */}
            <button
              type="button"
              onClick={() => setActiveSection('global')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 12px',
                borderRadius: '8px',
                background: activeSection === 'global' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                color: activeSection === 'global' ? '#60a5fa' : '#cbd5e1',
                border: activeSection === 'global' ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                textAlign: 'left',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '15px' }}>🌐</span>
                <span>Global Accounts</span>
              </div>
              <span style={{ fontSize: '10px', color: '#4ade80', background: 'rgba(74, 222, 128, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                {globalProfiles.length} Connected
              </span>
            </button>

            {/* 3. Individual Accounts (Collapsible dropdown) */}
            <div style={{ marginTop: '6px' }}>
              <button
                type="button"
                onClick={() => setProfilesDropdownExpanded(!profilesDropdownExpanded)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: 'transparent',
                  color: '#94a3b8',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  fontWeight: 650,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  textAlign: 'left'
                }}
              >
                <span>Individual Profiles ({individualProfiles.length})</span>
                <span style={{ fontSize: '10px', opacity: 0.7, transform: profilesDropdownExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}>
                  ▸
                </span>
              </button>

              {profilesDropdownExpanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px', paddingLeft: '8px' }}>
                  {individualProfiles.length === 0 ? (
                    <div style={{ fontSize: '11.5px', color: '#64748b', padding: '6px 10px', fontStyle: 'italic' }}>
                      No individual profiles
                    </div>
                  ) : (
                    individualProfiles.map((profile) => {
                      const isSelected = activeSection === 'individual' && selectedProfileId === profile.id
                      const isSigned = profile.googleAuthStatus === 'signed-in'
                      const pProjects = allProjects.filter((p) => p.profileId === profile.id)

                      return (
                        <button
                          key={profile.id}
                          type="button"
                          onClick={() => {
                            setActiveSection('individual')
                            setSelectedProfileId(profile.id)
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '7px 10px',
                            borderRadius: '6px',
                            background: isSelected ? 'rgba(59, 130, 246, 0.18)' : 'transparent',
                            color: isSelected ? '#60a5fa' : '#cbd5e1',
                            border: isSelected ? '1px solid rgba(59, 130, 246, 0.35)' : '1px solid transparent',
                            cursor: 'pointer',
                            fontSize: '12.5px',
                            fontWeight: isSelected ? 600 : 400,
                            textAlign: 'left',
                            transition: 'all 0.12s ease'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                            <span
                              style={{
                                width: '7px',
                                height: '7px',
                                borderRadius: '50%',
                                background: isSigned ? '#4ade80' : '#f59e0b',
                                flexShrink: 0
                              }}
                            />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {profileDisplayLabel(profile)}
                            </span>
                          </div>
                          <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                            {pProjects.length} cards
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </aside>

          {/* Right Main Content Panel */}
          <main
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '24px 32px',
              background: 'var(--bg-page)',
              display: 'flex',
              flexDirection: 'column',
              gap: '24px'
            }}
          >
            {/* VIEW 1: OBSERVER */}
            {activeSection === 'observer' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', justifyContent: 'center', minHeight: '360px', textAlign: 'center' }}>
                <span style={{ fontSize: '48px', opacity: 0.8 }}>🔭</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '17px', color: '#f8fafc', fontWeight: 600 }}>
                    Observer Mode Streams
                  </h3>
                  <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#94a3b8', maxWidth: '420px' }}>
                    Observer streams are kept clean and active in the background. Live activity feeds and surveillance channels will populate here.
                  </p>
                  {onOpenObserver && (
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => {
                        onClose()
                        onOpenObserver()
                      }}
                      style={{ marginTop: '16px', fontSize: '13px', padding: '8px 18px' }}
                    >
                      🔭 Open Dedicated Observer Canvas
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* VIEW 2: GLOBAL ACCOUNTS OVERVIEW */}
            {activeSection === 'global' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <header>
                  <h3 style={{ margin: 0, fontSize: '17px', color: '#f8fafc', fontWeight: 600 }}>
                    Global Accounts &amp; Connected Platforms
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94a3b8' }}>
                    Master overview of all connected company accounts, Slack integrations, and global credentials.
                  </p>
                </header>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
                  {globalProfiles.length === 0 ? (
                    <div style={{ color: '#64748b', fontSize: '13px', fontStyle: 'italic', padding: '20px' }}>
                      No global company accounts connected yet.
                    </div>
                  ) : (
                    globalProfiles.map((profile) => (
                      <div
                        key={profile.id}
                        style={{
                          background: 'rgba(15, 23, 42, 0.45)',
                          border: '1px solid rgba(255, 255, 255, 0.07)',
                          borderRadius: '10px',
                          padding: '16px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                background: profile.avatarColor || '#3b82f6',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 600,
                                fontSize: '13px',
                                color: '#fff'
                              }}
                            >
                              {profile.displayName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '14px', color: '#f8fafc' }}>
                                {profileDisplayLabel(profile)}
                              </div>
                              <div style={{ fontSize: '11px', color: '#94a3b8' }}>{profile.displayName}</div>
                            </div>
                          </div>
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              background: profile.googleAuthStatus === 'signed-in' ? 'rgba(74, 222, 128, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                              color: profile.googleAuthStatus === 'signed-in' ? '#4ade80' : '#f59e0b'
                            }}
                          >
                            {profile.googleAuthStatus === 'signed-in' ? 'Connected' : 'Login needed'}
                          </span>
                        </div>

                        {/* Platforms Pill List */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                            <span style={{ color: '#cbd5e1' }}>💬 Slack Workspace</span>
                            <span style={{ color: profile.apps.slack.sessionStatus === 'signed-in' ? '#4ade80' : '#64748b' }}>
                              {profile.apps.slack.sessionStatus === 'signed-in' ? 'Active Session' : 'Not Connected'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                            <span style={{ color: '#cbd5e1' }}>👥 Teams Workspace</span>
                            <span style={{ color: profile.apps.teams.sessionStatus === 'signed-in' ? '#4ade80' : '#64748b' }}>
                              {profile.apps.teams.sessionStatus === 'signed-in' ? 'Active Session' : 'Not Connected'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                            <span style={{ color: '#cbd5e1' }}>📱 WhatsApp</span>
                            <span style={{ color: profile.apps.whatsapp.sessionStatus === 'signed-in' ? '#4ade80' : '#64748b' }}>
                              {profile.apps.whatsapp.sessionStatus === 'signed-in' ? 'Active' : 'Not Connected'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* VIEW 3: INDIVIDUAL PROFILE WORKSPACE & CARDS */}
            {activeSection === 'individual' && !currentProfile && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', justifyContent: 'center', minHeight: '360px', textAlign: 'center' }}>
                <span style={{ fontSize: '42px', opacity: 0.7 }}>👤</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#f8fafc', fontWeight: 600 }}>
                    No Individual Profiles Created Yet
                  </h3>
                  <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#94a3b8', maxWidth: '420px' }}>
                    Individual profiles are private client or project profiles separate from your Global Account (e.g. Rajesh).
                    Create an individual profile via <b>+ Profile</b> in the sidebar.
                  </p>
                </div>
              </div>
            )}

            {activeSection === 'individual' && currentProfile && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
                {/* Profile Identity & Quick Bar */}
                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.45)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '10px',
                    padding: '16px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        background: currentProfile.avatarColor || '#3b82f6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '16px',
                        color: '#fff'
                      }}
                    >
                      {currentProfile.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f8fafc' }}>
                          {profileDisplayLabel(currentProfile)}
                        </h3>
                        {currentProfile.id === activeProfileId && (
                          <span style={{ fontSize: '10px', fontWeight: 650, color: '#60a5fa', background: 'rgba(59, 130, 246, 0.15)', padding: '2px 6px', borderRadius: '4px' }}>
                            CURRENT ACTIVE
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                        {currentProfile.displayName} • Google {currentProfile.googleAuthStatus}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      className={`btn ${currentProfile.hiddenInSidebar ? 'ghost' : 'primary'} btn-sm`}
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                      onClick={() => handleToggleSidebarVisibility(currentProfile)}
                      title="Toggle visibility in left sidebar"
                    >
                      {currentProfile.hiddenInSidebar ? '🚫 Hidden in sidebar' : '👁 Shown in sidebar'}
                    </button>
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      style={{
                        fontSize: '12px',
                        padding: '6px 12px',
                        color: '#f87171',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        background: 'rgba(239, 68, 68, 0.08)',
                        cursor: 'pointer'
                      }}
                      onClick={() => {
                        const linkedCards = allProjects
                          .filter((p) => p.profileId === currentProfile.id)
                          .map((p) => ({ id: p.id, name: p.name || p.teamName || 'Card' }))
                        setDeleteTarget({
                          type: 'profile',
                          profile: {
                            id: currentProfile.id,
                            name: profileDisplayLabel(currentProfile),
                            email: currentProfile.displayName,
                            cards: linkedCards
                          }
                        })
                      }}
                      title="Permanently delete this profile"
                    >
                      🗑️ Delete Profile
                    </button>
                  </div>
                </div>

                {/* Section: Project Cards & Lifecycle Filters */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>
                        Project Cards ({profileProjects.length})
                      </h4>
                      <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                        Manage card workflow status and filter active vs stopped or archived projects.
                      </p>
                    </div>

                    {/* Filter Pills & Add Project */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {onNewProject && (
                        <button
                          type="button"
                          className="btn primary btn-sm"
                          onClick={() => {
                            onClose()
                            onNewProject()
                          }}
                          style={{ fontSize: '11.5px', padding: '4px 10px', background: '#6366f1' }}
                        >
                          + New Project
                        </button>
                      )}
                      <div
                        style={{
                          display: 'flex',
                          gap: '4px',
                          background: 'rgba(0,0,0,0.3)',
                          padding: '3px',
                          borderRadius: '8px',
                          border: '1px solid rgba(255,255,255,0.06)'
                        }}
                      >
                        {(
                          [
                            ['all', `All (${projectMetrics.all})`],
                            ['active', `🟢 Active (${projectMetrics.active})`],
                            ['stopped', `⏸️ Stopped (${projectMetrics.stopped})`],
                            ['archived', `📦 Archived (${projectMetrics.archived})`]
                          ] as const
                        ).map(([key, label]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setProjectStatusFilter(key)}
                            style={{
                              padding: '5px 10px',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              borderRadius: '6px',
                              border: projectStatusFilter === key ? '1px solid var(--accent)' : '1px solid transparent',
                              background: projectStatusFilter === key ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'transparent',
                              color: projectStatusFilter === key ? '#fff' : '#94a3b8',
                              cursor: 'pointer',
                              transition: 'all 0.12s ease'
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Filtered Project Cards Grid */}
                  {filteredProjects.length === 0 ? (
                    <div
                      style={{
                        padding: '32px',
                        textAlign: 'center',
                        background: 'rgba(15, 23, 42, 0.25)',
                        border: '1px dashed rgba(255, 255, 255, 0.08)',
                        borderRadius: '8px',
                        color: '#64748b',
                        fontSize: '13px'
                      }}
                    >
                      No projects currently under the &quot;{projectStatusFilter}&quot; filter.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '14px' }}>
                      {filteredProjects.map((project) => {
                        const status: ProjectWorkflowStatus = project.workflowStatus || 'active'
                        return (
                          <div
                            key={project.id}
                            style={{
                              background: 'rgba(15, 23, 42, 0.5)',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                              borderRadius: '8px',
                              padding: '14px 16px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '12px'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <h5 style={{ margin: 0, fontSize: '14.5px', fontWeight: 600, color: '#f8fafc' }}>
                                    {project.name}
                                  </h5>
                                  {(project.hiddenInSidebar || status === 'removed') && (
                                    <span
                                      style={{
                                        fontSize: '10px',
                                        fontWeight: 650,
                                        color: '#f59e0b',
                                        background: 'rgba(245, 158, 11, 0.15)',
                                        border: '1px solid rgba(245, 158, 11, 0.35)',
                                        padding: '1px 6px',
                                        borderRadius: '4px'
                                      }}
                                    >
                                      🚫 Hidden from sidebar
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                                  Client: {project.clientName} • {project.teamName || 'Workspace'}
                                </div>
                              </div>

                              {/* Interactive Workflow Status Selector, Sidebar Toggle & Delete */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <button
                                  type="button"
                                  className={`btn ${project.hiddenInSidebar || status === 'removed' ? 'primary' : 'ghost'} btn-sm`}
                                  style={{ fontSize: '11px', padding: '4px 8px' }}
                                  onClick={() => void handleToggleCardSidebarVisibility(project)}
                                  title={project.hiddenInSidebar || status === 'removed' ? 'Show in left sidebar' : 'Hide from left sidebar'}
                                >
                                  {project.hiddenInSidebar || status === 'removed' ? '👁 Show in sidebar' : '🚫 Hide in sidebar'}
                                </button>
                                <select
                                  value={status}
                                  onChange={(e) =>
                                    void handleUpdateProjectStatus(project, e.target.value as ProjectWorkflowStatus)
                                  }
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 650,
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    border:
                                      status === 'active'
                                        ? '1px solid #10b981'
                                        : status === 'stopped'
                                          ? '1px solid #f59e0b'
                                          : status === 'removed'
                                            ? '1px solid #ef4444'
                                            : '1px solid #8b5cf6',
                                    background:
                                      status === 'active'
                                        ? 'rgba(16, 185, 129, 0.12)'
                                        : status === 'stopped'
                                          ? 'rgba(245, 158, 11, 0.12)'
                                          : status === 'removed'
                                            ? 'rgba(239, 68, 68, 0.12)'
                                            : 'rgba(139, 92, 246, 0.12)',
                                    color:
                                      status === 'active'
                                        ? '#34d399'
                                        : status === 'stopped'
                                          ? '#fbbf24'
                                          : status === 'removed'
                                            ? '#f87171'
                                            : '#a78bfa'
                                  }}
                                >
                                  <option value="active" style={{ background: '#0f172a', color: '#fff' }}>🟢 Active</option>
                                  <option value="stopped" style={{ background: '#0f172a', color: '#fff' }}>⏸️ Stopped</option>
                                  <option value="removed" style={{ background: '#0f172a', color: '#fff' }}>🚫 Removed (Client Stop)</option>
                                  <option value="completed" style={{ background: '#0f172a', color: '#fff' }}>✅ Completed</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteTarget({
                                      type: 'card',
                                      card: {
                                        id: project.id,
                                        name: project.name || project.teamName || 'Card',
                                        clientName: project.clientName,
                                        teamName: project.teamName,
                                        channelCount: project.monitors?.length ?? 0
                                      }
                                    })
                                  }}
                                  title={`Delete card "${project.name}"`}
                                  style={{
                                    background: 'rgba(239, 68, 68, 0.08)',
                                    border: '1px solid rgba(239, 68, 68, 0.25)',
                                    color: '#f87171',
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    transition: 'all 0.12s ease'
                                  }}
                                >
                                  🗑️ Delete
                                </button>
                              </div>
                            </div>

                            {/* Monitors / Channels list */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '11.5px', color: '#64748b' }}>
                              <span>Channels:</span>
                              {project.monitors.map((m) => (
                                <span
                                  key={m.channelId}
                                  style={{
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    color: '#cbd5e1'
                                  }}
                                >
                                  #{m.channelName}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      <DeleteConfirmNoticeModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        target={deleteTarget}
        onConfirmCardDelete={handleConfirmCardDelete}
        onConfirmProfileDelete={handleConfirmProfileDelete}
      />
    </div>
  )
}

export default AccountsManagementModal
