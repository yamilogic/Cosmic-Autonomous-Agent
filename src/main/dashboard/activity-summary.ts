import type {
  DashboardActivityChannel,
  DashboardActivityMessage,
  DashboardActivityParticipant,
  DashboardProjectActivity,
  DashboardSource
} from '../../shared/dashboard-contract'

/** One displayable stored message handed to the selector. */
export interface ActivityInputRow {
  source: DashboardSource
  channelId: string
  channelName: string
  /** Slack ts (seconds, optionally with a fractional part). */
  ts: string
  userId: string
  userName: string
  isMine: boolean
  text: string
  permalink?: string
  subtype?: string
}

export interface BuildProjectActivityInput {
  rows: ActivityInputRow[]
  now: number
  /** Defaults: 6 recent messages, 3 participants/channels, 14-day window. */
  recentLimit?: number
  topLimit?: number
  windowDays?: number
}

const NOISE_SUBTYPES = new Set([
  'message_changed',
  'message_deleted',
  'channel_join',
  'channel_leave'
])

function tsMs(ts: string): number {
  const seconds = Number(ts)
  return Number.isFinite(seconds) ? seconds * 1000 : NaN
}

function displayable(row: ActivityInputRow): boolean {
  if (!row.text || !row.text.trim()) return false
  return !(row.subtype && NOISE_SUBTYPES.has(row.subtype))
}

function toMessage(row: ActivityInputRow): DashboardActivityMessage {
  return {
    source: row.source,
    channelId: row.channelId,
    channelName: row.channelName,
    ts: row.ts,
    atIso: new Date(tsMs(row.ts)).toISOString(),
    userId: row.userId,
    userName: row.userName || row.userId || 'Unknown',
    isMine: row.isMine,
    text: row.text,
    permalink: row.permalink ?? null
  }
}

/**
 * Deterministic 14-day activity for the Dashboard centre. No I/O and no
 * guessing: names arrive resolved from the service (or as the Slack id).
 */
export function buildProjectActivity({
  rows,
  now,
  recentLimit = 6,
  topLimit = 3,
  windowDays = 14
}: BuildProjectActivityInput): DashboardProjectActivity {
  const cutoff = now - windowDays * 24 * 60 * 60_000
  const sorted = rows
    .filter((row) => displayable(row))
    .map((row) => ({ row, ms: tsMs(row.ts) }))
    .filter(({ ms }) => Number.isFinite(ms) && ms >= cutoff)
    .sort((a, b) => b.ms - a.ms)

  const recent = sorted.slice(0, recentLimit).map(({ row }) => toMessage(row))

  let latestClientMs: number | null = null
  let latestOursMs: number | null = null
  for (const { row, ms } of sorted) {
    if (row.source !== 'client') continue
    if (row.isMine) {
      if (latestOursMs === null || ms > latestOursMs) latestOursMs = ms
    } else if (latestClientMs === null || ms > latestClientMs) {
      latestClientMs = ms
    }
  }

  const ballInCourt: DashboardProjectActivity['ballInCourt'] =
    latestClientMs === null
      ? null
      : latestOursMs === null || latestClientMs > latestOursMs
        ? 'you'
        : 'client'

  const participantCounts = new Map<string, DashboardActivityParticipant>()
  const channelCounts = new Map<string, DashboardActivityChannel>()
  let clientCount = 0
  let oursCount = 0

  for (const { row } of sorted) {
    if (row.source === 'client') clientCount += 1
    else oursCount += 1

    const participantKey = `${row.source}:${row.userId || 'unknown'}`
    const participant = participantCounts.get(participantKey)
    if (participant) participant.count += 1
    else {
      participantCounts.set(participantKey, {
        userId: row.userId,
        name: row.userName || row.userId || 'Unknown',
        source: row.source,
        count: 1
      })
    }

    const channelKey = `${row.source}:${row.channelId}`
    const channel = channelCounts.get(channelKey)
    if (channel) channel.count += 1
    else {
      channelCounts.set(channelKey, {
        channelId: row.channelId,
        channelName: row.channelName,
        source: row.source,
        count: 1
      })
    }
  }

  const participants = [...participantCounts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, topLimit)
  const channels = [...channelCounts.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.channelName.localeCompare(b.channelName) ||
        a.channelId.localeCompare(b.channelId)
    )
    .slice(0, topLimit)

  return {
    recent,
    latestClientAt: latestClientMs === null ? null : new Date(latestClientMs).toISOString(),
    latestOursAt: latestOursMs === null ? null : new Date(latestOursMs).toISOString(),
    ballInCourt,
    participants,
    channels,
    counts14d: { client: clientCount, ours: oursCount }
  }
}
