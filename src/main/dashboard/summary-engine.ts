import type {
  DashboardChannelDelta,
  DashboardProject,
  DashboardProjectSnapshot
} from '../../shared/dashboard-contract'
import type { DashboardStoredMessage } from './delta-store'

/** Slack ts → ISO datetime (ts is unix seconds[.ms]). */
export function tsToIso(ts: string): string {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return new Date(0).toISOString()
  return new Date(n * 1000).toISOString()
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Heuristic date extraction — supports ISO yyyy-mm-dd, and
 * "<month> <day>[th]" style patterns. Automatic extract only. */
export function extractDates(messages: DashboardStoredMessage[]): {
  startDate?: string
  endDate?: string
} {
  let startDate: string | undefined
  let endDate: string | undefined
  const now = new Date()

  for (const m of messages) {
    const text = (m.text ?? '').toLowerCase()
    if (!text) continue

    const iso = text.match(/(20\d{2})-(\d{2})-(\d{2})/)
    const monthDay = text.match(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/
    )

    if (iso) {
      const [, y, mo, d] = iso
      const val = `${y}-${mo}-${d}`
      if (new Date(val) <= now) startDate = startDate ?? val
      else endDate = endDate ?? val
      continue
    }
    if (monthDay) {
      const monthIdx = MONTHS.indexOf(monthDay[1])
      const day = Number(monthDay[2])
      if (monthIdx >= 0 && day >= 1 && day <= 31) {
        // use the nearest year that puts this date forward or recent-past,
        // keyed off the message context: deadline keywords → end date
        const nowYear = now.getUTCFullYear()
        const candidate = new Date(Date.UTC(nowYear, monthIdx, day))
        const val = candidate.toISOString().slice(0, 10)
        if (/deadline|by|due|finish|deliver|ship/.test(text)) {
          endDate = endDate ?? val
        } else if (candidate <= now) {
          startDate = startDate ?? val
        } else {
          endDate = endDate ?? val
        }
      }
    }
  }
  return { startDate, endDate }
}

const POSITIVE = [
  'awesome',
  'great',
  'perfect',
  'love',
  'thanks',
  'thank',
  'excellent',
  'nice',
  'amazing',
  'good job',
  'well done',
  '🎉',
  '🙏',
  '❤️',
  '👍',
  '🙌',
  '😍',
  '✅',
  '🔥'
]
const NEGATIVE = [
  'broken',
  'still not',
  'not working',
  'urgent',
  'worried',
  'delay',
  'late',
  'blocked',
  'angry',
  'disappointed',
  'missed',
  'asap',
  'escalate',
  '😡',
  '😠',
  '❌',
  '😅'
]

export function computeMood(messages: DashboardStoredMessage[]): {
  state: 'good' | 'neutral' | 'tense'
  signal: string
} {
  let score = 0
  let hits = 0
  for (const m of messages.slice(-50)) {
    const text = (m.text ?? '').toLowerCase()
    for (const p of POSITIVE)
      if (text.includes(p)) {
        score += 1
        hits += 1
      }
    for (const p of NEGATIVE)
      if (text.includes(p)) {
        score -= 1.5
        hits += 1
      }
  }
  if (hits === 0) return { state: 'neutral', signal: 'no clear mood signal in recent messages' }
  const state = score >= 2 ? 'good' : score <= -2 ? 'tense' : 'neutral'
  return {
    state,
    signal:
      state === 'neutral'
        ? 'mixed / mild signals in recent messages'
        : state === 'good'
          ? 'positive tone in recent messages'
          : 'frustration words detected — respond soon'
  }
}

/** v2.3 — noise that must never reach a card: join/leave notices, bot
 * posts, system messages and pure greetings/filler. */
const GREETINGS = new Set([
  'hi',
  'hii',
  'hiii',
  'hiiii',
  'hiiiiiiiiiiiiiiii',
  'hey',
  'hello',
  'yo',
  'ok',
  'okay',
  'kk',
  'k',
  'thanks',
  'thank you',
  'thx',
  'bye',
  'yes',
  'no',
  'sure',
  'done',
  'nice',
  'lol',
  'hmm'
])

const SYSTEM_PATTERNS = [
  /has joined the channel/i,
  /has left the channel/i,
  /set the channel topic/i,
  /pinned a message/i,
  /unpinned a message/i,
  /renamed the channel/i,
  /uploaded a file/i,
  /added an integration/i,
  /^<@[A-Z0-9]+>\s*$/i
]

export function isNoise(message: { text?: string; subtype?: string }): boolean {
  if (message.subtype && message.subtype !== 'message') return true
  const text = (message.text ?? '').trim()
  if (!text) return true
  if (SYSTEM_PATTERNS.some((re) => re.test(text))) return true
  if (GREETINGS.has(text.toLowerCase().replace(/[!.]+$/, ''))) return true
  // short filler without any content words
  if (text.length <= 4 && !/[a-z]{4,}/i.test(text)) return true
  return false
}

/** Local literal-activity summary: last few newest meaningful message texts. */
export function buildSummary(messages: DashboardStoredMessage[]): string[] {
  return messages
    .filter((m) => (m.text ?? '').trim().length > 0 && m.subtype !== 'message_changed')
    .filter((m) => !isNoise(m))
    .slice(-5)
    .map((m) => {
      const text = (m.text ?? '').replace(/\s+/g, ' ').trim()
      const who = m.user ? `${m.user}: ` : ''
      return who + (text.length > 160 ? `${text.slice(0, 157)}…` : text)
    })
}

/** Time-aware completion estimate (no manual value). */
export function estimateCompletion(input: {
  lastAt?: number
  startAt?: number
  endAt?: number
  now?: number
}): number {
  const now = input.now ?? Date.now()
  if (input.startAt && input.endAt) {
    if (input.endAt <= now) return 100
    const span = input.endAt - input.startAt
    if (span > 0) {
      const done = Math.min(0.95, Math.max(0.02, (now - input.startAt) / span))
      return Math.round(done * 100)
    }
  }
  const staleMs = 1000 * 60 * 60 * 24
  const last = input.lastAt
  if (!last) return 0
  const daysStale = (now - last) / staleMs
  if (daysStale <= 1) return 75
  if (daysStale <= 3) return 60
  if (daysStale <= 7) return 45
  if (daysStale <= 14) return 30
  return Math.max(5, 30 - Math.floor(daysStale / 30) * 5)
}

export type Pace = 'ahead' | 'on-track' | 'stale'

export function computePace(messages: DashboardStoredMessage[], now = Date.now()): Pace {
  const newest = messages.at(-1)
  if (!newest) return 'stale'
  const last = Number(newest.ts) * 1000
  const daysIdle = (now - last) / (1000 * 60 * 60 * 24)
  if (daysIdle < 2) return 'ahead'
  if (daysIdle < 7) return 'on-track'
  return 'stale'
}

export function summarizeProject(input: {
  project: DashboardProject
  messages: DashboardStoredMessage[]
  netNewCount: number
  perChannel?: DashboardChannelDelta[]
  lastUpdatedAt?: string | null
  now?: Date
}): DashboardProjectSnapshot {
  const { project, messages, netNewCount } = input
  const now = input.now ?? new Date()
  const extracted = extractDates(messages)

  const effectiveDates = {
    startDate: project.startDate ?? extracted.startDate,
    endDate: project.endDate ?? extracted.endDate
  }

  const startMs = effectiveDates.startDate
    ? new Date(`${effectiveDates.startDate}T00:00:00Z`).getTime()
    : undefined
  const endMs = effectiveDates.endDate
    ? new Date(`${effectiveDates.endDate}T23:59:59Z`).getTime()
    : undefined
  const lastMsgMs = messages.at(-1) ? Number(messages.at(-1)!.ts) * 1000 : undefined

  const completion =
    project.manualCompletion ??
    estimateCompletion({ lastAt: lastMsgMs, startAt: startMs, endAt: endMs, now: now.getTime() })

  return {
    project,
    summary: buildSummary(messages).join('\n'),
    newMessageCount: netNewCount,
    totalMessageCount: messages.length,
    completion,
    pace: computePace(messages, now.getTime()),
    mood: computeMood(messages),
    extractedDates: extracted,
    effectiveDates,
    perChannel: input.perChannel ?? [],
    lastUpdatedAt: input.lastUpdatedAt ?? null,
    syncState: 'idle'
  }
}
