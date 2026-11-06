import type {
  DashboardChatMessage,
  DashboardChatPage,
  DashboardChatQueryPayload,
  DashboardChatTokenStatus,
  DashboardProject,
  DashboardProjectActivity,
  DashboardSendMessagePayload,
  DashboardSendMessageResult,
  DashboardSource
} from '../../shared/dashboard-contract'
import type { DashboardDeltaStore, DashboardStoredMessage } from './delta-store'
import { compareTs } from './delta-store'
import type { MonitorStore } from './monitor-store'
import { maskKey } from './ai-settings-store'
import { SlackPoller } from './slack-poller'
import { buildProjectActivity, type ActivityInputRow } from './activity-summary'
import { resolveProjectMessageSources } from './message-sources'
import { slackUserCache } from './slack-api-client'

/** Minimal poller surface the chat service needs (fakeable in tests). */
export interface ChatPoller {
  authTest(token: string): Promise<{
    valid: boolean
    userId?: string
    scopes?: string[]
    error?: string
  }>
  usersList(token: string): Promise<Map<string, string>>
  postMessage(input: {
    token: string
    channelId: string
    text: string
  }): Promise<{ ts: string; channelId: string }>
}

export interface ChatServiceDeps {
  monitorStore: MonitorStore
  deltaStore: DashboardDeltaStore
  oauthTokenProvider: { tryGet(profileId: string, teamId: string): Promise<string | null> }
  /** v3 — the globally connected team workspace (read-only here). */
  teamWorkspace?: {
    getConnection(): Promise<{
      profileId: string
      teamId: string
      token: string | null
      channels: Array<{ channelId: string; channelName: string }>
    } | null>
  }
  /** Stored scopes from the OAuth workspace link (best effort). */
  oauthScopesProvider?: (profileId: string, teamId: string) => Promise<string[] | null>
  pollerFactory?: () => ChatPoller
  log?: (msg: string) => void
  now?: () => number
}

/** One workspace the chat panel can read: the card's own, or ours. */
interface ChatWorkspace {
  source: DashboardSource
  profileId: string
  teamId: string
  token: string | null
  monitors: Array<{ channelId: string; channelName: string }>
}

export interface ChatRow {
  msg: DashboardStoredMessage
  channelId: string
  channelName: string
}

