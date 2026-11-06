import { SlackPoller, isSlackAuthFailure } from './slack-poller'
import { slackTokenKey } from './slack-throttle'
import type { InsightEngine } from './insight-engine'
import { SlackReaderView, type ScrapeStepEvent } from '../slack-reader/slack-reader-view'
import { sessionTokenExtractor } from '../slack-reader/session-token-extractor'
import { SlackApiClient, slackUserCache } from './slack-api-client'
import { partitionForCard, partitionForProfile } from '../profiles/session-partition'
import { resolveProjectMessageSources, type ResolvedChannel } from './message-sources'
import { RunLogStore } from './run-log-store'
import type {
  DashboardCancelScrapePayload,
  DashboardChannelDelta,
  DashboardMetrics,
  DashboardMonitor,
  DashboardProject,
  DashboardProjectSnapshot,
  DashboardScrapeOptions,
  DashboardSource,
  DashboardSyncProgressPayload,
  ProjectInsight,
  ProjectSource,
  ProjectSourceChannel,
  ScrapeChannelKind,
  ScrapeRunChannel,
  ScrapeRunLog,
  ScrapeRunStatus,
  ScrapeTrigger
} from '../../shared/dashboard-contract'
import type { DashboardDeltaStore, DashboardStoredMessage } from './delta-store'
import type { InsightHistoryEntry } from './history-store'
import type { MonitorStore } from './monitor-store'
import type { WorkspaceMappingStore } from './workspace-mapping-store'
import { summarizeProject } from './summary-engine'
import { computeMetrics } from './metrics'
import { shouldAutoReplyToMessage } from './agent-action-engine'

export interface DashboardPoller {
  fetchHistory(input: {
    token: string
    channelId: string
    afterTs?: string
    limit?: number
  }): Promise<{ messages: DashboardStoredMessage[]; hasMore: boolean }>
}

export interface OAuthTokenProvider {
  tryGet(profileId: string, teamId: string): Promise<string | null>
}

export interface ManualTokenProvider {
  getManualToken(key: string): Promise<string | null>
}

/** The one team workspace shared by every card (ticket 04). */
export interface TeamWorkspaceReader {
  getConnection(): Promise<{
    profileId: string
    teamId: string
    token: string | null
    channels: DashboardMonitor[]
    status?: 'connected' | 'needs-reconnect'
  } | null>
  /** Token-health write-back so Settings can show the reconnect badge. */
  setStatus?(status: 'connected' | 'needs-reconnect', atIso?: string): Promise<unknown>
}

/** One channel page fetched during the current sync cycle. */
type CycleHistoryPage = { messages: DashboardStoredMessage[]; hasMore: boolean }

/**
 * Cycle-scoped memo keyed by (token identity, channel, cursor): two cards on
 * one workspace share the fetch. Never kept across cycles — every incremental
 * cursor must be re-read fresh next time.
 */
export type CycleHistoryCache = Map<string, Promise<CycleHistoryPage>>

/** One workspace a sync run has to read. */
interface SyncWorkspace {
  source: DashboardSource
  profileId: string
  teamId: string
  token: string
  monitors: DashboardMonitor[]
}

/** The same workspace without a token — enough to read what is already stored. */
interface StoredWorkspace {
  source: DashboardSource
  profileId: string
  teamId: string
  channels: ResolvedChannel[]
}

/** v2.3 — lets the engine show the last AI insight without a network sync. */
export interface InsightReader {
  getLastInsight: (projectId: string) => Promise<ProjectInsight | null>
  getLastEntry: (projectId: string) => Promise<InsightHistoryEntry | null>
}

export interface DashboardSyncEngineDeps {
  monitorStore: MonitorStore
  deltaStore: DashboardDeltaStore
  oauthTokenProvider: OAuthTokenProvider
  manualTokenProvider?: ManualTokenProvider
  /** v3 — our team workspace (optional; a card still syncs its client workspace alone). */
  teamWorkspace?: TeamWorkspaceReader
  /** Phase 3 — workspace → cards mapping store (optional; cards sync their client workspace alone until mapped). */
  workspaceMapping?: WorkspaceMappingStore
  pollerFactory?: () => DashboardPoller
  onProgress?: (payload: DashboardSyncProgressPayload) => void
  /** diagnostics (never secrets) */
  log?: (msg: string) => void
  /** v2.3 — read-only access to the stored insights (cold start) */
  insightReader?: InsightReader
  /** Phase A — insight history for status-since, mood trend and "new since". */
  historyReader?: (projectId: string) => Promise<InsightHistoryEntry[]>
  /** Phase A — when this card's Dashboard was last looked at. */
  viewedStore?: { get(projectId: string): Promise<string | null> }
  /** v2.3 — called after a background sync (e.g. to refresh the digest) */
  onSynced?: (snapshots: DashboardProjectSnapshot[]) => void
  getExistingBrowserView?: (profileId: string, appId: 'slack') => any
  getExistingCardView?: (projectId: string, appId: 'slack') => any
  /** Global DM gate (AppSettings.scrapePersonalDms); cards may override. */
  getScrapePersonalDms?: () => boolean | Promise<boolean>
  /** Persist a source's last run so the scheduler survives restarts. */
  onSourceRun?: (sourceId: string, atIso: string) => void
  /** Invalidate chat service activity cache when new messages arrive and dispatch auto-replies */
  chatService?: {
    invalidateActivityCache(projectId?: string): void
    sendMessage?(payload: {
      projectId: string
      channelId: string
      text: string
      source?: 'client' | 'ours'
      isAgent?: boolean
    }): Promise<{ ok: boolean; error?: string; [key: string]: any }>
  }
}

export class DashboardSyncEngine {
  protected readonly monitorStore: MonitorStore
  private readonly deltaStore: DashboardDeltaStore
  private readonly oauthTokenProvider: OAuthTokenProvider
  private readonly manualTokenProvider?: ManualTokenProvider
  private readonly teamWorkspace: TeamWorkspaceReader | undefined
  private readonly workspaceMapping: WorkspaceMappingStore | undefined
  private readonly pollerFactory: () => DashboardPoller
  private readonly log: (msg: string) => void
  private readonly insightReader: InsightReader | undefined
  private readonly historyReader:
    ((projectId: string) => Promise<InsightHistoryEntry[]>) | undefined
  private readonly viewedStore: { get(projectId: string): Promise<string | null> } | undefined
  protected readonly chatService?: {
    invalidateActivityCache(projectId?: string): void
    sendMessage?(payload: {
      projectId: string
      channelId: string
      text: string
      source?: 'client' | 'ours'
      isAgent?: boolean
    }): Promise<{ ok: boolean; error?: string; [key: string]: any }>
  }
  private readonly repliedMessageTimestamps = new Set<string>()
  protected readonly metricsCache: Map<string, { key: string; value: DashboardMetrics }> = new Map()
  protected readonly onSynced: ((snapshots: DashboardProjectSnapshot[]) => void) | undefined
  private readonly getScrapePersonalDms: () => boolean | Promise<boolean>
  private readonly onSourceRun?: (sourceId: string, atIso: string) => void
  private readonly getExistingBrowserView?: (profileId: string, appId: 'slack') => any
  private readonly getExistingCardView?: (projectId: string, appId: 'slack') => any
  private scrapeEventListener: ((event: ScrapeStepEvent) => void) | null = null
  private activeWatchReader: SlackReaderView | null = null
  private scrapeQueuePromise: Promise<any> = Promise.resolve()
  private scrapeQueueLength = 0
  private readonly runControllers = new Map<string, AbortController>()
  private readonly runningSources = new Set<string>()
  private readonly runProject = new Map<string, string>()

  setScrapeEventListener(listener: ((event: ScrapeStepEvent) => void) | null): void {
    this.scrapeEventListener = listener
  }

