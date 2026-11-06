import { memo, useMemo, useState } from 'react'
import { useProfileStore } from '../hooks/useProfiles'
import { useDashboardStore } from '../hooks/useDashboard'
import { APP_DISPLAY_NAME } from '../../../shared/brand'
import type { AppId, AppSession, AppSessionStatus, CustomLink, Profile } from '../../../shared/types'
import {
  APP_IDS,
  appSupportsWorkspaces,
  isGlobalAccountProfile,
  profileDisplayLabel,
  sanitizeWorkspaceName,
  sidebarAppLabel
} from '../../../shared/types'
import { modKey } from '../lib/shortcut-label'
import { formatUnreadBadge, unreadKey } from '../lib/unread-badge'
import appIcon from '../assets/app-icon.png'
import { AppIcon } from './AppIcon'
import { SidebarPanelIcon } from './SidebarPanelIcon'
import { CosmicSidebarContent } from './dashboard/CosmicSidebarNav'
import { BasicSidebarProjectTree } from './dashboard/BasicSidebarProjectTree'
import { getBaseLayoutItems } from '../../../shared/base-app-presets'

interface RecentWorkspace {
  profileId: string
  appId: string
  teamId: string
  label: string
  at: string
}

interface ProfileSidebarProps {
  profiles: Profile[]
  activeProfileId: string | null
  activeAppId: AppId | null
  selectedTeamId: string | null
  syncingProfileId: string | null
  email: string
  onEmailChange: (value: string) => void
  googleBusy: boolean
  statusLine: string
  unreadCounts: Record<string, number>
  recentWorkspaces: RecentWorkspace[]
  onAddGoogle: () => void
  onCancelGoogle: () => void
  onToggleSidebar: () => void
  onSelect: (profileId: string) => void
  onSelectApp: (profileId: string, appId: AppId) => void
  onDelete: (profileId: string) => void
  onRename: (profileId: string, name: string) => void
  onToggleMute: (profileId: string, muted: boolean) => void
  onReorder: (orderedIds: string[]) => void
  onOpenInSplit: (profileId: string, appId: AppId) => void
  onOpenWorkspace: (profileId: string, appId: AppId, teamId: string) => void
  onSyncWorkspaces: (profileId: string, appId: AppId) => void
  onPinFromAvailable: (profileId: string, appId: AppId, teamId: string) => void
  onUnpin: (profileId: string, appId: AppId, teamId: string) => void
  onDismissError: () => void
  /** Open the platform settings panel for a given profile + app. */
  onPlatformSettings?: (profileId: string, appId: AppId) => void
  /** Open the "+ Add" page for adding platforms / custom links. */
  onAddPlatform: () => void
  /** Open the wizard to create a new workspace project */
  onNewProject?: () => void
  /** Open the modal to create a new profile */
  onNewProfile?: () => void
  /** Trigger the Observer action/mode */
  onObserver?: () => void
  /** Open the Accounts & Workspaces management hub / Global settings. */
  onOpenAccountsSettings?: () => void
  /** Open the Profiles & Accounts management hub */
  onOpenProfilesHub?: () => void
  /** Active custom link ID if one is currently opened in embed */
  activeCustomLinkId?: string | null
  /** Select and view a custom link */
  onSelectCustomLink?: (profileId: string, link: CustomLink) => void
  /** Optional slot rendered after the Recents strip (dashboard entry point). */
  dashboardSlot?: React.ReactNode
  /** Customization settings for the sidebar */
  sidebarLook?: 'minimal' | 'ancient' | 'new-cosmic' | 'basic'
  showLookSwitcher?: boolean
  showRecentSection?: boolean
  showGoogleEmailInputInSidebar?: boolean
  showObserverViewHeader?: boolean
  baseAppLayout?: 'none' | 'standard' | 'extended' | 'full'
  showSidebarItemActions?: boolean
  showSidebarProfileHideButton?: boolean
  showSidebarProfileNavButton?: boolean
  showSidebarDashboardNavButton?: boolean
  showCosmicProfileNavButtons?: boolean
  sidebarButtons?: {
    addWebsite?: boolean
    newProject?: boolean
    newProfile?: boolean
    observer?: boolean
    profilesHub?: boolean
  }
  onLookChange?: (look: 'minimal' | 'ancient' | 'new-cosmic' | 'basic') => void
  onToast?: (message: string) => void
}

function platformStatusDot(sessionStatus: AppSessionStatus): {
  label: string
  kind: 'connected' | 'needs-login' | 'signing-in'
} {
  if (sessionStatus === 'signed-in') {
    return { label: 'Connected', kind: 'connected' }
  }
  if (sessionStatus === 'not-signed-in') {
    return { label: 'Needs login', kind: 'needs-login' }
  }
  return { label: 'Signing in…', kind: 'signing-in' }
}

