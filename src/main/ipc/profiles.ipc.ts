import { session } from 'electron'
import type { BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/ipc-contract'
import type {
  ActivateAppPayload,
  ActivateProfilePayload,
  AppId,
  AppSessionStatus,
  CreateProfileInput,
  OpenWorkspacePayload,
  PinFromAvailablePayload,
  Profile,
  ProfileIdPayload,
  StartAppLoginPayload,
  StartGoogleAuthPayload,
  SyncWorkspacesPayload,
  UnpinWorkspacePayload,
  ViewportBounds
} from '../../shared/types'
import { slackClientUrlForTeam } from '../../shared/slack-url'
import { log } from '../logging'
import type { BrowserViewManager } from '../profiles/browser-view-manager'
import type { ProfileStore } from '../profiles/profile-store'
import { partitionForProfile, partitionForCard } from '../profiles/session-partition'
import {
  cancelChromeBrowserAuth,
  closeChromeStayEmbed,
  confirmChromeBrowserAuthDone,
  runGoogleChromeBrowserLogin,
  runSlackChromeBrowserLogin,
  syncChromeBrowserBounds
} from '../profiles/chrome-browser-auth'
import {
  syncGoogleSessionToProfileCards,
  syncGoogleSessionFromProfileToCard
} from '../profiles/google-session-sync'
import { runTeamsLoginForProfile } from '../profiles/teams-first-login-flow'
import { waitForWhatsAppSignedIn } from '../profiles/whatsapp-login-flow'
import type { TokenStore } from '../slack/token-store'
import type { MonitorStore } from '../dashboard/monitor-store'
import type { AiSettingsService } from '../dashboard/ai-settings'
import { handleInvoke } from './handle'

export interface ProfileIpcDeps {
  profileStore: ProfileStore
  browserViewManager: BrowserViewManager
  tokenStore: TokenStore
  getMainWindow: () => BrowserWindow | null
  /** Called after profiles are removed so settings (e.g. recents) can be pruned. */
  onProfilesRemoved?: (profileIds: string[]) => Promise<void>
  monitorStore?: MonitorStore
  aiSettings?: AiSettingsService
  broadcastSnapshot?: () => Promise<void>
}

const inFlightLogin = new Set<string>()
/** Profiles created in this session that have not completed Google yet — safe to auto-delete on cancel. */
const freshUnsignedProfileIds = new Set<string>()

function loginKey(profileId: string, appId: AppId): string {
  return `${profileId}:${appId}`
}

function defaultBounds(mainWindow: BrowserWindow, bounds?: ViewportBounds): ViewportBounds {
  return (
    bounds ?? {
      x: 300,
      y: 0,
      width: Math.max(640, mainWindow.getContentBounds().width - 300),
      height: Math.max(480, mainWindow.getContentBounds().height)
    }
  )
}

function notifySessionStatus(
  getMainWindow: () => BrowserWindow | null,
  profileId: string,
  appId: AppId,
  sessionStatus: AppSessionStatus
): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(IpcChannels.ProfileSessionStatusChanged, {
      profileId,
      appId,
      sessionStatus
    })
  }
}

function notifyProfileUpdated(getMainWindow: () => BrowserWindow | null, profile: Profile): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(IpcChannels.ProfileUpdated, profile)
  }
}

function notifyAuthProgress(getMainWindow: () => BrowserWindow | null, message: string): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(IpcChannels.ProfileAuthProgress, message)
  }
}

async function destroyProfileFully(deps: ProfileIpcDeps, profileId: string): Promise<void> {
  const mainWindow = deps.getMainWindow()
  closeChromeStayEmbed()
  deps.browserViewManager.destroy(profileId, mainWindow ?? undefined)
  for (const appId of ['slack', 'teams', 'whatsapp'] as AppId[]) {
    await session.fromPartition(partitionForProfile(profileId, appId)).clearStorageData()
  }
  const existing = await deps.profileStore.get(profileId)
  if (existing?.customLinks && existing.customLinks.length > 0) {
    for (const link of existing.customLinks) {
      if (link.partition) {
        await session.fromPartition(link.partition).clearStorageData()
      }
    }
  }
  await deps.tokenStore.deleteForProfile(profileId)
  await deps.profileStore.delete(profileId)
  await deps.onProfilesRemoved?.([profileId])
  log.info('profile deleted', { profileId })
}

/**
 * Step 1 — email already collected: Google OAuth in real Chrome docked to the right pane.
 * Same Chrome profile dir (profileId) is reused later for Slack.
 */
