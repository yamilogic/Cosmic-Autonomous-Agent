// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import CentreContent from '../../src/renderer/src/components/dashboard/CentreContent'
import type { CardCentre } from '../../src/renderer/src/components/dashboard/card-view'

afterEach(cleanup)

const baseCentre: CardCentre = {
  status: 'at-risk',
  statusReason: 'Two client questions are waiting on us.',
  statusChange: 'on-track → at-risk',
  situationLine: 'Final QA is underway; two client questions are still open.',
  recentLine: 'Client asked whether SSO can land in Friday’s build.',
  nextStep: 'Confirm the SSO scope with Priya and send the Friday plan.',
  highlights: [
    { what: 'Draft review moved to final QA.', who: 'Maya Chen', whenIso: '2026-10-24T14:30:00Z' },
    { what: 'Launch copy approved.', who: 'Priya Nair', whenIso: '2026-10-23T09:00:00Z' },
    { what: 'SSO scope confirmed.', who: 'Priya Nair', whenIso: '2026-10-22T11:00:00Z' }
  ],
  lastClientMessage: {
    who: 'Priya Nair',
    whenIso: '2026-10-26T10:00:00Z',
    quote: 'Can SSO make Friday’s build?'
  },
  openQuestions: ['Can SSO make Friday’s build?', 'Which environments need the new login flow?'],
  needsReply: true,
  urgency: 'high',
  visuals: {
    progressPercent: 64,
    timeElapsed: {
      hasDates: true,
      startDate: '2026-10-01',
      endDate: '2026-11-08',
      daysUsed: 12,
      totalDays: 38,
      daysLeft: 26,
      progressPercent: 64,
      pace: 'behind',
      paceLabel: 'Behind pace'
    },
    sevenDayBars: [
      { date: '2026-10-20', count: 3, isToday: false },
      { date: '2026-10-21', count: 1, isToday: false },
      { date: '2026-10-22', count: 4, isToday: false },
      { date: '2026-10-23', count: 0, isToday: false },
      { date: '2026-10-24', count: 5, isToday: false },
      { date: '2026-10-25', count: 2, isToday: false },
      { date: '2026-10-26', count: 6, isToday: true }
    ]
  }
}

function renderContent(centre: CardCentre = baseCentre): void {
  render(<CentreContent centre={centre} />)
}

describe('CentreContent — summary', () => {
  it('renders situation line', () => {
    renderContent()
    expect(screen.getByText('Final QA is underway; two client questions are still open.')).toBeTruthy()
  })

  it('renders just changed line', () => {
    renderContent()
    expect(screen.getByText('Just changed')).toBeTruthy()
    expect(screen.getByText("Client asked whether SSO can land in Friday’s build.")).toBeTruthy()
  })

  it('renders next step', () => {
    renderContent()
    expect(screen.getByText('Next step')).toBeTruthy()
    expect(screen.getByText('Confirm the SSO scope with Priya and send the Friday plan.')).toBeTruthy()
  })
})

describe('CentreContent — highlights', () => {
  it('renders up to 3 highlights', () => {
    renderContent()
    expect(screen.getByText('Draft review moved to final QA.')).toBeTruthy()
    expect(screen.getByText('Launch copy approved.')).toBeTruthy()
    expect(screen.getByText('SSO scope confirmed.')).toBeTruthy()
  })

  it('shows who and when for each highlight', () => {
    renderContent()
    expect(screen.getByText('Maya Chen, Oct 24, 08:00 PM')).toBeTruthy()
    expect(screen.getByText('Priya Nair, Oct 23, 02:30 PM')).toBeTruthy()
  })
})

describe('CentreContent — last client message', () => {
  it('renders client message quote', () => {
    renderContent()
    expect(screen.getByText("“Can SSO make Friday’s build?”")).toBeTruthy()
  })

  it('shows Needs my reply and urgency', () => {
    renderContent()
    expect(screen.getByText('Needs my reply')).toBeTruthy()
    expect(screen.getByText('high urgency')).toBeTruthy()
  })

  it('shows open questions', () => {
    renderContent()
    expect(screen.getByText("Can SSO make Friday’s build?")).toBeTruthy()
    expect(screen.getByText('Which environments need the new login flow?')).toBeTruthy()
  })
})

describe('CentreContent — no client message', () => {
  it('shows empty state', () => {
    renderContent({
      ...baseCentre,
      lastClientMessage: null,
      openQuestions: [],
      needsReply: false
    })
    expect(screen.getByText('No client message yet')).toBeTruthy()
  })
})