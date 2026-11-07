import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  DashboardProject,
  InsightMood,
  ProjectInsight
} from '../../src/shared/dashboard-contract'
import type { DashboardStoredMessage } from '../../src/main/dashboard/delta-store'
import type { InsightHistoryEntry } from '../../src/main/dashboard/history-store'
import {
  buildDailyActivity,
  buildMoodTrend,
  buildNewSince,
  buildResponseStats,
  buildWaiting,
  computeMetrics
} from '../../src/main/dashboard/metrics'
import { DashboardViewedStore } from '../../src/main/dashboard/viewed-store'

const NOW = Date.parse('2026-10-25T12:00:00Z')
const iso = (msOffset: number): string => new Date(NOW + msOffset).toISOString()

function project(overrides: Partial<DashboardProject> = {}): DashboardProject {
  return {
    id: 'p1',
    name: 'Project One',
    clientName: 'Acme',
    profileId: 'manual:K1',
    teamId: 'T1',
    teamName: 'Workspace',
    appId: 'slack',
    tokenSource: 'manual',
    monitors: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    selfUserId: 'U_SELF',
    ...overrides
  } as DashboardProject
}

function msg(
  secondsOffset: number,
  user: string,
  source: 'client' | 'ours' = 'client',
  text = ''
): DashboardStoredMessage {
  return { ts: String(Math.floor((NOW + secondsOffset) / 1000)), user, source, text }
}

function insight(overrides: Partial<ProjectInsight> = {}): ProjectInsight {
  return {
    status: 'on-track',
    statusReason: '',
    statusChange: '',
    mood: 'neutral',
    moodReason: '',
    moodQuote: '',
    progress: 0,
    progressEvidence: '',
    situationLine: '',
    recentLine: '',
    highlights: [],
    blockers: [],
    nextStep: '',
    dates: {},
    clientAsk: {
      needsReply: false,
      urgency: 'normal',
      lastClientMessage: null,
      openQuestions: []
    },
    commitments: [],
    decisions: [],
    risks: [],
    keywords: [],
    requirements: [],
    scope: { in: [], out: [] },
    deliverables: [],
    files: [],
    people: [],
    milestones: [],
    ...overrides
  } as ProjectInsight
}

function historyEntry(
  atIso: string,
  entryInsight: ProjectInsight,
  previousStatus?: ProjectInsight['status']
): InsightHistoryEntry {
  return {
    atIso,
    newMessageCount: 1,
    insight: entryInsight,
    ...(previousStatus ? { previousStatus } : {})
  } as InsightHistoryEntry
}

describe('dashboard metrics — activity', () => {
  it('returns 14 daily buckets ending today, split by workspace', () => {
    const days = buildDailyActivity(
      [
        msg(-60 * 60 * 1000, 'U_CLIENT', 'client'),
        msg(-50 * 60 * 1000, 'U_SELF', 'ours'),
        msg(-24 * 60 * 60 * 1000, 'U_CLIENT', 'client'),
        msg(-30 * 24 * 60 * 60 * 1000, 'U_CLIENT', 'client')
      ],
      NOW
    )
    expect(days).toHaveLength(14)
    expect(days[13].isToday).toBe(true)
    expect(days[13].client).toBe(1)
    expect(days[13].ours).toBe(1)
    expect(days[12].client).toBe(1)
    expect(days.reduce((sum, day) => sum + day.client + day.ours, 0)).toBe(3)
  })

  it('keeps an empty day at zero instead of dropping it', () => {
    const days = buildDailyActivity([], NOW)
    expect(days).toHaveLength(14)
    expect(days.every((day) => day.client === 0 && day.ours === 0)).toBe(true)
  })
})

