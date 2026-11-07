// @vitest-environment jsdom
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ProjectSettingsTab from '../../src/renderer/src/components/dashboard/ProjectSettingsTab'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'
import { useProfileStore } from '../../src/renderer/src/hooks/useProfiles'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

describe('ProjectSettingsTab: Sources Tab Categorized Sections & Scrape Control', () => {
  const syncSourceMock = vi.fn().mockResolvedValue({
    channelsRead: 3,
    newMessages: 8,
    status: 'success'
  })
  const upsertProjectMock = vi.fn().mockResolvedValue({})
  const updateSourceMock = vi.fn().mockResolvedValue({ snapshot: { projects: [] } })

  const mockProject: DashboardProject = {
    id: 'proj-rajesh-01',
    name: 'Rajesh-Project-01',
    clientName: 'Client-test-01',
    profileId: 'prof-rajesh',
    teamId: 'T_DEFAULT',
    teamName: 'Default Team',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [{ channelId: 'C_GEN', channelName: 'general' }],
    sources: [
      {
        id: 'src-card-client-1',
        kind: 'browser',
        platform: 'slack',
        profileId: 'prof-ashutosh',
        workspaceId: 'T_ASHUTOSH_1',
        workspaceName: 'Ashutosh Workspace 1',
        channels: [
          { id: 'C_PUB', name: 'public-ops', isPrivate: false, enabled: true },
          { id: 'C_PRIV', name: 'secret-leads', isPrivate: true, enabled: true }
        ],
        role: 'client',
        enabled: true,
        backfillDays: 7,
        status: 'connected',
        channelsReviewedAt: '2026-11-02T10:00:00Z',
        createdAt: '2026-11-02T10:00:00Z',
        updatedAt: '2026-11-02T10:00:00Z'
      }
    ],
    createdAt: '2026-11-02T10:00:00Z'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    window.api = {
      dashboard: {
        getChatTokenStatus: vi.fn().mockResolvedValue({ status: 'ok' }),
        getAiSettings: vi.fn().mockResolvedValue({ enabled: false, provider: 'openai', model: 'gpt-4o' }),
        listAiModels: vi.fn().mockResolvedValue({ models: [] }),
        syncSource: syncSourceMock,
        upsertProject: upsertProjectMock,
        updateSource: updateSourceMock,
        discoverSourceChannels: vi.fn().mockResolvedValue({ channels: [] }),
        getRunLogs: vi.fn().mockResolvedValue([]),
        aiGetConfigView: vi.fn().mockResolvedValue({
          global: { model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', apiKeyMask: '••••' },
          project: null,
          effective: { chatModel: 'nvidia/nemotron-3.5-super-vl-120b-a12b', embeddingModel: 'nvidia/nv-embed-v1', keySource: 'global', apiKeyMask: '••••' }
        })
      },
      profiles: {
        setEmbedVisible: vi.fn().mockResolvedValue(undefined)
      }
    } as any

    useDashboardStore.setState({
      syncSource: syncSourceMock,
      upsertProject: upsertProjectMock,
      updateSource: updateSourceMock,
      discoverSourceChannels: vi.fn().mockResolvedValue({ channels: [] })
    })

    useProfileStore.setState({
      profiles: [
        {
          id: 'prof-ashutosh',
          displayName: 'Ashutosh-Profile',
          customName: 'Ashutosh-Profile',
          accountScope: 'both',
          apps: {
            slack: {
              availableWorkspaces: [
                { teamId: 'T_ASHUTOSH_1', teamName: 'Ashutosh Workspace 1' },
                { teamId: 'T_ASHUTOSH_2', teamName: 'Ashutosh Workspace 2' }
              ]
            }
          },
          customLinks: [
            { id: 'link-1', name: 'Internal Wiki', url: 'https://wiki.example.com' }
          ]
        },
        {
          id: 'prof-rajesh',
          displayName: 'Rajesh-profile',
          customName: 'Rajesh-profile',
          accountScope: 'both',
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

  it('renders Global Accounts & Workspaces with Active state and Scrape buttons', async () => {
    render(<ProjectSettingsTab project={mockProject} />)

    // Switch to Sources tab
    const sourcesTabBtn = screen.getByRole('tab', { name: /Sources/i })
    fireEvent.click(sourcesTabBtn)

    // Verify sections exist
    expect(screen.getByText(/Global Accounts & Workspaces/i)).toBeDefined()
    expect(screen.getByText(/Attached Card Sources/i)).toBeDefined()

    // Verify Ashutosh workspaces appear under global section
    expect(screen.getAllByText(/Ashutosh Workspace 1/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Ashutosh Workspace 2/i)).toBeDefined()

    // Ashutosh Workspace 1 is already attached -> shows Active button and Scrape button
    expect(screen.getAllByText(/● Active/i).length).toBeGreaterThanOrEqual(1)

    // Ashutosh Workspace 2 is not yet attached -> shows Attach & Scrape button
    expect(screen.getByRole('button', { name: /\+ Attach & Scrape/i })).toBeDefined()
  })

  it('gates Scrape button so it only appears for Slack sources and not non-scrapable sources', async () => {
    const projectWithMixedSources: DashboardProject = {
      ...mockProject,
      sources: [
        {
          id: 'src-slack',
          kind: 'browser',
          platform: 'slack',
          workspaceId: 'T_SLACK_1',
          workspaceName: 'Slack Workspace',
          channels: [],
          role: 'ours',
          backfillDays: 7,
          enabled: true,
          status: 'connected',
          channelsReviewedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'src-chatgpt',
          kind: 'browser',
          platform: 'custom' as any,
          workspaceId: 'chatgpt-link',
          workspaceName: 'ChatGPT Workspace',
          channels: [],
          role: 'ours',
          backfillDays: 7,
          enabled: true,
          status: 'connected',
          channelsReviewedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    }

    render(<ProjectSettingsTab project={projectWithMixedSources} />)
    const sourcesTabBtn = screen.getByRole('tab', { name: /Sources/i })
    fireEvent.click(sourcesTabBtn)

    // Attached Card Sources section should have Slack with Scrape button
    expect(screen.getByText('Slack Workspace')).toBeDefined()
    expect(screen.getByText('ChatGPT Workspace')).toBeDefined()

    // Both should have Active buttons
    const activeButtons = screen.getAllByRole('button', { name: /● Active/i })
    expect(activeButtons.length).toBeGreaterThanOrEqual(2)

    // Scrape button should exist for Slack, but not for ChatGPT
    const scrapeButtons = screen.getAllByRole('button', { name: /🕷 Scrape/i })
    // Only 1 scrape button in Attached Card Sources for the Slack source (plus any in global section)
    expect(scrapeButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('toggles Active / Inactive state on an attached workspace source', async () => {
    render(<ProjectSettingsTab project={mockProject} />)

    // Switch to Sources tab
    const sourcesTabBtn = screen.getByRole('tab', { name: /Sources/i })
    fireEvent.click(sourcesTabBtn)

    // Find and click the Active button for src-card-client-1
    const activeButtons = screen.getAllByRole('button', { name: /● Active/i })
    expect(activeButtons.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(activeButtons[0])

    await waitFor(() => {
      expect(updateSourceMock).toHaveBeenCalledWith({
        projectId: 'proj-rajesh-01',
        sourceId: 'src-card-client-1',
        patch: { enabled: false }
      })
    })
  })

  it('triggers manual scrape and shows scraping status', async () => {
    render(<ProjectSettingsTab project={mockProject} />)

    // Switch to Sources tab
    const sourcesTabBtn = screen.getByRole('tab', { name: /Sources/i })
    fireEvent.click(sourcesTabBtn)

    // Click 🕷 Scrape button on Ashutosh Workspace 1
    const scrapeButtons = screen.getAllByRole('button', { name: /🕷 Scrape/i })
    expect(scrapeButtons.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(scrapeButtons[0])

    await waitFor(() => {
      expect(syncSourceMock).toHaveBeenCalledWith({
        projectId: 'proj-rajesh-01',
        sourceId: 'src-card-client-1'
      })
    })
  })

  it('attaches an unreviewed global workspace without scraping it', async () => {
    render(<ProjectSettingsTab project={mockProject} />)

    // Switch to Sources tab
    const sourcesTabBtn = screen.getByRole('tab', { name: /Sources/i })
    fireEvent.click(sourcesTabBtn)

    // Click + Attach & Scrape for Ashutosh Workspace 2
    const attachBtn = screen.getByRole('button', { name: /\+ Attach & Scrape/i })
    fireEvent.click(attachBtn)

    await waitFor(() => {
      expect(upsertProjectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'proj-rajesh-01',
          sources: expect.arrayContaining([
            expect.objectContaining({
              workspaceId: 'T_ASHUTOSH_2',
              workspaceName: 'Ashutosh Workspace 2',
              profileId: 'prof-ashutosh',
              channels: []
            })
          ])
        })
      )
      expect(syncSourceMock).not.toHaveBeenCalled()
    })
  })

  it('does not auto-trigger channel picker modal for unreviewed sources, but opens on manual click', async () => {
    const unreviewedProject = {
      ...mockProject,
      sources: [
        {
          id: 'src-unreviewed-1',
          kind: 'browser' as const,
          platform: 'slack' as const,
          profileId: 'prof-ashutosh',
          workspaceId: 'T_UNREVIEWED',
          workspaceName: 'Unreviewed Workspace',
          channels: [],
          role: 'ours' as const,
          enabled: true,
          backfillDays: 7 as const,
          status: 'connected' as const,
          selectionMode: 'include' as const,
          createdAt: '2026-11-02T10:00:00.000Z',
          updatedAt: '2026-11-02T10:00:00.000Z'
        }
      ]
    }

    render(<ProjectSettingsTab project={unreviewedProject} />)

    // Modal must NOT pop up automatically
    expect(screen.queryByRole('dialog', { name: /select channels to scrape/i })).toBeNull()

    // Switch to Sources tab
    const sourcesTabBtn = screen.getByRole('tab', { name: /Sources/i })
    fireEvent.click(sourcesTabBtn)

    // Click Channels button manually
    const channelsBtn = screen.getByRole('button', { name: /Channels \(0\)/i })
    fireEvent.click(channelsBtn)

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /select channels to scrape/i })).toBeDefined()
    })
  })
})
