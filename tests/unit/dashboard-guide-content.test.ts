import { describe, expect, it } from 'vitest'
import type {
  CardCentre,
  CardLeftSidebar,
  CardRightSidebar
} from '../../src/renderer/src/components/dashboard/card-view'
import {
  buildInsightThread,
  detailMeta,
  guideComplete,
  guideHint
} from '../../src/renderer/src/components/dashboard/guide-model'

const emptyLeft = (): CardLeftSidebar => ({
  startTimeline: {
    startDate: undefined,
    endDate: undefined,
    dateBadge: 'not stated in chat',
    milestones: []
  },
  requirements: [],
  scopeDeliverables: { inScope: [], outOfScope: [], deliverables: [] },
  decisions: [],
  commitments: [],
  files: [],
  peopleChannels: { people: [], channels: [], quietChannelCount: 0 }
})

describe('guideHint / guideComplete', () => {
  it('reports empty timeline copy', () => {
    const left = emptyLeft()
    expect(guideHint(left, 1)).toBe('Dates not stated in chat')
    expect(guideComplete(left, 1)).toBe(false)
  })

  it('summarizes requirements and scope counts', () => {
    const left = emptyLeft()
    left.requirements = [{ text: 'Need dark mode' }]
    left.scopeDeliverables = {
      inScope: ['a', 'b'],
      outOfScope: [],
      deliverables: [{ name: 'MVP', status: 'pending' }]
    }
    expect(guideHint(left, 2)).toBe('1 requirement')
    expect(guideComplete(left, 2)).toBe(true)
    expect(guideHint(left, 3)).toBe('2 in · 0 out · 1 deliverable')
  })
})

describe('detailMeta', () => {
  it('counts needs-reply and open questions', () => {
    const right: CardRightSidebar = {
      needsReplyOpenQuestions: {
        needsReply: true,
        urgency: 'high',
        openQuestions: ['Confirm launch date?'],
        lastClientMessage: null
      },
      blockers: [{ what: 'Waiting on assets' }],
      risks: [],
      nextSteps: ['Reply today'],
      moodSignals: { mood: 'neutral', moodReason: 'brief', moodQuote: '' },
      activity: { messages24h: 2, messages7d: 9, lastClientMessage: null, myLastReply: null },
      history: []
    }
    expect(detailMeta(right, 'needs-reply')).toEqual({
      count: 2,
      summary: 'Confirm launch date?'
    })
    expect(detailMeta(right, 'blockers').count).toBe(1)
    expect(detailMeta(right, 'risks').summary).toBe('None')
  })
})

describe('buildInsightThread', () => {
  it('only uses real centre fields', () => {
    const centre: CardCentre = {
      status: 'waiting-on-client',
      statusReason: '',
      statusChange: '',
      situationLine: 'Client paused the kickoff.',
      recentLine: '',
      highlights: [
        { what: 'Said no to the proposal', who: 'Utkarsh', whenIso: '2026-10-21T12:00:00Z' }
      ],
      lastClientMessage: { who: 'Utkarsh', whenIso: '2026-10-21T12:00:00Z', quote: 'no' },
      needsReply: true,
      urgency: 'high',
      openQuestions: [],
      nextStep: 'Ask why they said no',
      visuals: {
        progressPercent: 0,
        timeElapsed: { hasDates: false, pace: 'on-pace', paceLabel: 'Dates not stated in chat' },
        sevenDayBars: []
      }
    }
    const thread = buildInsightThread(centre, 'Testing01')
    expect(thread.map((m) => m.body)).toEqual([
      'no',
      'Said no to the proposal',
      'Client paused the kickoff.',
      'Next step: Ask why they said no'
    ])
    expect(thread.every((m) => m.who.length > 0)).toBe(true)
  })

  it('returns empty when there is no evidence', () => {
    const centre: CardCentre = {
      status: null,
      statusReason: '',
      statusChange: '',
      situationLine: '',
      recentLine: '',
      highlights: [],
      lastClientMessage: null,
      needsReply: false,
      urgency: 'normal',
      openQuestions: [],
      nextStep: '',
      visuals: {
        progressPercent: 0,
        timeElapsed: { hasDates: false, pace: 'on-pace', paceLabel: 'Dates not stated in chat' },
        sevenDayBars: []
      }
    }
    expect(buildInsightThread(centre, 'X')).toEqual([])
  })
})
