// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CompactCard from '../../src/renderer/src/components/dashboard/CompactCard'
import type { CardSummary } from '../../src/renderer/src/components/dashboard/card-view'

afterEach(cleanup)

function summary(overrides: Partial<CardSummary> = {}): CardSummary {
  return {
    projectId: 'p1',
    index: 0,
    name: 'Acme rollout',
    workspaceName: 'Acme Team',
    clientName: 'Acme',
    status: 'on-track',
    needsReply: false,
    inactive: false,
    urgency: 'normal',
    situationLine: 'Waiting on the client',
    justChanged: '',
    nextStep: '',
    progress: null,
    dates: { badge: 'not stated in chat' },
    pace: 'on-pace',
    paceLabel: 'On pace',
    week: [],
    lastClientAt: new Date().toISOString(),
    myLastReplyAt: null,
    counts: { questions: 0, blockers: 0, risks: 0, files: 0, requirements: 0 },
    score: 0,
    aiBadge: 'no insight yet',
    syncedLabel: 'synced now',
    ...overrides
  }
}

const noop = (): void => undefined

function renderCard(
  overrides: Partial<CardSummary>,
  props: Partial<{
    onToggle: () => void
    onTogglePin: () => void
    onSettings: () => void
    pinned: boolean
  }> = {}
): void {
  render(
    <CompactCard
      summary={summary(overrides)}
      onToggle={props.onToggle ?? noop}
      onSync={noop}
      onSettings={props.onSettings ?? noop}
      onRemove={noop}
      syncing={false}
      pinned={props.pinned}
      onTogglePin={props.onTogglePin}
    />
  )
}

describe('CompactCard progress', () => {
  it('shows a dash and an honest reason when progress is unknown', () => {
    renderCard({ progress: null })
    const meter = screen.getByTitle(/Progress not stated in chat/)
    expect(meter.textContent).toContain('—')
    expect(meter.textContent).toContain('Not enough info')
    expect(meter.textContent).not.toContain('%')
  })

  it('shows the real percentage when progress exists', () => {
    renderCard({ progress: 50 })
    const meter = screen.getByTitle(/50% complete/)
    expect(meter.textContent).toContain('50%')
  })

  it('shows the pace verdict only when dates and progress both exist', () => {
    renderCard({ progress: 40, daysUsed: 12, daysTotal: 30, paceLabel: 'On pace' })
    expect(screen.getByText('12 of 30 days')).toBeTruthy()
    expect(screen.getByText('On pace')).toBeTruthy()

    cleanup()
    renderCard({ progress: 40 })
    expect(screen.queryByText('On pace')).toBeNull()
  })
})

describe('CompactCard tiers', () => {
  it('renders only the evidence-backed Tier 2/3 fields it receives', () => {
    renderCard({
      ballInCourt: 'yours',
      medianReplySeconds: 5220,
      newSince: 3,
      deliverables: { done: 2, total: 5 },
      mood: 'tense',
      updatedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
      justChanged: 'Priya asked about SSO.',
      nextStep: 'Send the Friday plan.'
    })

    expect(screen.getByText('Your court')).toBeTruthy()
    expect(screen.getByText(/Reply 1h/)).toBeTruthy()
    expect(screen.getByText('3 new')).toBeTruthy()
    expect(screen.getByText('2/5 deliverables')).toBeTruthy()
    expect(screen.getByText('Tense')).toBeTruthy()
    expect(screen.getByText('Priya asked about SSO.')).toBeTruthy()
    expect(screen.getByText('Send the Friday plan.')).toBeTruthy()
    expect(screen.getByText(/Updated 4m/)).toBeTruthy()
  })

  it('hides the evidence rows when the data is missing', () => {
    renderCard({ progress: null })
    expect(screen.queryByText('Your court')).toBeNull()
    expect(screen.queryByText(/Reply /)).toBeNull()
    expect(screen.queryByText(/deliverables/)).toBeNull()
    expect(screen.queryByText('No messages this week')).toBeTruthy()
  })

  it('opens Settings from Add dates without expanding the card', () => {
    const onToggle = vi.fn()
    const onSettings = vi.fn()
    renderCard({}, { onToggle, onSettings })

    fireEvent.click(screen.getByRole('button', { name: 'Add dates' }))
    expect(onSettings).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('pins from the card header without toggling the card', () => {
    const onToggle = vi.fn()
    const onTogglePin = vi.fn()
    renderCard({}, { pinned: true, onToggle, onTogglePin })

    fireEvent.click(screen.getByRole('button', { name: 'Unpin Acme rollout' }))
    expect(onTogglePin).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('toggles when the card body is clicked or Enter is pressed', () => {
    const onToggle = vi.fn()
    renderCard({}, { onToggle })
    const card = screen.getByTestId('dash-card-0')
    fireEvent.click(card)
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(onToggle).toHaveBeenCalledTimes(2)
  })
})
