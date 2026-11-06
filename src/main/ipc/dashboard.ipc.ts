import { BrowserWindow, session } from 'electron'
import type { WebContentsView } from 'electron'
import { partitionForCard } from '../profiles/session-partition'
import { syncGoogleSessionFromProfileToCard } from '../profiles/google-session-sync'
import { seedChromeCardProfile } from '../profiles/chrome-browser-auth'
import { IpcChannels } from '../../shared/ipc-contract'
import type {
  DashboardAiModelsQueryPayload,
  DashboardAiModelsResult,
  DashboardAiSettingsQueryPayload,
  DashboardAiSettingsSavePayload,
  DashboardAiSettingsView,
  DashboardAiTestResult,
  DashboardGlobalConfig,
  DashboardProjectDefaults,
  DashboardManualToken,
  DashboardChatPage,
  DashboardChatQueryPayload,
  DashboardChatTokenStatus,
  DashboardProjectChatPayload,
  DashboardProjectActivity,
  DashboardListChannelsPayload,
  DashboardDiscoverSourceChannelsPayload,
  DashboardDiscoverSourceChannelsResult,
  DashboardUpdateSourcePayload,
  DashboardUpdateSourceResult,
  DashboardMarkViewedPayload,
  DashboardRunSchedulePayload,
  DashboardSendMessagePayload,
  DashboardSendMessageResult,
  DashboardSendAgentMessagePayload,
  DashboardSendAgentMessageResult,
  DashboardSnapshot,
  DashboardSyncProgressPayload,
  DashboardUpdateSchedulePayload,
  DashboardScrapePayload,
  DashboardCancelScrapePayload,
  DashboardSourceSchedulePayload,
  DashboardSourceScheduleState,
  DashboardChannelHistoryPayload,
  DashboardChannelHistoryResult,
  ProjectSource,
  ScrapeRunQuery,
  DashboardTeamWorkspaceCandidate,
  DashboardTeamWorkspaceChannelsPayload,
  DashboardTeamWorkspaceConnectPayload,
  ManualTokenPayload,
  ProjectDeletePayload,
  ProjectUpsertPayload,
  RecentActivity,
  ValidateTokenResultPayload,
  ProjectSidebarState,
  SidebarState
} from '../../shared/dashboard-contract'
import type { AiSettingsService } from '../dashboard/ai-settings'
import type { DashboardSyncEngine } from '../dashboard/sync-engine'
import type { DashboardScheduler } from '../dashboard/scheduler'
import type { MonitorStore } from '../dashboard/monitor-store'
import type { WorkspaceMappingStore } from '../dashboard/workspace-mapping-store'
import type { DashboardChatService } from '../dashboard/chat-service'
import { SlackPoller } from '../dashboard/slack-poller'
import { listChannels } from '../slack/slack-api-client'
import type { SlackChannelSummary } from '../../shared/types'
import { handleInvoke, handleInvokeWithEvent } from './handle'
import type { HistoryStore } from '../dashboard/history-store'
import type { DashboardSidebarStateStore } from '../dashboard/sidebar-state'
import { maskToken, type TeamWorkspaceStore } from '../dashboard/team-workspace-store'
import type { ConfigService } from '../dashboard/config-service'
import type { ProjectChatService, ProjectChatSink } from '../dashboard/project-chat-service'
import { describeMissingScopes, missingSlackScopes } from '../dashboard/slack-scopes'
import type { DashboardViewedStore } from '../dashboard/viewed-store'
import { RunLogStore } from '../dashboard/run-log-store'
import type { DashboardDeltaStore } from '../dashboard/delta-store'
import { SlackReaderView } from '../slack-reader/slack-reader-view'
import { sessionTokenExtractor } from '../slack-reader/session-token-extractor'
import { SlackApiClient } from '../dashboard/slack-api-client'
import { log } from '../logging'

export interface DashboardIpcDeps {
  monitorStore: MonitorStore
  engine: DashboardSyncEngine
  deltaStore?: DashboardDeltaStore
  runLogStore?: RunLogStore
  scheduler: DashboardScheduler
  getMainWindow: () => BrowserWindow | null
  oauthTokenProvider: { tryGet(profileId: string, teamId: string): Promise<string | null> }
  /** v2.2 — insight history (optional, additive) */
  historyStore?: HistoryStore
  /** v2.3 — the "Recent" strip feed (built from local data, no LLM call) */
  buildRecent?: () => Promise<RecentActivity[]>
  /** v2.3 — the top digest across workspaces */
  getDigest?: () => Promise<DashboardSnapshot['digest']>
  /** v2.4 — sidebar state per project */
  sidebarStateStore?: DashboardSidebarStateStore
  /** v2.6 — Slack Chat tab (local history + replies) */
  chatService?: DashboardChatService
  projectChatService?: ProjectChatService
  /** v2.7 — global + per-project AI provider settings */
  aiSettings?: AiSettingsService
  /** v2.8 — one effective config resolver for Slack + AI */
  configService?: ConfigService
  /** v3 — the one team workspace shared by every card */
  teamWorkspace?: TeamWorkspaceStore
  /** v3 — workspaces the app can already reach, offered when connecting ours */
  listTeamWorkspaceCandidates?: () => Promise<DashboardTeamWorkspaceCandidate[]>
  /** Phase 3 — workspace → cards mapping store */
  workspaceMapping?: WorkspaceMappingStore
  /** Phase A — when a card's Dashboard was last looked at */
  viewedStore?: DashboardViewedStore
  /** Reuse the card/profile's live Slack view for passive channel discovery. */
  getExistingCardView?: (projectId: string, appId: string) => WebContentsView | null
  getExistingProfileView?: (profileId: string, appId: string) => WebContentsView | null
}

