import { describe, expect, it } from 'vitest'
import { buildWaiting } from '../../src/main/dashboard/metrics'
import type { ProjectInsight } from '../../src/shared/dashboard-contract'

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

describe('buildWaiting — jumpable message anchors', () => {
  it('never leaks an ISO date into ts and marks an ISO-only blocker anchor not jumpable', () => {
    const waiting = buildWaiting(
      insight({
        blockers: [{ what: 'No API key', sinceIso: '2026-10-20T08:00:00.000Z' }]
      })
    )
    const blocker = waiting.items.find((item) => item.kind === 'blocker')
    expect(blocker).toBeTruthy()
    expect(blocker!.atIso).toBe('2026-10-20T08:00:00.000Z')
    expect(blocker!.ts).toBeUndefined()
    expect(blocker!.canJump).toBe(false)
    for (const item of waiting.items) {
      expect(item.ts ?? '').not.toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
  })

  it('marks a needs-reply row with a real Slack ts and channel jumpable', () => {
    const waiting = buildWaiting(
      insight({
        clientAsk: {
          needsReply: true,
          urgency: 'high',
          lastClientMessage: {
            who: 'Dana',
            whenIso: '2026-10-24T10:00:00.000Z',
            quote: 'Any update on the mockups?',
            source: 'client',
            channelId: 'C1',
            ts: '1788419300.000001'
          },
          openQuestions: []
        }
      })
    )
    const item = waiting.items[0]
    expect(item.kind).toBe('needs-reply')
    expect(item.ts).toBe('1788419300.000001')
    expect(item.canJump).toBe(true)
  })

  it('drops the fabricated anchor from question and risk rows when no real message backs them', () => {
    const waiting = buildWaiting(
      insight({
        clientAsk: {
          needsReply: false,
          urgency: 'normal',
          lastClientMessage: null,
          openQuestions: ['Who signs off?']
        },
        risks: ['Budget approval slips']
      })
    )
    expect(waiting.items.map((item) => item.kind)).toEqual(['question', 'risk'])
    for (const item of waiting.items) {
      expect(item.ts).toBeUndefined()
      expect(item.canJump).toBe(false)
    }
  })

  it('refuses to jump when the channel id is unknown even with a real ts', () => {
    const waiting = buildWaiting(
      insight({
        clientAsk: {
          needsReply: false,
          urgency: 'normal',
          lastClientMessage: {
            who: 'Dana',
            whenIso: null,
            quote: '',
            ts: '1788419300.000001'
          },
          openQuestions: ['Who signs off?']
        },
        blockers: [{ what: 'No key' }]
      })
    )
    for (const item of waiting.items) {
      expect(item.channelId).toBe('unknown')
      expect(item.canJump).toBe(false)
    }
  })

  it('marks blocker rows jumpable when the anchor carries a real channel and Slack ts', () => {
    const waiting = buildWaiting(
      insight({
        clientAsk: {
          needsReply: false,
          urgency: 'normal',
          lastClientMessage: {
            who: 'Dana',
            whenIso: '2026-10-24T10:00:00.000Z',
            quote: 'q',
            source: 'ours',
            channelId: 'C9',
            ts: '1788419300.000001'
          },
          openQuestions: []
        },
        blockers: [{ what: 'No API key', sinceIso: '2026-10-20T08:00:00.000Z' }]
      })
    )
    const blocker = waiting.items.find((item) => item.kind === 'blocker')
    expect(blocker!.ts).toBe('1788419300.000001')
    expect(blocker!.atIso).toBe('2026-10-20T08:00:00.000Z')
    expect(blocker!.canJump).toBe(true)
  })
})
