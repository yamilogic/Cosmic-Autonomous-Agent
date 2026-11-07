import { WebContentsView, app, session, type BrowserWindow, type Rectangle } from 'electron'
import { join } from 'node:path'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import type { AppId, AvailableWorkspace, DiscoveredWorkspace } from '../../shared/types'
import {
  isSlackPlaceholderName,
  parseSlackClientPath,
  parseSlackTeamDomain,
  parseTeamIdFromSlackClientUrl,
  resolvePinnedOpenUrl,
  slackClientUrlForConversation,
  slackClientUrlForTeam
} from '../../shared/slack-url'
import { log } from '../logging'
import {
  canonicalizeTeamsWorkspaceId,
  DISCOVER_TEAMS_WORKSPACES_SCRIPT,
  DISCOVER_WORKSPACES_SCRIPT,
  isTeamsPersonalTenantId,
  normalizeDiscoveredWorkspaces,
  normalizeTeamsDiscoveredWorkspaces,
  READ_SLACK_CONTEXT_SCRIPT,
  READ_SLACK_WORKSPACE_NAME_SCRIPT,
  READ_TEAMS_ORG_NAME_SCRIPT
} from './discover-workspaces'
import { SAMPLE_SLACK_THEME_SCRIPT } from './theme-sample'
import type { WorkspaceThemePayload } from '../../shared/types'
import {
  applySlackWebContentsTweaks,
  applyTeamsWebContentsTweaks,
  applyWhatsAppWebContentsTweaks,
  homeUrlForApp,
  injectHideDmCss,
  isMicrosoftSignedOutUrl,
  isTeamsSignedInUrl,
  normalizeTeamsOpenUrl,
  partitionForProfile,
  partitionForCard,
  profileSessionWebPreferences,
  cardSessionWebPreferences,
  SLACK_CLIENT_URL,
  TEAMS_HOME_URL,
  WHATSAPP_WEB_URL
} from './session-partition'
import { parseUnreadFromTitle, READ_PAGE_UNREAD_SCRIPT, unreadKey } from './unread-from-title'
import { syncGoogleSessionFromProfileToCard } from './google-session-sync'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safeHostname(urlString: string): string {
  try {
    return new URL(urlString).hostname
  } catch {
    return ''
  }
}

export function viewKey(profileId: string, appId: AppId): string {
  return `${profileId}:${appId}`
}

export function cardViewKey(projectId: string, appId: AppId): string {
  return `card:${projectId}:${appId}`
}

export function customLinkKey(profileId: string, linkId: string): string {
  return `link:${profileId}:${linkId}`
}

export type WorkspaceSeenHandler = (
  profileId: string,
  appId: AppId,
  workspace: {
    teamId: string
    teamName: string
    openUrl: string
    teamDomain?: string
    lastChannelName?: string
  }
) => void | Promise<void>

export type CardWorkspaceSeenHandler = (
  projectId: string,
  appId: AppId,
  workspace: {
    teamId: string
    teamName: string
    openUrl: string
    teamDomain?: string
    lastChannelName?: string
  }
) => void | Promise<void>

/**
 * One WebContentsView per profile+app. Switching attaches/detaches — never reloads.
 */
export class BrowserViewManager {
  private readonly views = new Map<string, WebContentsView>()
  private activeKey: string | null = null
  private secondaryKey: string | null = null
  private cardEmbedKey: string | null = null
  private cardEmbedBounds: Rectangle | null = null
  private lastBounds: Rectangle | null = null
  private secondaryBounds: Rectangle | null = null
  private embedHidden = false
  private workspaceSeenHandler: WorkspaceSeenHandler | null = null
  private cardWorkspaceSeenHandler: CardWorkspaceSeenHandler | null = null
  private themeHandler: ((payload: WorkspaceThemePayload) => void) | null = null
  private unreadHandler: ((counts: Record<string, number>) => void) | null = null
  private readonly unreadCounts = new Map<string, number>()
  private readonly captureWired = new Set<string>()
  private readonly unreadWired = new Set<string>()
  private unreadPollTimer: ReturnType<typeof setInterval> | null = null
  private unreadEmitTimer: ReturnType<typeof setTimeout> | null = null
  private activityHandler: (() => void) | null = null
  private readonly captureDebounce = new Map<string, ReturnType<typeof setTimeout>>()
  private themeSampleTimer: ReturnType<typeof setTimeout> | null = null
  private lastEmittedThemeKey: string | null = null

  setActivityHandler(handler: (() => void) | null): void {
    this.activityHandler = handler
  }

  getExistingView(profileId: string, appId: AppId): WebContentsView | null {
    return this.views.get(viewKey(profileId, appId)) ?? null
  }

  getExistingCardView(projectId: string, appId: AppId): WebContentsView | null {
    return this.views.get(cardViewKey(projectId, appId)) ?? null
  }

  noteActivity(): void {
    this.activityHandler?.()
  }

  setWorkspaceSeenHandler(handler: WorkspaceSeenHandler | null): void {
    this.workspaceSeenHandler = handler
  }

  setCardWorkspaceSeenHandler(handler: CardWorkspaceSeenHandler | null): void {
    this.cardWorkspaceSeenHandler = handler
  }

  setThemeHandler(handler: ((payload: WorkspaceThemePayload) => void) | null): void {
    this.themeHandler = handler
  }

  private unreadPollInFlight = false

  setUnreadHandler(handler: ((counts: Record<string, number>) => void) | null): void {
    this.unreadHandler = handler
    if (handler) {
      void this.pollAllUnread()
      this.emitUnread()
      if (!this.unreadPollTimer) {
        this.unreadPollTimer = setInterval(() => void this.pollAllUnread(), 2_000)
      }
    }
  }

  getUnreadCounts(): Record<string, number> {
    return Object.fromEntries(this.unreadCounts)
  }

  getActiveKey(): string | null {
    return this.activeKey
  }

  getSecondaryKey(): string | null {
    return this.secondaryKey
  }

  private emitUnread(): void {
    this.unreadHandler?.(this.getUnreadCounts())
  }

  private scheduleEmitUnread(): void {
    if (this.unreadEmitTimer) return
    this.unreadEmitTimer = setTimeout(() => {
      this.unreadEmitTimer = null
      this.emitUnread()
    }, 120)
  }

  private setUnread(profileId: string, appId: AppId, count: number, emit = true): boolean {
    const key = unreadKey(profileId, appId)
    const prev = this.unreadCounts.get(key) ?? 0
    const next = Math.max(0, count)
    if (prev === next) return false
    this.unreadCounts.set(key, next)
    if (emit) this.scheduleEmitUnread()
    return true
  }