export interface DashboardIpcRegistration {
  /** dispose of progress subscription (useful in tests) */
  dispose: () => void
}

export function registerDashboardIpc(deps: DashboardIpcDeps): DashboardIpcRegistration {
  const broadcast = (channel: string, payload: unknown, excludeDestroyed = true): void => {
    void excludeDestroyed
    const win = deps.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }

  const broadcastSnapshot = async (): Promise<DashboardSnapshot> => {
    deps.chatService?.invalidateActivityCache()
    const snapshot = await publicSnapshot()
    broadcast(IpcChannels.DashboardSnapshotChanged, snapshot)
    return snapshot
  }

  deps.scheduler.setBroadcastSnapshot?.(async () => {
    await broadcastSnapshot()
  })

  const publicSnapshot = async (): Promise<DashboardSnapshot> => {
    const projects = await deps.engine.buildSnapshot()
    const manualTokens = (await deps.monitorStore.listManualTokens()).map(
      (t: { key: string; persisted: boolean }): DashboardManualToken => ({
        key: t.key,
        validated: t.persisted
      })
    )
    return {
      projects,
      manualTokens,
      syncIntervalSeconds:
        (await deps.scheduler.getState()).settings.slackSync.intervalMinutes * 60,
      digest: deps.getDigest ? await deps.getDigest() : null,
      pinnedOrder: await deps.monitorStore.readPinnedOrder()
    }
  }

  const broadcastConfigChanged = async (): Promise<void> => {
    if (!deps.configService) return
    broadcast(IpcChannels.DashboardConfigChanged, await deps.configService.publicGlobalConfig())
  }

  handleInvoke(IpcChannels.DashboardGetSnapshot, async () => publicSnapshot())

  handleInvoke(
    IpcChannels.DashboardMarkViewed,
    async (payload: DashboardMarkViewedPayload): Promise<string> => {
      if (!deps.viewedStore) throw new Error('Dashboard viewing state is unavailable.')
      const projectId = String(payload?.projectId ?? '').trim()
      if (!projectId) throw new Error('A project id is required.')
      return deps.viewedStore.markViewed(projectId, payload.atIso)
    }
  )

  handleInvoke(IpcChannels.DashboardSchedulesGet, async () => deps.scheduler.getState())

  handleInvoke(
    IpcChannels.DashboardSchedulesUpdate,
    async (payload: DashboardUpdateSchedulePayload) => deps.scheduler.updateSettings(payload ?? {})
  )

  handleInvoke(IpcChannels.DashboardSchedulesRun, async (payload: DashboardRunSchedulePayload) => {
    if (payload?.kind !== 'slack-sync' && payload?.kind !== 'daily-recheck') {
      throw new Error('Unknown schedule.')
    }
    return deps.scheduler.runNow(payload.kind)
  })

  handleInvoke(
    IpcChannels.DashboardListChannels,
    async (payload: DashboardListChannelsPayload): Promise<SlackChannelSummary[]> => {
      let token: string | null = null
      if (payload.source === 'ours') {
        const connection = await deps.teamWorkspace?.getConnection()
        if (!connection) return []
        token =
          connection.token ??
          (await deps.oauthTokenProvider.tryGet(connection.profileId, connection.teamId))
      } else if (payload.tokenSource === 'manual') {
        token = payload.manualTokenKey
          ? await deps.monitorStore.getManualToken(payload.manualTokenKey)
          : null
      } else if (payload.profileId && payload.teamId) {
        token = await deps.oauthTokenProvider.tryGet(payload.profileId, payload.teamId)
      }
      if (!token) return []
      return listChannels(token)
    }
  )

  handleInvoke(
    IpcChannels.DashboardDiscoverSourceChannels,
    async (
      payload: DashboardDiscoverSourceChannelsPayload
    ): Promise<DashboardDiscoverSourceChannelsResult> => {
      const projects = await deps.monitorStore.listProjects()
      const project = payload.projectId
        ? projects.find((p) => p.id === payload.projectId)
        : undefined
      if (payload.projectId && !project) return { channels: [], error: 'Project not found' }
      const source = project
        ? (project.sources ?? []).find((s) => s.id === payload.sourceId)
        : undefined
      const profileId = source?.profileId || payload.profileId || project?.profileId
      const workspaceId = source?.workspaceId || payload.workspaceId || project?.teamId
      if (!workspaceId) return { channels: [], error: 'Workspace not found' }
      if (source && source.kind !== 'browser') {
        return { channels: [], error: 'Channel discovery is only available for browser sources' }
      }
      if (!profileId) {
        return { channels: [], error: 'Profile not found — log in to Slack first' }
      }

      const existingView =
        (payload.projectId
          ? deps.getExistingCardView?.(payload.projectId, 'slack')
          : null) ??
        deps.getExistingProfileView?.(profileId, 'slack') ??
        null

      // 1. Direct API discovery: Fast, Zero-DOM, queries conversations.list directly
      const candidatePartitions = [
        payload.projectId ? `persist:card-${payload.projectId}-slack` : undefined,
        `persist:profile-${profileId}-slack`,
        `persist:partition-${profileId}`
      ].filter(Boolean) as string[]

      const existingViews = existingView ? [existingView] : []
      const cacheKey = `slack:session:${profileId}:${workspaceId}`

      try {
        const creds = await sessionTokenExtractor.extractSlackSessionTokens(
          existingViews,
          cacheKey,
          { partitions: candidatePartitions }
        )
        if (creds) {
          const client = new SlackApiClient(creds)
          // Also warm up workspace user names so user IDs resolve
          void client.loadWorkspaceUsers().catch(() => {})
          const discovered = await client.listWorkspaceChannels()
          if (discovered.length > 0) {
            return {
              channels: discovered.map((channel) => ({
                id: channel.id,
                name: channel.name,
                isPrivate: channel.isPrivate,
                isDm: channel.isDm,
                kind: channel.kind,
                enabled: false,
                memberCount: channel.memberCount
              }))
            }
          }
        }
      } catch (err: any) {
        log.info('[dashboard-ipc] direct API channel discovery fallback to DOM:', {
          error: err?.message
        })
      }

      // 2. Fallback to browser DOM reader if direct API was unable to discover channels
      const reader = new SlackReaderView({
        profileId,
        workspaceId,
        projectId: payload.projectId,
        existingView
      })
      try {
        if (!existingView) {
          await reader.initialize()
          const bgView = reader.getView()
          if (
            bgView &&
            !bgView.webContents.isDestroyed() &&
            !bgView.webContents.getURL().includes('slack.com')
          ) {
            const targetUrl = `https://app.slack.com/client/${workspaceId}`
            try {
              await bgView.webContents.loadURL(targetUrl)
              await reader.waitForContent(8000)
            } catch {
              // ignore
            }
          }
        }
        const discovered = await reader.listChannels()
        if (discovered.length === 0) {
          return {
            channels: [],
            error: 'No channels visible. Log in to Slack in this card, then retry discovery.'
          }
        }
        return {
          channels: discovered.map((channel) => ({
            id: channel.id,
            name: channel.name,
            isPrivate: channel.isPrivate,
            isDm: channel.isDm,
            kind: channel.isDm
              ? 'dm'
              : channel.isPrivate
                ? 'private'
                : 'public',
            enabled: false,
            created: channel.created,
            memberCount: channel.memberCount
          }))
        }
      } catch (err) {
        return {
          channels: [],
          error: err instanceof Error ? err.message : 'Channel discovery failed'
        }
      } finally {
        reader.destroy()
      }
    }
  )

  handleInvoke(
    IpcChannels.DashboardUpdateSource,
    async (payload: DashboardUpdateSourcePayload): Promise<DashboardUpdateSourceResult> => {
      const patch: Partial<ProjectSource> = { ...payload.patch }
      delete (patch as { id?: string }).id
      delete (patch as { createdAt?: string }).createdAt
      delete (patch as { updatedAt?: string }).updatedAt
      const source = await deps.monitorStore.updateSource(
        payload.projectId,
        payload.sourceId,
        patch
      )
      const snapshot = await broadcastSnapshot()

      // When channels are updated, immediately trigger an instant background scrape of the newly selected channels
      if (patch.channels) {
        void deps.engine
          .syncProjectSource(payload.projectId, payload.sourceId, { trigger: 'manual' })
          .catch(() => {})
      }

      return { source, snapshot }
    }
  )

  handleInvoke(
    IpcChannels.DashboardViewSet,
    async (payload: { open: boolean; appId?: string | null }) => {
      /* the renderer tracks view-state itself; reserve for future main-side needs */
      void payload
      return { ok: true }
    }
  )

  handleInvoke(
    IpcChannels.DashboardPinnedOrderSet,
    async (payload: { order?: unknown }): Promise<DashboardSnapshot> => {
      const order = Array.isArray(payload?.order)
        ? payload.order.filter((id): id is string => typeof id === 'string')
        : []
      await deps.monitorStore.setPinnedOrder(order)
      return broadcastSnapshot()
    }
  )

  handleInvoke(IpcChannels.DashboardUpsertProject, async (payload: ProjectUpsertPayload) => {
    const proj = await deps.monitorStore.upsertProject(payload)
    if (deps.workspaceMapping) {
      const workspaceIds = new Set<string>()
      for (const s of proj.sources ?? []) {
        if (s.workspaceId) workspaceIds.add(s.workspaceId)
      }
      if (workspaceIds.size === 0 && proj.teamId && proj.tokenSource !== 'manual') {
        workspaceIds.add(proj.teamId)
      }
      await deps.workspaceMapping.syncProjectWorkspaces(proj.id, workspaceIds)
    }

    // Immediately seed the profile's authenticated Google session into this card
    if (proj.profileId && proj.id) {
      void syncGoogleSessionFromProfileToCard(proj.profileId, proj.id, 'slack').catch(() => undefined)
      seedChromeCardProfile(proj.profileId, `card-${proj.id}`)
    }

    await broadcastConfigChanged()
    return broadcastSnapshot()
  })

  handleInvoke(IpcChannels.DashboardDeleteProject, async (payload: ProjectDeletePayload) => {
    await deps.monitorStore.deleteProject(payload.projectId)
    await deps.aiSettings?.clearProject(payload.projectId)
    try {
      await session.fromPartition(partitionForCard(payload.projectId, 'slack')).clearStorageData()
    } catch {}
    return broadcastSnapshot()
  })

  handleInvoke(
    IpcChannels.DashboardSyncNow,
    async (payload: { projectId?: string } | undefined) => {
      if (payload?.projectId) {
        await deps.engine.syncProject(payload.projectId)
      } else {
        await deps.engine.syncAll()
      }
      return broadcastSnapshot()
    }
  )

  handleInvoke(
    IpcChannels.DashboardSyncSource,
    async (payload: DashboardScrapePayload) => {
      const res = await deps.engine.syncProjectSource(payload.projectId, payload.sourceId, {
        trigger: payload.trigger,
        options: payload.options
      })
      if (res.newMessages > 0) {
        deps.chatService?.invalidateActivityCache(payload.projectId)
      }
      await broadcastSnapshot()
      return res
    }
  )

  handleInvoke(
    IpcChannels.DashboardCancelScrape,
    async (payload: DashboardCancelScrapePayload) => {
      const cancelled = deps.engine.cancelScrape(payload)
      return { ok: cancelled > 0, cancelled }
    }
  )

  handleInvoke(
    IpcChannels.DashboardSetSourceSchedule,
    async (payload: DashboardSourceSchedulePayload): Promise<DashboardSourceScheduleState> => {
      const projects = await deps.monitorStore.listProjects()
      const project = projects.find((p) => p.id === payload.projectId)
      if (!project) throw new Error('Project not found')
      const patch: Partial<ProjectSource> = {}
      if (payload.scheduleEnabled !== undefined) patch.scheduleEnabled = payload.scheduleEnabled
      if (payload.scheduleIntervalMinutes !== undefined) {
        patch.scheduleIntervalMinutes = payload.scheduleIntervalMinutes
      }
      if (payload.backfillHours !== undefined) patch.backfillHours = payload.backfillHours
      if (payload.allowDms !== undefined) patch.allowDms = payload.allowDms
      if (payload.selectedPeople !== undefined) patch.selectedPeople = payload.selectedPeople
      const updated = await deps.monitorStore.updateSource(
        payload.projectId,
        payload.sourceId,
        patch
      )
      await broadcastSnapshot()
      const interval = updated.scheduleIntervalMinutes ?? 15
      const lastRunAt = updated.lastScrapeAt ?? updated.lastReadAt ?? null
      const scheduleEnabled = updated.scheduleEnabled === true
      if (
        payload.scheduleEnabled === true &&
        scheduleEnabled &&
        updated.enabled !== false &&
        updated.channelsReviewedAt
      ) {
        // Turning a schedule on means "start now", not "wait one interval".
        void deps.engine
          .syncProjectSource(payload.projectId, updated.id, { trigger: 'scheduled' })
          .catch(() => undefined)
      }
      return {
        projectId: project.id,
        projectName: project.name,
        sourceId: updated.id,
        workspaceName: updated.workspaceName || updated.workspaceId,
        enabled: updated.enabled !== false,
        scheduleEnabled,
        intervalMinutes: interval,
        lastRunAt,
        lastStatus: updated.lastScrapeStatus,
        nextRunAt:
          scheduleEnabled && lastRunAt
            ? new Date(new Date(lastRunAt).getTime() + interval * 60_000).toISOString()
            : scheduleEnabled
              ? new Date(Date.now() + interval * 60_000).toISOString()
              : null,
        running: deps.engine.isSourceRunning(updated.id)
      }
    }
  )

  handleInvoke(
    IpcChannels.DashboardGetRunLogs,
    async (payload: ScrapeRunQuery & { projectId: string }) => {
      const query: ScrapeRunQuery = {
        limit: payload.limit,
        status: payload.status,
        trigger: payload.trigger
      }
      if (deps.runLogStore) {
        const rows = await deps.runLogStore.read(payload.projectId, payload.limit ?? 50)
        return filterRuns(rows, query)
      }
      if (deps.deltaStore?.rootDir) {
        const store = new RunLogStore({ rootDir: deps.deltaStore.rootDir })
        const rows = await store.read(payload.projectId, payload.limit ?? 50)
        return filterRuns(rows, query)
      }
      return []
    }
  )

  handleInvoke(IpcChannels.DashboardGetScrapeRuns, async (payload: ScrapeRunQuery) => {
    const store = deps.runLogStore ?? (deps.deltaStore?.rootDir ? new RunLogStore({ rootDir: deps.deltaStore.rootDir }) : null)
    if (!store) return []
    if (payload.projectId) {
      return filterRuns(await store.read(payload.projectId, payload.limit ?? 100), payload)
    }
    const projects = await deps.monitorStore.listProjects()
    return store.readMany(
      projects.map((project) => project.id),
      payload
    )
  })

  handleInvoke(
    IpcChannels.DashboardGetChannelHistory,
    async (payload: DashboardChannelHistoryPayload): Promise<DashboardChannelHistoryResult[]> => {
      const projects = await deps.monitorStore.listProjects()
      const project = projects.find((p) => p.id === payload.projectId)
      if (!project || !deps.deltaStore) return []

      const results: DashboardChannelHistoryResult[] = []
      const personRoles = project.personRoles || {}

      for (const source of project.sources ?? []) {
        if (!source.profileId || !source.workspaceId) continue
        for (const ch of source.channels ?? []) {
          if (payload.channelId && ch.id !== payload.channelId) continue
          const delta = await deps.deltaStore.load(source.profileId, source.workspaceId, ch.id)
          if (!delta) continue

          const messages = delta.messages.map((m) => {
            const who = (m.user || 'unknown').trim()
            const role =
              personRoles[who.toLowerCase()] ||
              (project.selfUserId && m.user === project.selfUserId
                ? 'me'
                : 'client')
            return {
              ...m,
              role
            }
          })

          results.push({
            channelId: ch.id,
            channelName: delta.channel.name || ch.name || ch.id,
            messages,
            cursor: delta.cursor,
            lastSyncAt: delta.lastSyncAt
          })
        }
      }

      return results
    }
  )

  handleInvoke(
    IpcChannels.DashboardUploadDocument,
    async (payload: {
      projectId: string
      name: string
      mimeType: string
      dataBase64: string
    }) => {
      try {
        const { extractTextFromBuffer } = await import('../dashboard/document-parser')
        const buf = Buffer.from(payload.dataBase64, 'base64')
        const extractedText = extractTextFromBuffer(payload.name, buf)

        const doc: import('../../shared/dashboard-contract').ProjectDocument = {
          id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: payload.name,
          mimeType: payload.mimeType || 'application/octet-stream',
          sizeBytes: buf.length,
          uploadedAt: new Date().toISOString(),
          extractedText
        }

        const projects = await deps.monitorStore.listProjects()
        const project = projects.find((p) => p.id === payload.projectId)
        if (!project) return { ok: false, error: 'Project not found' }

        const documents = [...(project.documents || []), doc]
        await deps.monitorStore.upsertProject({
          project: {
            ...project,
            documents
          }
        })

        // Trigger asynchronous insight refresh with the new document context
        void deps.engine.refreshProjectSnapshot(project.id).catch(() => undefined)

        return { ok: true, document: doc }
      } catch (err: any) {
        return { ok: false, error: err?.message || 'Failed to upload document' }
      }
    }
  )

  handleInvoke(
    IpcChannels.DashboardListDocuments,
    async (payload: { projectId: string }) => {
      const projects = await deps.monitorStore.listProjects()
      const project = projects.find((p) => p.id === payload.projectId)
      return project?.documents || []
    }
  )

  handleInvoke(
    IpcChannels.DashboardDeleteDocument,
    async (payload: { projectId: string; documentId: string }) => {
      const projects = await deps.monitorStore.listProjects()
      const project = projects.find((p) => p.id === payload.projectId)
      if (!project) return { ok: false, error: 'Project not found' }

      const documents = (project.documents || []).filter((d) => d.id !== payload.documentId)
      await deps.monitorStore.upsertProject({
        project: {
          ...project,
          documents
        }
      })

      void deps.engine.refreshProjectSnapshot(project.id).catch(() => undefined)
      return { ok: true }
    }
  )

  // Wire scrape event listener to broadcast events to renderer for Watch Live overlay
  deps.engine.setScrapeEventListener((event) => {
    broadcast(IpcChannels.DashboardScrapeEvent, event)
  })

  handleInvoke(
    IpcChannels.DashboardStartWatchLive,
    async (payload: {
      projectId: string
      bounds: { x: number; y: number; width: number; height: number }
    }) => {
      const win = deps.getMainWindow()
      const reader = deps.engine.getActiveWatchReader()
      if (reader && win && !win.isDestroyed()) {
        const view = reader.getView()
        if (view) {
          if (!win.contentView.children.includes(view)) {
            win.contentView.addChildView(view)
          }
          view.setBounds(payload.bounds)
          return { ok: true }
        }
      }
      return { ok: false, error: 'No active reader view running right now.' }
    }
  )

  handleInvoke(IpcChannels.DashboardStopWatchLive, async () => {
    const win = deps.getMainWindow()
    const reader = deps.engine.getActiveWatchReader()
    if (reader && win && !win.isDestroyed()) {
      const view = reader.getView()
      if (view && win.contentView.children.includes(view)) {
        win.contentView.removeChildView(view)
        view.setBounds({ x: -10000, y: -10000, width: 1280, height: 800 })
      }
    }
  })

  handleInvoke(IpcChannels.DashboardGetAppConfig, async () => ({
    clientId: process.env.SLACK_CLIENT_ID ?? '',
    redirectUri: process.env.SLACK_REDIRECT_URI ?? ''
  }))

  handleInvoke(
    IpcChannels.DashboardGetHistory,
    async (payload: { projectId: string }) =>
      (await deps.historyStore?.read(payload.projectId)) ?? []
  )

  handleInvoke(
    IpcChannels.DashboardGetRecent,
    async (): Promise<RecentActivity[]> => (await deps.buildRecent?.()) ?? []
  )

  handleInvoke(IpcChannels.DashboardAddManualToken, async (payload: ManualTokenPayload) => {
    const poller = new SlackPoller()
    let validated = false
    let valid = false
    let error: string | undefined
    let vaultTeamName: string | undefined
    let vaultTeamId: string | undefined
    let vaultUserName: string | undefined
    let vaultUserId: string | undefined
    let vaultScopes: string[] | undefined
    try {
      const check = await poller.authTest(payload.token)
      validated = true
      if (!check.valid) {
        error = check.error ?? 'Slack rejected this token'
      } else {
        const meta =
          check.teamId && check.teamName
            ? {
                teamId: check.teamId,
                teamName: check.teamName,
                userName: check.userName,
                userId: check.userId
              }
            : undefined
        const stored = await deps.monitorStore.saveManualToken(payload.key, payload.token, meta)
        if (!stored.plaintext)
          console.info(`[dashboard] manual token ${payload.key} stored encrypted in vault`)
        valid = true
        if (check.teamName) vaultTeamName = check.teamName
        if (check.teamId) vaultTeamId = check.teamId
        if (check.userName) vaultUserName = check.userName
        if (check.userId) vaultUserId = check.userId
        if (check.scopes) vaultScopes = check.scopes
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'token validation failed'
    }
    const vault: ValidateTokenResultPayload = {
      key: payload.key,
      validated,
      valid,
      error,
      teamId: vaultTeamId,
      teamName: vaultTeamName,
      userName: vaultUserName,
      userId: vaultUserId,
      scopes: vaultScopes
    }
    await broadcastSnapshot()
    return vault
  })

  const onProgress = (payload: DashboardSyncProgressPayload): void => {
    broadcast(IpcChannels.DashboardSyncProgress, payload)
  }

  const unsubscribeProgress = deps.engine.addProgressListener(onProgress)

  // v2.4 — Sidebar state per project
  if (deps.sidebarStateStore) {
    handleInvoke(IpcChannels.DashboardSidebarGet, async (payload: { projectId: string }) =>
      deps.sidebarStateStore!.get(payload.projectId)
    )

    handleInvoke(
      IpcChannels.DashboardSidebarSet,
      async (payload: { projectId: string; state: ProjectSidebarState }) => {
        await deps.sidebarStateStore!.set(payload.projectId, payload.state)
      }
    )

    handleInvoke(
      IpcChannels.DashboardSidebarUpdate,
      async (payload: {
        projectId: string
        sidebar: 'left' | 'right'
        patch: Partial<SidebarState>
      }) => {
        if (payload.sidebar === 'left') {
          return deps.sidebarStateStore!.updateLeft(payload.projectId, payload.patch)
        } else {
          return deps.sidebarStateStore!.updateRight(payload.projectId, payload.patch)
        }
      }
    )
  }

  // v2.6 — Slack Chat tab: local message history + replies (chat.postMessage)
  if (deps.chatService) {
    handleInvoke(
      IpcChannels.DashboardGetMessages,
      async (payload: DashboardChatQueryPayload): Promise<DashboardChatPage> =>
        deps.chatService!.loadMessages(payload)
    )
    handleInvoke(
      IpcChannels.DashboardSendMessage,
      async (payload: DashboardSendMessagePayload): Promise<DashboardSendMessageResult> =>
        deps.chatService!.sendMessage(payload)
    )
    handleInvoke(
      IpcChannels.DashboardSendAgentMessage,
      async (
        payload: DashboardSendAgentMessagePayload
      ): Promise<DashboardSendAgentMessageResult> => {
        const res = await deps.chatService!.sendMessage({
          projectId: payload.projectId,
          channelId: payload.channelId,
          text: payload.text,
          source: payload.source,
          isAgent: true
        })
        return {
          ok: res.ok,
          ts: res.message?.ts,
          error: res.error,
          code: res.code
        }
      }
    )
    handleInvoke(
      IpcChannels.DashboardChatTokenStatus,
      async (projectId: string): Promise<DashboardChatTokenStatus> =>
        deps.chatService!.chatTokenStatus(projectId)
    )
    handleInvoke(
      IpcChannels.DashboardProjectActivity,
      async (projectId: string): Promise<DashboardProjectActivity> => {
        if (typeof projectId !== 'string' || !projectId.trim()) {
          return {
            recent: [],
            latestClientAt: null,
            latestOursAt: null,
            ballInCourt: null,
            participants: [],
            channels: [],
            counts14d: { client: 0, ours: 0 }
          }
        }
        return deps.chatService!.projectActivity(projectId)
      }
    )
  }
  if (deps.projectChatService) {
    const service = deps.projectChatService
    handleInvokeWithEvent(
      IpcChannels.DashboardProjectChat,
      async (event, payload: DashboardProjectChatPayload) => {
        // Replies go only to the window that asked, tagged with projectId+runId.
        const sender = event.sender
        const send = (channel: string, data: unknown): void => {
          if (!sender.isDestroyed()) sender.send(channel, data)
        }
        const sink: ProjectChatSink = {
          chunk: (data) => send(IpcChannels.DashboardProjectChatChunk, data),
          done: (data) => send(IpcChannels.DashboardProjectChatDone, data),
          error: (data) => send(IpcChannels.DashboardProjectChatError, data)
        }
        try {
          return await service.start(payload, sink)
        } catch (err) {
          return {
            ok: false as const,
            code: 'INTERNAL' as const,
            error: err instanceof Error ? err.message : 'Chat failed.'
          }
        }
      }
    )
    handleInvoke(
      IpcChannels.DashboardProjectChatCancel,
      async (payload: { projectId: string; runId?: string }) => ({
        ok: service.cancel(String(payload?.projectId ?? ''), payload?.runId)
      })
    )
    handleInvoke(IpcChannels.DashboardProjectChatHistory, async (projectId: string) => ({
      messages: await service.loadHistory(String(projectId ?? ''))
    }))
    handleInvoke(IpcChannels.DashboardProjectChatStatus, async (projectId: string) =>
      service.status(String(projectId ?? ''))
    )
    handleInvoke(IpcChannels.DashboardProjectChatClear, async (projectId: string) => {
      await service.clearHistory(String(projectId ?? ''))
      return { ok: true }
    })
  }

  // v3 — our team workspace: connect once, pin its channels, every card reads it.
  if (deps.teamWorkspace) {
    const store = deps.teamWorkspace
    handleInvoke(IpcChannels.DashboardTeamWorkspaceGet, async () => store.readPublic())

    handleInvoke(
      IpcChannels.DashboardTeamWorkspaceCandidates,
      async (): Promise<DashboardTeamWorkspaceCandidate[]> =>
        (await deps.listTeamWorkspaceCandidates?.()) ?? []
    )

    handleInvoke(
      IpcChannels.DashboardTeamWorkspaceConnect,
      async (payload: DashboardTeamWorkspaceConnectPayload) => {
        const poller = new SlackPoller()
        let token: string | null = null
        if (payload.source === 'manual') {
          token = payload.token?.trim() ?? null
          if (!token) throw new Error('Paste a Slack token to connect our workspace.')
        } else {
          if (!payload.profileId || !payload.teamId) {
            throw new Error('Pick a workspace to connect.')
          }
          token = await deps.oauthTokenProvider.tryGet(payload.profileId, payload.teamId)
          if (!token) {
            throw new Error('That workspace has no stored token any more. Reconnect it first.')
          }
        }
        // Verify with Slack before storing: a dead token must never look connected.
        const check = await poller.authTest(token)
        if (!check.valid) throw new Error(check.error ?? 'Slack rejected this token')
        // OAuth tokens can be under-scoped too; warn at connect instead of later.
        const missing = missingSlackScopes(check.scopes)
        if (missing.length > 0) throw new Error(describeMissingScopes(missing))
        const teamId = check.teamId ?? payload.teamId ?? ''
        if (!teamId) throw new Error('Slack did not report a workspace id for this token.')
        const next = await store.connect({
          payload,
          profileId:
            payload.source === 'manual' ? `manual:${teamId}` : (payload.profileId as string),
          teamId,
          teamName: check.teamName ?? teamId,
          token: payload.source === 'manual' ? (token as string) : undefined,
          maskedToken: maskToken(token),
          status: 'connected'
        })
        await broadcastConfigChanged()
        return next
      }
    )

    handleInvoke(
      IpcChannels.DashboardTeamWorkspaceChannels,
      async (payload: DashboardTeamWorkspaceChannelsPayload) => {
        const next = await store.setChannels(payload.channels)
        await broadcastConfigChanged()
        return next
      }
    )

    handleInvoke(IpcChannels.DashboardTeamWorkspaceClear, async () => {
      const next = await store.clear()
      await broadcastConfigChanged()
      return next
    })
  }

  // Phase 3 — workspace → cards mapping IPC
  if (deps.workspaceMapping) {
    handleInvoke(
      IpcChannels.DashboardWorkspaceMappingList,
      async (): Promise<{ workspaceId: string; projectIds: string[]; updatedAt: string }[]> => {
        const [mappings, projects] = await Promise.all([
          deps.workspaceMapping!.listMappings(),
          deps.monitorStore.listProjects()
        ])
        const projectMap = new Map(projects.map((p) => [p.id, p]))
        const mapByWs = new Map<string, Set<string>>()

        // Populate from saved mappings, validating project source/connection
        for (const m of mappings) {
          const validIds = new Set<string>()
          for (const pId of m.projectIds) {
            const proj = projectMap.get(pId)
            if (!proj) continue
            // If project defines sources, it must have a source matching this workspace
            if (proj.sources && proj.sources.length > 0) {
              if (proj.sources.some((s) => s.workspaceId === m.workspaceId)) {
                validIds.add(pId)
              }
            } else if (proj.teamId === m.workspaceId && proj.tokenSource !== 'manual') {
              validIds.add(pId)
            }
          }
          if (validIds.size > 0) {
            mapByWs.set(m.workspaceId, validIds)
          }
        }

        // Also add any projects that have explicit active sources for this workspace
        for (const p of projects) {
          for (const s of p.sources ?? []) {
            if (s.workspaceId) {
              if (!mapByWs.has(s.workspaceId)) mapByWs.set(s.workspaceId, new Set())
              mapByWs.get(s.workspaceId)!.add(p.id)
            }
          }
        }

        return Array.from(mapByWs.entries()).map(([workspaceId, pIds]) => ({
          workspaceId,
          projectIds: Array.from(pIds),
          updatedAt: new Date().toISOString()
        }))
      }
    )
    handleInvoke(
      IpcChannels.DashboardWorkspaceMappingGet,
      async (workspaceId: string): Promise<string[] | null> =>
        deps.workspaceMapping!.getMapping(workspaceId)
    )
    handleInvoke(
      IpcChannels.DashboardWorkspaceMappingSave,
      async (payload: { workspaceId: string; projectIds: string[] }): Promise<void> => {
        const projects = await deps.monitorStore.listProjects()
        const validProjectIds = projects.map((p) => p.id)
        await deps.workspaceMapping!.saveMapping(payload.workspaceId, payload.projectIds, validProjectIds)

        // Synchronize projects:
        // 1. Newly mapped projects get a browser source for this workspace
        for (const pId of payload.projectIds) {
          const targetProj = projects.find((p) => p.id === pId)
          if (targetProj) {
            const hasSource = (targetProj.sources ?? []).some((s) => s.workspaceId === payload.workspaceId)
            if (!hasSource) {
              const now = new Date().toISOString()
              const updatedSources = [
                ...(targetProj.sources ?? []),
                {
                  id: `src-browser-${Date.now().toString(36)}`,
                  kind: 'browser' as const,
                  platform: 'slack' as const,
                  profileId: targetProj.profileId,
                  workspaceId: payload.workspaceId,
                  workspaceName: 'Slack Workspace',
                  channels: [],
                  role: 'client' as const,
                  backfillDays: 7 as const,
                  enabled: true,
                  status: 'connected' as const,
                  selectionMode: 'include' as const,
                  createdAt: now,
                  updatedAt: now
                }
              ]
              await deps.monitorStore.upsertProject({
                project: {
                  ...targetProj,
                  sources: updatedSources
                }
              })
            }
          }
        }

        // 2. Unmapped projects have sources for this workspace removed
        const newProjectIdsSet = new Set(payload.projectIds)
        for (const targetProj of projects) {
          if (!newProjectIdsSet.has(targetProj.id)) {
            const hasSource = (targetProj.sources ?? []).some((s) => s.workspaceId === payload.workspaceId)
            if (hasSource) {
              const updatedSources = (targetProj.sources ?? []).filter((s) => s.workspaceId !== payload.workspaceId)
              await deps.monitorStore.upsertProject({
                project: {
                  ...targetProj,
                  sources: updatedSources
                }
              })
            }
          }
        }

        await broadcastConfigChanged()
      }
    )
    handleInvoke(
      IpcChannels.DashboardWorkspaceMappingDelete,
      async (workspaceId: string): Promise<boolean> =>
        deps.workspaceMapping!.deleteMapping(workspaceId)
    )
  }

  // Phase 3 — list lightweight project info for mapping UI
  handleInvoke(
    IpcChannels.DashboardGetProjects,
    async (): Promise<Array<{ id: string; name: string; clientName: string; teamId: string; profileId: string }>> => {
      const projects = await deps.monitorStore.listProjects()
      return projects.map((p) => ({
        id: p.id,
        name: p.name,
        clientName: p.clientName,
        teamId: p.teamId,
        profileId: p.profileId
      }))
    }
  )

  handleInvoke(
    IpcChannels.DashboardCardCheckAuth,
    async (payload: { projectId: string; appId?: string }): Promise<boolean> => {
      if (!payload?.projectId) return false
      try {
        const partition = partitionForCard(payload.projectId, (payload.appId as any) || 'slack')
        const sess = session.fromPartition(partition)
        const cookies = await sess.cookies.get({ domain: '.slack.com' })
        return cookies.some((c) => (c.name === 'd' || c.name === 'd-s') && Boolean(c.value))
      } catch {
        return false
      }
    }
  )

  // v2.8 — one effective config resolver for Slack + AI.
  if (deps.configService) {
    handleInvoke(IpcChannels.DashboardConfigGet, async (): Promise<DashboardGlobalConfig> =>
      deps.configService!.publicGlobalConfig()
    )
    handleInvoke(
      IpcChannels.DashboardProjectDefaultsSet,
      async (patch: Partial<DashboardProjectDefaults>): Promise<DashboardGlobalConfig> => {
        await deps.monitorStore.saveDashboardDefaults(patch)
        const config = await deps.configService!.publicGlobalConfig()
        broadcast(IpcChannels.DashboardConfigChanged, config)
        return config
      }
    )
  }

  // v2.7 — AI provider settings (keys stay in main; public views are masked)
  if (deps.aiSettings) {
    handleInvoke(
      IpcChannels.DashboardGetAiSettings,
      async (payload?: DashboardAiSettingsQueryPayload): Promise<DashboardAiSettingsView> =>
        deps.aiSettings!.publicView(payload?.projectId)
    )
    handleInvoke(
      IpcChannels.DashboardSaveAiSettings,
      async (payload: DashboardAiSettingsSavePayload): Promise<DashboardAiSettingsView> => {
        const next = await deps.aiSettings!.save(payload)
        await broadcastConfigChanged()
        return next
      }
    )
    handleInvoke(
      IpcChannels.DashboardListAiModels,
      async (payload?: DashboardAiModelsQueryPayload): Promise<DashboardAiModelsResult> =>
        deps.aiSettings!.listModels(payload?.projectId)
    )
    handleInvoke(
      IpcChannels.DashboardTestAi,
      async (payload?: DashboardAiSettingsQueryPayload): Promise<DashboardAiTestResult> => {
        const result = await deps.aiSettings!.testConnection(payload?.projectId)
        await broadcastConfigChanged()
        return result
      }
    )
  }

  return {
    dispose: (): void => {
      unsubscribeProgress()
    }
  }
}

function filterRuns<T extends { status: string; trigger: string }>(
  rows: T[],
  query: { status?: string; trigger?: string; limit?: number }
): T[] {
  const filtered = rows.filter((row) => {
    if (query.status && query.status !== 'all' && row.status !== query.status) return false
    if (query.trigger && query.trigger !== 'all' && row.trigger !== query.trigger) return false
    return true
  })
  const limit = Number(query.limit)
  return Number.isFinite(limit) && limit > 0 ? filtered.slice(0, limit) : filtered
}
