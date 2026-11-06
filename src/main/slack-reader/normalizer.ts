import { createHash } from 'node:crypto'
import type { DashboardStoredMessage } from '../dashboard/delta-store'

export interface RawScrapedMessage {
  rawTs?: string | number
  sender?: string
  text?: string
  threadTs?: string
  permalink?: string
  replyCount?: number
}

/**
 * Creates a unique deterministic hash for deduplicating messages across polling cycles.
 */
export function createMessageHash(workspaceId: string, channelId: string, ts: string): string {
  return createHash('sha256')
    .update(`${workspaceId.trim()}|${channelId.trim()}|${ts.trim()}`, 'utf8')
    .digest('hex')
}

export function cleanMessageText(rawText: string | undefined): string {
  if (!rawText) return ''
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/\u200B/g, ' ') // zero-width space -> space
    .replace(/[\u200C\u200D\uFEFF]/g, '') // zero-width joiner/non-joiner/bom
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/**
 * Normalizes Slack DOM timestamps to Slack-compatible epoch seconds strings (e.g. 1730000000.123456).
 * Returns null if the timestamp cannot be reliably parsed.
 * (Rule: do NOT invent fake epoch or today timestamps if missing).
 */
export function normalizeSlackTimestamp(rawTs?: string | number): string | null {
  if (typeof rawTs === 'number' && Number.isFinite(rawTs) && rawTs > 0) {
    const seconds = rawTs > 1e11 ? rawTs / 1000 : rawTs
    return seconds.toFixed(6)
  }

  if (typeof rawTs === 'string') {
    const trimmed = rawTs.trim()
    if (!trimmed) return null

    // Exact Slack numeric timestamp format: 10+ digits with optional decimal fraction
    if (/^\d{10}(?:\.\d+)?$/.test(trimmed)) {
      const parts = trimmed.split('.')
      if (parts.length === 2) {
        const frac = parts[1].padEnd(6, '0').slice(0, 6)
        return `${parts[0]}.${frac}`
      }
      return `${parts[0]}.000000`
    }

    // Epoch milliseconds in string
    if (/^\d{13}$/.test(trimmed)) {
      return (Number(trimmed) / 1000).toFixed(6)
    }

    // Permalink 'p1730630000000100' format
    const pMatch = trimmed.match(/^p?(\d{10})(\d{6})$/)
    if (pMatch) {
      return `${pMatch[1]}.${pMatch[2]}`
    }

    // Embedded 10-digit epoch seconds in string (e.g. data-item-key with prefix/suffix)
    const embeddedMatch = trimmed.match(/(?:^|[^\d])(\d{10}(?:\.\d+)?)(?:[^\d]|$)/)
    if (embeddedMatch) {
      const val = embeddedMatch[1]
      const parts = val.split('.')
      if (parts.length === 2) {
        const frac = parts[1].padEnd(6, '0').slice(0, 6)
        return `${parts[0]}.${frac}`
      }
      return `${parts[0]}.000000`
    }

    // Slack humanized dates (e.g. "Today at 2:35 PM", "Yesterday at 4:15 PM")
    const lower = trimmed.toLowerCase()
    if (lower.startsWith('today') || lower.startsWith('yesterday')) {
      const now = new Date()
      if (lower.startsWith('yesterday')) {
        now.setDate(now.getDate() - 1)
      }
      const timePart = trimmed.replace(/^(?:today|yesterday)\s*(?:at\s*)?/i, '').trim()
      const timeMatch = timePart.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i)
      if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10)
        const minutes = parseInt(timeMatch[2], 10)
        const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0
        const meridiem = (timeMatch[4] || '').toUpperCase()
        if (meridiem === 'PM' && hours < 12) hours += 12
        if (meridiem === 'AM' && hours === 12) hours = 0
        now.setHours(hours, minutes, seconds, 0)
        return (now.getTime() / 1000).toFixed(6)
      }
    }

    // Time-only string with optional sender prefix or whitespace (e.g. "02:35 PM", "5:28 PM", "Ashutosh 5:28 PM")
    const timeOnlyMatch = trimmed.match(/(?:^|.*\s)(\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)$/i)
    if (timeOnlyMatch && !/(?:today|yesterday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(trimmed)) {
      const pureTime = timeOnlyMatch[1]
      const pureMatch = pureTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i)
      if (pureMatch) {
        const now = new Date()
        let hours = parseInt(pureMatch[1], 10)
        const minutes = parseInt(pureMatch[2], 10)
        const seconds = pureMatch[3] ? parseInt(pureMatch[3], 10) : 0
        const meridiem = (pureMatch[4] || '').toUpperCase()
        if (meridiem === 'PM' && hours < 12) hours += 12
        if (meridiem === 'AM' && hours === 12) hours = 0
        now.setHours(hours, minutes, seconds, 0)
        return (now.getTime() / 1000).toFixed(6)
      }
    }

    // Try parsing date string with ordinal suffix stripped (e.g. "November 4th, 2026 at 2:35 PM")
    let cleanDateStr = trimmed.replace(/(\d+)(st|nd|rd|th)/gi, '$1').replace(/\bat\b/gi, ' ')
    const hasMonthOrTime =
      /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}:\d{2})/i.test(cleanDateStr)
    if (hasMonthOrTime) {
      if (!/\b20\d{2}\b/.test(cleanDateStr)) {
        const currentYear = new Date().getFullYear()
        const timeIdx = cleanDateStr.search(/\b\d{1,2}:\d{2}/)
        if (timeIdx !== -1) {
          cleanDateStr =
            `${cleanDateStr.slice(0, timeIdx)}${currentYear} ${cleanDateStr.slice(timeIdx)}`.trim()
        } else {
          cleanDateStr = `${cleanDateStr} ${currentYear}`
        }
      }
      const parsed = Date.parse(cleanDateStr)
      if (!Number.isNaN(parsed) && parsed > 0) {
        return (parsed / 1000).toFixed(6)
      }
    }
  }

  return null
}