function isBusy(status: AppSessionStatus): boolean {
  return status === 'signing-in' || status === 'signing-in-google' || status === 'signing-in-slack'
}

function SignedInTick(): React.JSX.Element {
  return (
    <span className="status-tick" title="Signed in" aria-label="Signed in">
      ✓
    </span>
  )
}

function BusyMark({ label = 'Signing in…' }: { label?: string }): React.JSX.Element {
  return <span className="status-busy" title={label} aria-label={label} />
}

function ProfileAuthMark({
  googleAuthStatus
}: {
  googleAuthStatus: Profile['googleAuthStatus']
}): React.JSX.Element | null {
  if (googleAuthStatus === 'signing-in') {
    return <BusyMark label="Google sign-in in progress…" />
  }
  if (googleAuthStatus === 'signed-in') {
    return <SignedInTick />
  }
  return null
}

function AppStatusMark({ status }: { status: AppSessionStatus }): React.JSX.Element | null {
  if (status === 'signed-in') {
    return <SignedInTick />
  }
  if (isBusy(status)) {
    return <BusyMark />
  }
  return null
}

function displayWorkspaceName(ws: {
  teamName: string
  teamDomain?: string
  teamId: string
  lastChannelName?: string
}): string {
  const sanitized = sanitizeWorkspaceName(ws.teamName)
  const name = sanitized || ws.teamName?.trim()
  const generic =
    !name ||
    /^(microsoft teams|teams|teams org|organization|teams-home|unknown)$/i.test(name) ||
    /^\d+\s+new\s+items?/i.test(name) ||
    /^new\s+item/i.test(name) ||
    /^tenant-/i.test(name) ||
    /^T[A-Z0-9]+$/i.test(name)

  if (!generic) {
    return name
  }
  if (ws.teamDomain?.trim()) {
    return ws.teamDomain.trim()
  }
  if (ws.lastChannelName?.trim()) {
    return sanitizeWorkspaceName(ws.lastChannelName.trim()) || ws.lastChannelName.trim()
  }
  if (ws.teamId === 'teams-home') {
    return 'Personal'
  }
  return name || ws.teamId
}

function workspaceSubtitle(
  ws: { teamName: string; teamDomain?: string; teamId: string; lastChannelName?: string },
  appId: AppId
): string | null {
  const title = displayWorkspaceName(ws)
  const channel = ws.lastChannelName?.trim()
  if (appId === 'slack' && channel && channel !== title) {
    return `#${channel.replace(/^#/, '')}`
  }
  const domain = ws.teamDomain?.trim()
  if (domain && domain !== title) return domain
  if (appId === 'teams') return 'Organization'
  if (appId === 'slack') return 'Workspace'
  return null
}

function monogramFromLabel(label: string): string {
  const cleaned = label.trim()
  if (!cleaned) return '?'
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
  }
  return cleaned.slice(0, 2).toUpperCase()
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