describe('dashboard metrics — response time', () => {
  it('uses the median first reply inside the client workspace', () => {
    const stats = buildResponseStats(
      [
        msg(-5 * 60 * 60 * 1000, 'U_CLIENT'),
        msg(-5 * 60 * 60 * 1000 + 600_000, 'U_SELF'),
        msg(-4 * 60 * 60 * 1000, 'U_CLIENT'),
        msg(-4 * 60 * 60 * 1000 + 1200_000, 'U_SELF'),
        msg(-2 * 60 * 60 * 1000, 'U_CLIENT'),
        msg(-2 * 60 * 60 * 1000 + 300_000, 'U_SELF')
      ],
      project(),
      NOW
    )
    expect(stats.pairs).toBe(3)
    expect(stats.medianSeconds).toBe(600)
  })

  it('reports null under three pairs instead of a fabricated number', () => {
    const stats = buildResponseStats(
      [msg(-60 * 60 * 1000, 'U_CLIENT'), msg(-60 * 60 * 1000 + 120_000, 'U_SELF')],
      project(),
      NOW
    )
    expect(stats.pairs).toBe(1)
    expect(stats.medianSeconds).toBeNull()
  })

  it('ignores our own workspace and unknown senders', () => {
    const stats = buildResponseStats(
      [
        msg(-60 * 60 * 1000, 'U_SELF', 'ours'),
        msg(-60 * 60 * 1000 + 60_000, 'U_SELF', 'ours'),
        msg(-30 * 60 * 1000, 'U_CLIENT'),
        msg(-30 * 60 * 1000 + 90_000, 'U_SELF')
      ],
      project(),
      NOW
    )
    expect(stats.pairs).toBe(1)
  })
})

describe('dashboard metrics — attention and waiting', () => {
  it('counts the reply and open questions, and ages from real timestamps only', () => {
    const waiting = buildWaiting(
      insight({
        clientAsk: {
          needsReply: true,
          urgency: 'high',
          lastClientMessage: {
            who: 'Dana',
            whenIso: iso(-3 * 60 * 60 * 1000),
            quote: 'Can you send the revised deck?'
          },
          openQuestions: ['What is the launch date?', 'Who signs off?']
        },
        blockers: [{ what: 'Waiting on API key', sinceIso: iso(-2 * 24 * 60 * 60 * 1000) }]
      })
    )
    expect(waiting.count).toBe(3)
    expect(waiting.oldestIso).toBe(iso(-2 * 24 * 60 * 60 * 1000))
    expect(waiting.items.map((item) => item.kind)).toEqual([
      'needs-reply',
      'question',
      'question',
      'blocker'
    ])
    expect(waiting.blockers).toBe(1)
    expect(waiting.risks).toBe(0)
  })

  it('dedupes a question that is also the needs-reply message', () => {
    const waiting = buildWaiting(
      insight({
        clientAsk: {
          needsReply: true,
          urgency: 'high',
          lastClientMessage: {
            who: 'Dana',
            whenIso: iso(-60 * 60 * 1000),
            quote: '  When is the LAUNCH?  '
          },
          openQuestions: ['when is the launch']
        }
      })
    )
    expect(waiting.count).toBe(1)
    expect(waiting.items.map((item) => item.kind)).toEqual(['needs-reply'])
  })

  it('keeps blockers and risks out of the count but reports them separately', () => {
    const waiting = buildWaiting(
      insight({
        clientAsk: {
          needsReply: false,
          urgency: 'normal',
          lastClientMessage: null,
          openQuestions: ['Who signs off?']
        },
        blockers: [{ what: 'No API key' }, { what: 'No staging access' }],
        risks: ['Budget approval slips']
      })
    )
    expect(waiting.count).toBe(1)
    expect(waiting.blockers).toBe(2)
    expect(waiting.risks).toBe(1)
    expect(waiting.items.map((item) => item.kind)).toEqual([
      'question',
      'blocker',
      'blocker',
      'risk'
    ])
  })

  it('leaves age unknown when no item has a real timestamp', () => {
    const waiting = buildWaiting(
      insight({
        clientAsk: {
          needsReply: true,
          urgency: 'normal',
          lastClientMessage: null,
          openQuestions: ['q1']
        }
      })
    )
    expect(waiting.count).toBe(2)
    expect(waiting.oldestIso).toBeNull()
  })

  it('caps the list at five rows', () => {
    const waiting = buildWaiting(
      insight({
        clientAsk: {
          needsReply: false,
          urgency: 'normal',
          lastClientMessage: null,
          openQuestions: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']
        }
      })
    )
    expect(waiting.count).toBe(6)
    expect(waiting.items).toHaveLength(5)
  })
})

