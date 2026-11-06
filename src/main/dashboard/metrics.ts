/**
 * Deterministic Dashboard-page metrics (Phase A). Everything here is computed
 * from stored messages, the project record and insight history — never from a
 * model. Missing evidence yields null/empty, never a fabricated zero.
 */

import type {
  DashboardActivityDay,
  DashboardAttentionItem,
  DashboardMetrics,
  DashboardSource,
  DashboardNewSinceCounts,
  DashboardProject,
  InsightMood,
  ProjectInsight
} from '../../shared/dashboard-contract'
import type { DashboardStoredMessage } from './delta-store'
import type { InsightHistoryEntry } from './history-store'

const DAY_MS = 24 * 60 * 60 * 1000
const ACTIVITY_DAYS = 14
const RESPONSE_WINDOW_DAYS = 14
const MIN_RESPONSE_PAIRS = 3
const MAX_ATTENTION_ITEMS = 5
const MAX_NEW_ITEMS = 6
const MAX_MOOD_POINTS = 12

export interface MetricsInput {
  project: DashboardProject
  /** All stored messages for this card, both sources, oldest→newest not required. */
  messages: DashboardStoredMessage[]
  insight: ProjectInsight | null
  /** Newest first (HistoryStore order). */
  history: InsightHistoryEntry[]
  lastViewedAt: string | null
  now?: number
}