async function runGoogleBrowserAuth(
  deps: ProfileIpcDeps,
  profileId: string,
  bounds?: ViewportBounds,
  options?: { deleteOrphanOnFail?: boolean }
): Promise<Profile> {
  const key = `google-browser:${profileId}`
  if (inFlightLogin.has(key)) {
    const current = await deps.profileStore.get(profileId)
    if (!current) throw new Error(`Profile not found: ${profileId}`)
    return current
  }
  inFlightLogin.add(key)
  try {
    const existing = await deps.profileStore.get(profileId)
    if (!existing) throw new Error(`Profile not found: ${profileId}`)

    // Already signed in — do not reopen Chrome / re-import cookies (that can wipe Slack).
    if (existing.googleAuthStatus === 'signed-in') {
      log.info('google auth skipped — already signed in', { profileId })
      notifyAuthProgress(deps.getMainWindow, 'Google already signed in for this profile.')
      return existing
    }

    if (existing.googleAuthStatus === 'signing-in') {
      await deps.profileStore.forceGoogleAuthStatus(profileId, 'not-signed-in')
    }

    await deps.profileStore.forceGoogleAuthStatus(profileId, 'signing-in')
    const signing = await deps.profileStore.get(profileId)
    if (signing) {
      notifyProfileUpdated(deps.getMainWindow, signing)
    }
    notifyAuthProgress(deps.getMainWindow, 'Opening Chrome…')

    const outcome = await runGoogleChromeBrowserLogin(profileId, {
      parentWindow: deps.getMainWindow(),
      loginHint: existing.displayName,
      contentBounds: bounds
    })

    if (outcome === 'signed-in') {
      freshUnsignedProfileIds.delete(profileId)
      notifyAuthProgress(deps.getMainWindow, 'Google signed in.')
      const updated = await deps.profileStore.forceGoogleAuthStatus(profileId, 'signed-in')
      notifyProfileUpdated(deps.getMainWindow, updated)

      // Propagate newly imported Google cookies to all cards belonging to this profile
      // so that OAuth "Continue with Google" flows inside each card already show the
      // authenticated account without requiring a fresh email/password entry.
      if (deps.monitorStore) {
        void deps.monitorStore.listProjects().then((projects) => {
          const cardIds = projects
            .filter((p) => p.profileId === profileId)
            .map((p) => p.id)
          return syncGoogleSessionToProfileCards(profileId, cardIds, 'slack')
        }).catch(() => undefined)
      }

      return updated
    }

    notifyAuthProgress(
      deps.getMainWindow,
      outcome === 'cancelled' ? 'Cancelled.' : 'Google sign-in did not finish.'
    )
    const updated = await deps.profileStore.forceGoogleAuthStatus(profileId, 'not-signed-in')
    notifyProfileUpdated(deps.getMainWindow, updated)

    if (
      options?.deleteOrphanOnFail &&
      freshUnsignedProfileIds.has(profileId) &&
      deps.profileStore.isUnsignedOrphan(updated)
    ) {
      freshUnsignedProfileIds.delete(profileId)
      await destroyProfileFully(deps, profileId)
    }
    return updated
  } finally {
    inFlightLogin.delete(key)
  }
}

/**
 * Step 2 — after app picker: Slack SSO in the SAME real Chrome profile,
 * then import cookies and embed in the right-pane WebContentsView.
 */
async function runSlackBrowserAuth(
  deps: ProfileIpcDeps,
  profileId: string,
  bounds?: ViewportBounds
): Promise<Profile> {
  const key = loginKey(profileId, 'slack')
  if (inFlightLogin.has(key)) {
    const current = await deps.profileStore.get(profileId)
    if (!current) throw new Error(`Profile not found: ${profileId}`)
    return current
  }

  inFlightLogin.add(key)
  try {
    const existing = await deps.profileStore.get(profileId)
    if (!existing) throw new Error(`Profile not found: ${profileId}`)

    if (existing.googleAuthStatus !== 'signed-in') {
      inFlightLogin.delete(key)
      const afterGoogle = await runGoogleBrowserAuth(deps, profileId, bounds)
      if (afterGoogle.googleAuthStatus !== 'signed-in') {
        return afterGoogle
      }
      inFlightLogin.add(key)
    }

    const current = await deps.profileStore.get(profileId)
    if (!current) throw new Error(`Profile not found: ${profileId}`)

    if (
      current.apps.slack.sessionStatus === 'signing-in-google' ||
      current.apps.slack.sessionStatus === 'signing-in-slack'
    ) {
      await deps.profileStore.forceSessionStatus(profileId, 'slack', 'not-signed-in')
    }

    const starting = await deps.profileStore.setSessionStatus(
      profileId,
      'slack',
      'signing-in-slack'
    )
    notifySessionStatus(deps.getMainWindow, profileId, 'slack', starting.apps.slack.sessionStatus)
    notifyProfileUpdated(deps.getMainWindow, starting)

    const outcome = await runSlackChromeBrowserLogin(profileId, {
      parentWindow: deps.getMainWindow(),
      loginHint: current.displayName,
      contentBounds: bounds
    })

    if (outcome !== 'signed-in') {
      const updated = await deps.profileStore.forceSessionStatus(
        profileId,
        'slack',
        'not-signed-in'
      )
      notifySessionStatus(deps.getMainWindow, profileId, 'slack', updated.apps.slack.sessionStatus)
      notifyProfileUpdated(deps.getMainWindow, updated)
      return updated
    }

    await deps.profileStore.setGoogleAuthStatus(profileId, 'signed-in')

    const mainWindow = deps.getMainWindow()
    if (!mainWindow) throw new Error('Main window is not available')
    const viewBounds = defaultBounds(mainWindow, bounds)

    // Match product flow: Slack auth in Chrome → then embed in Electron right pane (unless card embed is active).
    closeChromeStayEmbed()
    if (!deps.browserViewManager.isCardEmbedActive()) {
      deps.browserViewManager.setEmbedVisible(mainWindow, true)
      deps.browserViewManager.activate(profileId, 'slack', mainWindow, viewBounds)
    }
    void deps.browserViewManager.sampleAndEmitSlackTheme(profileId)

    const updated = await deps.profileStore.forceSessionStatus(profileId, 'slack', 'signed-in')
    notifySessionStatus(deps.getMainWindow, profileId, 'slack', updated.apps.slack.sessionStatus)
    notifyProfileUpdated(deps.getMainWindow, {
      ...updated,
      googleAuthStatus: 'signed-in'
    })
    return { ...updated, googleAuthStatus: 'signed-in' }
  } finally {
    inFlightLogin.delete(key)
  }
}