  private async pollAllUnread(): Promise<void> {
    if (this.unreadPollInFlight) return
    this.unreadPollInFlight = true
    let changed = false
    try {
      for (const [key, view] of this.views) {
        if (view.webContents.isDestroyed()) continue
        // Ignore custom links
        if (key.startsWith('link:')) continue
        let profileId: string
        let appId: AppId

        if (key.startsWith('card:')) {
          // card:${projectId}:${appId}
          const parts = key.split(':')
          if (parts.length < 3) continue
          profileId = parts.slice(0, 2).join(':') // e.g. 'card:proj-123'
          appId = parts[2] as AppId
        } else {
          const sep = key.lastIndexOf(':')
          if (sep < 0) continue
          profileId = key.slice(0, sep)
          appId = key.slice(sep + 1) as AppId
        }
        if (!profileId || !appId) continue
        try {
          const title = view.webContents.getTitle()
          let count = parseUnreadFromTitle(title, appId)
          try {
            const fromPage = (await view.webContents.executeJavaScript(
              READ_PAGE_UNREAD_SCRIPT,
              true
            )) as unknown
            // -1 = channel sidebar not in DOM yet — keep title. Otherwise page is source of truth
            // so Slack's Activity/workspace "3" in the tab title cannot stick as unread.
            if (typeof fromPage === 'number' && fromPage >= 0) {
              count = fromPage
            }
          } catch {
            /* page may not be ready */
          }
          if (this.setUnread(profileId, appId, count, false)) {
            changed = true
          }
        } catch {
          /* ignore */
        }
      }
      if (changed) this.emitUnread()
    } finally {
      this.unreadPollInFlight = false
    }
  }

  private wireUnread(profileId: string, appId: AppId, view: WebContentsView): void {
    const key = viewKey(profileId, appId)
    if (this.unreadWired.has(key)) return
    this.unreadWired.add(key)
    const apply = (): void => {
      if (view.webContents.isDestroyed()) return
      void this.pollAllUnread()
    }
    view.webContents.on('page-title-updated', apply)
    view.webContents.on('did-finish-load', apply)
    view.webContents.on('dom-ready', apply)
    apply()
  }

  /**
   * Debounced Slack theme sample — runs at most once per activate burst.
   * Skips IPC when colors/mode are unchanged.
   */
  sampleAndEmitSlackTheme(profileId: string, teamId?: string): void {
    if (this.themeSampleTimer) {
      clearTimeout(this.themeSampleTimer)
      this.themeSampleTimer = null
    }
    this.themeSampleTimer = setTimeout(() => {
      this.themeSampleTimer = null
      void this.runSlackThemeSample(profileId, teamId)
    }, 450)
  }

  private async runSlackThemeSample(profileId: string, teamId?: string): Promise<void> {
    if (!this.themeHandler) return
    const view = this.views.get(viewKey(profileId, 'slack'))
    if (!view || view.webContents.isDestroyed()) return
    // Only sample when this Slack view is the active embed.
    if (this.activeKey !== viewKey(profileId, 'slack')) return

    try {
      const raw = (await view.webContents.executeJavaScript(SAMPLE_SLACK_THEME_SCRIPT, true)) as {
        accent?: string
        sidebar?: string
        mode?: string
      }
      const accentRaw =
        typeof raw?.accent === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accent)
          ? raw.accent
          : '#7a6b8a'
      const sidebarRaw =
        typeof raw?.sidebar === 'string' && /^#[0-9a-f]{6}$/i.test(raw.sidebar)
          ? raw.sidebar
          : '#1a1820'
      const mode: 'light' | 'dark' = raw?.mode === 'light' ? 'light' : 'dark'

      const hexLum = (hex: string): number => {
        const r = Number.parseInt(hex.slice(1, 3), 16) / 255
        const g = Number.parseInt(hex.slice(3, 5), 16) / 255
        const b = Number.parseInt(hex.slice(5, 7), 16) / 255
        const f = (c: number): number =>
          c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      // Drop white / near-white leaks from Slack's main pane.
      const accent = hexLum(accentRaw) > 0.72 ? '#7a6b8a' : accentRaw
      const sidebar =
        hexLum(sidebarRaw) > 0.72 ? (mode === 'light' ? '#ebe6ef' : '#1a1820') : sidebarRaw
      const key = `${profileId}|${teamId ?? ''}|${accent}|${sidebar}|${mode}`
      if (key === this.lastEmittedThemeKey) return
      this.lastEmittedThemeKey = key
      this.themeHandler({
        profileId,
        appId: 'slack',
        teamId,
        accent,
        sidebar,
        mode
      })
      log.info('slack theme sampled', { profileId, teamId, accent, sidebar, mode })
    } catch (err) {
      log.warn('slack theme sample failed', { profileId, err: String(err) })
    }
  }

  emitDefaultTheme(profileId: string, appId: AppId | 'default' = 'default'): void {
    const payload: WorkspaceThemePayload =
      appId === 'teams'
        ? {
            profileId,
            appId,
            accent: '#6264a7',
            sidebar: '#1b1f3b',
            mode: 'dark'
          }
        : appId === 'whatsapp'
          ? {
              profileId,
              appId,
              accent: '#25d366',
              sidebar: '#111b21',
              mode: 'dark'
            }
          : appId === 'slack'
            ? {
                profileId,
                appId,
                accent: '#7a6b8a',
                sidebar: '#1a1820',
                mode: 'dark'
              }
            : {
                profileId,
                appId: 'default',
                accent: '#2bac76',
                sidebar: '#141a24'
              }
    const key = `${payload.appId}|${payload.accent}|${payload.sidebar}|${payload.mode ?? ''}`
    if (key === this.lastEmittedThemeKey) return
    this.lastEmittedThemeKey = key
    this.themeHandler?.(payload)
  }

  static partitionFor(profileId: string, appId: AppId = 'slack'): string {
    return partitionForProfile(profileId, appId)
  }

  static clientUrl(): string {
    return SLACK_CLIENT_URL
  }

  static teamsHomeUrl(): string {
    return TEAMS_HOME_URL
  }

  static whatsappWebUrl(): string {
    return WHATSAPP_WEB_URL
  }

  static workspaceClientUrl(teamId: string): string {
    return slackClientUrlForTeam(teamId)
  }

