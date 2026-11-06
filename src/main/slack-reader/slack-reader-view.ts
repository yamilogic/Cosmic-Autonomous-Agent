import { WebContentsView } from 'electron'
import {
  partitionForProfile,
  partitionForCard,
  applyChromeSessionTweaks,
  applySlackWebContentsTweaks
} from '../profiles/session-partition'
import { log } from '../logging'
import { SlackAdapter, type SlackSessionState, type ScrapedChannelItem } from './slack-adapter'
import { SLACK_SELECTORS } from './slack-selectors'
import { deduplicateMessages, normalizeScrapedMessage } from './normalizer'
import type { DashboardStoredMessage } from '../dashboard/delta-store'

export interface ScrapeStepEvent {
  type:
    | 'navigate'
    | 'scroll'
    | 'highlight'
    | 'status'
    | 'run_started'
    | 'run_finished'
    | 'run_failed'
    | 'run_cancelled'
    | 'paused'
    | 'waiting_for_user'
    | 'challenge'
    | 'read'
    | 'queued'
  runId?: string
  projectId?: string
  sourceId?: string
  workspaceName?: string
  channelName?: string
  scrollIndex?: number
  maxScroll?: number
  messageCount?: number
  queueLength?: number
  bounds?: { x: number; y: number; width: number; height: number }
  text?: string
  snippet?: string
  sender?: string
  timestamp?: string
}

export interface SlackReaderOptions {
  profileId: string
  workspaceId: string
  projectId?: string
  existingView?: WebContentsView | null
  onEvent?: (event: ScrapeStepEvent) => void
}

export interface ReadChannelWindowOptions {
  /** Epoch-seconds floor; 0 = only what is currently visible. */
  sinceTs?: number
  /** Hard cap on scroll-back steps before reporting a gap. */
  maxScrolls?: number
  /** Hard cap on collected messages per channel. */
  maxMessages?: number
  signal?: AbortSignal
}

export interface ReadChannelWindowResult {
  messages: DashboardStoredMessage[]
  /** Oldest Slack ts reached (epoch seconds), or null when nothing was read. */
  oldestTs: number | null
  /** Seconds of requested history the DOM/scroll cap could not reach. */
  gapSeconds: number
  scrolls: number
  cancelled: boolean
}

export class SlackReaderView {
  private view: WebContentsView | null = null
  private isBorrowedView = false
  private readonly adapter = new SlackAdapter()
  private readonly profileId: string
  private workspaceId: string
  private readonly projectId?: string
  private readonly onEvent?: (event: ScrapeStepEvent) => void

  constructor(options: SlackReaderOptions) {
    this.profileId = options.profileId
    this.workspaceId = options.workspaceId
    this.projectId = options.projectId
    this.onEvent = options.onEvent
    if (options.existingView && !options.existingView.webContents.isDestroyed()) {
      this.view = options.existingView
      this.isBorrowedView = true
      try {
        this.view.webContents.setBackgroundThrottling?.(false)
      } catch {
        // ignore
      }
    }
  }

  /**
   * Initializes the view. If an active session view is provided, reuses it.
   * Otherwise initializes the background view using the card or profile's dedicated session partition.
   */
  async initialize(): Promise<void> {
    if (this.view && !this.view.webContents.isDestroyed()) {
      try {
        this.view.webContents.setBackgroundThrottling?.(false)
      } catch {
        // ignore
      }
      return
    }

    const partition = this.projectId
      ? partitionForCard(this.projectId, 'slack')
      : partitionForProfile(this.profileId, 'slack')

    applyChromeSessionTweaks(partition)

    this.view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    applySlackWebContentsTweaks(this.view.webContents)
    try {
      this.view.webContents.setBackgroundThrottling?.(false)
    } catch {
      // ignore
    }

    // Strict URL allowlist: reader view only loads Slack domain URLs
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.view.webContents.on('will-navigate', (event, url) => {
      try {
        const parsed = new URL(url)
        if (!parsed.hostname.endsWith('slack.com')) {
          event.preventDefault()
          log.warn('slack reader blocked external navigation', { url })
        }
      } catch {
        event.preventDefault()
      }
    })

    // Position view offscreen so it runs 100% passively in the background
    this.view.setBounds({ x: -10000, y: -10000, width: 1280, height: 800 })
  }

  async checkState(): Promise<SlackSessionState> {
    if (!this.view) await this.initialize()
    return this.adapter.detectState(this.view!)
  }