function WorkspaceBranch({
  profileId,
  appId,
  session,
  selectedTeamId,
  onOpenWorkspace,
  onPin,
  onUnpin
}: {
  profileId: string
  appId: AppId
  session: AppSession
  selectedTeamId: string | null
  onOpenWorkspace: (profileId: string, appId: AppId, teamId: string) => void
  onPin: (profileId: string, appId: AppId, teamId: string) => void
  onUnpin: (profileId: string, appId: AppId, teamId: string) => void
}): React.JSX.Element {
  const pinnedIds = useMemo(
    () => new Set(session.pinnedWorkspaces.map((w) => w.teamId)),
    [session.pinnedWorkspaces]
  )

  const workspaces = useMemo(() => {
    const byId = new Map(session.availableWorkspaces.map((w) => [w.teamId, w]))
    const pinnedFirst = session.pinnedWorkspaces.map((p) => byId.get(p.teamId) ?? p).filter(Boolean)
    const rest = session.availableWorkspaces.filter((w) => !pinnedIds.has(w.teamId))
    return [...pinnedFirst, ...rest]
  }, [session.availableWorkspaces, session.pinnedWorkspaces, pinnedIds])

  const sectionTitle = appId === 'teams' ? 'Organizations' : 'Workspaces'

  if (session.sessionStatus !== 'signed-in') {
    return <p className="nav-hint">Sign in to discover {sectionTitle.toLowerCase()}.</p>
  }
  if (workspaces.length === 0) {
    return (
      <p className="nav-hint">
        {appId === 'teams'
          ? 'Open Teams to discover organizations.'
          : 'Open Slack to discover workspaces.'}
      </p>
    )
  }

  return (
    <div className="nav-workspace-block">
      <p className="nav-workspace-heading">{sectionTitle}</p>
      <ul className="nav-workspace-list">
        {workspaces.map((ws) => {
          const pinned = pinnedIds.has(ws.teamId)
          const title = displayWorkspaceName(ws)
          const subtitle = workspaceSubtitle(ws, appId)
          const selected = selectedTeamId === ws.teamId
          return (
            <li
              key={ws.teamId}
              className={`nav-workspace-row${selected ? ' is-selected' : ''}${pinned ? ' is-pinned' : ''}`}
            >
              <button
                type="button"
                className="nav-workspace-open"
                onClick={() => onOpenWorkspace(profileId, appId, ws.teamId)}
              >
                <span className="ws-app-chip" aria-hidden>
                  <AppIcon appId={appId} className="ws-app-icon" size={11} />
                </span>
                <span className="ws-copy">
                  <span className="ws-title">{title}</span>
                  {subtitle ? <span className="ws-sub">{subtitle}</span> : null}
                </span>
              </button>
              <button
                type="button"
                className={`nav-pin${pinned ? ' is-pinned' : ''}`}
                title={pinned ? 'Unpin' : 'Pin to top'}
                aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
                aria-pressed={pinned}
                onClick={(e) => {
                  e.stopPropagation()
                  if (pinned) onUnpin(profileId, appId, ws.teamId)
                  else onPin(profileId, appId, ws.teamId)
                }}
              >
                <PinGlyph filled={pinned} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export const ProfileSidebar = memo(function ProfileSidebar({
  profiles,
  activeProfileId,
  activeAppId,
  selectedTeamId,
  email,
  onEmailChange,
  googleBusy,
  statusLine: _statusLine,
  unreadCounts,
  recentWorkspaces,
  onAddGoogle,
  onCancelGoogle,
  onToggleSidebar,
  onSelect,
  onSelectApp,
  onDelete,
  onRename,
  onToggleMute,
  onReorder,
  onOpenInSplit,
  onOpenWorkspace,
  onPinFromAvailable,
  onUnpin,
  onDismissError: _onDismissError,
  onPlatformSettings: _onPlatformSettings,
  onAddPlatform,
  onNewProject,
  onNewProfile,
  onObserver,
  onOpenAccountsSettings,
  onOpenProfilesHub,
  activeCustomLinkId,
  onSelectCustomLink,
  dashboardSlot,
  sidebarLook: propSidebarLook,
  showLookSwitcher = false,
  showRecentSection = true,
  showGoogleEmailInputInSidebar = true,
  showObserverViewHeader = false,
  baseAppLayout = 'standard',
  showSidebarItemActions = true,
  showSidebarProfileHideButton = false,
  showSidebarProfileNavButton,
  showSidebarDashboardNavButton,
  showCosmicProfileNavButtons = true,
  sidebarButtons = {
    addWebsite: false,
    newProject: false,
    newProfile: false,
    observer: false,
    profilesHub: false
  },
  onLookChange,
  onToast
}: ProfileSidebarProps): React.JSX.Element {
  const activeLook = propSidebarLook ?? 'basic'
  const cosmicLevel1 = useDashboardStore((s) => s.cosmicLevel1)
  const isCosmicManagedMiddle =
    activeLook === 'minimal' ||
    activeLook === 'basic' ||
    (activeLook === 'new-cosmic' && cosmicLevel1 !== 'global')
  const [profileExpanded, setProfileExpanded] = useState<Record<string, boolean>>({})
  const [appExpanded, setAppExpanded] = useState<Record<string, boolean>>({})
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)

  const handleSetLook = (look: 'minimal' | 'ancient' | 'new-cosmic' | 'basic'): void => {
    onLookChange?.(look)
  }
  const presetToolLinks = useMemo(
    () => getBaseLayoutItems(baseAppLayout).filter((item) => item.type === 'link'),
    [baseAppLayout]
  )
  const profileIdSet = useMemo(() => new Set(profiles.map((p) => p.id)), [profiles])
  const visibleRecents = useMemo(() => {
    const fromHistory = recentWorkspaces.filter((r) => profileIdSet.has(r.profileId))
    if (fromHistory.length > 0) {
      return fromHistory.slice(0, 5)
    }
    return []
  }, [recentWorkspaces, profileIdSet])

  const isProfileOpen = (profileId: string): boolean => {
    if (profileId in profileExpanded) {
      return profileExpanded[profileId]!
    }
    return profileId === activeProfileId
  }

  const isAppOpen = (profileId: string, appId: AppId): boolean => {
    const key = `${profileId}:${appId}`
    if (key in appExpanded) {
      return appExpanded[key]!
    }
    return profileId === activeProfileId && activeAppId === appId
  }

  const profileUnread = (profileId: string): number =>
    APP_IDS.reduce((sum, appId) => sum + (unreadCounts[unreadKey(profileId, appId)] ?? 0), 0)

  const commitRename = (profileId: string): void => {
    const trimmed = renameValue.trim()
    onRename(profileId, trimmed)
    setRenamingId(null)
  }

  return (
    <aside className="sidebar" aria-label="Profiles">
      <div className="sidebar-brand">
        <div className="sidebar-brand-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img
              src={appIcon}
              alt=""
              aria-hidden="true"
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '6px',
                boxShadow: '0 0 10px rgba(139, 92, 246, 0.35)',
                objectFit: 'cover',
                display: 'block'
              }}
            />
            <h1 className="brand" style={{ margin: 0 }}>{APP_DISPLAY_NAME}</h1>
          </div>
          <div className="sidebar-brand-actions">
            <button
              type="button"
              className="btn ghost icon-btn"
              onClick={onToggleSidebar}
              title={`Hide sidebar (${modKey()}B)`}
              aria-label="Hide sidebar"
            >
              <SidebarPanelIcon />
            </button>
          </div>
        </div>

        {/* View Looks Switcher: Basic vs Minimal vs Cosmic vs Ancient (Fluid Auto-Responsive Grid) */}
        {showLookSwitcher ? (
          <div
            className="sidebar-looks-switcher"
            role="group"
            aria-label="Sidebar Appearance Look"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '3px',
              marginTop: '10px',
              background: 'rgba(0, 0, 0, 0.28)',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              width: '100%',
              boxSizing: 'border-box'
            }}
          >
            <button
              type="button"
              onClick={() => handleSetLook('basic')}
              aria-pressed={activeLook === 'basic'}
              style={{
                padding: '5px 2px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '6px',
                border: activeLook === 'basic' ? '1px solid var(--accent)' : '1px solid transparent',
                background: activeLook === 'basic' ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'transparent',
                color: activeLook === 'basic' ? '#fff' : 'var(--text-faint)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                textAlign: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0
              }}
              title="Basic"
            >
              Basic
            </button>
            <button
              type="button"
              onClick={() => handleSetLook('minimal')}
              aria-pressed={activeLook === 'minimal'}
              style={{
                padding: '5px 2px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '6px',
                border: activeLook === 'minimal' ? '1px solid var(--accent)' : '1px solid transparent',
                background: activeLook === 'minimal' ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'transparent',
                color: activeLook === 'minimal' ? '#fff' : 'var(--text-faint)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                textAlign: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0
              }}
              title="Minimal"
            >
              Minimal
            </button>
            <button
              type="button"
              onClick={() => handleSetLook('new-cosmic')}
              aria-pressed={activeLook === 'new-cosmic'}
              style={{
                padding: '5px 2px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '6px',
                border: activeLook === 'new-cosmic' ? '1px solid var(--accent)' : '1px solid transparent',
                background: activeLook === 'new-cosmic' ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'transparent',
                color: activeLook === 'new-cosmic' ? '#fff' : 'var(--text-faint)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                textAlign: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0
              }}
              title="Cosmic"
            >
              Cosmic
            </button>
            <button
              type="button"
              onClick={() => handleSetLook('ancient')}
              aria-pressed={activeLook === 'ancient'}
              style={{
                padding: '5px 2px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '6px',
                border: activeLook === 'ancient' ? '1px solid var(--accent)' : '1px solid transparent',
                background: activeLook === 'ancient' ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'transparent',
                color: activeLook === 'ancient' ? '#fff' : 'var(--text-faint)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                textAlign: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0
              }}
              title="Ancient"
            >
              Ancient
            </button>
          </div>
        ) : null}
      </div>

      {/* Google Email Input (when enabled in settings, available across all looks) */}
      {showGoogleEmailInputInSidebar ? (
        <div style={{ padding: '6px 10px 4px' }}>
          <label className="field-label" htmlFor="google-email">
            Google email
          </label>
          <input
            id="google-email"
            className="field-input"
            type="email"
            placeholder="name@gmail.com"
            value={email}
            disabled={googleBusy}
            onChange={(e) => onEmailChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onAddGoogle()
            }}
          />
          <button
            type="button"
            className="btn primary block btn-apply"
            disabled={googleBusy}
            onClick={onAddGoogle}
            aria-label="Continue with Google"
          >
            {googleBusy ? 'Signing in…' : 'Continue with Google'}
          </button>
          {googleBusy ? (
            <button type="button" className="btn secondary block" onClick={onCancelGoogle}>
              Cancel sign-in
            </button>
          ) : null}
        </div>
      ) : null}

      {activeLook === 'new-cosmic' ? (
        <CosmicSidebarContent
          profiles={profiles}
          showSidebarProfileNavButton={showSidebarProfileNavButton}
          showSidebarDashboardNavButton={showSidebarDashboardNavButton}
          showCosmicProfileNavButtons={showCosmicProfileNavButtons}
          onOpenProfilesHub={onOpenProfilesHub}
          onNewProject={onNewProject}
        />
      ) : activeLook === 'minimal' ? (
        <CosmicSidebarContent
          isMinimalLook
          profiles={profiles}
          showSidebarProfileNavButton={showSidebarProfileNavButton}
          showSidebarDashboardNavButton={showSidebarDashboardNavButton}
          showCosmicProfileNavButtons={showCosmicProfileNavButtons}
          onOpenProfilesHub={onOpenProfilesHub}
          onNewProject={onNewProject}
        />
      ) : activeLook === 'basic' ? (
        <>
          {showRecentSection && visibleRecents.length > 0 ? (
            <div className="recent-strip" aria-label="Recent workspaces">
              <div className="recent-strip-head">
                <p className="recent-label">Recent</p>
              </div>
              <ul className="recent-list">
                {visibleRecents.map((r) => {
                  const profile = profiles.find((p) => p.id === r.profileId)
                  const profileName = profile ? profileDisplayLabel(profile) : 'Profile'
                  const app = APP_IDS.includes(r.appId as AppId) ? (r.appId as AppId) : null
                  const live =
                    app && profile
                      ? profile.apps[app].availableWorkspaces.find((w) => w.teamId === r.teamId)
                      : undefined
                  const pinned =
                    app && profile
                      ? profile.apps[app].pinnedWorkspaces.find((w) => w.teamId === r.teamId)
                      : undefined
                  const title =
                    live?.lastChannelName?.trim() ||
                    (live ? displayWorkspaceName(live) : null) ||
                    (pinned ? displayWorkspaceName(pinned) : null) ||
                    r.label?.trim() ||
                    'Workspace'
                  return (
                    <li key={`basic-recent:${r.profileId}:${r.appId}:${r.teamId}:${r.at}`}>
                      <button
                        type="button"
                        className="recent-item"
                        onClick={() => {
                          if (app) {
                            onOpenWorkspace(r.profileId, app, r.teamId)
                          }
                        }}
                      >
                        {app ? (
                          <span className="recent-app-chip" aria-hidden>
                            <AppIcon appId={app} className="recent-app-icon" size={11} />
                          </span>
                        ) : (
                          <span className="ws-avatar recent-avatar" aria-hidden>
                            {monogramFromLabel(title)}
                          </span>
                        )}
                        <span className="ws-copy">
                          <span className="ws-title">{title}</span>
                          <span className="ws-sub">
                            {profileName}
                            {app ? ` · ${sidebarAppLabel(app)}` : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
          <BasicSidebarProjectTree
            baseAppLayout={baseAppLayout}
            onNewProject={onNewProject}
            onToast={onToast}
          />
        </>
      ) : (
        dashboardSlot
      )}

      {/* When NOT in Cosmic managed middle (All Projects or Profile selected), render the full global sidebar rules (Recent, Google email, profile tree) */}
      {!isCosmicManagedMiddle && (
        <>
          {showRecentSection && visibleRecents.length > 0 ? (
        <div className="recent-strip" aria-label="Recent workspaces">
          <div className="recent-strip-head">
            <p className="recent-label">Recent</p>
          </div>
          <ul className="recent-list">
            {visibleRecents.map((r) => {
              const profile = profiles.find((p) => p.id === r.profileId)
              const profileName = profile ? profileDisplayLabel(profile) : 'Profile'
              const app = APP_IDS.includes(r.appId as AppId) ? (r.appId as AppId) : null
              const live =
                app && profile
                  ? profile.apps[app].availableWorkspaces.find((w) => w.teamId === r.teamId)
                  : undefined
              const pinned =
                app && profile
                  ? profile.apps[app].pinnedWorkspaces.find((w) => w.teamId === r.teamId)
                  : undefined
              const title =
                live?.lastChannelName?.trim() ||
                (live ? displayWorkspaceName(live) : null) ||
                (pinned ? displayWorkspaceName(pinned) : null) ||
                r.label?.trim() ||
                'Workspace'
              return (
                <li key={`${r.profileId}:${r.appId}:${r.teamId}:${r.at}`}>
                  <button
                    type="button"
                    className="recent-item"
                    onClick={() => {
                      // Opening the workspace already activates its profile/app;
                      // a second onSelect here races it and can clear activeAppId.
                      if (app) {
                        onOpenWorkspace(r.profileId, app, r.teamId)
                      }
                    }}
                  >
                    {app ? (
                      <span className="recent-app-chip" aria-hidden>
                        <AppIcon appId={app} className="recent-app-icon" size={11} />
                      </span>
                    ) : (
                      <span className="ws-avatar recent-avatar" aria-hidden>
                        {monogramFromLabel(title)}
                      </span>
                    )}
                    <span className="ws-copy">
                      <span className="ws-title">{title}</span>
                      <span className="ws-sub">
                        {profileName}
                        {app ? ` · ${sidebarAppLabel(app)}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}


      <ul className="nav-tree">
        {profiles.length === 0 ? (
          <li className="empty-hint">No profiles yet.</li>
        ) : (
          profiles
            .filter((p) => !p.hiddenInSidebar)
            .map((profile) => {
            const profileOpen = isProfileOpen(profile.id)
            const profileActive = profile.id === activeProfileId
            const label = profileDisplayLabel(profile)

            return (
              <li
                key={profile.id}
                className={`nav-profile${profileActive ? ' is-active' : ''}${profileOpen ? ' is-open' : ''}${profile.muted ? ' is-muted' : ''}`}
                draggable
                onDragStart={() => setDragId(profile.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (!dragId || dragId === profile.id) return
                  const ids = profiles.map((p) => p.id)
                  const from = ids.indexOf(dragId)
                  const to = ids.indexOf(profile.id)
                  if (from < 0 || to < 0) return
                  const next = [...ids]
                  next.splice(from, 1)
                  next.splice(to, 0, dragId)
                  onReorder(next)
                  setDragId(null)
                }}
                onDragEnd={() => setDragId(null)}
              >
                <div className="nav-profile-row">
                  {renamingId === profile.id ? (
                    <input
                      className="nav-rename-input"
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(profile.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(profile.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="nav-profile-select"
                      onClick={() => {
                        setProfileExpanded((prev) => ({ ...prev, [profile.id]: !profileOpen }))
                        onSelect(profile.id)
                      }}
                      onDoubleClick={() => {
                        setRenamingId(profile.id)
                        setRenameValue(profile.customName ?? profile.displayName)
                      }}
                      title="Double-click to rename · drag to reorder"
                    >
                      <span className="nav-disclosure" aria-hidden>
                        {profileOpen ? '▼' : '▶'}
                      </span>
                      <span className="nav-profile-name">{label}</span>
                      {(profile.isGlobalProfile || profile.id === 'global-account-profile') && (
                        <span
                          style={{
                            fontSize: '9.5px',
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: '4px',
                            background: 'rgba(99, 102, 241, 0.2)',
                            color: '#a5b4fc',
                            border: '1px solid rgba(99, 102, 241, 0.35)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em'
                          }}
                        >
                          Global
                        </span>
                      )}
                      <ProfileAuthMark googleAuthStatus={profile.googleAuthStatus} />
                      {profile.muted ? (
                        <span
                          className="mute-mark"
                          title="Desktop notifications muted for this profile"
                        >
                          muted
                        </span>
                      ) : null}
                      {formatUnreadBadge(profileUnread(profile.id)) ? (
                        <span className="unread-badge" aria-label="Unread">
                          {formatUnreadBadge(profileUnread(profile.id))}
                        </span>
                      ) : null}
                    </button>
                  )}
                  {showSidebarItemActions && showSidebarProfileHideButton && (
                    <button
                      type="button"
                      className="nav-mute"
                      onClick={async (e) => {
                        e.stopPropagation()
                        try {
                          const updated = await window.api.profiles.setHiddenInSidebar(profile.id, true)
                          useProfileStore.setState((prev) => ({
                            profiles: prev.profiles.map((p) => (p.id === updated.id ? updated : p))
                          }))
                        } catch (err) {
                          console.error('Failed to hide profile', err)
                        }
                      }}
                      title="Hide profile from sidebar"
                      aria-label={`Hide ${label} from sidebar`}
                      style={{ fontSize: '11px', padding: '0 4px', opacity: 0.65 }}
                    >
                      👁
                    </button>
                  )}
                  <button
                    type="button"
                    className={`nav-mute${profile.muted ? ' is-muted' : ''}`}
                    onClick={() => onToggleMute(profile.id, !profile.muted)}
                    title={
                      profile.muted
                        ? 'Unmute — allow desktop notifications for this profile'
                        : 'Mute — silence desktop notifications for this profile'
                    }
                    aria-pressed={profile.muted}
                    aria-label={profile.muted ? 'Unmute notifications' : 'Mute notifications'}
                  >
                    {profile.muted ? 'Muted' : 'Mute'}
                  </button>
                  <button
                    type="button"
                    className="nav-delete"
                    onClick={() => onDelete(profile.id)}
                    title="Delete profile"
                    aria-label={`Delete ${label}`}
                  >
                    ×
                  </button>
                </div>

                {profileOpen ? (
                  <ul className="nav-apps">
                    {APP_IDS.filter((appId) => {
                      if (baseAppLayout === 'none') {
                        // In Option 0 (None): show only if actively signed in or has workspaces
                        const session = profile.apps[appId]
                        return session.sessionStatus === 'signed-in' || (session.availableWorkspaces?.length ?? 0) > 0
                      }
                      return true
                    }).map((appId) => {
                      const session = profile.apps[appId]
                      const appOpen = isAppOpen(profile.id, appId)
                      const appActive = profileActive && activeAppId === appId
                      const signedIn = session.sessionStatus === 'signed-in'
                      const supportsWorkspaces = appSupportsWorkspaces(appId)

                      return (
                        <li
                          key={appId}
                          className={`nav-app${appActive ? ' is-active' : ''}${appOpen ? ' is-open' : ''}`}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            onOpenInSplit(profile.id, appId)
                          }}
                        >
                          <div className="nav-app-row">
                            <button
                              type="button"
                              className="nav-app-select"
                              onClick={() => {
                                onSelectApp(profile.id, appId)
                                if (signedIn && supportsWorkspaces) {
                                  setAppExpanded((prev) => ({
                                    ...prev,
                                    [`${profile.id}:${appId}`]: true
                                  }))
                                }
                              }}
                              title="Right-click: open in split"
                            >
                              <AppIcon appId={appId} className="nav-app-icon" size={12} />
                              <span className="nav-app-label">{sidebarAppLabel(appId)}</span>
                              <AppStatusMark status={session.sessionStatus} />
                              {(() => {
                                const st = platformStatusDot(session.sessionStatus)
                                return (
                                  <span
                                    className={`platform-status-dot platform-status-${st.kind}`}
                                    title={st.label}
                                    aria-label={st.label}
                                  />
                                )
                              })()}
                              {formatUnreadBadge(unreadCounts[unreadKey(profile.id, appId)] ?? 0) ? (
                                <span className="unread-badge" aria-label="Unread">
                                  {formatUnreadBadge(unreadCounts[unreadKey(profile.id, appId)] ?? 0)}
                                </span>
                              ) : null}
                            </button>
                          </div>

                          {appOpen && signedIn && supportsWorkspaces ? (
                            <WorkspaceBranch
                              profileId={profile.id}
                              appId={appId}
                              session={session}
                              selectedTeamId={appActive ? selectedTeamId : null}
                              onOpenWorkspace={onOpenWorkspace}
                              onPin={onPinFromAvailable}
                              onUnpin={onUnpin}
                            />
                          ) : null}
                        </li>
                      )
                    })}

                    {/* Dynamic Base Preset Tools (e.g. Claude, ChatGPT) when extended/full layout is active */}
                    {presetToolLinks.map((preset) => {
                      const isLinkActive =
                        profileActive && activeCustomLinkId === `preset:${preset.id}`

                      return (
                        <li
                          key={`preset:${preset.id}`}
                          className={`nav-app${isLinkActive ? ' is-active' : ''}`}
                          style={{ position: 'relative' }}
                        >
                          <div className="nav-app-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '4px' }}>
                            <button
                              type="button"
                              className="nav-app-select"
                              onClick={() => {
                                onSelect(profile.id)
                                onSelectCustomLink?.(profile.id, {
                                  id: `preset:${preset.id}`,
                                  name: preset.name,
                                  url: preset.url!,
                                  order: 0,
                                  partition: `persist:profile-${profile.id}-link-preset-${preset.id}`,
                                  createdAt: ''
                                })
                              }}
                              title={`Open ${preset.name} (${preset.url})`}
                              style={{ flex: 1, minWidth: 0 }}
                            >
                              <span
                                style={{
                                  fontSize: '0.82rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '16px',
                                  marginRight: '2px'
                                }}
                              >
                                {preset.icon || '🌐'}
                              </span>
                              <span className="nav-app-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {preset.name}
                              </span>
                            </button>
                          </div>
                        </li>
                      )
                    })}

                    {/* Custom Links Rows - strictly for Global Account Profiles */}
                    {isGlobalAccountProfile(profile) && (profile.customLinks ?? [])
                      .filter((link) => !link.hiddenInSidebar)
                      .map((link) => {
                        const isLinkActive =
                          profileActive && activeCustomLinkId === link.id

                        return (
                          <li
                            key={link.id}
                            className={`nav-app${isLinkActive ? ' is-active' : ''}`}
                            style={{ position: 'relative' }}
                          >
                            <div className="nav-app-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '4px' }}>
                              <button
                                type="button"
                                className="nav-app-select"
                                onClick={() => {
                                  onSelect(profile.id)
                                  onSelectCustomLink?.(profile.id, link)
                                }}
                                title={`Open ${link.name} (${link.url})`}
                                style={{ flex: 1, minWidth: 0 }}
                              >
                                <span
                                  style={{
                                    fontSize: '0.82rem',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '16px',
                                    marginRight: '2px'
                                  }}
                                >
                                  🌐
                                </span>
                                <span className="nav-app-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {link.name}
                                </span>
                              </button>

                              {/* Hover / Direct Actions: Hide (👁) and Remove (✕) */}
                              {showSidebarItemActions && (
                                <div className="nav-item-actions" style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                  <button
                                    type="button"
                                    onClick={async (e) => {
                                      e.stopPropagation()
                                      try {
                                        const updated = await window.api.profiles.setLinkHiddenInSidebar(profile.id, link.id, true)
                                        useProfileStore.setState((prev) => ({
                                          profiles: prev.profiles.map((p) => (p.id === updated.id ? updated : p))
                                        }))
                                      } catch (err) {
                                        console.error('Failed to hide link', err)
                                      }
                                    }}
                                    title="Hide from sidebar"
                                    aria-label={`Hide ${link.name}`}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      color: '#94a3b8',
                                      fontSize: '11px',
                                      padding: '2px 4px',
                                      borderRadius: '3px'
                                    }}
                                  >
                                    👁
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async (e) => {
                                      e.stopPropagation()
                                      try {
                                        const updated = await window.api.profiles.removeCustomLink(profile.id, link.id)
                                        useProfileStore.setState((prev) => ({
                                          profiles: prev.profiles.map((p) => (p.id === updated.id ? updated : p))
                                        }))
                                      } catch (err) {
                                        console.error('Failed to remove link', err)
                                      }
                                    }}
                                    title="Remove website link"
                                    aria-label={`Remove ${link.name}`}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      color: '#94a3b8',
                                      fontSize: '13px',
                                      lineHeight: 1,
                                      padding: '2px 4px',
                                      borderRadius: '3px'
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              )}
                            </div>
                          </li>
                        )
                      })}
                  </ul>
                ) : null}
              </li>
            )
          })
        )}
      </ul>
      </>
      )}

      {/* Permanent Bottom Actions Container — Pinned at the very bottom across all looks */}
      <div
        className="sidebar-bottom-actions-pinned"
        style={{
          marginTop: 'auto',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          flexShrink: 0
        }}
      >
        {/* Observer View Header — shown only when enabled in Settings */}
        {showObserverViewHeader && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 4px 2px',
              marginTop: '6px',
              userSelect: 'none'
            }}
            aria-label="Observer View section"
          >
            <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />
            <span
              style={{
                fontSize: '9.5px',
                fontWeight: 700,
                color: '#64748b',
                letterSpacing: '0.08em',
                textTransform: 'uppercase'
              }}
            >
              Observer View
            </span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />
          </div>
        )}

        <div className="nav-action-compact-container">
          {/* Configurable Action: + Website */}
          {Boolean(sidebarButtons.addWebsite) ? (
            <button
              type="button"
              className="nav-action-compact-btn nav-btn-prominent"
              onClick={onAddPlatform}
              title="Add Website or Web Platform"
              aria-label="Add Website"
            >
              <span className="nav-btn-icon" style={{ fontSize: '14px' }}>🌐</span>
              <span className="nav-btn-text" style={{ fontWeight: 650 }}>+ Website</span>
            </button>
          ) : null}

          {/* Configurable Action: + Project */}
          {Boolean(sidebarButtons.newProject) && onNewProject ? (
            <button
              type="button"
              className="nav-action-compact-btn"
              onClick={onNewProject}
              title="Create New Project / Workspace"
              aria-label="New Project"
            >
              <span className="nav-btn-icon">📁</span>
              <span className="nav-btn-text">+ Project</span>
            </button>
          ) : null}

          {/* Configurable Action: + Profile */}
          {Boolean(sidebarButtons.newProfile) && onNewProfile ? (
            <button
              type="button"
              className="nav-action-compact-btn"
              onClick={onNewProfile}
              title="Create New Profile / Account"
              aria-label="New Profile"
            >
              <span className="nav-btn-icon">👤</span>
              <span className="nav-btn-text">+ Profile</span>
            </button>
          ) : null}

          {/* Permanent Action: ⚙️ Settings */}
          <button
            type="button"
            className="nav-action-compact-btn nav-settings-btn"
            onClick={onOpenAccountsSettings}
            title="Global Settings Hub"
            aria-label="Settings"
          >
            <span className="nav-btn-icon">⚙️</span>
            <span className="nav-btn-text">Settings</span>
          </button>

          {/* Configurable Action: 🔭 Observer */}
          {Boolean(sidebarButtons.observer) && onObserver ? (
            <button
              type="button"
              className="nav-action-compact-btn"
              onClick={onObserver}
              title="Observer Mode &amp; Channels"
              aria-label="Observer"
            >
              <span className="nav-btn-icon">🔭</span>
              <span className="nav-btn-text">Observer</span>
            </button>
          ) : null}

          {/* Configurable Action: 👥 Profiles */}
          {Boolean(sidebarButtons.profilesHub) ? (
            <button
              type="button"
              className="nav-action-compact-btn"
              onClick={onOpenProfilesHub || onOpenAccountsSettings}
              title="Profiles &amp; Accounts Management"
              aria-label="Profiles"
            >
              <span className="nav-btn-icon">👥</span>
              <span className="nav-btn-text">Profiles</span>
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  )
})