  getActiveWatchReader(): SlackReaderView | null {
    return this.activeWatchReader
  }
  private readonly progressCallbacks: Array<(payload: DashboardSyncProgressPayload) => void> = []
  /** per-project cached snapshot — rebuilt after any sync */
  protected readonly lastResults: Map<string, DashboardProjectSnapshot> = new Map()

  constructor(deps: DashboardSyncEngineDeps) {
    this.monitorStore = deps.monitorStore
    this.deltaStore = deps.deltaStore
    this.oauthTokenProvider = deps.oauthTokenProvider
    this.manualTokenProvider = deps.manualTokenProvider
    this.teamWorkspace = deps.teamWorkspace
    this.workspaceMapping = deps.workspaceMapping
    this.pollerFactory = deps.pollerFactory ?? (() => new SlackPoller())
    this.log = deps.log ?? (() => undefined)
    this.insightReader = deps.insightReader
    this.historyReader = deps.historyReader
    this.viewedStore = deps.viewedStore
    this.chatService = deps.chatService
    this.onSynced = deps.onSynced
    this.getScrapePersonalDms = deps.getScrapePersonalDms ?? (() => false)
    this.onSourceRun = deps.onSourceRun
    this.getExistingBrowserView = deps.getExistingBrowserView
    this.getExistingCardView = deps.getExistingCardView
    if (deps.onProgress) this.progressCallbacks.push(deps.onProgress)
  }

  /** Register a progress listener (used by the IPC layer). Returns unsubscriber. */
  addProgressListener(cb: (payload: DashboardSyncProgressPayload) => void): () => void {
    this.progressCallbacks.push(cb)
    return () => {
      const idx = this.progressCallbacks.indexOf(cb)
      if (idx >= 0) this.progressCallbacks.splice(idx, 1)
    }
  }

  /** protected so subclasses can report diagnostics */
  protected logInfo(msg: string): void {
    this.log(msg)
  }

  private emitProgress(payload: DashboardSyncProgressPayload): void {
    for (const cb of this.progressCallbacks) {
      try {
        cb(payload)
      } catch {
        /* listener errors must not break syncing */
      }
    }
  }

  private progress(payload: DashboardSyncProgressPayload): void {
    this.emitProgress(payload)
  }

  protected async tokenFor(project: DashboardProject): Promise<string | null> {
    if (project.tokenSource === 'manual') {
      if (!project.manualTokenKey || !this.manualTokenProvider) return null
      return this.manualTokenProvider.getManualToken(project.manualTokenKey)
    }
    return this.oauthTokenProvider.tryGet(project.profileId, project.teamId)
  }

  /** Pull new messages for every channel of one workspace and append them. */
  private async syncWorkspace(
    workspace: SyncWorkspace,
    poller: DashboardPoller,
    historyCache?: CycleHistoryCache,
    project?: DashboardProject
  ): Promise<DashboardChannelDelta[]> {
    const perChannel: DashboardChannelDelta[] = []

    for (const monitor of workspace.monitors) {
      const before = await this.deltaStore.readSnapshotMeta(
        workspace.profileId,
        workspace.teamId,
        monitor.channelId
      )
      const cursor = before?.cursor

      const result = await this.cycleFetch(
        historyCache,
        workspace.token,
        monitor.channelId,
        cursor,
        () =>
          poller.fetchHistory({
            token: workspace.token,
            channelId: monitor.channelId,
            afterTs: cursor,
            limit: 200
          })
      )

      const stored = await this.deltaStore.appendMessages({
        profileId: workspace.profileId,
        teamId: workspace.teamId,
        channelId: monitor.channelId,
        channelName: monitor.channelName,
        messages: result.messages,
        source: workspace.source
      })

      if (stored.added > 0 && project) {
        this.chatService?.invalidateActivityCache(project.id)
        void this.handleAutoReplyForNewMessages(
          project,
          monitor.channelId,
          result.messages.slice(-stored.added)
        )
      }

      const after = await this.deltaStore.readSnapshotMeta(
        workspace.profileId,
        workspace.teamId,
        monitor.channelId
      )

      perChannel.push({
        channelId: monitor.channelId,
        channelName: monitor.channelName,
        source: workspace.source,
        messageCount: after?.messageCount ?? stored.added,
        newMessageCount: stored.added,
        latestMessageAt: new Date(Number(stored.cursor) * 1000).toISOString(),
        cursor: stored.cursor,
        lastSyncAt: stored.lastSyncAt
      })
    }
    return perChannel
  }

  /** One page per (token identity, channel, cursor) per cycle — see CycleHistoryCache. */
  private cycleFetch(
    cache: CycleHistoryCache | undefined,
    token: string,
    channelId: string,
    cursor: string | undefined,
    load: () => Promise<CycleHistoryPage>
  ): Promise<CycleHistoryPage> {
    if (!cache) return load()
    const key = `${slackTokenKey(token)}|${channelId}|${cursor ?? ''}`
    const cached = cache.get(key)
    if (cached) return cached
    const created = load()
    cache.set(key, created)
    return created
  }

  /** Reflect our-team token health in Settings; identical states write nothing. */
  private async markTeamStatus(
    status: 'connected' | 'needs-reconnect',
    current?: 'connected' | 'needs-reconnect'
  ): Promise<void> {
    if (!this.teamWorkspace?.setStatus || current === status) return
    try {
      await this.teamWorkspace.setStatus(status, new Date().toISOString())
    } catch (err) {
      this.log(`[dashboard] team workspace status write failed: ${String(err)}`)
    }
  }

  /** Read our team workspace without throwing: a missing one is simply absent. */
  private async ourWorkspace(): Promise<{
    connection: {
      profileId: string
      teamId: string
      token: string | null
      channels: DashboardMonitor[]
      status?: 'connected' | 'needs-reconnect'
    } | null
    error: string | null
  }> {
    if (!this.teamWorkspace) return { connection: null, error: null }
    try {
      return { connection: await this.teamWorkspace.getConnection(), error: null }
    } catch (err) {
      return {
        connection: null,
        error: err instanceof Error ? err.message : 'could not read our workspace'
      }
    }
  }

  /**
   * Workspaces this card reads: its selected sources and ours (when connected).
   * This is the read-side twin of scrapeSource: browser cards read exactly the
   * channels saved on their browser source, not the legacy monitors mirror.
   */
  private async storedWorkspaces(
    project: DashboardProject
  ): Promise<{ workspaces: StoredWorkspace[]; error: string | null }> {
    let mappedTeamId = project.teamId
    if (this.workspaceMapping) {
      const mappedWorkspace = await this.workspaceMapping.getWorkspaceForProject(project.id)
      if (mappedWorkspace) mappedTeamId = mappedWorkspace
    }

    const { connection, error } = await this.ourWorkspace()
    const resolved = resolveProjectMessageSources(project, {
      mappedTeamId,
      ourSlack: connection
        ? {
            profileId: connection.profileId,
            teamId: connection.teamId,
            channels: connection.channels
          }
        : null
    })
    const workspaces: StoredWorkspace[] = resolved.map((workspace) => ({
      source: workspace.source,
      profileId: workspace.profileId,
      teamId: workspace.teamId,
      channels: workspace.channels
    }))

    // token resolution handled in tokenFor via override; keep connection for error
    if (error) return { workspaces, error }
    return { workspaces, error: null }
  }

  private perChannelDelta(
    delta: {
      channel: { id: string; name: string }
      messages: DashboardStoredMessage[]
      cursor: string
      lastSyncAt: string
    },
    source: DashboardSource
  ): DashboardChannelDelta {
    return {
      channelId: delta.channel.id,
      channelName: delta.channel.name,
      source,
      messageCount: delta.messages.length,
      latestMessageAt: new Date(Number(delta.cursor) * 1000).toISOString(),
      cursor: delta.cursor,
      lastSyncAt: delta.lastSyncAt
    }
  }

