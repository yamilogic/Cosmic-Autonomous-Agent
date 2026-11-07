// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import CentreVisuals from '../../src/renderer/src/components/dashboard/CentreVisuals'
import type { CardCentreVisuals } from '../../src/renderer/src/components/dashboard/card-view'

afterEach(cleanup)

const baseVisuals: CardCentreVisuals = {
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

function renderVisuals(visuals: CardCentreVisuals = baseVisuals): void {
  render(<CentreVisuals visuals={visuals} />)
}

describe('CentreVisuals — progress donut', () => {
  it('renders progress percentage in donut center', () => {
    renderVisuals()
    expect(screen.getByText('64%')).toBeTruthy()
  })

  it('has accessible role and label on donut', () => {
    renderVisuals()
    const donut = screen.getByRole('img', { name: 'Progress 64%' })
    expect(donut).toBeTruthy()
  })

  it('renders progress panel', () => {
    renderVisuals()
    expect(screen.getByText('Progress')).toBeTruthy()
  })
})

describe('CentreVisuals — time elapsed', () => {
  it('renders days used and days left', () => {
    renderVisuals()
    expect(screen.getByText('12 of 38 days used, 26 days left')).toBeTruthy()
  })

  it('renders pace verdict', () => {
    renderVisuals()
    expect(screen.getByText('Behind pace')).toBeTruthy()
  })

  it('renders start and end dates', () => {
    renderVisuals()
    expect(screen.getByText('Oct 1')).toBeTruthy()
    expect(screen.getByText('Nov 8')).toBeTruthy()
  })
})

describe('CentreVisuals — no dates', () => {
  it('shows dates not stated and Add dates button', () => {
    renderVisuals({
      ...baseVisuals,
      timeElapsed: {
        ...baseVisuals.timeElapsed,
        hasDates: false,
        startDate: undefined,
        endDate: undefined
      }
    })
    expect(screen.getByText('Dates not stated in chat')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add dates' })).toBeTruthy()
  })
})

describe('CentreVisuals — last 7 days', () => {
  it('renders activity bars for each day', () => {
    renderVisuals()
    const bars = screen.getAllByRole('img', { name: /Messages per day for the last 7 days/ })
    expect(bars.length).toBeGreaterThan(0)
  })

  it('marks today bar as today', () => {
    renderVisuals()
    const todayBars = screen.getAllByText('T')
    expect(todayBars.length).toBeGreaterThan(0)
    // The today bar should have the is-today class
    const todayBar = screen.getByTitle('Oct 26: 6 messages')
    expect(todayBar.className).toContain('is-today')
  })

  it('shows bar count labels', () => {
    renderVisuals()
    expect(screen.getByText('6')).toBeTruthy()
  })
})