async function runTeamsLogin(
  deps: ProfileIpcDeps,
  profileId: string,
  bounds?: ViewportBounds
): Promise<Profile> {
  const key = loginKey(profileId, 'teams')
  if (inFlightLogin.has(key)) {
    const current = await deps.profileStore.get(profileId)
    if (!current) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    return current
  }

  inFlightLogin.add(key)
  try {
    const existing = await deps.profileStore.get(profileId)
    if (!existing) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    // Stuck mid-login from a previous attempt — reset so a fresh window can open.
    if (existing.apps.teams.sessionStatus === 'signing-in') {
      await deps.profileStore.forceSessionStatus(profileId, 'teams', 'not-signed-in')
    }

    const starting = await deps.profileStore.setSessionStatus(profileId, 'teams', 'signing-in')
    notifySessionStatus(deps.getMainWindow, profileId, 'teams', starting.apps.teams.sessionStatus)
    notifyProfileUpdated(deps.getMainWindow, starting)

    const mainWindow = deps.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Main window is not available')
    }
    closeChromeStayEmbed()
    const viewBounds = bounds ?? {
      x: 300,
      y: 0,
      width: Math.max(640, mainWindow.getContentBounds().width - 300),
      height: Math.max(480, mainWindow.getContentBounds().height)
    }
    deps.browserViewManager.setEmbedVisible(mainWindow, true)
    deps.browserViewManager.activate(profileId, 'teams', mainWindow, viewBounds)
    const contents = deps.browserViewManager.getWebContents(profileId, 'teams')
    if (!contents) {
      throw new Error('Teams embed is not available')
    }

    const outcome = await runTeamsLoginForProfile(profileId, {
      parentWindow: mainWindow,
      contents,
      onPhaseChange: async () => {
        notifySessionStatus(deps.getMainWindow, profileId, 'teams', 'signing-in')
      }
    })

    // Stay on signing-in until embed is ready — avoid ✓ while shell is still loading.
    if (outcome === 'signed-in') {
      notifySessionStatus(deps.getMainWindow, profileId, 'teams', 'signing-in')
      await deps.browserViewManager.ensureTeamsAppLoaded(profileId)
      const win = deps.getMainWindow()
      if (win && !win.isDestroyed()) {
        deps.browserViewManager.setEmbedVisible(win, true)
        deps.browserViewManager.activate(profileId, 'teams', win, viewBounds)
      }
      // Brief settle so the tick appears only after the embed has attached.
      await new Promise((r) => setTimeout(r, 400))
      const updated = await deps.profileStore.forceSessionStatus(profileId, 'teams', 'signed-in')
      notifySessionStatus(deps.getMainWindow, profileId, 'teams', updated.apps.teams.sessionStatus)
      notifyProfileUpdated(deps.getMainWindow, updated)
      return updated
    }

    const updated = await deps.profileStore.forceSessionStatus(profileId, 'teams', 'not-signed-in')
    notifySessionStatus(deps.getMainWindow, profileId, 'teams', updated.apps.teams.sessionStatus)
    notifyProfileUpdated(deps.getMainWindow, updated)
    return updated
  } finally {
    inFlightLogin.delete(key)
  }
}