  getOrCreate(profileId: string, appId: AppId, options?: { deferLoad?: boolean }): WebContentsView {
    const key = viewKey(profileId, appId)
    const existing = this.views.get(key)
    if (existing) {
      return existing
    }

    const view = new WebContentsView({
      webPreferences: profileSessionWebPreferences(profileId, appId)
    })
    view.setBackgroundColor(appId === 'whatsapp' ? '#111B21' : '#0C0D11')

    view.webContents.setZoomFactor(1)

    if (appId === 'teams') {
      applyTeamsWebContentsTweaks(view.webContents)
    } else if (appId === 'whatsapp') {
      applyWhatsAppWebContentsTweaks(view.webContents)
    } else {
      applySlackWebContentsTweaks(view.webContents)
    }

    view.webContents.on('dom-ready', () => {
      if (appId === 'slack') {
        injectHideDmCss(view.webContents)
        // Title updates are handled via Electron page-title-updated — no in-page poll.
      }
    })

    this.wirePassiveCapture(profileId, appId, view)
    this.wireUnread(profileId, appId, view)

    if (!options?.deferLoad) {
      void view.webContents.loadURL(homeUrlForApp(appId))
    }
    this.views.set(key, view)
    log.info('browser view created', {
      profileId,
      appId,
      partition: partitionForProfile(profileId, appId),
      deferLoad: Boolean(options?.deferLoad)
    })
    return view
  }

  getOrCreateCardView(
    projectId: string,
    appId: AppId,
    options?: { deferLoad?: boolean }
  ): WebContentsView {
    const key = cardViewKey(projectId, appId)
    const existing = this.views.get(key)
    if (existing && !existing.webContents.isDestroyed()) {
      return existing
    }

    const webPrefs = cardSessionWebPreferences(projectId, appId)
    const view = new WebContentsView({
      webPreferences: {
        ...webPrefs,
        preload: join(__dirname, '../preload/index.js')
      }
    })
    view.setBackgroundColor(appId === 'whatsapp' ? '#111B21' : '#0C0D11')

    if (appId === 'teams') {
      applyTeamsWebContentsTweaks(view.webContents)
    } else if (appId === 'whatsapp') {
      applyWhatsAppWebContentsTweaks(view.webContents)
    } else {
      applySlackWebContentsTweaks(view.webContents)
    }

    this.wireCardPassiveCapture(projectId, appId, view)

    view.webContents.on('dom-ready', () => {
      if (appId === 'slack') {
        injectHideDmCss(view.webContents)
      }
    })

    if (!options?.deferLoad) {
      void view.webContents.loadURL(homeUrlForApp(appId))
    }
    this.views.set(key, view)
    log.info('card browser view created', {
      projectId,
      appId,
      partition: partitionForCard(projectId, appId),
      deferLoad: Boolean(options?.deferLoad)
    })
    return view
  }

  async navigateToWorkspace(
    profileId: string,
    appId: AppId,
    input: { teamId: string; openUrl?: string; teamDomain?: string; teamName?: string }
  ): Promise<string> {
    const view = this.getOrCreate(profileId, appId)
    const url =
      appId === 'slack'
        ? resolvePinnedOpenUrl(input)
        : normalizeTeamsOpenUrl(input.openUrl?.trim() || TEAMS_HOME_URL)

    await view.webContents.loadURL(url)

    if (appId === 'slack') {
      const landedTeamId = await this.waitForSlackTeamId(profileId, 15_000)
      if (!landedTeamId) {
        const label = input.teamName?.trim() || input.teamId
        throw new Error(
          `Slack did not open "${label}". Sync workspaces, or open it with Slack’s Open button first.`
        )
      }
      await this.emitWorkspaceSeen(profileId, appId)
      void this.sampleAndEmitSlackTheme(profileId, landedTeamId)
      return landedTeamId
    }

    const ok = await this.waitForTeamsLoggedIn(profileId, 15_000)
    if (!ok) {
      const label = input.teamName?.trim() || input.teamId
      throw new Error(
        `Teams did not open "${label}". Sign in to Teams first, then Sync workspaces.`
      )
    }
    await this.emitWorkspaceSeen(profileId, appId)
    this.emitDefaultTheme(profileId, 'teams')
    return input.teamId
  }

