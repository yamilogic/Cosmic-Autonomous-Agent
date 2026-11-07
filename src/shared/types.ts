/**
 * Multi-app profile model: each profile hosts Slack + Teams + WhatsApp sessions.
 * Browser cookies live in persist:profile-<id>-<appId> partitions.
 */

export type AppId = 'slack' | 'teams' | 'whatsapp'

export const APP_IDS: readonly AppId[] = ['slack', 'teams', 'whatsapp'] as const

/** Slack browser-session login phases (Google → Slack SSO). */
export type SlackSessionStatus =
  'not-signed-in' | 'signing-in-google' | 'signing-in-slack' | 'signed-in'

/** Teams browser-session login phases (Microsoft identity). */
export type TeamsSessionStatus = 'not-signed-in' | 'signing-in' | 'signed-in'

/** WhatsApp Web login phases (QR link on phone). */
export type WhatsAppSessionStatus = 'not-signed-in' | 'signing-in' | 'signed-in'

export type AppSessionStatus = SlackSessionStatus | TeamsSessionStatus | WhatsAppSessionStatus

/** @deprecated Use SlackSessionStatus / AppSessionStatus — kept for migration helpers. */
export type ProfileSessionStatus = SlackSessionStatus

/** Workspace/org this app session can open (synced / captured). */
export interface AvailableWorkspace {
  teamId: string
  teamName: string
  openUrl: string
  teamDomain?: string
  lastSeenAt: string
  /** Last Slack channel/DM title seen in this workspace (sidebar + recents). */
  lastChannelName?: string
}

/** Pinned subset of availableWorkspaces — quick switcher only. */
export interface PinnedWorkspace {
  teamId: string
  teamName: string
  openUrl: string
  teamDomain?: string
}

/** Candidate scraped from an embed before id is confirmed. */
export interface DiscoveredWorkspace {
  teamId: string | null
  teamName: string
  openUrl: string
  teamDomain?: string
}

export interface AppSession {
  sessionStatus: AppSessionStatus
  availableWorkspaces: AvailableWorkspace[]
  pinnedWorkspaces: PinnedWorkspace[]
}

export interface ProfileApps {
  slack: AppSession
  teams: AppSession
  whatsapp: AppSession
}

export interface CustomLink {
  id: string
  name: string
  url: string
  order: number
  createdAt: string
  partition: string
  hiddenInSidebar?: boolean
}

export const GLOBAL_PROFILE_ID = 'global-account-profile'

export type ProfileScope = 'global' | 'individual' | 'both' | 'observer'

export interface Profile {
  id: string
  displayName: string
  /** Optional friendly label; UI prefers this over displayName (email). */
  customName?: string
  /** Scope of profile: global (main sidebar & shared pool) vs individual (filtered in dashboard projects) vs both */
  accountScope?: ProfileScope
  createdAt: string
  avatarColor: string
  /** Optional photo URL (e.g. captured after Google/Slack sign-in). */
  avatarUrl?: string
  /** Lower sorts first; missing treated as large. */
  sortOrder?: number
  /** When true, skip tray/desktop notifications for this profile. */
  muted?: boolean
  /** When true, hide profile row from left sidebar */
  hiddenInSidebar?: boolean
  /** When true, indicates this is a Global Account aggregator profile */
  isGlobalProfile?: boolean
  /**
   * Google account cookies ready (Chrome password + 2SV).
   * App logins (Slack/Teams) happen separately after the user picks an app.
   */
  googleAuthStatus: 'not-signed-in' | 'signing-in' | 'signed-in'
  apps: ProfileApps
  customLinks?: CustomLink[]
}

export function profileDisplayLabel(profile: Profile): string {
  const custom = profile.customName?.trim()
  return custom || profile.displayName
}

/** Strictly check if a profile is a Global Company Account */
export function isGlobalAccountProfile(profile: Profile): boolean {
  if (profile.id === GLOBAL_PROFILE_ID || profile.isGlobalProfile === true) return true
  const scope = profile.accountScope
  if (scope === 'global' || scope === 'both') return true
  // Any profile visible in the main sidebar (hiddenInSidebar !== true) and not explicitly marked individual is Global
  if (profile.hiddenInSidebar !== true && scope !== 'individual') return true
  return false
}

/** Strictly check if a profile is an Individual Profile */
export function isIndividualProfile(profile: Profile): boolean {
  const scope = profile.accountScope
  if (scope === 'both') return true
  if (scope === 'individual') return true
  if (profile.hiddenInSidebar === true && scope !== 'global' && scope !== 'observer') return true
  return false
}

export interface ProfileSessionStatusPayload {
  profileId: string
  appId: AppId
  sessionStatus: AppSessionStatus
}