interface ChatWorkspaceContext {
  at: number
  names: Map<string, string>
  selfUserId: string | null
  scopes: string[] | null
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_TEXT_LENGTH = 4000
const CONTEXT_TTL_MS = 5 * 60_000
const ACTIVITY_WINDOW_DAYS = 14
const ACTIVITY_CHANNEL_CAP = 200
const ACTIVITY_CACHE_TTL_MS = 500

function emptyActivity(): DashboardProjectActivity {
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

export const MISSING_SCOPE_MESSAGE =
  "This Slack token is missing the chat:write scope, so Cosmic cannot post replies. Add chat:write to the Slack app's User Token Scopes (OAuth & Permissions), reinstall or reconnect the workspace, then try again."

export const NOT_CONNECTED_MESSAGE =
  'No Slack token is available for this workspace. Reconnect the workspace or add a manual token.'

/** Rows must be sorted ascending by ts. Returns the newest `limit` older-than-`beforeTs` slice. */
export function selectChatPage(
  rows: ChatRow[],
  beforeTs: string | undefined,
  limit: number
): { page: ChatRow[]; hasMore: boolean; nextBeforeTs: string | null } {
  const filtered = beforeTs ? rows.filter((row) => compareTs(row.msg.ts, beforeTs) < 0) : rows
  const page = filtered.slice(-limit)
  const hasMore = filtered.length > page.length
  return {
    page,
    hasMore,
    nextBeforeTs: hasMore && page.length > 0 ? page[0].msg.ts : null
  }
}

function isoFromTs(ts: string): string {
  const seconds = Number(ts)
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString()
}

function isDisplayable(msg: DashboardStoredMessage): boolean {
  if (!msg.text || !msg.text.trim()) return false
  return !(
    msg.subtype === 'message_changed' ||
    msg.subtype === 'message_deleted' ||
    msg.subtype === 'channel_join' ||
    msg.subtype === 'channel_leave'
  )
}

/**
 * Local Slack chat for one project: reads the delta store (JSON per channel) and
 * posts replies with chat.postMessage. The only writable surface in the dashboard.
 */
export class DashboardChatService {
  private readonly monitorStore: MonitorStore
  private readonly deltaStore: DashboardDeltaStore
  private readonly oauthTokenProvider: ChatServiceDeps['oauthTokenProvider']
  private readonly teamWorkspace: ChatServiceDeps['teamWorkspace']
  private readonly oauthScopesProvider?: ChatServiceDeps['oauthScopesProvider']
  private readonly pollerFactory: () => ChatPoller
  private readonly log: (msg: string) => void
  private readonly now: () => number
  private readonly contextCache = new Map<string, ChatWorkspaceContext>()
  private readonly activityCache = new Map<string, { at: number; value: DashboardProjectActivity }>()

  constructor(deps: ChatServiceDeps) {
    this.monitorStore = deps.monitorStore
    this.deltaStore = deps.deltaStore
    this.oauthTokenProvider = deps.oauthTokenProvider
    this.teamWorkspace = deps.teamWorkspace
    this.oauthScopesProvider = deps.oauthScopesProvider
    this.pollerFactory = deps.pollerFactory ?? ((): ChatPoller => new SlackPoller())
    this.log = deps.log ?? ((): void => undefined)
    this.now = deps.now ?? ((): number => Date.now())
  }

  private async projectFor(projectId: string): Promise<DashboardProject | null> {
    const projects = await this.monitorStore.listProjects()
    return projects.find((p) => p.id === projectId) ?? null
  }

  private async tokenFor(project: DashboardProject): Promise<string | null> {
    if (project.tokenSource === 'manual') {
      if (!project.manualTokenKey) return null
      return this.monitorStore.getManualToken(project.manualTokenKey)
    }
    return this.oauthTokenProvider.tryGet(project.profileId, project.teamId)
  }

  /** Resolve the workspace a panel is reading: the card's own, or our team's. */
  private async workspaceFor(
    project: DashboardProject,
    source: DashboardSource
  ): Promise<ChatWorkspace | null> {
    if (source === 'ours') {
      if (!this.teamWorkspace) return null
      const connection = await this.teamWorkspace.getConnection()
      if (!connection) return null
      return {
        source: 'ours',
        profileId: connection.profileId,
        teamId: connection.teamId,
        token: connection.token,
        monitors: connection.channels
      }
    }
    const resolved = resolveProjectMessageSources(project)
    const clientSource = resolved.find((workspace) => workspace.role === 'client')
    return {
      source: 'client',
      profileId: clientSource?.profileId ?? project.profileId,
      teamId: clientSource?.teamId ?? project.teamId,
      token: await this.tokenFor(project),
      monitors: resolved
        .filter((workspace) => workspace.role === 'client')
        .flatMap((workspace) =>
          workspace.channels.map((channel) => ({
            channelId: channel.channelId,
            channelName: channel.channelName
          }))
        )
    }
  }

  /** Best-effort names + token owner + scopes, cached per workspace for 5 minutes. */
  private async workspaceContext(
    project: DashboardProject,
    token: string,
    identity?: { profileId: string; teamId: string; label?: string }
  ): Promise<ChatWorkspaceContext> {
    const profileId = identity?.profileId ?? project.profileId
    const teamId = identity?.teamId ?? project.teamId
    const label = identity?.label ?? project.name
    const key = `${profileId}:${teamId}`
    const cached = this.contextCache.get(key)
    const now = this.now()
    if (cached && now - cached.at < CONTEXT_TTL_MS) return cached

    const poller = this.pollerFactory()
    let names = new Map<string, string>()
    let selfUserId: string | null = null
    let scopes: string[] | null = null

    try {
      const auth = await poller.authTest(token)
      selfUserId = auth.userId ?? null
      scopes = Array.isArray(auth.scopes) ? auth.scopes : null
    } catch (err) {
      this.log(`[dashboard] chat auth.test failed for ${label}: ${String(err)}`)
    }
    try {
      names = await poller.usersList(token)
    } catch (err) {
      this.log(`[dashboard] chat users.list failed for ${label}: ${String(err)}`)
    }

    const context: ChatWorkspaceContext = { at: now, names, selfUserId, scopes }
    this.contextCache.set(key, context)
    return context
  }

  /**
   * OAuth links store the scopes granted at connect time. Slack's auth.test does
   * not report scopes for manual tokens, so those are only validated by Slack on
   * chat.postMessage and mapped to `missing_scope` below.
   */
  private async scopesFor(project: DashboardProject, token: string): Promise<string[] | null> {
    if (project.tokenSource === 'oauth' && this.oauthScopesProvider) {
      try {
        const stored = await this.oauthScopesProvider(project.profileId, project.teamId)
        if (stored && stored.length > 0) return stored
      } catch {
        // fall through to auth.test
      }
    }
    try {
      const context = await this.workspaceContext(project, token)
      return context.scopes
    } catch {
      return null
    }
  }

  /**
   * Slack token health for the Settings section: connection, granted scopes
   * (best effort — auth.test omits them for some token types) and whether
   * chat.postMessage replies are possible.
   */
  async chatTokenStatus(projectId: string): Promise<DashboardChatTokenStatus> {
    const project = await this.projectFor(projectId)
    if (!project) {
      return {
        connected: false,
        source: 'none',
        teamName: null,
        maskedToken: null,
        scopes: null,
        canSend: null,
        missingWriteScope: false
      }
    }
    const source = project.tokenSource === 'manual' ? 'manual' : 'oauth'
    const teamName = project.teamName ?? project.teamId ?? null
    const token = await this.tokenFor(project)
    if (!token) {
      return {
        connected: false,
        source,
        teamName,
        maskedToken: null,
        scopes: null,
        canSend: false,
        missingWriteScope: false
      }
    }
    const scopes = await this.scopesFor(project, token)
    const canSend = scopes === null ? null : scopes.includes('chat:write')
    return {
      connected: true,
      source,
      teamName,
      maskedToken: maskKey(token),
      scopes,
      canSend,
      missingWriteScope: canSend === false
    }
  }

  private toChatMessage(
    project: DashboardProject,
    row: { channelId: string; channelName: string },
    msg: DashboardStoredMessage,
    context: ChatWorkspaceContext | null,
    source: DashboardSource
  ): DashboardChatMessage {
    const rawUser = msg.user ?? ''
    const isSlackId = /^U[A-Z0-9_]+$/.test(rawUser)
    const selfUserId = project.selfUserId ?? context?.selfUserId ?? null
    const resolved =
      context?.names.get(rawUser) ||
      slackUserCache.get(rawUser) ||
      (!isSlackId && rawUser ? rawUser : undefined)
    const isMine = Boolean(selfUserId && (rawUser === selfUserId || rawUser === 'You' || rawUser === 'me'))
    const fallbackName = project.name?.includes('Ashutosh') ? 'Ashutosh' : (rawUser || 'Unknown')
    return {
      ts: msg.ts,
      channelId: row.channelId,
      channelName: row.channelName,
      userId: rawUser,
      userName: resolved || (isMine ? 'You' : fallbackName),
      source,
      text: msg.text ?? '',
      atIso: isoFromTs(msg.ts),
      isMine
    }
  }

  async loadMessages(payload: DashboardChatQueryPayload): Promise<DashboardChatPage> {
    const project = await this.projectFor(payload.projectId)
    if (!project) return { messages: [], nextBeforeTs: null, hasMore: false }

    const source = payload.source ?? 'client'
    const workspace = await this.workspaceFor(project, source)
    if (!workspace) return { messages: [], nextBeforeTs: null, hasMore: false }

    const monitors = payload.channelId
      ? workspace.monitors.filter((m) => m.channelId === payload.channelId)
      : workspace.monitors

    const rows: ChatRow[] = []
    for (const monitor of monitors) {
      const delta = await this.deltaStore.load(
        workspace.profileId,
        workspace.teamId,
        monitor.channelId
      )
      for (const msg of delta?.messages ?? []) {
        if (!isDisplayable(msg)) continue
        rows.push({
          msg,
          channelId: monitor.channelId,
          channelName: monitor.channelName
        })
      }
    }
    rows.sort((a, b) => compareTs(a.msg.ts, b.msg.ts))

    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(payload.limit ?? DEFAULT_LIMIT)))
    const { page, hasMore, nextBeforeTs } = selectChatPage(rows, payload.beforeTs, limit)

    let context: ChatWorkspaceContext | null = null
    try {
      if (workspace.token)
        context = await this.workspaceContext(project, workspace.token, {
          profileId: workspace.profileId,
          teamId: workspace.teamId
        })
    } catch {
      // names fall back to Slack ids
    }

    return {
      messages: page.map((row) => this.toChatMessage(project, row, row.msg, context, source)),
      nextBeforeTs,
      hasMore
    }
  }

