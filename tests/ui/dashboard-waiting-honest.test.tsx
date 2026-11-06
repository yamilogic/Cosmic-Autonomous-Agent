// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { richActivity, richSnapshot } from '../../src/renderer/src/demo/fixtures'
import type {
  DashboardAttentionItem,
  DashboardMetrics,
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

function installApi(): void {
  setDashboardApi({
    getSchedules: vi.fn(async () => schedules),
    onSchedulesChanged: vi.fn(() => () => undefined),
    getProjectChatStatus: vi.fn(async () => ({
      hasKey: true,
      model: 'demo-model',
      modelSource: 'global',
      keySource: 'global'
    })),
    onConfigChanged: vi.fn(() => () => undefined),
    getProjectActivity: vi.fn(async () => richActivity)
  } as unknown as IpcApi['dashboard'])
}

type OnSelect = (selection: SelectionId) => void

function renderPage(snapshot: DashboardProjectSnapshot, onSelect: OnSelect): void {
  render(
    <DashboardPage
      view={buildCardView(snapshot, 0)}
      summary={buildCardSummary(snapshot, 0)}
      project={snapshot.project}
      snapshot={snapshot}
      syncing={false}
      onSync={vi.fn()}
      onOpenSettings={vi.fn()}
      onSelect={onSelect}
    />
  )
}

function waitingMetrics(
  overrides: Partial<DashboardMetrics['waiting']>,
  base: DashboardMetrics = richSnapshot.metrics!
): DashboardMetrics {
  return { ...base, waiting: { ...base.waiting, ...overrides } }
}

beforeEach(() => {
  clearMessageJump()
  installApi()
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

describe('DashboardPage — waiting honesty and jumpable chips', () => {
  it('shows — and "Not enough info" instead of a fake zero when metrics are absent', () => {
    const snapshot: DashboardProjectSnapshot = { ...richSnapshot, metrics: undefined }
    renderPage(snapshot, vi.fn<OnSelect>())

    const tile = screen.getByText('Waiting on you').closest('.dash-tile') as HTMLElement
    expect(within(tile).getByText('—')).toBeTruthy()
    expect(within(tile).getByText('Not enough info')).toBeTruthy()
    expect(tile.textContent).not.toContain('0')
    expect(screen.queryByRole('region', { name: 'Needs your attention' })).toBeNull()
  })

  it('does not claim an all-clear in the empty state when waiting metrics are absent', () => {
    // a snapshot stored before the waiting block existed
    const legacy = {
      ...richSnapshot.metrics!,
      waiting: undefined
    } as unknown as DashboardMetrics
    const snapshot: DashboardProjectSnapshot = { ...richSnapshot, metrics: legacy }
    renderPage(snapshot, vi.fn<OnSelect>())

    const attention = screen.getByRole('region', { name: 'Needs your attention' })
    expect(within(attention).getByText('Not enough info.')).toBeTruthy()
    expect(within(attention).queryByText('Nothing needs you right now.')).toBeNull()
  })

  it('keeps the progress tile honest when the insight has no evidence', () => {
    const snapshot: DashboardProjectSnapshot = {
      ...richSnapshot,
      insight: { ...richSnapshot.insight!, progressEvidence: '' }
    }
    renderPage(snapshot, vi.fn<OnSelect>())

    expect(buildCardSummary(snapshot, 0).progress).toBeNull()
    const tile = screen.getByText('Progress').closest('.dash-tile') as HTMLElement
    expect(tile.querySelector('.dash-kpi-value')?.textContent).toBe('—')
    expect(within(tile).getByText('not stated in chat')).toBeTruthy()
  })

  it('jumps to the message from a source chip when the item can jump', () => {
    const item: DashboardAttentionItem = {
      kind: 'needs-reply',
      text: 'Priya asked whether SSO can land before Friday.',
      atIso: richSnapshot.metrics!.waiting.items[0].atIso,
      source: 'client',
      channelId: 'C_AURORA',
      ts: '100.3',
      canJump: true
    }
    const snapshot: DashboardProjectSnapshot = {
      ...richSnapshot,
      metrics: waitingMetrics({ count: 1, items: [item] })
    }
    const onSelect = vi.fn<OnSelect>()
    renderPage(snapshot, onSelect)

    const attention = screen.getByRole('region', { name: 'Needs your attention' })
    const chip = within(attention).getByRole('button', { name: 'Client Slack' })
    fireEvent.click(chip)
    expect(onSelect).toHaveBeenCalledWith('c:client:C_AURORA')
    expect(takeMessageJump('demo-rich', 'client', 'C_AURORA')).toBe('100.3')
  })

  it('keeps a non-jumpable row on a plain, non-interactive chip', () => {
    const item: DashboardAttentionItem = {
      kind: 'question',
      text: 'Which environments need the new login flow?',
      source: 'client',
      channelId: 'unknown',
      canJump: false
    }
    const snapshot: DashboardProjectSnapshot = {
      ...richSnapshot,
      metrics: waitingMetrics({ count: 1, items: [item] })
    }
    renderPage(snapshot, vi.fn<OnSelect>())

    const attention = screen.getByRole('region', { name: 'Needs your attention' })
    expect(within(attention).getByText('Client Slack').tagName).toBe('SPAN')
    expect(within(attention).queryByRole('button', { name: 'Client Slack' })).toBeNull()
  })
})
