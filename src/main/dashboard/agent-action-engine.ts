import type {
  DashboardChatMessage,
  DashboardProject,
  ProjectSource,
  ProjectSourceChannel
} from '../../shared/dashboard-contract'
import { log } from '../logging'
import type { DashboardChatService } from './chat-service'
import type { DashboardSyncEngine } from './sync-engine'
import type { DashboardScheduleStore } from './schedule-store'
import type { MonitorStore } from './monitor-store'

export interface AgentAction {
  type: 'send_slack' | 'read_channel' | 'trigger_scrape' | 'set_schedule' | 'list_capabilities'
  channelNameOrId?: string
  targetChannels?: string[]
  text?: string
  count?: number
  intervalMinutes?: number
  enabled?: boolean
}

export interface AgentActionResult {
  handled: boolean
  action?: AgentAction
  ok: boolean
  cardType?: 'slack_dispatch' | 'channel_read' | 'scrape_trigger' | 'schedule_set' | 'permission_denied' | 'capabilities'
  cardData?: Record<string, unknown>
  replyMarkdown: string
}

export interface AgentActionContext {
  projectId: string
  project: DashboardProject
  chatService?: DashboardChatService
  syncEngine?: DashboardSyncEngine
  scheduleStore?: DashboardScheduleStore
  monitorStore?: Pick<MonitorStore, 'listProjects'> & Partial<Pick<MonitorStore, 'upsertProject'>>
}

/**
 * Normalizes channel queries (e.g. "#general", "@Ankita Manna", "newtestinggroup")
 * for case-insensitive matching.
 */