  /**
   * Deterministic 14-day activity for the Dashboard centre. Reads stored deltas
   * only: bounded to the window, capped per channel, and cached for 60 seconds.
   * Our-Slack rows are restricted to the channels mapped on this project.
   */
  async projectActivity(projectId: string): Promise<DashboardProjectActivity> {
    if (typeof projectId !== 'string' || !projectId.trim()) return emptyActivity()

    const now = this.now()
    const cached = this.activityCache.get(projectId)
    if (cached && now - cached.at < ACTIVITY_CACHE_TTL_MS) return cached.value

    const project = await this.projectFor(projectId)
    if (!project) return emptyActivity()

    const rows: ActivityInputRow[] = []
    const cutoff = now - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60_000

    for (const source of ['client', 'ours'] as const) {
      const workspace = await this.workspaceFor(project, source)
      if (!workspace) continue

      const monitors =
        source === 'ours'
          ? workspace.monitors.filter((monitor) =>
              project.ourSlackChannels?.some((mapped) => mapped.channelId === monitor.channelId)
            )
          : workspace.monitors
      if (monitors.length === 0) continue

      let context: ChatWorkspaceContext | null = null
      if (workspace.token) {
        try {
          context = await this.workspaceContext(project, workspace.token, {
            profileId: workspace.profileId,
            teamId: workspace.teamId
          })
        } catch {
          // names fall back to Slack ids
        }
      }
      const selfUserId =
        source === 'client'
          ? (project.selfUserId ?? context?.selfUserId ?? null)
          : (context?.selfUserId ?? null)

      for (const monitor of monitors) {
        const delta = await this.deltaStore.load(
          workspace.profileId,
          workspace.teamId,
          monitor.channelId
        )
        const messages = (delta?.messages ?? [])
          .filter((msg) => {
            const ms = Number(msg.ts) * 1000
            return Number.isFinite(ms) && ms >= cutoff
          })
          .slice(-ACTIVITY_CHANNEL_CAP)

        for (const msg of messages) {
          const rawUser = msg.user ?? ''
          const isSlackId = /^U[A-Z0-9_]+$/.test(rawUser)
          const resolved =
            context?.names.get(rawUser) ||
            slackUserCache.get(rawUser) ||
            (!isSlackId && rawUser ? rawUser : undefined)
          const isMine = Boolean(selfUserId && (rawUser === selfUserId || rawUser === 'You' || rawUser === 'me'))
          const fallbackName = project.name?.includes('Ashutosh') ? 'Ashutosh' : (rawUser || 'Unknown')
          rows.push({
            source,
            channelId: monitor.channelId,
            channelName: monitor.channelName,
            ts: msg.ts,
            userId: rawUser,
            userName:
              resolved || (isMine ? 'You' : fallbackName),
            isMine,
            text: msg.text ?? '',
            permalink: msg.permalink,
            subtype: msg.subtype
          })
        }
      }
    }

    const value = buildProjectActivity({ rows, now })
    this.activityCache.set(projectId, { at: now, value })
    return value
  }

