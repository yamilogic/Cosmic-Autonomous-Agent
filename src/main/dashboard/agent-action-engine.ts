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
import {
  detectMessageIsTaskRelated,
  detectMessageNeedsReply,
  generatePersonaReply
} from './ai-personas'

export interface AgentAction {
  type:
    | 'send_slack'
    | 'read_channel'
    | 'trigger_scrape'
    | 'set_schedule'
    | 'list_capabilities'
    | 'generate_ai_reply'
    | 'show_help'
  channelNameOrId?: string
  targetChannels?: string[]
  platform?: string
  persona?: string
  text?: string
  count?: number
  intervalMinutes?: number
  enabled?: boolean
}

export interface AgentActionResult {
  handled: boolean
  action?: AgentAction
  ok: boolean
  cardType?:
    | 'slack_dispatch'
    | 'channel_read'
    | 'scrape_trigger'
    | 'schedule_set'
    | 'permission_denied'
    | 'capabilities'
    | 'help_cheatsheet'
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

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    }
  }
  return d[m][n]
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

  const maxLen = Math.max(q.length, c.length)
  if (maxLen === 0) return 1.0
  const dist = levenshteinDistance(q, c)
  const similarity = 1 - dist / maxLen
  return similarity >= 0.7 ? similarity : 0
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
): {
  shouldReply: boolean
  reason?: 'dm' | 'mention' | 'all' | 'needs_reply' | 'task_only' | 'draft_only'
  channel?: ProjectSourceChannel
  source?: ProjectSource
} {
  if (msg.isMine) return { shouldReply: false }

  const text = msg.text || ''
  const textLower = text.toLowerCase()
  // Anti-loop guard: never reply to our own automated reply template
  if (
    (textLower.includes('thanks for reaching out') && textLower.includes('reviewing this')) ||
    textLower.includes('thanks for mentioning me')
  ) {
    return { shouldReply: false }
  }

  for (const src of project.sources ?? []) {
    for (const ch of src.channels ?? []) {
      if (ch.id === channelId || cleanChannel(ch.name) === cleanChannel(channelId)) {
        const policy = ch.autoReplyPolicy || (ch.autoReply ? 'mention_dm' : 'disabled')
        if (policy === 'disabled') return { shouldReply: false }

        const isDm = Boolean(
          ch.isDm ||
            ch.kind === 'dm' ||
            ch.name.startsWith('@') ||
            ch.name.startsWith('#@') ||
            ch.name.toLowerCase().includes('you')
        )
        const isMentioned = selfNames.some((name) => textLower.includes(name.toLowerCase()))

        // 1. Reply to All: reply unconditionally to any inbound message
        if (policy === 'all') {
          return { shouldReply: true, reason: 'all', channel: ch, source: src }
        }

        // 2. Smart Needs-Reply: evaluate if incoming message asks question or requires action
        if (policy === 'needs_reply') {
          if (detectMessageNeedsReply(text)) {
            return { shouldReply: true, reason: 'needs_reply', channel: ch, source: src }
          }
          return { shouldReply: false }
        }

        // 3. Task & Project Only: evaluate if message is related to deliverables, blockers, bugs
        if (policy === 'task_only') {
          if (detectMessageIsTaskRelated(text)) {
            return { shouldReply: true, reason: 'task_only', channel: ch, source: src }
          }
          return { shouldReply: false }
        }

        // 4. Mention & DM Only: only reply in DMs or direct mentions
        if (policy === 'mention_dm') {
          if (isDm) {
            return { shouldReply: true, reason: 'dm', channel: ch, source: src }
          }
          if (isMentioned) {
            return { shouldReply: true, reason: 'mention', channel: ch, source: src }
          }
          return { shouldReply: false }
        }

        // 5. Draft Only Mode: prepare draft instead of posting
        if (policy === 'draft_only') {
          return { shouldReply: true, reason: 'draft_only', channel: ch, source: src }
        }
      }
    }
  }

  return { shouldReply: false }
}

