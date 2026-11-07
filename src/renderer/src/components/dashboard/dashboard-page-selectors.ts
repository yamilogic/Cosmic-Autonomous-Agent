/** Pure Client-projects page rules: pin order, filters, sorting, recent reason.
 *  Kept DOM-free so the page, tests and future surfaces share one definition. */

import type {
  DashboardProjectSnapshot,
  RecentActivity
} from '../../../../shared/dashboard-contract'
import type { CardSummary } from './card-view'

export type ProjectFilter = 'all' | 'urgent' | 'inactive'
export type RecentReason =
  'reply-owed' | 'blocked' | 'at-risk' | 'waiting-on-client' | 'new-activity'

const HOUR_MS = 60 * 60 * 1000
const INACTIVE_MS = 24 * HOUR_MS

export function normalisePinnedOrder(
  order: readonly string[],
  projectIds: Iterable<string>
): string[] {
  const known = new Set(projectIds)
  return [...new Set(order)].filter((id) => known.has(id))
}

export function pinProject(order: readonly string[], projectId: string): string[] {
  return order.includes(projectId) ? [...order] : [...order, projectId]
}

export function unpinProject(order: readonly string[], projectId: string): string[] {
  return order.filter((id) => id !== projectId)
}

export function movePinned(order: readonly string[], projectId: string, delta: -1 | 1): string[] {
  const index = order.indexOf(projectId)
  if (index < 0) return [...order]
  const target = Math.min(order.length - 1, Math.max(0, index + delta))
  if (target === index) return [...order]
  const next = [...order]
  next.splice(index, 1)
  next.splice(target, 0, projectId)
  return next
}

export function isUrgent(summary: CardSummary): boolean {
  return (
    summary.needsReply ||
    summary.urgency === 'high' ||
    summary.status === 'blocked' ||
    summary.status === 'at-risk'
  )
}

/** True when no message (client or ours) landed in the last 24 hours. */
export function isInactive(snapshot: DashboardProjectSnapshot, now = Date.now()): boolean {
  const timestamps = [
    snapshot.insight?.clientAsk?.lastClientMessage?.whenIso,
    snapshot.metrics?.lastClientContactAt,
    ...(snapshot.perChannel ?? []).map((channel) => channel.latestMessageAt)
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))
  if (timestamps.length === 0) return true
  return now - Math.max(...timestamps) >= INACTIVE_MS
}

export interface ProjectEntry {
  snapshot: DashboardProjectSnapshot
  summary: CardSummary
}

export interface ProjectFilterCounts {
  all: number
  urgent: number
  inactive: number
}

export function filterCounts(entries: ProjectEntry[], now = Date.now()): ProjectFilterCounts {
  return {
    all: entries.length,
    urgent: entries.filter((entry) => isUrgent(entry.summary)).length,
    inactive: entries.filter((entry) => isInactive(entry.snapshot, now)).length
  }
}

export function matchesFilter(
  filter: ProjectFilter,
  entry: ProjectEntry,
  now = Date.now()
): boolean {
  if (filter === 'urgent') return isUrgent(entry.summary)
  if (filter === 'inactive') return isInactive(entry.snapshot, now)
  return true
}

function lastActivityMs(entry: ProjectEntry): number {
  const values = [
    entry.summary.lastClientAt,
    entry.snapshot.lastUpdatedAt,
    ...(entry.snapshot.perChannel ?? []).map((channel) => channel.latestMessageAt)
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))
  return values.length > 0 ? Math.max(...values) : 0
}

/** Pinned keeps the user's order. Unpinned is urgent first, then importance. */
export function sortUnpinned(entries: ProjectEntry[]): ProjectEntry[] {
  return [...entries].sort((a, b) => {
    const urgent = Number(isUrgent(b.summary)) - Number(isUrgent(a.summary))
    if (urgent !== 0) return urgent
    if (b.summary.score !== a.summary.score) return b.summary.score - a.summary.score
    const activity = lastActivityMs(b) - lastActivityMs(a)
    if (activity !== 0) return activity
    return a.summary.name.localeCompare(b.summary.name)
  })
}

export function recentReason(item: RecentActivity): RecentReason {
  if (item.needsReply) return 'reply-owed'
  if (item.status === 'blocked') return 'blocked'
  if (item.status === 'at-risk') return 'at-risk'
  if (item.status === 'waiting-on-client') return 'waiting-on-client'
  return 'new-activity'
}

export function ballInCourt(
  lastClientAt: string | null,
  myLastReplyAt: string | null
): 'yours' | 'client' | null {
  if (!lastClientAt) return null
  if (!myLastReplyAt) return 'yours'
  const client = new Date(lastClientAt).getTime()
  const mine = new Date(myLastReplyAt).getTime()
  if (!Number.isFinite(client) || !Number.isFinite(mine)) return 'yours'
  return mine >= client ? 'client' : 'yours'
}