export interface SlackWorkspaceLink {
  profileId: string
  teamId: string
  teamName: string
  teamDomain: string
  connectedAt: string
  scopes: string[]
}

export interface SlackChannelSummary {
  id: string
  name: string
  isPrivate: boolean
  topic?: string
  created?: number
  memberCount?: number
}

export interface SlackMessageSummary {
  ts: string
  user?: string
  text: string
}

export interface CreateProfileInput {
  displayName: string
}

export interface ProfileIdPayload {
  profileId: string
  deleteCards?: boolean
}

export interface AppScopedPayload {
  profileId: string
  appId: AppId
}

export interface WorkspacePayload {
  profileId: string
  teamId: string
}

export interface PinFromAvailablePayload {
  profileId: string
  appId: AppId
  teamId: string
}

export interface UnpinWorkspacePayload {
  profileId: string
  appId: AppId
  teamId: string
}

export interface SyncWorkspacesPayload {
  profileId: string
  appId: AppId
  bounds: ViewportBounds
}

export interface OpenWorkspacePayload {
  profileId: string
  appId: AppId
  teamId: string
  bounds: ViewportBounds
}

export interface StartAppLoginPayload {
  profileId: string
  appId: AppId
  /** Required for embed-first login so the right-pane view can be shown. */
  bounds?: ViewportBounds
}

export interface StartGoogleAuthPayload {
  profileId: string
  /** Right-pane bounds so Google sign-in loads in the main embed. */
  bounds?: ViewportBounds
}

export interface ActivateAppPayload {
  profileId: string
  appId: AppId
  bounds: ViewportBounds
}

export interface ChannelHistoryPayload {
  profileId: string
  teamId: string
  channelId: string
  limit?: number
}

export interface ViewportBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ActivateProfilePayload {
  profileId: string
  bounds: ViewportBounds
}

export interface CurrentWorkspaceInfo {
  profileId: string
  appId: AppId
  teamId: string
  url: string
}

export interface WorkspaceThemePayload {
  profileId: string
  appId: AppId | 'default'
  teamId?: string
  /** Primary accent (buttons, highlights) */
  accent: string
  /** Sidebar surface tint */
  sidebar: string
  /** Detected Slack (or app) chrome luminance */
  mode?: 'light' | 'dark'
}

export function emptySlackSession(): AppSession {
  return {
    sessionStatus: 'not-signed-in',
    availableWorkspaces: [],
    pinnedWorkspaces: []
  }
}

export function emptyTeamsSession(): AppSession {
  return {
    sessionStatus: 'not-signed-in',
    availableWorkspaces: [],
    pinnedWorkspaces: []
  }
}

export function emptyWhatsAppSession(): AppSession {
  return {
    sessionStatus: 'not-signed-in',
    availableWorkspaces: [],
    pinnedWorkspaces: []
  }
}

export function emptyProfileApps(): ProfileApps {
  return {
    slack: emptySlackSession(),
    teams: emptyTeamsSession(),
    whatsapp: emptyWhatsAppSession()
  }
}

export function appLabel(appId: AppId): string {
  if (appId === 'slack') {
    return 'Slack'
  }
  if (appId === 'teams') {
    return 'Teams'
  }
  return 'WhatsApp'
}

/** Cleans up raw titles or legacy captured strings like "channel (Channel) - Workspace" into a clean workspace name. */
export function sanitizeWorkspaceName(raw?: string): string {
  if (!raw) return ''
  let cleaned = raw.replace(/\s+/g, ' ').trim()
  // Reject notification/badge patterns
  if (/\d+\s+new\s+items?/i.test(cleaned) || /^new\s+item/i.test(cleaned) || /^\(\d+\)/.test(cleaned)) {
    return ''
  }
  // Strip trailing " | Slack" or " - Slack"
  cleaned = cleaned.replace(/\s*[|—–-]\s*Slack\s*$/i, '').trim()
  // Strip Slack channel prefix pattern: "channel (Channel) - WorkspaceName" or "#channel - WorkspaceName"
  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ')
    cleaned = parts[parts.length - 1]!.trim()
  } else if (cleaned.includes(' | ')) {
    const parts = cleaned.split(' | ')
    cleaned = parts[parts.length - 1]!.trim()
  }
  return cleaned
}

export function sidebarAppLabel(appId: AppId): string {
  return appLabel(appId)
}

/** WhatsApp has a single Web session — no workspace tree. */
export function appSupportsWorkspaces(appId: AppId): boolean {
  return appId === 'slack' || appId === 'teams'
}

/** Workspace → cards mapping (persisted in workspace-mappings.json). */
export interface WorkspaceMapping {
  workspaceId: string
  projectIds: string[]
  updatedAt: string
}