/**
 * Normalizes a raw scraped DOM message into the standard DashboardStoredMessage schema.
 * Returns null if required fields (like timestamp) are missing.
 */
export function normalizeScrapedMessage(
  raw: RawScrapedMessage,
  _channelId: string
): DashboardStoredMessage | null {
  void _channelId
  const ts = normalizeSlackTimestamp(raw.rawTs)
  if (!ts) {
    // Hard rule: if timestamp cannot be determined from DOM, skip message to avoid corrupting time ordering
    return null
  }

  const text = cleanMessageText(raw.text)
  const user = (raw.sender ?? 'Anonymous').trim() || 'Anonymous'

  const message: DashboardStoredMessage = {
    ts,
    user,
    text,
    source: 'client'
  }

  if (raw.threadTs) {
    const normThread = normalizeSlackTimestamp(raw.threadTs)
    if (normThread) message.threadTs = normThread
  }

  if (raw.permalink) {
    message.permalink = raw.permalink
  }

  if (typeof raw.replyCount === 'number' && raw.replyCount > 0) {
    message.replyCount = raw.replyCount
  }

  return message
}

/**
 * Deduplicates messages within a channel using (workspaceId, channelId, ts).
 */
export function deduplicateMessages(
  workspaceId: string,
  channelId: string,
  messages: DashboardStoredMessage[]
): DashboardStoredMessage[] {
  const seen = new Set<string>()
  const deduped: DashboardStoredMessage[] = []

  for (const msg of messages) {
    const hash = createMessageHash(workspaceId, channelId, msg.ts)
    if (!seen.has(hash)) {
      seen.add(hash)
      deduped.push(msg)
    }
  }

  return deduped.sort((a, b) => Number(a.ts) - Number(b.ts))
}