async function runWhatsAppLogin(
  deps: ProfileIpcDeps,
  profileId: string,
  bounds?: ViewportBounds
): Promise<Profile> {
  const key = loginKey(profileId, 'whatsapp')
  if (inFlightLogin.has(key)) {
    const current = await deps.profileStore.get(profileId)
    if (!current) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    return current
  }

  inFlightLogin.add(key)
  try {
    const existing = await deps.profileStore.get(profileId)
    if (!existing) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    if (existing.apps.whatsapp.sessionStatus === 'signing-in') {
      await deps.profileStore.forceSessionStatus(profileId, 'whatsapp', 'not-signed-in')
    }

    const starting = await deps.profileStore.setSessionStatus(profileId, 'whatsapp', 'signing-in')
    notifySessionStatus(
      deps.getMainWindow,
      profileId,
      'whatsapp',
      starting.apps.whatsapp.sessionStatus
    )

    const mainWindow = deps.getMainWindow()
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }
    const viewBounds = bounds ?? {
      x: 300,
      y: 0,
      width: Math.max(640, mainWindow.getContentBounds().width - 300),
      height: Math.max(480, mainWindow.getContentBounds().height)
    }
    // Force-show embed: renderer may still have embedHidden=true from empty state.
    closeChromeStayEmbed()
    deps.browserViewManager.setEmbedVisible(mainWindow, true)
    deps.browserViewManager.activate(profileId, 'whatsapp', mainWindow, viewBounds)
    deps.browserViewManager.emitDefaultTheme(profileId, 'whatsapp')

    const contents = deps.browserViewManager.getWebContents(profileId, 'whatsapp')
    if (!contents) {
      throw new Error('WhatsApp view failed to create')
    }

    const outcome = await waitForWhatsAppSignedIn(contents, { profileId })
    const next = outcome === 'signed-in' ? 'signed-in' : 'not-signed-in'
    const updated = await deps.profileStore.forceSessionStatus(profileId, 'whatsapp', next)
    notifySessionStatus(
      deps.getMainWindow,
      profileId,
      'whatsapp',
      updated.apps.whatsapp.sessionStatus
    )
    notifyProfileUpdated(deps.getMainWindow, updated)
    return updated
  } finally {
    inFlightLogin.delete(key)
  }
}

