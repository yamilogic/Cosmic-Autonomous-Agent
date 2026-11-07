import React, { useMemo, useEffect, useCallback } from 'react'
import { useDashboardStore } from '../../hooks/useDashboard'
import { useProfileStore } from '../../hooks/useProfiles'
import { profileDisplayLabel, Profile } from '../../../../shared/types'

interface CosmicSidebarContentProps {
  isMinimalLook?: boolean
  isBasicLook?: boolean
  profiles?: Profile[]
  showSidebarProfileNavButton?: boolean
  showSidebarDashboardNavButton?: boolean
  showCosmicProfileNavButtons?: boolean
  onOpenProfilesHub?: () => void
  onNewProject?: () => void
}

export function CosmicSidebarContent({
  isMinimalLook = false,
  isBasicLook = false,
  profiles: propProfiles,
  showSidebarProfileNavButton: propShowProfileNavButton,
  showSidebarDashboardNavButton: propShowDashboardNavButton,
  showCosmicProfileNavButtons = true,
  onOpenProfilesHub,
  onNewProject
}: CosmicSidebarContentProps): React.JSX.Element {
  const cosmicLevel1 = useDashboardStore((s) => s.cosmicLevel1)
  const cosmicSelectedCardId = useDashboardStore((s) => s.cosmicSelectedCardId)
  const setCosmicNavigation = useDashboardStore((s) => s.setCosmicNavigation)
  const snapshot = useDashboardStore((s) => s.snapshot)
  const loadSnapshot = useDashboardStore((s) => s.loadSnapshot)
  const storeProfiles = useProfileStore((s) => s.profiles)
  const profiles = propProfiles && propProfiles.length > 0 ? propProfiles : storeProfiles

  const showProfileBtn =
    propShowProfileNavButton ??
    showCosmicProfileNavButtons ??
    true
  const showDashboardBtn =
    propShowDashboardNavButton ??
    showCosmicProfileNavButtons ??
    true
  const isFlatNav = isMinimalLook || isBasicLook
  const hasAnyQuickNav = !isFlatNav && (showProfileBtn || showDashboardBtn)

  // Ensure snapshot and profiles are loaded
  useEffect(() => {
    if (!snapshot) {
      void loadSnapshot().catch(() => undefined)
    }
    if (profiles.length === 0) {
      void useProfileStore.getState().loadProfiles().catch(() => undefined)
    }
  }, [snapshot, loadSnapshot, profiles.length])

  // All selectable user profiles (exclude special global-account-profile singleton)
  const selectableProfiles = useMemo(() => {
    return profiles.filter((p) => p.id !== 'global-account-profile')
  }, [profiles])

  // Active projects to display:
  // For 'all' (or minimal/basic): all active projects across all profiles
  // For a specific profile: all active projects for that profile
  const displayedProjects = useMemo(() => {
    if (!snapshot) return []
    if (isFlatNav || cosmicLevel1 === 'all') {
      return snapshot.projects.filter(
        (p) =>
          p.project.workflowStatus !== 'completed' &&
          p.project.workflowStatus !== 'removed'
      )
    }
    if (cosmicLevel1 === 'global') {
      return []
    }
    return snapshot.projects.filter(
      (p) =>
        p.project.profileId === cosmicLevel1 &&
        p.project.workflowStatus !== 'completed' &&
        p.project.workflowStatus !== 'removed'
    )
  }, [snapshot, cosmicLevel1, isFlatNav])

  // In Minimal/Basic look, always enforce 'all' navigation if currently set to something else,
  // and auto-select the first available project card if none is selected.
  useEffect(() => {
    if (isFlatNav) {
      if (cosmicLevel1 !== 'all') {
        setCosmicNavigation('all', cosmicSelectedCardId)
      }
      if (!cosmicSelectedCardId && displayedProjects.length > 0) {
        setCosmicNavigation('all', displayedProjects[0].project.id)
      }
    }
  }, [isFlatNav, cosmicLevel1, cosmicSelectedCardId, displayedProjects, setCosmicNavigation])

  const handleLevel1Change = useCallback(
    (val: string) => {
      if (val === 'all') {
        setCosmicNavigation('all', null)
      } else if (val === 'global') {
        setCosmicNavigation('global', null)
      } else {
        // Find first active project for this profile if available
        const matchingProjects = (snapshot?.projects ?? []).filter(
          (p) =>
            p.project.profileId === val &&
            p.project.workflowStatus !== 'completed' &&
            p.project.workflowStatus !== 'removed'
        )
        const firstId = matchingProjects[0]?.project.id ?? null
        setCosmicNavigation(val, firstId)
      }
    },
    [snapshot, setCosmicNavigation]
  )

  const isAllProjects = isFlatNav || cosmicLevel1 === 'all'
  const isProfileSelected = Boolean(
    !isFlatNav && cosmicLevel1 && cosmicLevel1 !== 'all' && cosmicLevel1 !== 'global'
  )
  const showCardsSection = isAllProjects || isProfileSelected

  return (
    <div
      className="cosmic-sidebar-wrapper"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: showCardsSection ? 1 : '0 0 auto',
        minHeight: 0,
        gap: '4px'
      }}
    >
      {/* Dropdown Navigation Container (Hidden in Minimal / Basic Look) */}
      {!isFlatNav && (
        <div
          className="cosmic-nav-selectors"
          style={{
            padding: showCardsSection ? '4px 10px 8px' : '0 0 2px',
            display: 'flex',
            flexDirection: 'column',
            background: showCardsSection ? 'rgba(255, 255, 255, 0.02)' : 'transparent',
            borderBottom: showCardsSection ? '1px solid rgba(255, 255, 255, 0.06)' : 'none'
          }}
        >
          <select
            id="cosmic-level1-select"
            aria-label="Dashboard"
            value={cosmicLevel1}
            onChange={(e) => handleLevel1Change(e.target.value)}
            style={{
              width: '100%',
              padding: '7px 10px',
              fontSize: '12.5px',
              fontWeight: 600,
              borderRadius: '7px',
              background: 'color-mix(in srgb, var(--surface, #1e293b) 90%, black)',
              color: '#fff',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="all">▦ All Projects</option>
            <option value="global">🌐 Global Accounts</option>
            {selectableProfiles.length > 0 && (
              <optgroup label="Profiles">
                {selectableProfiles.map((p) => {
                  const label = profileDisplayLabel(p)
                  const emailSuffix =
                    p.displayName && p.displayName !== label ? ` (${p.displayName})` : ''
                  return (
                    <option key={p.id} value={p.id}>
                      👤 {label}
                      {emailSuffix}
                    </option>
                  )
                })}
              </optgroup>
            )}
          </select>
        </div>
      )}

      {/* When All Projects or a Profile is selected: Show Profile & Dashboard buttons + compact projects list */}
      {showCardsSection && (
        <div
          className="cosmic-profile-section"
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden'
          }}
        >
          {/* Quick Action Navigation Buttons */}
          {hasAnyQuickNav && (
            <div
              className="cosmic-quick-nav-buttons"
              style={{
                display: 'grid',
                gridTemplateColumns: showProfileBtn && showDashboardBtn ? '1fr 1fr' : '1fr',
                gap: '6px',
                padding: '6px 10px 4px'
              }}
            >
              {showProfileBtn && (
                <button
                  type="button"
                  onClick={() => onOpenProfilesHub?.()}
                  title={isAllProjects ? 'Open Profiles Management Hub' : 'Open Profile Accounts Hub'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '7px 8px',
                    borderRadius: '6px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span>{isAllProjects ? '👥' : '👤'}</span>
                  <span>{isAllProjects ? 'All Profiles' : 'Profile'}</span>
                </button>
              )}

              {showDashboardBtn && (
                <button
                  type="button"
                  onClick={() => setCosmicNavigation(cosmicLevel1, null)}
                  title={isAllProjects ? 'View All Projects Dashboard' : 'View Projects Dashboard for this Profile'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '7px 8px',
                    borderRadius: '6px',
                    background:
                      cosmicSelectedCardId === null
                        ? 'color-mix(in srgb, var(--accent, #6366f1) 22%, transparent)'
                        : 'rgba(255, 255, 255, 0.05)',
                    border:
                      cosmicSelectedCardId === null
                        ? '1px solid var(--accent, #6366f1)'
                        : '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span>▦</span>
                  <span>{isAllProjects ? 'Full Dashboard' : 'Dashboard'}</span>
                </button>
              )}
            </div>
          )}

          {/* Compact Project Cards List */}
          <div
            className="cosmic-profile-projects-list"
            style={{
              padding: '6px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              flex: 1,
              overflowY: 'auto'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '2px 4px 4px'
              }}
            >
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  color: 'var(--text-faint, #64748b)'
                }}
              >
                Projects ({displayedProjects.length})
              </span>
              {onNewProject && (
                <button
                  type="button"
                  onClick={onNewProject}
                  title="Create New Project"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent, #6366f1)',
                    fontSize: '11px',
                    fontWeight: 650,
                    cursor: 'pointer',
                    padding: '0 2px'
                  }}
                >
                  + New
                </button>
              )}
            </div>

            {displayedProjects.length === 0 ? (
              <div
                style={{
                  padding: '16px 8px',
                  textAlign: 'center',
                  color: 'var(--text-faint, #64748b)',
                  fontSize: '12px',
                  lineHeight: 1.5
                }}
              >
                <p>No active project cards found.</p>
                <p style={{ marginTop: '4px', fontSize: '11.5px' }}>
                  Click <b>+ Project</b> below to create one.
                </p>
              </div>
            ) : (
              displayedProjects.map((entry) => {
                const isSelected = cosmicSelectedCardId === entry.project.id
                const projName = entry.project.name || entry.project.teamName || 'Project'
                const clientName = entry.project.clientName
                const profileObj = isAllProjects
                  ? profiles.find((p) => p.id === entry.project.profileId)
                  : null
                const profileLabel = profileObj ? profileDisplayLabel(profileObj) : null
                const subtitle = isAllProjects
                  ? profileLabel || (clientName ? `Client: ${clientName}` : null)
                  : (clientName ? `Client: ${clientName}` : null)

                return (
                  <button
                    key={entry.project.id}
                    type="button"
                    onClick={() => {
                      setCosmicNavigation(cosmicLevel1, entry.project.id)
                      useProfileStore.getState().clearActiveApp()
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '9px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      background: isSelected
                        ? 'color-mix(in srgb, var(--accent, #6366f1) 22%, transparent)'
                        : 'rgba(255, 255, 255, 0.03)',
                      border: isSelected
                        ? '1px solid var(--accent, #6366f1)'
                        : '1px solid rgba(255, 255, 255, 0.06)',
                      color: isSelected ? '#fff' : 'var(--text, #e2e8f0)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s ease',
                      width: '100%'
                    }}
                  >
                    <span
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background:
                          entry.project.workflowStatus === 'active' ||
                          !entry.project.workflowStatus
                            ? '#22c55e'
                            : '#f59e0b',
                        flexShrink: 0
                      }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 650,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {projName}
                      </span>
                      {subtitle && (
                        <span
                          style={{
                            fontSize: '10.5px',
                            color: 'var(--text-faint, #64748b)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {subtitle}
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <span
                        style={{
                          fontSize: '10px',
                          color: 'var(--accent, #6366f1)',
                          fontWeight: 700
                        }}
                      >
                        ●
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
