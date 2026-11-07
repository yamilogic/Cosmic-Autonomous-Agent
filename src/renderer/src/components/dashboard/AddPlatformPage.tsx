import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AppId, isGlobalAccountProfile, isIndividualProfile, profileDisplayLabel } from '../../../../shared/types'
import { useProfileStore } from '../../hooks/useProfiles'
import { useDashboardStore } from '../../hooks/useDashboard'
import type { ProjectSource } from '../../../../shared/dashboard-contract'

interface AddPlatformPageProps {
  open: boolean
  onClose: () => void
  initialProfileId?: string | null
  initialCardId?: string | null
  onOpenProfilesHub?: () => void
  onNewProject?: () => void
  onNewProfile?: () => void
}

interface PlatformEntry {
  id: AppId | 'upwork' | 'discord' | 'google-chat'
  name: string
  icon: string
  status: 'connected' | 'needs-login' | 'soon'
  supported: boolean
  description: string
}

export interface PresetLink {
  name: string
  url: string
  icon: string
  category: 'AI Agents' | 'Productivity & Dev'
}

export const POPULAR_PRESETS: PresetLink[] = [
  { name: 'Claude', url: 'https://claude.ai', icon: '🤖', category: 'AI Agents' },
  { name: 'ChatGPT', url: 'https://chatgpt.com', icon: '✨', category: 'AI Agents' },
  { name: 'Perplexity', url: 'https://perplexity.ai', icon: '🔍', category: 'AI Agents' },
  { name: 'Gemini', url: 'https://gemini.google.com', icon: '💎', category: 'AI Agents' },
  { name: 'GitHub', url: 'https://github.com', icon: '🐙', category: 'Productivity & Dev' },
  { name: 'Notion', url: 'https://notion.so', icon: '📝', category: 'Productivity & Dev' },
  { name: 'Linear', url: 'https://linear.app', icon: '📐', category: 'Productivity & Dev' },
  { name: 'Figma', url: 'https://figma.com', icon: '🎨', category: 'Productivity & Dev' },
  { name: 'Google Drive', url: 'https://drive.google.com', icon: '📁', category: 'Productivity & Dev' }
]

const PLATFORMS: PlatformEntry[] = [
  {
    id: 'slack',
    name: 'Slack',
    icon: '💬',
    status: 'needs-login',
    supported: true,
    description: 'Connect a Slack workspace and map its messages to project cards.'
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    icon: '👥',
    status: 'needs-login',
    supported: true,
    description: 'Connect a Teams workspace and read messages from project cards.'
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: '📱',
    status: 'needs-login',
    supported: true,
    description: 'Read-only WhatsApp Web session for client communication.'
  },
  {
    id: 'upwork',
    name: 'Upwork',
    icon: '💼',
    status: 'soon',
    supported: false,
    description: 'Upwork Messages integration coming soon.'
  },
  {
    id: 'discord',
    name: 'Discord',
    icon: '🎮',
    status: 'soon',
    supported: false,
    description: 'Discord server integration coming soon.'
  },
  {
    id: 'google-chat',
    name: 'Google Chat',
    icon: '💭',
    status: 'soon',
    supported: false,
    description: 'Google Chat integration coming soon.'
  }
]