export function registerProfileIpc(deps: ProfileIpcDeps): void {
  deps.browserViewManager.setWorkspaceSeenHandler(async (profileId, appId, workspace) => {
    try {
      const updated = await deps.profileStore.upsertAvailable(profileId, appId, workspace)
      notifyProfileUpdated(deps.getMainWindow, updated)
    } catch (err) {
      log.warn('passive workspace capture failed', { profileId, appId, err: String(err) })
    }
  })

  deps.browserViewManager.setCardWorkspaceSeenHandler(async (projectId, appId, workspace) => {
    try {
      log.info('card workspace seen', { projectId, appId, workspace })
      if (!deps.monitorStore) return

      const projects = await deps.monitorStore.listProjects()
      const project = projects.find((p) => p.id === projectId)
      if (!project) return

      // NOTE: Card logins remain strictly isolated to the card partition!
      // They do NOT leak or register into the global profile availableWorkspaces.

      // Auto-attach as an active source to this project card
      const existingSources: import('../../shared/dashboard-contract').ProjectSource[] = project.sources ?? []
      const existingIndex = existingSources.findIndex(
        (s: import('../../shared/dashboard-contract').ProjectSource) =>
          s.workspaceId === workspace.teamId && (s.profileId === project.profileId || !s.profileId)
      )

      let updatedSources = [...existingSources]
      if (existingIndex >= 0) {
        // Update workspace name / url if improved
        const current = existingSources[existingIndex]
        updatedSources[existingIndex] = {
          ...current,
          workspaceName: workspace.teamName || current.workspaceName,
          status: 'connected',
          updatedAt: new Date().toISOString()
        }
      } else {
        const now = new Date().toISOString()
        const newSource: import('../../shared/dashboard-contract').ProjectSource = {
          id: `src-card-${Date.now().toString(36)}`,
          kind: 'browser',
          platform: 'slack',
          profileId: project.profileId,
          workspaceId: workspace.teamId,
          workspaceName: workspace.teamName,
          channels: [],
          role: 'ours',
          backfillDays: 7,
          enabled: true,
          status: 'connected',
          selectionMode: 'include',
          createdAt: now,
          updatedAt: now
        }
        updatedSources.push(newSource)
      }

      const updatedProject = {
        ...project,
        sources: updatedSources,
        teamId: workspace.teamId,
        teamName: workspace.teamName || project.teamName || 'Slack Workspace'
      }

      await deps.monitorStore.upsertProject({ project: updatedProject })
      if (deps.broadcastSnapshot) {
        await deps.broadcastSnapshot()
      }
    } catch (err) {
      log.warn('card passive workspace capture failed', { projectId, appId, err: String(err) })
    }
  })

  deps.browserViewManager.setThemeHandler((payload) => {
    const win = deps.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.WorkspaceThemeChanged, payload)
    }
  })

  handleInvoke(IpcChannels.ProfileList, async () => deps.profileStore.list())

  handleInvoke(IpcChannels.ProfileCreate, async (payload: CreateProfileInput) => {
    const { profile, created } = await deps.profileStore.createOrGet(payload.displayName)
    if (created) {
      freshUnsignedProfileIds.add(profile.id)
    }
    log.info(created ? 'profile created' : 'profile reused (same email)', {
      profileId: profile.id
    })
    return profile
  })

  handleInvoke(IpcChannels.ProfileDeleteUnsignedDuplicates, async () => {
    const { deletedIds, profiles } = await deps.profileStore.deleteUnsignedDuplicates()
    for (const profileId of deletedIds) {
      const mainWindow = deps.getMainWindow()
      closeChromeStayEmbed()
      deps.browserViewManager.destroy(profileId, mainWindow ?? undefined)
      for (const appId of ['slack', 'teams', 'whatsapp'] as AppId[]) {
        await session.fromPartition(partitionForProfile(profileId, appId)).clearStorageData()
      }
      await deps.tokenStore.deleteForProfile(profileId)
    }
    if (deletedIds.length > 0) {
      await deps.onProfilesRemoved?.(deletedIds)
    }
    log.info('unsigned duplicates deleted', { count: deletedIds.length })
    return profiles
  })

  handleInvoke(IpcChannels.ProfileClearStuckAuth, async () => {
    const profiles = await deps.profileStore.clearStuckSigningInStatuses()
    for (const p of profiles) {
      notifyProfileUpdated(deps.getMainWindow, p)
    }
    return profiles
  })

  handleInvoke(IpcChannels.ProfileCancelAuthBusy, async (payload?: { profileId?: string }) => {
    cancelChromeBrowserAuth()
    const profiles = await deps.profileStore.list()
    const targets = payload?.profileId
      ? profiles.filter((p) => p.id === payload.profileId)
      : profiles
    const out: Profile[] = []
    for (const p of targets) {
      let next = p
      if (p.googleAuthStatus === 'signing-in') {
        next = await deps.profileStore.forceGoogleAuthStatus(p.id, 'not-signed-in')
      }
      for (const appId of ['slack', 'teams', 'whatsapp'] as AppId[]) {
        const st = next.apps[appId].sessionStatus
        if (st === 'signing-in' || st === 'signing-in-google' || st === 'signing-in-slack') {
          next = await deps.profileStore.forceSessionStatus(p.id, appId, 'not-signed-in')
          notifySessionStatus(deps.getMainWindow, p.id, appId, 'not-signed-in')
        }
      }
      notifyProfileUpdated(deps.getMainWindow, next)
      out.push(next)
    }
    notifyAuthProgress(deps.getMainWindow, 'Cancelled.')
    return out
  })

  handleInvoke(IpcChannels.ProfileStartGoogleAuth, async (payload: StartGoogleAuthPayload) => {
    notifyAuthProgress(deps.getMainWindow, 'Waiting for Google / 2SV…')
    return runGoogleBrowserAuth(deps, payload.profileId, payload.bounds, {
      deleteOrphanOnFail: true
    })
  })

  handleInvoke(IpcChannels.ProfileStartAppLogin, async (payload: StartAppLoginPayload) => {
    if (payload.appId === 'slack') {
      notifyAuthProgress(deps.getMainWindow, 'Waiting for Slack sign-in…')
      return runSlackBrowserAuth(deps, payload.profileId, payload.bounds)
    }
    if (payload.appId === 'teams') {
      return runTeamsLogin(deps, payload.profileId, payload.bounds)
    }
    return runWhatsAppLogin(deps, payload.profileId, payload.bounds)
  })

  // After email: Google only in Chrome docked to the right pane — then app picker, then Slack.
  handleInvoke(IpcChannels.ProfileStartFirstLogin, async (payload: StartGoogleAuthPayload) => {
    return runGoogleBrowserAuth(deps, payload.profileId, payload.bounds, {
      deleteOrphanOnFail: true
    })
  })

  handleInvoke(IpcChannels.ProfileConfirmChromeEmbed, async () => {
    return confirmChromeBrowserAuthDone()
  })

  handleInvoke(IpcChannels.ProfileCancelChromeEmbed, async () => {
    return cancelChromeBrowserAuth()
  })

  handleInvoke(IpcChannels.ProfileSyncChromeEmbedBounds, async (payload: ViewportBounds) => {
    syncChromeBrowserBounds(payload, deps.getMainWindow())
  })

  handleInvoke(IpcChannels.ProfileDelete, async (payload: ProfileIdPayload) => {
    if (payload.deleteCards && deps.monitorStore) {
      const deletedIds = await deps.monitorStore.deleteProjectsForProfile(payload.profileId)
      for (const pId of deletedIds) {
        await deps.aiSettings?.clearProject(pId)
        try {
          await session.fromPartition(partitionForCard(pId, 'slack')).clearStorageData()
        } catch {}
      }
    } else if (deps.monitorStore) {
      await deps.monitorStore.unassignProjectsForProfile(payload.profileId)
    }
    await destroyProfileFully(deps, payload.profileId)
    if (deps.broadcastSnapshot) {
      await deps.broadcastSnapshot()
    }
  })

  handleInvoke(IpcChannels.ProfileActivate, async (payload: ActivateProfilePayload) => {
    // Selecting a profile only — do not attach embed until an app is chosen.
    const profile = await deps.profileStore.get(payload.profileId)
    if (!profile) {
      throw new Error(`Profile not found: ${payload.profileId}`)
    }
    const mainWindow = deps.getMainWindow()
    closeChromeStayEmbed()
    if (mainWindow) {
      deps.browserViewManager.deactivate(mainWindow)
    }
  })

  handleInvoke(IpcChannels.ProfileActivateApp, async (payload: ActivateAppPayload) => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }
    const profile = await deps.profileStore.get(payload.profileId)
    if (!profile) {
      throw new Error(`Profile not found: ${payload.profileId}`)
    }
    const status = profile.apps[payload.appId].sessionStatus
    // WhatsApp QR and Microsoft Teams login live in the embed before link completes.
    if (status !== 'signed-in' && payload.appId !== 'whatsapp' && payload.appId !== 'teams') {
      throw new Error(`Sign in to ${payload.appId} first`)
    }

    if (payload.appId === 'slack') {
      closeChromeStayEmbed()
      deps.browserViewManager.setEmbedVisible(mainWindow, true)
      deps.browserViewManager.activate(payload.profileId, payload.appId, mainWindow, payload.bounds)
      void deps.browserViewManager.sampleAndEmitSlackTheme(payload.profileId)
      return
    }

    closeChromeStayEmbed()
    deps.browserViewManager.setEmbedVisible(mainWindow, true)
    deps.browserViewManager.activate(payload.profileId, payload.appId, mainWindow, payload.bounds)
    deps.browserViewManager.emitDefaultTheme(payload.profileId, payload.appId)
  })

  handleInvoke(IpcChannels.ProfileUpdateBounds, async (payload: ViewportBounds) => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow) {
      return
    }
    deps.browserViewManager.updateBounds(mainWindow, payload)
  })

  handleInvoke(IpcChannels.ProfileSetEmbedVisible, async (payload: { visible: boolean }) => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow) {
      return
    }
    deps.browserViewManager.setEmbedVisible(mainWindow, payload.visible)
  })

  handleInvoke(
    IpcChannels.ProfileActivateCardSlackEmbed,
    async (payload: { projectId?: string; profileId: string; teamId?: string; appId?: AppId; bounds: ViewportBounds }) => {
      const mainWindow = deps.getMainWindow()
      if (!mainWindow) {
        return
      }
      await deps.browserViewManager.activateCardSlackEmbed(
        payload.profileId,
        payload.teamId ?? '',
        mainWindow,
        payload.bounds,
        payload.appId ?? 'slack',
        payload.projectId
      )
    }
  )

  handleInvoke(
    IpcChannels.ProfileActivateCardWebEmbed,
    async (payload: {
      projectId?: string
      profileId: string
      linkId: string
      url: string
      bounds: ViewportBounds
    }) => {
      const mainWindow = deps.getMainWindow()
      if (!mainWindow) {
        return
      }
      deps.browserViewManager.activateCardWebEmbed(
        payload.projectId ?? '',
        payload.profileId,
        payload.linkId,
        payload.url,
        mainWindow,
        payload.bounds
      )
    }
  )

  handleInvoke(IpcChannels.ProfileReloadCardEmbed, async () => {
    deps.browserViewManager.reloadCardEmbed()
  })

  handleInvoke(
    IpcChannels.ProfileStartCardAppLogin,
    async (payload: { projectId: string; profileId: string; appId: AppId; bounds?: ViewportBounds }) => {
      notifyAuthProgress(deps.getMainWindow, 'Waiting for Slack sign-in for card…')
      const profile = await deps.profileStore.get(payload.profileId)
      const emailHint = profile?.displayName || undefined

      // Pre-seed Google session cookies into card partition
      await syncGoogleSessionFromProfileToCard(payload.profileId, payload.projectId, payload.appId).catch(() => undefined)

      await runSlackChromeBrowserLogin(payload.profileId, {
        parentWindow: deps.getMainWindow(),
        contentBounds: payload.bounds,
        targetPartition: partitionForCard(payload.projectId, payload.appId),
        chromeKey: `card-${payload.projectId}`,
        loginHint: emailHint
      })
      const updated = await deps.profileStore.get(payload.profileId)
      return updated || ({} as Profile)
    }
  )

  handleInvoke(
    IpcChannels.ProfileUpdateCardSlackEmbedBounds,
    async (payload: { bounds: ViewportBounds }) => {
      const mainWindow = deps.getMainWindow()
      if (!mainWindow) {
        return
      }
      deps.browserViewManager.updateCardSlackEmbedBounds(mainWindow, payload.bounds)
    }
  )

  handleInvoke(IpcChannels.ProfileClearCardSlackEmbed, async () => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow) {
      return
    }
    deps.browserViewManager.clearCardSlackEmbed(mainWindow)
  })

  handleInvoke(IpcChannels.ProfileSyncWorkspaces, async (payload: SyncWorkspacesPayload) => {
    if (payload.appId === 'whatsapp') {
      const profile = await deps.profileStore.get(payload.profileId)
      if (!profile) {
        throw new Error(`Profile not found: ${payload.profileId}`)
      }
      return profile
    }
    const mainWindow = deps.getMainWindow()
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }
    const profile = await deps.profileStore.get(payload.profileId)
    if (!profile) {
      throw new Error(`Profile not found: ${payload.profileId}`)
    }
    if (profile.apps[payload.appId].sessionStatus !== 'signed-in') {
      throw new Error('Sign in first, then sync workspaces')
    }

    // Slack can sync from the Electron embed after cookies are imported.
    deps.browserViewManager.activate(payload.profileId, payload.appId, mainWindow, payload.bounds)
    const collected = await deps.browserViewManager.syncWorkspaces(payload.profileId, payload.appId)
    const updated = await deps.profileStore.mergeAvailable(
      payload.profileId,
      payload.appId,
      collected
    )
    notifyProfileUpdated(deps.getMainWindow, updated)
    return updated
  })

  handleInvoke(IpcChannels.ProfilePinFromAvailable, async (payload: PinFromAvailablePayload) => {
    const updated = await deps.profileStore.pinFromAvailable(
      payload.profileId,
      payload.appId,
      payload.teamId
    )
    notifyProfileUpdated(deps.getMainWindow, updated)
    return updated
  })

  handleInvoke(IpcChannels.ProfileUnpinWorkspace, async (payload: UnpinWorkspacePayload) => {
    const updated = await deps.profileStore.unpinWorkspace(
      payload.profileId,
      payload.appId,
      payload.teamId
    )
    notifyProfileUpdated(deps.getMainWindow, updated)
    return updated
  })

  handleInvoke(
    IpcChannels.ProfileGetCurrentWorkspace,
    async (payload: { profileId: string; appId: AppId }) => {
      const teamId = deps.browserViewManager.getCurrentTeamId(payload.profileId, payload.appId)
      const url = deps.browserViewManager.getCurrentUrl(payload.profileId, payload.appId)
      if (!url) {
        return null
      }
      return {
        profileId: payload.profileId,
        appId: payload.appId,
        teamId: teamId ?? 'current',
        url
      }
    }
  )

  handleInvoke(IpcChannels.ProfileOpenWorkspace, async (payload: OpenWorkspacePayload) => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }
    const profile = await deps.profileStore.get(payload.profileId)
    if (!profile) {
      throw new Error(`Profile not found: ${payload.profileId}`)
    }

    const app = profile.apps[payload.appId]
    const available = app.availableWorkspaces.find((w) => w.teamId === payload.teamId)
    const pin = app.pinnedWorkspaces.find((w) => w.teamId === payload.teamId)
    const record = available ?? pin
    if (!record) {
      throw new Error('Workspace is not in Available. Click Sync workspaces first.')
    }

    const openUrl =
      record.openUrl ||
      (payload.appId === 'slack' ? slackClientUrlForTeam(record.teamId) : record.openUrl)

    if (payload.appId === 'slack') {
      closeChromeStayEmbed()
      deps.browserViewManager.setEmbedVisible(mainWindow, true)
      deps.browserViewManager.activate(payload.profileId, payload.appId, mainWindow, payload.bounds)
      await deps.browserViewManager.navigateToWorkspace(payload.profileId, payload.appId, {
        teamId: record.teamId,
        openUrl,
        teamDomain: record.teamDomain,
        teamName: record.teamName
      })
      return
    }

    closeChromeStayEmbed()
    deps.browserViewManager.activate(payload.profileId, payload.appId, mainWindow, payload.bounds)
    await deps.browserViewManager.navigateToWorkspace(payload.profileId, payload.appId, {
      teamId: record.teamId,
      openUrl,
      teamDomain: record.teamDomain,
      teamName: record.teamName
    })
  })

  handleInvoke(
    IpcChannels.ProfileSetCustomName,
    async (payload: { profileId: string; customName: string | null }) => {
      const updated = await deps.profileStore.setCustomName(payload.profileId, payload.customName)
      notifyProfileUpdated(deps.getMainWindow, updated)
      return updated
    }
  )

  handleInvoke(
    IpcChannels.ProfileSetMuted,
    async (payload: { profileId: string; muted: boolean }) => {
      const updated = await deps.profileStore.setMuted(payload.profileId, payload.muted)
      notifyProfileUpdated(deps.getMainWindow, updated)
      return updated
    }
  )

  handleInvoke(IpcChannels.ProfileReorder, async (payload: { orderedIds: string[] }) => {
    const profiles = await deps.profileStore.reorder(payload.orderedIds)
    for (const p of profiles) notifyProfileUpdated(deps.getMainWindow, p)
    return profiles
  })

  handleInvoke(IpcChannels.ProfileClearAll, async () => {
    const ids = await deps.profileStore.clearAllProfiles()
    const mainWindow = deps.getMainWindow()
    closeChromeStayEmbed()
    for (const profileId of ids) {
      deps.browserViewManager.destroy(profileId, mainWindow ?? undefined)
      for (const appId of ['slack', 'teams', 'whatsapp'] as AppId[]) {
        await session.fromPartition(partitionForProfile(profileId, appId)).clearStorageData()
      }
      const existing = await deps.profileStore.get(profileId)
      if (existing?.customLinks && existing.customLinks.length > 0) {
        for (const link of existing.customLinks) {
          if (link.partition) {
            await session.fromPartition(link.partition).clearStorageData()
          }
        }
      }
      await deps.tokenStore.deleteForProfile(profileId)
    }
    await deps.onProfilesRemoved?.(ids)
    log.info('all profiles cleared', { count: ids.length })
    return []
  })

  handleInvoke(IpcChannels.ProfileExportMetadata, async () => {
    return deps.profileStore.exportMetadata()
  })

  handleInvoke(IpcChannels.ProfileImportMetadata, async (payload: { profiles: Profile[] }) => {
    const profiles = await deps.profileStore.importMetadata(payload.profiles ?? [])
    return profiles
  })

  handleInvoke(
    IpcChannels.ProfileActivateSplit,
    async (payload: {
      primary: { profileId: string; appId: AppId; bounds: ViewportBounds }
      secondary: { profileId: string; appId: AppId; bounds: ViewportBounds }
    }) => {
      const mainWindow = deps.getMainWindow()
      if (!mainWindow) throw new Error('Main window is not available')
      closeChromeStayEmbed()
      deps.browserViewManager.setEmbedVisible(mainWindow, true)
      deps.browserViewManager.activate(
        payload.primary.profileId,
        payload.primary.appId,
        mainWindow,
        payload.primary.bounds
      )
      deps.browserViewManager.activateSecondary(
        payload.secondary.profileId,
        payload.secondary.appId,
        mainWindow,
        payload.secondary.bounds
      )
    }
  )

  handleInvoke(IpcChannels.ProfileClearSplit, async () => {
    const mainWindow = deps.getMainWindow()
    if (mainWindow) deps.browserViewManager.clearSecondary(mainWindow)
  })

  handleInvoke(
    IpcChannels.ProfileAddCustomLink,
    async (payload: { profileId: string; link: { name: string; url: string } }) => {
      const updated = await deps.profileStore.addCustomLink(payload.profileId, payload.link)
      notifyProfileUpdated(deps.getMainWindow, updated)
      return updated
    }
  )

  handleInvoke(
    IpcChannels.ProfileUpdateCustomLink,
    async (payload: {
      profileId: string
      linkId: string
      patch: { name?: string; url?: string }
    }) => {
      const updated = await deps.profileStore.updateCustomLink(
        payload.profileId,
        payload.linkId,
        payload.patch
      )
      notifyProfileUpdated(deps.getMainWindow, updated)
      return updated
    }
  )

  handleInvoke(
    IpcChannels.ProfileRemoveCustomLink,
    async (payload: { profileId: string; linkId: string }) => {
      const existing = await deps.profileStore.get(payload.profileId)
      const targetLink = existing?.customLinks?.find((l) => l.id === payload.linkId)
      if (targetLink?.partition) {
        await session.fromPartition(targetLink.partition).clearStorageData()
      }
      const updated = await deps.profileStore.removeCustomLink(payload.profileId, payload.linkId)
      notifyProfileUpdated(deps.getMainWindow, updated)
      return updated
    }
  )

  handleInvoke(
    IpcChannels.ProfileReorderCustomLinks,
    async (payload: { profileId: string; orderedIds: string[] }) => {
      const updated = await deps.profileStore.reorderCustomLinks(
        payload.profileId,
        payload.orderedIds
      )
      notifyProfileUpdated(deps.getMainWindow, updated)
      return updated
    }
  )

  handleInvoke(
    IpcChannels.ProfileListCustomLinks,
    async (payload: { profileId: string }) => {
      return deps.profileStore.listCustomLinks(payload.profileId)
    }
  )

  handleInvoke(
    IpcChannels.ProfileSetHiddenInSidebar,
    async (payload: { profileId: string; hidden: boolean }) => {
      const updated = await deps.profileStore.setSidebarVisibility(payload.profileId, payload.hidden)
      notifyProfileUpdated(deps.getMainWindow, updated)
      return updated
    }
  )

  handleInvoke(
    IpcChannels.ProfileSetAccountScope,
    async (payload: { profileId: string; scope: import('../../shared/types').ProfileScope }) => {
      const updated = await deps.profileStore.setAccountScope(payload.profileId, payload.scope)
      notifyProfileUpdated(deps.getMainWindow, updated)
      return updated
    }
  )

  handleInvoke(
    IpcChannels.ProfileSetLinkHiddenInSidebar,
    async (payload: { profileId: string; linkId: string; hidden: boolean }) => {
      const updated = await deps.profileStore.setLinkSidebarVisibility(
        payload.profileId,
        payload.linkId,
        payload.hidden
      )
      notifyProfileUpdated(deps.getMainWindow, updated)
      return updated
    }
  )

  handleInvoke(
    IpcChannels.ProfileActivateCustomLink,
    async (payload: {
      profileId: string
      linkId: string
      url: string
      bounds: ViewportBounds
    }) => {
      const mainWindow = deps.getMainWindow()
      if (!mainWindow) throw new Error('Main window is not available')
      closeChromeStayEmbed()
      deps.browserViewManager.setEmbedVisible(mainWindow, true)
      deps.browserViewManager.activateCustomLink(
        payload.profileId,
        payload.linkId,
        payload.url,
        mainWindow,
        payload.bounds
      )
    }
  )
}
