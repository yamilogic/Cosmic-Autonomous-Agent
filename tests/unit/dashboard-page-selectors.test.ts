import { describe, expect, it } from 'vitest'
import type { DashboardProjectSnapshot, RecentActivity } from '../../src/shared/dashboard-contract'
import type { CardSummary } from '../../src/renderer/src/components/dashboard/card-view'
import {
  ballInCourt,
  filterCounts,
  isInactive,
  isUrgent,
  matchesFilter,
  movePinned,
  normalisePinnedOrder,
  pinProject,
  recentReason,
  sortUnpinned,
  unpinProject,
  type ProjectEntry
} from '../../src/renderer/src/components/dashboard/dashboard-page-selectors'

const NOW = Date.parse('2026-10-26T12:00:00Z')

function snapshot(
  id: string,
  overrides: Partial<DashboardProjectSnapshot> = {}
): DashboardProjectSnapshot {
  return {
    project: { id, name: id } as DashboardProjectSnapshot['project'],
    summary: '',
    newMessageCount: 0,
    totalMessageCount: 0,
    completion: 0,
    pace: 'on-track',
    mood: { state: 'neutral', signal: '' },
    extractedDates: {},
    effectiveDates: {},
    perChannel: [
      {
        channelId: 'c1',
        channelName: 'c1',
        source: 'ours',
        messageCount: 1,
        latestMessageAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
        cursor: '1',
        lastSyncAt: ''
      }
    ],
    lastUpdatedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    syncState: 'idle',
    ...overrides
  }
}

function summary(id: string, overrides: Partial<CardSummary> = {}): CardSummary {
  return {
    projectId: id,
    index: 0,
    name: id,
    workspaceName: 'Workspace',
    clientName: 'Client',
    status: 'on-track',
    needsReply: false,
    inactive: false,
    urgency: 'normal',
    situationLine: '',
    justChanged: '',
    nextStep: '',
    progress: null,
    dates: { badge: 'not stated in chat' },
    pace: 'on-pace',
    paceLabel: 'On pace',
    week: [],
    lastClientAt: null,
    myLastReplyAt: null,
    counts: { questions: 0, blockers: 0, risks: 0, files: 0, requirements: 0 },
    score: 0,
    aiBadge: 'no insight yet',
    syncedLabel: 'synced now',
    ...overrides
  }
}

function entry(
  id: string,
  summaryOverrides: Partial<CardSummary> = {},
  snap = snapshot(id)
): ProjectEntry {
  return { snapshot: snap, summary: summary(id, summaryOverrides) }
}

describe('pinned order', () => {
  it('appends a new pin and keeps an existing pin in place', () => {
    expect(pinProject([], 'a')).toEqual(['a'])
    expect(pinProject(['a', 'b'], 'a')).toEqual(['a', 'b'])
  })

  it('unpins and moves without dropping the rest', () => {
    expect(unpinProject(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
    expect(movePinned(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(movePinned(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(movePinned(['a', 'b'], 'a', -1)).toEqual(['a', 'b'])
  })

  it('ignores deleted and unknown ids, and duplicates', () => {
    expect(normalisePinnedOrder(['a', 'deleted', 'a', 'b'], ['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('filters and sorting', () => {
  it('treats reply, high urgency and blocked/at-risk as urgent', () => {
    expect(isUrgent(summary('a', { needsReply: true }))).toBe(true)
    expect(isUrgent(summary('a', { urgency: 'high' }))).toBe(true)
    expect(isUrgent(summary('a', { status: 'blocked' }))).toBe(true)
    expect(isUrgent(summary('a', { status: 'at-risk' }))).toBe(true)
    expect(isUrgent(summary('a'))).toBe(false)
  })

  it('uses the latest message across both sources for inactive', () => {
    const stale = snapshot('a', {
      lastUpdatedAt: new Date(NOW - 25 * 3600_000).toISOString(),
      perChannel: []
    })
    expect(isInactive(stale, NOW)).toBe(true)
    const active = snapshot('a', {
      lastUpdatedAt: new Date(NOW - 25 * 3600_000).toISOString(),
      perChannel: [
        {
          channelId: 'c1',
          channelName: 'c1',
          source: 'ours',
          messageCount: 1,
          latestMessageAt: new Date(NOW - 60_000).toISOString(),
          cursor: '1',
          lastSyncAt: ''
        }
      ]
    })
    expect(isInactive(active, NOW)).toBe(false)
  })

  it('does not treat a fresh sync timestamp as a recent message', () => {
    const justSynced = snapshot('a', {
      lastUpdatedAt: new Date(NOW - 60_000).toISOString(),
      perChannel: []
    })
    expect(isInactive(justSynced, NOW)).toBe(true)
  })

  it('counts and filters only the unpinned entries it is given', () => {
    const entries = [
      entry('a', { needsReply: true }),
      entry('b', { status: 'at-risk' }),
      entry(
        'c',
        {},
        snapshot('c', {
          lastUpdatedAt: new Date(NOW - 25 * 3600_000).toISOString(),
          perChannel: []
        })
      )
    ]
    expect(filterCounts(entries, NOW)).toEqual({ all: 3, urgent: 2, inactive: 1 })
    expect(
      entries.filter((e) => matchesFilter('urgent', e, NOW)).map((e) => e.summary.name)
    ).toEqual(['a', 'b'])
  })

  it('puts urgent first, then importance, then newest', () => {
    const sorted = sortUnpinned([
      entry('low', { score: 100 }),
      entry('urgent', { needsReply: true, score: 1 }),
      entry('high', { score: 50 })
    ])
    expect(sorted.map((e) => e.summary.name)).toEqual(['urgent', 'low', 'high'])
  })
})

describe('recent and court rules', () => {
  const recent = (overrides: Partial<RecentActivity> = {}): RecentActivity =>
    ({
      projectId: 'a',
      projectName: 'A',
      teamName: 'T',
      channelName: 'c',
      who: 'u',
      text: '',
      ts: '',
      kind: 'chatter',
      needsReply: false,
      status: 'on-track',
      score: 1,
      oneLine: '',
      hoursSinceLastMessage: 1,
      ...overrides
    }) as RecentActivity

  it('picks the largest reason in a fixed tie order', () => {
    expect(recentReason(recent({ needsReply: true, status: 'blocked' }))).toBe('reply-owed')
    expect(recentReason(recent({ status: 'blocked' }))).toBe('blocked')
    expect(recentReason(recent({ status: 'at-risk' }))).toBe('at-risk')
    expect(recentReason(recent({ status: 'waiting-on-client' }))).toBe('waiting-on-client')
    expect(recentReason(recent())).toBe('new-activity')
  })

  it('returns null with no client message, yours with no reply, else latest wins', () => {
    expect(ballInCourt(null, null)).toBeNull()
    expect(ballInCourt('2026-10-26T10:00:00Z', null)).toBe('yours')
    expect(ballInCourt('2026-10-26T10:00:00Z', '2026-10-26T11:00:00Z')).toBe('client')
    expect(ballInCourt('2026-10-26T10:00:00Z', '2026-10-26T09:00:00Z')).toBe('yours')
  })
})
