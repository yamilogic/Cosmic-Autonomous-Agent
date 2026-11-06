import { useCallback, useEffect, useState } from 'react'
import type { AppId } from '../../../../shared/types'
import { appLabel, sanitizeWorkspaceName } from '../../../../shared/types'
import { useProfileStore } from '../../hooks/useProfiles'

interface PlatformSettingsPanelProps {
  open: boolean
  profileId: string
  appId: AppId
  onClose: () => void
}

interface ProjectCard {
  id: string
  name: string
  clientName: string
  teamId: string
  profileId: string
}

function workspaceIcon(teamName: string): string {
  return teamName.trim().charAt(0).toUpperCase()
}

function statusFor(sessionStatus: string): { label: string; kind: 'connected' | 'needs-login' | 'signing-in' } {
  if (sessionStatus === 'signed-in') {
    return { label: 'Connected', kind: 'connected' }
  }
  if (sessionStatus === 'not-signed-in') {
    return { label: 'Needs login', kind: 'needs-login' }
  }
  return { label: 'Signing in…', kind: 'signing-in' }
}

export function PlatformSettingsPanel({
  open,
  profileId,
  appId,
  onClose
}: PlatformSettingsPanelProps): React.JSX.Element | null {
  if (!open) return null

  const profile = useProfileStore.getState().profiles.find((p) => p.id === profileId)
  const session = (profile?.apps as Record<AppId, { sessionStatus: string; availableWorkspaces: { teamId: string; teamName: string; openUrl: string; teamDomain?: string; lastChannelName?: string }[] }>)[appId]
  const availableWorkspaces = session?.availableWorkspaces ?? []
  const platformName = appLabel(appId)

  const [projects, setProjects] = useState<ProjectCard[]>([])
  const [mappings, setMappings] = useState<{ workspaceId: string; projectIds: string[] }[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null)
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [projList, mapList] = await Promise.all([
        window.api.dashboard.getProjects(),
        window.api.dashboard.listWorkspaceMappings()
      ])
      setProjects(projList)
      setMappings(mapList)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects or mappings')
    }
  }, [])

  useEffect(() => {
    loadData()
    const unsubscribe = window.api.dashboard.onConfigChanged(() => {
      void loadData()
    })
    return () => {
      unsubscribe()
    }
  }, [loadData])

  const workspaceMapping = mappings.find((m) => m.workspaceId === selectedWorkspace)

  useEffect(() => {
    if (selectedWorkspace && workspaceMapping) {
      setSelectedProjects(new Set(workspaceMapping.projectIds))
    } else if (selectedWorkspace) {
      setSelectedProjects(new Set())
    }
  }, [selectedWorkspace, workspaceMapping])

  const toggleProject = (projectId: string) => {
    setSelectedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const handleSave = async () => {
    if (!selectedWorkspace) return
    setSaving(true)
    setError(null)
    try {
      await window.api.dashboard.saveWorkspaceMapping({
        workspaceId: selectedWorkspace,
        projectIds: Array.from(selectedProjects)
      })
      const updated = await window.api.dashboard.listWorkspaceMappings()
      setMappings(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mapping')
    } finally {
      setSaving(false)
    }
  }

  if (appId === 'slack') {
    return (
      <div
        className="platform-settings-backdrop"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className="platform-settings-panel" role="dialog" aria-modal="true" aria-label={`${platformName} settings`}>
          <header className="platform-settings-header">
            <h2>{platformName} settings</h2>
            <button type="button" className="btn ghost" onClick={onClose}>
              Close
            </button>
          </header>

          <SlackSettingsContent
            availableWorkspaces={availableWorkspaces}
            sessionStatus={session?.sessionStatus ?? 'not-signed-in'}
            projects={projects}
            mappings={mappings}
            selectedWorkspace={selectedWorkspace}
            setSelectedWorkspace={setSelectedWorkspace}
            selectedProjects={selectedProjects}
            setSelectedProjects={setSelectedProjects}
            toggleProject={toggleProject}
            workspaceMapping={workspaceMapping}
            onSave={handleSave}
            saving={saving}
            error={error}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className="platform-settings-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="platform-settings-panel" role="dialog" aria-modal="true" aria-label={`${platformName} settings`}>
        <header className="platform-settings-header">
          <h2>{platformName} settings</h2>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <ComingSoonContent platformName={platformName} sessionStatus={session?.sessionStatus ?? 'not-signed-in'} />
      </div>
    </div>
  )
}

interface SlackSettingsContentProps {
  availableWorkspaces: { teamId: string; teamName: string; openUrl: string; teamDomain?: string; lastChannelName?: string }[]
  sessionStatus: string
  projects: ProjectCard[]
  mappings: { workspaceId: string; projectIds: string[] }[]
  selectedWorkspace: string | null
  setSelectedWorkspace: (id: string | null) => void
  selectedProjects: Set<string>
  setSelectedProjects: (projects: Set<string>) => void
  toggleProject: (projectId: string) => void
  workspaceMapping: { workspaceId: string; projectIds: string[] } | undefined
  onSave: () => Promise<void>
  saving: boolean
  error: string | null
}

function SlackSettingsContent({
  availableWorkspaces,
  sessionStatus,
  projects,
  mappings,
  selectedWorkspace,
  setSelectedWorkspace,
  selectedProjects,
  setSelectedProjects,
  toggleProject,
  workspaceMapping,
  onSave,
  saving,
  error
}: SlackSettingsContentProps): React.JSX.Element {
  const { label, kind } = statusFor(sessionStatus)

  const mappedProjectCount = workspaceMapping ? workspaceMapping.projectIds.length : 0

  return (
    <section className="slack-settings-section">
      <div className="slack-settings-header-row">
        <span className="slack-settings-label">Connected workspaces</span>
        <button type="button" className="btn ghost btn-sm" title="Refresh workspace list">
          ⟳
        </button>
      </div>
      <p className="slack-settings-status">
        <span
          className={`status-dot status-dot-${kind}`}
          aria-label={label}
          title={label}
        />
        {label}
      </p>

      <div className="slack-settings-section">
        <p className="slack-settings-subtitle">Workspaces</p>
        {availableWorkspaces.length === 0 ? (
          <p className="slack-settings-empty">No connected workspaces yet. Sign in to Slack to see workspaces here.</p>
        ) : (
          <ul className="slack-settings-workspace-list">
            {availableWorkspaces.map((ws) => {
              const isSelected = selectedWorkspace === ws.teamId
              const cleanName = sanitizeWorkspaceName(ws.teamName) || ws.teamName
              const wsMapping = mappings.find((m) => m.workspaceId === ws.teamId)
              const projectCount = wsMapping ? wsMapping.projectIds.length : 0
              return (
                <li key={ws.teamId} className={`slack-settings-workspace-row${isSelected ? ' is-selected' : ''}`} onClick={() => setSelectedWorkspace(isSelected ? null : ws.teamId)}>
                  <span className="slack-settings-workspace-icon">{workspaceIcon(cleanName)}</span>
                  <div className="slack-settings-workspace-info">
                    <span className="slack-settings-workspace-name">{cleanName}</span>
                    {ws.teamDomain && (
                      <span className="slack-settings-workspace-domain">@{ws.teamDomain}</span>
                    )}
                  </div>
                  <span className={`slack-settings-workspace-badge ${projectCount > 0 ? 'is-mapped' : 'is-unmapped'}`}>
                    {projectCount > 0 ? `Mapped to ${projectCount} cards` : 'Not mapped'}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {selectedWorkspace && (
        <div className="slack-settings-mapping">
          <div className="slack-settings-mapping-header">
            <span className="slack-settings-workspace-name">{availableWorkspaces.find((w) => w.teamId === selectedWorkspace)?.teamName ?? selectedWorkspace}</span>
            <button type="button" className="btn ghost btn-sm" onClick={() => setSelectedWorkspace(null)}>
              ✕
            </button>
          </div>
          <p className="slack-settings-subtitle">Map to project cards</p>
          <div className="slack-settings-project-search">
            <input
              type="text"
              placeholder="Search projects…"
              className="slack-settings-search-input"
            />
          </div>
          <ul className="slack-settings-project-list">
            {projects.map((p) => {
              const isMapped = selectedProjects.has(p.id)
              return (
                <li key={p.id} className="slack-settings-project-row">
                  <label className="slack-settings-project-label">
                    <input
                      type="checkbox"
                      checked={isMapped}
                      onChange={() => toggleProject(p.id)}
                    />
                    <span className="slack-settings-project-name">{p.name}</span>
                    <span className="slack-settings-project-client">{p.clientName}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          {projects.length === 0 && (
            <p className="slack-settings-empty">No project cards found. Create a project card first.</p>
          )}
          <div className="slack-settings-mapping-actions">
            <button
              type="button"
              className="btn primary"
              disabled={saving || selectedProjects.size === 0}
              onClick={onSave}
            >
              {saving ? 'Saving…' : 'Save mapping'}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setSelectedProjects(new Set())}
            >
              Clear
            </button>
            {mappedProjectCount > 0 && (
              <span className="slack-settings-mapping-summary">
                Currently mapped to {mappedProjectCount} card{mappedProjectCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
      )}

      <p className="slack-settings-note">
        Agent in workspaces/channels ke saare messages padhega. Mapping project cards se
        joda ja sakta hai.
      </p>

      {error && (
        <p className="slack-settings-error" role="alert">{error}</p>
      )}
    </section>
  )
}

function ComingSoonContent({
  platformName,
  sessionStatus
}: {
  platformName: string
  sessionStatus: string
}): React.JSX.Element {
  const { label, kind } = statusFor(sessionStatus)

  return (
    <section className="platform-settings-coming-soon">
      <p className="platform-settings-status">
        <span
          className={`status-dot status-dot-${kind}`}
          aria-label={label}
          title={label}
        />
        {label}
      </p>
      <div className="platform-settings-soon-badge">Soon</div>
      <p className="platform-settings-soon-note">
        {platformName} settings panel is coming soon. Connected account and workspace
        mapping will be available in a future update.
      </p>
    </section>
  )
}