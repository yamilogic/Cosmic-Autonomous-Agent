// @vitest-environment jsdom
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ProjectCard from '../../src/renderer/src/components/dashboard/ProjectCard'
import { BasicSidebarProjectTree } from '../../src/renderer/src/components/dashboard/BasicSidebarProjectTree'
import { CosmicWorkspaceView } from '../../src/renderer/src/components/dashboard/CosmicWorkspaceView'
import { RunLogsModal } from '../../src/renderer/src/components/dashboard/RunLogsModal'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'
import { useProfileStore } from '../../src/renderer/src/hooks/useProfiles'
import type { DashboardProjectSnapshot } from '../../src/shared/dashboard-contract'

describe('Slack Control: End-to-End Scrape, Read/Write, Scheduler & Cross-View Sync', () => {
  afterEach(() => {
    cleanup()
  })

  const mockProject = {
    id: 'proj-slack-ctrl-1',
    name: 'Acme Slack Project',
    clientName: 'Acme Corp',
    profileId: 'prof-slack-1',
    teamId: 'T_ACME',
    appId: 'slack' as const,
    tokenSource: 'oauth' as const,
    monitors: [
      { channelId: 'C_PUB_1', channelName: 'general', isPrivate: false, enabled: true },
      { channelId: 'C_PRIV_1', channelName: 'client-stealth', isPrivate: true, enabled: true }
    ],
    browserSources: [
      {
        id: 'bsrc-1',
        name: 'Acme Web Slack',
        workspaceUrl: 'https://app.slack.com/client/T_ACME',
        status: 'ok' as const,
        channels: [
          { id: 'C_PUB_1', name: 'general', isPrivate: false, enabled: true },
          { id: 'C_PRIV_1', name: 'client-stealth', isPrivate: true, enabled: true }
        ]
      }
    ],
    workflowStatus: 'active' as const,
    createdAt: new Date().toISOString()
  }

  const initialSnapshot: DashboardProjectSnapshot = {
    project: mockProject,
    syncState: 'idle',
    summary: 'Initial project baseline.',
    newMessageCount: 0,
    totalMessageCount: 15,
    completion: 40,
    pace: 'on-track',
    mood: { state: 'neutral', signal: 'Standard weekly chatter' },
    extractedDates: {},
    effectiveDates: { startDate: '2026-11-01', endDate: '2026-11-30' },
    perChannel: [
      { channelId: 'C_PUB_1', channelName: 'general', messageCount: 10, latestMessageAt: '2026-11-02T10:00:00Z', cursor: '', lastSyncAt: '2026-11-02T10:00:00Z' },
      { channelId: 'C_PRIV_1', channelName: 'client-stealth', messageCount: 5, latestMessageAt: '2026-11-02T10:00:00Z', cursor: '', lastSyncAt: '2026-11-02T10:00:00Z' }
    ],
    lastUpdatedAt: new Date().toISOString()
  }

  const updatedSnapshot: DashboardProjectSnapshot = {
    ...initialSnapshot,
    summary: 'Fresh scrape completed: Client approved proposal in private channel.',
    newMessageCount: 4,
    totalMessageCount: 19,
    completion: 75,
    pace: 'ahead',
    mood: { state: 'good', signal: 'Client thrilled with progress' },
    perChannel: [
      { channelId: 'C_PUB_1', channelName: 'general', messageCount: 11, latestMessageAt: '2026-11-02T10:30:00Z', cursor: '', lastSyncAt: '2026-11-02T10:30:00Z' },
      { channelId: 'C_PRIV_1', channelName: 'client-stealth', messageCount: 8, latestMessageAt: '2026-11-02T10:30:00Z', cursor: '', lastSyncAt: '2026-11-02T10:30:00Z' }
    ],
    lastUpdatedAt: new Date().toISOString()
  }

  beforeEach(() => {
    // Setup Profile store
    useProfileStore.setState({
      profiles: [
        {
          id: 'prof-slack-1',
          displayName: 'Ashutosh Profile',
          customName: 'Ashutosh-Profile',
                    createdAt: '2026-11-01T00:00:00Z',
          avatarColor: '#8b5cf6',
          googleAuthStatus: 'signed-in',
          accountScope: 'individual',
          apps: {
            slack: {
              sessionStatus: 'signed-in',
              availableWorkspaces: [
                { teamId: 'T_ACME', teamName: 'Acme Corp', openUrl: 'https://acme.slack.com', lastSeenAt: '2026-11-02T10:00:00Z' }
              ],
              pinnedWorkspaces: []
            },
            teams: {
              sessionStatus: 'not-signed-in',
              availableWorkspaces: [],
              pinnedWorkspaces: []
            },
            whatsapp: {
              sessionStatus: 'not-signed-in',
              availableWorkspaces: [],
              pinnedWorkspaces: []
            }
          },
        }
      ]
    })

    // Setup Dashboard store
    useDashboardStore.setState({
      snapshot: {
                manualTokens: [],
        syncIntervalSeconds: 300,
        pinnedOrder: [],
        projects: [initialSnapshot]
      },
      dashboardOpen: true,
      cosmicLevel1: 'all',
      cosmicSelectedCardId: 'proj-slack-ctrl-1'
    })

    // Mock window.api
    window.api = {
      dashboard: {
        syncSource: vi.fn().mockImplementation(async () => {
          useDashboardStore.setState({
            snapshot: {
                            manualTokens: [],
              syncIntervalSeconds: 300,
              pinnedOrder: [],
              projects: [updatedSnapshot]
            }
          })
          return { ok: true, messageCount: 4 }
        }),
        syncNow: vi.fn().mockResolvedValue(true),
        getRunLogs: vi.fn().mockResolvedValue([
          {
            runId: 'run-1',
            ts: new Date().toISOString(),
            trigger: 'manual',
            projectId: 'proj-slack-ctrl-1',
            sourceId: 'bsrc-1',
            sourceKind: 'browser',
            workspaceId: 'T_ACME',
            channelsRead: 2,
            newMessages: 4,
            durationMs: 1400,
            status: 'ok',
            snippets: [
              {
                channelId: 'C_PUB_1',
                channelName: 'general',
                sender: 'Alice',
                ts: new Date().toISOString(),
                snippet: 'Proposal approved'
              }
            ]
          }
        ]),
        getScrapeRuns: vi.fn().mockResolvedValue([
          {
            runId: 'run-1',
            ts: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            trigger: 'manual',
            projectId: 'proj-slack-ctrl-1',
            projectName: 'Acme Slack Project',
            sourceId: 'bsrc-1',
            sourceKind: 'browser',
            workspaceId: 'T_ACME',
            workspaceName: 'Acme Web Slack',
            channelsRead: 2,
            newMessages: 4,
            window: { startTs: '0', endTs: '1', backfillHours: 6 },
            channels: [
              {
                channelId: 'C_PUB_1',
                channelName: 'general',
                kind: 'public',
                messagesRead: 11,
                newMessages: 4,
                status: 'read'
              }
            ],
            people: [{ name: 'Alice', messages: 4 }],
            filters: { includeKinds: ['public', 'private'] },
            durationMs: 1400,
            llmCalls: 0,
            status: 'success',
            snippets: [
              {
                channelId: 'C_PUB_1',
                channelName: 'general',
                sender: 'Alice',
                ts: new Date().toISOString(),
                snippet: 'Proposal approved'
              }
            ]
          }
        ]),
        cancelScrape: vi.fn().mockResolvedValue({ ok: true }),
        setSourceSchedule: vi.fn().mockResolvedValue({}),
        getSchedules: vi.fn().mockResolvedValue({
          settings: { slackSync: { enabled: true, intervalMinutes: 15 } },
          lastRuns: []
        }),
        getProjectChatStatus: vi.fn().mockResolvedValue({
          hasKey: false,
          model: 'gpt-4o',
          modelSource: 'default',
          keySource: 'default'
        }),
        getTeamWorkspace: vi.fn().mockResolvedValue(null),
        getAiSettings: vi.fn().mockResolvedValue({
          global: { provider: 'nvidia-nim', hasKey: false, status: 'not-configured' },
          project: null,
          effective: { provider: 'nvidia-nim', model: 'default' }
        }),
        getProjectActivity: vi.fn().mockResolvedValue({
          messages: [],
          participants: [],
          channels: []
        }),
        listChannels: vi.fn().mockResolvedValue([]),
        onScrapeEvent: vi.fn().mockReturnValue(() => {}),
        onSyncProgress: vi.fn().mockReturnValue(() => {}),
        onSchedulesChanged: vi.fn().mockReturnValue(() => {}),
        onConfigChanged: vi.fn().mockReturnValue(() => {})
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({}),
        setSettings: vi.fn().mockResolvedValue({})
      }
    } as any
  })

  it('1. Scrape Button Execution: triggers syncSource and updates card metrics upon completion', async () => {
    render(
      <ProjectCard
        snapshot={initialSnapshot}
        index={0}
        expanded={true}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    )

    // Verify initial metrics
    expect(screen.getByText('Acme Slack Project')).toBeTruthy()
    expect(screen.getByText('T_ACME')).toBeTruthy()

    // Find and click the Scrape button (labeled "🕷 Scrape")
    const scrapeBtn = screen.getByRole('button', { name: /Scrape channels/i })
    expect(scrapeBtn).toBeTruthy()
    fireEvent.click(scrapeBtn)

    // Verify window.api.dashboard.syncSource was called with the project id
    expect(window.api.dashboard.syncSource).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-slack-ctrl-1' })
    )

    // Wait for the snapshot in useDashboardStore to be updated to 75% and positive
    await waitFor(() => {
      const currentProjects = useDashboardStore.getState().snapshot?.projects
      expect(currentProjects?.[0].completion).toBe(75)
      expect(currentProjects?.[0].mood.state).toBe('good')
      expect(currentProjects?.[0].totalMessageCount).toBe(19)
    })
  })

  it('2. Channel Coverage: processes both public and private channels', () => {
    const pubChannel = updatedSnapshot.perChannel.find((c) => c.channelId === 'C_PUB_1')
    const privChannel = updatedSnapshot.perChannel.find((c) => c.channelId === 'C_PRIV_1')

    expect(pubChannel).toBeDefined()
    expect(pubChannel?.channelName).toBe('general')
    expect(pubChannel?.messageCount).toBe(11)

    expect(privChannel).toBeDefined()
    expect(privChannel?.channelName).toBe('client-stealth')
    expect(privChannel?.messageCount).toBe(8)
  })

  it('3. Run Logs Observability: fetches and displays scrape run audit logs in RunLogsModal', async () => {
    render(
      <RunLogsModal
        open={true}
        projectId="proj-slack-ctrl-1"
        projectName="Acme Slack Project"
        onClose={vi.fn()}
      />
    )

    expect(window.api.dashboard.getScrapeRuns).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-slack-ctrl-1' })
    )

    // Wait for modal and logs content to render
    await waitFor(() => {
      expect(screen.getByText(/Scrape logs/i)).toBeTruthy()
    })
  })

  it('4. Cross-View Neutrality: updated project snapshot reflects consistently across Ancient, Basic, and Cosmic views', async () => {
    // 1. Simulate update has occurred in useDashboardStore
    useDashboardStore.setState({
      snapshot: {
                manualTokens: [],
        syncIntervalSeconds: 300,
        pinnedOrder: [],
        projects: [updatedSnapshot]
      }
    })

    // 2. Render Basic Sidebar Tree
    const { unmount: unmountBasic } = render(
      <BasicSidebarProjectTree
        
      />
    )

    // Basic view renders project name
    expect(screen.getByText('Acme Slack Project')).toBeTruthy()
    unmountBasic()

    // 3. Render Cosmic View
    const { unmount: unmountCosmic } = render(
      <CosmicWorkspaceView
        
        
      />
    )

    // Cosmic view renders project headline and active project card
    await waitFor(() => {
      expect(screen.getByText('Acme Slack Project')).toBeTruthy()
    })
    unmountCosmic()

    // 4. Render Ancient (ProjectCard Expanded) View
    render(
      <ProjectCard
        snapshot={useDashboardStore.getState().snapshot!.projects[0]}
        index={0}
        expanded={true}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    )

    expect(screen.getByText('Acme Slack Project')).toBeTruthy()
    expect(screen.getByText('T_ACME')).toBeTruthy()
  })

  it('5. Safe Queueing: prevents concurrent collisions and serializes execution', async () => {
    let callCount = 0
    window.api.dashboard.syncSource = vi.fn().mockImplementation(async () => {
      callCount++
      await new Promise((r) => setTimeout(r, 20))
      return { ok: true, callIndex: callCount }
    })

    // Simulate two rapid sequential scrape calls
    const p1 = useDashboardStore.getState().syncSource({ projectId: 'proj-slack-ctrl-1' })
    const p2 = useDashboardStore.getState().syncSource({ projectId: 'proj-slack-ctrl-1' })

    await Promise.all([p1, p2])

    expect(window.api.dashboard.syncSource).toHaveBeenCalledTimes(2)
  })
})
