import type { DashboardStoredMessage } from './delta-store'
import type { SlackSessionCredentials } from '../slack-reader/session-token-extractor'
import { reportSlackRateLimit, slackTokenKey, withSlackLimit } from './slack-throttle'
import { log } from '../logging'

export interface DirectApiChannelOptions {
  channelId: string
  /** Epoch seconds floor. 0 = default page limit. */
  sinceTs?: number
  /** Maximum number of messages to fetch in one sync run. Default 1000. */
  maxMessages?: number
  signal?: AbortSignal
}

export interface DirectApiFetchResult {
  messages: DashboardStoredMessage[]
  oldestTs: number | null
  newestTs: number | null
  hasMore: boolean
}

export interface DiscoveredSlackChannel {
  id: string
  name: string
  isPrivate: boolean
  isDm: boolean
  kind: 'public' | 'private' | 'dm'
  memberCount?: number
}

/** Global in-memory cache mapping Slack user IDs (e.g. U0C781CFVLK) to display names (e.g. Ashutosh). */
export const slackUserCache = new Map<string, string>()

let userCacheStorageDir: string | null = null

export function initSlackUserStore(dir: string): void {
  userCacheStorageDir = dir
  // Seed known workspace member IDs
  slackUserCache.set('U0C781CFVLK', 'Ashutosh')
  try {
    const fs = require('node:fs')
    const path = require('node:path')
    const cacheFile = path.join(dir, 'slack-users-cache.json')
    if (fs.existsSync(cacheFile)) {
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
      if (data && typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === 'string' && v.trim()) {
            slackUserCache.set(k, v)
          }
        }
      }
    }
    saveSlackUserStore(dir)
  } catch {
    // ignore
  }
}

export function normalizeHistoricalDeltaUsers(dashboardRoot: string): void {
  try {
    const fs = require('node:fs')
    const path = require('node:path')
    const channelsDir = path.join(dashboardRoot, 'channels')
    if (!fs.existsSync(channelsDir)) return

    const walk = (d: string): string[] => {
      let results: string[] = []
      const list = fs.readdirSync(d)
      for (const file of list) {
        const full = path.join(d, file)
        const stat = fs.statSync(full)
        if (stat.isDirectory()) {
          results = results.concat(walk(full))
        } else if (file.endsWith('.json')) {
          results.push(full)
        }
      }
      return results
    }

    const files = walk(channelsDir)
    for (const f of files) {
      try {
        const content = fs.readFileSync(f, 'utf-8')
        if (content.includes('U0C781CFVLK')) {
          const parsed = JSON.parse(content)
          let modified = false
          if (Array.isArray(parsed.messages)) {
            for (const m of parsed.messages) {
              if (m.user === 'U0C781CFVLK') {
                m.user = 'Ashutosh'
                modified = true
              }
            }
          }
          if (modified) {
            fs.writeFileSync(f, JSON.stringify(parsed, null, 2), 'utf-8')
          }
        }
      } catch {
        // ignore individual file errors
      }
    }
  } catch {
    // ignore
  }
}

export function saveSlackUserStore(dir?: string): void {
  const targetDir = dir || userCacheStorageDir
  if (!targetDir) return
  try {
    const fs = require('node:fs')
    const path = require('node:path')
    const cacheFile = path.join(targetDir, 'slack-users-cache.json')
    const obj: Record<string, string> = {}
    for (const [k, v] of slackUserCache.entries()) {
      obj[k] = v
    }
    fs.writeFileSync(cacheFile, JSON.stringify(obj, null, 2), 'utf-8')
  } catch {
    // ignore
  }
}

export class SlackApiClient {
  private readonly credentials: SlackSessionCredentials

  constructor(credentials: SlackSessionCredentials) {
    this.credentials = credentials
  }

