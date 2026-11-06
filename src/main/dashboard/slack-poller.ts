/** Slack API polling dedicated to the dashboard (existing client untouched). */
import type { DashboardStoredMessage } from './delta-store'
import { reportSlackRateLimit, slackTokenKey, withSlackLimit } from './slack-throttle'

export interface PollFetchResult {
  messages: DashboardStoredMessage[]
  hasMore: boolean
}

interface HistoryResponse {
  ok: boolean
  error?: string
  messages?: Array<{
    ts: string
    user?: string
    text?: string
    subtype?: string
    thread_ts?: string
    reply_count?: number
  }>
  response_metadata?: { next_cursor?: string }
}

interface RepliesResponse {
  ok: boolean
  error?: string
  messages?: Array<{
    ts: string
    user?: string
    text?: string
    subtype?: string
    thread_ts?: string
    reply_count?: number
  }>
  response_metadata?: { next_cursor?: string }
}

interface AuthTestResponse {
  ok: boolean
  error?: string
  team_id?: string
  team?: string
  user_id?: string
  user?: string
  url?: string
  scopes?: string[]
}

interface UsersListResponse {
  ok: boolean
  error?: string
  members?: Array<{
    id: string
    name?: string
    real_name?: string
    profile?: { display_name?: string; real_name?: string }
  }>
}

interface PostMessageResponse {
  ok: boolean
  error?: string
  ts?: string
  channel?: string
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const SLACK_TIMEOUT_MS = 20_000
/** A 429 is retried at most this many times, then the sync fails cleanly. */
const MAX_RATE_LIMIT_RETRIES = 3
/** Pages of channel history per sync (200 messages each at Slack's max). */
const MAX_HISTORY_PAGES = 5
/** Threads expanded per channel per sync, and pages inside each thread. */
const MAX_THREADS_PER_SYNC = 10
const MAX_THREAD_PAGES = 3

interface SlackCallResult<T> {
  body: T
  /** x-oauth-scopes header, when Slack returns it. */
  scopes: string[] | null
}

function parseScopes(header: string | null): string[] | null {
  if (!header) return null
  const scopes = header
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
  return scopes.length > 0 ? scopes : null
}

/** Slack errors whose only fix is reconnecting the token. */
const SLACK_RECONNECT_ERRORS = new Set([
  'invalid_auth',
  'not_authed',
  'token_revoked',
  'account_inactive'
])

/** True when a poller error means "the token is dead" (never for network blips). */
export function isSlackAuthFailure(err: unknown): boolean {
  const slackError = (err as (Error & { slackError?: string }) | undefined)?.slackError
  return slackError !== undefined && SLACK_RECONNECT_ERRORS.has(slackError)
}

async function fetchSlack(
  method: string,
  token: string,
  params: Record<string, string>
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS)
  try {
    return await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(params)
    })
  } catch (err) {
    throw new Error(`slack ${method}: ${err instanceof Error ? err.message : 'request failed'}`)
  } finally {
    clearTimeout(timer)
  }
}

function rateLimitWaitMs(res: Response): number {
  const retryAfter = Number(res.headers.get('Retry-After') ?? '1')
  const waitSeconds = Number.isFinite(retryAfter) ? Math.min(60, Math.max(1, retryAfter)) : 1
  return waitSeconds * 1000
}

async function handleRateLimit<T extends { ok: boolean; error?: string }>(
  method: string,
  token: string,
  params: Record<string, string>,
  attempt: number,
  res: Response
): Promise<SlackCallResult<T>> {
  if (attempt >= MAX_RATE_LIMIT_RETRIES) {
    const err = new Error(`slack ${method}: still rate limited after ${attempt + 1} attempts`)
    ;(err as Error & { slackError?: string }).slackError = 'ratelimited'
    throw err
  }
  const waitMs = rateLimitWaitMs(res)
  // Every other caller on this token must also wait out the window.
  reportSlackRateLimit(slackTokenKey(token), waitMs)
  await sleep(waitMs)
  return callApiDetailed<T>(method, token, params, attempt + 1)
}