  async waitForContent(timeoutMs = 12000): Promise<boolean> {
    if (!this.view || this.view.webContents.isDestroyed()) return false
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (this.view.webContents.isDestroyed()) return false
      try {
        const state = await this.adapter.detectState(this.view)
        if (state === 'logged_in') {
          const isDomReady = await this.view.webContents.executeJavaScript(
            `
            Boolean(
              document.querySelector('${SLACK_SELECTORS.messageRow}') ||
              document.querySelector('${SLACK_SELECTORS.channelItem}') ||
              document.querySelector('${SLACK_SELECTORS.channelListContainer}') ||
              document.querySelector('${SLACK_SELECTORS.loggedInIndicator}')
            )
          `,
            true
          )
          if (isDomReady) return true
        } else if (state === 'needs_login' || state === 'challenge') {
          return false
        }
      } catch {
        // ignore navigation transition errors
      }
      await new Promise((resolve) => setTimeout(resolve, 350))
    }
    return false
  }

  /**
   * Waits specifically for a channel's message list to mount rows.
   * If the channel has messages, returns as soon as rows appear.
   * If the channel is genuinely empty, returns true once the composer is mounted and settled.
   */
  async waitForMessages(timeoutMs = 30000, expectedChannelId?: string): Promise<boolean> {
    if (!this.view || this.view.webContents.isDestroyed()) return false
    const start = Date.now()
    let composerSeenAt = 0
    let genesisSeenAt = 0

    while (Date.now() - start < timeoutMs) {
      if (this.view.webContents.isDestroyed()) return false
      try {
        const state = await this.adapter.detectState(this.view)
        if (state === 'needs_login' || state === 'challenge') return false

        if (state === 'logged_in' || Array.isArray(state) || (typeof state === 'object' && state !== null)) {
          const dom = await this.view.webContents
            .executeJavaScript(
              `
            (() => {
              const rows = document.querySelectorAll('${SLACK_SELECTORS.messageRow}');
              const composer = document.querySelector('${SLACK_SELECTORS.composerEditor}');
              const isPaging = Boolean(document.querySelector('.c-message_list__loading_spinner, [data-qa="loading_spinner"]'));
              const hasGenesis = Boolean(
                document.querySelector('[data-qa="channel_created_summary"]') ||
                Array.from(document.querySelectorAll('.c-virtual_list__item')).some(el =>
                  /created this channel on|This is the start of|This is the very beginning|This conversation is just between/i.test(el.textContent || el.innerText || '')
                )
              );
              const expectedId = ${JSON.stringify(expectedChannelId || '')};
              const url = window.location.href;
              const isTargetUrl = !expectedId || url.includes('/' + expectedId);
              let matchingRows = 0;
              if (expectedId && rows.length > 0) {
                let hasOtherChannelRows = false;
                let channelMatches = 0;
                rows.forEach(r => {
                  const link = r.querySelector('a.c-timestamp, [data-qa="timestamp"] a, .c-timestamp__link, a[href*="/archives/"]');
                  if (link && link.getAttribute('href')) {
                    const href = link.getAttribute('href') || '';
                    if (href.includes('/archives/' + expectedId + '/') || href.includes('/' + expectedId)) {
                      channelMatches++;
                    } else if (href.includes('/archives/') || href.includes('/client/')) {
                      hasOtherChannelRows = true;
                    }
                  }
                });
                if (hasOtherChannelRows && channelMatches === 0) {
                  // The DOM still contains messages from the previous channel during SPA transition
                  matchingRows = 0;
                } else if (channelMatches > 0) {
                  matchingRows = channelMatches;
                } else if (isTargetUrl) {
                  matchingRows = rows.length;
                }
              } else {
                matchingRows = rows.length;
              }
              return { isTargetUrl, hasRows: matchingRows > 0, rowCount: matchingRows, hasComposer: Boolean(composer), isPaging, hasGenesis };
            })()
          `,
              true
            )
            .catch(() => null)

          if (dom && typeof dom === 'object') {
            const hasRows = Boolean((dom as any).hasRows || (Array.isArray(dom) && (dom as any[]).length > 0))
            if (hasRows) {
              await new Promise((resolve) => setTimeout(resolve, 800))
              return true
            }

            const isTargetUrl = (dom as any).isTargetUrl ?? true
            const hasComposer = Boolean((dom as any).hasComposer)
            const isPaging = Boolean((dom as any).isPaging)
            const hasGenesis = Boolean((dom as any).hasGenesis)

            if (isTargetUrl && hasComposer && !isPaging) {
              if (hasGenesis) {
                if (!genesisSeenAt) {
                  genesisSeenAt = Date.now()
                } else if (Date.now() - genesisSeenAt >= 12000) {
                  // Channel is confirmed empty: genesis summary and composer observed for at least 12s
                  return true
                }
              } else {
                genesisSeenAt = 0
                // Composer seen without genesis summary: allow up to 15s before fallback
                if (!composerSeenAt) {
                  composerSeenAt = Date.now()
                } else if (Date.now() - composerSeenAt >= 15000) {
                  return true
                }
              }
            } else {
              composerSeenAt = 0
              genesisSeenAt = 0
            }
          }
        }
      } catch {
        // ignore navigation transition errors
      }
      await new Promise((resolve) => setTimeout(resolve, 350))
    }
    return false
  }

  async listChannels(): Promise<ScrapedChannelItem[]> {
    if (!this.view) await this.initialize()
    const currentUrl = this.view!.webContents.getURL()
    if (!currentUrl.includes('slack.com')) {
      const targetUrl = `https://app.slack.com/client/${this.workspaceId}`
      try {
        await this.view!.webContents.loadURL(targetUrl)
      } catch (err: any) {
        if (!err.message?.includes('ERR_ABORTED')) throw err
      }
      await this.waitForContent(12000)
    }
    const state = await this.checkState()
    if (state !== 'logged_in') return []
    return this.adapter.listChannels(this.view!)
  }

  /**
   * Reads visible messages from a specific channel by passive deep-link navigation.
   * Performs ZERO clicking, typing, or API token extraction.
   */
  async readChannelMessages(channelId: string): Promise<DashboardStoredMessage[]> {
    if (!this.view) await this.initialize()

    let currentUrl = this.view!.webContents.getURL()

    // If workspaceId is pending or differs from authentic Slack client URL, resolve it from currentUrl
    const initialTeamMatch = currentUrl.match(/\/client\/([A-Z0-9]+)/)
    if (initialTeamMatch && (this.workspaceId.startsWith('pending-') || !this.workspaceId)) {
      this.workspaceId = initialTeamMatch[1]
    }

    const channelUrl = this.workspaceId.startsWith('pending-')
      ? `https://app.slack.com/client`
      : `https://app.slack.com/client/${this.workspaceId}/${channelId}`

    // If the view is unnavigated (e.g. fresh background view at about:blank), navigate immediately to the channel
    if (!currentUrl.includes('slack.com')) {
      try {
        await this.view!.webContents.loadURL(channelUrl)
      } catch (err: any) {
        if (!err.message?.includes('ERR_ABORTED')) throw err
      }
      await this.waitForMessages(25000, channelId)
    }

    const state = await this.checkState()
    if (state !== 'logged_in') {
      log.info('slack reader cannot read channel: session not logged in', { state })
      return []
    }

    currentUrl = this.view!.webContents.getURL()

    // If workspaceId is pending or differs from authentic Slack client URL, resolve it from currentUrl
    const urlTeamMatch = currentUrl.match(/\/client\/([A-Z0-9]+)/)
    if (
      urlTeamMatch &&
      (this.workspaceId.startsWith('pending-') ||
        !this.workspaceId ||
        this.workspaceId !== urlTeamMatch[1])
    ) {
      this.workspaceId = urlTeamMatch[1]
    }

    this.onEvent?.({
      type: 'navigate',
      channelName: channelId,
      text: `Navigating to channel ${channelId}…`
    })

    // If channelId is a standard Slack ID (C... for public, G... for private, D... for DM), direct URL navigation works best.
    const isStandardSlackId = /^[CGD][A-Z0-9]{8,12}$/.test(channelId)

    const matchesTargetUrl = (url: string) =>
      url.includes(`/${this.workspaceId}/${channelId}`) || url.includes(`/${channelId}`)

    if (isStandardSlackId) {
      // Always (re-)click the sidebar link to trigger a fresh Slack SPA navigation that resets scroll position.
      // This avoids the alternating-empty bug where Slack restores a stale virtual-list anchor when the channel
      // was already the current view, causing scrollToBottom to fail to mount the newest messages.
      let switchedViaSidebar = false
      if (currentUrl.includes('slack.com')) {
        try {
          switchedViaSidebar = Boolean(
            await this.view!.webContents.executeJavaScript(
              `
              (() => {
                const el = document.querySelector('[data-qa-channel-sidebar-channel-id="${channelId}"], a[href*="/${channelId}"]');
                if (el) {
                  const clickTarget = el.querySelector('a') || el.querySelector('button') || el;
                  clickTarget.click();
                  return true;
                }
                return false;
              })()
            `,
              true
            )
          )
          if (switchedViaSidebar) {
            // Verify URL actually switched within 2 seconds
            const startCheck = Date.now()
            while (Date.now() - startCheck < 2000) {
              const url = this.view!.webContents.getURL()
              if (matchesTargetUrl(url)) break
              await new Promise((r) => setTimeout(r, 150))
            }
            if (!matchesTargetUrl(this.view!.webContents.getURL())) {
              switchedViaSidebar = false
            }
          }
        } catch {
          switchedViaSidebar = false
        }
      }

      if (!switchedViaSidebar) {
        try {
          await this.view!.webContents.loadURL(
            `https://app.slack.com/client/${this.workspaceId}/${channelId}`
          )
        } catch (err: any) {
          // Chromium throws ERR_ABORTED (-3) if Slack's SPA client redirect intervenes.
          // If the URL actually navigated or contains the channel, this is non-fatal.
          const finalUrl = this.view!.webContents.getURL()
          if (!finalUrl.includes(channelId) && !err.message?.includes('ERR_ABORTED')) {
            throw err
          }
        }
      }
    } else if (!isStandardSlackId) {
      // If channelId was a slugified name, try to locate and click the corresponding sidebar channel item
      try {
        await this.view!.webContents.executeJavaScript(
          `
          (() => {
            const target = ${JSON.stringify(channelId.toLowerCase())};
            const items = document.querySelectorAll('${SLACK_SELECTORS.channelItem}');
            for (const item of items) {
              const nameEl = item.querySelector('${SLACK_SELECTORS.channelName}');
              const text = (nameEl ? nameEl.textContent : item.textContent || '').trim().toLowerCase();
              const slug = text.replace(/[^a-z0-9-_]/g, '');
              if (slug === target || text === target) {
                const clickTarget = item.querySelector('a') || item.querySelector('button') || item;
                clickTarget.click();
                return true;
              }
            }
            return false;
          })()
        `,
          true
        )
        await new Promise((resolve) => setTimeout(resolve, 2000))
      } catch {
        // ignore
      }
    }

    // Unconditionally wait for messages to mount in the target channel
    await this.waitForMessages(25000, channelId)

    currentUrl = this.view!.webContents.getURL()

    // Safety check: ensure we didn't land on a completely different conversation (e.g. redirected fallback DM)
    const isTargetConversation = isStandardSlackId ? matchesTargetUrl(currentUrl) : true

    this.onEvent?.({
      type: 'status',
      channelName: channelId,
      text: `Reading visible messages in ${channelId}…`
    })

    // Inspect active message container bounds for highlight overlay
    try {
      const bounds = await this.view!.webContents.executeJavaScript(
        `
        (() => {
          const el = document.querySelector('.c-virtual_list__item') || document.querySelector('[data-qa="message_container"]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })()
      `,
        true
      )
      if (bounds) {
        this.onEvent?.({
          type: 'highlight',
          bounds,
          channelName: channelId
        })
      }
    } catch {
      // ignore
    }

    // Scroll to bottom to mount newest messages in Slack's virtual list container.
    // Retry up to 4 times with progressive delays: Chromium throttles off-screen rendering in background
    // tabs, so the virtual list may need multiple settle cycles to mount the bottom rows.
    let rawMessages: Awaited<ReturnType<typeof this.adapter.readVisibleMessages>> = []
    if (isTargetConversation && this.view) {
      const scrollDelays = [800, 1200, 1600, 2000]
      for (const delay of scrollDelays) {
        await this.adapter.scrollToBottom(this.view)
        await new Promise((resolve) => setTimeout(resolve, delay))
        rawMessages = await this.adapter.readVisibleMessages(this.view!)
        if (rawMessages.length > 0) break
      }
    }
    const normalized: DashboardStoredMessage[] = []

    for (const raw of rawMessages) {
      // If message permalink indicates a different channel archive and standard Slack ID was expected, filter it out
      if (
        isStandardSlackId &&
        raw.permalink &&
        !raw.permalink.includes(`/archives/${channelId}/`)
      ) {
        continue
      }
      const msg = normalizeScrapedMessage(raw, channelId)
      if (msg) normalized.push(msg)
    }

    this.onEvent?.({
      type: 'status',
      channelName: channelId,
      messageCount: normalized.length,
      text: `Read ${normalized.length} messages in ${channelId}`
    })

    return deduplicateMessages(this.workspaceId, channelId, normalized)
  }

  /**
   * Reads a channel with bounded scroll-back to reach `sinceTs`.
   * The first read reuses `readChannelMessages` (navigation + bounds + event
   * emission); further reads only scroll the already-open conversation.
   */
  async readChannelWindow(
    channelId: string,
    options: ReadChannelWindowOptions = {}
  ): Promise<ReadChannelWindowResult> {
    const sinceTs =
      Number.isFinite(options.sinceTs) && (options.sinceTs ?? 0) > 0 ? options.sinceTs! : 0
    const maxScrolls = Math.max(0, options.maxScrolls ?? 40)
    const maxMessages = Math.max(1, options.maxMessages ?? 3000)
    const signal = options.signal

    const first = await this.readChannelMessages(channelId)
    const collected = new Map<string, DashboardStoredMessage>()
    for (const message of first) collected.set(message.ts, message)

    if (!this.view) {
      const all = deduplicateMessages(this.workspaceId, channelId, [...collected.values()])
      const messages = sinceTs > 0 ? all.filter((m) => Number(m.ts) >= sinceTs) : all
      const oldest = oldestNumericTs(new Map(all.map((m) => [m.ts, m])))
      return { messages, oldestTs: oldest, gapSeconds: 0, scrolls: 0, cancelled: false }
    }

    const isStandardSlackId = /^[CGD][A-Z0-9]{8,12}$/.test(channelId)
    let scrolls = 0
    let cancelled = signal?.aborted === true
    let canScroll = true
    let zeroProgressRetries = 0

    while (!cancelled && canScroll && scrolls < maxScrolls && collected.size < maxMessages) {
      const oldest = oldestNumericTs(collected)
      // Visible history already reaches the requested floor.
      if (sinceTs > 0 && oldest !== null && oldest <= sinceTs) break

      const atGenesis = await this.adapter.isAtChannelGenesis(this.view!)
      if (atGenesis && oldest !== null) break

      // If channel is genuinely empty (no messages collected after bottom settling retries), break out
      if (collected.size === 0 && ((atGenesis && scrolls >= 6) || scrolls >= 10)) {
        break
      }

      this.onEvent?.({
        type: 'scroll',
        channelName: channelId,
        scrollIndex: scrolls + 1,
        maxScroll: maxScrolls,
        messageCount: collected.size,
        text: `Scrolling history in ${channelId} (${collected.size} messages)…`
      })

      const prevOldest = oldest

      if (collected.size === 0) {
        // Channel has not mounted messages yet; ensure we are at bottom and allow virtual list to settle
        await this.adapter.scrollToBottom(this.view!).catch(() => false)
        canScroll = true
      } else {
        // We have bottom messages; scroll up to backfill history towards sinceTs
        canScroll = await this.adapter.scrollUp(this.view!, 800)
        if (!canScroll) {
          break
        }
      }

      // Adaptive settling: if Slack is actively paging older messages, give it dynamic backpressure
      let settleMs = 1100
      const isPaging = await this.adapter.isPagingMessages(this.view!).catch(() => false)
      if (isPaging) {
        settleMs = 1800
      } else if (collected.size === 0) {
        settleMs = 1200
      } else if (zeroProgressRetries > 0) {
        settleMs = Math.min(2200, 1100 + zeroProgressRetries * 250)
      }

      await new Promise((resolve) => setTimeout(resolve, settleMs))
      if (signal?.aborted) {
        cancelled = true
        break
      }

      const raw = await this.adapter.readVisibleMessages(this.view!)
      for (const item of raw) {
        if (
          isStandardSlackId &&
          item.permalink &&
          !item.permalink.includes(`/archives/${channelId}/`)
        ) {
          continue
        }
        const msg = normalizeScrapedMessage(item, channelId)
        if (!msg) continue
        collected.set(msg.ts, msg)
        if (collected.size >= maxMessages) break
      }

      if (collected.size === 0) {
        zeroProgressRetries++
        const reachedGenesis = await this.adapter.isAtChannelGenesis(this.view!).catch(() => false)
        if ((reachedGenesis && scrolls >= 4) || zeroProgressRetries >= 10 || scrolls >= 10) {
          break
        }
      } else {
        const newOldest = oldestNumericTs(collected)
        if (prevOldest !== null && newOldest === prevOldest) {
          zeroProgressRetries++
          // Check if we reached true genesis banner before declaring top
          const reachedGenesis = await this.adapter
            .isAtChannelGenesis(this.view!)
            .catch(() => false)
          if (reachedGenesis || zeroProgressRetries >= 8) {
            // If 8 consecutive scroll attempts yield no earlier messages or genesis reached, top reached
            break
          }
        } else {
          zeroProgressRetries = 0
        }
      }
      scrolls++
    }

    // Expand and harvest thread replies for every message that has replies
    if (this.view && !cancelled && !signal?.aborted) {
      const threadParents = [...collected.values()].filter(
        (m) => (m.replyCount ?? 0) > 0 && !m.threadTs
      )

      if (threadParents.length > 0) {
        this.onEvent?.({
          type: 'status',
          channelName: channelId,
          text: `Found ${threadParents.length} thread(s) in ${channelId}. Expanding replies…`
        })

        for (let i = 0; i < threadParents.length; i++) {
          if (signal?.aborted) {
            cancelled = true
            break
          }
          const parent = threadParents[i]
          this.onEvent?.({
            type: 'status',
            channelName: channelId,
            text: `Reading thread ${i + 1} of ${threadParents.length} (${parent.replyCount ?? 1} replies)…`
          })

          try {
            const rawReplies = await this.adapter.expandAndReadThread(this.view, parent.ts)
            for (const raw of rawReplies) {
              const replyMsg = normalizeScrapedMessage(raw, channelId)
              if (replyMsg) {
                replyMsg.threadTs = parent.ts
                collected.set(replyMsg.ts, replyMsg)
              }
            }
          } catch {
            // thread read failure must not abort channel scrape
          }

          // Adaptive thread pacing (650ms)
          await new Promise((r) => setTimeout(r, 650))
        }
      }
    }

    const all = deduplicateMessages(this.workspaceId, channelId, [...collected.values()])
    const messages = sinceTs > 0 ? all.filter((m) => Number(m.ts) >= sinceTs) : all
    const oldest = oldestNumericTs(new Map(all.map((m) => [m.ts, m])))
    const gapSeconds =
      sinceTs > 0 && oldest !== null && oldest > sinceTs
        ? Math.max(0, Math.floor(oldest - sinceTs))
        : 0

    this.onEvent?.({
      type: 'read',
      channelName: channelId,
      messageCount: messages.length,
      scrollIndex: scrolls,
      maxScroll: maxScrolls,
      text: `Read ${messages.length} messages in ${channelId}${
        gapSeconds > 0 ? ` (gap ${gapSeconds}s)` : ''
      }`
    })

    return { messages, oldestTs: oldest, gapSeconds, scrolls, cancelled }
  }

  /**
   * Navigates to the channel and posts a message via DOM input fallback.
   */
  async postChannelMessage(channelId: string, text: string): Promise<boolean> {
    if (!this.view) await this.initialize()
    const state = await this.checkState()
    if (state !== 'logged_in') return false

    const channelUrl = `https://app.slack.com/client/${this.workspaceId}/${channelId}`
    const currentUrl = this.view!.webContents.getURL()
    const matchesTargetUrl =
      currentUrl.includes(`/${this.workspaceId}/${channelId}`) ||
      currentUrl.includes(`/${channelId}`)

    if (!matchesTargetUrl) {
      await this.view!.webContents.loadURL(channelUrl)
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }

    return this.adapter.postMessageViaDom(this.view!, text)
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.setBounds(bounds)
    }
  }

  getView(): WebContentsView | null {
    return this.view
  }

  destroy(): void {
    if (!this.isBorrowedView && this.view && !this.view.webContents.isDestroyed()) {
      this.view.webContents.close()
    }
    this.view = null
  }
}

function oldestNumericTs(messages: Map<string, DashboardStoredMessage>): number | null {
  let oldest: number | null = null
  for (const ts of messages.keys()) {
    const n = Number(ts)
    if (!Number.isFinite(n)) continue
    if (oldest === null || n < oldest) oldest = n
  }
  return oldest
}