function tsMs(ts: string | undefined): number | null {
  if (!ts) return null
  const n = Number(ts)
  if (!Number.isFinite(n)) return null
  return n * 1000
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function localDayKey(ms: number): string {
  // UTC days keep the result identical across machines and testable with `now`.
  return new Date(ms).toISOString().slice(0, 10)
}

function sortMessages(messages: DashboardStoredMessage[]): DashboardStoredMessage[] {
  return [...messages].sort((a, b) => Number(a.ts) - Number(b.ts))
}

function sourceOf(message: DashboardStoredMessage): 'client' | 'ours' {
  return message.source === 'ours' ? 'ours' : 'client'
}

function isSelf(message: DashboardStoredMessage, project: DashboardProject): boolean {
  if (project.personRoles && message.user) {
    const role = project.personRoles[message.user.toLowerCase()]
    if (role === 'me') return true
    if (role === 'client') return false
  }
  return Boolean(project.selfUserId && message.user === project.selfUserId)
}

export function buildDailyActivity(
  messages: DashboardStoredMessage[],
  now = Date.now()
): DashboardActivityDay[] {
  const sorted = sortMessages(messages)
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS
  const firstDay = todayStart - (ACTIVITY_DAYS - 1) * DAY_MS
  const byDay = new Map<string, { client: number; ours: number }>()
  for (let i = 0; i < ACTIVITY_DAYS; i += 1) {
    byDay.set(localDayKey(firstDay + i * DAY_MS), { client: 0, ours: 0 })
  }
  for (const message of sorted) {
    const ms = tsMs(message.ts)
    if (ms === null || ms < firstDay) continue
    const bucket = byDay.get(localDayKey(ms))
    if (!bucket) continue
    bucket[sourceOf(message)] += 1
  }
  return [...byDay.entries()].map(([date, counts], index) => ({
    date,
    client: counts.client,
    ours: counts.ours,
    isToday: index === ACTIVITY_DAYS - 1
  }))
}

export function buildMessages24h(
  messages: DashboardStoredMessage[],
  now = Date.now()
): { client: number; ours: number } {
  let client = 0
  let ours = 0
  for (const message of messages) {
    const ms = tsMs(message.ts)
    if (ms === null || now - ms > DAY_MS || ms > now) continue
    if (sourceOf(message) === 'ours') ours += 1
    else client += 1
  }
  return { client, ours }
}

/** Newest message in the card's client workspace that did not come from us. */
export function lastClientContactAt(
  messages: DashboardStoredMessage[],
  project: DashboardProject
): string | null {
  let newest: number | null = null
  const personRoles = project.personRoles || {}
  const hasDistinctClientSource = messages.some((m) => sourceOf(m) === 'client')

  for (const message of messages) {
    const userRole = message.user ? personRoles[message.user.toLowerCase()] : undefined
    if (userRole !== 'client' && hasDistinctClientSource && sourceOf(message) !== 'client') {
      continue
    }
    if (userRole === 'me' || isSelf(message, project)) continue
    const ms = tsMs(message.ts)
    if (ms === null) continue
    if (newest === null || ms > newest) newest = ms
  }
  return newest === null ? null : iso(newest)
}

/**
 * Median time from a client message to our first reply, counted in
 * conversation turns inside the client workspace. Fewer than three pairs is
 * "not enough data" (null), never a fake number.
 */
export function buildResponseStats(
  messages: DashboardStoredMessage[],
  project: DashboardProject,
  now = Date.now()
): DashboardMetrics['ourResponse'] {
  const windowStart = now - RESPONSE_WINDOW_DAYS * DAY_MS
  const durations: number[] = []
  let pendingClientTs: number | null = null
  const personRoles = project.personRoles || {}
  const hasDistinctClientSource = messages.some((m) => sourceOf(m) === 'client')

  for (const message of sortMessages(messages)) {
    const userRole = message.user ? personRoles[message.user.toLowerCase()] : undefined
    if (userRole !== 'client' && hasDistinctClientSource && sourceOf(message) !== 'client') {
      continue
    }
    const ms = tsMs(message.ts)
    if (ms === null) continue
    if (userRole === 'me' || isSelf(message, project)) {
      if (pendingClientTs !== null && ms >= pendingClientTs && ms <= now) {
        if (pendingClientTs >= windowStart) durations.push((ms - pendingClientTs) / 1000)
      }
      pendingClientTs = null
      continue
    }
    if (ms <= now) pendingClientTs = ms
  }

  if (durations.length < MIN_RESPONSE_PAIRS) {
    return { medianSeconds: null, pairs: durations.length, windowDays: RESPONSE_WINDOW_DAYS }
  }
  const sorted = [...durations].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const medianSeconds = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  return {
    medianSeconds: Math.round(medianSeconds),
    pairs: durations.length,
    windowDays: RESPONSE_WINDOW_DAYS
  }
}

function truncate(text: string, max = 160): string {
  const clean = text.trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** Same question asked once is one item, however its punctuation/case is stored. */
function waitingKey(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[?.!]+$/, '')
}

const SLACK_TS_PATTERN = /^\d{10}\.\d+$/

/** Only a real Slack message ts can match a `[data-ts]` row; an ISO date never can. */
function realSlackTs(ts: string | undefined): string | undefined {
  return ts && SLACK_TS_PATTERN.test(ts) ? ts : undefined
}

function canJumpToMessage(
  source: DashboardSource,
  channelId: string,
  ts: string | undefined
): boolean {
  return (
    (source === 'client' || source === 'ours') &&
    channelId !== '' &&
    channelId !== 'unknown' &&
    realSlackTs(ts) !== undefined
  )
}

export function buildWaiting(insight: ProjectInsight | null): DashboardMetrics['waiting'] {
  if (!insight) return { count: 0, oldestIso: null, blockers: 0, risks: 0, items: [] }

  const last = insight.clientAsk?.lastClientMessage
  const anchor = {
    source: (last?.source ?? 'client') as DashboardSource,
    channelId: last?.channelId ?? 'unknown',
    ts: realSlackTs(last?.ts)
  }
  const anchorCanJump = canJumpToMessage(anchor.source, anchor.channelId, anchor.ts)

  const items: DashboardAttentionItem[] = []
  const seen = new Set<string>()
  let count = 0
  if (insight.clientAsk?.needsReply) {
    const replyText = last
      ? last.quote || `Reply to ${last.who}`
      : 'The client is waiting on a reply'
    seen.add(waitingKey(replyText))
    count += 1
    const replySource = (last?.source ?? anchor.source) as DashboardSource
    const replyChannelId = last?.channelId ?? anchor.channelId
    const replyTs = realSlackTs(last?.ts)
    items.push({
      kind: 'needs-reply',
      text: truncate(replyText),
      ...(last?.whenIso ? { atIso: last.whenIso } : {}),
      source: replySource,
      channelId: replyChannelId,
      ...(replyTs ? { ts: replyTs } : {}),
      canJump: canJumpToMessage(replySource, replyChannelId, replyTs),
      ...(last?.permalink ? { permalink: last.permalink } : {})
    })
  }
  for (const question of insight.clientAsk?.openQuestions ?? []) {
    const key = waitingKey(question)
    if (seen.has(key)) continue
    seen.add(key)
    count += 1
    items.push({
      kind: 'question',
      text: truncate(question),
      source: anchor.source as DashboardSource,
      channelId: anchor.channelId,
      ...(anchor.ts ? { ts: anchor.ts } : {}),
      canJump: anchorCanJump
    })
  }
  for (const blocker of insight.blockers ?? []) {
    items.push({
      kind: 'blocker',
      text: truncate(blocker.what),
      ...(blocker.sinceIso ? { atIso: blocker.sinceIso } : {}),
      source: anchor.source as DashboardSource,
      channelId: anchor.channelId,
      ...(anchor.ts ? { ts: anchor.ts } : {}),
      canJump: anchorCanJump
    })
  }
  for (const risk of insight.risks ?? []) {
    items.push({
      kind: 'risk',
      text: truncate(risk),
      source: anchor.source as DashboardSource,
      channelId: anchor.channelId,
      ...(anchor.ts ? { ts: anchor.ts } : {}),
      canJump: anchorCanJump
    })
  }

  let oldestMs: number | null = null
  for (const item of items) {
    const ms = item.atIso ? new Date(item.atIso).getTime() : NaN
    if (!Number.isFinite(ms)) continue
    if (oldestMs === null || ms < oldestMs) oldestMs = ms
  }

  return {
    count,
    oldestIso: oldestMs === null ? null : new Date(oldestMs).toISOString(),
    blockers: insight.blockers?.length ?? 0,
    risks: insight.risks?.length ?? 0,
    items: items.slice(0, MAX_ATTENTION_ITEMS)
  }
}

/** When the current status was first recorded; null when history shows no change. */
export function buildStatusSince(history: InsightHistoryEntry[]): string | null {
  const sorted = [...history].sort(
    (a, b) => new Date(b.atIso).getTime() - new Date(a.atIso).getTime()
  )
  for (const entry of sorted) {
    if (entry.previousStatus && entry.previousStatus !== entry.insight.status) return entry.atIso
  }
  return null
}

export function buildMoodTrend(
  history: InsightHistoryEntry[]
): Array<{ atIso: string; mood: InsightMood }> {
  const points = [...history]
    .sort((a, b) => new Date(a.atIso).getTime() - new Date(b.atIso).getTime())
    .filter((entry) => Boolean(entry.insight?.mood))
    .slice(-MAX_MOOD_POINTS)
    .map((entry) => ({ atIso: entry.atIso, mood: entry.insight.mood }))
  return points.length >= 3 ? points : []
}

function keyOf(parts: Array<string | undefined>): string {
  return parts.map((p) => (p ?? '').trim().toLowerCase()).join('\u0000')
}

function collectNewItems(
  current: ProjectInsight,
  baseline: ProjectInsight | null
): { counts: DashboardNewSinceCounts; items: DashboardAttentionItem[] } {
  const counts: DashboardNewSinceCounts = {
    requirements: 0,
    decisions: 0,
    commitments: 0,
    files: 0,
    statusChanges: 0,
    questions: 0
  }
  const items: DashboardAttentionItem[] = []

  const newRequirements = (current.requirements ?? []).filter(
    (item) =>
      !(baseline?.requirements ?? []).some((old) => keyOf([old.text]) === keyOf([item.text]))
  )
  const newDecisions = (current.decisions ?? []).filter(
    (item) => !(baseline?.decisions ?? []).some((old) => keyOf([old.what]) === keyOf([item.what]))
  )
  const newCommitments = (current.commitments ?? []).filter(
    (item) => !(baseline?.commitments ?? []).some((old) => keyOf([old.what]) === keyOf([item.what]))
  )
  const newFiles = (current.files ?? []).filter(
    (item) =>
      !(baseline?.files ?? []).some(
        (old) => keyOf([old.name, old.url]) === keyOf([item.name, item.url])
      )
  )
  const newQuestions = (current.clientAsk?.openQuestions ?? []).filter(
    (question) => !(baseline?.clientAsk?.openQuestions ?? []).includes(question)
  )

  counts.requirements = newRequirements.length
  counts.decisions = newDecisions.length
  counts.commitments = newCommitments.length
  counts.files = newFiles.length
  counts.questions = newQuestions.length

  for (const item of newRequirements) {
    items.push({ kind: 'requirement', text: truncate(item.text) })
  }
  for (const item of newQuestions) {
    items.push({ kind: 'question', text: truncate(item) })
  }
  for (const item of newDecisions) {
    items.push({ kind: 'decision', text: truncate(item.what) })
  }
  for (const item of newCommitments) {
    items.push({ kind: 'commitment', text: truncate(item.what) })
  }
  for (const item of newFiles) {
    items.push({ kind: 'file', text: truncate(item.name) })
  }

  return { counts, items }
}

export function buildNewSince(
  insight: ProjectInsight | null,
  history: InsightHistoryEntry[],
  lastViewedAt: string | null
): DashboardMetrics['newSince'] {
  const empty: DashboardMetrics['newSince'] = {
    lastViewedAt,
    counts: {
      requirements: 0,
      decisions: 0,
      commitments: 0,
      files: 0,
      statusChanges: 0,
      questions: 0
    },
    items: []
  }
  if (!lastViewedAt || !insight) return empty

  const viewedMs = new Date(lastViewedAt).getTime()
  if (!Number.isFinite(viewedMs)) return empty

  const sorted = [...history].sort(
    (a, b) => new Date(a.atIso).getTime() - new Date(b.atIso).getTime()
  )
  const baselineEntry = [...sorted]
    .reverse()
    .find((entry) => new Date(entry.atIso).getTime() <= viewedMs)
  // No baseline means we cannot know what changed; show nothing rather than
  // pretending every item is new.
  if (!baselineEntry) return empty

  const { counts, items } = collectNewItems(insight, baselineEntry.insight)
  const statusChanges = sorted.filter(
    (entry) =>
      new Date(entry.atIso).getTime() > viewedMs &&
      entry.previousStatus &&
      entry.previousStatus !== entry.insight.status
  )
  counts.statusChanges = statusChanges.length
  for (const entry of statusChanges.slice(0, 2)) {
    items.push({
      kind: 'status',
      text: `${entry.previousStatus} → ${entry.insight.status}`,
      atIso: entry.atIso
    })
  }

  return { lastViewedAt, counts, items: items.slice(0, MAX_NEW_ITEMS) }
}

export function computeMetrics(input: MetricsInput): DashboardMetrics {
  const now = input.now ?? Date.now()
  const messages = input.messages
  return {
    daily: buildDailyActivity(messages, now),
    messages24h: buildMessages24h(messages, now),
    lastClientContactAt: lastClientContactAt(messages, input.project),
    ourResponse: buildResponseStats(messages, input.project, now),
    waiting: buildWaiting(input.insight),
    statusSince: buildStatusSince(input.history),
    moodTrend: buildMoodTrend(input.history),
    newSince: buildNewSince(input.insight, input.history, input.lastViewedAt)
  }
}