async function callApiDetailed<T extends { ok: boolean; error?: string }>(
  method: string,
  token: string,
  params: Record<string, string>,
  attempt = 0
): Promise<SlackCallResult<T>> {
  const res = await withSlackLimit(slackTokenKey(token), () => fetchSlack(method, token, params))
  // A 429 status is a rate limit even when the body is not Slack's JSON error.
  if (res.status === 429) {
    return handleRateLimit<T>(method, token, params, attempt, res)
  }
  const body = (await res.json()) as T
  if (!body.ok) {
    if (body.error === 'ratelimited') {
      return handleRateLimit<T>(method, token, params, attempt, res)
    }
    const err = new Error(`slack ${method}: ${body.error}`)
    ;(err as Error & { slackError?: string }).slackError = body.error
    throw err
  }
  return { body, scopes: parseScopes(res.headers.get('x-oauth-scopes')) }
}

async function callApi<T extends { ok: boolean; error?: string }>(
  method: string,
  token: string,
  params: Record<string, string>,
  attempt = 0
): Promise<T> {
  return (await callApiDetailed<T>(method, token, params, attempt)).body
}

/** Build the canonical archive link Slack itself uses for a message. */
export function slackPermalink(
  teamUrl: string | null,
  channelId: string,
  ts: string
): string | undefined {
  if (!teamUrl) return undefined
  const base = teamUrl.replace(/\/+$/, '')
  if (!base) return undefined
  return `${base}/archives/${channelId}/p${ts.replace('.', '')}`
}

export interface SlackPollerOptions {
  baseUrl?: string
  draftPage?: <T>(url: string, token: string, params: Record<string, string>) => Promise<T>
}

export class SlackPoller {
  private readonly baseUrl: string
  /** Workspace base URL per token, so permalinks cost one auth.test per token. */
  private readonly teamUrlCache = new Map<string, string | null>()

  constructor(options: SlackPollerOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://slack.com/api/'
  }

  /**
   * Fetch messages newer than afterTs, following pagination up to a safety cap,
   * expanding the newest threads so replies are not invisible to the agent.
   * Every message carries its workspace permalink when Slack reported one.
   */
  async fetchHistory(input: {
    token: string
    channelId: string
    afterTs?: string
    limit?: number
  }): Promise<PollFetchResult> {
    if (this.baseUrl.startsWith('http://_FAKE')) return { messages: [], hasMore: false }
    const teamUrl = await this.teamUrl(input.token)
    const messages: DashboardStoredMessage[] = []
    const seen = new Set<string>()
    let cursor: string | undefined
    let pages = 0
    let more = false

    do {
      const res = await callApi<HistoryResponse>('conversations.history', input.token, {
        channel: input.channelId,
        limit: String(input.limit ?? 200),
        ...(input.afterTs ? { oldest: input.afterTs } : {}),
        ...(cursor ? { cursor } : {})
      })
      for (const m of res.messages ?? []) {
        if (seen.has(m.ts)) continue
        seen.add(m.ts)
        messages.push({
          ts: m.ts,
          user: m.user,
          text: m.text ?? '',
          subtype: m.subtype,
          permalink: slackPermalink(teamUrl, input.channelId, m.ts),
          ...(m.thread_ts && m.thread_ts !== m.ts ? { threadTs: m.thread_ts } : {}),
          ...(typeof m.reply_count === 'number' ? { replyCount: m.reply_count } : {})
        })
      }
      cursor = res.response_metadata?.next_cursor || undefined
      pages += 1
      more = Boolean(cursor)
    } while (cursor && pages < MAX_HISTORY_PAGES)

    // Threads are expanded for the parents we just fetched: the agent must see
    // the answer that lives three replies below the message it matched.
    const parents = messages
      .filter((m) => (m.replyCount ?? 0) > 0 && !m.threadTs)
      .slice(0, MAX_THREADS_PER_SYNC)
    for (const parent of parents) {
      try {
        const replies = await this.fetchReplies(input.token, input.channelId, parent.ts, teamUrl)
        for (const reply of replies) {
          if (seen.has(reply.ts)) continue
          seen.add(reply.ts)
          messages.push(reply)
        }
      } catch {
        // A thread that cannot be read must not lose the parent message.
      }
    }

    return { messages, hasMore: more }
  }