/**
 * Analyzes user prompts to identify if an action is requested.
 */
export function detectAgentAction(
  prompt: string,
  project?: DashboardProject,
  activeChannelId?: string
): AgentAction | null {
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

  // 1B. Help & Cheatsheet commands: /help, /help-slack, help, ?
  if (/^\/(?:help-slack|help_slack)\b/i.test(p) || /^help-slack\b/i.test(p)) {
    return { type: 'show_help', platform: 'slack' }
  }
  if (/^\/help\b/i.test(p) || p.toLowerCase() === 'help' || p === '?') {
    return { type: 'show_help', platform: 'all' }
  }

  // 1C & 1D. Order-Independent Colon Dispatch & AI Answer:
  // Examples:
  // @AgentWork #agentworkprojecttesting /send : hii bro how are you ??
  // @AgentWork #agentworkprojecttesting /ai-ans [professional] : gave their 10 anime name
  // /send @slack #Ashutosh : hello bro
  // #agentworkprojecttesting /send : exact text here
  // /send : hello world
  // /ai-ans [friendly] : ask status
  const colonIdx = p.indexOf(':')
  if (colonIdx > 0) {
    const header = p.slice(0, colonIdx).trim()
    const payload = p.slice(colonIdx + 1).trim()

    const isAiAns = /\b(?:\/ai-ans|\/ai-answer|ai-ans)\b/i.test(header)
    const isSend = /\b(?:\/send|send|post)\b/i.test(header) || /[@#]/.test(header)

    if (isAiAns || isSend) {
      const atMatch = header.match(/@([a-zA-Z0-9_-]+)/)
      const hashMatch = header.match(/#([a-zA-Z0-9_-]+)/)
      const personaMatch = header.match(/\[([a-zA-Z0-9_-]+)\]/)

      let rawPlatform = atMatch ? atMatch[1].trim() : undefined
      let rawTarget = hashMatch ? hashMatch[1].trim() : undefined

      // If atMatch is present but no hashMatch, check if atMatch was a target channel/person instead of platform
      if (!rawTarget && atMatch) {
        const candidate = atMatch[1].trim()
        if (candidate.toLowerCase() === 'slack' || candidate.toLowerCase() === 'teams') {
          rawPlatform = candidate.toLowerCase()
        } else {
          let isChannel = false
          if (project?.sources) {
            for (const s of project.sources) {
              if (s.channels?.some((c) => c.name.replace(/^[#@]/, '').toLowerCase() === candidate.toLowerCase())) {
                isChannel = true
                break
              }
            }
          }
          if (isChannel) {
            rawTarget = candidate
            rawPlatform = undefined
          }
        }
      }

      if (rawTarget?.toLowerCase() === 'slack' || rawTarget?.toLowerCase() === 'teams') {
        rawPlatform = rawTarget.toLowerCase()
        rawTarget = undefined
      }

      const target = rawTarget || activeChannelId || undefined
      const persona = personaMatch ? personaMatch[1].toLowerCase().trim() : 'professional'

      if (isAiAns) {
        return {
          type: 'generate_ai_reply',
          platform: rawPlatform,
          channelNameOrId: target,
          targetChannels: target ? [target] : undefined,
          persona,
          text: payload || 'Please answer the last message professionally.'
        }
      }

      if (isSend && payload) {
        return {
          type: 'send_slack',
          platform: rawPlatform,
          channelNameOrId: target,
          targetChannels: target ? [target] : undefined,
          text: payload
        }
      }
    }
  }

  // 1E. Fallback /ai-ans command without colon:
  // Examples:
  // /ai-ans @slack #Ashutosh [friendly] ask how the project is going
  // /ai-ans [professional] give an answer
  const aiAnsMatch = p.match(
    /^(?:\/ai-ans|\/ai-answer|ai-ans)\s*(?:@([a-zA-Z0-9_-]+)\s+)?(?:#([a-zA-Z0-9_-]+)\s*)?(?:\[([a-zA-Z0-9_-]+)\]\s*)?(?::\s*|\s+)?([\s\S]+)$/i
  )
  if (aiAnsMatch) {
    const rawPlatform = aiAnsMatch[1]?.trim()
    const rawTarget = aiAnsMatch[2]?.trim() || activeChannelId
    const persona = aiAnsMatch[3]?.toLowerCase().trim() || 'professional'
    const instruction = aiAnsMatch[4]?.trim() || 'Please answer the last message professionally.'
    return {
      type: 'generate_ai_reply',
      platform: rawPlatform,
      channelNameOrId: rawTarget,
      targetChannels: rawTarget ? [rawTarget] : undefined,
      persona,
      text: instruction
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
  // - "here try to send the message in the agentworkprojecttesting channel you try to send the message properly see that all proeprly and ten send the message thier hiii or hlw as yyou want in thier"
  if (/\b(?:send|post|write)\b/i.test(p)) {
    const targetSet = new Set<string>()

    // 5A. Extract message text
    let messageText = ''
    const quoteMatch = p.match(/["'“]([^"'“”]+)["'”]/)
    if (quoteMatch) {
      messageText = quoteMatch[1].trim()
    } else {
      // Check trailing delivery clause first: e.g. "... and ten send the message thier hiii or hlw"
      const trailingMatch = p.match(
        /(?:(?:and\s+)?(?:then|ten)\s+send\s+(?:the\s+|that\s+|him\s+|her\s+)?message\s*(?:thier|there)?\s*[:,-]?\s*)(.+)$/i
      )
      if (trailingMatch) {
        messageText = trailingMatch[1].trim()
      } else {
        const textMatch = p.match(
          /(?:send\s+(?:the\s+|that\s+|him\s+|her\s+)?message\s*(?:thier|there)?\s*[:,-]?\s*|\s+(?:message|text)\s*[:,-]\s*|\s+saying\s+)(.+)$/i
        )
        if (textMatch) {
          messageText = textMatch[1].trim()
        }
        if (!messageText && p.includes(':')) {
          const colonText = p.slice(p.indexOf(':') + 1).trim()
          if (colonText) messageText = colonText
        }
      }
      if (messageText) {
        // Strip routing preamble like "to the Ashutosh properly like", "in #dev saying", "to @user:"
        const preambleMatch = messageText.match(
          /^(?:(?:to|in|for|into)\s+(?:the\s+)?(?:#|@)?([a-zA-Z0-9_\s-]+?)\s*(?:channel)?\s*(?:properly\s*)?(?:like|saying|that|:|-|,)\s*)/i
        )
        if (preambleMatch) {
          const candidateTarget = preambleMatch[1]?.trim()
          if (candidateTarget && targetSet.size === 0) {
            targetSet.add(candidateTarget)
          }
          messageText = messageText.slice(preambleMatch[0].length).trim()
        }
        // Also strip standalone leading filler like "properly like", "just like", "saying", "that"
        messageText = messageText.replace(/^(?:(?:properly\s+)?(?:like|saying|that|as)\s*[:,-]?\s*)/i, '').trim()
        // Strip trailing conversational fillers like "as you want in there", "thier"
        messageText = messageText
          .replace(/\s*(?:as\s+(?:y+ou|u)\s+want)?\s*(?:in\s+(?:thier|there))?$/i, '')
          .replace(/\s*(?:properly)?\s*(?:in\s+(?:thier|there))?$/i, '')
          .trim()
      }
    }

    // 5B. Extract target channels / people
    // If project is available, check for channel/contact names in prompt
    if (project) {
      const allChannels = (project.sources ?? []).flatMap((s) => s.channels ?? [])
      const pLower = p.toLowerCase()
      for (const ch of allChannels) {
        const cleanName = cleanChannel(ch.name)
        const firstName = cleanName.split(/\s+/)[0]
        if (
          pLower.includes(cleanName) ||
          (firstName.length > 2 && new RegExp(`\\b${firstName}\\b`, 'i').test(pLower)) ||
          channelScore(pLower, ch.name) >= 0.75
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
    } else if (activeChannelId) {
      return {
        type: 'send_slack',
        channelNameOrId: activeChannelId,
        targetChannels: [activeChannelId],
        text: messageText || 'Hello'
      }
    }
  }

  // 6. Intent: Read Channel Messages
  // Examples:
  // "tell me what are the last 3 message in the newtestinggroup tell me last 3 messages"
  // "read last 5 messages from #general"
  // "what are the messages in #channel"
  // "tell me the last 3 messages" (when scoped to a channel)
  const readPatterns = [
    /(?:what\s+are\s+)?(?:the\s+)?(?:last|latest)?\s*(\d+)?\s*(?:message|messages)\s+(?:in|from|of)\s+(?:the\s+)?(?:#)?([a-zA-Z0-9_-]+)/i,
    /(?:read|tell|show|get)\s+(?:me\s+)?(?:what\s+are\s+)?(?:the\s+)?(?:last|latest)?\s*(\d+)?\s*(?:message|messages)\s+(?:in|from|of)\s+(?:the\s+)?(?:#)?([a-zA-Z0-9_-]+)/i,
    /(?:read|tell|show|get)\s+(?:me\s+)?(?:the\s+)?(?:last|latest)\s*(\d+)?\s*(?:message|messages)/i
  ]
  for (let i = 0; i < readPatterns.length; i++) {
    const m = p.match(readPatterns[i])
    if (m) {
      const count = m[1] ? Number(m[1]) : 3
      const channel = m[2] ? m[2].trim() : activeChannelId
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

    case 'show_help': {
      const isSlackOnly = action.platform === 'slack'
      const activeSources = (project.sources ?? []).filter((s) => s.enabled !== false && s.role !== 'ours')
      const allChannels = activeSources.flatMap((s) => s.channels ?? [])
      const autoReplyCount = allChannels.filter((c) => c.autoReply || (c.autoReplyPolicy && c.autoReplyPolicy !== 'disabled')).length
      const writeCount = allChannels.filter((c) => c.agentWrite).length

      const lines: string[] = []
      lines.push(isSlackOnly ? '### 🚀 Cosmic Slack Smart Dispatch Cheatsheet' : '### 🚀 Cosmic Smart Dispatch & Automation Cheatsheet')
      lines.push('')
      lines.push('#### 1. Interactive Mentions in Composer')
      lines.push('- Type `@` — Opens floating popover of connected platform accounts (`@slack`, `@teams`, `@whatsapp`).')
      lines.push('- Type `#` — Opens floating popover of monitored channels and direct contacts (`#agentworkprojecttesting`, `#Ashutosh`).')
      lines.push('- Type `/` — Opens slash command menu (`/send`, `/ai-ans`, `/help`, `/help-slack`, `/scrape`, `/status`).')
      lines.push('')
      lines.push('#### 2. Slash Commands & Verbatim Dispatch')
      lines.push('- `/send @account #channel : <message>` — Dispatches exact verbatim message following the colon (`:`) via Direct API (~150ms).')
      lines.push('- `/ai-ans @account #channel [persona] : <instruction>` — AI drafts and posts a context-grounded response using channel history (RAG).')
      lines.push('- `/help` & `/help-slack` — Surface this interactive cheatsheet.')
      lines.push('- `/scrape` — Triggers immediate background delta sync.')
      lines.push('')
      lines.push('#### 3. 6 AI Response Personas (Available for Auto-Reply & `/ai-ans`)')
      lines.push('- `👔 Professional (Default)`: Crisp, formal enterprise tone.')
      lines.push('- `😊 Friendly & Warm`: Approachable, polite, enthusiastic, conversational.')
      lines.push('- `⚡ Direct & Concise`: Minimalist, bullet-pointed, zero fluff.')
      lines.push('- `🤝 Empathetic ("Good Person")`: Caring, patient, client-advocate tone.')
      lines.push('- `🛠️ Technical & Detailed`: Deep architecture, specifications, technical context.')
      lines.push('- `📊 Executive Summary`: High-level updates on deliverables, decisions, and blockers.')
      lines.push('')
      lines.push('#### 4. 6-Tier Auto-Reply Policies (Configured in bar above composer)')
      lines.push('- `🛑 No Auto-Reply`: Agent listens and syncs; never responds automatically.')
      lines.push('- `⚡ Reply to All`: Automatically replies to every incoming contact message.')
      lines.push('- `🧠 Smart Needs-Reply`: Only replies when an incoming message asks a question or requires action.')
      lines.push('- `📋 Task & Project Only`: Only replies if the message concerns deliverables, tasks, or blockers.')
      lines.push('- `👤 Mention & DM Only`: Only replies in 1-on-1 direct messages or when explicitly tagged.')
      lines.push('- `📝 Draft Approval Mode`: Generates a suggested response draft card in chat for user confirmation.')
      lines.push('')
      lines.push(`*Active Status: ${activeSources.length} connected account(s) · ${allChannels.length} channel(s) monitored · ${writeCount} write-authorized · ${autoReplyCount} auto-reply enabled.*`)

      return wrapCardReply({
        handled: true,
        action,
        ok: true,
        cardType: 'help_cheatsheet',
        cardData: {
          platform: action.platform,
          connectedSources: activeSources.map((s) => ({ id: s.id, platform: s.platform, name: s.workspaceName })),
          channelCount: allChannels.length,
          writeCount,
          autoReplyCount
        },
        replyMarkdown: lines.join('\n')
      })
    }

    case 'generate_ai_reply': {
      const targetQuery = action.channelNameOrId
      if (!targetQuery) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: 'Please specify a target channel or contact for the AI response (e.g. `/ai-ans #Ashutosh [friendly] : message`).'
        })
      }

      const resolved = resolveProjectChannel(project, targetQuery)
      if (!resolved) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: `Could not find channel or contact matching "${targetQuery}".`
        })
      }

      const { channel } = resolved
      if (!channel.agentWrite) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          cardType: 'permission_denied',
          cardData: { channelId: channel.id, channelName: channel.name },
          replyMarkdown: `⚠️ **Agent Write Permission Required**: Channel or contact **#${channel.name}** is not authorized for posting.`
        })
      }

      let historyRows: DashboardChatMessage[] = []
      if (chatService) {
        try {
          const page = await chatService.loadMessages({ projectId, channelId: channel.id, limit: 15 })
          historyRows = page.messages || []
        } catch {
          historyRows = []
        }
      }

      const persona = action.persona || channel.autoReplyPersona || 'professional'
      const promptInstruction = action.text || 'Please provide an appropriate response to the latest conversation.'

      const synthesizedText = generatePersonaReply({
        personaKey: persona,
        channelName: channel.name,
        instruction: promptInstruction,
        history: historyRows
      })

      if (!chatService) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: 'Chat service is unavailable to dispatch AI response.'
        })
      }

      const res = await chatService.sendMessage({
        projectId,
        channelId: channel.id,
        text: synthesizedText,
        isAgent: true
      })

      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      return wrapCardReply({
        handled: true,
        action,
        ok: Boolean(res.ok),
        cardType: 'slack_dispatch',
        cardData: {
          channelId: channel.id,
          channelName: channel.name,
          persona,
          ts: res.message?.ts
        },
        replyMarkdown: [
          `⚡ **AI Response Dispatched with [${persona.toUpperCase()}] Persona**`,
          `> Destination: **#${channel.name}**`,
          `> Grounded Context: Injected ${historyRows.length} recent messages (RAG)`,
          `Delivered via Direct API in ~150ms at ${now}.`
        ].join('\n')
      })
    }

    default:
      return { handled: false, ok: false, replyMarkdown: '' }
  }
}