  async syncProject(
    projectId: string,
    historyCache?: CycleHistoryCache,
    options: { includeBrowserSources?: boolean } = {}
  ): Promise<DashboardProjectSnapshot | null> {
    const projects = await this.monitorStore.listProjects()
    const project = projects.find((p) => p.id === projectId)
    if (!project) return null

    // Phase 3: if project is mapped to a workspace, use that workspace ID
    // for token resolution instead of project.teamId. Channels stay as the
    // project's own monitors.
    let syncTeamId = project.teamId
    if (this.workspaceMapping) {
      const mappedWorkspace = await this.workspaceMapping.getWorkspaceForProject(project.id)
      if (mappedWorkspace) syncTeamId = mappedWorkspace
    }

    this.progress({
      syncing: true,
      projectId,
      current: 1,
      total: 1,
      phase: 'syncing',
      projectIds: [projectId]
    })

    try {
      const poller = this.pollerFactory()
      const browserSources = (project.sources ?? []).filter(
        (s) => s.kind === 'browser' && s.enabled !== false
      )
      const isBrowserOnly = project.sourcePreference === 'browser_only' && browserSources.length > 0

      let clientDeltas: DashboardChannelDelta[] = []

      if (!isBrowserOnly) {
        const token = await this.tokenFor({
          ...project,
          teamId: syncTeamId
        })
        if (token) {
          clientDeltas = await this.syncWorkspace(
            {
              source: 'client',
              profileId: project.profileId,
              teamId: syncTeamId,
              token,
              monitors: project.monitors
            },
            poller,
            historyCache,
            project
          )
        } else if (browserSources.length === 0) {
          throw new Error(
            project.tokenSource === 'manual'
              ? 'No manual token saved for this project yet'
              : 'Workspace not connected via OAuth yet'
          )
        }
      }

      // If project has active browser sources, scrape them through the same
      // runner used by manual and scheduled runs (single code path).
      if (options.includeBrowserSources !== false && browserSources.length > 0) {
        for (const bSrc of browserSources) {
          const result = await this.scrapeSource(project, bSrc, { trigger: 'manual' })
          clientDeltas.push(...result.deltas)
        }
      }

      // Our team workspace is additive: if it fails, the client sync still
      // counts and the card keeps showing the data it already had.
      let ourDeltas: DashboardChannelDelta[] = []
      let ourWorkspaceError: string | null = null
      const { connection, error: readError } = await this.ourWorkspace()
      if (readError) ourWorkspaceError = readError
      if (connection) {
        if (!connection.token) {
          ourWorkspaceError =
            'Our team workspace has no usable token. Reconnect it in Global settings.'
        } else if (connection.channels.length > 0) {
          try {
            ourDeltas = await this.syncWorkspace(
              {
                source: 'ours',
                profileId: connection.profileId,
                teamId: connection.teamId,
                token: connection.token,
                monitors: connection.channels
              },
              poller,
              historyCache,
              project
            )
            await this.markTeamStatus('connected', connection.status)
          } catch (err) {
            ourWorkspaceError = err instanceof Error ? err.message : 'our workspace sync failed'
            // Only a dead token flips the badge; a network blip must not.
            if (isSlackAuthFailure(err)) {
              await this.markTeamStatus('needs-reconnect', connection.status)
            }
            this.log(`[dashboard] our-workspace sync failed: ${ourWorkspaceError}`)
          }
        }
      }

      const perChannel = [...clientDeltas, ...ourDeltas]
      const messages = await this.collectMessages(project)
      const snapshot = summarizeProject({
        project,
        messages,
        netNewCount: perChannel.reduce(
          (acc, ch) =>
            acc +
            Math.max(
              0,
              ch.messageCount -
                (this.lastResults
                  .get(project.id)
                  ?.perChannel.find((c) => c.channelId === ch.channelId)?.messageCount ??
                  ch.messageCount)
            ),
          0
        ),
        perChannel,
        lastUpdatedAt: new Date().toISOString()
      })
      snapshot.ourWorkspaceError = ourWorkspaceError
      this.lastResults.set(project.id, snapshot)
      this.progress({
        syncing: false,
        projectId,
        current: 1,
        total: 1,
        phase: 'complete',
        projectIds: [projectId]
      })
      return snapshot
    } catch (err) {
      const hint = err instanceof Error ? err.message : 'sync failed'
      this.log(`[dashboard] sync failed (${project.name}): ${hint}`)
      const perChannel = await this.storedDeltas(project)
      const base = this.buildFallbackSnapshot(
        project,
        perChannel,
        await this.collectMessages(project)
      )
      base.syncState = 'error'
      base.mood = { state: 'neutral', signal: hint }
      this.lastResults.set(project.id, base)
      this.progress({
        syncing: false,
        projectId,
        current: 1,
        total: 1,
        phase: 'error',
        projectIds: [projectId],
        message: hint
      })
      return base
    }
  }

  async syncProjectSource(
    projectId: string,
    sourceId?: string,
    extra: { trigger?: ScrapeTrigger; options?: DashboardScrapeOptions } = {}
  ): Promise<{
    runId: string
    channelsRead: number
    newMessages: number
    status: ScrapeRunStatus
    error?: string
  }> {
    this.scrapeQueueLength++
    if (this.scrapeQueueLength > 1) {
      this.scrapeEventListener?.({
        type: 'queued',
        queueLength: this.scrapeQueueLength - 1,
        text: `Scrape queued (${this.scrapeQueueLength - 1} ahead)`
      })
    }

    const task = async () => {
      try {
        return await this.executeSyncProjectSource(projectId, sourceId, extra)
      } finally {
        this.scrapeQueueLength = Math.max(0, this.scrapeQueueLength - 1)
      }
    }

    // Chain sequentially to guarantee strict FIFO execution
    const execution = this.scrapeQueuePromise.then(task, task)
    this.scrapeQueuePromise = execution.catch(() => {})
    return execution
  }

  /** Abort one run (by id/project) or every run for a project. Returns count. */
  cancelScrape(payload: DashboardCancelScrapePayload): number {
    let cancelled = 0
    for (const [runId, controller] of this.runControllers) {
      if (payload.runId && payload.runId !== runId) continue
      if (payload.projectId && this.runProject.get(runId) !== payload.projectId) continue
      if (!controller.signal.aborted) {
        controller.abort()
        cancelled++
      }
    }
    return cancelled
  }

  isSourceRunning(sourceId: string): boolean {
    return this.runningSources.has(sourceId)
  }

  private async executeSyncProjectSource(
    projectId: string,
    sourceId?: string,
    extra: { trigger?: ScrapeTrigger; options?: DashboardScrapeOptions } = {}
  ): Promise<{
    runId: string
    channelsRead: number
    newMessages: number
    status: ScrapeRunStatus
    error?: string
  }> {
    const projects = await this.monitorStore.listProjects()
    const project = projects.find((p) => p.id === projectId)
    if (!project) {
      return {
        runId: '',
        channelsRead: 0,
        newMessages: 0,
        status: 'error',
        error: 'Project not found'
      }
    }

    const browserSources = (project.sources ?? []).filter(
      (s) => s.kind === 'browser' && s.enabled !== false && (!sourceId || s.id === sourceId)
    )

    if (browserSources.length === 0) {
      return {
        runId: '',
        channelsRead: 0,
        newMessages: 0,
        status: 'error',
        error: 'No active browser sources found'
      }
    }

    let channelsRead = 0
    let newMessages = 0
    let lastRunId = ''
    let runError: string | undefined
    let status: ScrapeRunStatus = 'success'

    for (const source of browserSources) {
      const result = await this.scrapeSource(project, source, extra)
      lastRunId = result.runId || lastRunId
      channelsRead += result.channelsRead
      newMessages += result.newMessages
      if (result.error) runError = result.error
      if (result.status === 'error') status = 'error'
      else if (result.status === 'stopped') status = status === 'error' ? 'error' : 'stopped'
      else if (result.status === 'partial' && status === 'success') status = 'partial'
    }

    // A scrape can change messages, channel metadata, and metrics. Rebuild
    // before returning so manual and scheduled runs both publish fresh data.
    await this.refreshProjectSnapshot(projectId).catch((err) => {
      this.log(`[dashboard] post-scrape snapshot refresh failed (${projectId}): ${String(err)}`)
    })

    return { runId: lastRunId, channelsRead, newMessages, status, error: runError }
  }

