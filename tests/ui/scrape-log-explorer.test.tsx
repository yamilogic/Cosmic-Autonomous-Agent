// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScrapeLogExplorer } from '../../src/renderer/src/components/dashboard/RunLogsModal'
import type { ScrapeRunLog } from '../../src/shared/dashboard-contract'

describe('ScrapeLogExplorer UI', () => {
  const mockRun: ScrapeRunLog = {
    runId: 'run-12345',
    ts: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    trigger: 'scheduled',
    projectId: 'proj-1',
    projectName: 'AgentWork Project',
    sourceId: 'src-1',
    sourceKind: 'token',
    workspaceId: 'T123',
    workspaceName: 'AgentWork',
    channelsRead: 2,
    messagesRead: 63,
    newMessages: 5,
    engineMode: 'direct_api',
    durationMs: 1200,
    llmCalls: 0,
    status: 'success',
    filters: { people: [], includeKinds: ['public', 'private', 'dm'] },
    window: { startTs: '1700000000', endTs: '1700021600', backfillHours: 6 },
    channels: [
      {
        channelId: 'C_WORK',
        channelName: 'agentworkprojecttesting',
        kind: 'private',
        messagesRead: 50,
        newMessages: 5,
        status: 'read',
        engineMode: 'direct_api'
      },
      {
        channelId: 'C_GRP',
        channelName: 'newtestinggrup',
        kind: 'private',
        messagesRead: 13,
        newMessages: 0,
        status: 'read',
        engineMode: 'direct_api'
      },
      {
        channelId: 'C_EMPTY_1',
        channelName: 'all-agentwork',
        kind: 'public',
        messagesRead: 0,
        newMessages: 0,
        status: 'skipped',
        skippedReason: 'not-selected'
      },
      {
        channelId: 'C_EMPTY_2',
        channelName: 'social',
        kind: 'public',
        messagesRead: 0,
        newMessages: 0,
        status: 'skipped',
        skippedReason: 'not-selected'
      },
      {
        channelId: 'C_EMPTY_3',
        channelName: '@Ashutosh',
        kind: 'dm',
        messagesRead: 0,
        newMessages: 0,
        status: 'skipped',
        skippedReason: 'dm-disabled'
      }
    ],
    people: [{ name: 'Ashutosh', messages: 63 }],
    snippets: [
      {
        channelId: 'C_WORK',
        channelName: 'agentworkprojecttesting',
        sender: 'Ashutosh',
        ts: '1793961716.782339',
        snippet: 'hello team!'
      }
    ]
  }

  beforeEach(() => {
    ;(window as any).api = {
      dashboard: {
        getScrapeRuns: vi.fn(async () => [mockRun]),
        cancelScrape: vi.fn(async () => undefined),
        onScrapeEvent: vi.fn(() => () => undefined)
      }
    }
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('hides 0-message skipped channels by default and reveals them on toggle', async () => {
    render(<ScrapeLogExplorer projectId="p-1" projectName="Ashutosh-Project-01" />)

    await act(async () => {
      await Promise.resolve()
    })

    // Channels with messages should be visible
    expect(screen.getByText('agentworkprojecttesting')).toBeTruthy()
    expect(screen.getByText('newtestinggrup')).toBeTruthy()

    // 0-message skipped channels should NOT be visible by default
    expect(screen.queryByText('all-agentwork')).toBeNull()
    expect(screen.queryByText('social')).toBeNull()

    // The "+3 skipped" toggle button should be present
    const toggleButton = screen.getByText('+3 skipped')
    expect(toggleButton).toBeTruthy()

    // Clicking the toggle button reveals all channels
    act(() => {
      fireEvent.click(toggleButton)
    })

    expect(screen.getByText('all-agentwork')).toBeTruthy()
    expect(screen.getByText('social')).toBeTruthy()
    expect(screen.getByText('Hide 0-read')).toBeTruthy()

    // Clicking again hides them back
    act(() => {
      fireEvent.click(screen.getByText('Hide 0-read'))
    })

    expect(screen.queryByText('all-agentwork')).toBeNull()
    expect(screen.getByText('+3 skipped')).toBeTruthy()
  })

  it('displays prominent scraping engine badges on the run card, audit bar, and channel list', async () => {
    render(<ScrapeLogExplorer projectId="p-1" projectName="Ashutosh-Project-01" />)

    await act(async () => {
      await Promise.resolve()
    })

    // Top audit bar engine badge
    expect(screen.getByText(/⚡ Direct API \(~150ms Zero-DOM\)/i)).toBeTruthy()

    // Channel list engine badge
    const directBadges = screen.getAllByText('⚡ Direct API')
    expect(directBadges.length).toBeGreaterThanOrEqual(1)

    // Message snippet should be visible for the pre-selected channel with messages
    expect(screen.getByText('hello team!')).toBeTruthy()
  })
})
