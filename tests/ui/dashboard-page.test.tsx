// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import DashboardPage from '../../src/renderer/src/components/dashboard/DashboardPage'
import {
  buildCardSummary,
  buildCardView
} from '../../src/renderer/src/components/dashboard/card-view'
import {
  clearMessageJump,
  takeMessageJump
} from '../../src/renderer/src/components/dashboard/jump-to-message'
import type { SelectionId } from '../../src/renderer/src/components/dashboard/workspace-nav'
import { setDashboardApi } from '../../src/renderer/src/lib/dashboard-api'
import {
  emptyActivity,
  richActivity,
  richSnapshot,
  sparseSnapshot
} from '../../src/renderer/src/demo/fixtures'
import type {
  DashboardProjectActivity,
  DashboardProjectSnapshot,
  DashboardSchedulesState
} from '../../src/shared/dashboard-contract'
import type { IpcApi } from '../../src/shared/ipc-contract'

const schedules: DashboardSchedulesState = {
  settings: {
    slackSync: { enabled: true, intervalMinutes: 15 },
    dailyRecheck: { enabled: false, hour: 9 }
  },
  lastRunAt: { 'slack-sync': null, 'agent-analysis': null, 'daily-recheck': null },
  nextRunAt: null,
  nextDailyRunAt: null,
  running: false,
  runs: []
}

function installApi(
  options: {
    hasKey?: boolean
    activity?: DashboardProjectActivity
    nextRunAt?: string | null
  } = {}
): {
  getProjectActivity: ReturnType<typeof vi.fn>
} {
  const getProjectActivity = vi.fn(async () => options.activity ?? richActivity)
  setDashboardApi({
    getSchedules: vi.fn(async () => ({
      ...schedules,
      nextRunAt: options.nextRunAt ?? schedules.nextRunAt
    })),
    onSchedulesChanged: vi.fn(() => () => undefined),
    getProjectChatStatus: vi.fn(async () => ({
      hasKey: options.hasKey ?? true,
      model: 'demo-model',
      modelSource: 'global',
      keySource: 'global'
    })),
    onConfigChanged: vi.fn(() => () => undefined),
    getProjectActivity
  } as unknown as IpcApi['dashboard'])
  return { getProjectActivity }
}

function renderPage(
  snapshot: DashboardProjectSnapshot,
  overrides: {
    onSelect?: Mock<(selection: SelectionId) => void>
    onOpenSettings?: Mock<() => void>
  } = {}
): void {
  const onSelect = vi.fn<(selection: SelectionId) => void>()
  const onOpenSettings = vi.fn<() => void>()
  render(
    <DashboardPage
      view={buildCardView(snapshot, 0)}
      summary={buildCardSummary(snapshot, 0)}
      project={snapshot.project}
      snapshot={snapshot}
      syncing={false}
      onSync={vi.fn()}
      onOpenSettings={overrides.onOpenSettings ?? onOpenSettings}
      onSelect={overrides.onSelect ?? onSelect}
    />
  )
}

beforeEach(() => {
  clearMessageJump()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  })
})

afterEach(() => {
  cleanup()
  setDashboardApi(null)
})