  /**
   * Force a fresh snapshot from stored data after a scrape, bypassing the
   * lastResults cache. This is what makes browser scrapes visible to the
   * Dashboard without a token sync.
   */
  async refreshProjectSnapshot(projectId: string): Promise<DashboardProjectSnapshot | null> {
    this.lastResults.delete(projectId)
    this.metricsCache.delete(projectId)
    const snapshots = await this.buildSnapshot(projectId)
    const snapshot = snapshots[0] ?? null
    if (snapshot) {
      this.lastResults.set(projectId, snapshot)
      try {
        this.onSynced?.([snapshot])
      } catch (err) {
        this.logInfo(`[dashboard] post-scrape hook failed: ${String(err)}`)
      }
    }
    return snapshot
  }

  /**
   * The one browser scrape path. Manual "Scrape", "Sync now", and the
   * per-source scheduler all land here so windowing, DM policy, filtering,
   * cancellation, and logging cannot drift apart.
   */
  private async scrapeSource(
    project: DashboardProject,
    source: ProjectSource,
    extra: { trigger?: ScrapeTrigger; options?: DashboardScrapeOptions } = {}
  ): Promise<{
    runId: string
    channelsRead: number
    newMessages: number
    status: ScrapeRunStatus
    error?: string
    deltas: DashboardChannelDelta[]
  }> {
    const empty = {
      runId: '',
      channelsRead: 0,
      newMessages: 0,
      deltas: [] as DashboardChannelDelta[]
    }
    // Auto-heal workspaceId if pending or missing and project has a real teamId
    if (
      (!source.workspaceId || source.workspaceId.startsWith('pending-')) &&
      project.teamId &&
      !project.teamId.startsWith('pending-')
    ) {
      source.workspaceId = project.teamId
      await this.mergeSource(project.id, source.id, (current) => ({
        ...current,
        workspaceId: project.teamId,
        updatedAt: new Date().toISOString()
      }))
    }

    if (!source.profileId || !source.workspaceId) {
      return { ...empty, status: 'error', error: 'Source has no profile/workspace' }
    }
    if (!source.channelsReviewedAt) {
      return {
        ...empty,
        status: 'error',
        error: 'Review and select channels before scraping this workspace'
      }
    }
    const reviewedSelection = (source.channels ?? []).filter((channel) => channel.enabled !== false)
    if ((source.selectionMode ?? 'include') === 'include' && reviewedSelection.length === 0) {
      return {
        ...empty,
        status: 'error',
        error: 'No channels selected. Choose at least one channel before scraping'
      }
    }
    if (this.runningSources.has(source.id)) {
      return { ...empty, status: 'stopped', error: 'Scrape already running for this source' }
    }

    const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const trigger: ScrapeTrigger = extra.trigger ?? 'manual'
    const startedAt = new Date().toISOString()
    const startTime = Date.now()
    const controller = new AbortController()
    const signal = controller.signal
    this.runControllers.set(runId, controller)
    this.runProject.set(runId, project.id)
    this.runningSources.add(source.id)

    const backfillHours =
      source.backfillHours === 0 ? 0 : clampNumber(source.backfillHours ?? 6, 1, 720)
    const catchUpCapDays = clampNumber(source.catchUpCapDays ?? 7, 1, 30)
    const windowEndSec = Date.now() / 1000
    const floorTs = backfillHours === 0 ? 0 : windowEndSec - backfillHours * 3600
    const catchUpFloorTs = windowEndSec - catchUpCapDays * 86400
    const options = extra.options
    const selectionMode = options?.selectionMode ?? source.selectionMode ?? 'include'
    const selectedChannelIds = new Set(
      options?.channelIds ??
        (source.channels ?? [])
          .filter((channel) => channel.enabled !== false)
          .map((channel) => channel.id)
    )
    const allowDms = resolveDmPolicy(source, options, await this.getScrapePersonalDms())

    const includeKinds = new Set<ScrapeChannelKind>()
    if (options?.includePublic !== false) includeKinds.add('public')
    if (options?.includePrivate !== false) includeKinds.add('private')
    if (allowDms) {
      includeKinds.add('dm')
      includeKinds.add('group-dm')
    }

    const peopleFilter = new Set(
      (options?.people ?? source.selectedPeople ?? [])
        .map((person) => person.trim().toLowerCase())
        .filter(Boolean)
    )

    const channels: ScrapeRunChannel[] = []
    const deltas: DashboardChannelDelta[] = []
    const snippets: Array<{
      channelId: string
      channelName?: string
      sender: string
      ts: string
      snippet: string
    }> = []
    const peopleCounts = new Map<string, number>()
    let channelsRead = 0
    let newMessages = 0
    let gapSeconds = 0
    let windowStart = floorTs
    let status: ScrapeRunStatus = 'success'
    let runError: string | undefined
    let channelErrors = 0

    const effectiveWorkspaceName = source.workspaceName || source.workspaceId
    let reader: SlackReaderView | null = null
    const getOrCreateReader = (): SlackReaderView => {
      if (!reader) {
        reader = new SlackReaderView({
          profileId: source.profileId ?? '',
          projectId: project.id,
          workspaceId: source.workspaceId,
          existingView: null,
          onEvent: (ev) =>
            this.scrapeEventListener?.({
              ...ev,
              runId,
              projectId: project.id,
              sourceId: source.id,
              workspaceName: effectiveWorkspaceName
            })
        })
        this.activeWatchReader = reader
      }
      return reader
    }

    this.scrapeEventListener?.({
      type: 'run_started',
      runId,
      projectId: project.id,
      sourceId: source.id,
      workspaceName: effectiveWorkspaceName,
      text: `Starting ${trigger} scrape for ${effectiveWorkspaceName}…`
    })

    const requestedEngineMode = source.engineMode ?? 'direct_api'
    let activeEngineMode: 'direct_api' | 'browser' = 'browser'
    let directApiClient: SlackApiClient | null = null
    const cacheKey = `slack:${project.id}:${source.workspaceId}`
    const candidatePartitions = [
      partitionForCard(project.id, 'slack'),
      partitionForProfile(source.profileId, 'slack')
    ]
    const existingViews = [
      this.getExistingCardView?.(project.id, 'slack'),
      this.getExistingBrowserView?.(source.profileId, 'slack')
    ].filter(Boolean)

    try {
      let targetChannels: ProjectSourceChannel[] = source.channels ?? []

      if (requestedEngineMode === 'direct_api') {
        try {
          // Zero-DOM: Resolve credentials using 3-tier fallback (memory -> session/disk -> partition disk)
          // checking candidate partitions directly without instantiating or loading any WebContentsView.
          let creds = await sessionTokenExtractor.extractSlackSessionTokens(existingViews, cacheKey, {
            partitions: candidatePartitions
          })

          if (!creds) {
            // Lazy fallback: only instantiate and load a browser view if zero-DOM credential extraction failed
            const fallbackReader = getOrCreateReader()
            await fallbackReader.initialize()
            const bgView = fallbackReader.getView()
            if (bgView && !bgView.webContents.isDestroyed() && !bgView.webContents.getURL().includes('slack.com')) {
              const targetUrl = `https://app.slack.com/client/${source.workspaceId}`
              try {
                await bgView.webContents.loadURL(targetUrl)
                await fallbackReader.waitForContent(8000)
              } catch {
                // ignore
              }
            }
            const allCandidates = [bgView, ...existingViews].filter(Boolean)
            creds = await sessionTokenExtractor.extractSlackSessionTokens(allCandidates, cacheKey, {
              partitions: candidatePartitions
            })
          }

          if (creds) {
            directApiClient = new SlackApiClient(creds)
            activeEngineMode = 'direct_api'
            if (slackUserCache.size === 0) {
              await directApiClient.loadWorkspaceUsers().catch(() => {})
            } else {
              void directApiClient.loadWorkspaceUsers().catch(() => {})
            }
            this.logInfo(
              `[sync-engine] direct API session credentials active for ${effectiveWorkspaceName}`
            )
          } else {
            this.logInfo(
              `[sync-engine] direct API credentials unavailable, falling back to browser DOM for ${effectiveWorkspaceName}`
            )
          }
        } catch (tokenErr) {
          this.logInfo(
            `[sync-engine] direct API token probe failed, falling back to browser DOM: ${String(tokenErr)}`
          )
        }
      }

      // If in browser DOM mode, discover live sidebar channels via the reader
      if (activeEngineMode === 'browser') {
        try {
          const domReader = getOrCreateReader()
          const discovered = await domReader.listChannels()
          if (discovered.length > 0) {
            const discoveredIds = new Set(discovered.map((channel) => channel.id))
            const mapped = discovered.map((ch) => {
              const kind = channelKind({
                id: ch.id,
                name: ch.name,
                isPrivate: ch.isPrivate,
                isDm: ch.isDm
              })
              const existingCh = source.channels?.find((c) => c.id === ch.id)
              return {
                id: ch.id,
                name: ch.name,
                isPrivate: ch.isPrivate,
                isDm: ch.isDm,
                kind,
                enabled: selectedChannelIds.has(ch.id),
                created: ch.created ?? existingCh?.created,
                memberCount: ch.memberCount ?? existingCh?.memberCount
              }
            })
            const extras = (source.channels ?? [])
              .filter((ch) => selectedChannelIds.has(ch.id) && !discoveredIds.has(ch.id))
              .map((ch) => ({ ...ch, enabled: true }))
            targetChannels = [...mapped, ...extras]
            // A per-run override must not rewrite the saved default.
            if (!options?.channelIds?.length && !options?.selectionMode) {
              await this.mergeSource(project.id, source.id, (current) => ({
                ...current,
                channels: targetChannels,
                updatedAt: new Date().toISOString()
              }))
            }
          }
        } catch {
          targetChannels = source.channels ?? []
        }
      }

      for (const ch of targetChannels) {
        if (signal.aborted) {
          status = 'stopped'
          runError = 'Cancelled by user'
          break
        }

        const kind = channelKind(ch)
        const name = ch.name || ch.id
        const isSelected = selectedChannelIds.has(ch.id)

        if (selectionMode === 'include' ? !isSelected : isSelected) {
          channels.push({
            channelId: ch.id,
            channelName: name,
            kind,
            messagesRead: 0,
            newMessages: 0,
            status: 'skipped',
            skippedReason: selectionMode === 'include' ? 'not-selected' : 'excluded'
          })
          continue
        }
        if (!includeKinds.has(kind)) {
          // Explicit Matrix selection overrides blanket DM policy:
          // If the user explicitly checked this DM in the Stacked Matrix, scrape it!
          const isExplicitlySelected = selectedChannelIds.has(ch.id)
          if ((kind === 'dm' || kind === 'group-dm') && isExplicitlySelected) {
            // Authorized by explicit user selection in Matrix
          } else {
            channels.push({
              channelId: ch.id,
              channelName: name,
              kind,
              messagesRead: 0,
              newMessages: 0,
              status: 'skipped',
              skippedReason: kind === 'dm' || kind === 'group-dm' ? 'dm-disabled' : 'kind-disabled'
            })
            continue
          }
        }

        this.scrapeEventListener?.({
          type: 'navigate',
          runId,
          projectId: project.id,
          sourceId: source.id,
          workspaceName: effectiveWorkspaceName,
          channelName: name,
          text: `Reading ${kind === 'dm' ? 'DM' : '#'}${name}…`
        })

        const cursorInfo = await this.channelCursorInfo(source, ch.id)
        const cursor = cursorInfo.cursor
        const lastSyncSec = cursorInfo.lastSyncAt
          ? Math.floor(new Date(cursorInfo.lastSyncAt).getTime() / 1000)
          : null
        const sourceLastSyncSec = source.lastScrapeAt
          ? Math.floor(new Date(source.lastScrapeAt).getTime() / 1000)
          : source.lastReadAt
            ? Math.floor(new Date(source.lastReadAt).getTime() / 1000)
            : null
        const effectiveLastSyncSec = lastSyncSec ?? sourceLastSyncSec
        const nowSec = Math.floor(Date.now() / 1000)

        // Calculate offline gap: elapsed seconds since the last sync or since latest cursor
        const offlineGapSec = Math.max(
          cursor ? Math.max(0, nowSec - cursor) : 0,
          effectiveLastSyncSec ? Math.max(0, nowSec - effectiveLastSyncSec) : 0
        )
        // If laptop was off / app was closed / gap > 60s, or startup catch-up triggered
        const isOfflineGap = offlineGapSec > 60 || extra.trigger === 'startup'

        const requestedDays = options?.days
        const thirtyDaysAgoTs = nowSec - 30 * 86400
        // When forceGenesis is true or days is 0, scrape from channel inception (sinceTs = 0).
        // When explicit days is provided, scrape with custom lookback window from now (e.g. 230 days).
        // When it is first scrape OR force30Days is true, scrape with a strict 30-day (1-month) historical window.
        // When an offline gap occurred (laptop shut down), smartly look back 24-40 hours (or full offline gap)
        // so no intermediate messages are lost.
        // Subsequent active scrapes read incrementally from cursor with a 120s safety buffer.
        const isGenesis = options?.forceGenesis === true || requestedDays === 0
        const isCustomDays = typeof requestedDays === 'number' && requestedDays > 0
        const isThirtyDays = options?.force30Days === true

        let sinceTs: number
        let isSmartCatchUp = false

        if (isGenesis) {
          sinceTs = 0
        } else if (isCustomDays) {
          sinceTs = nowSec - requestedDays * 86400
        } else if (isThirtyDays) {
          sinceTs = thirtyDaysAgoTs
        } else if (isOfflineGap) {
          // Enforce guaranteed 24-hour lookback window on offline gap (>60s) or startup catch-up
          isSmartCatchUp = true
          const twentyFourHoursAgoTs = nowSec - 24 * 3600
          sinceTs = Math.max(catchUpFloorTs, twentyFourHoursAgoTs)
        } else if (!cursor) {
          sinceTs = backfillHours > 0 ? floorTs : thirtyDaysAgoTs
        } else {
          sinceTs = Math.max(catchUpFloorTs, cursor - 120)
        }

        const isDeepHistorical =
          isGenesis || isCustomDays || isThirtyDays || sinceTs <= thirtyDaysAgoTs
        const isUltraHistorical = isGenesis || (isCustomDays && requestedDays >= 180)
        const maxScrolls = isUltraHistorical
          ? 2000
          : isDeepHistorical
            ? 1000
            : isSmartCatchUp
              ? 500
              : 80
        const maxMessages = isUltraHistorical
          ? 35000
          : isDeepHistorical
            ? 15000
            : isSmartCatchUp
              ? 10000
              : 3000
        windowStart = sinceTs === 0 ? 0 : Math.min(windowStart, sinceTs)

        try {
          let messages: DashboardStoredMessage[] = []

          if (directApiClient) {
            try {
              this.scrapeEventListener?.({
                type: 'status',
                channelName: name,
                text: `Direct API fetching ${kind === 'dm' ? 'DM' : '#'}${name}…`
              })
              const apiResult = await directApiClient.fetchChannelMessages({
                channelId: ch.id,
                sinceTs,
                maxMessages,
                signal
              })
              messages = apiResult.messages
              channelsRead++
            } catch (apiErr: any) {
              if (apiErr.slackError === 'not_authed' || apiErr.slackError === 'invalid_auth') {
                this.logInfo(
                  `[sync-engine] direct API session expired for ${ch.id}, attempting refresh...`
                )
                const refreshed = await sessionTokenExtractor.refreshSlackSessionTokens(
                  existingViews,
                  cacheKey,
                  { partitions: candidatePartitions }
                )
                if (refreshed) {
                  directApiClient = new SlackApiClient(refreshed)
                  const retry = await directApiClient.fetchChannelMessages({
                    channelId: ch.id,
                    sinceTs,
                    maxMessages,
                    signal
                  })
                  messages = retry.messages
                  channelsRead++
                } else {
                  this.logInfo(
                    `[sync-engine] direct API token refresh failed, falling back to browser DOM for ${ch.id}`
                  )
                  const domReader = getOrCreateReader()
                  const domResult = await domReader.readChannelWindow(ch.id, {
                    sinceTs,
                    maxScrolls,
                    maxMessages,
                    signal
                  })
                  gapSeconds = Math.max(gapSeconds, domResult.gapSeconds)
                  channelsRead++
                  messages = domResult.messages
                }
              } else {
                throw apiErr
              }
            }
          } else {
            const domReader = getOrCreateReader()
            const result = await domReader.readChannelWindow(ch.id, {
              sinceTs,
              maxScrolls,
              maxMessages,
              signal
            })
            gapSeconds = Math.max(gapSeconds, result.gapSeconds)
            channelsRead++
            messages = result.messages
          }
          if (peopleFilter.size > 0) {
            messages = messages.filter((m) => peopleFilter.has((m.user ?? '').trim().toLowerCase()))
          }

          const channelEngineMode: 'direct_api' | 'browser' = directApiClient ? 'direct_api' : 'browser'

          if (messages.length === 0) {
            channels.push({
              channelId: ch.id,
              channelName: name,
              kind,
              messagesRead: 0,
              newMessages: 0,
              status: 'empty',
              engineMode: channelEngineMode
            })
            continue
          }

          const append = await this.deltaStore.appendMessages({
            profileId: source.profileId,
            teamId: source.workspaceId,
            channelId: ch.id,
            channelName: name,
            messages,
            source: 'client'
          })
          newMessages += append.added
          if (append.added > 0) {
            this.chatService?.invalidateActivityCache(project.id)
            void this.handleAutoReplyForNewMessages(project, ch.id, messages.slice(-append.added))
          }

          const latestTs = messages[messages.length - 1]?.ts
          deltas.push({
            channelId: ch.id,
            channelName: name,
            source: 'client',
            messageCount: messages.length,
            newMessageCount: append.added,
            latestMessageAt: latestTs
              ? new Date(Number(latestTs) * 1000).toISOString()
              : append.lastSyncAt,
            cursor: append.cursor,
            lastSyncAt: append.lastSyncAt
          })

          channels.push({
            channelId: ch.id,
            channelName: name,
            kind,
            messagesRead: messages.length,
            newMessages: append.added,
            status: 'read',
            engineMode: channelEngineMode
          })

          for (const message of messages) {
            const person = (message.user || 'Anonymous').trim() || 'Anonymous'
            peopleCounts.set(person, (peopleCounts.get(person) ?? 0) + 1)
          }
          for (const message of messages.slice(-5)) {
            snippets.push({
              channelId: ch.id,
              channelName: name,
              sender: message.user || 'Anonymous',
              ts: message.ts,
              snippet: (message.text || '').slice(0, 100)
            })
          }
        } catch (err) {
          channelErrors++
          channels.push({
            channelId: ch.id,
            channelName: name,
            kind,
            messagesRead: 0,
            newMessages: 0,
            status: 'error',
            error: err instanceof Error ? err.message : String(err)
          })
          if (!runError) runError = err instanceof Error ? err.message : String(err)
        }
      }
    } catch (err) {
      status = 'error'
      runError = err instanceof Error ? err.message : String(err)
      this.log(`[dashboard] scrape source ${source.id} error: ${runError}`)
    } finally {
      const cancelled = signal.aborted
      const activeReader = reader as unknown as SlackReaderView | null
      if (activeReader) {
        activeReader.destroy()
        if (this.activeWatchReader === activeReader) this.activeWatchReader = null
      }
      this.runControllers.delete(runId)
      this.runProject.delete(runId)
      this.runningSources.delete(source.id)

      if (cancelled) {
        status = 'stopped'
        runError = runError ?? 'Cancelled by user'
      } else if (status !== 'error' && channelErrors > 0) {
        status = 'partial'
      }
      if (status === 'success' && gapSeconds > 0) status = 'partial'

      const finishedAt = new Date().toISOString()
      const readChannels = channels.filter((ch) => ch.status === 'read' || ch.status === 'empty')
      const totalMessagesRead = channels.reduce((sum, ch) => sum + (ch.messagesRead || 0), 0)
      const entry: ScrapeRunLog = {
        runId,
        ts: finishedAt,
        startedAt,
        trigger,
        projectId: project.id,
        projectName: project.name,
        sourceId: source.id,
        sourceKind: 'browser',
        engineMode: activeEngineMode,
        workspaceId: source.workspaceId,
        workspaceName: effectiveWorkspaceName,
        channelsRead: readChannels.length,
        messagesRead: totalMessagesRead,
        newMessages,
        snippets: snippets.slice(0, 20),
        window: {
          startTs: String(windowStart),
          endTs: String(windowEndSec),
          backfillHours,
          gapSeconds
        },
        channels,
        people: [...peopleCounts.entries()]
          .map(([name, count]) => ({ name, messages: count }))
          .sort((a, b) => b.messages - a.messages),
        filters: {
          includeKinds: [...includeKinds],
          channelIds: options?.channelIds,
          people: peopleFilter.size > 0 ? [...peopleFilter] : undefined
        },
        durationMs: Date.now() - startTime,
        llmCalls: 0,
        status,
        error: runError,
        errorCode: status === 'error' ? runError : undefined
      }

      const previousStatus =
        status === 'error' ? 'adapter-broken' : status === 'stopped' ? 'paused' : 'connected'
      await this.mergeSource(project.id, source.id, (current) => ({
        ...current,
        status: previousStatus,
        lastReadAt: status === 'error' || status === 'stopped' ? current.lastReadAt : finishedAt,
        lastReadNewCount: newMessages,
        lastScrapeAt: finishedAt,
        lastScrapeStatus: status,
        lastScrapeError: runError,
        lastScrapeRunId: runId,
        updatedAt: finishedAt
      }))

      try {
        const runLogStore = new RunLogStore({ rootDir: this.deltaStore.rootDir })
        await runLogStore.append(entry)
      } catch {
        // ignore log write failure
      }

      this.onSourceRun?.(source.id, finishedAt)

      this.scrapeEventListener?.({
        type:
          status === 'error'
            ? 'run_failed'
            : status === 'stopped'
              ? 'run_cancelled'
              : 'run_finished',
        runId,
        projectId: project.id,
        sourceId: source.id,
        workspaceName: effectiveWorkspaceName,
        channelName: source.workspaceId,
        messageCount: newMessages,
        text:
          status === 'error'
            ? `Scrape stopped: ${runError ?? 'error'}`
            : status === 'stopped'
              ? `Scrape cancelled. ${totalMessagesRead} messages read (${newMessages} new kept from completed channels).`
              : `[${activeEngineMode === 'direct_api' ? '⚡ Direct API' : '🌐 Browser DOM'}] Scraped ${readChannels.length} channels (${totalMessagesRead} read, ${newMessages} new).${
                  gapSeconds > 0 ? ` History gap: ${gapSeconds}s.` : ''
                }`
      })
    }

    return {
      runId,
      channelsRead,
      newMessages,
      status,
      error: runError,
      deltas
    }
  }

