import { log } from '../logging'
import type { DashboardChatService } from '../dashboard/chat-service'
import type { DashboardSyncEngine } from '../dashboard/sync-engine'
import type { HistoryStore } from '../dashboard/history-store'
import type { DashboardDeltaStore } from '../dashboard/delta-store'
import type { ProfileStore } from '../profiles/profile-store'
import type { DashboardChatMessage } from '../../shared/dashboard-contract'

export interface AgentSlackReadResult {
  ok: boolean
  channelId?: string
  channelName?: string
  messages: Array<{
    ts: string
    user: string
    text: string
    isMine?: boolean
  }>
  error?: string
}

export interface AgentSlackWriteResult {
  ok: boolean
  ts?: string
  error?: string
}

export interface AgentSlackSchedulePayload {
  projectId: string
  intervalMinutes: number
  enabled: boolean
}

export class AgentSlackTool {
  private scheduledTimers: Map<string, NodeJS.Timeout> = new Map()

  constructor(
    private readonly deps: {
      chatService: DashboardChatService
      syncEngine: DashboardSyncEngine
      historyStore: HistoryStore
      deltaStore: DashboardDeltaStore
      profileStore: ProfileStore
    }
  ) {}

  /**
   * Reads messages from a project's connected channel (public, private, or DM).
   */
  async readChannelMessages(
    projectId: string,
    channelId: string,
    limit = 50
  ): Promise<AgentSlackReadResult> {
    try {
      const page = await this.deps.chatService.loadMessages({
        projectId,
        channelId,
        source: 'client',
        limit
      })

      return {
        ok: true,
        channelId,
        channelName: page.messages[0]?.channelName,
        messages: page.messages.map((m: DashboardChatMessage) => ({
          ts: m.ts,
          user: m.userName || m.userId,
          text: m.text,
          isMine: m.isMine
        }))
      }
    } catch (err) {
      log.error('AgentSlackTool.readChannelMessages failed', { projectId, channelId, err })
      return {
        ok: false,
        messages: [],
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  /**
   * Posts a message to a channel or replies to a thread using the project's authenticated session.
   */
  async writeChannelMessage(
    projectId: string,
    channelId: string,
    text: string,
    source: 'client' | 'ours' = 'client'
  ): Promise<AgentSlackWriteResult> {
    try {
      const result = await this.deps.chatService.sendMessage({
        projectId,
        channelId,
        text,
        source,
        isAgent: true
      })

      if (!result.ok) {
        return {
          ok: false,
          error: result.error || 'Failed to post message'
        }
      }

      return {
        ok: true,
        ts: result.message?.ts
      }
    } catch (err) {
      log.error('AgentSlackTool.writeChannelMessage failed', { projectId, channelId, err })
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  /**
   * Triggers an immediate scrape and sync for the project, returning fresh messages.
   */
  async triggerScrapeNow(projectId: string): Promise<{ ok: boolean; newMessagesCount?: number; error?: string }> {
    try {
      const snapshot = await this.deps.syncEngine.syncProject(projectId)
      return {
        ok: true,
        newMessagesCount: snapshot?.newMessageCount ?? 0
      }
    } catch (err) {
      log.error('AgentSlackTool.triggerScrapeNow failed', { projectId, err })
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  /**
   * Sets up or updates recurring automated scraping / monitoring for a project.
   */
  setSchedule(payload: AgentSlackSchedulePayload): { ok: boolean } {
    const existing = this.scheduledTimers.get(payload.projectId)
    if (existing) {
      clearInterval(existing)
      this.scheduledTimers.delete(payload.projectId)
    }

    if (!payload.enabled || payload.intervalMinutes <= 0) {
      return { ok: true }
    }

    const intervalMs = Math.max(1, payload.intervalMinutes) * 60 * 1000
    const timer = setInterval(() => {
      void this.triggerScrapeNow(payload.projectId).catch((err) => {
        log.warn('Scheduled agent scrape failed', { projectId: payload.projectId, err })
      })
    }, intervalMs)

    this.scheduledTimers.set(payload.projectId, timer)
    log.info('AgentSlackTool scheduled scrape set', {
      projectId: payload.projectId,
      intervalMinutes: payload.intervalMinutes
    })
    return { ok: true }
  }

  destroy(): void {
    for (const timer of this.scheduledTimers.values()) {
      clearInterval(timer)
    }
    this.scheduledTimers.clear()
  }
}
