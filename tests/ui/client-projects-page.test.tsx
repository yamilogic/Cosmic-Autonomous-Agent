// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardView from '../../src/renderer/src/components/dashboard/DashboardView'
import RecentStrip from '../../src/renderer/src/components/dashboard/RecentStrip'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'
import { richSnapshot } from '../../src/renderer/src/demo/fixtures'
import type { DashboardSnapshot, RecentActivity } from '../../src/shared/dashboard-contract'

const RECENT: RecentActivity = {
  projectId: 'demo-rich',
  projectName: 'Aurora storefront',
  teamName: 'Northwind Retail',
  channelName: 'aurora-build',
  who: 'Priya',
  text: 'Can SSO make Friday?',
  ts: '2026-10-26T09:00:00Z',
  kind: 'client-question',
  needsReply: true,
  status: 'at-risk',
  score: 90,
  oneLine: 'Priya asked whether SSO can land before Friday.',
  hoursSinceLastMessage: 3
}

const off = (): void => undefined

function installApi(
  pinnedOrder: string[] = [],
  options: { paused?: boolean } = {}
): {
  setPinnedOrder: ReturnType<typeof vi.fn>
} {
  const snapshot: DashboardSnapshot = {
    projects: [richSnapshot],
    manualTokens: [],
    syncIntervalSeconds: 300,
    pinnedOrder
  }
  const setPinnedOrder = vi.fn(async ({ order }: { order: string[] }) => ({
    ...snapshot,
    pinnedOrder: order
  }))
  window.api = {
    dashboard: {
      getSnapshot: vi.fn(async () => snapshot),
      getRecent: vi.fn(async () => [RECENT]),
      getGlobalConfig: vi.fn(async () => null),
      getSchedules: vi.fn(async () => ({
        settings: { slackSync: { enabled: !options.paused } }
      })),
      setPinnedOrder,
      syncNow: vi.fn(async () => undefined),
      listChannels: vi.fn(async () => []),
      getTeamWorkspace: vi.fn(async () => null),
      getProjectChatStatus: vi.fn(async () => {
        throw new Error('not configured')
      }),
      getProjectChatHistory: vi.fn(async () => {
        throw new Error('not configured')
      }),
      getProjectActivity: vi.fn(async () => ({
        recent: [],
        latestClientAt: null,
        latestOursAt: null,
        ballInCourt: null,
        participants: [],
        channels: [],
        counts14d: { client: 0, ours: 0 }
      })),
      onProjectChatChunk: vi.fn(() => off),
      onProjectChatDone: vi.fn(() => off),
      onProjectChatError: vi.fn(() => off),
      onSnapshotChanged: vi.fn(() => off),
      onSyncProgress: vi.fn(() => off),
      onConfigChanged: vi.fn(() => off),
      onSchedulesChanged: vi.fn(() => off)
    }
  } as unknown as Window['api']
  return { setPinnedOrder }
}

function resetStore(pinnedOrder: string[] = []): void {
  useDashboardStore.setState({
    snapshot: {
      projects: [richSnapshot],
      manualTokens: [],
      syncIntervalSeconds: 300,
      pinnedOrder
    },
    recent: [RECENT],
    loading: false,
    syncingProjectIds: [],
    progress: null,
    error: null,
    wizardOpenFor: null
  })
}

beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

