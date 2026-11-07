import React, { useEffect, useMemo, useState } from 'react'
import { useProfileStore } from '../../hooks/useProfiles'
import { useDashboardStore } from '../../hooks/useDashboard'
import { isIndividualProfile } from '../../../../shared/types'
import type { DashboardProject, ProjectSource } from '../../../../shared/dashboard-contract'
import { CardAddModal } from './CardAddModal'

interface NewProjectModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: (projectId: string) => void
  embedded?: boolean
  showLinkedAccounts?: boolean
}

/**
 * Modern 1-page modal dialog / in-place view for project creation:
 * 1. Select Individual Profile (strictly excludes Global Accounts)
 * 2. Enter Project Name
 * 3. Optional '+ Add' button to pick linked accounts (without upfront OAuth)
 * 4. Create Project immediately without blocking popups.
 */
export function NewProjectModal({
  open,
  onClose,
  onSuccess,
  embedded = false,
  showLinkedAccounts = false
}: NewProjectModalProps): React.JSX.Element | null {
  const profiles = useProfileStore((s) => s.profiles)
  const upsertProject = useDashboardStore((s) => s.upsertProject)
  const syncNow = useDashboardStore((s) => s.syncNow)

  // Filter strictly for Individual Profiles:
  // Must satisfy isIndividualProfile (excludes Rajesh / global accounts)
  const individualProfiles = useMemo(() => {
    return profiles.filter(isIndividualProfile)
  }, [profiles])

  const [selectedProfileId, setSelectedProfileId] = useState<string>(() => {
    return individualProfiles[0]?.id ?? ''
  })
  const [projectName, setProjectName] = useState('')
  const [clientName, setClientName] = useState('')
  const [sources, setSources] = useState<ProjectSource[]>([])
  const [addAccountsOpen, setAddAccountsOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentSelectedProfile = useMemo(() => {
    return (
      individualProfiles.find((p) => p.id === (selectedProfileId || individualProfiles[0]?.id)) ||
      individualProfiles[0] ||
      null
    )
  }, [individualProfiles, selectedProfileId])

  // Suspend native WebContentsView (Slack / Teams / WhatsApp embeds) while modal is open
  useEffect(() => {
    if (open && !embedded) {
      void window.api?.profiles?.setEmbedVisible?.(false)
      return () => {
        void window.api?.profiles?.setEmbedVisible?.(true)
      }
    }
    return undefined
  }, [open, embedded])

  if (!open) return null

  // Virtual project object to pass into CardAddModal so user can select sources
  const dummyProject: DashboardProject = {
    id: 'draft-project',
    name: projectName.trim() || 'New Project',
    clientName: clientName.trim() || projectName.trim() || 'Client',
    profileId: selectedProfileId || individualProfiles[0]?.id || '',
    teamId: 'T-PENDING',
    teamName: projectName.trim() || 'Workspace',
    appId: 'slack',
    tokenSource: 'oauth',
    sourcePreference: 'browser_only',
    sources: sources,
    monitors: [],
    createdAt: new Date().toISOString()
  }

  const handleCreate = async () => {
    if (!projectName.trim()) {
      setError('Please enter a project name.')
      return
    }
    const profileId = selectedProfileId || individualProfiles[0]?.id
    if (!profileId) {
      setError('Please select or create an individual profile first.')
      return
    }

    setCreating(true)
    setError(null)
    try {
      const newProjectId = `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const activeSources = sources.map((s) => ({
        ...s,
        id: `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      }))

      // Pick the primary source or fallback to profile's authentic Slack workspace
      const primarySource = activeSources[0]
      const selectedProf = individualProfiles.find((p) => p.id === profileId)
      const authenticatedWorkspace = selectedProf?.apps?.slack?.availableWorkspaces?.find(
        (w) => w.teamId && !w.teamId.startsWith('team-') && w.teamId !== 'team' && w.teamId !== 'T-PENDING'
      ) ?? selectedProf?.apps?.slack?.pinnedWorkspaces?.find(
        (w) => w.teamId && !w.teamId.startsWith('team-') && w.teamId !== 'team' && w.teamId !== 'T-PENDING'
      )
      const fallbackTeamId = authenticatedWorkspace?.teamId || `pending-${newProjectId}`
      const fallbackTeamName = authenticatedWorkspace?.teamName || projectName.trim()

      const rawWorkspaceId = primarySource?.workspaceId
      const teamId = (rawWorkspaceId && !rawWorkspaceId.startsWith('team-') && rawWorkspaceId !== 'team' && rawWorkspaceId !== 'T-PENDING')
        ? rawWorkspaceId
        : fallbackTeamId
      const teamName = primarySource?.workspaceName || fallbackTeamName

      const newProject: DashboardProject = {
        id: newProjectId,
        name: projectName.trim(),
        clientName: clientName.trim() || projectName.trim(),
        profileId,
        teamId,
        teamName,
        appId: 'slack',
        tokenSource: 'oauth',
        sourcePreference: 'browser_only',
        sources: activeSources,
        monitors: [],
        createdAt: new Date().toISOString()
      }

      await upsertProject(newProject)
      void syncNow(newProjectId)
      onSuccess?.(newProjectId)
      onClose()
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setCreating(false)
    }
  }

  const modalContent = (
    <div
      className={embedded ? 'embedded-panel-card' : 'platform-settings-panel'}
      role="dialog"
      aria-modal={!embedded}
      aria-label="Create New Project"
      style={{
        width: embedded ? '100%' : '860px',
        maxWidth: embedded ? '920px' : '92vw',
        maxHeight: '90vh',
        backgroundColor: '#0b1329',
        borderRadius: '14px',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: embedded ? '0 10px 30px rgba(0, 0, 0, 0.4)' : '0 25px 50px -12px rgba(0, 0, 0, 0.85)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        margin: embedded ? '0 auto' : undefined
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255, 255, 255, 0.02)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '8px',
              background: 'rgba(99, 102, 241, 0.18)',
              border: '1px solid rgba(99, 102, 241, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px'
            }}
          >
            📁
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 650, color: '#f8fafc' }}>
              Create New Project Card
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#94a3b8' }}>
              Create an isolated project card inside an individual client profile with linked accounts.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: '18px',
            padding: '4px 8px',
            borderRadius: '6px'
          }}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Two-Column Structured Body */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr',
          flex: 1,
          overflowY: 'auto',
          minHeight: 0
        }}
      >
        {/* Left Column: Profile Owner & Workspace Context */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.65)',
            borderRight: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px'
          }}
        >
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 650,
                color: '#94a3b8',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '8px'
              }}
            >
              Select Profile Owner
            </label>
            {individualProfiles.length === 0 ? (
              <div
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  color: '#fbbf24',
                  fontSize: '12px'
                }}
              >
                No individual profiles found. Please create an individual profile via <b>+ Profile</b> first.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {individualProfiles.map((p) => {
                  const isSelected = p.id === (selectedProfileId || individualProfiles[0]?.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedProfileId(p.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 12px',
                        borderRadius: '8px',
                        background: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                        border: isSelected ? '1px solid rgba(99, 102, 241, 0.45)' : '1px solid rgba(255, 255, 255, 0.06)',
                        color: isSelected ? '#ffffff' : '#cbd5e1',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: p.avatarColor || '#3b82f6',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '12px',
                          color: '#fff',
                          flexShrink: 0
                        }}
                      >
                        {p.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.customName || p.displayName}
                        </div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                          {p.displayName}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {currentSelectedProfile && (
            <div
              style={{
                marginTop: 'auto',
                padding: '12px',
                borderRadius: '8px',
                background: 'rgba(0, 0, 0, 0.25)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                fontSize: '11.5px',
                color: '#94a3b8',
                lineHeight: '1.45'
              }}
            >
              🔒 <b>Card Scope Isolation</b>: Project cards created here stay strictly within this individual profile and will not leak loose links into your global workspace sidebar.
            </div>
          )}
        </div>

        {/* Right Column: Project Details & Linked Accounts */}
        <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {error && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                fontSize: '13px'
              }}
            >
              {error}
            </div>
          )}

          {/* Project Name */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '12.5px',
                fontWeight: 600,
                color: '#cbd5e1',
                marginBottom: '6px'
              }}
            >
              Project or Workspace Name <span style={{ color: '#f87171' }}>*</span>
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Acme Redesign, Mobile App v2, Alpha Launch"
              autoFocus
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                background: '#1e293b',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#f8fafc',
                fontSize: '13.5px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Client Name */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '12.5px',
                fontWeight: 600,
                color: '#cbd5e1',
                marginBottom: '6px'
              }}
            >
              Client Name (Optional)
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Acme Corp (defaults to project name)"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                background: '#1e293b',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#f8fafc',
                fontSize: '13.5px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Linked Workspaces & Accounts (+ Add Accounts) */}
          {showLinkedAccounts && (
            <div
              className="new-project-linked-accounts-section"
              style={{
                padding: '16px 18px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#e2e8f0' }}>
                    Linked Accounts &amp; Workspaces
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '10px',
                      background: sources.length > 0 ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.07)',
                      color: sources.length > 0 ? '#a5b4fc' : '#94a3b8'
                    }}
                  >
                    {sources.length} Linked
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                  {sources.length > 0
                    ? sources.map((s) => s.workspaceName).join(', ')
                    : 'Link Global accounts (Claude, ChatGPT, Slack) or client links now or manage later.'}
                </div>
              </div>

              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setAddAccountsOpen(true)}
                style={{
                  padding: '7px 14px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  background: 'rgba(99, 102, 241, 0.18)',
                  color: '#a5b4fc',
                  border: '1px solid rgba(99, 102, 241, 0.35)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                + Add Accounts
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div
        style={{
          padding: '14px 24px',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '12px',
          background: 'rgba(255, 255, 255, 0.02)'
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onClose}
          disabled={creating}
          style={{
            padding: '8px 18px',
            fontSize: '13px',
            color: '#94a3b8',
            background: 'transparent',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleCreate()}
          disabled={creating || individualProfiles.length === 0}
          style={{
            padding: '8px 22px',
            fontSize: '13px',
            fontWeight: 600,
            background: '#6366f1',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            cursor: individualProfiles.length === 0 ? 'not-allowed' : 'pointer'
          }}
        >
          {creating ? 'Creating Project...' : 'Create Project'}
        </button>
      </div>
    </div>
  )

  if (embedded) {
    return (
      <>
        {modalContent}
        {addAccountsOpen && (
          <CardAddModal
            open={addAccountsOpen}
            project={dummyProject}
            onClose={() => setAddAccountsOpen(false)}
            onSuccess={() => {
              if (dummyProject.sources) {
                setSources([...dummyProject.sources])
              }
            }}
          />
        )}
      </>
    )
  }

  return (
    <div
      className="platform-settings-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !addAccountsOpen) onClose()
      }}
      style={{ zIndex: 1200 }}
    >
      {modalContent}
      {addAccountsOpen && (
        <CardAddModal
          open={addAccountsOpen}
          project={dummyProject}
          onClose={() => setAddAccountsOpen(false)}
          onSuccess={() => {
            if (dummyProject.sources) {
              setSources([...dummyProject.sources])
            }
          }}
        />
      )}
    </div>
  )
}