describe('DashboardPage — rich data', () => {
  it('renders the centre widgets with real totals and a court chip rule', async () => {
    installApi()
    renderPage(richSnapshot)

    expect(screen.getByText('Where it stands')).toBeTruthy()
    expect(screen.getByText(richSnapshot.insight!.situationLine)).toBeTruthy()

    const court = await screen.findByTestId('dash-court')
    expect(court.textContent).toBe('Ball in client’s court')
    expect(court.getAttribute('title')).toBe(
      'Rule: our team replied after the client’s newest message.'
    )

    const activity = screen.getByRole('region', { name: 'Activity' })
    expect(within(activity).getByText('Client · 52')).toBeTruthy()
    expect(within(activity).getByText('Ours · 25')).toBeTruthy()
    expect(within(activity).getByText('77 in 14d')).toBeTruthy()

    expect(screen.getByRole('region', { name: 'Time, pace and mood' })).toBeTruthy()
    expect(screen.getByText('Time and pace')).toBeTruthy()
    expect(screen.getByText('Mood trend')).toBeTruthy()

    const latest = await screen.findByRole('region', { name: 'Latest messages' })
    await waitFor(() => expect(within(latest).getAllByRole('listitem')).toHaveLength(6))
    expect(within(latest).getAllByText('Maya Chen')).toHaveLength(2)
    expect(within(latest).getAllByText('#aurora-build')).toHaveLength(2)
    expect(within(latest).getAllByText('Client Slack')).toHaveLength(3)
    expect(within(latest).getAllByText('Our Slack')).toHaveLength(3)
  })

  it('jumps to the correct source channel from a message row', async () => {
    installApi()
    const onSelect = vi.fn<(selection: SelectionId) => void>()
    renderPage(richSnapshot, { onSelect })
    const latest = await screen.findByRole('region', { name: 'Latest messages' })
    await waitFor(() => expect(within(latest).getAllByRole('listitem')).toHaveLength(6))

    const ourRow = within(latest)
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('Pushed the SSO fix'))
    expect(ourRow).toBeTruthy()
    fireEvent.click(ourRow!)
    expect(onSelect).toHaveBeenCalledWith('c:team:C_OURS')
    expect(takeMessageJump('demo-rich', 'ours', 'C_OURS')).toBe('200.9')

    const clientRow = within(latest)
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('Can SSO make Friday'))
    fireEvent.click(clientRow!)
    expect(onSelect).toHaveBeenCalledWith('c:client:C_AURORA')
    expect(takeMessageJump('demo-rich', 'client', 'C_AURORA')).toBe('100.3')
  })

  it('opens the client Slack tab from View all', async () => {
    installApi()
    const onSelect = vi.fn<(selection: SelectionId) => void>()
    renderPage(richSnapshot, { onSelect })
    const latest = await screen.findByRole('region', { name: 'Latest messages' })
    await waitFor(() => expect(within(latest).getAllByRole('listitem')).toHaveLength(6))

    fireEvent.click(within(latest).getByRole('button', { name: 'View all' }))
    expect(onSelect).toHaveBeenCalledWith('s:client')
  })

  it('caps attention at five rows and jumps with the item source', async () => {
    installApi()
    const onSelect = vi.fn<(selection: SelectionId) => void>()
    renderPage(richSnapshot, { onSelect })

    const attention = screen.getByRole('region', { name: 'Needs your attention' })
    expect(within(attention).getAllByRole('listitem')).toHaveLength(5)
    expect(within(attention).getByText('2 open')).toBeTruthy()
    expect(within(attention).queryByText('Launch stays on 8 Nov.')).toBeNull()

    const row = within(attention)
      .getByText('Priya asked whether SSO can land before Friday’s build.')
      .closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'Open' }))
    expect(onSelect).toHaveBeenCalledWith('c:client:C_AURORA')
    expect(takeMessageJump('demo-rich', 'client', 'C_AURORA')).toBe('100.3')
  })

  it('caps new-since rows at six and shows the real count chips', () => {
    installApi()
    renderPage(richSnapshot)

    const newSince = screen.getByRole('region', { name: 'New since your last visit' })
    expect(within(newSince).getAllByRole('listitem')).toHaveLength(6)
    expect(within(newSince).getByText('2 requirements')).toBeTruthy()
    expect(within(newSince).getByText('1 status changes')).toBeTruthy()
    expect(within(newSince).queryByText('Show order history on the account page.')).toBeNull()
  })

  it('lists the latest three client asks by recency', () => {
    installApi()
    renderPage(richSnapshot)

    const ask = screen.getByRole('region', { name: 'Client ask' })
    const rows = within(ask).getAllByRole('listitem')
    expect(rows.map((row) => row.querySelector('.dash-ask-text')?.textContent)).toEqual([
      'Move launch copy to the shared doc.',
      'Show order history on the account page.',
      'Add SSO to the Friday build.'
    ])
    expect(within(ask).getByText('4 total')).toBeTruthy()
    expect(within(ask).getByText('1 done')).toBeTruthy()
    expect(within(ask).getByText('2 in progress')).toBeTruthy()
  })

  it('shows the 14-day people and channels, and hides the finished checklist', async () => {
    installApi()
    renderPage(richSnapshot)

    const people = await screen.findByRole('region', { name: 'People and channels' })
    expect(within(people).getAllByRole('list')).toHaveLength(2)
    expect(within(people).getByText('Maya Chen')).toBeTruthy()
    expect(within(people).getByText('#project-aurora')).toBeTruthy()
    expect(within(people).getAllByText('9')).toHaveLength(1)

    expect(screen.queryByText('Finish setup')).toBeNull()
  })

  it('does not render Ask agent input, Ask button or suggestion chips, and keeps the freshness line and Sync button', async () => {
    installApi({ hasKey: true, nextRunAt: new Date(Date.now() + 180000).toISOString() })
    renderPage(richSnapshot)

    expect(screen.queryByLabelText('Ask agent about this project')).toBeNull()
    expect(screen.queryByPlaceholderText(/Ask agent/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Kitna complete hua?' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Kaun se blockers hain?' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Client ne last kya bola?' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next step kya hai?' })).toBeNull()

    expect(screen.getByRole('button', { name: 'Sync' })).toBeTruthy()
    const freshness = screen.getByTestId('dash-freshness')
    expect(freshness.textContent).toContain('Updated')
    await waitFor(() => expect(freshness.textContent).toContain('next sync in'))
  })
})