  /**
   * Invalidate cached project activity so the UI re-fetches latest messages immediately.
   */
  invalidateActivityCache(projectId?: string): void {
    if (projectId) {
      this.activityCache.delete(projectId)
    } else {
      this.activityCache.clear()
    }
  }

  async sendMessage(payload: DashboardSendMessagePayload): Promise<DashboardSendMessageResult> {
    const text = (payload.text ?? '').trim()
    if (!text) {
      return { ok: false, code: 'invalid_text', error: 'Write a message before sending.' }
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return {
        ok: false,
        code: 'invalid_text',
        error: `Slack messages are limited to ${MAX_TEXT_LENGTH} characters.`
      }
    }

    const project = await this.projectFor(payload.projectId)
    if (!project) {
      return { ok: false, code: 'not_connected', error: 'This project no longer exists.' }
    }
    const source = payload.source ?? 'client'
    const workspace = await this.workspaceFor(project, source)
    if (!workspace) {
      return {
        ok: false,
        code: 'not_connected',
        error: 'Our team workspace is not connected. Connect it in Global settings.'
      }
    }
    const monitor = workspace.monitors.find((m) => m.channelId === payload.channelId)
    if (!monitor) {
      return {
        ok: false,
        code: 'channel_not_found',
        error: 'That channel is not watched by this project.'
      }
    }

    // Security check: if this is an automated agent dispatch, verify agentWrite or autoReply permission
    if (payload.isAgent) {
      const allChannels = (project.sources ?? []).flatMap((s) => s.channels ?? [])
      const matched = allChannels.find((c) => c.id === payload.channelId)
      if (!matched || (!matched.agentWrite && !matched.autoReply)) {
        return {
          ok: false,
          code: 'permission_denied',
          error: `Agent write permission is disabled for #${monitor.channelName}. Enable it in Workspace Control.`
        }
      }
    }

    const token = workspace.token
    const browserSource = (project.sources ?? []).find(
      (s) => s.kind === 'browser' && s.enabled !== false && s.workspaceId === workspace.teamId
    )

    // Helper for Direct API + browser DOM posting fallback
    const tryPostViaDirectApiOrBrowser = async (): Promise<DashboardSendMessageResult> => {
      if (!browserSource?.profileId || !browserSource?.workspaceId) {
        return { ok: false, code: 'missing_scope', error: MISSING_SCOPE_MESSAGE }
      }
      try {
        // Fast path: Zero-DOM Direct API posting
        const cacheKey = `slack:${project.id}:${browserSource.workspaceId}`
        try {
          const { sessionTokenExtractor } = await import('../slack-reader/session-token-extractor')
          const { partitionForCard, partitionForProfile } = await import('../profiles/session-partition')
          const { SlackApiClient } = await import('./slack-api-client')

          const partitions = [
            partitionForCard(project.id, 'slack'),
            partitionForProfile(browserSource.profileId, 'slack')
          ]
          const creds = await sessionTokenExtractor.extractSlackSessionTokens([], cacheKey, { partitions })
          if (creds) {
            const client = new SlackApiClient(creds)
            const res = await client.postChannelMessage(monitor.channelId, text)
            if (res.ok) {
              const nowTs = res.ts || `${(Date.now() / 1000).toFixed(6)}`
              await this.deltaStore.appendMessages({
                profileId: workspace.profileId,
                teamId: workspace.teamId,
                channelId: monitor.channelId,
                channelName: monitor.channelName,
                source,
                messages: [{ ts: nowTs, user: project.selfUserId || 'me', text }]
              })

              return {
                ok: true,
                message: this.toChatMessage(
                  project,
                  { channelId: monitor.channelId, channelName: monitor.channelName },
                  { ts: nowTs, user: project.selfUserId || 'me', text },
                  null,
                  source
                )
              }
            }
          }
        } catch {
          // Direct API failed or unavailable; fall through to browser view
        }

        const { SlackReaderView } = await import('../slack-reader/slack-reader-view')
        const reader = new SlackReaderView({
          profileId: browserSource.profileId,
          workspaceId: browserSource.workspaceId
        })
        const ok = await reader.postChannelMessage(monitor.channelId, text)
        reader.destroy()
        if (!ok) {
          return { ok: false, code: 'browser_error', error: 'Failed to post message via browser session.' }
        }

        const nowTs = `${(Date.now() / 1000).toFixed(6)}`
        await this.deltaStore.appendMessages({
          profileId: workspace.profileId,
          teamId: workspace.teamId,
          channelId: monitor.channelId,
          channelName: monitor.channelName,
          source,
          messages: [{ ts: nowTs, user: project.selfUserId || 'me', text }]
        })

        return {
          ok: true,
          message: this.toChatMessage(
            project,
            { channelId: monitor.channelId, channelName: monitor.channelName },
            { ts: nowTs, user: project.selfUserId || 'me', text },
            null,
            source
          )
        }
      } catch (err) {
        return { ok: false, code: 'browser_error', error: err instanceof Error ? err.message : String(err) }
      }
    }

    if (!token) {
      if (browserSource) {
        return tryPostViaDirectApiOrBrowser()
      }
      return { ok: false, code: 'not_connected', error: NOT_CONNECTED_MESSAGE }
    }

    // Scopes check
    if (source === 'client') {
      const scopes = await this.scopesFor(project, token)
      if (scopes && scopes.length > 0 && !scopes.includes('chat:write')) {
        if (browserSource) {
          return tryPostViaDirectApiOrBrowser()
        }
        return {
          ok: false,
          code: 'missing_scope',
          missingScope: 'chat:write',
          error: MISSING_SCOPE_MESSAGE
        }
      }
    }

    try {
      const sent = await this.pollerFactory().postMessage({
        token,
        channelId: monitor.channelId,
        text
      })

      let context: ChatWorkspaceContext | null = null
      try {
        context = await this.workspaceContext(project, token, {
          profileId: workspace.profileId,
          teamId: workspace.teamId
        })
      } catch {
        // message still succeeded; names fall back to ids
      }
      const selfUserId =
        context?.selfUserId ?? (source === 'client' ? project.selfUserId : undefined) ?? undefined

      // Persist locally so the reply survives reloads and the next sync dedupes it.
      await this.deltaStore.appendMessages({
        profileId: workspace.profileId,
        teamId: workspace.teamId,
        channelId: monitor.channelId,
        channelName: monitor.channelName,
        source,
        messages: [{ ts: sent.ts, user: selfUserId, text }]
      })

      return {
        ok: true,
        message: this.toChatMessage(
          project,
          { channelId: monitor.channelId, channelName: monitor.channelName },
          { ts: sent.ts, user: selfUserId, text },
          context,
          source
        )
      }
    } catch (err) {
      const slackError = (err as Error & { slackError?: string }).slackError
      if (slackError === 'missing_scope') {
        return {
          ok: false,
          code: 'missing_scope',
          missingScope: 'chat:write',
          error: MISSING_SCOPE_MESSAGE
        }
      }
      if (slackError === 'channel_not_found' || slackError === 'not_in_channel') {
        return {
          ok: false,
          code: 'channel_not_found',
          error: `Slack could not post to #${monitor.channelName}. Check that the channel still exists and the token can post there.`
        }
      }
      if (
        slackError === 'invalid_auth' ||
        slackError === 'not_authed' ||
        slackError === 'token_revoked'
      ) {
        return { ok: false, code: 'not_connected', error: NOT_CONNECTED_MESSAGE }
      }
      return {
        ok: false,
        code: slackError ? 'slack_error' : 'unknown',
        error: slackError
          ? `Slack rejected the message: ${slackError}`
          : 'Could not send the message to Slack.'
      }
    }
  }
}
