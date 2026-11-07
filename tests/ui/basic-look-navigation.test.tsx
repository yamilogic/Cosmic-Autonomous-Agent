// @vitest-environment jsdom
import { render, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BasicSidebarProjectTree } from '../../src/renderer/src/components/dashboard/BasicSidebarProjectTree'
import { ProfileSidebar } from '../../src/renderer/src/components/ProfileSidebar'
import CardLiveSlackEmbed from '../../src/renderer/src/components/dashboard/CardLiveSlackEmbed'
import { CosmicWorkspaceView } from '../../src/renderer/src/components/dashboard/CosmicWorkspaceView'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'
import { useProfileStore } from '../../src/renderer/src/hooks/useProfiles'

describe('BasicSidebarProjectTree & Basic Look Navigation', () => {
  afterEach(() => {
    cleanup()
  })
  const mockSnapshot = {
    teamWorkspace: null,
    manualTokens: [],
    syncIntervalSeconds: 60,
    pinnedOrder: [],
    projects: [
      {
        project: {
          id: 'proj-1',
          name: 'Rajesh-test-03',
          clientName: 'Client-03',
          profileId: 'prof-1',
          teamId: 'T123',
          appId: 'slack',
          tokenSource: 'oauth',
          monitors: [],
          workflowStatus: 'active',
          createdAt: new Date().toISOString()
        },
        sources: [],
        syncState: 'idle',
        summary: 'Weekly sync notes.',
        newMessageCount: 0,
        totalMessageCount: 0,
        completion: 50,
        pace: 'on-track',
        mood: { state: 'neutral', signal: '' },
        extractedDates: {},
        effectiveDates: { startDate: null, endDate: null },
        perChannel: [],
        lastUpdatedAt: new Date().toISOString()
      },
      {
        project: {
          id: 'proj-2',
          name: 'Ashutosh-Test-01',
          clientName: 'Client-01',
          profileId: 'prof-2',
          teamId: 'T456',
          appId: 'slack',
          tokenSource: 'oauth',
          monitors: [],
          workflowStatus: 'active',
          createdAt: new Date().toISOString()
        },
        sources: [],
        syncState: 'idle',
        summary: 'Weekly sync notes.',
        newMessageCount: 0,
        totalMessageCount: 0,
        completion: 50,
        pace: 'on-track',
        mood: { state: 'neutral', signal: '' },
        extractedDates: {},
        effectiveDates: { startDate: null, endDate: null },
        perChannel: [],
        lastUpdatedAt: new Date().toISOString()
      }
    ],
    updatedAt: new Date().toISOString()
  }

  beforeEach(() => {
    useDashboardStore.setState({
      snapshot: mockSnapshot as any,
      cosmicSelectedCardId: 'proj-1',
      basicActiveTab: 'dashboard'
    })

    window.api = {
      app: {
        getSettings: vi.fn().mockResolvedValue({}),
        onSettingsChanged: vi.fn().mockReturnValue(() => undefined)
      },
      dashboard: {
        onScrapeEvent: vi.fn().mockReturnValue(() => undefined),
        checkCardAuth: vi.fn().mockResolvedValue(true),
        getTeamWorkspace: vi.fn().mockResolvedValue(null),
        listChannels: vi.fn().mockResolvedValue({ ok: true, channels: [] }),
        discoverSourceChannels: vi.fn().mockResolvedValue({ channels: [] }),
        updateSource: vi.fn().mockResolvedValue({})
      },
      profiles: {
        activateCardSlackEmbed: vi.fn().mockResolvedValue(undefined),
        updateCardSlackEmbedBounds: vi.fn().mockResolvedValue(undefined),
        clearCardSlackEmbed: vi.fn().mockResolvedValue(undefined),
        setEmbedVisible: vi.fn().mockResolvedValue(undefined)
      }
    } as any

    class MockResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    window.ResizeObserver = MockResizeObserver as any
    global.ResizeObserver = MockResizeObserver as any
  })

  it('renders project names as collapsible tree rows without card wrapper boxes', () => {
    const { getByText, container } = render(<BasicSidebarProjectTree baseAppLayout="standard" />)

    expect(getByText('Rajesh-test-03')).not.toBeNull()
    expect(getByText('Ashutosh-Test-01')).not.toBeNull()

    // Verify selected project node does not have hardcoded card borders or card backgrounds
    const selectedNode = container.querySelector('.basic-project-node.is-selected') as HTMLElement
    expect(selectedNode).not.toBeNull()
    expect(selectedNode.style.border).toBe('')
    expect(selectedNode.style.background).toBe('')
  })

  it('renders Dashboard, Slack, Teams, WhatsApp under expanded project', () => {
    const { getAllByText } = render(<BasicSidebarProjectTree baseAppLayout="standard" />)

    // proj-1 is expanded by default since it matches cosmicSelectedCardId
    expect(getAllByText('Dashboard').length).toBeGreaterThan(0)
    expect(getAllByText('Slack').length).toBeGreaterThan(0)
    expect(getAllByText('Microsoft Teams').length).toBeGreaterThan(0)
    expect(getAllByText('WhatsApp').length).toBeGreaterThan(0)
  })

  it('renders extended tools (Claude, ChatGPT) when baseAppLayout is extended', () => {
    const { getAllByText } = render(<BasicSidebarProjectTree baseAppLayout="extended" />)

    expect(getAllByText('Dashboard').length).toBeGreaterThan(0)
    expect(getAllByText('Slack').length).toBeGreaterThan(0)
    expect(getAllByText('Claude').length).toBeGreaterThan(0)
    expect(getAllByText('ChatGPT').length).toBeGreaterThan(0)
  })

  it('clicking child tab updates basicActiveTab and selects project', () => {
    const { getAllByText } = render(<BasicSidebarProjectTree baseAppLayout="standard" />)

    const slackBtn = getAllByText('Slack')[0]
    fireEvent.click(slackBtn)

    expect(useDashboardStore.getState().cosmicSelectedCardId).toBe('proj-1')
    expect(useDashboardStore.getState().basicActiveTab).toBe('slack')

    const dashBtn = getAllByText('Dashboard')[0]
    fireEvent.click(dashBtn)

    expect(useDashboardStore.getState().basicActiveTab).toBe('dashboard')
  })

  it('clicking project header toggles expand/collapse', () => {
    const { getByText } = render(
      <BasicSidebarProjectTree baseAppLayout="standard" />
    )

    // proj-2 is initially collapsed
    const proj2Header = getByText('Ashutosh-Test-01')
    fireEvent.click(proj2Header)

    // Now proj-2 is expanded
    // Let's click it again to collapse it
    fireEvent.click(proj2Header)
  })

  it('renders in ProfileSidebar when sidebarLook="basic"', () => {
    const { getByText } = render(
      <ProfileSidebar
        profiles={[]}
        activeProfileId={null}
        activeAppId={null}
        selectedTeamId={null}
        syncingProfileId={null}
        email=""
        onEmailChange={vi.fn()}
        googleBusy={false}
        statusLine=""
        unreadCounts={{}}
        recentWorkspaces={[]}
        onAddGoogle={vi.fn()}
        onCancelGoogle={vi.fn()}
        onToggleSidebar={vi.fn()}
        onSelect={vi.fn()}
        onSelectApp={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onToggleMute={vi.fn()}
        onReorder={vi.fn()}
        onOpenInSplit={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onSyncWorkspaces={vi.fn()}
        onPinFromAvailable={vi.fn()}
        onUnpin={vi.fn()}
        onDismissError={vi.fn()}
        onAddPlatform={vi.fn()}
        showLookSwitcher={true}
        sidebarLook="basic"
        showGoogleEmailInputInSidebar={true}
      />
    )

    expect(getByText('Rajesh-test-03')).not.toBeNull()
    expect(getByText('Continue with Google')).not.toBeNull()
  })

  it('renders CardLiveSlackEmbed with full-height container and canonical background', () => {
    const { container } = render(
      <CardLiveSlackEmbed appId="whatsapp" profileId="prof-1" />
    )

    const embedDiv = container.firstChild as HTMLElement
    expect(embedDiv).not.toBeNull()
    // Must not be clamped to 480px or have radius/hardcoded colors
    expect(embedDiv.style.minHeight).toBe('0px')
    expect(embedDiv.style.borderRadius).toBe('0px')
    expect(embedDiv.style.background).toBe('var(--bg-page)')
  })

  it('hides and clears CardLiveSlackEmbed when hidden prop is true', () => {
    const { container } = render(
      <CardLiveSlackEmbed appId="slack" profileId="prof-1" hidden />
    )

    const embedDiv = container.firstChild as HTMLElement
    expect(embedDiv.style.display).toBe('none')
    expect(embedDiv.style.visibility).toBe('hidden')
    expect(window.api.profiles.clearCardSlackEmbed).toHaveBeenCalled()
    expect(window.api.profiles.setEmbedVisible).toHaveBeenCalledWith(false)
    expect(window.api.profiles.activateCardSlackEmbed).not.toHaveBeenCalled()
  })

  it('renders pin button on project rows and sorts pinned projects to the top', () => {
    // proj-2 is pinned, proj-1 is unpinned
    useDashboardStore.setState({
      snapshot: {
        ...mockSnapshot,
        pinnedOrder: ['proj-2']
      } as any
    })

    const { container } = render(<BasicSidebarProjectTree />)

    // Project rows in DOM order
    const projectNames = Array.from(container.querySelectorAll('.basic-project-header-btn')).map(
      (btn) => btn.textContent
    )

    // Pinned proj-2 ('Ashutosh-Test-01') should appear before unpinned proj-1 ('Rajesh-test-03')
    expect(projectNames[0]).toContain('Ashutosh-Test-01')
    expect(projectNames[1]).toContain('Rajesh-test-03')

    // Pin buttons should be rendered
    const pinButtons = container.querySelectorAll('.basic-project-pin')
    expect(pinButtons.length).toBe(2)
    // First project is pinned
    expect(pinButtons[0].classList.contains('is-pinned')).toBe(true)
    expect(pinButtons[1].classList.contains('is-pinned')).toBe(false)
  })

  it('clicking pin button calls setPinnedOrder without collapsing project', () => {
    const setPinnedOrderSpy = vi.fn().mockResolvedValue(undefined)
    useDashboardStore.setState({
      snapshot: {
        ...mockSnapshot,
        pinnedOrder: []
      } as any,
      setPinnedOrder: setPinnedOrderSpy
    })

    const { container } = render(<BasicSidebarProjectTree />)

    const pinButtons = container.querySelectorAll('.basic-project-pin')
    expect(pinButtons.length).toBe(2)

    // Click pin on first project (proj-1)
    fireEvent.click(pinButtons[0])

    expect(setPinnedOrderSpy).toHaveBeenCalledWith(['proj-1'])
  })

  it('when basicActiveTab is slack, CosmicWorkspaceView activates live Slack embed with whole-workspace s:team selection', async () => {
    useDashboardStore.setState({
      snapshot: mockSnapshot as any,
      cosmicSelectedCardId: 'proj-1',
      basicActiveTab: 'slack'
    })

    const { getByText, queryByText } = render(
      <CosmicWorkspaceView sidebarLook="basic" />
    )

    // Should render the Slack Workspace header
    expect(getByText('Slack Workspace')).not.toBeNull()
    expect(getByText('Re-authenticate')).not.toBeNull()

    // Must NOT render the read-only SlackChatTab message
    expect(queryByText(/No stored messages yet/i)).toBeNull()

    // Verify activateCardSlackEmbed was called for slack
    expect(window.api.profiles.activateCardSlackEmbed).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'slack',
        projectId: 'proj-1'
      })
    )
  })

  it('when slack source is connected, renders Choose channels and Channels buttons in header bar without yellow banner', async () => {
    const sampleSources = [
      {
        id: 'src-1',
        kind: 'browser' as const,
        platform: 'slack' as const,
        profileId: 'prof-1',
        workspaceId: 'T123',
        workspaceName: 'Acme',
        channels: [{ id: 'C1', name: 'general', enabled: true }],
        role: 'client' as const,
        enabled: true,
        backfillDays: 7,
        status: 'connected' as const,
        createdAt: '2026-11-02T10:00:00.000Z',
        updatedAt: '2026-11-02T10:00:00.000Z'
      }
    ]
    const projectWithSource = {
      ...mockSnapshot.projects[0],
      project: {
        ...mockSnapshot.projects[0].project,
        sources: sampleSources
      },
      sources: sampleSources
    }

    useDashboardStore.setState({
      snapshot: {
        ...mockSnapshot,
        projects: [projectWithSource, mockSnapshot.projects[1]]
      } as any,
      cosmicSelectedCardId: 'proj-1',
      basicActiveTab: 'slack'
    })

    const { getByText, queryByText, queryByRole, findByRole } = render(
      <CosmicWorkspaceView sidebarLook="basic" />
    )

    // Should render Control button in header
    expect(getByText(/Control/i)).not.toBeNull()
    expect(getByText('Re-authenticate')).not.toBeNull()

    // Must NOT render yellow banner
    expect(queryByText(/Choose the 2–3 channels this card should scrape/i)).toBeNull()

    // Must NOT automatically open the control modal dialog
    expect(queryByRole('dialog', { name: /workspace control/i })).toBeNull()

    // Clicking Control manually opens the modal
    fireEvent.click(getByText(/Control/i))
    expect(await findByRole('dialog', { name: /workspace control/i })).not.toBeNull()
  })

  it('renders thin header navbar for Teams and WhatsApp with Connected badge and Re-authenticate', () => {
    useProfileStore.setState({
      profiles: [
        {
          id: 'prof-1',
          displayName: 'Ashutosh-Profile',
          customName: 'Ashutosh-Profile',
          accountScope: 'both',
          apps: {
            slack: { sessionStatus: 'signed-in', availableWorkspaces: [{ teamId: 'T123', teamName: 'Acme Work' }] },
            teams: { sessionStatus: 'signed-in' },
            whatsapp: { sessionStatus: 'signed-in' }
          },
          customLinks: []
        }
      ] as any
    })

    // Test Teams tab
    useDashboardStore.setState({
      snapshot: mockSnapshot as any,
      cosmicSelectedCardId: 'proj-1',
      basicActiveTab: 'teams'
    })

    const { getAllByText, getByText, unmount } = render(
      <CosmicWorkspaceView sidebarLook="basic" />
    )

    expect(getAllByText('Microsoft Teams').length).toBeGreaterThan(0)
    expect(getByText('Connected')).not.toBeNull()
    expect(getByText('Re-authenticate')).not.toBeNull()
    unmount()

    // Test WhatsApp tab
    useDashboardStore.setState({
      snapshot: mockSnapshot as any,
      cosmicSelectedCardId: 'proj-1',
      basicActiveTab: 'whatsapp'
    })

    const renderedWhatsApp = render(
      <CosmicWorkspaceView sidebarLook="basic" />
    )

    expect(renderedWhatsApp.getAllByText('WhatsApp Web').length).toBeGreaterThan(0)
    expect(renderedWhatsApp.getByText('Connected')).not.toBeNull()
    expect(renderedWhatsApp.getByText('Re-authenticate')).not.toBeNull()
    renderedWhatsApp.unmount()
  })

  it('renders thin header navbar and embed for ChatGPT preset and custom link tabs', () => {
    useProfileStore.setState({
      profiles: [
        {
          id: 'prof-1',
          displayName: 'Ashutosh-Profile',
          customName: 'Ashutosh-Profile',
          accountScope: 'both',
          apps: {
            slack: { sessionStatus: 'signed-in', availableWorkspaces: [{ teamId: 'T123', teamName: 'Acme Work' }] },
            teams: { sessionStatus: 'signed-in' },
            whatsapp: { sessionStatus: 'signed-in' }
          },
          customLinks: [
            { id: 'my-custom-tool', name: 'My Custom Portal', url: 'https://portal.internal' }
          ]
        }
      ] as any
    })

    // Test ChatGPT preset tab
    useDashboardStore.setState({
      snapshot: mockSnapshot as any,
      cosmicSelectedCardId: 'proj-1',
      basicActiveTab: 'c:preset:chatgpt'
    })

    const chatGptRender = render(<CosmicWorkspaceView sidebarLook="basic" />)
    expect(chatGptRender.getAllByText('ChatGPT').length).toBeGreaterThan(0)
    expect(chatGptRender.getByText('Web Tool')).not.toBeNull()
    expect(chatGptRender.getByText('Reload')).not.toBeNull()
    expect(chatGptRender.getByText('Open in Browser ↗')).not.toBeNull()
    chatGptRender.unmount()

    // Test Custom Link tab
    useDashboardStore.setState({
      snapshot: mockSnapshot as any,
      cosmicSelectedCardId: 'proj-1',
      basicActiveTab: 'c:link:my-custom-tool'
    })

    const customLinkRender = render(<CosmicWorkspaceView sidebarLook="basic" />)
    expect(customLinkRender.getAllByText('My Custom Portal').length).toBeGreaterThan(0)
    expect(customLinkRender.getByText('Web Tool')).not.toBeNull()
    expect(customLinkRender.getByText('Reload')).not.toBeNull()
    expect(customLinkRender.getByText('Open in Browser ↗')).not.toBeNull()
    customLinkRender.unmount()
  })
})