describe('DashboardPage — sparse data', () => {
  it('renders honest fallbacks and no empty widget boxes', async () => {
    const { getProjectActivity } = installApi({ hasKey: false, activity: emptyActivity })
    renderPage(sparseSnapshot)
    await waitFor(() => expect(getProjectActivity).toHaveBeenCalled())

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
    expect(screen.getByText('not stated in chat')).toBeTruthy()
    expect(screen.getAllByText('Not analysed yet')).toHaveLength(2)
    expect(screen.getByText('Not enough signals')).toBeTruthy()
    expect(screen.getByText('Needs 3+ replies to measure')).toBeTruthy()
    expect(screen.getByText('No message yet')).toBeTruthy()

    expect(screen.queryByRole('region', { name: 'Activity' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Time, pace and mood' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Latest messages' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'People and channels' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Needs your attention' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'New since your last visit' })).toBeNull()

    expect(screen.getByText('No requirements stated yet.')).toBeTruthy()
    expect(screen.queryByText('No deliverables stated yet.')).toBeNull()
  })

  it('shows the incomplete setup count and one muted line for empty asks', () => {
    installApi({ hasKey: false, activity: emptyActivity })
    renderPage(sparseSnapshot)

    expect(screen.getByText('Finish setup')).toBeTruthy()
    expect(screen.getByText('1 of 5')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add key' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add dates' })).toBeTruthy()
  })

  it('omits Ask agent input and chips when no AI key is configured while retaining Freshness line and setup checklist', async () => {
    installApi({ hasKey: false, activity: emptyActivity })
    const onOpenSettings = vi.fn<() => void>()
    renderPage(sparseSnapshot, { onOpenSettings })

    expect(screen.queryByLabelText('Ask agent about this project')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Kaun se blockers hain?' })).toBeNull()

    expect(screen.getByRole('button', { name: 'Sync' })).toBeTruthy()
    expect(screen.getByTestId('dash-freshness')).toBeTruthy()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add key' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Add key' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('hides "new since" when nothing is new', () => {
    installApi({ hasKey: false, activity: emptyActivity })
    renderPage(sparseSnapshot)
    expect(screen.queryByRole('region', { name: 'New since your last visit' })).toBeNull()
  })
})