describe('Client projects page', () => {
  it('has a direct Sync all after the view switcher and no “…” menu', async () => {
    installApi()
    resetStore()
    render(<DashboardView />)
    await screen.findByTestId('dashboard-view')

    const switcher = screen.getByRole('group', { name: 'View mode' })
    const sync = screen.getByTestId('sync-all')
    expect(sync.textContent).toContain('Sync all')
    expect(switcher.compareDocumentPosition(sync) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByLabelText('Dashboard actions')).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Collapse all' })).toBeNull()
  })

  it('pins and unpins through the main-process order', async () => {
    const { setPinnedOrder } = installApi()
    resetStore()
    const first = render(<DashboardView />)
    await screen.findByTestId('dashboard-view')

    fireEvent.click(screen.getByRole('button', { name: 'Pin Aurora storefront' }))
    await waitFor(() => expect(setPinnedOrder).toHaveBeenCalledWith({ order: ['demo-rich'] }))

    first.unmount()
    const second = installApi(['demo-rich'])
    resetStore(['demo-rich'])
    render(<DashboardView />)
    await screen.findByTestId('dashboard-view')

    const pinned = screen.getByTestId('dash-pinned')
    expect(within(pinned).getByRole('button', { name: 'Reorder Aurora storefront' })).toBeTruthy()
    fireEvent.click(within(pinned).getByRole('button', { name: 'Unpin Aurora storefront' }))
    await waitFor(() => expect(second.setPinnedOrder).toHaveBeenCalledWith({ order: [] }))
  })

  it('counts and filters only unpinned projects', async () => {
    installApi()
    resetStore()
    render(<DashboardView />)
    await screen.findByTestId('dashboard-view')

    expect(screen.getByRole('button', { name: /^All\s*1$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Urgent\s*1$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Inactive 24h\+\s*0$/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Inactive 24h\+/ }))
    expect(screen.getByText('Nothing matches this filter.')).toBeTruthy()
    expect(localStorage.getItem('orbit.filter')).toBe('inactive')

    fireEvent.click(screen.getByRole('button', { name: /^Urgent/ }))
    expect(screen.getByTestId('dash-grid').textContent).toContain('Aurora storefront')
  })

  it('shows sync progress, the paused hint and one muted error line', async () => {
    installApi([], { paused: true })
    resetStore()
    useDashboardStore.setState({
      progress: {
        projectIds: ['demo-rich'],
        syncing: true,
        current: 2,
        total: 5,
        projectId: null,
        phase: 'syncing'
      },
      syncingProjectIds: ['demo-rich']
    })
    render(<DashboardView />)
    await screen.findByTestId('dashboard-view')

    const sync = screen.getByTestId('sync-all') as HTMLButtonElement
    expect(sync.disabled).toBe(true)
    expect(sync.textContent).toContain('Syncing 2/5')
    await waitFor(() => expect(screen.getByText('Schedule paused')).toBeTruthy())

    act(() => useDashboardStore.setState({ error: 'network down' }))
    expect(screen.getByRole('alert').textContent).toContain('Sync failed: network down')
    expect(screen.getByTestId('dashboard-view')).toBeTruthy()
  })

  it('expands and focuses a project when its Recent card is clicked', async () => {
    installApi()
    resetStore()
    const { container } = render(<DashboardView />)
    await screen.findByTestId('dashboard-view')
    await screen.findByText('Reply owed')

    const recentCard = container.querySelector('.dash-recent-card') as HTMLElement
    fireEvent.click(recentCard)

    await waitFor(() => expect(container.querySelector('.ws-head')).not.toBeNull())
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
  })

  it('opens the clicked card from Compact by switching to Mixed', async () => {
    installApi()
    resetStore()
    const { container } = render(<DashboardView />)
    await screen.findByTestId('dashboard-view')

    fireEvent.click(screen.getByRole('button', { name: 'Compact' }))
    expect(container.querySelector('.ws-head')).toBeNull()

    fireEvent.click(screen.getByTestId('dash-card-0'))
    await waitFor(() => expect(container.querySelector('.ws-head')).not.toBeNull())
    await waitFor(() => expect(localStorage.getItem('orbit.view')).toBe('mixed'))
    expect(screen.getByRole('button', { name: 'Mixed' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('renders the Recent rail with the pinned marker and opens on click', async () => {
    installApi()
    resetStore()
    const onOpen = vi.fn()
    const { container } = render(
      <RecentStrip items={[RECENT]} pinnedIds={new Set(['demo-rich'])} onOpen={onOpen} />
    )

    const card = screen.getByRole('button', { name: 'Open Aurora storefront' })
    expect(card.textContent).toContain('Reply owed')
    expect(card.textContent).toContain('3h')
    expect(container.querySelector('.dash-recent-pin')).not.toBeNull()
    expect(container.querySelector('.dash-recent-new')).toBeNull()
    fireEvent.click(card)
    expect(onOpen).toHaveBeenCalledWith('demo-rich')
  })

  it('marks a Recent card that changed since the last visit', () => {
    const { container } = render(
      <RecentStrip
        items={[{ ...RECENT, newMessages: 2 }]}
        pinnedIds={new Set()}
        onOpen={() => undefined}
      />
    )
    expect(container.querySelector('.dash-recent-new')).not.toBeNull()
    expect(screen.getByLabelText('New since your last visit')).toBeTruthy()
  })
})