export function AddPlatformPage({
  open,
  onClose,
  initialProfileId,
  initialCardId,
  onOpenProfilesHub,
  onNewProject,
  onNewProfile
}: AddPlatformPageProps): React.JSX.Element | null {
  const profiles = useProfileStore((s) => s.profiles)
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const snapshot = useDashboardStore((s) => s.snapshot)
  const upsertProject = useDashboardStore((s) => s.upsertProject)

  const allProjects = (snapshot?.projects ?? []).map((p) => p.project)

  // Navigation state in left sidebar: 'observer' | 'global' | 'individual'
  const [activeSection, setActiveSection] = useState<'observer' | 'global' | 'individual'>('global')
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [selectedCardId, setSelectedCardId] = useState<string>('')
  const [profilesDropdownExpanded, setProfilesDropdownExpanded] = useState<boolean>(true)

  // Card tab inside individual card view: 'global' | 'my' | 'client'
  const [cardTab, setCardTab] = useState<'global' | 'my' | 'client'>('global')

  // Form states
  const [customName, setCustomName] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [addingPreset, setAddingPreset] = useState<string | null>(null)
  const [cardItemPlatform, setCardItemPlatform] = useState<string>('slack')
  const [cardItemName, setCardItemName] = useState('')
  const [cardItemUrl, setCardItemUrl] = useState('')
  const [busy, setBusy] = useState(false)

  // Profile classification matching AccountsManagementModal strictly
  const globalProfiles = useMemo(() => profiles.filter(isGlobalAccountProfile), [profiles])
  const individualProfiles = useMemo(() => profiles.filter(isIndividualProfile), [profiles])

  useEffect(() => {
    if (initialProfileId) {
      const isIndiv = individualProfiles.some((p) => p.id === initialProfileId)
      if (isIndiv) {
        setActiveSection('individual')
        setSelectedProfileId(initialProfileId)
        const userProjects = allProjects.filter((p) => p.profileId === initialProfileId && (p.workflowStatus ?? 'active') !== 'removed')
        if (initialCardId) {
          setSelectedCardId(initialCardId)
        } else if (userProjects.length > 0) {
          setSelectedCardId(userProjects[0]!.id)
        }
      } else {
        setActiveSection('global')
        setSelectedProfileId(initialProfileId)
      }
    } else if (activeProfileId) {
      const activeProf = profiles.find((p) => p.id === activeProfileId)
      const isIndiv = activeProf ? isIndividualProfile(activeProf) : false
      if (isIndiv) {
        setActiveSection('individual')
        setSelectedProfileId(activeProfileId)
        const userProjects = allProjects.filter((p) => p.profileId === activeProfileId && (p.workflowStatus ?? 'active') !== 'removed')
        if (userProjects.length > 0) {
          setSelectedCardId(userProjects[0]!.id)
        }
      } else {
        setActiveSection('global')
        setSelectedProfileId(activeProfileId)
      }
    } else if (individualProfiles.length > 0) {
      setActiveSection('individual')
      setSelectedProfileId(individualProfiles[0]!.id)
      const userProjects = allProjects.filter((p) => p.profileId === individualProfiles[0]!.id && (p.workflowStatus ?? 'active') !== 'removed')
      if (userProjects.length > 0) {
        setSelectedCardId(userProjects[0]!.id)
      }
    } else if (globalProfiles.length > 0) {
      setSelectedProfileId(globalProfiles[0]!.id)
    }
  }, [initialProfileId, initialCardId, activeProfileId, profiles.length])

  // Current selected project card (if in individual section)
  const currentCard = allProjects.find((p) => p.id === selectedCardId)

  // Handler for adding global preset link
  const handleAddGlobalLink = useCallback(
    async (name: string, url: string) => {
      const targetId = selectedProfileId || activeProfileId || profiles[0]?.id
      if (!targetId) {
        setFeedbackMsg({ text: 'Please select a profile first.', error: true })
        return
      }
      setFeedbackMsg(null)
      try {
        const updated = await window.api.profiles.addCustomLink(targetId, {
          name,
          url
        })
        useProfileStore.setState((prev) => ({
          profiles: prev.profiles.map((p) => (p.id === updated.id ? updated : p))
        }))
        setFeedbackMsg({ text: `Successfully added ${name} to sidebar!`, error: false })
        setCustomName('')
        setCustomUrl('')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setFeedbackMsg({ text: msg, error: true })
      }
    },
    [selectedProfileId, activeProfileId, profiles]
  )

  // Handler for adding card-level custom account (isolated strictly to project.sources[])
  const handleAddCardSource = async (role: 'client' | 'ours') => {
    if (!currentCard) return
    if (!cardItemName.trim()) {
      setFeedbackMsg({ text: 'Please provide an account or name', error: true })
      return
    }

    setBusy(true)
    setFeedbackMsg(null)
    try {
      const formattedUrl = cardItemUrl.trim()
        ? cardItemUrl.trim().startsWith('http')
          ? cardItemUrl.trim()
          : `https://${cardItemUrl.trim()}`
        : undefined

      const now = new Date().toISOString()
      const existingSources = currentCard.sources ?? []
      const newSource: ProjectSource = {
        id: `src-custom-${Date.now().toString(36)}`,
        kind: 'browser',
        platform: cardItemPlatform || 'slack',
        profileId: currentCard.profileId || selectedProfileId,
        workspaceId: `custom-${Date.now().toString(36)}`,
        workspaceName: cardItemName.trim(),
        url: formattedUrl,
        channels: [],
        role,
        backfillDays: 7,
        enabled: true,
        status: 'connected',
        createdAt: now,
        updatedAt: now
      }

      await upsertProject({
        ...currentCard,
        sources: [...existingSources, newSource]
      })

      setFeedbackMsg({
        text: `Added "${cardItemName.trim()}" to ${currentCard.name} (${role === 'client' ? 'Client Accounts' : 'My Accounts'})!`,
        error: false
      })
      setCardItemName('')
      setCardItemUrl('')
    } catch (err: any) {
      setFeedbackMsg({ text: err instanceof Error ? err.message : 'Failed to save source', error: true })
    } finally {
      setBusy(false)
    }
  }

  // Handler for adding global workspace to card
  const handleAddWorkspaceToCard = async (
    profileId: string,
    teamId: string,
    teamName: string,
    role: 'client' | 'ours'
  ) => {
    if (!currentCard) return
    setBusy(true)
    setFeedbackMsg(null)
    try {
      const existingSources = currentCard.sources ?? []
      const duplicate = existingSources.some(
        (s) => s.workspaceId === teamId && s.profileId === profileId
      )
      if (duplicate) {
        setFeedbackMsg({ text: `${teamName} is already added as a source for this project.`, error: true })
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

      await upsertProject({
        ...currentCard,
        sources: [...existingSources, newSource]
      })

      setFeedbackMsg({ text: `Added ${teamName} to ${currentCard.name}`, error: false })
    } catch (err: any) {
      setFeedbackMsg({ text: err instanceof Error ? err.message : 'Failed to add source', error: true })
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  // Profile-grouped structure of all available workspaces and links for card global tab
  const profileGroups = profiles
    .map((p) => {
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
    })
    .filter((g) => g.hasItems)

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
        aria-label="Add Platform or Web Link Hub"
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
            <span style={{ fontSize: '22px' }}>🌐</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f8fafc' }}>
                Add Platform or Web Link
              </h2>
              <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>
                Connect native workspaces or add web links to accounts and project cards.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {onOpenProfilesHub && (
              <button
                type="button"
                className="btn ghost btn-sm"
                onClick={() => {
                  onClose()
                  onOpenProfilesHub()
                }}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                👥 All Profiles
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

        {feedbackMsg && (
          <div
            style={{
              padding: '8px 24px',
              background: feedbackMsg.error ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              borderBottom: feedbackMsg.error ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)',
              color: feedbackMsg.error ? '#f87171' : '#34d399',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <span>{feedbackMsg.text}</span>
            <button
              type="button"
              onClick={() => setFeedbackMsg(null)}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Two-Column Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left Navigation Sidebar */}
          <aside
            style={{
              width: '280px',
              borderRight: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(10, 14, 26, 0.65)',
              display: 'flex',
              flexDirection: 'column',
              padding: '16px 12px',
              gap: '6px',
              overflowY: 'auto'
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 10px 8px' }}>
              Navigation &amp; Scopes
            </div>

            {/* 1. Observer */}
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

            {/* 2. Global Accounts */}
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

            {/* 3. Individual Profiles & Cards */}
            <div style={{ marginTop: '8px' }}>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px', paddingLeft: '4px' }}>
                  {individualProfiles.length === 0 ? (
                    <div style={{ fontSize: '11.5px', color: '#64748b', padding: '6px 10px', fontStyle: 'italic' }}>
                      No individual profiles
                    </div>
                  ) : (
                    individualProfiles.map((profile) => {
                      const userProjects = allProjects.filter(
                        (p) => p.profileId === profile.id && (p.workflowStatus ?? 'active') !== 'removed'
                      )
                      const isProfileActive = activeSection === 'individual' && selectedProfileId === profile.id

                      return (
                        <div key={profile.id} style={{ marginBottom: '6px' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveSection('individual')
                              setSelectedProfileId(profile.id)
                              if (userProjects.length > 0 && !userProjects.some((p) => p.id === selectedCardId)) {
                                setSelectedCardId(userProjects[0]!.id)
                              }
                            }}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '7px 10px',
                              borderRadius: '6px',
                              background: isProfileActive ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                              color: isProfileActive ? '#60a5fa' : '#cbd5e1',
                              border: isProfileActive ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                              cursor: 'pointer',
                              fontSize: '12px',
                              fontWeight: isProfileActive ? 600 : 400,
                              textAlign: 'left'
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              👤 {profileDisplayLabel(profile)}
                            </span>
                            <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                              {userProjects.length} cards
                            </span>
                          </button>

                          {/* List child project cards directly under this profile */}
                          {isProfileActive && (
                            <div style={{ paddingLeft: '14px', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              {userProjects.length === 0 ? (
                                <div style={{ fontSize: '11px', color: '#64748b', padding: '4px 8px', fontStyle: 'italic' }}>
                                  No active cards
                                </div>
                              ) : (
                                userProjects.map((proj) => {
                                  const isCardSelected = selectedCardId === proj.id
                                  return (
                                    <button
                                      key={proj.id}
                                      type="button"
                                      onClick={() => setSelectedCardId(proj.id)}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '5px 8px',
                                        borderRadius: '4px',
                                        background: isCardSelected ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255,255,255,0.02)',
                                        color: isCardSelected ? '#a5b4fc' : '#94a3b8',
                                        border: isCardSelected ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
                                        cursor: 'pointer',
                                        fontSize: '11.5px',
                                        textAlign: 'left'
                                      }}
                                    >
                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        📁 {proj.name}
                                      </span>
                                      <span style={{ fontSize: '10px', color: '#64748b' }}>
                                        {proj.sources?.length ?? 0}
                                      </span>
                                    </button>
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
              )}
            </div>
          </aside>

          {/* Right Main Content Panel */}
          <main
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '24px 32px'
            }}
          >
            {/* VIEW 1: Observer */}
            {activeSection === 'observer' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '28px' }}>🔭</span>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f8fafc' }}>
                      Observer View &amp; Workspace Streams
                    </h3>
                    <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#94a3b8' }}>
                      Monitor global incoming channel activity across team workspaces and client profiles.
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.5)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '8px',
                    padding: '24px',
                    textAlign: 'center',
                    color: '#94a3b8',
                    marginTop: '20px'
                  }}
                >
                  <p style={{ margin: 0, fontSize: '14px', color: '#e2e8f0' }}>
                    Observer Mode is active. All streams are routed to live workspace observers.
                  </p>
                  <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#64748b' }}>
                    To configure platform connections, select <b>Global Accounts</b> or an <b>Individual Profile Card</b> from the left navigation.
                  </p>
                </div>
              </div>
            )}

            {/* VIEW 2: Global Accounts */}
            {activeSection === 'global' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f8fafc' }}>
                      Global Platforms &amp; Custom Web Links
                    </h3>
                    <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#94a3b8' }}>
                      Connect workspaces and apps available globally across your main workspace sidebar.
                    </p>
                  </div>

                  {/* Target Profile Selector & Visibility Toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>Target Profile:</span>
                      <select
                        value={selectedProfileId}
                        onChange={(e) => setSelectedProfileId(e.target.value)}
                        style={{
                          background: '#0f172a',
                          color: '#f8fafc',
                          border: '1px solid rgba(255,255,255,0.15)',
                          borderRadius: '6px',
                          padding: '5px 10px',
                          fontSize: '12px'
                        }}
                      >
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {profileDisplayLabel(p)} ({p.displayName})
                          </option>
                        ))}
                      </select>
                    </div>

                    {(() => {
                      const currentProfile = profiles.find((p) => p.id === selectedProfileId)
                      if (!currentProfile) return null
                      const isProfileHidden = !!currentProfile.hiddenInSidebar
                      return (
                        <button
                          type="button"
                          className="btn ghost btn-sm"
                          style={{
                            fontSize: '11.5px',
                            padding: '4px 10px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                            background: isProfileHidden ? 'rgba(239, 68, 68, 0.12)' : 'rgba(74, 222, 128, 0.12)',
                            color: isProfileHidden ? '#f87171' : '#4ade80',
                            border: `1px solid ${isProfileHidden ? 'rgba(239, 68, 68, 0.3)' : 'rgba(74, 222, 128, 0.3)'}`
                          }}
                          title={isProfileHidden ? 'Profile is hidden in sidebar. Click to show.' : 'Profile is shown in sidebar. Click to hide.'}
                          onClick={async () => {
                            try {
                              const updated = await window.api.profiles.setHiddenInSidebar(currentProfile.id, !isProfileHidden)
                              useProfileStore.setState((prev) => ({
                                profiles: prev.profiles.map((p) => (p.id === updated.id ? updated : p))
                              }))
                              setFeedbackMsg({
                                text: `Profile ${profileDisplayLabel(currentProfile)} is now ${!isProfileHidden ? 'hidden from' : 'shown in'} sidebar!`,
                                error: false
                              })
                            } catch (err: any) {
                              setFeedbackMsg({ text: err.message || 'Failed to update profile visibility', error: true })
                            }
                          }}
                        >
                          {isProfileHidden ? '🚫 Profile Hidden in Sidebar (Click to Show)' : '👁 Profile Visible in Sidebar (Click to Hide)'}
                        </button>
                      )
                    })()}
                  </div>
                </div>

                {/* Popular Presets */}
                <section className="add-section" style={{ marginBottom: '24px' }}>
                  <h4 className="add-section-title" style={{ fontSize: '14.5px', color: '#e2e8f0' }}>
                    Popular AI Agents &amp; Tools (1-Click Add)
                  </h4>
                  <p className="add-section-sub" style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>
                    Click "+ Add" to instantly bind Claude, ChatGPT, Notion, GitHub and more to your sidebar.
                  </p>

                  <div className="preset-grid">
                    {POPULAR_PRESETS.map((preset) => (
                      <div key={preset.name} className="preset-card">
                        <div className="preset-meta">
                          <span className="preset-icon">{preset.icon}</span>
                          <div>
                            <div className="preset-name">{preset.name}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn primary btn-sm"
                          style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                          onClick={async () => {
                            setAddingPreset(preset.name)
                            await handleAddGlobalLink(preset.name, preset.url)
                            setAddingPreset(null)
                          }}
                          disabled={addingPreset === preset.name}
                        >
                          {addingPreset === preset.name ? 'Adding…' : '+ Add'}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Supported Messaging Platforms */}
                <section className="add-section" style={{ marginBottom: '24px' }}>
                  <h4 className="add-section-title" style={{ fontSize: '14.5px', color: '#e2e8f0' }}>
                    Supported Messaging Platforms
                  </h4>
                  <div className="add-platform-list">
                    {PLATFORMS.map((platform) => {
                      const currentProfile = profiles.find((p) => p.id === selectedProfileId)
                      const session = currentProfile && platform.id in currentProfile.apps
                        ? currentProfile.apps[platform.id as AppId]
                        : null
                      const isConnected = session?.sessionStatus === 'signed-in'
                      const status = isConnected
                        ? 'connected'
                        : platform.supported
                          ? 'needs-login'
                          : 'soon'

                      return (
                        <div
                          key={platform.id}
                          className={`add-platform-row${!platform.supported ? ' is-soon' : ''}`}
                        >
                          <div className="add-platform-info">
                            <span className="add-platform-icon">{platform.icon}</span>
                            <span className="add-platform-name">{platform.name}</span>
                            <span className="add-platform-desc">{platform.description}</span>
                          </div>
                          <div className="add-platform-status">
                            <span className={`add-platform-status-dot ${status}`} />
                            <span className="add-platform-status-label">
                              {status === 'connected' ? 'Connected' : status === 'soon' ? 'Soon' : 'Needs login'}
                            </span>
                          </div>
                          {platform.supported && !isConnected ? (
                            <button
                              type="button"
                              className="btn primary btn-sm"
                              onClick={() => onClose()}
                            >
                              Connect
                            </button>
                          ) : platform.supported && isConnected ? (
                            <button type="button" className="btn ghost btn-sm" disabled>
                              Connected
                            </button>
                          ) : (
                            <span className="add-platform-soon-badge">Soon</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>

                {/* Custom URL Form */}
                <section className="add-section add-section-custom">
                  <h4 className="add-section-title" style={{ fontSize: '14.5px', color: '#e2e8f0' }}>
                    Add Any Custom URL
                  </h4>
                  <p className="add-section-sub" style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>
                    Add any HTTPS web link to your sidebar. Partition isolated.
                  </p>
                  <div className="add-custom-form">
                    <div className="add-custom-field">
                      <label className="add-custom-label">Name</label>
                      <input
                        type="text"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        placeholder="e.g. Claude Workspace, Linear Team, Jira"
                        className="add-custom-input"
                      />
                    </div>
                    <div className="add-custom-field">
                      <label className="add-custom-label">URL (https only)</label>
                      <input
                        type="url"
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                        placeholder="https://example.com"
                        className="add-custom-input"
                      />
                    </div>
                    <button
                      type="button"
                      className="btn primary btn-sm"
                      onClick={() => handleAddGlobalLink(customName, customUrl)}
                      disabled={!customName.trim() || !customUrl.trim()}
                    >
                      Add link
                    </button>
                  </div>
                </section>

                {/* Manage Added Websites & Custom Links Section */}
                <section className="add-section add-section-custom" style={{ marginTop: '28px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div>
                      <h4 className="add-section-title" style={{ fontSize: '15px', color: '#f8fafc', margin: 0 }}>
                        Manage Added Websites &amp; Custom Links ({profiles.find((p) => p.id === selectedProfileId)?.customLinks?.length || 0})
                      </h4>
                      <p className="add-section-sub" style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0' }}>
                        Unhide, hide, or remove website links from your sidebar.
                      </p>
                    </div>
                  </div>

                  {(() => {
                    const targetProf = profiles.find((p) => p.id === selectedProfileId)
                    if (!targetProf) return null
                    const links = targetProf.customLinks || []

                    if (links.length === 0) {
                      return (
                        <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '12.5px', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          No custom websites added to this profile yet.
                        </div>
                      )
                    }

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {links.map((link) => {
                          const isHidden = !!link.hiddenInSidebar
                          return (
                            <div
                              key={link.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '10px 14px',
                                background: 'rgba(15, 23, 42, 0.5)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                borderRadius: '6px'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                                <span style={{ fontSize: '16px' }}>🌐</span>
                                <div>
                                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                                    {link.name}
                                  </div>
                                  <div style={{ fontSize: '11.5px', color: '#64748b', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '420px' }}>
                                    {link.url}
                                  </div>
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    background: isHidden ? 'rgba(239, 68, 68, 0.15)' : 'rgba(74, 222, 128, 0.15)',
                                    color: isHidden ? '#f87171' : '#4ade80'
                                  }}
                                >
                                  {isHidden ? '🚫 Hidden in sidebar' : '👁 Visible in sidebar'}
                                </span>

                                <button
                                  type="button"
                                  className="btn ghost btn-sm"
                                  style={{ fontSize: '11.5px', padding: '4px 10px' }}
                                  onClick={async () => {
                                    try {
                                      const updated = await window.api.profiles.setLinkHiddenInSidebar(targetProf.id, link.id, !isHidden)
                                      useProfileStore.setState((prev) => ({
                                        profiles: prev.profiles.map((p) => (p.id === updated.id ? updated : p))
                                      }))
                                      setFeedbackMsg({
                                        text: `${link.name} is now ${!isHidden ? 'hidden from' : 'visible in'} sidebar!`,
                                        error: false
                                      })
                                    } catch (err: any) {
                                      setFeedbackMsg({ text: err.message || 'Failed to update visibility', error: true })
                                    }
                                  }}
                                >
                                  {isHidden ? '👁 Unhide' : '🚫 Hide'}
                                </button>

                                <button
                                  type="button"
                                  className="btn ghost btn-sm"
                                  style={{ fontSize: '11.5px', padding: '4px 10px', color: '#f87171' }}
                                  onClick={async () => {
                                    try {
                                      const updated = await window.api.profiles.removeCustomLink(targetProf.id, link.id)
                                      useProfileStore.setState((prev) => ({
                                        profiles: prev.profiles.map((p) => (p.id === updated.id ? updated : p))
                                      }))
                                      setFeedbackMsg({ text: `Removed ${link.name}!`, error: false })
                                    } catch (err: any) {
                                      setFeedbackMsg({ text: err.message || 'Failed to remove link', error: true })
                                    }
                                  }}
                                >
                                  ✕ Remove
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </section>
              </div>
            )}

            {/* VIEW 3: Individual Profile Project Card Level */}
            {activeSection === 'individual' && (
              <div>
                {!currentCard ? (
                  <div
                    style={{
                      background: 'rgba(15, 23, 42, 0.5)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '8px',
                      padding: '36px',
                      textAlign: 'center',
                      color: '#94a3b8'
                    }}
                  >
                    <p style={{ margin: 0, fontSize: '15px', color: '#e2e8f0', fontWeight: 500 }}>
                      No Project Card Selected
                    </p>
                    <p style={{ margin: '8px 0 16px', fontSize: '12.5px', color: '#64748b' }}>
                      Select a project card from the left sidebar to add platforms, workspaces, or client accounts directly to that card.
                    </p>
                    {onNewProject && (
                      <button
                        type="button"
                        className="btn primary btn-sm"
                        onClick={() => {
                          onClose()
                          onNewProject()
                        }}
                      >
                        📁 Create New Project Card
                      </button>
                    )}
                  </div>
                ) : (
                  <div>
                    {/* Card Context Header */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '16px 20px',
                        background: 'rgba(15, 23, 42, 0.6)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '8px',
                        marginBottom: '20px'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f8fafc' }}>
                            {currentCard.name}
                          </h3>
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              background: 'rgba(99, 102, 241, 0.2)',
                              color: '#a5b4fc',
                              fontWeight: 600
                            }}
                          >
                            Card Scope (Isolated)
                          </span>
                        </div>
                        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                          Client: <b>{currentCard.clientName}</b> • {currentCard.teamName || 'Workspace'} • {currentCard.sources?.length ?? 0} active sources
                        </p>
                      </div>

                      {/* 3 Workspace Tabs inside Card */}
                      <div
                        style={{
                          display: 'flex',
                          background: 'rgba(0, 0, 0, 0.35)',
                          borderRadius: '6px',
                          padding: '3px',
                          border: '1px solid rgba(255, 255, 255, 0.08)'
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setCardTab('global')}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '4px',
                            border: 'none',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            background: cardTab === 'global' ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
                            color: cardTab === 'global' ? '#60a5fa' : '#94a3b8'
                          }}
                        >
                          🌐 Global Workspaces
                        </button>
                        <button
                          type="button"
                          onClick={() => setCardTab('my')}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '4px',
                            border: 'none',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            background: cardTab === 'my' ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
                            color: cardTab === 'my' ? '#60a5fa' : '#94a3b8'
                          }}
                        >
                          👥 My Accounts
                        </button>
                        <button
                          type="button"
                          onClick={() => setCardTab('client')}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '4px',
                            border: 'none',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            background: cardTab === 'client' ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
                            color: cardTab === 'client' ? '#60a5fa' : '#94a3b8'
                          }}
                        >
                          🏢 Client Accounts
                        </button>
                      </div>
                    </div>

                    {/* Tab 1: Global Workspaces & Links */}
                    {cardTab === 'global' && (
                      <div>
                        <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#94a3b8' }}>
                          Add workspaces or links already connected in your global pool to this card:
                        </p>

                        {profileGroups.length === 0 ? (
                          <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                            No global workspaces or connected accounts found.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {profileGroups.map((group) => (
                              <div
                                key={group.profileId}
                                style={{
                                  background: 'rgba(15, 23, 42, 0.4)',
                                  border: '1px solid rgba(255, 255, 255, 0.06)',
                                  borderRadius: '8px',
                                  padding: '14px'
                                }}
                              >
                                <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '10px' }}>
                                  👤 {group.profileName}
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  {group.slackWorkspaces.map((ws) => {
                                    const isAdded = currentCard.sources?.some(
                                      (s) => s.workspaceId === ws.teamId && s.profileId === group.profileId
                                    )

                                    return (
                                      <div
                                        key={`${group.profileId}:${ws.teamId}`}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          padding: '8px 12px',
                                          background: 'rgba(0, 0, 0, 0.25)',
                                          borderRadius: '6px'
                                        }}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                          <span>💬</span>
                                          <span style={{ fontSize: '12.5px', color: '#f8fafc', fontWeight: 500 }}>
                                            {ws.teamName}
                                          </span>
                                        </div>

                                        {isAdded ? (
                                          <span style={{ fontSize: '11px', color: '#4ade80', fontWeight: 600 }}>
                                            ✓ Added
                                          </span>
                                        ) : (
                                          <div style={{ display: 'flex', gap: '6px' }}>
                                            <button
                                              type="button"
                                              className="btn ghost btn-sm"
                                              style={{ fontSize: '11px', padding: '3px 8px' }}
                                              disabled={busy}
                                              onClick={() =>
                                                handleAddWorkspaceToCard(group.profileId, ws.teamId, ws.teamName, 'client')
                                              }
                                            >
                                              + Client
                                            </button>
                                            <button
                                              type="button"
                                              className="btn primary btn-sm"
                                              style={{ fontSize: '11px', padding: '3px 8px' }}
                                              disabled={busy}
                                              onClick={() =>
                                                handleAddWorkspaceToCard(group.profileId, ws.teamId, ws.teamName, 'ours')
                                              }
                                            >
                                              + My Account
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tab 2: My Accounts */}
                    {cardTab === 'my' && (
                      <div
                        style={{
                          background: 'rgba(15, 23, 42, 0.4)',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          borderRadius: '8px',
                          padding: '20px'
                        }}
                      >
                        <h4 style={{ margin: '0 0 4px', fontSize: '14.5px', color: '#f8fafc' }}>
                          Add to My Accounts (Internal Team Workspace)
                        </h4>
                        <p style={{ margin: '0 0 16px', fontSize: '12.5px', color: '#94a3b8' }}>
                          Add internal team links (Upwork, Discord, Teams, WhatsApp, Jira, etc.) directly to this card.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '540px' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                              Platform
                            </label>
                            <select
                              value={cardItemPlatform}
                              onChange={(e) => setCardItemPlatform(e.target.value)}
                              style={{
                                width: '100%',
                                padding: '8px 10px',
                                background: '#0a0f1d',
                                color: '#fff',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '6px',
                                fontSize: '12.5px'
                              }}
                            >
                              <option value="slack">Slack</option>
                              <option value="teams">Microsoft Teams</option>
                              <option value="whatsapp">WhatsApp</option>
                              <option value="upwork">Upwork</option>
                              <option value="discord">Discord</option>
                              <option value="custom">Web Link / Custom</option>
                            </select>
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                              Account / Workspace Name
                            </label>
                            <input
                              type="text"
                              value={cardItemName}
                              onChange={(e) => setCardItemName(e.target.value)}
                              placeholder="e.g. Agency Team, Internal Slack, #core-channel"
                              style={{
                                width: '100%',
                                padding: '8px 10px',
                                background: '#0a0f1d',
                                color: '#fff',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '6px',
                                fontSize: '12.5px'
                              }}
                            />
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                              URL or Portal Link (optional)
                            </label>
                            <input
                              type="url"
                              value={cardItemUrl}
                              onChange={(e) => setCardItemUrl(e.target.value)}
                              placeholder="https://..."
                              style={{
                                width: '100%',
                                padding: '8px 10px',
                                background: '#0a0f1d',
                                color: '#fff',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '6px',
                                fontSize: '12.5px'
                              }}
                            />
                          </div>

                          <button
                            type="button"
                            className="btn primary btn-sm"
                            style={{ padding: '8px 16px', marginTop: '6px', alignSelf: 'flex-start' }}
                            disabled={busy || !cardItemName.trim()}
                            onClick={() => handleAddCardSource('ours')}
                          >
                            {busy ? 'Saving…' : 'Add to My Accounts'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Tab 3: Client Accounts */}
                    {cardTab === 'client' && (
                      <div
                        style={{
                          background: 'rgba(15, 23, 42, 0.4)',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          borderRadius: '8px',
                          padding: '20px'
                        }}
                      >
                        <h4 style={{ margin: '0 0 4px', fontSize: '14.5px', color: '#f8fafc' }}>
                          Add to Client Accounts (External Client Workspaces)
                        </h4>
                        <p style={{ margin: '0 0 16px', fontSize: '12.5px', color: '#94a3b8' }}>
                          Add client portal links, client Slack/Teams workspaces, or communication channels to this card.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '540px' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                              Platform
                            </label>
                            <select
                              value={cardItemPlatform}
                              onChange={(e) => setCardItemPlatform(e.target.value)}
                              style={{
                                width: '100%',
                                padding: '8px 10px',
                                background: '#0a0f1d',
                                color: '#fff',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '6px',
                                fontSize: '12.5px'
                              }}
                            >
                              <option value="slack">Slack</option>
                              <option value="teams">Microsoft Teams</option>
                              <option value="whatsapp">WhatsApp</option>
                              <option value="upwork">Upwork</option>
                              <option value="discord">Discord</option>
                              <option value="custom">Web Link / Custom</option>
                            </select>
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                              Client Account / Channel Name
                            </label>
                            <input
                              type="text"
                              value={cardItemName}
                              onChange={(e) => setCardItemName(e.target.value)}
                              placeholder="e.g. Acme Client Slack, #feedback"
                              style={{
                                width: '100%',
                                padding: '8px 10px',
                                background: '#0a0f1d',
                                color: '#fff',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '6px',
                                fontSize: '12.5px'
                              }}
                            />
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                              URL or Portal Link (optional)
                            </label>
                            <input
                              type="url"
                              value={cardItemUrl}
                              onChange={(e) => setCardItemUrl(e.target.value)}
                              placeholder="https://..."
                              style={{
                                width: '100%',
                                padding: '8px 10px',
                                background: '#0a0f1d',
                                color: '#fff',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '6px',
                                fontSize: '12.5px'
                              }}
                            />
                          </div>

                          <button
                            type="button"
                            className="btn primary btn-sm"
                            style={{ padding: '8px 16px', marginTop: '6px', alignSelf: 'flex-start' }}
                            disabled={busy || !cardItemName.trim()}
                            onClick={() => handleAddCardSource('client')}
                          >
                            {busy ? 'Saving…' : 'Add to Client Accounts'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

export default AddPlatformPage
