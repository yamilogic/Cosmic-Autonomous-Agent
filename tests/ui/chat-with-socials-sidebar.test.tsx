// @vitest-environment jsdom
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import WorkspaceSidebar from '../../src/renderer/src/components/dashboard/WorkspaceSidebar'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'
import { useProfileStore } from '../../src/renderer/src/hooks/useProfiles'
import type { CardView } from '../../src/renderer/src/components/dashboard/card-view'
import { DEFAULT_NAV, type ConnectorChannelLists } from '../../src/renderer/src/components/dashboard/workspace-nav'
import type { ProjectSource } from '../../src/shared/dashboard-contract'

describe('WorkspaceSidebar: Chat with Socials Dropdown', () => {
  const mockSources: ProjectSource[] = [
    {
      id: 'src-agentwork',
      kind: 'browser',
      platform: 'slack',
      profileId: 'prof-internal',
      workspaceId: 'T_AGENTWORK',
      workspaceName: 'AgentWork',
      channels: [{ id: 'C_INT', name: 'team-ops', enabled: true }],
      role: 'ours',
      enabled: true,
      backfillDays: 7,
      status: 'connected',
      scheduleEnabled: true,
      createdAt: '2026-11-06T10:00:00Z',
      updatedAt: '2026-11-06T10:00:00Z'
    },
    {
      id: 'src-slack-1',
      kind: 'browser',
      platform: 'slack',
      profileId: 'prof-1',
      workspaceId: 'T_CLIENT_SLACK',
      workspaceName: 'AgentWork', // Real team name detected by Slack partition
      channels: [{ id: 'C1', name: 'general', enabled: true }],
      role: 'client',
      enabled: true,
      backfillDays: 7,
      status: 'connected',
      scheduleEnabled: true,
      createdAt: '2026-11-06T10:00:00Z',
      updatedAt: '2026-11-06T10:00:00Z'
    },
    {
      id: 'src-teams-1',
      kind: 'browser',
      platform: 'teams',
      profileId: 'prof-1',
      workspaceId: 'T_TEAMS_ORG',
      workspaceName: 'Engineering Teams',
      channels: [{ id: 'TC1', name: 'dev', enabled: true }],
      role: 'client',
      enabled: true,
      backfillDays: 7,
      status: 'connected',
      createdAt: '2026-11-06T10:00:00Z',
      updatedAt: '2026-11-06T10:00:00Z'
    },
    {
      id: 'src-google-doc',
      kind: 'browser',
      platform: 'custom',
      url: 'https://docs.google.com/document/d/123',
      workspaceId: '',
      workspaceName: 'Google Doc Link',
      channels: [],
      role: 'client',
      enabled: true,
      backfillDays: 7,
      createdAt: '2026-11-06T10:00:00Z',
      updatedAt: '2026-11-06T10:00:00Z'
    }
  ]

  const mockView: CardView = {
    identity: {
      index: 0,
      name: 'Acme Project',
      clientName: 'Acme',
      teamName: 'Acme Workspace',
      progress: 50,
      progressEvidence: '',
      mood: 'good',
      moodReason: '',
      moodQuote: '',
      dates: { badge: 'not stated in chat' },
      channels: []
    },
    detail: {} as any,
    syncedLabel: 'just now',
    leftSidebar: {} as any,
    rightSidebar: {} as any,
    centre: {} as any,
    aiBadge: 'nemotron'
  }

  const mockChannels: ConnectorChannelLists = {
    team: { loading: false, error: null, entries: [] } as any,
    client: { loading: false, error: null, entries: [] } as any
  }

  beforeEach(() => {
    vi.clearAllMocks()
    window.api = {
      dashboard: {
        checkCardAuth: vi.fn().mockResolvedValue(true),
        getSnapshot: vi.fn().mockResolvedValue({ projects: [] })
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ sidebarLook: 'ancient' }),
        onSettingsChanged: vi.fn().mockReturnValue(() => {})
      }
    } as any

    useDashboardStore.setState({
      snapshot: { projects: [] } as any
    })
    useProfileStore.setState({
      profiles: []
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders Xomni with Chat with project, Talk to AgentWork untouched, and Chat with Socials', () => {
    const onSelect = vi.fn()
    render(
      <WorkspaceSidebar
        projectId="proj-1"
        sources={mockSources}
        view={mockView}
        nav={{ ...DEFAULT_NAV, openGroup: 'xomni', selection: 'm:project' }}
        channels={mockChannels}
        onOpenGroup={vi.fn()}
        onSelect={onSelect}
        onToggleSection={vi.fn()}
        onToggleInfoGroup={vi.fn()}
        onToggleConnector={vi.fn()}
        onToggleCollapse={vi.fn()}
        onResize={vi.fn()}
      />
    )

    // Chat with project exists
    expect(screen.getByText('Chat with project')).toBeDefined()
    // Talk to AgentWork exists untouched
    expect(screen.getByText('Talk to AgentWork')).toBeDefined()
    // Chat with Socials exists
    expect(screen.getByText('Chat with Socials')).toBeDefined()
    // Schedules exists
    expect(screen.getByText('Schedules')).toBeDefined()

    // By default, Chat with Socials dropdown is COLLAPSED (chat items are not rendered)
    expect(screen.queryByTitle('Chat with Slack Workspace')).toBeNull()
    expect(screen.queryByTitle('Chat with Engineering Teams')).toBeNull()
    expect(screen.queryByTitle('Chat with AgentWork')).toBeNull()
  })

  it('expands dropdown on click to reveal only active client social accounts, excluding AgentWork', () => {
    const onSelect = vi.fn()
    render(
      <WorkspaceSidebar
        projectId="proj-1"
        sources={mockSources}
        view={mockView}
        nav={{ ...DEFAULT_NAV, openGroup: 'xomni', selection: 'm:project' }}
        channels={mockChannels}
        onOpenGroup={vi.fn()}
        onSelect={onSelect}
        onToggleSection={vi.fn()}
        onToggleInfoGroup={vi.fn()}
        onToggleConnector={vi.fn()}
        onToggleCollapse={vi.fn()}
        onResize={vi.fn()}
      />
    )

    // Click on Chat with Socials button to expand
    const socialsBtn = screen.getByText('Chat with Socials')
    fireEvent.click(socialsBtn)

    // Now client social accounts should be visible
    const slackItem = screen.getByTitle('Chat with Slack Workspace')
    const teamsItem = screen.getByTitle('Chat with Engineering Teams')
    expect(slackItem).toBeDefined()
    expect(teamsItem).toBeDefined()

    // AgentWork must NOT be shown under Chat with Socials (it is dedicated to Talk to AgentWork)
    expect(screen.queryByTitle('Chat with AgentWork')).toBeNull()

    // Pure Google link should NOT be shown in social chat dropdown
    expect(screen.queryByTitle('Chat with Google Doc Link')).toBeNull()

    // Clicking on an account calls onSelect with m:social:<sourceId>
    fireEvent.click(slackItem)
    expect(onSelect).toHaveBeenCalledWith('m:social:src-slack-1')
  })
})
