import { app, BrowserWindow, nativeImage, nativeTheme, session, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import dockIcon from '../../resources/dockIcon.png?asset'
import trayIcon from '../../resources/trayIcon.png?asset'
import { APP_BUNDLE_ID, APP_DISPLAY_NAME } from '../shared/brand'
import { IpcChannels } from '../shared/ipc-contract'
import type {
  DashboardDigest,
  DashboardProject,
  DashboardTeamWorkspaceCandidate,
  RecentActivity
} from '../shared/dashboard-contract'
import { AdminAuthController, defaultAdminSessionPath } from './admin-auth'
import { AppLockController, notifyUnreadIncrease } from './app-lock'
import { AppSettingsStore, defaultAppSettingsPath } from './app-settings'
import { registerAppIpc } from './ipc/app.ipc'
import { registerOauthIpc } from './ipc/oauth.ipc'
import { registerProfileIpc } from './ipc/profiles.ipc'
import { registerSlackDataIpc } from './ipc/slack-data.ipc'
import { registerDashboardIpc } from './ipc/dashboard.ipc'
import { registerLogsIpc } from './ipc/logs.ipc'
import { registerStorageIpc } from './ipc/storage.ipc'
import { StorageCleanerService } from './storage/storage-cleaner'
import { DashboardDeltaStore } from './dashboard/delta-store'
import { MonitorStore } from './dashboard/monitor-store'
import { WorkspaceMappingStore } from './dashboard/workspace-mapping-store'
import { DashboardInsightSyncEngine } from './dashboard/sync-engine'
import { initSlackUserStore, normalizeHistoricalDeltaUsers } from './dashboard/slack-api-client'
import { DashboardScheduler } from './dashboard/scheduler'
import { DashboardSidebarStateStore } from './dashboard/sidebar-state'
import { TeamWorkspaceStore } from './dashboard/team-workspace-store'
import { migrateWorkspaceCards } from './dashboard/workspace-migration'
import { buildRecentFeed } from './dashboard/recent-feed'
import { DashboardDigestStore, refreshDigest } from './dashboard/digest'
import { DashboardChatService } from './dashboard/chat-service'
import { ProjectChatService } from './dashboard/project-chat-service'
import { DashboardChatRetriever } from './dashboard/chat-retrieval'
import { HistoryStore } from './dashboard/history-store'
import { DashboardViewedStore } from './dashboard/viewed-store'
import { DashboardScheduleStore } from './dashboard/schedule-store'
import { RunLogStore } from './dashboard/run-log-store'
import { AiSettingsStore } from './dashboard/ai-settings-store'
import { AiSettingsService, DEFAULT_EMBEDDING_MODEL } from './dashboard/ai-settings'
import { ConfigService } from './dashboard/config-service'
import { migrateConfigV1 } from './dashboard/config-migration'
import { InsightEngine } from './dashboard/insight-engine'
import { resolveProjectMessageSources } from './dashboard/message-sources'
import { SlackPoller } from './dashboard/slack-poller'
import { loadAppEnv } from './load-app-env'
import { log } from './logging'
import { listChannels } from './slack/slack-api-client'
import { getChromeStayEmbed, getPendingChromeBrowserAuth } from './profiles/chrome-browser-auth'
import { BrowserViewManager } from './profiles/browser-view-manager'
import { defaultProfileStorePath, ProfileStore } from './profiles/profile-store'
import { CHROME_USER_AGENT, partitionForCard } from './profiles/session-partition'
import { splitUnreadKey, sumUnread } from './profiles/unread-from-title'
import { createAppTray } from './tray'
import { defaultTokenStorePath, TokenStore } from './slack/token-store'
import { APP_IDS, appLabel, profileDisplayLabel, type AppId } from '../shared/types'

const loadedEnvPath = loadAppEnv()
if (loadedEnvPath) {
  // Logging module is safe here; avoids printing secret values.
  log.info('loaded env file', { path: loadedEnvPath })
} else {
  log.info('running in zero-.env mode — using in-app settings & default admin credentials')
}

/** One process / one tray — second launches focus the existing window. */
app.setName(APP_DISPLAY_NAME)
if (typeof (app as unknown as { setDesktopName?: (name: string) => void }).setDesktopName === 'function') {
  ;(app as unknown as { setDesktopName: (name: string) => void }).setDesktopName('cosmic.desktop')
}
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('no-sandbox')
nativeTheme.themeSource = 'dark'
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('slack-dashboard', process.execPath, [join(process.argv[1])])
      app.setAsDefaultProtocolClient('cosmic', process.execPath, [join(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient('slack-dashboard')
    app.setAsDefaultProtocolClient('cosmic')
  }

  app.userAgentFallback = CHROME_USER_AGENT

  let mainWindow: BrowserWindow | null = null
  const browserViewManager = new BrowserViewManager()
  let lastUnread: Record<string, number> = {}
  const pendingUnreadNotices = new Map<string, number>()
  let unreadNoticeTimer: ReturnType<typeof setTimeout> | null = null
  let lastEmbedActivity = Date.now()
  let sleepTimer: ReturnType<typeof setInterval> | null = null

  function getOauthConfig(): { clientId: string; clientSecret: string; redirectUri?: string } {
    return {
      clientId: process.env.SLACK_CLIENT_ID ?? '',
      clientSecret: process.env.SLACK_CLIENT_SECRET ?? '',
      redirectUri: process.env.SLACK_REDIRECT_URI
    }
  }

  function applyChromeUserAgent(contents: Electron.WebContents): void {
    contents.setUserAgent(CHROME_USER_AGENT)
  }

  function sendToast(message: string): void {
    const win = mainWindow
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.AppToast, message)
    }
  }

  function focusMainWindow(): void {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  function handleDeepLink(url: string): void {
    try {
      const u = new URL(url)
      if (u.protocol !== 'slack-dashboard:') return
      const profileId = u.hostname || u.pathname.replace(/^\//, '')
      if (!profileId) return
      const appId = (u.searchParams.get('app') as AppId | null) ?? undefined
      const teamId = u.searchParams.get('team') ?? undefined
      focusMainWindow()
      const win = mainWindow
      if (win && !win.isDestroyed()) {
        win.webContents.send(IpcChannels.ProfileDeepLink, { profileId, appId, teamId })
      }
    } catch (err) {
      log.warn('deep link parse failed', { url, err: String(err) })
    }
  }

  function deepLinkFromArgv(argv: string[]): string | undefined {
    return argv.find((a) => a.startsWith('slack-dashboard://'))
  }

  app.on('second-instance', (_event, argv) => {
    focusMainWindow()
    const url = deepLinkFromArgv(argv)
    if (url) handleDeepLink(url)
  })

  function createWindow(): void {
    const appWindowIcon = nativeImage.createFromPath(icon)
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      autoHideMenuBar: true,
      title: APP_DISPLAY_NAME,
      backgroundColor: '#14121c',
      icon: appWindowIcon.isEmpty() ? icon : appWindowIcon,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    if (!appWindowIcon.isEmpty()) {
      mainWindow.setIcon(appWindowIcon)
    }

    applyChromeUserAgent(mainWindow.webContents)
    // Undo accidental ⌘+/trackpad zoom from prior sessions.
    mainWindow.webContents.setZoomFactor(1)

    mainWindow.on('ready-to-show', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.setZoomFactor(1)
      mainWindow.setSize(1280, 800)
      mainWindow.center()
      mainWindow.show()
    })

    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (!(input.control || input.meta) || input.type !== 'keyDown') return
      const key = input.key.toLowerCase()
      // ⌘0 / Ctrl+0 — reset zoom to 100%
      if (key === '0' || key === 'numpad0') {
        event.preventDefault()
        mainWindow?.webContents.setZoomFactor(1)
        browserViewManager.setAllZoomFactor(1)
        return
      }
      // ⌘+ / ⌘- — nudge zoom (keeps embeds in sync)
      if (key === '=' || key === '+') {
        event.preventDefault()
        const next = Math.min(2, (mainWindow?.webContents.getZoomFactor() ?? 1) + 0.1)
        mainWindow?.webContents.setZoomFactor(next)
        browserViewManager.setAllZoomFactor(next)
        return
      }
      if (key === '-') {
        event.preventDefault()
        const next = Math.max(0.5, (mainWindow?.webContents.getZoomFactor() ?? 1) - 0.1)
        mainWindow?.webContents.setZoomFactor(next)
        browserViewManager.setAllZoomFactor(next)
      }
    })

    mainWindow.on('closed', () => {
      browserViewManager.destroyAll()
      mainWindow = null
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
      void shell.openExternal(details.url)
      return { action: 'deny' }
    })

    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log(`[Renderer Console level=${level} line=${line} source=${sourceId}]: ${message}`)
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId(APP_BUNDLE_ID)

    app.userAgentFallback = CHROME_USER_AGENT
    session.defaultSession.setUserAgent(CHROME_USER_AGENT)
    log.info('Chrome user agent applied', { ua: CHROME_USER_AGENT })

    // Dock icon: padded desktop-style squircle (Finder/Desktop still use icon.icns).
    if (process.platform === 'darwin' && app.dock) {
      const dockImg = nativeImage.createFromPath(dockIcon || icon)
      if (!dockImg.isEmpty()) app.dock.setIcon(dockImg)
    }
    app.setName(APP_DISPLAY_NAME)

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
      applyChromeUserAgent(window.webContents)
    })

    const userData = app.getPath('userData')
    const profileStore = new ProfileStore({ filePath: defaultProfileStorePath(userData) })
    const tokenStore = new TokenStore({ filePath: defaultTokenStorePath(userData) })
    const settingsStore = new AppSettingsStore(defaultAppSettingsPath(userData))

    // dashboard feature (ADR-0007) — isolated module, no behavior changes above
    const dashboardRoot = join(userData, 'dashboard')
    initSlackUserStore(dashboardRoot)
    normalizeHistoricalDeltaUsers(dashboardRoot)
    const dashboardMonitorStore = new MonitorStore({
      rootDir: dashboardRoot,
      encryptionAvailable: (await import('electron')).safeStorage.isEncryptionAvailable()
    })
    const workspaceMappingStore = new WorkspaceMappingStore({ rootDir: dashboardRoot })
    const dashboardDeltaStore = new DashboardDeltaStore({ rootDir: dashboardRoot })
    const dashboardSidebarStateStore = new DashboardSidebarStateStore(userData)
    // v3 — one team workspace shared by every card (ticket 04). The secret stays
    // encrypted here; cards only ever see the pinned channel list.
    const teamWorkspaceStore = new TeamWorkspaceStore({
      rootDir: dashboardRoot,
      encryptionAvailable: (await import('electron')).safeStorage.isEncryptionAvailable()
    })
    const teamWorkspaceReader = {
      getConnection: async (): Promise<{
        profileId: string
        teamId: string
        token: string | null
        channels: Array<{ channelId: string; channelName: string }>
        status: 'connected' | 'needs-reconnect'
      } | null> => {
        const connection = await teamWorkspaceStore.getConnection()
        if (!connection) return null
        const token =
          connection.token ?? (await tokenStore.tryGet(connection.profileId, connection.teamId))
        return {
          profileId: connection.profileId,
          teamId: connection.teamId,
          token,
          channels: connection.channels,
          status: connection.status
        }
      },
      setStatus: (status: 'connected' | 'needs-reconnect', atIso?: string) =>
        teamWorkspaceStore.setStatus(status, atIso)
    }
    const listTeamWorkspaceCandidates = async (): Promise<DashboardTeamWorkspaceCandidate[]> => {
      const profiles = await profileStore.list()
      const byTeam = new Map<string, DashboardTeamWorkspaceCandidate>()
      for (const profile of profiles) {
        for (const workspace of await tokenStore.listWorkspaces(profile.id)) {
          if (!workspace.teamId || byTeam.has(workspace.teamId)) continue
          byTeam.set(workspace.teamId, {
            profileId: profile.id,
            profileName: profileDisplayLabel(profile),
            teamId: workspace.teamId,
            teamName: workspace.teamName,
            teamDomain: workspace.teamDomain,
            scopes: workspace.scopes
          })
        }
      }
      return [...byTeam.values()]
    }
    // v2.2 — NVIDIA NIM rolling insights (universal key/model from .env)
    const nimPrimary =
      process.env.NVIDIA_NIM_MODEL_PRIMARY ?? 'nvidia/nemotron-3.5-super-vl-120b-a12b'
    const nimFallback =
      process.env.NVIDIA_NIM_MODEL_FALLBACK ?? 'nvidia/nemotron-3.5-lightning-30b-a3b'
    const nimEmbeddingModel = process.env.NVIDIA_NIM_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL
    const nimTimeoutMs = Number(process.env.NVIDIA_NIM_TIMEOUT_MS ?? 90_000)
    const nimMaxTokens = Number(process.env.NVIDIA_NIM_MAX_TOKENS ?? 2000)
    // reasoning models burn the whole token budget on reasoning and answer
    // nothing, so thinking is off by default (re-enable from .env)
    const nimEnableThinking = process.env.NVIDIA_NIM_ENABLE_THINKING === 'true'
    // v2.7 — project settings → global settings → built-in default models. The
    // key never leaves this process; the renderer only sees masks.
    const aiSettingsStore = new AiSettingsStore({
      rootDir: dashboardRoot,
      encryptionAvailable: (await import('electron')).safeStorage.isEncryptionAvailable()
    })
    // One-time seed from .env keeps existing installs working; afterwards the
    // resolver is the only reader of AI config.
    await migrateConfigV1({
      rootDir: dashboardRoot,
      aiSettingsStore,
      env: {
        nvidiaApiKey: process.env.NVIDIA_NIM_API_KEY,
        nvidiaChatModel: nimPrimary,
        nvidiaEmbeddingModel: nimEmbeddingModel
      }
    }).catch((err) => {
      log.warn(`[dashboard] config migration skipped: ${err instanceof Error ? err.message : err}`)
    })
    const aiSettings = new AiSettingsService({
      store: aiSettingsStore,
      defaults: {
        chatModel: nimPrimary,
        embeddingModel: nimEmbeddingModel,
        fallbackModel: nimFallback
      },
      timeoutMs: Number.isFinite(nimTimeoutMs) ? nimTimeoutMs : 90_000,
      maxTokens: Number.isFinite(nimMaxTokens) ? nimMaxTokens : 2000,
      enableThinking: nimEnableThinking
    })
    const configService = new ConfigService({
      aiSettings,
      teamWorkspace: teamWorkspaceStore,
      monitorStore: dashboardMonitorStore,
      workspaceMapping: workspaceMappingStore,
      oauthTokenProvider: { tryGet: (profileId, teamId) => tokenStore.tryGet(profileId, teamId) }
    })
    const resolveProjectSources = async (project: DashboardProject) => {
      const mappedWorkspace = await workspaceMappingStore.getWorkspaceForProject(project.id)
      const connection = await teamWorkspaceReader.getConnection().catch(() => null)
      return resolveProjectMessageSources(project, {
        mappedTeamId: mappedWorkspace ?? project.teamId,
        ourSlack: connection
          ? {
              profileId: connection.profileId,
              teamId: connection.teamId,
              channels: connection.channels
            }
          : null
      })
    }
    // D7 — an older build could write a secret as plaintext before the save path
    // blocked it. Seal anything it left behind, once, before any sync runs.
    await Promise.all([
      dashboardMonitorStore.migrateLegacyPlaintext(),
      teamWorkspaceStore.migrateLegacyPlaintext(),
      aiSettingsStore.migrateLegacyPlaintext()
    ])
      .then((counts) => {
        const moved = counts.reduce((total, n) => total + n, 0)
        if (moved > 0) log.info(`[dashboard] re-encrypted ${moved} legacy plaintext secret(s)`)
      })
      .catch((err) => {
        log.warn(
          `[dashboard] plaintext re-encryption skipped: ${err instanceof Error ? err.message : err}`
        )
      })
    const dashboardHistoryStore = new HistoryStore({ rootDir: dashboardRoot })
    const dashboardViewedStore = new DashboardViewedStore({ rootDir: dashboardRoot })
    const dashboardScheduleStore = new DashboardScheduleStore({ rootDir: dashboardRoot })
    // The engine always exists: with a key it enriches with NVIDIA NIM,
    // without one it still keeps every card meaningful via local heuristics.
    const insightEngine = new InsightEngine({
      provider: null,
      resolveProvider: (projectId: string) => aiSettings.getProvider(projectId),
      historyStore: dashboardHistoryStore,
      deltaStore: dashboardDeltaStore,
      resolveSources: resolveProjectSources,
      fetchUsers: (token: string) => new SlackPoller().usersList(token),
      log: (msg) => log.info(msg)
    })
    if (!(await aiSettings.resolveSettings()).apiKey) {
      log.info('[dashboard] no AI key configured — insights fall back to heuristics')
    }
    const digestStore = new DashboardDigestStore({ rootDir: dashboardRoot })
    const refreshDigestNow = async (): Promise<DashboardDigest | null> => {
      const projects = await dashboardMonitorStore.listProjects()
      const workspaces = await Promise.all(
        projects.map(async (p) => ({
          teamName: p.teamName ?? p.teamId,
          projectName: p.name,
          insight: await insightEngine.existingInsight(p.id)
        }))
      )
      return refreshDigest({
        workspaces,
        store: digestStore,
        provider: await aiSettings.getProvider(),
        log: (msg) => log.info(msg)
      })
    }

    // v2.6 — Slack Chat tab: local history + replies via chat.postMessage
    const dashboardChatService = new DashboardChatService({
      monitorStore: dashboardMonitorStore,
      deltaStore: dashboardDeltaStore,
      oauthTokenProvider: { tryGet: (profileId, teamId) => tokenStore.tryGet(profileId, teamId) },
      teamWorkspace: teamWorkspaceReader,
      oauthScopesProvider: async (profileId, teamId) => {
        const links = await tokenStore.listWorkspaces(profileId)
        return links.find((link) => link.teamId === teamId)?.scopes ?? null
      },
      log: (msg) => log.info(msg)
    })

    const dashboardEngine = new DashboardInsightSyncEngine({
      monitorStore: dashboardMonitorStore,
      deltaStore: dashboardDeltaStore,
      chatService: dashboardChatService,
      workspaceMapping: workspaceMappingStore,
      oauthTokenProvider: { tryGet: (profileId, teamId) => tokenStore.tryGet(profileId, teamId) },
      manualTokenProvider: {
        getManualToken: (key: string) => dashboardMonitorStore.getManualToken(key)
      },
      teamWorkspace: teamWorkspaceReader,
      insightEngine,
      insightReader: {
        getLastInsight: (projectId: string) => insightEngine.existingInsight(projectId),
        getLastEntry: async (projectId: string) =>
          (await dashboardHistoryStore.read(projectId))[0] ?? null
      },
      historyReader: (projectId: string) => dashboardHistoryStore.read(projectId),
      viewedStore: dashboardViewedStore,
      getExistingBrowserView: (profileId, appId) =>
        browserViewManager.getExistingView(profileId, appId),
      getExistingCardView: (projectId, appId) =>
        browserViewManager.getExistingCardView(projectId, appId),
      getScrapePersonalDms: async () => (await settingsStore.get()).scrapePersonalDms === true,
      onSourceRun: (sourceId, atIso) => {
        void dashboardScheduleStore.recordSourceRun(sourceId, atIso)
      },
      onSynced: () => {
        const win = mainWindow
        if (win && !win.isDestroyed()) {
          void dashboardEngine.buildSnapshot().then(async (projects) => {
            try {
              const digest = await refreshDigestNow().catch((err) => {
                log.warn('[dashboard] digest refresh failed', { err: String(err) })
                return null
              })
              const manualTokens = (await dashboardMonitorStore.listManualTokens()).map((t) => ({
                key: t.key,
                validated: t.persisted
              }))
              win.webContents.send(IpcChannels.DashboardSnapshotChanged, {
                projects,
                manualTokens,
                syncIntervalSeconds: 60,
                digest,
                pinnedOrder: await dashboardMonitorStore.readPinnedOrder()
              })
            } catch (err) {
              log.warn('[dashboard] broadcast onSynced failed', { err: String(err) })
            }
          })
        } else {
          void refreshDigestNow().catch((err) =>
            log.warn('[dashboard] digest refresh failed', { err: String(err) })
          )
        }
      },
      log: (msg) => log.info(msg)
    })

    // v2.3 — the "Recent" strip (local data only) and the top digest
    const buildRecent = async (): Promise<RecentActivity[]> =>
      buildRecentFeed({
        monitorStore: dashboardMonitorStore,
        deltaStore: dashboardDeltaStore,
        resolveSources: resolveProjectSources,
        getLastInsight: (projectId: string) => insightEngine.existingInsight(projectId),
        getNewMessageCount: (projectId: string) => dashboardEngine.newMessageCountFor(projectId),
        getLastViewedAt: (projectId: string) => dashboardViewedStore.get(projectId)
      })
    const getDigest = async (): Promise<DashboardDigest | null> => refreshDigestNow()
    const projectChatService = new ProjectChatService({
      rootDir: dashboardRoot,
      monitorStore: dashboardMonitorStore,
      configService,
      insightEngine,
      chatService: dashboardChatService,
      syncEngine: dashboardEngine,
      scheduleStore: dashboardScheduleStore,
      retriever: new DashboardChatRetriever({
        monitorStore: dashboardMonitorStore,
        configService,
        deltaStore: dashboardDeltaStore,
        teamWorkspace: teamWorkspaceStore
      })
    })

    // v2.2 — one-time workspace migration: stamp + split legacy mixed cards.
    // Runs in the background: it talks to Slack and must never block startup.
    const runWorkspaceMigration = async (): Promise<void> => {
      const poller = new SlackPoller()
      try {
        const migration = await migrateWorkspaceCards({
          monitorStore: dashboardMonitorStore,
          listTokenKeys: async () =>
            (await dashboardMonitorStore.listManualTokens()).map((t) => t.key),
          resolveTokenMeta: async (key: string) => {
            const token = await dashboardMonitorStore.getManualToken(key)
            if (!token) return null
            const check = await poller.authTest(token)
            if (!check.valid || !check.teamId || !check.teamName) return null
            const meta = {
              teamId: check.teamId,
              teamName: check.teamName,
              userName: check.userName,
              userId: check.userId
            }
            await dashboardMonitorStore.upsertManualTokenMeta(key, meta)
            return meta
          },
          listChannelsForKey: async (key: string) => {
            const token = await dashboardMonitorStore.getManualToken(key)
            if (!token) return []
            const channels = await listChannels(token)
            return channels.map((c) => ({ id: c.id, name: c.name }))
          }
        })
        if (migration.stamped || migration.split) {
          log.info('[dashboard] workspace migration applied', {
            stamped: migration.stamped,
            split: migration.split,
            notes: migration.notes
          })
        }
      } catch (err) {
        log.warn('[dashboard] workspace migration skipped', { err: String(err) })
      }
    }
    const dashboardScheduler = new DashboardScheduler(dashboardEngine, dashboardScheduleStore, {
      listProjects: () => dashboardMonitorStore.listProjects(),
      runDailyRecheck: async () => {
        const projects = await dashboardMonitorStore.listProjects()
        let checked = 0
        let skipped = 0
        let failed = 0
        for (const project of projects) {
          const token =
            project.tokenSource === 'manual'
              ? project.manualTokenKey
                ? await dashboardMonitorStore.getManualToken(project.manualTokenKey)
                : null
              : await tokenStore.tryGet(project.profileId, project.teamId)
          const settings = await aiSettings.resolveSettings(project.id)
          if (!token || !settings.apiKey) {
            skipped += 1
            continue
          }
          const snapshot = (await dashboardEngine.buildSnapshot(project.id))[0]
          if (!snapshot) {
            skipped += 1
            continue
          }
          try {
            await insightEngine.refresh(project, token, snapshot, { force: true })
            checked += 1
          } catch {
            failed += 1
          }
        }
        const parts = [`Re-grounded ${checked} project${checked === 1 ? '' : 's'}`]
        if (skipped) parts.push(`${skipped} skipped (no token or key)`)
        if (failed) parts.push(`${failed} failed`)
        return { checked, skipped, detail: `${parts.join(' · ')}.` }
      },
      onChanged: (state) => {
        const win = mainWindow
        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.DashboardSchedulesChanged, state)
        }
      },
      broadcastSnapshot: async () => {
        const win = mainWindow
        if (win && !win.isDestroyed()) {
          const projects = await dashboardEngine.buildSnapshot()
          const manualTokens = (await dashboardMonitorStore.listManualTokens()).map((t) => ({
            key: t.key,
            validated: t.persisted
          }))
          win.webContents.send(IpcChannels.DashboardSnapshotChanged, {
            projects,
            manualTokens,
            globalConfig: await configService.publicGlobalConfig(),
            syncIntervalSeconds: 60,
            lastUpdatedAt: new Date().toISOString()
          })
        }
      }
    })

    const adminAuth = new AdminAuthController({
      sessionPath: defaultAdminSessionPath(userData)
    })

    const lock = new AppLockController(
      settingsStore,
      () => mainWindow,
      (locked) => {
        const win = mainWindow
        if (win && !win.isDestroyed()) {
          browserViewManager.setEmbedVisible(win, !locked && adminAuth.isAuthenticated())
        }
      }
    )

    registerProfileIpc({
      profileStore,
      browserViewManager,
      tokenStore,
      getMainWindow: () => mainWindow,
      monitorStore: dashboardMonitorStore,
      aiSettings,
      broadcastSnapshot: async () => {
        const win = mainWindow
        if (win && !win.isDestroyed()) {
          const projects = await dashboardEngine.buildSnapshot()
          const manualTokens = (await dashboardMonitorStore.listManualTokens()).map((t) => ({
            key: t.key,
            validated: t.persisted
          }))
          win.webContents.send(IpcChannels.DashboardSnapshotChanged, {
            projects,
            manualTokens,
            globalConfig: await configService.publicGlobalConfig()
          })
        }
      },
      onProfilesRemoved: async (ids) => {
        await settingsStore.removeRecentsForProfiles(ids)
        const win = mainWindow
        if (win && !win.isDestroyed()) {
          const settings = await settingsStore.get()
          win.webContents.send(IpcChannels.AppSettingsChanged, settings)
        }
      }
    })
    registerOauthIpc({
      tokenStore,
      profileStore,
      getOauthConfig
    })
    registerSlackDataIpc({ tokenStore })
    registerDashboardIpc({
      monitorStore: dashboardMonitorStore,
      engine: dashboardEngine,
      deltaStore: dashboardDeltaStore,
      runLogStore: new RunLogStore({ rootDir: dashboardDeltaStore.rootDir }),
      scheduler: dashboardScheduler,
      getMainWindow: () => mainWindow,
      oauthTokenProvider: { tryGet: (profileId, teamId) => tokenStore.tryGet(profileId, teamId) },
      historyStore: dashboardHistoryStore,
      buildRecent,
      getDigest,
      sidebarStateStore: dashboardSidebarStateStore,
      chatService: dashboardChatService,
      projectChatService,
      aiSettings,
      configService,
      teamWorkspace: teamWorkspaceStore,
      listTeamWorkspaceCandidates,
      workspaceMapping: workspaceMappingStore,
      viewedStore: dashboardViewedStore,
      getExistingCardView: (projectId, appId) =>
        browserViewManager.getExistingCardView(projectId, appId as AppId),
      getExistingProfileView: (profileId, appId) =>
        browserViewManager.getExistingView(profileId, appId as AppId)
    })

    void runWorkspaceMigration()

    // Self-healing migration for corrupted workspace names (e.g. "1 new item" or "unknown")
    void (async () => {
      try {
        // Auto-detect existing logged-in card sessions and attach them to projects
        try {
          const projects = await dashboardMonitorStore.listProjects()
          for (const proj of projects) {
            const isAuth = await browserViewManager.isCardSessionAuthenticated(proj.id, 'slack')
            if (isAuth) {
              const partition = partitionForCard(proj.id, 'slack')
              const sess = session.fromPartition(partition)
              const cookies = await sess.cookies.get({ domain: '.slack.com' })
              const dCookie = cookies.find((c) => (c.name === 'd' || c.name === 'd-s') && Boolean(c.value))
              if (dCookie) {
                // Read genuine team details directly from partition storage
                const detected = browserViewManager.detectCardPartitionSlackTeam(proj.id)
                const realTeamId = detected?.teamId || (proj.teamId && !proj.teamId.startsWith('pending-') ? proj.teamId : null)
                const realTeamName = detected?.teamName || (proj.teamName && proj.teamName !== proj.name ? proj.teamName : null)

                if (realTeamId) {
                  const existingSources = proj.sources ?? []
                  const existingIdx = existingSources.findIndex((s) => s.workspaceId === realTeamId)
                  let updatedSources = [...existingSources]

                  if (existingIdx >= 0) {
                    updatedSources[existingIdx] = {
                      ...updatedSources[existingIdx],
                      workspaceName: realTeamName || updatedSources[existingIdx].workspaceName,
                      status: 'connected',
                      updatedAt: new Date().toISOString()
                    }
                  } else {
                    const now = new Date().toISOString()
                    const autoSource: import('../shared/dashboard-contract').ProjectSource = {
                      id: `src-card-${Date.now().toString(36)}`,
                      kind: 'browser',
                      platform: 'slack',
                      profileId: proj.profileId,
                      workspaceId: realTeamId,
                      workspaceName: realTeamName || 'Slack Workspace',
                      channels: [],
                      role: 'ours',
                      backfillDays: 7,
                      enabled: true,
                      status: 'connected',
                      selectionMode: 'include',
                      createdAt: now,
                      updatedAt: now
                    }
                    // Filter out any stale sources from other workspaces if we now have the real team
                    updatedSources = [autoSource]
                  }

                  await dashboardMonitorStore.upsertProject({
                    project: {
                      ...proj,
                      teamId: realTeamId,
                      teamName: realTeamName || proj.teamName || 'Slack Workspace',
                      sources: updatedSources
                    }
                  })
                  log.info('[profiles] auto-detected and attached card session workspace', {
                    projectId: proj.id,
                    teamId: realTeamId,
                    teamName: realTeamName
                  })
                }
              }
            }
          }
        } catch (cardSyncErr) {
          log.warn('[profiles] card session auto-attach scan error', { err: String(cardSyncErr) })
        }

        // Clean up any card-only workspaces that mistakenly leaked into global profiles
        try {
          const allProfiles = await profileStore.list()
          for (const p of allProfiles) {
            const slack = p.apps.slack
            if (slack?.availableWorkspaces?.length) {
              const cleaned = slack.availableWorkspaces.filter((w) => w.teamId !== 'T0C6YS80MPZ')
              if (cleaned.length !== slack.availableWorkspaces.length) {
                await profileStore.setAvailableWorkspaces(p.id, 'slack', cleaned)
                log.info('[profiles] isolated card-only workspace from profile availableWorkspaces', {
                  profileId: p.id
                })
              }
            }
          }
        } catch (cleanErr) {
          log.warn('[profiles] profile workspace isolation cleanup warning', { err: String(cleanErr) })
        }
        const profiles = await profileStore.list()
        for (const p of profiles) {
          const slack = p.apps.slack
          if (slack && slack.availableWorkspaces) {
            for (const ws of slack.availableWorkspaces) {
              if (
                ws.teamName &&
                (/\d+\s+new\s+items?/i.test(ws.teamName) ||
                  ws.teamName === 'unknown' ||
                  ws.teamName === '1 new item')
              ) {
                const targetName = ws.teamDomain || ws.teamId
                await profileStore.upsertAvailable(p.id, 'slack', {
                  ...ws,
                  teamName: targetName,
                  teamDomain: ws.teamDomain || 'agentworkworld'
                })
                log.info('[profiles] cleaned placeholder workspace name', {
                  profileId: p.id,
                  teamId: ws.teamId,
                  targetName
                })
              }
            }
          }
        }
      } catch (err) {
        log.warn('[profiles] self-healing workspace name check failed', { err: String(err) })
      }
    })()
    dashboardScheduler.start()
    registerLogsIpc()
    const storageCleaner = new StorageCleanerService(profileStore, dashboardMonitorStore)
    registerStorageIpc(storageCleaner)
    registerAppIpc({
      settingsStore,
      lock,
      adminAuth,
      profileStore,
      getMainWindow: () => mainWindow,
      onUserActivity: () => {
        lastEmbedActivity = Date.now()
      },
      onAdminSessionChange: (authenticated) => {
        const win = mainWindow
        if (win && !win.isDestroyed()) {
          browserViewManager.setEmbedVisible(win, authenticated && !lock.isLocked())
        }
      }
    })

    const tray = createAppTray({
      iconPath: trayIcon || icon,
      getMainWindow: () => mainWindow,
      onSelectProfile: (profileId) => {
        const win = mainWindow
        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.ProfileAuthProgress, `open-profile:${profileId}`)
          win.show()
          win.focus()
        }
      },
      onLock: () => {
        void lock.lock()
      }
    })

    browserViewManager.setActivityHandler(() => {
      lastEmbedActivity = Date.now()
    })

    browserViewManager.setUnreadHandler((counts) => {
      const win = mainWindow
      if (win && !win.isDestroyed()) {
        win.webContents.send(IpcChannels.UnreadCountsChanged, counts)
      }
      const increases: Array<{ key: string; next: number }> = []
      for (const [key, next] of Object.entries(counts)) {
        const prev = lastUnread[key] ?? 0
        if (next > prev && next > 0) {
          increases.push({ key, next })
        }
      }
      lastUnread = { ...counts }
      const total = sumUnread(counts)
      void Promise.all([profileStore.list()]).then(([profiles]) => {
        profilesNameMap = new Map(profiles.map((p) => [p.id, profileDisplayLabel(p)]))
        mutedIds = new Set(profiles.filter((p) => p.muted).map((p) => p.id))
        tray.update(profiles, total)
      })

      if (increases.length === 0) return
      for (const { key, next } of increases) {
        pendingUnreadNotices.set(key, next)
      }
      if (unreadNoticeTimer) clearTimeout(unreadNoticeTimer)
      unreadNoticeTimer = setTimeout(() => {
        unreadNoticeTimer = null
        const batch = [...pendingUnreadNotices.entries()]
        pendingUnreadNotices.clear()
        void Promise.all([profileStore.list(), settingsStore.get()]).then(
          ([profiles, settings]) => {
            profilesNameMap = new Map(profiles.map((p) => [p.id, profileDisplayLabel(p)]))
            mutedIds = new Set(profiles.filter((p) => p.muted).map((p) => p.id))
            tray.update(profiles, total)

            if (!settings.notificationsEnabled || batch.length === 0) return

            // If main application window is currently visible and focused by the user, do not show popups
            if (win && !win.isDestroyed() && win.isFocused() && win.isVisible()) {
              return
            }

            for (const [key, next] of batch) {
              const parsed = splitUnreadKey(key)
              if (!parsed) continue
              const { profileId, appId } = parsed
              if (!APP_IDS.includes(appId as AppId) || mutedIds.has(profileId)) continue
              const name = profilesNameMap.get(profileId) ?? 'Profile'
              const body = `${appLabel(appId as AppId)} · ${next} unread`

              void notifyUnreadIncrease({
                enabled: true,
                silent: !settings.notificationSound,
                title: APP_DISPLAY_NAME,
                subtitle: name,
                body,
                onClick: () => {
                  if (win && !win.isDestroyed()) {
                    win.show()
                    win.focus()
                    win.webContents.send(
                      IpcChannels.ProfileAuthProgress,
                      `open-app:${profileId}:${appId}`
                    )
                  }
                }
              })
            }
          }
        )
      }, 800)
    })

    let profilesNameMap = new Map<string, string>()
    let mutedIds = new Set<string>()
    void profileStore.list().then((list) => {
      profilesNameMap = new Map(list.map((p) => [p.id, profileDisplayLabel(p)]))
      mutedIds = new Set(list.filter((p) => p.muted).map((p) => p.id))
      tray.update(list, 0)
    })

    void profileStore.list().then(async (before) => {
      const wasStuck = before.some(
        (p) =>
          p.googleAuthStatus === 'signing-in' ||
          Object.values(p.apps).some((a) =>
            ['signing-in', 'signing-in-google', 'signing-in-slack'].includes(a.sessionStatus)
          )
      )
      await profileStore.clearStuckSigningInStatuses()
      log.info('cleared stuck signing-in statuses on launch')
      if (wasStuck) {
        setTimeout(() => {
          sendToast('Previous sign-in was interrupted — statuses were reset.')
        }, 1500)
      }
    })

    sleepTimer = setInterval(() => {
      void (async () => {
        if (getPendingChromeBrowserAuth() || getChromeStayEmbed()) return
        const settings = await settingsStore.get()
        if (!settings.idleSleepMinutes || settings.idleSleepMinutes <= 0) return
        const ms = settings.idleSleepMinutes * 60_000
        if (Date.now() - lastEmbedActivity < ms) return
        const keep = [
          browserViewManager.getActiveKey(),
          browserViewManager.getSecondaryKey()
        ].filter(Boolean) as string[]
        const win = mainWindow
        if (win && !win.isDestroyed()) {
          browserViewManager.destroyInactiveExcept(keep, win)
        }
      })()
    }, 30_000)

    createWindow()
    lock.startIdleWatch()
    log.info('app ready')

    app.on('open-url', (event, url) => {
      event.preventDefault()
      handleDeepLink(url)
    })

    const deepArg = deepLinkFromArgv(process.argv)
    if (deepArg) handleDeepLink(deepArg)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      } else {
        mainWindow?.show()
      }
    })

    app.on('before-quit', () => {
      dashboardScheduler.stop()
      lock.stopIdleWatch()
      if (sleepTimer) clearInterval(sleepTimer)
      tray.destroy()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
} // end single-instance lock

export { SlackReaderView } from './slack-reader/slack-reader-view'
