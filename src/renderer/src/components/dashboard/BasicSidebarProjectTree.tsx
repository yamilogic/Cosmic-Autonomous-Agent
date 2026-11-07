import React, { useMemo, useState, useEffect } from 'react'
import { useDashboardStore } from '../../hooks/useDashboard'
import { useProfileStore } from '../../hooks/useProfiles'
import { AppIcon } from '../AppIcon'
import { getBaseLayoutItems, type BaseAppLayoutKey } from '../../../../shared/base-app-presets'
import type { AppId } from '../../../../shared/types'
import type { DashboardProject } from '../../../../shared/dashboard-contract'
import { CardRemoveOrDeleteModal } from './CardRemoveOrDeleteModal'

interface BasicSidebarProjectTreeProps {
  baseAppLayout?: BaseAppLayoutKey
  onNewProject?: () => void
  onToast?: (message: string) => void
}

function PinGlyph({ filled }: { filled: boolean }): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      {filled ? (
        <path
          fill="currentColor"
          d="M16.5 2h-9A1.5 1.5 0 0 0 6 3.5V5h1.2c1.9 0 3.5 1.3 3.9 3.1l.2 1V12c0 .4-.2.8-.6 1L8 14.7V17h3.2v5h1.6v-5H16v-2.3l-2.7-1.6c-.4-.2-.6-.6-.6-1V9.1l.2-1C13.3 6.3 14.9 5 16.8 5H18V3.5A1.5 1.5 0 0 0 16.5 2z"
        />
      ) : (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 3.5h6M10.2 3.5v6.2c0 1.2-.6 2.3-1.6 3L7.2 14v2.2h4.1V21h1.4v-4.8h4.1V14l-1.4-1.3c-1-.7-1.6-1.8-1.6-3V3.5"
        />
      )}
    </svg>
  )
}