  /** Re-read the project so concurrent source updates never clobber each other. */
  private async mergeSource(
    projectId: string,
    sourceId: string,
    patch: (source: ProjectSource) => ProjectSource
  ): Promise<void> {
    try {
      const fresh = (await this.monitorStore.listProjects()).find((p) => p.id === projectId)
      if (!fresh) return
      const sources = (fresh.sources ?? []).map((source) =>
        source.id === sourceId ? patch(source) : source
      )
      await this.monitorStore.upsertProject({ project: { ...fresh, sources } })
    } catch (err) {
      this.log(`[dashboard] source update failed (${sourceId}): ${String(err)}`)
    }
  }

  /**
   * Autonomous Real-Time Auto-Reply:
   * Inspects newly ingested messages and dispatches polite responses via Direct API
   * for 1-on-1 DMs or group channel mentions if autoReply is enabled.
   */
  private async handleAutoReplyForNewMessages(
    project: DashboardProject,
    channelId: string,
    newMessages: DashboardStoredMessage[]
  ): Promise<void> {
    if (!this.chatService?.sendMessage || !newMessages || newMessages.length === 0) return

    for (const msg of newMessages) {
      if (!msg.ts || this.repliedMessageTimestamps.has(msg.ts)) continue

      const check = shouldAutoReplyToMessage(
        project,
        {
          text: msg.text || '',
          userId: msg.user,
          userName: msg.user
        },
        channelId
      )

      if (check.shouldReply) {
        this.repliedMessageTimestamps.add(msg.ts)
        const recipientName = check.channel?.name ? `#${check.channel.name}` : `#${channelId}`
        const sender = msg.user ? `@${msg.user}` : 'there'

        const replyText =
          check.reason === 'dm'
            ? `Hi ${sender}! I received your message. Thanks for reaching out — I am reviewing this and will get back to you shortly.`
            : `Hello ${sender}! Thanks for mentioning me. Noted, I am looking into this right away.`

        try {
          const res = await this.chatService.sendMessage({
            projectId: project.id,
            channelId,
            text: replyText,
            isAgent: true
          })

          if (res?.ok) {
            this.log(`[auto-reply] Successfully dispatched automated reply to ${recipientName} (~150ms Direct API)`)
          } else {
            this.log(`[auto-reply] Failed to dispatch reply to ${recipientName}: ${res?.error || 'unknown error'}`)
          }
        } catch (err) {
          this.log(
            `[auto-reply] Error auto-replying to ${recipientName}: ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        }
      }
    }
  }

  private async channelCursorInfo(
    source: ProjectSource,
    channelId: string
  ): Promise<{ cursor: number | null; lastSyncAt: string | null }> {
    if (!source.profileId) return { cursor: null, lastSyncAt: null }
    try {
      const delta = await this.deltaStore.load(source.profileId, source.workspaceId, channelId)
      const cursor = delta?.cursor ? Number.parseFloat(delta.cursor) : Number.NaN
      return {
        cursor: Number.isFinite(cursor) && cursor > 0 ? cursor : null,
        lastSyncAt: delta?.lastSyncAt ?? null
      }
    } catch {
      return { cursor: null, lastSyncAt: null }
    }
  }

  async channelCursor(source: ProjectSource, channelId: string): Promise<number | null> {
    const info = await this.channelCursorInfo(source, channelId)
    return info.cursor
  }

  async syncAll(
    options: { includeBrowserSources?: boolean } = {}
  ): Promise<DashboardProjectSnapshot[]> {
    const projects = await this.monitorStore.listProjects()
    const results: DashboardProjectSnapshot[] = []
    // One cache per cycle: cards watching the same channel share the page fetch.
    const historyCache: CycleHistoryCache = new Map()
    for (const project of projects) {
      const snap = await this.syncProject(project.id, historyCache, options)
      if (snap) results.push(snap)
    }
    try {
      this.onSynced?.(results)
    } catch (err) {
      this.logInfo(`[dashboard] post-sync hook failed: ${String(err)}`)
    }
    return results
  }

  /** Snapshot straight from stored data (no network). */
  async buildSnapshot(projectId?: string): Promise<DashboardProjectSnapshot[]> {
    const projects = await this.monitorStore.listProjects()
    const target = projectId ? projects.filter((p) => p.id === projectId) : projects
    const out: DashboardProjectSnapshot[] = []
    for (const project of target) {
      const cached = this.lastResults.get(project.id)
      if (cached) {
        // the cached snapshot may predate the latest insight (the enrich
        // step runs after the cache is written) — always refresh it. The
        // project record can also change (dates, completion, channels), so
        // re-derive the fields that depend on it.
        const refreshed: DashboardProjectSnapshot = {
          ...cached,
          project,
          effectiveDates: {
            startDate: project.startDate ?? cached.extractedDates?.startDate,
            endDate: project.endDate ?? cached.extractedDates?.endDate
          },
          completion: project.manualCompletion ?? cached.completion
        }
        out.push(await this.finishSnapshot(project, refreshed))
        continue
      }
      const perChannel = await this.storedDeltas(project)
      // cold start: summarize what is ALREADY stored, so the card is never
      // blank while waiting for the first network sync
      const messages = await this.collectMessages(project)
      const snapshot = this.buildFallbackSnapshot(project, perChannel, messages)
      out.push(await this.finishSnapshot(project, snapshot))
    }
    return out
  }

  /** Attach the stored insight, then the deterministic Dashboard metrics. */
  private async finishSnapshot(
    project: DashboardProject,
    snapshot: DashboardProjectSnapshot
  ): Promise<DashboardProjectSnapshot> {
    const withInsight = await this.attachLastInsight(project, snapshot)
    try {
      withInsight.metrics = await this.metricsFor(project, withInsight)
    } catch (err) {
      // A metrics failure must never blank a card; it keeps the last values.
      this.logInfo(`[dashboard] metrics failed for ${project.name}: ${String(err)}`)
    }
    return withInsight
  }

  /**
   * Build (or reuse) the Dashboard metrics. The expensive part reads the stored
   * channel files, so it is cached until a sync, an insight refresh, a project
   * edit, or a new visit marker changes the inputs.
   */
  private async metricsFor(
    project: DashboardProject,
    snapshot: DashboardProjectSnapshot
  ): Promise<DashboardMetrics> {
    const history = this.historyReader ? await this.historyReader(project.id) : []
    const lastViewedAt = this.viewedStore ? await this.viewedStore.get(project.id) : null
    const key = [
      snapshot.lastUpdatedAt ?? '',
      snapshot.totalMessageCount ?? 0,
      snapshot.insightUpdatedAt ?? '',
      snapshot.insight?.status ?? '',
      snapshot.insight?.progress ?? '',
      project.manualCompletion ?? '',
      project.startDate ?? '',
      project.endDate ?? '',
      history.length,
      history[0]?.atIso ?? '',
      lastViewedAt ?? ''
    ].join('|')
    const cached = this.metricsCache.get(project.id)
    if (cached && cached.key === key) return cached.value

    const messages = await this.collectMessages(project)
    const value = computeMetrics({
      project,
      messages,
      insight: snapshot.insight ?? null,
      history,
      lastViewedAt
    })
    this.metricsCache.set(project.id, { key, value })
    return value
  }

  /** v2.3 — the AI insight is shown even before the first sync of the session. */
  private async attachLastInsight(
    project: DashboardProject,
    snapshot: DashboardProjectSnapshot
  ): Promise<DashboardProjectSnapshot> {
    if (!this.insightReader) return snapshot
    try {
      const insight = await this.insightReader.getLastInsight(project.id)
      if (!insight) return snapshot
      const entry = await this.insightReader.getLastEntry(project.id)
      return {
        ...snapshot,
        insight,
        insightUpdatedAt: entry?.atIso ?? null,
        insightSource: entry?.source ?? null,
        insightModel: entry?.model ?? null
      }
    } catch (err) {
      this.logInfo(
        `[dashboard] could not load the stored insight for ${project.name}: ${String(err)}`
      )
      return snapshot
    }
  }

  /** how many messages the last sync added (activity signal for the feed) */
  newMessageCountFor(projectId: string): number {
    return this.lastResults.get(projectId)?.newMessageCount ?? 0
  }

  private async storedDeltas(project: DashboardProject): Promise<DashboardChannelDelta[]> {
    const { workspaces } = await this.storedWorkspaces(project)
    const out: DashboardChannelDelta[] = []

    for (const workspace of workspaces) {
      for (const channel of workspace.channels) {
        const d = await this.deltaStore.load(
          workspace.profileId,
          workspace.teamId,
          channel.channelId
        )
        if (d) out.push(this.perChannelDelta(d, workspace.source))
      }
    }
    return out
  }

  private buildFallbackSnapshot(
    project: DashboardProject,
    perChannel: DashboardChannelDelta[],
    messages: DashboardStoredMessage[] = []
  ): DashboardProjectSnapshot {
    return summarizeProject({
      project,
      messages,
      netNewCount: 0,
      perChannel,
      lastUpdatedAt: perChannel[0]?.lastSyncAt ?? null
    })
  }

  private async collectMessages(project: DashboardProject): Promise<DashboardStoredMessage[]> {
    const { workspaces } = await this.storedWorkspaces(project)
    const out: DashboardStoredMessage[] = []
    for (const workspace of workspaces) {
      for (const channel of workspace.channels) {
        const messages = await this.deltaStore.messagesSince(
          workspace.profileId,
          workspace.teamId,
          channel.channelId
        )
        for (const message of messages) {
          out.push(message.source ? message : { ...message, source: workspace.source })
        }
      }
    }
    return out
  }
}

/**
 * v2.2 subclass — identical behavior plus an optional post-sync insight
 * refresh (NVIDIA NIM). Additive: base engine stays untouched.
 */
export class DashboardInsightSyncEngine extends DashboardSyncEngine {
  private insightEngine: InsightEngine | null
  private readonly lastAiAnalysisAt = new Map<string, number>()

  constructor(deps: DashboardSyncEngineDeps & { insightEngine?: InsightEngine | null }) {
    super(deps)
    if (deps.insightEngine) {
      this.insightEngine = deps.insightEngine
    } else {
      this.insightEngine = null
    }
  }

  /** attach insights later (e.g. after env key detected) */
  setInsightEngine(engine: InsightEngine | null): void {
    this.insightEngine = engine
  }

  private async enrich(
    project: DashboardProject,
    snapshot: DashboardProjectSnapshot,
    token: string | null,
    options?: { force?: boolean }
  ): Promise<DashboardProjectSnapshot> {
    if (!this.insightEngine) return snapshot
    try {
      return await this.insightEngine.refresh(project, token, snapshot, options)
    } catch {
      return snapshot
    }
  }

  /**
   * Browser-only cards have no Slack token. They still get a heuristic insight
   * from the messages they scraped, so this must not skip enrichment.
   */
  override async syncProject(
    projectId: string,
    historyCache?: CycleHistoryCache,
    options: { includeBrowserSources?: boolean } = {}
  ): Promise<DashboardProjectSnapshot | null> {
    const snapshot = await super.syncProject(projectId, historyCache, options)
    if (!snapshot || !this.insightEngine) return snapshot
    const projects = await this.monitorStore.listProjects()
    const project = projects.find((p) => p.id === projectId)
    if (!project) return snapshot
    const token = await this.tokenFor(project).catch(() => null)
    const enriched = await this.enrich(project, snapshot, token, { force: true })
    this.lastResults.set(projectId, enriched)
    return enriched
  }

  override async syncProjectSource(
    projectId: string,
    sourceId?: string,
    extra: { trigger?: ScrapeTrigger; options?: DashboardScrapeOptions } = {}
  ): Promise<{
    runId: string
    channelsRead: number
    newMessages: number
    status: ScrapeRunStatus
    error?: string
  }> {
    const result = await super.syncProjectSource(projectId, sourceId, extra)

    // Decoupled AI Token Optimization:
    // Raw Slack messages are polled rapidly (10s-20s) at ZERO AI token cost ($0).
    // The expensive LLM analysis is ONLY triggered when:
    // 1. Genuine new messages were captured (result.newMessages > 0), OR
    // 2. User clicked manual scrape/refresh ('Sync now' / 'Refresh Insight'), OR
    // 3. Heartbeat timer (6 hours) expires.
    const now = Date.now()
    const lastAiTime = this.lastAiAnalysisAt.get(projectId)
    const sixHoursMs = 6 * 60 * 60 * 1000
    const hasNewMessages = (result.newMessages ?? 0) > 0
    const isManual = extra.trigger === 'manual'
    const isHeartbeat = typeof lastAiTime === 'number' && now - lastAiTime >= sixHoursMs

    if (hasNewMessages) {
      this.chatService?.invalidateActivityCache(projectId)
      this.metricsCache.delete(projectId)
      this.lastResults.delete(projectId)
    }

    if (hasNewMessages || isManual || isHeartbeat) {
      this.lastAiAnalysisAt.set(projectId, now)
      await this.refreshInsightForProject(projectId, { force: true }).catch((err) => {
        this.logInfo(
          `[dashboard] post-scrape insight refresh failed (${projectId}): ${String(err)}`
        )
      })
    } else {
      this.logInfo(
        `[dashboard] skipping LLM analysis for ${projectId}: 0 new messages, saving 100% of AI tokens`
      )
    }
    return result
  }

  /** Refresh insight from stored messages, with or without a token. */
  async refreshInsightForProject(
    projectId: string,
    options?: { force?: boolean }
  ): Promise<DashboardProjectSnapshot | null> {
    const projects = await this.monitorStore.listProjects()
    const project = projects.find((p) => p.id === projectId)
    if (!project) return null

    if (!this.insightEngine) {
      const snapshots = await this.buildSnapshot(projectId)
      const snapshot = snapshots[0] ?? null
      if (snapshot) {
        snapshot.lastUpdatedAt = new Date().toISOString()
        this.lastResults.set(projectId, snapshot)
        try {
          this.onSynced?.([snapshot])
        } catch (err) {
          this.logInfo(`[dashboard] post-insight hook failed: ${String(err)}`)
        }
      }
      return snapshot
    }

    const token = await this.tokenFor(project).catch(() => null)
    const snapshots = await this.buildSnapshot(projectId)
    const snapshot = snapshots[0]
    if (!snapshot) return null
    snapshot.lastUpdatedAt = new Date().toISOString()
    const enriched = await this.enrich(project, snapshot, token, options)
    enriched.lastUpdatedAt = snapshot.lastUpdatedAt
    this.lastResults.set(projectId, enriched)
    try {
      this.onSynced?.([enriched])
    } catch (err) {
      this.logInfo(`[dashboard] post-insight hook failed: ${String(err)}`)
    }
    return enriched
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** Classify a sidebar row without trusting a single attribute. */
function channelKind(channel: ProjectSourceChannel): ScrapeChannelKind {
  if (channel.kind) return channel.kind
  if (channel.isDm) return 'dm'
  if (channel.isPrivate) return 'private'
  const id = channel.id ?? ''
  if (id.startsWith('D')) return 'dm'
  if (id.startsWith('G')) return 'private'
  return 'public'
}

/** Effective DM gate: per-run override → card policy → global setting. */
function resolveDmPolicy(
  source: ProjectSource,
  options: DashboardScrapeOptions | undefined,
  globalEnabled: boolean
): boolean {
  if (typeof options?.includeDms === 'boolean') return options.includeDms
  const policy = source.allowDms ?? 'inherit'
  if (policy === 'on') return true
  if (policy === 'off') return false
  return globalEnabled
}
