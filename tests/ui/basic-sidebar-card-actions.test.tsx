// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BasicSidebarProjectTree } from '../../src/renderer/src/components/dashboard/BasicSidebarProjectTree'
import { AccountsManagementModal } from '../../src/renderer/src/components/dashboard/AccountsManagementModal'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'
import { useProfileStore } from '../../src/renderer/src/hooks/useProfiles'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

describe('Basic UI Sidebar Project Card Actions (Mute, Hide, Delete & Restore)', () => {
  afterEach(() => {
    cleanup()
  })

  const mockProject1: DashboardProject = {
    id: 'proj-1',
    name: 'Testing01',
    clientName: 'Client Alpha',
    profileId: 'prof-1',
    teamId: 'T1',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [],
    workflowStatus: 'active',
    createdAt: new Date().toISOString()
  }

  const mockProject2: DashboardProject = {
    id: 'proj-2',
    name: 'Beta Website Redesign',
    clientName: 'Client Beta',
    profileId: 'client-prof-1',
    teamId: 'T2',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [],
    workflowStatus: 'active',
    createdAt: new Date().toISOString()
  }

  const mockSnapshot = {
    teamWorkspace: null,
    manualTokens: [],
    syncIntervalSeconds: 60,
    pinnedOrder: [],
    projects: [
      {
        project: mockProject1,
        sources: [],
        syncState: 'idle',
        summary: '',
        newMessageCount: 0,
        totalMessageCount: 0,
        completion: 0,
        pace: 'on-track',
        mood: { state: 'neutral', signal: '' },
        extractedDates: {},
        effectiveDates: {},
        perChannel: [],
        lastUpdatedAt: new Date().toISOString()
      },
      {
        project: mockProject2,
        sources: [],
        syncState: 'idle',
        summary: '',
        newMessageCount: 0,
        totalMessageCount: 0,
        completion: 0,
        pace: 'on-track',
        mood: { state: 'neutral', signal: '' },
        extractedDates: {},
        effectiveDates: {},
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

    useProfileStore.setState({
      profiles: [
        {
          id: 'prof-1',
          displayName: 'Ashutosh-Profile',
          avatarColor: '#6366f1',
          googleAuthStatus: 'signed-in',
          createdAt: new Date().toISOString(),
          apps: {
            slack: { sessionStatus: 'signed-in', availableWorkspaces: [], pinnedWorkspaces: [] },
            teams: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] },
            whatsapp: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] }
          }
        },
        {
          id: 'client-prof-1',
          displayName: 'Acme-Client',
          accountScope: 'individual',
          avatarColor: '#10b981',
          googleAuthStatus: 'signed-in',
          createdAt: new Date().toISOString(),
          apps: {
            slack: { sessionStatus: 'signed-in', availableWorkspaces: [], pinnedWorkspaces: [] },
            teams: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] },
            whatsapp: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] }
          }
        }
      ]
    })

    window.api = {
      dashboard: {
        upsertProject: vi.fn().mockImplementation(async ({ project }) => {
          const current = useDashboardStore.getState().snapshot?.projects ?? []
          const updated = current.map((p) =>
            p.project.id === project.id ? { ...p, project: { ...p.project, ...project } } : p
          )
          return { ...mockSnapshot, projects: updated }
        }),
        deleteProject: vi.fn().mockImplementation(async ({ projectId }) => {
          const current = useDashboardStore.getState().snapshot?.projects ?? []
          const updated = current.filter((p) => p.project.id !== projectId)
          return { ...mockSnapshot, projects: updated }
        })
      },
      profiles: {
        setHiddenInSidebar: vi.fn().mockResolvedValue({ id: 'prof-1', hiddenInSidebar: true })
      }
    } as any
  })

  it('renders Mute and Cross (✕) buttons on each project card row in the Basic UI', () => {
    render(<BasicSidebarProjectTree baseAppLayout="standard" />)

    expect(screen.getByText('Testing01')).toBeTruthy()
    expect(screen.getByText('Beta Website Redesign')).toBeTruthy()

    const muteButtons = screen.getAllByRole('button', { name: /Mute notifications for/i })
    expect(muteButtons.length).toBe(2)

    const removeButtons = screen.getAllByRole('button', { name: /Remove .* from sidebar/i })
    expect(removeButtons.length).toBe(2)
  })

  it('toggles Mute on a project card when Mute button is clicked', async () => {
    render(<BasicSidebarProjectTree baseAppLayout="standard" />)

    const muteBtn = screen.getByRole('button', { name: 'Mute notifications for Testing01' })
    fireEvent.click(muteBtn)

    await waitFor(() => {
      expect(window.api.dashboard.upsertProject).toHaveBeenCalledWith(
        expect.objectContaining({
          project: expect.objectContaining({ id: 'proj-1', muted: true })
        })
      )
    })
  })

  it('opens CardRemoveOrDeleteModal when cross button is clicked on a card', () => {
    render(<BasicSidebarProjectTree baseAppLayout="standard" />)

    const removeBtn = screen.getByRole('button', { name: 'Remove Testing01 from sidebar' })
    fireEvent.click(removeBtn)

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Remove Card from Sidebar')).toBeTruthy()
    expect(screen.getAllByText(/Testing01/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Hiding keeps all data safe/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Hide from Sidebar/i })).toBeTruthy()
  })

  it('CardRemoveOrDeleteModal calls onHide and hides the card from the sidebar list', async () => {
    const onToast = vi.fn()
    render(<BasicSidebarProjectTree baseAppLayout="standard" onToast={onToast} />)

    const removeBtn = screen.getByRole('button', { name: 'Remove Testing01 from sidebar' })
    fireEvent.click(removeBtn)

    const hideBtn = screen.getByRole('button', { name: /Hide from Sidebar/i })
    fireEvent.click(hideBtn)

    await waitFor(() => {
      expect(window.api.dashboard.upsertProject).toHaveBeenCalledWith(
        expect.objectContaining({
          project: expect.objectContaining({ id: 'proj-1', hiddenInSidebar: true })
        })
      )
    })
  })

  it('CardRemoveOrDeleteModal allows expanding permanent delete and deleting the card', async () => {
    const onToast = vi.fn()
    render(<BasicSidebarProjectTree baseAppLayout="standard" onToast={onToast} />)

    const removeBtn = screen.getByRole('button', { name: 'Remove Testing01 from sidebar' })
    fireEvent.click(removeBtn)

    const expandDeleteBtn = screen.getByRole('button', { name: /Delete Card permanently\.\.\./i })
    fireEvent.click(expandDeleteBtn)

    const confirmDeleteBtn = screen.getByRole('button', { name: /Yes, Permanently Delete Card/i })
    fireEvent.click(confirmDeleteBtn)

    await waitFor(() => {
      expect(window.api.dashboard.deleteProject).toHaveBeenCalledWith({ projectId: 'proj-1' })
    })
  })

  it('filters out projects where hiddenInSidebar is true', () => {
    useDashboardStore.setState({
      snapshot: {
        ...mockSnapshot,
        projects: [
          mockSnapshot.projects[0],
          {
            ...mockSnapshot.projects[1],
            project: { ...mockProject2, hiddenInSidebar: true }
          }
        ]
      } as any
    })

    render(<BasicSidebarProjectTree baseAppLayout="standard" />)

    expect(screen.getByText('Testing01')).toBeTruthy()
    expect(screen.queryByText('Beta Website Redesign')).toBeNull()
  })

  it('in AccountsManagementModal, allows toggling card visibility to restore to the sidebar', async () => {
    // Project 2 is hidden
    useDashboardStore.setState({
      snapshot: {
        ...mockSnapshot,
        projects: [
          mockSnapshot.projects[0],
          {
            ...mockSnapshot.projects[1],
            project: { ...mockProject2, hiddenInSidebar: true }
          }
        ]
      } as any
    })

    render(
      <AccountsManagementModal
        open={true}
        onClose={vi.fn()}
        onSelectProfile={vi.fn()}
      />
    )

    // Select Individual Profiles tab where cards are listed
    const individualTab = screen.getByRole('button', { name: /Acme-Client/i })
    fireEvent.click(individualTab)

    // Should display the hidden badge
    expect(screen.getByText('🚫 Hidden from sidebar')).toBeTruthy()

    // Clicking "Show in sidebar" should unhide it
    const showBtn = screen.getByRole('button', { name: /Show in sidebar/i })
    fireEvent.click(showBtn)

    await waitFor(() => {
      expect(window.api.dashboard.upsertProject).toHaveBeenCalledWith(
        expect.objectContaining({
          project: expect.objectContaining({ id: 'proj-2', hiddenInSidebar: false })
        })
      )
    })
  })
})