describe('dashboard metrics — history', () => {
  it('only returns a mood trend after three recorded runs', () => {
    const two = [
      historyEntry(iso(-60 * 60 * 1000), insight({ mood: 'neutral' })),
      historyEntry(iso(-2 * 60 * 60 * 1000), insight({ mood: 'good' }))
    ]
    expect(buildMoodTrend(two)).toEqual([])
    const three = [...two, historyEntry(iso(-3 * 60 * 60 * 1000), insight({ mood: 'tense' }))]
    expect(buildMoodTrend(three).map((point) => point.mood)).toEqual<InsightMood[]>([
      'tense',
      'good',
      'neutral'
    ])
  })

  it('diffs requirements and questions against the last viewed insight', () => {
    const baseline = historyEntry(
      iso(-2 * 60 * 60 * 1000),
      insight({ requirements: [{ text: 'Old ask' }] as ProjectInsight['requirements'] })
    )
    const current = historyEntry(
      iso(-30 * 60 * 1000),
      insight({
        requirements: [{ text: 'Old ask' }, { text: 'New ask' }] as ProjectInsight['requirements'],
        clientAsk: {
          needsReply: false,
          urgency: 'normal',
          lastClientMessage: null,
          openQuestions: ['New question?']
        }
      }),
      'on-track'
    )
    const diff = buildNewSince(current.insight, [current, baseline], iso(-60 * 60 * 1000))
    expect(diff.lastViewedAt).toBe(iso(-60 * 60 * 1000))
    expect(diff.counts.requirements).toBe(1)
    expect(diff.counts.questions).toBe(1)
    expect(diff.items.map((item) => item.kind)).toEqual(['requirement', 'question'])
  })

  it('shows nothing on a first visit rather than pretending everything is new', () => {
    const current = historyEntry(iso(-30 * 60 * 1000), insight({ requirements: [] }))
    const diff = buildNewSince(current.insight, [current], null)
    expect(diff.lastViewedAt).toBeNull()
    expect(diff.counts).toEqual({
      requirements: 0,
      decisions: 0,
      commitments: 0,
      files: 0,
      statusChanges: 0,
      questions: 0
    })
  })

  it('shows nothing when no baseline insight existed at the last visit', () => {
    const current = historyEntry(iso(-30 * 60 * 1000), insight({}))
    const diff = buildNewSince(current.insight, [current], iso(-60 * 60 * 1000))
    expect(diff.items).toEqual([])
    expect(Object.values(diff.counts).every((n) => n === 0)).toBe(true)
  })

  it('counts status changes recorded after the visit', () => {
    const baseline = historyEntry(iso(-3 * 60 * 60 * 1000), insight({ status: 'on-track' }))
    const current = historyEntry(iso(-30 * 60 * 1000), insight({ status: 'at-risk' }), 'on-track')
    const diff = buildNewSince(current.insight, [current, baseline], iso(-2 * 60 * 60 * 1000))
    expect(diff.counts.statusChanges).toBe(1)
    expect(diff.items[0]).toMatchObject({ kind: 'status', atIso: iso(-30 * 60 * 1000) })
  })
})

describe('dashboard metrics — shape', () => {
  it('computes the whole block without inventing response numbers', () => {
    const metrics = computeMetrics({
      project: project(),
      messages: [msg(-60 * 60 * 1000, 'U_CLIENT')],
      insight: null,
      history: [],
      lastViewedAt: null,
      now: NOW
    })
    expect(metrics.daily).toHaveLength(14)
    expect(metrics.ourResponse.medianSeconds).toBeNull()
    expect(metrics.waiting.items).toEqual([])
    expect(metrics.moodTrend).toEqual([])
    expect(metrics.newSince.items).toEqual([])
  })
})

describe('DashboardViewedStore', () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  it('persists one timestamp per project and survives a restart', async () => {
    dir = await mkdtemp(join(tmpdir(), 'orbit-views-'))
    const store = new DashboardViewedStore({ rootDir: dir })
    expect(await store.get('p1')).toBeNull()
    const at = '2026-10-25T10:00:00.000Z'
    await store.markViewed('p1', at)
    await store.markViewed('p2', '2026-10-25T11:00:00.000Z')
    expect(await store.get('p1')).toBe(at)

    const reopened = new DashboardViewedStore({ rootDir: dir })
    expect(await reopened.get('p1')).toBe(at)
    expect(await reopened.get('p2')).toBe('2026-10-25T11:00:00.000Z')

    await reopened.clear('p1')
    expect(await reopened.get('p1')).toBeNull()
    expect(await reopened.get('p2')).not.toBeNull()
  })
})