  async waitForSlackTeamId(profileId: string, timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const teamId = this.getCurrentTeamId(profileId, 'slack')
      if (teamId) {
        return teamId
      }
      await sleep(250)
    }
    return this.getCurrentTeamId(profileId, 'slack')
  }

  async waitForTeamsLoggedIn(profileId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const url = this.getCurrentUrl(profileId, 'teams')
      if (url && isTeamsSignedInUrl(url)) {
        return true
      }
      await sleep(250)
    }
    const url = this.getCurrentUrl(profileId, 'teams')
    return Boolean(url && isTeamsSignedInUrl(url))
  }

  /** After Microsoft login in the same partition, force embed back onto Teams app. */
  async ensureTeamsAppLoaded(profileId: string): Promise<void> {
    const view = this.getOrCreate(profileId, 'teams')
    if (view.webContents.isDestroyed()) {
      return
    }
    const url = view.webContents.getURL()
    if (!url || isMicrosoftSignedOutUrl(url) || !isTeamsSignedInUrl(url)) {
      log.info('reloading Teams embed after auth', { profileId, from: url?.slice(0, 120) })
      await view.webContents.loadURL(TEAMS_HOME_URL)
    }
  }

  async discoverWorkspaces(profileId: string, appId: AppId): Promise<DiscoveredWorkspace[]> {
    const view = this.views.get(viewKey(profileId, appId)) ?? this.getOrCreate(profileId, appId)
    if (view.webContents.isDestroyed()) {
      return []
    }
    try {
      const script =
        appId === 'teams' ? DISCOVER_TEAMS_WORKSPACES_SCRIPT : DISCOVER_WORKSPACES_SCRIPT
      const raw = await view.webContents.executeJavaScript(script, true)
      return appId === 'teams'
        ? normalizeTeamsDiscoveredWorkspaces(raw)
        : normalizeDiscoveredWorkspaces(raw)
    } catch (err) {
      log.warn('discover workspaces failed', { profileId, appId, err: String(err) })
      return []
    }
  }

  async syncWorkspaces(profileId: string, appId: AppId): Promise<AvailableWorkspace[]> {
    if (appId === 'whatsapp') {
      return []
    }
    const view = this.getOrCreate(profileId, appId)
    let candidates = await this.discoverWorkspaces(profileId, appId)

    if (candidates.length === 0) {
      try {
        await view.webContents.loadURL(homeUrlForApp(appId))
        await sleep(2000)
        candidates = await this.discoverWorkspaces(profileId, appId)
      } catch (err) {
        log.warn('sync bootstrap navigation failed', { profileId, appId, err: String(err) })
      }
    }

    const now = new Date().toISOString()
    const collected: AvailableWorkspace[] = []
    const seen = new Set<string>()

    for (const candidate of candidates) {
      try {
        let teamId = candidate.teamId
        let teamName = candidate.teamName
        const teamDomain = candidate.teamDomain
        let openUrl = candidate.openUrl

        if (appId === 'slack') {
          if (!teamId) {
            teamId = await this.navigateToWorkspace(profileId, appId, {
              teamId: teamDomain ? `domain:${teamDomain}` : 'pending',
              openUrl: candidate.openUrl,
              teamDomain,
              teamName: candidate.teamName
            })
            teamName = (await this.readPageTitle(profileId, appId)) || candidate.teamName || teamId
            const landed = this.getCurrentUrl(profileId, appId)
            const loc = landed ? parseSlackClientPath(landed) : null
            openUrl = slackClientUrlForConversation(teamId, loc?.conversationId)
          } else {
            const loc = parseSlackClientPath(candidate.openUrl || '')
            openUrl = slackClientUrlForConversation(teamId, loc?.conversationId)
          }
        } else {
          // Teams: only real tenants or a single personal home session — never hash random URLs.
          if (!teamId || (/^teams-/i.test(teamId) && teamId !== 'teams-home')) {
            continue
          }
          openUrl = normalizeTeamsOpenUrl(candidate.openUrl || TEAMS_HOME_URL)
          if (teamId === 'teams-home') {
            openUrl = TEAMS_HOME_URL
            const readName = await this.readPageTitle(profileId, appId)
            teamName =
              (readName && !/^microsoft teams$/i.test(readName) ? readName : null) ||
              (candidate.teamName && !/^microsoft teams$/i.test(candidate.teamName)
                ? candidate.teamName
                : null) ||
              'Personal'
          } else {
            try {
              await this.navigateToWorkspace(profileId, appId, {
                teamId,
                openUrl,
                teamName: candidate.teamName
              })
              const readName = await this.readPageTitle(profileId, appId)
              teamName =
                (readName && !/^microsoft teams$/i.test(readName) ? readName : null) ||
                (candidate.teamName && !/^microsoft teams$/i.test(candidate.teamName)
                  ? candidate.teamName
                  : null) ||
                `Org ${teamId.replace(/^tenant-/i, '').slice(0, 8)}`
              openUrl = this.getCurrentUrl(profileId, appId) || openUrl
            } catch {
              openUrl = candidate.openUrl || TEAMS_HOME_URL
              teamName =
                candidate.teamName && !/^microsoft teams$/i.test(candidate.teamName)
                  ? candidate.teamName
                  : `Org ${String(teamId)
                      .replace(/^tenant-/i, '')
                      .slice(0, 8)}`
            }
          }
        }

        if (!teamId || seen.has(teamId)) {
          continue
        }
        seen.add(teamId)
        collected.push({
          teamId,
          teamName: teamName || teamId,
          openUrl,
          lastSeenAt: now,
          ...(teamDomain ? { teamDomain } : {})
        })
      } catch (err) {
        log.warn('sync candidate failed', {
          profileId,
          appId,
          candidate: candidate.openUrl,
          err: String(err)
        })
      }
    }

    log.info('workspace sync finished', { profileId, appId, count: collected.length })
    return collected.map((ws) => {
      // Prefer human names over bare ids when we already have a better label elsewhere
      if (appId === 'slack' && ws.teamName === ws.teamId && ws.teamDomain) {
        return { ...ws, teamName: ws.teamDomain }
      }
      return ws
    })
  }

  async readSlackContext(
    profileId: string,
    projectId?: string
  ): Promise<{ workspaceName: string | null; channelName: string | null }> {
    const key = projectId ? cardViewKey(projectId, 'slack') : viewKey(profileId, 'slack')
    const view = this.views.get(key)
    if (!view || view.webContents.isDestroyed()) {
      return { workspaceName: null, channelName: null }
    }
    try {
      const raw = (await view.webContents.executeJavaScript(READ_SLACK_CONTEXT_SCRIPT, true)) as {
        workspaceName?: unknown
        channelName?: unknown
      }
      const workspaceName =
        typeof raw?.workspaceName === 'string' && raw.workspaceName.trim()
          ? raw.workspaceName.trim()
          : null
      const channelName =
        typeof raw?.channelName === 'string' && raw.channelName.trim()
          ? raw.channelName.trim()
          : null
      return { workspaceName, channelName }
    } catch {
      return { workspaceName: null, channelName: null }
    }
  }

  async readPageTitle(profileId: string, appId: AppId, projectId?: string): Promise<string | null> {
    const key = projectId ? cardViewKey(projectId, appId) : viewKey(profileId, appId)
    const view = this.views.get(key)
    if (!view || view.webContents.isDestroyed()) {
      return null
    }
    try {
      const script =
        appId === 'teams' ? READ_TEAMS_ORG_NAME_SCRIPT : READ_SLACK_WORKSPACE_NAME_SCRIPT
      const name = await view.webContents.executeJavaScript(script, true)
      if (typeof name === 'string' && name.trim()) {
        return name.trim()
      }
      const title = await view.webContents.executeJavaScript(
        `document.title.replace(/\\s*[—–-|]\\s*(Slack|Microsoft Teams|Teams)\\s*$/i, '').trim()`,
        true
      )
      return typeof title === 'string' && title.trim() ? title.trim() : null
    } catch {
      return null
    }
  }

  getCurrentCardUrl(projectId: string, appId: AppId): string | null {
    const view = this.views.get(cardViewKey(projectId, appId))
    if (!view || view.webContents.isDestroyed()) {
      return null
    }
    return view.webContents.getURL()
  }

  getCurrentTeamId(profileId: string, appId: AppId): string | null {
    const url = this.getCurrentUrl(profileId, appId)
    if (!url) {
      return null
    }
    if (appId === 'slack') {
      return parseTeamIdFromSlackClientUrl(url)
    }
    try {
      const u = new URL(url)
      if (u.hostname.toLowerCase().includes('teams.live.com')) {
        return 'teams-home'
      }
      const tenant = u.searchParams.get('tenantId') || u.searchParams.get('tenant')
      if (tenant && /^[0-9a-f-]{8,}$/i.test(tenant)) {
        const id = `tenant-${tenant.toLowerCase()}`
        return isTeamsPersonalTenantId(id) ? 'teams-home' : id
      }
    } catch {
      /* ignore */
    }
    return 'teams-home'
  }

  getCurrentUrl(profileId: string, appId: AppId): string | null {
    const view = this.views.get(viewKey(profileId, appId))
    if (!view || view.webContents.isDestroyed()) {
      return null
    }
    return view.webContents.getURL()
  }

  /** Used by embed-first WhatsApp / Google / Slack pane login to poll the live view. */
  getWebContents(
    profileId: string,
    appId: AppId,
    options?: { deferLoad?: boolean }
  ): import('electron').WebContents | null {
    const view =
      this.views.get(viewKey(profileId, appId)) ?? this.getOrCreate(profileId, appId, options)
    if (view.webContents.isDestroyed()) {
      return null
    }
    return view.webContents
  }

  private async emitWorkspaceSeen(profileId: string, appId: AppId): Promise<void> {
    if (!this.workspaceSeenHandler) {
      return
    }
    if (appId === 'whatsapp') {
      return
    }
    const url = this.getCurrentUrl(profileId, appId)
    if (!url) {
      return
    }

    if (appId === 'slack') {
      const loc = parseSlackClientPath(url)
      const teamId = loc?.teamId
      if (!teamId) {
        return
      }
      const context = await this.readSlackContext(profileId)
      const title = context.workspaceName || (await this.readPageTitle(profileId, appId))
      const teamDomain = parseSlackTeamDomain(url) ?? undefined
      const looksLikeId = isSlackPlaceholderName(title)
      const teamName =
        (title && !looksLikeId ? title : null) || teamDomain || context.workspaceName || teamId
      const openUrl = slackClientUrlForConversation(teamId, loc.conversationId)
      await this.workspaceSeenHandler(profileId, appId, {
        teamId,
        teamName,
        openUrl,
        teamDomain,
        ...(context.channelName ? { lastChannelName: context.channelName } : {})
      })
      return
    }

    if (!isTeamsSignedInUrl(url)) {
      return
    }
    const title = await this.readPageTitle(profileId, appId)
    const rawTeamId = this.getCurrentTeamId(profileId, appId) || 'teams-home'
    // Personal / consumer directory → single stable home row (never a parallel tenant clone).
    const teamId = canonicalizeTeamsWorkspaceId(rawTeamId)
    const genericTitle =
      !title || /^(microsoft teams|teams|chat|teams org|organization|personal)$/i.test(title)
    const teamName =
      teamId === 'teams-home'
        ? 'Personal'
        : !genericTitle
          ? title
          : `Org ${teamId.replace(/^tenant-/i, '').slice(0, 8)}`
    await this.workspaceSeenHandler(profileId, appId, {
      teamId,
      teamName,
      openUrl: teamId === 'teams-home' ? TEAMS_HOME_URL : url.split('#')[0] || TEAMS_HOME_URL
    })
  }

  /** Inspects a card's partition storage to find any actively authenticated Slack team ID and name */
  detectCardPartitionSlackTeam(projectId: string): { teamId: string; teamName: string } | null {
    try {
      const partDir = join(app.getPath('userData'), 'Partitions', `card-${projectId}-slack`, 'Local Storage', 'leveldb')
      if (!existsSync(partDir)) return null
      const files = readdirSync(partDir)
      for (const f of files) {
        if (!f.endsWith('.ldb') && !f.endsWith('.log')) continue
        try {
          const content = readFileSync(join(partDir, f), 'latin1')
          // Pattern 1: {"T0...":{"name":"..."
          const match = /"(T0[A-Z0-9]+)":\{[^}]*"name":"([^"]+)"/.exec(content)
          if (match && match[1] && match[2]) {
            return { teamId: match[1], teamName: match[2] }
          }
          // Pattern 2: direct team id find
          const idMatch = /(T0[A-Z0-9]{7,})/.exec(content)
          if (idMatch && idMatch[1]) {
            return { teamId: idMatch[1], teamName: 'Slack Workspace' }
          }
        } catch {
          /* ignore file read error */
        }
      }
    } catch (err) {
      log.debug('detectCardPartitionSlackTeam error', { projectId, err: String(err) })
    }
    return null
  }

  private wireEmbedNavigation(profileId: string, appId: AppId, view: WebContentsView): void {
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('msteams:')) {
        log.info('embed blocked msteams protocol; using Teams web', { profileId, appId })
        void view.webContents.loadURL(TEAMS_HOME_URL)
        return { action: 'deny' }
      }

      if (url.startsWith('slack://')) {
        // Parse slack://open?team=T... or slack://channel?team=T...
        try {
          const parsed = new URL(url)
          const teamParam = parsed.searchParams.get('team') || parsed.hostname
          if (teamParam && /^T[A-Z0-9]+$/i.test(teamParam)) {
            const dest = `https://app.slack.com/client/${teamParam}`
            log.info('embed converted slack protocol to in-place web client', { profileId, appId, dest })
            void view.webContents.loadURL(dest)
            return { action: 'deny' }
          }
        } catch {
          /* ignore */
        }
      }

      const host = safeHostname(url)
      const keepInEmbed =
        /(?:^|\.)slack\.com$/i.test(host) ||
        /(?:^|\.)google\.com$/i.test(host) ||
        /(?:^|\.)googleusercontent\.com$/i.test(host) ||
        /(?:^|\.)microsoft\.com$/i.test(host) ||
        /(?:^|\.)microsoftonline\.com$/i.test(host) ||
        /(?:^|\.)live\.com$/i.test(host) ||
        /(?:^|\.)office\.com$/i.test(host) ||
        /(?:^|\.)office365\.com$/i.test(host) ||
        /(?:^|\.)whatsapp\.com$/i.test(host) ||
        /(?:^|\.)wa\.me$/i.test(host) ||
        /(?:^|\.)facebook\.com$/i.test(host)

      if (keepInEmbed) {
        // If it's a Slack SSB redirect URL (e.g. from clicking [Open]), route directly to client
        let target = appId === 'teams' ? normalizeTeamsOpenUrl(url) : url
        if (target.includes('slack.com/ssb/redirect') || target.includes('slack.com/signin/workspaces')) {
          const teamMatch = /[?&]team=(T[A-Z0-9]+)/i.exec(target)
          if (teamMatch && teamMatch[1]) {
            target = `https://app.slack.com/client/${teamMatch[1]}`
          }
        }
        log.info('embed popup redirected in-place', { profileId, appId, url: target })
        void view.webContents.loadURL(target)
      } else {
        log.info('embed popup blocked', { profileId, appId, url })
      }
      return { action: 'deny' }
    })
  }

  private async emitCardWorkspaceSeen(projectId: string, appId: AppId): Promise<void> {
    if (!this.cardWorkspaceSeenHandler) {
      return
    }
    if (appId === 'whatsapp') {
      return
    }
    const url = this.getCurrentCardUrl(projectId, appId)
    if (!url) {
      return
    }

    if (appId === 'slack') {
      const loc = parseSlackClientPath(url)
      const teamId = loc?.teamId
      if (!teamId) {
        return
      }
      const context = await this.readSlackContext('', projectId)
      const title = context.workspaceName || (await this.readPageTitle('', appId, projectId))
      const teamDomain = parseSlackTeamDomain(url) ?? undefined
      const looksLikeId = isSlackPlaceholderName(title)
      const teamName =
        (title && !looksLikeId ? title : null) || teamDomain || context.workspaceName || teamId
      const openUrl = slackClientUrlForConversation(teamId, loc.conversationId)
      await this.cardWorkspaceSeenHandler(projectId, appId, {
        teamId,
        teamName,
        openUrl,
        teamDomain,
        ...(context.channelName ? { lastChannelName: context.channelName } : {})
      })
      return
    }

    if (!isTeamsSignedInUrl(url)) {
      return
    }
    const title = await this.readPageTitle('', appId, projectId)
    const rawTeamId = parseTeamIdFromSlackClientUrl(url) || 'teams-home'
    const teamId = canonicalizeTeamsWorkspaceId(rawTeamId)
    const genericTitle =
      !title || /^(microsoft teams|teams|chat|teams org|organization|personal)$/i.test(title)
    const teamName =
      teamId === 'teams-home'
        ? 'Personal'
        : !genericTitle
          ? title
          : `Org ${teamId.replace(/^tenant-/i, '').slice(0, 8)}`
    await this.cardWorkspaceSeenHandler(projectId, appId, {
      teamId,
      teamName,
      openUrl: teamId === 'teams-home' ? TEAMS_HOME_URL : url.split('#')[0] || TEAMS_HOME_URL
    })
  }

  private wireCardPassiveCapture(projectId: string, appId: AppId, view: WebContentsView): void {
    const key = cardViewKey(projectId, appId)
    if (this.captureWired.has(key)) {
      return
    }
    this.captureWired.add(key)
    this.wireEmbedNavigation(projectId, appId, view)

    const maybeCapture = (): void => {
      const prev = this.captureDebounce.get(key)
      if (prev) clearTimeout(prev)
      this.captureDebounce.set(
        key,
        setTimeout(() => {
          this.captureDebounce.delete(key)
          void this.emitCardWorkspaceSeen(projectId, appId)
        }, 900)
      )
    }
    view.webContents.on('did-navigate', maybeCapture)
    view.webContents.on('did-navigate-in-page', maybeCapture)
    view.webContents.on('did-finish-load', maybeCapture)
  }

  private wirePassiveCapture(profileId: string, appId: AppId, view: WebContentsView): void {
    const key = viewKey(profileId, appId)
    if (this.captureWired.has(key)) {
      return
    }
    this.captureWired.add(key)
    this.wireEmbedNavigation(profileId, appId, view)

    const maybeCapture = (): void => {
      const prev = this.captureDebounce.get(key)
      if (prev) clearTimeout(prev)
      this.captureDebounce.set(
        key,
        setTimeout(() => {
          this.captureDebounce.delete(key)
          void this.emitWorkspaceSeen(profileId, appId)
        }, 900)
      )
    }
    view.webContents.on('did-navigate', maybeCapture)
    view.webContents.on('did-navigate-in-page', maybeCapture)
    view.webContents.on('did-finish-load', maybeCapture)
  }

  activate(
    profileId: string,
    appId: AppId,
    mainWindow: BrowserWindow,
    bounds: Rectangle,
    options?: { deferLoad?: boolean }
  ): void {
    const next = this.getOrCreate(profileId, appId, options)
    const key = viewKey(profileId, appId)
    this.lastBounds = bounds

    if (this.activeKey && this.activeKey !== key) {
      const prev = this.views.get(this.activeKey)
      if (prev) {
        mainWindow.contentView.removeChildView(prev)
      }
      this.lastEmittedThemeKey = null
    }

    this.activeKey = key

    if (this.embedHidden) {
      log.info('browser view activated (hidden for overlay)', { profileId, appId })
      return
    }

    if (!mainWindow.contentView.children.includes(next)) {
      mainWindow.contentView.addChildView(next)
    }
    next.setBounds(bounds)
    if (appId === 'teams') {
      void this.ensureTeamsAppLoaded(profileId)
    }
    this.noteActivity()
    log.info('browser view activated', { profileId, appId })
  }

  activateCustomLink(
    profileId: string,
    linkId: string,
    url: string,
    mainWindow: BrowserWindow,
    bounds: Rectangle
  ): void {
    const key = customLinkKey(profileId, linkId)
    let view = this.views.get(key)
    if (!view || view.webContents.isDestroyed()) {
      view = new WebContentsView({
        webPreferences: {
          partition: `persist:profile-${profileId}-link-${linkId}`,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      })
      view.setBackgroundColor('#0C0D11')
      view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
        void view?.webContents.loadURL(openUrl)
        return { action: 'deny' }
      })
      void view.webContents.loadURL(url)
      this.views.set(key, view)
    }

    this.lastBounds = bounds

    if (this.activeKey && this.activeKey !== key) {
      const prev = this.views.get(this.activeKey)
      if (prev) {
        mainWindow.contentView.removeChildView(prev)
      }
      this.lastEmittedThemeKey = null
    }

    this.activeKey = key

    if (this.embedHidden) {
      log.info('custom link view activated (hidden for overlay)', { profileId, linkId })
      return
    }

    if (!this.embedHidden) {
      if (!mainWindow.contentView.children.includes(view)) {
        mainWindow.contentView.addChildView(view)
      }
      view.setBounds(bounds)
    }
    this.noteActivity()
    log.info('custom link view activated', { profileId, linkId, url })
  }

  activateSecondary(
    profileId: string,
    appId: AppId,
    mainWindow: BrowserWindow,
    bounds: Rectangle
  ): void {
    const next = this.getOrCreate(profileId, appId)
    const key = viewKey(profileId, appId)
    this.secondaryBounds = bounds
    if (this.secondaryKey && this.secondaryKey !== key && this.secondaryKey !== this.activeKey) {
      const prev = this.views.get(this.secondaryKey)
      if (prev) {
        mainWindow.contentView.removeChildView(prev)
      }
    }
    this.secondaryKey = key
    if (this.embedHidden) return
    if (this.activeKey === key) {
      // Same as primary — just update bounds later via updateSplitBounds
      return
    }
    if (!mainWindow.contentView.children.includes(next)) {
      mainWindow.contentView.addChildView(next)
    }
    next.setBounds(bounds)
    this.noteActivity()
  }

  clearSecondary(mainWindow: BrowserWindow): void {
    if (!this.secondaryKey) return
    if (this.secondaryKey !== this.activeKey) {
      const view = this.views.get(this.secondaryKey)
      if (view) {
        mainWindow.contentView.removeChildView(view)
      }
    }
    this.secondaryKey = null
    this.secondaryBounds = null
  }

  async activateCardSlackEmbed(
    profileId: string,
    teamId: string,
    mainWindow: BrowserWindow,
    bounds: Rectangle,
    appId: AppId = 'slack',
    projectId?: string
  ): Promise<void> {
    const key = projectId ? cardViewKey(projectId, appId) : viewKey(profileId, appId)
    const view = projectId ? this.getOrCreateCardView(projectId, appId) : this.getOrCreate(profileId, appId)

    // Propagate the profile's Google session cookies into the card partition so that
    // "Continue with Google" OAuth flows inside the card are pre-seeded with the
    // profile's Google identity.  Slack / Teams / WhatsApp cookies are never copied.
    if (projectId && profileId) {
      void syncGoogleSessionFromProfileToCard(profileId, projectId, appId).catch(() => undefined)
    }

    // If switching card views, detach the previously embedded view first
    if (this.cardEmbedKey && this.cardEmbedKey !== key) {
      const prevView = this.views.get(this.cardEmbedKey)
      if (prevView && mainWindow.contentView.children.includes(prevView)) {
        mainWindow.contentView.removeChildView(prevView)
      }
    }

    this.cardEmbedKey = key
    this.cardEmbedBounds = bounds

    if (!this.embedHidden) {
      if (!mainWindow.contentView.children.includes(view)) {
        mainWindow.contentView.addChildView(view)
      }
      view.setBounds(bounds)
    }

    // Ensure we are navigated appropriately
    if (appId === 'slack') {
      // If a card has an authenticated partition, resolve its real team ID dynamically
      let effectiveTeam = teamId
      if (projectId) {
        const detected = this.detectCardPartitionSlackTeam(projectId)
        if (detected?.teamId) {
          effectiveTeam = detected.teamId
        }
      }

      const isRealTeamId = Boolean(effectiveTeam && /^T[A-Z0-9]+$/i.test(effectiveTeam))
      const currentUrl = view.webContents.getURL()
      if (isRealTeamId) {
        if (!currentUrl || !currentUrl.includes(effectiveTeam)) {
          if (projectId) {
            void view.webContents.loadURL(`https://app.slack.com/client/${effectiveTeam}`)
          } else {
            try {
              await this.navigateToWorkspace(profileId, 'slack', { teamId: effectiveTeam })
            } catch (err) {
              log.warn('Card live slack navigate failed or partially loaded', { profileId, teamId: effectiveTeam, err: String(err) })
            }
          }
        }
      } else {
        // teamId is missing or placeholder. If not on Slack or if stuck on glitch page, load SLACK_CLIENT_URL
        if (!currentUrl || !currentUrl.includes('slack.com') || currentUrl.includes('/client/team')) {
          void view.webContents.loadURL(SLACK_CLIENT_URL)
        }
      }
    } else if (appId === 'whatsapp') {
      const currentUrl = view.webContents.getURL()
      if (!currentUrl || !currentUrl.includes('web.whatsapp.com')) {
        void view.webContents.loadURL(WHATSAPP_WEB_URL)
      }
    } else if (appId === 'teams') {
      const currentUrl = view.webContents.getURL()
      if (
        !currentUrl ||
        (!currentUrl.includes('teams.microsoft.com') && !currentUrl.includes('login.microsoftonline.com'))
      ) {
        void view.webContents.loadURL(TEAMS_HOME_URL)
      }
    }

    this.noteActivity()
    log.info('card live embed activated', { profileId, appId, teamId, bounds, projectId })
  }

  activateCardWebEmbed(
    projectId: string,
    profileId: string,
    linkId: string,
    url: string,
    mainWindow: BrowserWindow,
    bounds: Rectangle
  ): void {
    const key = `card:link:${projectId || profileId}:${linkId}`
    let view = this.views.get(key)
    if (!view || view.webContents.isDestroyed()) {
      view = new WebContentsView({
        webPreferences: {
          partition: `persist:profile-${profileId || 'default'}-link-${linkId}`,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      })
      view.setBackgroundColor('#0C0D11')
      view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
        void view?.webContents.loadURL(openUrl)
        return { action: 'deny' }
      })
      void view.webContents.loadURL(url)
      this.views.set(key, view)
    } else {
      const currentUrl = view.webContents.getURL()
      if (!currentUrl || currentUrl === 'about:blank') {
        void view.webContents.loadURL(url)
      }
    }

    if (this.cardEmbedKey && this.cardEmbedKey !== key) {
      const prevView = this.views.get(this.cardEmbedKey)
      if (prevView && mainWindow.contentView.children.includes(prevView)) {
        mainWindow.contentView.removeChildView(prevView)
      }
    }

    this.cardEmbedKey = key
    this.cardEmbedBounds = bounds

    if (!this.embedHidden) {
      if (!mainWindow.contentView.children.includes(view)) {
        mainWindow.contentView.addChildView(view)
      }
      view.setBounds(bounds)
    }

    this.noteActivity()
    log.info('card web embed activated', { projectId, profileId, linkId, url, bounds })
  }

  reloadCardEmbed(): void {
    if (this.cardEmbedKey) {
      const view = this.views.get(this.cardEmbedKey)
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.reload()
      }
    }
  }

  async isCardSessionAuthenticated(projectId: string, appId: AppId = 'slack'): Promise<boolean> {
    const partition = partitionForCard(projectId, appId)
    const sess = session.fromPartition(partition)
    if (appId === 'slack') {
      const cookies = await sess.cookies.get({ domain: '.slack.com' })
      return cookies.some((c) => (c.name === 'd' || c.name === 'd-s') && Boolean(c.value))
    }
    if (appId === 'teams') {
      const cookies = await sess.cookies.get({ domain: '.microsoft.com' })
      return cookies.some((c) => Boolean(c.value))
    }
    return false
  }

  updateCardSlackEmbedBounds(mainWindow: BrowserWindow, bounds: Rectangle): void {
    this.cardEmbedBounds = bounds
    if (this.embedHidden) {
      if (this.cardEmbedKey) {
        const view = this.views.get(this.cardEmbedKey)
        if (view && mainWindow.contentView.children.includes(view)) {
          mainWindow.contentView.removeChildView(view)
        }
      }
      return
    }
    if (this.cardEmbedKey) {
      const view = this.views.get(this.cardEmbedKey)
      if (view) {
        if (!mainWindow.contentView.children.includes(view)) {
          mainWindow.contentView.addChildView(view)
        }
        view.setBounds(bounds)
      }
    }
  }

  getCardEmbedBounds(): Rectangle | null {
    return this.cardEmbedBounds
  }

  isCardEmbedActive(): boolean {
    return Boolean(this.cardEmbedKey && this.cardEmbedBounds)
  }

  clearCardSlackEmbed(mainWindow: BrowserWindow): void {
    if (!this.cardEmbedKey) return
    const view = this.views.get(this.cardEmbedKey)
    if (view && mainWindow.contentView.children.includes(view)) {
      mainWindow.contentView.removeChildView(view)
    }
    this.cardEmbedKey = null
    this.cardEmbedBounds = null
    log.info('card live slack embed cleared')
  }

  updateSplitBounds(
    mainWindow: BrowserWindow,
    primary: Rectangle,
    secondary: Rectangle | null
  ): void {
    this.lastBounds = primary
    this.secondaryBounds = secondary
    if (this.embedHidden) return
    if (this.activeKey) {
      const view = this.views.get(this.activeKey)
      if (view) {
        if (!mainWindow.contentView.children.includes(view)) {
          mainWindow.contentView.addChildView(view)
        }
        view.setBounds(primary)
      }
    }
    if (secondary && this.secondaryKey && this.secondaryKey !== this.activeKey) {
      const view = this.views.get(this.secondaryKey)
      if (view) {
        if (!mainWindow.contentView.children.includes(view)) {
          mainWindow.contentView.addChildView(view)
        }
        view.setBounds(secondary)
      }
    }
  }

  /**
   * Tear down inactive embeds to save RAM. Caller must ensure Chrome auth is not active.
   */
  destroyInactiveExcept(keepKeys: string[], mainWindow?: BrowserWindow): number {
    const keep = new Set(keepKeys.filter(Boolean))
    let removed = 0
    for (const key of [...this.views.keys()]) {
      if (keep.has(key)) continue
      const view = this.views.get(key)
      if (!view) continue
      if (mainWindow) {
        try {
          mainWindow.contentView.removeChildView(view)
        } catch {
          /* ignore */
        }
      }
      if (!view.webContents.isDestroyed()) {
        view.webContents.close()
      }
      this.views.delete(key)
      this.captureWired.delete(key)
      this.unreadWired.delete(key)
      if (this.activeKey === key) this.activeKey = null
      if (this.secondaryKey === key) this.secondaryKey = null
      removed += 1
    }
    if (removed > 0) {
      log.info('destroyed inactive embeds', { removed, kept: [...keep] })
    }
    return removed
  }

  /** Detach any active embed without changing selection. */
  deactivate(mainWindow: BrowserWindow): void {
    if (!this.activeKey) {
      return
    }
    const view = this.views.get(this.activeKey)
    if (view) {
      mainWindow.contentView.removeChildView(view)
    }
    this.activeKey = null
  }

  updateBounds(mainWindow: BrowserWindow, bounds: Rectangle): void {
    this.lastBounds = bounds
    if (this.cardEmbedKey) {
      // In-card embed is actively positioned inside a card; do not overwrite with full viewport bounds
      return
    }
    if (!this.activeKey || this.embedHidden) {
      return
    }
    const view = this.views.get(this.activeKey)
    if (!view) {
      return
    }
    if (!this.embedHidden) {
      if (!mainWindow.contentView.children.includes(view)) {
        mainWindow.contentView.addChildView(view)
      }
      view.setBounds(bounds)
    }
  }

  setEmbedVisible(mainWindow: BrowserWindow, visible: boolean): void {
    if (visible) {
      this.embedHidden = false
      if (this.cardEmbedKey && this.cardEmbedBounds) {
        const view = this.views.get(this.cardEmbedKey)
        if (view) {
          if (!mainWindow.contentView.children.includes(view)) {
            mainWindow.contentView.addChildView(view)
          }
          view.setBounds(this.cardEmbedBounds)
          return
        }
      }
      if (this.activeKey) {
        const view = this.views.get(this.activeKey)
        if (view) {
          if (!mainWindow.contentView.children.includes(view)) {
            mainWindow.contentView.addChildView(view)
          }
          if (this.lastBounds) view.setBounds(this.lastBounds)
        }
      }
      if (this.secondaryKey && this.secondaryKey !== this.activeKey) {
        const view = this.views.get(this.secondaryKey)
        if (view) {
          if (!mainWindow.contentView.children.includes(view)) {
            mainWindow.contentView.addChildView(view)
          }
          if (this.secondaryBounds) view.setBounds(this.secondaryBounds)
        }
      }
      return
    }

    this.embedHidden = true
    for (const key of [this.activeKey, this.secondaryKey, this.cardEmbedKey]) {
      if (!key) continue
      const view = this.views.get(key)
      if (view && mainWindow.contentView.children.includes(view)) {
        mainWindow.contentView.removeChildView(view)
      }
    }
  }

  setAllZoomFactor(factor: number): void {
    const z = Math.min(2, Math.max(0.5, factor))
    for (const view of this.views.values()) {
      if (!view.webContents.isDestroyed()) {
        view.webContents.setZoomFactor(z)
      }
    }
  }

  destroy(profileId: string, mainWindow?: BrowserWindow): void {
    for (const appId of ['slack', 'teams', 'whatsapp'] as AppId[]) {
      const key = viewKey(profileId, appId)
      const view = this.views.get(key)
      if (!view) {
        continue
      }
      if (mainWindow && this.activeKey === key) {
        mainWindow.contentView.removeChildView(view)
        this.activeKey = null
      }
      if (!view.webContents.isDestroyed()) {
        view.webContents.close()
      }
      this.views.delete(key)
      this.captureWired.delete(key)
      this.unreadWired.delete(key)
      this.unreadCounts.delete(key)
    }
    if (this.secondaryKey?.startsWith(`${profileId}:`)) {
      this.secondaryKey = null
    }
    // Destroy custom links associated with this profile
    const prefix = `link:${profileId}:`
    for (const key of [...this.views.keys()]) {
      if (key.startsWith(prefix)) {
        const view = this.views.get(key)
        if (mainWindow && this.activeKey === key && view) {
          mainWindow.contentView.removeChildView(view)
          this.activeKey = null
        }
        if (view && !view.webContents.isDestroyed()) {
          view.webContents.close()
        }
        this.views.delete(key)
      }
    }
    log.info('browser views destroyed for profile', { profileId })
  }

  destroyAll(mainWindow?: BrowserWindow): void {
    const profileIds = new Set(
      [...this.views.keys()].map((k) => k.split(':')[0]).filter(Boolean) as string[]
    )
    for (const profileId of profileIds) {
      this.destroy(profileId, mainWindow)
    }
  }
}
