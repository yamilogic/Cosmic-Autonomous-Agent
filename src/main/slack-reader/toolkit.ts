import type { WebContentsView } from 'electron'
import { SLACK_SELECTORS } from './slack-selectors'
import { SlackAdapter, type SlackSessionState, type ScrapedChannelItem } from './slack-adapter'
import { deduplicateMessages, normalizeScrapedMessage } from './normalizer'
import type { DashboardStoredMessage } from '../dashboard/delta-store'

export interface SelfCheckResult {
  ok: boolean
  sidebar: 'PASS' | 'FAIL'
  messages: 'PASS' | 'FAIL'
  timestamps: 'PASS' | 'FAIL'
  senders: 'PASS' | 'FAIL'
  details: string
}

export interface LiveReaderEvent {
  type:
    | 'run_started'
    | 'preflight'
    | 'view_selected'
    | 'self_check'
    | 'navigate'
    | 'scroll'
    | 'read'
    | 'extract'
    | 'skip'
    | 'waiting_for_user'
    | 'paused'
    | 'resumed'
    | 'challenge'
    | 'adapter_broken'
    | 'error'
    | 'run_finished'
  channelId?: string
  channelName?: string
  messageCount?: number
  newMessageCount?: number
  snippet?: string
  sender?: string
  timestamp?: string
  scrollIndex?: number
  maxScroll?: number
  bounds?: { x: number; y: number; width: number; height: number }
  reason?: string
  mode?: 'visible' | 'hidden'
  text?: string
}

/**
 * Host-defined read-only toolkit for Slack Reader.
 * Absolutely NO typing, clicking, sending, reacting, or credential extraction.
 */
export class SlackReaderToolkit {
  private readonly adapter = new SlackAdapter()

  async getSessionState(view: WebContentsView): Promise<SlackSessionState> {
    return this.adapter.detectState(view)
  }

  async listChannels(view: WebContentsView): Promise<ScrapedChannelItem[]> {
    return this.adapter.listChannels(view)
  }

  async openChannel(view: WebContentsView, workspaceId: string, channelId: string): Promise<void> {
    const channelUrl = `https://app.slack.com/client/${workspaceId}/${channelId}`
    const currentUrl = view.webContents.getURL()
    if (!currentUrl.includes(`/${workspaceId}/${channelId}`)) {
      await view.webContents.loadURL(channelUrl)
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }

  async readVisibleMessages(
    view: WebContentsView,
    workspaceId: string,
    channelId: string
  ): Promise<DashboardStoredMessage[]> {
    const raw = await this.adapter.readVisibleMessages(view)
    const normalized: DashboardStoredMessage[] = []
    for (const item of raw) {
      const msg = normalizeScrapedMessage(item, channelId)
      if (msg) normalized.push(msg)
    }
    return deduplicateMessages(workspaceId, channelId, normalized)
  }

  async scrollHistory(view: WebContentsView): Promise<void> {
    try {
      await view.webContents.executeJavaScript(`
        (() => {
          const list = document.querySelector('.c-virtual_list__scroll_container') ||
                       document.querySelector('[data-qa="slack_kit_list"]');
          if (list) {
            list.scrollTop = Math.max(0, list.scrollTop - 600);
          }
        })()
      `, true)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch {
      // scroll ignored
    }
  }

  async selfCheck(view: WebContentsView): Promise<SelfCheckResult> {
    try {
      const res = await view.webContents.executeJavaScript(`
        (() => {
          const sidebar = Boolean(document.querySelector('${SLACK_SELECTORS.channelListContainer}') || document.querySelector('${SLACK_SELECTORS.channelItem}'));
          const messages = Boolean(document.querySelector('${SLACK_SELECTORS.messageListContainer}') || document.querySelector('${SLACK_SELECTORS.messageRow}'));
          const timestamps = Boolean(document.querySelector('${SLACK_SELECTORS.messageTimestamp}'));
          const senders = Boolean(document.querySelector('${SLACK_SELECTORS.messageSender}'));
          return {
            sidebar: sidebar ? 'PASS' : 'FAIL',
            messages: messages ? 'PASS' : 'FAIL',
            timestamps: timestamps ? 'PASS' : 'FAIL',
            senders: senders ? 'PASS' : 'FAIL'
          };
        })()
      `, true)

      const ok = res.sidebar === 'PASS' && (res.messages === 'PASS' || res.sidebar === 'PASS')
      return {
        ok,
        sidebar: res.sidebar,
        messages: res.messages,
        timestamps: res.timestamps,
        senders: res.senders,
        details: ok ? 'Selectors verified' : 'One or more selectors failed'
      }
    } catch (err: any) {
      return {
        ok: false,
        sidebar: 'FAIL',
        messages: 'FAIL',
        timestamps: 'FAIL',
        senders: 'FAIL',
        details: err?.message || 'Execution error during selfCheck'
      }
    }
  }

  /**
   * Monitor user activity natively on webContents without script injection.
   * Resolves when user has been idle for `idleSeconds`.
   */
  async waitForIdle(
    view: WebContentsView,
    idleSeconds = 30,
    onStateChange?: (state: 'waiting_for_user' | 'idle') => void
  ): Promise<void> {
    return new Promise((resolve) => {
      let lastActivity = Date.now()
      let checkTimer: NodeJS.Timeout | null = null
      let wasActive = false

      const onActivity = () => {
        lastActivity = Date.now()
        if (!wasActive) {
          wasActive = true
          onStateChange?.('waiting_for_user')
        }
      }

      view.webContents.on('before-input-event', onActivity)
      view.webContents.on('cursor-changed', onActivity)

      checkTimer = setInterval(() => {
        if (Date.now() - lastActivity >= idleSeconds * 1000) {
          if (checkTimer) clearInterval(checkTimer)
          view.webContents.removeListener('before-input-event', onActivity)
          view.webContents.removeListener('cursor-changed', onActivity)
          if (wasActive) onStateChange?.('idle')
          resolve()
        }
      }, 500)
    })
  }
}