export function BasicSidebarProjectTree({
  baseAppLayout = 'standard',
  onNewProject,
  onToast
}: BasicSidebarProjectTreeProps): React.JSX.Element {
  const snapshot = useDashboardStore((s) => s.snapshot)
  const loadSnapshot = useDashboardStore((s) => s.loadSnapshot)
  const setPinnedOrder = useDashboardStore((s) => s.setPinnedOrder)
  const upsertProject = useDashboardStore((s) => s.upsertProject)
  const deleteProject = useDashboardStore((s) => s.deleteProject)
  const cosmicSelectedCardId = useDashboardStore((s) => s.cosmicSelectedCardId)
  const basicActiveTab = useDashboardStore((s) => s.basicActiveTab)
  const setBasicNavigation = useDashboardStore((s) => s.setBasicNavigation)
  const profiles = useProfileStore((s) => s.profiles)

  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})
  const [cardActionTarget, setCardActionTarget] = useState<DashboardProject | null>(null)

  // Ensure snapshot is loaded
  useEffect(() => {
    if (!snapshot) {
      void loadSnapshot().catch(() => undefined)
    }
  }, [snapshot, loadSnapshot])

  const pinnedOrder = snapshot?.pinnedOrder ?? []

  // Active projects across all profiles, with pinned projects sorted first
  const activeProjects = useMemo(() => {
    if (!snapshot) return []
    const uncompleted = snapshot.projects.filter(
      (p) =>
        p.project.workflowStatus !== 'completed' &&
        p.project.workflowStatus !== 'removed' &&
        !p.project.hiddenInSidebar
    )

    return [...uncompleted].sort((a, b) => {
      const aPinnedIndex = pinnedOrder.indexOf(a.project.id)
      const bPinnedIndex = pinnedOrder.indexOf(b.project.id)
      const aIsPinned = aPinnedIndex !== -1
      const bIsPinned = bPinnedIndex !== -1

      if (aIsPinned && bIsPinned) {
        return aPinnedIndex - bPinnedIndex
      }
      if (aIsPinned) return -1
      if (bIsPinned) return 1
      return 0
    })
  }, [snapshot, pinnedOrder])

  // Auto-expand the currently selected project card if any
  useEffect(() => {
    if (cosmicSelectedCardId && expandedProjects[cosmicSelectedCardId] === undefined) {
      setExpandedProjects((prev) => ({ ...prev, [cosmicSelectedCardId]: true }))
    }
  }, [cosmicSelectedCardId, expandedProjects])

  // In Basic look, auto-select the first available project if none is selected
  useEffect(() => {
    if (!cosmicSelectedCardId && activeProjects.length > 0) {
      setBasicNavigation(activeProjects[0].project.id, 'dashboard')
    }
  }, [cosmicSelectedCardId, activeProjects, setBasicNavigation])

  // Preset links based on baseAppLayout setting (standard = option 1, extended = option 2, full = option 3)
  const presetItems = useMemo(() => {
    return getBaseLayoutItems(baseAppLayout)
  }, [baseAppLayout])

  const toggleProjectExpand = (projectId: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    setExpandedProjects((prev) => {
      const current = prev[projectId] ?? (projectId === cosmicSelectedCardId)
      return { ...prev, [projectId]: !current }
    })
  }

  const handleTogglePin = (projectId: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    const isPinned = pinnedOrder.includes(projectId)
    const nextOrder = isPinned
      ? pinnedOrder.filter((id) => id !== projectId)
      : [projectId, ...pinnedOrder.filter((id) => id !== projectId)]
    void setPinnedOrder(nextOrder)
  }

  const handleSelectTab = (projectId: string, tab: string): void => {
    setBasicNavigation(projectId, tab)
  }

  return (
    <div
      className="basic-sidebar-project-tree"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '6px 8px',
        overflowY: 'auto',
        flex: 1
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 6px',
          marginBottom: '2px'
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-faint, #64748b)'
          }}
        >
          Projects ({activeProjects.length})
        </span>
        {onNewProject && (
          <button
            type="button"
            onClick={onNewProject}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent, #6366f1)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '2px 4px'
            }}
            title="Create new project card"
          >
            + New
          </button>
        )}
      </div>

      {activeProjects.length === 0 ? (
        <div
          style={{
            padding: '16px 8px',
            textAlign: 'center',
            fontSize: '12px',
            color: 'var(--text-faint, #64748b)'
          }}
        >
          No projects yet.
        </div>
      ) : (
        activeProjects.map((entry) => {
          const project = entry.project
          const projectId = project.id
          const isSelectedProject = cosmicSelectedCardId === projectId
          const isOpen = expandedProjects[projectId] ?? isSelectedProject
          const projectName = project.name || project.teamName || 'Untitled Project'
          const profile = profiles.find((p) => p.id === project.profileId)

          const isPinned = pinnedOrder.includes(projectId)

          return (
            <div
              key={projectId}
              className={`basic-project-node${isSelectedProject ? ' is-selected' : ''}`}
            >
              <div className="basic-project-row">
                {/* Project Row Header (Click toggles expand/collapse only) */}
                <button
                  type="button"
                  className="basic-project-header-btn"
                  onClick={(e) => toggleProjectExpand(projectId, e)}
                  title={`${projectName} (Click to expand/collapse)`}
                >
                  <span
                    style={{
                      fontSize: '9px',
                      color: 'var(--text-faint, #94a3b8)',
                      transition: 'transform 0.15s ease',
                      display: 'inline-block',
                      width: '12px'
                    }}
                    aria-hidden
                  >
                    {isOpen ? '▼' : '▶'}
                  </span>

                  <span
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background: '#22c55e',
                      flexShrink: 0
                    }}
                    aria-hidden
                  />

                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {projectName}
                  </span>

                  {profile && (
                    <span
                      style={{
                        fontSize: '10px',
                        color: 'var(--text-faint, #64748b)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '70px'
                      }}
                    >
                      {profile.displayName}
                    </span>
                  )}
                </button>

                <div className="basic-project-actions">
                  <button
                    type="button"
                    className={`basic-project-pin${isPinned ? ' is-pinned' : ''}`}
                    title={isPinned ? 'Unpin project' : 'Pin project to top'}
                    aria-label={isPinned ? `Unpin ${projectName}` : `Pin ${projectName} to top`}
                    aria-pressed={isPinned}
                    onClick={(e) => handleTogglePin(projectId, e)}
                  >
                    <PinGlyph filled={isPinned} />
                  </button>
                  <button
                    type="button"
                    className={`nav-mute${project.muted ? ' is-muted' : ''}`}
                    onClick={async (e) => {
                      e.stopPropagation()
                      try {
                        await upsertProject({ ...project, muted: !project.muted })
                      } catch (err) {
                        console.error('Failed to toggle card mute', err)
                      }
                    }}
                    title={
                      project.muted
                        ? `Unmute — allow desktop notifications for ${projectName}`
                        : `Mute — silence desktop notifications for ${projectName}`
                    }
                    aria-pressed={project.muted}
                    aria-label={project.muted ? `Unmute notifications for ${projectName}` : `Mute notifications for ${projectName}`}
                  >
                    {project.muted ? 'Muted' : 'Mute'}
                  </button>
                  <button
                    type="button"
                    className="nav-delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      setCardActionTarget(project)
                    }}
                    title="Remove from sidebar or delete"
                    aria-label={`Remove ${projectName} from sidebar`}
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Collapsible Dropdown Items (Dashboard, Slack, Teams, WhatsApp, etc.) */}
              {isOpen && (
                <div className="basic-project-children">
                  {/* 1. Dashboard Tab */}
                  {(() => {
                    const isDashActive = isSelectedProject && basicActiveTab === 'dashboard'
                    return (
                      <button
                        type="button"
                        className={`basic-project-tab-btn${isDashActive ? ' is-active' : ''}`}
                        onClick={() => handleSelectTab(projectId, 'dashboard')}
                      >
                        <span style={{ fontSize: '12px', lineHeight: 1 }} aria-hidden>
                          📊
                        </span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          Dashboard
                        </span>
                      </button>
                    )
                  })()}

                  {/* 2. Preset Apps/Links (Slack, Teams, WhatsApp, etc.) */}
                  {presetItems.map((preset) => {
                    const tabKey = preset.appId ?? `c:preset:${preset.id}`
                    const isActive = isSelectedProject && basicActiveTab === tabKey

                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`basic-project-tab-btn${isActive ? ' is-active' : ''}`}
                        onClick={() => handleSelectTab(projectId, tabKey)}
                      >
                        {preset.appId ? (
                          <AppIcon appId={preset.appId as AppId} size={13} />
                        ) : (
                          <span style={{ fontSize: '13px', lineHeight: 1 }} aria-hidden>
                            {preset.icon || '🌐'}
                          </span>
                        )}
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {preset.name}
                        </span>
                        {preset.appId === 'slack' && Boolean(project.teamId) && (
                          <span
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: '#22c55e'
                            }}
                            title="Slack connected"
                          />
                        )}
                      </button>
                    )
                  })}

                  {/* 3. Custom Links added to card/profile */}
                  {(() => {
                    const targetProfile = profiles.find((p) => p.id === project.profileId) ?? profiles[0]
                    const cardCustomLinks = targetProfile?.customLinks ?? []
                    return cardCustomLinks.map((link) => {
                      const tabKey = `c:link:${link.id}`
                      const isActive = isSelectedProject && basicActiveTab === tabKey

                      return (
                        <button
                          key={link.id}
                          type="button"
                          className={`basic-project-tab-btn${isActive ? ' is-active' : ''}`}
                          onClick={() => handleSelectTab(projectId, tabKey)}
                        >
                          <span style={{ fontSize: '13px', lineHeight: 1 }} aria-hidden>
                            🔗
                          </span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {link.name}
                          </span>
                        </button>
                      )
                    })
                  })()}
                </div>
              )}
            </div>
          )
        })
      )}

      <CardRemoveOrDeleteModal
        open={Boolean(cardActionTarget)}
        project={cardActionTarget}
        onClose={() => setCardActionTarget(null)}
        onHide={async (targetProject) => {
          try {
            await upsertProject({ ...targetProject, hiddenInSidebar: true })
            const cName = targetProject.name || targetProject.teamName || 'Card'
            onToast?.(`${cName} hidden from sidebar. Restore anytime from Profiles.`)
          } catch (err) {
            console.error('Failed to hide card from sidebar', err)
          }
        }}
        onDelete={async (targetProjectId) => {
          try {
            await deleteProject(targetProjectId)
            onToast?.('Project card permanently deleted.')
          } catch (err) {
            console.error('Failed to delete project card', err)
          }
        }}
      />
    </div>
  )
}