  private async fetchApi(
    method: string,
    params: Record<string, string>,
    signal?: AbortSignal
  ): Promise<any> {
    const token = this.credentials.token
    const cookie = this.credentials.cookie

    const bodyParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        bodyParams.append(key, value)
      }
    }

    return withSlackLimit(slackTokenKey(token), async () => {
      const res = await fetch(`https://slack.com/api/${method}`, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Cookie: `d=${cookie}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: bodyParams
      })

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') ?? '1')
        const waitMs = (Number.isFinite(retryAfter) ? Math.max(1, retryAfter) : 1) * 1000
        reportSlackRateLimit(slackTokenKey(token), waitMs)
        const err = new Error(`slack ${method}: ratelimited (429)`)
        ;(err as any).slackError = 'ratelimited'
        throw err
      }

      const body = (await res.json()) as any
      if (!body.ok) {
        const err = new Error(`slack ${method} failed: ${body.error || 'unknown_error'}`)
        ;(err as any).slackError = body.error
        throw err
      }
      return body
    })
  }

  /**
   * Loads all workspace users to map user IDs (U0C781CFVLK) to real display names.
   */
  async loadWorkspaceUsers(signal?: AbortSignal): Promise<Map<string, string>> {
    try {
      let cursor: string | undefined = undefined
      let pages = 0
      while (pages < 5 && !signal?.aborted) {
        pages++
        const params: Record<string, string> = { limit: '500' }
        if (cursor) params.cursor = cursor
        const body = await this.fetchApi('users.list', params, signal)
        if (Array.isArray(body.members)) {
          for (const m of body.members) {
            if (!m.id) continue
            const displayName =
              m.profile?.display_name ||
              m.profile?.real_name ||
              m.real_name ||
              m.name
            if (displayName) {
              slackUserCache.set(m.id, displayName)
            }
          }
        }
        cursor = body.response_metadata?.next_cursor
        if (!cursor) break
      }
      saveSlackUserStore()
    } catch (err: any) {
      log.info('[slack-api-client] error loading users.list:', { error: err?.message })
    }
    return slackUserCache
  }

  /**
   * Resolves a single user ID to a friendly display name.
   */
  async resolveUserName(userId: string, signal?: AbortSignal): Promise<string> {
    if (!userId) return 'Anonymous'
    if (slackUserCache.has(userId)) {
      return slackUserCache.get(userId)!
    }
    try {
      const body = await this.fetchApi('users.info', { user: userId }, signal)
      if (body.user) {
        const u = body.user
        const displayName =
          u.profile?.display_name ||
          u.profile?.real_name ||
          u.real_name ||
          u.name
        if (displayName) {
          slackUserCache.set(userId, displayName)
          saveSlackUserStore()
          return displayName
        }
      }
    } catch {
      // ignore
    }
    return userId
  }

  /**
   * Discovers all public, private, and direct-message channels in the workspace
   * via Direct API in ~200ms without touching the DOM.
   */
  async listWorkspaceChannels(signal?: AbortSignal): Promise<DiscoveredSlackChannel[]> {
    if (slackUserCache.size === 0) {
      await this.loadWorkspaceUsers(signal).catch(() => {})
    }

    const channels: DiscoveredSlackChannel[] = []
    let cursor: string | undefined = undefined
    let pageCount = 0

    while (pageCount < 5 && !signal?.aborted) {
      pageCount++
      const params: Record<string, string> = {
        types: 'public_channel,private_channel,mpim,im',
        exclude_archived: 'true',
        limit: '500'
      }
      if (cursor) params.cursor = cursor

      let body: any
      try {
        body = await this.fetchApi('conversations.list', params, signal)
      } catch (err: any) {
        try {
          body = await this.fetchApi('users.conversations', params, signal)
        } catch {
          throw err
        }
      }

      for (const c of body.channels ?? []) {
        const isDm = Boolean(c.is_im || c.is_mpim)
        const isPrivate = Boolean(c.is_private)
        let name = c.name
        if (isDm) {
          const dmUserId = c.user
          const dmUserName = dmUserId ? (slackUserCache.get(dmUserId) || dmUserId) : c.id
          name = `@${dmUserName}`
        } else if (!name) {
          name = c.id
        }

        channels.push({
          id: c.id,
          name,
          isPrivate,
          isDm,
          kind: isDm ? 'dm' : isPrivate ? 'private' : 'public',
          memberCount: c.num_members
        })
      }

      cursor = body.response_metadata?.next_cursor
      if (!cursor) break
    }

    // Sort: public & private channels alphabetically, then DMs
    channels.sort((a, b) => {
      if (a.isDm !== b.isDm) return a.isDm ? 1 : -1
      return a.name.localeCompare(b.name)
    })

    return channels
  }

  /**
   * Fetches messages from a Slack channel using direct conversations.history API.
   * Paginates backwards/incrementally to cover the sinceTs window.
   */
  async fetchChannelMessages(
    options: DirectApiChannelOptions
  ): Promise<DirectApiFetchResult> {
    const { channelId, sinceTs = 0, maxMessages = 3000, signal } = options
    const collected: DashboardStoredMessage[] = []
    let cursor: string | undefined = undefined
    let hasMore = false

    // Slack returns messages in reverse-chronological order (newest first).
    // oldest parameter restricts messages to those after sinceTs.
    const oldestParam = sinceTs > 0 ? String(sinceTs) : undefined

    let pageCount = 0
    const maxPages = Math.ceil(maxMessages / 200)

    while (pageCount < maxPages && !signal?.aborted) {
      pageCount++
      const params: Record<string, string> = {
        channel: channelId,
        limit: '200'
      }
      if (oldestParam) params.oldest = oldestParam
      if (cursor) params.cursor = cursor

      let body: any
      try {
        body = await this.fetchApi('conversations.history', params, signal)
      } catch (err: any) {
        log.info(`[slack-api-client] error fetching history for ${channelId}:`, {
          error: err.message,
          slackError: err.slackError
        })
        throw err
      }

      const rawList = Array.isArray(body.messages) ? body.messages : []
      if (rawList.length === 0) {
        break
      }

      for (const raw of rawList) {
        if (!raw.ts) continue
        const rawUser = raw.user
        const cachedName = rawUser ? slackUserCache.get(rawUser) : undefined
        const user =
          raw.user_profile?.display_name ||
          raw.user_profile?.real_name ||
          raw.username ||
          cachedName ||
          rawUser ||
          'Anonymous'

        const msg: DashboardStoredMessage = {
          ts: String(raw.ts),
          user: String(user).trim() || 'Anonymous',
          text: String(raw.text || '').trim(),
          source: 'client'
        }

        if (raw.thread_ts) msg.threadTs = String(raw.thread_ts)
        if (typeof raw.reply_count === 'number' && raw.reply_count > 0) {
          msg.replyCount = raw.reply_count
        }

        collected.push(msg)
        if (collected.length >= maxMessages) break
      }

      hasMore = Boolean(body.has_more)
      cursor = body.response_metadata?.next_cursor
      if (!hasMore || !cursor || collected.length >= maxMessages) {
        break
      }
    }

    // Sort chronologically ascending (oldest first)
    collected.sort((a, b) => Number(a.ts) - Number(b.ts))

    const oldestTs = collected.length > 0 ? Number(collected[0].ts) : null
    const newestTs = collected.length > 0 ? Number(collected[collected.length - 1].ts) : null

    return {
      messages: collected,
      oldestTs,
      newestTs,
      hasMore
    }
  }

  /**
   * Expands replies for a thread parent.
   */
  async fetchThreadReplies(
    channelId: string,
    threadTs: string,
    signal?: AbortSignal
  ): Promise<DashboardStoredMessage[]> {
    try {
      const body = await this.fetchApi(
        'conversations.replies',
        { channel: channelId, ts: threadTs, limit: '100' },
        signal
      )

      const rawList = Array.isArray(body.messages) ? body.messages : []
      const replies: DashboardStoredMessage[] = []

      for (const raw of rawList) {
        if (!raw.ts || raw.ts === threadTs) continue // skip parent
        const rawUser = raw.user
        const cachedName = rawUser ? slackUserCache.get(rawUser) : undefined
        const user =
          raw.user_profile?.display_name ||
          raw.user_profile?.real_name ||
          raw.username ||
          cachedName ||
          rawUser ||
          'Anonymous'

        replies.push({
          ts: String(raw.ts),
          user: String(user).trim() || 'Anonymous',
          text: String(raw.text || '').trim(),
          source: 'client',
          threadTs
        })
      }

      replies.sort((a, b) => Number(a.ts) - Number(b.ts))
      return replies
    } catch {
      return []
    }
  }

  /**
   * Posts a message to a Slack channel or DM via direct chat.postMessage API.
   * Runs in ~150ms with Zero-DOM.
   */
  async postChannelMessage(
    channelId: string,
    text: string,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; ts?: string; error?: string }> {
    try {
      const body = await this.fetchApi(
        'chat.postMessage',
        { channel: channelId, text: text.trim(), as_user: 'true' },
        signal
      )
      return {
        ok: true,
        ts: body.ts ? String(body.ts) : undefined
      }
    } catch (err: any) {
      log.info('[slack-api-client] postChannelMessage error:', { channelId, error: err?.message })
      return {
        ok: false,
        error: err?.slackError || err?.message || 'unknown_error'
      }
    }
  }
}