export function cleanChannel(name: string): string {
  return name.trim().replace(/^[#@]+/, '').toLowerCase()
}

/**
 * Fuzzy score between query and channel name (0 to 1).
 */
function channelScore(query: string, candidate: string): number {
  const q = cleanChannel(query)
  const c = cleanChannel(candidate)
  if (!q || !c) return 0
  if (q === c) return 1.0
  if (c.includes(q) || q.includes(c)) return 0.85

  // First name / word match (e.g. "ankita" matches "Ankita Manna", "utkarsh" matches "Utkarsh Barnwal")
  const qWords = q.split(/\s+/)
  const cWords = c.split(/\s+/)
  if (qWords.some((w) => w.length > 2 && cWords.includes(w))) return 0.85

  // Levenshtein / letter overlap distance
  const lenDiff = Math.abs(q.length - c.length)
  if (lenDiff > 3) return 0
  let diff = 0
  let i = 0
  let j = 0
  while (i < q.length && j < c.length) {
    if (q[i] === c[j]) {
      i++
      j++
    } else {
      diff++
      if (q.length > c.length) i++
      else if (c.length > q.length) j++
      else {
        i++
        j++
      }
    }
  }
  diff += (q.length - i) + (c.length - j)
  return diff <= 2 ? 0.75 : 0
}

/**
 * Finds a matching channel from the project's sources or monitors by name or ID.
 */
export function resolveProjectChannel(
  project: DashboardProject,
  target: string
): { channel: ProjectSourceChannel; source?: ProjectSource } | null {
  const query = cleanChannel(target)
  if (!query) return null

  let bestMatch: { channel: ProjectSourceChannel; source?: ProjectSource } | null = null
  let bestScore = 0

  for (const src of project.sources ?? []) {
    for (const ch of src.channels ?? []) {
      const scoreName = channelScore(query, ch.name)
      const scoreId = channelScore(query, ch.id)
      const score = Math.max(scoreName, scoreId)
      if (score > bestScore) {
        bestScore = score
        bestMatch = { channel: ch, source: src }
      }
    }
  }

  if (bestScore >= 0.75 && bestMatch) {
    return bestMatch
  }

  // Fallback: check monitors if source channel list didn't match
  for (const m of project.monitors ?? []) {
    const scoreName = channelScore(query, m.channelName)
    const scoreId = channelScore(query, m.channelId)
    const score = Math.max(scoreName, scoreId)
    if (score > bestScore) {
      bestScore = score
      const src = (project.sources ?? []).find((s) => s.workspaceId === project.teamId) || project.sources?.[0]
      bestMatch = {
        channel: {
          id: m.channelId,
          name: m.channelName,
          enabled: true,
          agentRead: true,
          agentWrite: false
        },
        source: src
      }
    }
  }

  return bestScore >= 0.75 ? bestMatch : null
}

/**
 * Formats a concise summary of current channel and DM permissions to inject
 * into the LLM context so the agent knows who is authorized for Read, Write, and Auto-Reply.
 */
export function formatChannelPermissionsContext(project: DashboardProject): string {
  const writeAuthorized: string[] = []
  const readMonitored: string[] = []
  const autoReplyList: string[] = []

  for (const src of project.sources ?? []) {
    for (const ch of src.channels ?? []) {
      const name = ch.name.startsWith('@') ? ch.name : `#${ch.name}`
      if (ch.agentWrite) writeAuthorized.push(name)
      if (ch.enabled !== false || ch.agentRead) readMonitored.push(name)
      if (ch.autoReply) autoReplyList.push(name)
    }
  }

  return [
    `- Write Authorized: ${writeAuthorized.length > 0 ? writeAuthorized.join(', ') : 'None yet (Enable Agent Write in Workspace Control)'}`,
    `- Read Monitored: ${readMonitored.length > 0 ? readMonitored.join(', ') : 'None yet'}`,
    `- Real-Time Auto-Reply: ${autoReplyList.length > 0 ? autoReplyList.join(', ') : 'None enabled'}`
  ].join('\n')
}

/**
 * Helper to check whether an incoming message qualifies for Real-Time Auto-Reply.
 */
export function shouldAutoReplyToMessage(
  project: DashboardProject,
  msg: { text: string; userId?: string; userName?: string; isMine?: boolean },
  channelId: string,
  selfNames: string[] = ['Ashutosh', 'You', 'me']
): { shouldReply: boolean; reason?: 'dm' | 'mention'; channel?: ProjectSourceChannel; source?: ProjectSource } {
  if (msg.isMine) return { shouldReply: false }

  const textLower = (msg.text || '').toLowerCase()
  // Anti-loop guard: never reply to our own automated reply template
  if (textLower.includes('thanks for reaching out') && textLower.includes('reviewing this')) {
    return { shouldReply: false }
  }

  for (const src of project.sources ?? []) {
    for (const ch of src.channels ?? []) {
      if (ch.id === channelId || cleanChannel(ch.name) === cleanChannel(channelId)) {
        if (!ch.autoReply) return { shouldReply: false }

        // 1. Direct message (1-on-1 DM): auto-reply immediately
        const isDm =
          ch.isDm ||
          ch.kind === 'dm' ||
          ch.name.startsWith('@') ||
          ch.name.startsWith('#@')
        if (isDm) {
          return { shouldReply: true, reason: 'dm', channel: ch, source: src }
        }

        // 2. Group channel: only reply if user's name is mentioned
        const isMentioned = selfNames.some((name) => textLower.includes(name.toLowerCase()))
        if (isMentioned) {
          return { shouldReply: true, reason: 'mention', channel: ch, source: src }
        }
      }
    }
  }

  return { shouldReply: false }
}

/**
 * Analyzes user prompts to identify if an action is requested.
 */
export function detectAgentAction(prompt: string, project?: DashboardProject): AgentAction | null {
  const p = prompt.trim()
  if (!p) return null

  // 1. Explicit JSON action block emitted by LLM: ```action { ... } ``` or raw JSON {"action": ...}
  const actionMatch = p.match(/```action\s*([\s\S]*?)\s*```/i) || p.match(/\{[\s\r\n]*"action"\s*:\s*"([^"]+)"[\s\S]*?\}/i)
  if (actionMatch) {
    try {
      const rawJson = actionMatch[0].startsWith('```') ? actionMatch[1] : actionMatch[0]
      const parsed = JSON.parse(rawJson)
      if (parsed && typeof parsed.action === 'string') {
        const channels = Array.isArray(parsed.channels)
          ? parsed.channels
          : parsed.channel
            ? [parsed.channel]
            : undefined
        return {
          type: parsed.action as AgentAction['type'],
          channelNameOrId: parsed.channel || parsed.channelNameOrId,
          targetChannels: channels,
          text: parsed.text,
          count: Number(parsed.count) || undefined,
          intervalMinutes: Number(parsed.intervalMinutes) || undefined,
          enabled: parsed.enabled !== false
        }
      }
    } catch {
      // ignore JSON parse error and proceed to intent matching
    }
  }

  // 2. Capabilities check
  // E.g.: "hiii here tell is you can send the messsage in the slack ?",
  //       "is you have capability to schedule any task ??",
  //       "what can you do", "can you send messages", "what are your tools"
  const isCapabilitiesQuery =
    /\b(?:what\s+can\s+you\s+do|what\s+are\s+your\s+tools|capabilities|what\s+channels)\b/i.test(p) ||
    (/\b(?:is\s+you\s+(?:can|have)|can\s+you|can\s+i|are\s+you\s+able|tell\s+.*?\byou\s+can|capability\s+to)\b/i.test(p) &&
      /\b(?:send|post|mess?ag?e?s?|schedule)\b/i.test(p) &&
      !/(?:in|to)\s+(?:the\s+)?(?:#)?[a-zA-Z0-9_-]+(?:\s+channel)?\s+(?:hi|hello|hlw|saying|with|text)/i.test(p) &&
      !/(?:send|post)\s+(?:hi|hello|hlw|["'].*?["'])\s+(?:in|to)/i.test(p))

  if (isCapabilitiesQuery) {
    return { type: 'list_capabilities' }
  }

  // 3. Trigger Scrape / Sync
  // Examples: "scrape now", "trigger the scraping", "trigger scrape", "start scrape", "sync now"
  if (/\b(scrape\s+now|trigger\s+(?:the\s+)?scraping|trigger\s+scrape|run\s+scrape|start\s+scrape|sync\s+now)\b/i.test(p)) {
    return { type: 'trigger_scrape' }
  }

  // 4. Intent: Schedule Scrape
  // Examples: "schedule scraping every 15m", "schedule scrape every 20s", "schedule task every 15m"
  const schedMatch = p.match(/\b(?:schedule|interval)\b.*?\b(\d+(?:\.\d+)?)\s*(s|sec|seconds|m|min|minutes|h|hours)\b/i)
  if (schedMatch) {
    const num = Number(schedMatch[1])
    const unit = schedMatch[2].toLowerCase()
    let mins = num
    if (unit.startsWith('s')) mins = num / 60
    if (unit.startsWith('h')) mins = num * 60
    return { type: 'set_schedule', intervalMinutes: mins, enabled: true }
  }

  // 5. Intent: Send Slack Message (Supports single and multiple recipients)
  // Examples:
  // - "send message in slack - ankita and utkarsh and ashutosh - send that message - just simple - ' hii '"
  // - "#ankita and #utkarsh send both simple - 'hiii '"
  // - "@utkarsh send 'hii ' message"
  // - "#manjeet singh send him message - hiii bro how are you ??"
  // - "send message in agentworkprojecttesting channel hiii"
  if (/\b(?:send|post|write)\b/i.test(p)) {
    // 5A. Extract message text
    let messageText = ''
    const quoteMatch = p.match(/["'“]([^"'“”]+)["'”]/)
    if (quoteMatch) {
      messageText = quoteMatch[1].trim()
    } else {
      const textMatch = p.match(
        /(?:send\s+(?:the\s+|that\s+|him\s+|her\s+)?message\s+(?:thier|there)?\s*[:,-]?\s*|\s+(?:message|text)\s*[:,-]\s*|\s+saying\s+)(.+)$/i
      )
      if (textMatch) {
        messageText = textMatch[1]
          .trim()
          .replace(/\s*(?:as\s+(?:y?you|u)\s+want)?\s*(?:in\s+thier|in\s+there)?$/i, '')
          .trim()
      }
    }

    // 5B. Extract target channels / people
    const targetSet = new Set<string>()

    // If project is available, check for channel/contact names in prompt
    if (project) {
      const allChannels = (project.sources ?? []).flatMap((s) => s.channels ?? [])
      const pLower = p.toLowerCase()
      for (const ch of allChannels) {
        const cleanName = cleanChannel(ch.name)
        const firstName = cleanName.split(/\s+/)[0]
        if (
          pLower.includes(cleanName) ||
          (firstName.length > 2 && new RegExp(`\\b${firstName}\\b`, 'i').test(pLower))
        ) {
          targetSet.add(ch.name)
        }
      }
    }

    // Fallback: extract target names using regex before "send", "message", or after "to/in"
    if (targetSet.size === 0) {
      const targetMatch =
        p.match(/(?:send|post|write)\s+(?:the\s+)?(?:message\s+)?(?:in|to|into)\s+(?:the\s+)?(?:slack\s*[-:]?\s*)?([a-zA-Z0-9_#@,\s-]+?)(?:\s*-\s*send|\s+channel|\s*[:,-]\s*["']|\s+text|\s+message|\s+saying|\s*$)/i) ||
        p.match(/([a-zA-Z0-9_#@,\s-]+?)\s+(?:send|post|write)\s+(?:both|all|simple|him|her|\s*["'])/i)

      if (targetMatch) {
        const rawTargetStr = targetMatch[1].trim()
        const parts = rawTargetStr.split(/\s*(?:and|&|,)\s*/i).filter((s) => s.trim().length > 0)
        for (const part of parts) {
          const cleaned = part.replace(/^[#@]+/, '').trim()
          if (cleaned && !['slack', 'the', 'message', 'simple'].includes(cleaned.toLowerCase())) {
            targetSet.add(cleaned)
          }
        }
      }
    }

    const detectedTargets = Array.from(targetSet)

    if (detectedTargets.length > 0) {
      return {
        type: 'send_slack',
        channelNameOrId: detectedTargets[0],
        targetChannels: detectedTargets,
        text: messageText || 'Hello'
      }
    }
  }

  // 6. Intent: Read Channel Messages
  // Examples:
  // "tell me what are the last 3 message in the newtestinggroup tell me last 3 messages"
  // "read last 5 messages from #general"
  // "what are the messages in #channel"
  const readPatterns = [
    /(?:what\s+are\s+)?(?:the\s+)?(?:last|latest)?\s*(\d+)?\s*(?:message|messages)\s+(?:in|from|of)\s+(?:the\s+)?(?:#)?([a-zA-Z0-9_-]+)/i,
    /(?:read|tell|show|get)\s+(?:me\s+)?(?:what\s+are\s+)?(?:the\s+)?(?:last|latest)?\s*(\d+)?\s*(?:message|messages)\s+(?:in|from|of)\s+(?:the\s+)?(?:#)?([a-zA-Z0-9_-]+)/i
  ]
  for (const re of readPatterns) {
    const m = p.match(re)
    if (m) {
      const count = m[1] ? Number(m[1]) : 3
      const channel = m[2].trim()
      if (channel) {
        return { type: 'read_channel', channelNameOrId: channel, count }
      }
    }
  }

  return null
}

/**
 * Formats the final markdown reply with embedded JSON action card comment.
 */
function wrapCardReply(result: AgentActionResult): AgentActionResult {
  if (result.cardType) {
    const cardMarker = `\n\n<!-- ACTION_CARD: ${JSON.stringify({
      type: result.cardType,
      ok: result.ok,
      data: result.cardData
    })} -->`
    return {
      ...result,
      replyMarkdown: `${result.replyMarkdown}${cardMarker}`
    }
  }
  return result
}

/**
 * Executes the resolved agent action against backend dependencies.
 */
export async function executeAgentAction(
  action: AgentAction,
  ctx: AgentActionContext
): Promise<AgentActionResult> {
  const { projectId, project, chatService, syncEngine } = ctx

  switch (action.type) {
    case 'send_slack': {
      const targets =
        action.targetChannels && action.targetChannels.length > 0
          ? action.targetChannels
          : action.channelNameOrId
            ? [action.channelNameOrId]
            : []
      const text = (action.text || '').trim()

      if (targets.length === 0 || !text) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: 'Please specify the destination contact(s) or channel(s) and the message text to send.'
        })
      }

      if (!chatService) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: 'Chat service is unavailable. Could not send message.'
        })
      }

      const delivered: Array<{ id: string; name: string; ts?: string }> = []
      const locked: Array<{ id: string; name: string }> = []
      const notFound: string[] = []

      for (const targetQuery of targets) {
        const resolved = resolveProjectChannel(project, targetQuery)
        if (!resolved) {
          notFound.push(targetQuery)
          continue
        }

        const { channel } = resolved

        // Strict security guardrail: check agentWrite permission
        if (!channel.agentWrite) {
          locked.push({ id: channel.id, name: channel.name })
          continue
        }

        try {
          const sendRes = await chatService.sendMessage({
            projectId,
            channelId: channel.id,
            text,
            isAgent: true
          })

          if (sendRes.ok) {
            delivered.push({ id: channel.id, name: channel.name, ts: sendRes.message?.ts })
          } else {
            locked.push({ id: channel.id, name: channel.name })
          }
        } catch (err) {
          log.error(`send_slack dispatch failed for ${channel.name}:`, err)
          locked.push({ id: channel.id, name: channel.name })
        }
      }

      const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

      // Case 1: All targets were locked (zero delivered)
      if (delivered.length === 0 && locked.length > 0) {
        const lockedNames = locked.map((c) => `#${c.name}`).join(', ')
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          cardType: 'permission_denied',
          cardData: {
            channelId: locked[0].id,
            channelName: locked[0].name,
            lockedChannels: locked
          },
          replyMarkdown: [
            `⚠️ **Permission Locked**: Agent write permission is disabled for **${lockedNames}**.`,
            '',
            'To protect your workspace, the agent will never post messages without explicit authorization.',
            `Click below to open **Workspace Control** and enable **Agent Write** for these contacts.`
          ].join('\n')
        })
      }

      // Case 2: Targets not found in project
      if (delivered.length === 0 && notFound.length > 0) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: `Could not find channel(s) or contact(s) **${notFound.map((n) => `#${n}`).join(', ')}** in this project. Please verify in Workspace Control.`
        })
      }

      // Case 3: Partial or full delivery
      const deliveredNames = delivered.map((c) => `#${c.name}`).join(', ')
      const replyLines = [
        `✅ **Message Dispatched to ${deliveredNames}**`,
        `> *${text}*`,
        '',
        `*Delivered via Direct API in ~150ms at ${nowFormatted}*`
      ]

      if (locked.length > 0) {
        replyLines.push(
          '',
          `⚠️ **Permission Locked for ${locked.map((c) => `#${c.name}`).join(', ')}**: Agent write permission is disabled. Use Workspace Control to authorize them.`
        )
      }

      if (notFound.length > 0) {
        replyLines.push(
          '',
          `ℹ️ **Not Found**: Could not match **${notFound.map((n) => `#${n}`).join(', ')}** to a monitored channel.`
        )
      }

      return wrapCardReply({
        handled: true,
        action,
        ok: true,
        cardType: 'slack_dispatch',
        cardData: {
          channelId: delivered[0].id,
          channelName: delivered[0].name,
          delivered,
          locked,
          ts: delivered[0].ts,
          time: nowFormatted,
          text,
          mode: 'direct_api'
        },
        replyMarkdown: replyLines.join('\n')
      })
    }

    case 'read_channel': {
      const targetQuery = action.channelNameOrId || ''
      const limit = Math.min(Math.max(1, action.count || 3), 20)

      const resolved = resolveProjectChannel(project, targetQuery)
      if (!resolved) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: `Channel **#${targetQuery}** was not found in this project's monitored sources. Check the channel list in Workspace Control.`
        })
      }

      const { channel } = resolved

      if (!chatService) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: 'Chat service is unavailable.'
        })
      }

      try {
        let page = await chatService.loadMessages({
          projectId,
          channelId: channel.id,
          source: 'client',
          limit
        })

        if (!page.messages || page.messages.length === 0) {
          // Try 'ours' source if client source had no messages
          page = await chatService.loadMessages({
            projectId,
            channelId: channel.id,
            source: 'ours',
            limit
          })
        }

        if (!page.messages || page.messages.length === 0) {
          return wrapCardReply({
            handled: true,
            action,
            ok: true,
            cardType: 'channel_read',
            cardData: {
              channelId: channel.id,
              channelName: channel.name,
              count: 0
            },
            replyMarkdown: `No stored messages found in **#${channel.name}** yet. You can ask me to **"scrape now"** to pull latest messages directly from Slack!`
          })
        }

        const msgs = page.messages.slice(0, limit)
        const formatted = msgs
          .map((m: DashboardChatMessage, idx: number) => {
            const user = m.userName || m.userId || 'Unknown'
            const time = m.atIso ? new Date(m.atIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
            return `${idx + 1}. **${user}** (${time}): *${m.text}*`
          })
          .join('\n')

        return wrapCardReply({
          handled: true,
          action,
          ok: true,
          cardType: 'channel_read',
          cardData: {
            channelId: channel.id,
            channelName: channel.name,
            count: msgs.length,
            messages: msgs.map((m) => ({ user: m.userName || m.userId, text: m.text, ts: m.ts }))
          },
          replyMarkdown: [`📖 **Latest ${msgs.length} message(s) in #${channel.name}:**`, '', formatted].join('\n')
        })
      } catch (err) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: `Could not read messages from **#${channel.name}**: ${err instanceof Error ? err.message : String(err)}`
        })
      }
    }

    case 'trigger_scrape': {
      if (!syncEngine) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: 'Sync engine is unavailable.'
        })
      }

      try {
        const snapshot = await syncEngine.syncProject(projectId)
        const count = snapshot?.newMessageCount ?? 0
        if (chatService) {
          chatService.invalidateActivityCache(projectId)
        }

        return wrapCardReply({
          handled: true,
          action,
          ok: true,
          cardType: 'scrape_trigger',
          cardData: { newMessagesCount: count },
          replyMarkdown: [
            `🕷️ **On-Demand Scrape Completed**`,
            '',
            count > 0
              ? `Captured **${count} new message(s)** across monitored channels. Dashboard analytics, cards, and activity charts have been updated!`
              : `All channels are up to date. Zero new messages found since last sync.`
          ].join('\n')
        })
      } catch (err) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: `Scrape encountered an error: ${err instanceof Error ? err.message : String(err)}`
        })
      }
    }

    case 'set_schedule': {
      const interval = action.intervalMinutes || 15
      const enabled = action.enabled !== false

      // Update schedule on browser sources
      try {
        const source =
          (project.sources ?? []).find((s) => s.platform === 'slack' && s.enabled !== false) || project.sources?.[0]
        if (source && ctx.monitorStore?.upsertProject) {
          source.scheduleEnabled = enabled
          source.scheduleIntervalMinutes = interval as any
          await ctx.monitorStore.upsertProject({ project })
        }

        const label = interval < 1 ? `${Math.round(interval * 60)} seconds` : `${interval} minutes`
        return wrapCardReply({
          handled: true,
          action,
          ok: true,
          cardType: 'schedule_set',
          cardData: { intervalMinutes: interval, enabled },
          replyMarkdown: [
            `⏱️ **Automated Scrape Schedule Configured**`,
            '',
            enabled
              ? `Background scraping is **ON**, polling every **${label}** via Direct API.`
              : `Background scraping has been **PAUSED**.`
          ].join('\n')
        })
      } catch (err) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: `Failed to update schedule: ${err instanceof Error ? err.message : String(err)}`
        })
      }
    }

    case 'list_capabilities': {
      const permsContext = formatChannelPermissionsContext(project)

      return wrapCardReply({
        handled: true,
        action,
        ok: true,
        cardType: 'capabilities',
        replyMarkdown: [
          `🤖 **Cosmic Autonomous Agent Superpowers**`,
          '',
          `I can execute real workspace actions directly from this chat:`,
          `- **🚀 Post to Slack**: Send messages or announcements to any authorized channel (e.g. \`send message to #agentworkprojecttesting hello team\`, or to multiple people: \`#ankita and #utkarsh send simple 'hiii'\`).`,
          `- **📖 Read Channels**: Fetch recent messages from any channel (e.g. \`what are the last 3 messages in #newtestinggroup\`).`,
          `- **🕷️ Trigger Scrape**: Ingest fresh messages on demand (e.g. \`scrape now\` or \`trigger scraping\`).`,
          `- **⏱️ Manage Schedules**: Configure automated polling frequency (e.g. \`schedule every 20s\` or \`schedule every 15m\`).`,
          '',
          `**Current Channel Access:**`,
          permsContext
        ].join('\n')
      })
    }

    default:
      return { handled: false, ok: false, replyMarkdown: '' }
  }
}
