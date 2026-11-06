// @vitest-environment jsdom
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import WorkspaceSidebar from '../../src/renderer/src/components/dashboard/WorkspaceSidebar'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'
import { useProfileStore } from '../../src/renderer/src/hooks/useProfiles'
import type { CardView } from '../../src/renderer/src/components/dashboard/card-view'
import { DEFAULT_NAV, type WorkspaceNavState, type ConnectorChannelLists } from '../../src/renderer/src/components/dashboard/workspace-nav'

describe('WorkspaceSidebar: Card Workspace Scrape Inline Actions', () => {
  const syncSourceMock = vi.fn().mockResolvedValue({
    channelsRead: 2,
    newMessages: 5,
    status: 'connected'
  })
  const upsertProjectMock = vi.fn().mockResolvedValue({})

  beforeEach(() => {
    vi.clearAllMocks()
    window.api = {
      dashboard: {
        checkCardAuth: vi.fn().mockResolvedValue(true),
        getSnapshot: vi.fn().mockResolvedValue({
          projects: [
            {
              project: {
                id: 'proj-1',
                name: 'Rajesh Project',
                profileId: 'prof-rajesh',
                monitors: [{ channelId: 'C1', channelName: 'general' }],
                sources: [
                  {
                    id: 'src-1',
                    kind: 'browser',
                    platform: 'slack',
                    profileId: 'prof-ashutosh',
                    workspaceId: 'T_ASHUTOSH_1',
                    workspaceName: 'Ashutosh Workspace 1',
                    channels: [{ id: 'C1', name: 'general', enabled: true }],
                    role: 'client',
                    enabled: true,
                    backfillDays: 7,
                    status: 'connected',
                    channelsReviewedAt: '2026-11-02T10:00:00Z',
                    createdAt: '2026-11-02T10:00:00Z',
                    updatedAt: '2026-11-02T10:00:00Z'
                  }
                ]
              }
            }
          ]
        }),
        syncSource: syncSourceMock,
        upsertProject: upsertProjectMock
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ sidebarLook: 'ancient' }),
        onSettingsChanged: vi.fn().mockReturnValue(() => {})
      }
    } as any

    useDashboardStore.setState({
      snapshot: {
        projects: [
          {
            project: {
              id: 'proj-1',
              name: 'Rajesh Project',
              profileId: 'prof-rajesh',
              monitors: [{ channelId: 'C1', channelName: 'general' }],
              sources: [
                {
                  id: 'src-1',
                  kind: 'browser',
                  platform: 'slack',
                  profileId: 'prof-ashutosh',
                  workspaceId: 'T_ASHUTOSH_1',
                  workspaceName: 'Ashutosh Workspace 1',
                  channels: [{ id: 'C1', name: 'general', enabled: true }],
                  role: 'client',
                  enabled: true,
                  backfillDays: 7,
                  status: 'connected',
                  channelsReviewedAt: '2026-11-02T10:00:00Z',
                  createdAt: '2026-11-02T10:00:00Z',
                  updatedAt: '2026-11-02T10:00:00Z'
                }
              ]
            } as any,
            syncState: 'idle',
            summary: '',
            newMessageCount: 0,
            totalMessageCount: 10,
            completion: 50,
            pace: 'on-track',
            mood: { state: 'neutral', signal: '' },
            extractedDates: {},
            effectiveDates: { startDate: '', endDate: '' },
            perChannel: [],
            lastUpdatedAt: ''
          }
        ]
      } as any,
      syncSource: syncSourceMock,
      upsertProject: upsertProjectMock
    })

    useProfileStore.setState({
      profiles: [
        {
          id: 'prof-ashutosh',
          displayName: 'Ashutosh',
          customName: 'Ashutosh',
          apps: {
            slack: {
              availableWorkspaces: [
                { teamId: 'T_ASHUTOSH_1', teamName: 'Ashutosh Workspace 1' },
                { teamId: 'T_ASHUTOSH_2', teamName: 'Ashutosh Workspace 2' }
              ]
            }
          },
          customLinks: []
        },
        {
          id: 'prof-rajesh',
          displayName: 'Rajesh',
          customName: 'Rajesh',
          apps: {
            slack: {
              availableWorkspaces: []
            }
          },
          customLinks: []
        }
      ] as any
    })
  })

  afterEach(() => {
    cleanup()
  })

  const mockView: CardView = {
    identity: {
      index: 0,
      name: 'Rajesh Project',
      clientName: 'Rajesh Project',
      teamName: 'Rajesh Workspace',
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
    leftSidebar: {
      requirements: [],
      scopeDeliverables: { inScope: [], outOfScope: [], deliverables: [] },
      decisions: [],
      commitments: [],
      files: [],
      peopleChannels: { people: [], channels: [], quietChannelCount: 0 },
      startTimeline: { startDate: undefined, endDate: undefined, dateBadge: 'manual', milestones: [] }
    },
    rightSidebar: {
      actions: [],
      blockers: [],
      timeline: []
    } as any,
    centre: {} as any,
    aiBadge: 'Inherited'
  }

  const mockNav: WorkspaceNavState = {
    ...DEFAULT_NAV,
    openGroup: 'slack',
    openSections: ['xomni', 'slack'],
    openConnectors: ['client', 'team'],
    selection: null,
    collapsed: false,
    width: 240
  }

  const mockChannels: ConnectorChannelLists = {
    team: { loading: false, error: null, entries: [] },
    client: { loading: false, error: null, entries: [] }
  }

  it('renders inline Scrape buttons for Global Workspaces inside the card sidebar', async () => {
    render(
      <WorkspaceSidebar
        projectId="proj-1"
        sources={[
          {
            id: 'src-1',
            kind: 'browser',
            platform: 'slack',
            profileId: 'prof-ashutosh',
            workspaceId: 'T_ASHUTOSH_1',
            workspaceName: 'Ashutosh Workspace 1',
            channels: [{ id: 'C1', name: 'general', enabled: true }],
            role: 'client',
            enabled: true,
            backfillDays: 7,
            status: 'connected',
            channelsReviewedAt: '2026-11-02T10:00:00Z',
            createdAt: '2026-11-02T10:00:00Z',
            updatedAt: '2026-11-02T10:00:00Z'
          }
        ]}
        view={mockView}
        nav={mockNav}
        channels={mockChannels}
        onOpenGroup={vi.fn()}
        onSelect={vi.fn()}
        onToggleSection={vi.fn()}
        onToggleInfoGroup={vi.fn()}
        onToggleConnector={vi.fn()}
        onToggleCollapse={vi.fn()}
        onResize={vi.fn()}
      />
    )

    // Verify global accounts section displays Ashutosh workspaces
    expect(screen.getByText(/Ashutosh Workspace 1/i)).toBeDefined()
    expect(screen.getByText(/Ashutosh Workspace 2/i)).toBeDefined()

    // Find scrape buttons
    const scrapeButtons = screen.getAllByRole('button', { name: /Scrape/i })
    expect(scrapeButtons.length).toBeGreaterThanOrEqual(2)

    // Click scrape on Ashutosh Workspace 1
    const scrapeWs1 = screen.getByTitle(/Scrape messages from Ashutosh Workspace 1/i)
    fireEvent.click(scrapeWs1)

    await waitFor(() => {
      expect(syncSourceMock).toHaveBeenCalledWith({
        projectId: 'proj-1',
        sourceId: 'src-1'
      })
    })
  })

  it('auto-attaches workspace to project sources when scraping a global workspace not yet attached', async () => {
    render(
      <WorkspaceSidebar
        projectId="proj-1"
        sources={[
          {
            id: 'src-1',
            kind: 'browser',
            platform: 'slack',
            profileId: 'prof-ashutosh',
            workspaceId: 'T_ASHUTOSH_1',
            workspaceName: 'Ashutosh Workspace 1',
            channels: [{ id: 'C1', name: 'general', enabled: true }],
            role: 'client',
            enabled: true,
            backfillDays: 7,
            status: 'connected',
            channelsReviewedAt: '2026-11-02T10:00:00Z',
            createdAt: '2026-11-02T10:00:00Z',
            updatedAt: '2026-11-02T10:00:00Z'
          }
        ]}
        view={mockView}
        nav={mockNav}
        channels={mockChannels}
        onOpenGroup={vi.fn()}
        onSelect={vi.fn()}
        onToggleSection={vi.fn()}
        onToggleInfoGroup={vi.fn()}
        onToggleConnector={vi.fn()}
        onToggleCollapse={vi.fn()}
        onResize={vi.fn()}
      />
    )

    // Click scrape on Ashutosh Workspace 2 (which is not yet in proj-1 sources)
    const scrapeWs2 = screen.getByTitle(/Scrape messages from Ashutosh Workspace 2/i)
    fireEvent.click(scrapeWs2)

    await waitFor(() => {
      expect(upsertProjectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'proj-1',
          sources: expect.arrayContaining([
            expect.objectContaining({
              workspaceId: 'T_ASHUTOSH_2',
              workspaceName: 'Ashutosh Workspace 2',
              profileId: 'prof-ashutosh'
            })
          ])
        })
      )
      expect(syncSourceMock).not.toHaveBeenCalled()
    })
  })
})