  private async fetchReplies(
    token: string,
    channelId: string,
    parentTs: string,
    teamUrl: string | null
  ): Promise<DashboardStoredMessage[]> {
    const out: DashboardStoredMessage[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const res = await callApi<RepliesResponse>('conversations.replies', token, {
        channel: channelId,
        ts: parentTs,
        limit: '200',
        ...(cursor ? { cursor } : {})
      })
      for (const m of res.messages ?? []) {
        if (m.ts === parentTs) continue
        out.push({
          ts: m.ts,
          user: m.user,
          text: m.text ?? '',
          subtype: m.subtype,
          permalink: slackPermalink(teamUrl, channelId, m.ts),
          threadTs: m.thread_ts ?? parentTs
        })
      }
      cursor = res.response_metadata?.next_cursor || undefined
      pages += 1
    } while (cursor && pages < MAX_THREAD_PAGES)
    return out
  }

  /** auth.test once per token; a failure only means "no permalinks". */
  private async teamUrl(token: string): Promise<string | null> {
    if (this.teamUrlCache.has(token)) return this.teamUrlCache.get(token) ?? null
    try {
      const res = await callApi<AuthTestResponse>('auth.test', token, {})
      const url = res.url ?? null
      this.teamUrlCache.set(token, url)
      return url
    } catch {
      this.teamUrlCache.set(token, null)
      return null
    }
  }

  /** Post a reply as the token owner (needs the chat:write scope). */
  async postMessage(input: {
    token: string
    channelId: string
    text: string
  }): Promise<{ ts: string; channelId: string }> {
    if (this.baseUrl.startsWith('http://_FAKE')) {
      return { ts: `${Date.now()}.000000`, channelId: input.channelId }
    }
    const res = await callApi<PostMessageResponse>('chat.postMessage', input.token, {
      channel: input.channelId,
      text: input.text
    })
    if (!res.ts) throw new Error('slack chat.postMessage: missing ts')
    return { ts: res.ts, channelId: res.channel ?? input.channelId }
  }

  async authTest(token: string): Promise<{
    valid: boolean
    teamId?: string
    teamName?: string
    userName?: string
    userId?: string
    scopes?: string[]
    error?: string
  }> {
    if (this.baseUrl.startsWith('http://_FAKE')) {
      return { valid: true, teamId: 'FAKE_TEAM', teamName: 'Fake Team' }
    }
    const { body: res, scopes } = await callApiDetailed<AuthTestResponse>('auth.test', token, {})
    return {
      valid: true,
      teamId: res.team_id,
      teamName: res.team,
      userName: res.user,
      userId: res.user_id,
      scopes: scopes ?? res.scopes,
      error: undefined
    }
  }

  /** real/display name map for a workspace — used to label prompts. */
  async usersList(token: string): Promise<Map<string, string>> {
    if (this.baseUrl.startsWith('http://_FAKE')) return new Map()
    const map = new Map<string, string>()
    try {
      const res = await callApi<UsersListResponse>('users.list', token, { limit: '200' })
      for (const m of res.members ?? []) {
        const name =
          m.profile?.display_name || m.profile?.real_name || m.real_name || m.name || m.id
        if (m.id) map.set(m.id, name)
      }
    } catch {
      // name mapping is best-effort; raw IDs still work downstream
    }
    return map
  }
}
