// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ProfileSidebar } from '../../src/renderer/src/components/ProfileSidebar'
import { DEFAULT_APP_SETTINGS } from '../../src/shared/ipc-contract'
import type { Profile } from '../../src/shared/types'

describe('Fresh Start Sidebar Defaults & Recents Cleanup', () => {
  afterEach(() => {
    cleanup()
  })
  const mockProfiles: Profile[] = [
    {
      id: 'p1',
      displayName: 'Ashutosh-Profile',
      avatarColor: '#8b5cf6',
      googleAuthStatus: 'not-signed-in',
      apps: {
        slack: {
          sessionStatus: 'signed-in',
          availableWorkspaces: [
            {
              teamId: 'T1',
              teamName: 'Acme Slack',
              openUrl: 'https://acme.slack.com',
              lastSeenAt: '2026-11-01T00:00:00.000Z'
            }
          ],
          pinnedWorkspaces: []
        },
        teams: {
          sessionStatus: 'signed-in',
          availableWorkspaces: [
            {
              teamId: 'T2',
              teamName: 'Personal',
              openUrl: 'https://teams.microsoft.com',
              lastSeenAt: '2026-11-01T00:00:00.000Z'
            }
          ],
          pinnedWorkspaces: []
        },
        whatsapp: {
          sessionStatus: 'not-signed-in',
          availableWorkspaces: [],
          pinnedWorkspaces: []
        }
      },
      customLinks: [],
      createdAt: '2026-11-01T00:00:00.000Z'
    }
  ]

  const defaultProps = {
    profiles: mockProfiles,
    activeProfileId: null,
    activeAppId: null,
    selectedTeamId: null,
    syncingProfileId: null,
    email: '',
    onEmailChange: vi.fn(),
    googleBusy: false,
    statusLine: '',
    unreadCounts: {},
    recentWorkspaces: [],
    onAddGoogle: vi.fn(),
    onCancelGoogle: vi.fn(),
    onToggleSidebar: vi.fn(),
    onSelect: vi.fn(),
    onSelectApp: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onToggleMute: vi.fn(),
    onReorder: vi.fn(),
    onOpenInSplit: vi.fn(),
    onOpenWorkspace: vi.fn(),
    onSyncWorkspaces: vi.fn(),
    onPinFromAvailable: vi.fn(),
    onUnpin: vi.fn(),
    onDismissError: vi.fn(),
    onAddPlatform: vi.fn()
  }

  it('verifies DEFAULT_APP_SETTINGS contracts for fresh start', () => {
    expect(DEFAULT_APP_SETTINGS.sidebarLook).toBe('basic')
    expect(DEFAULT_APP_SETTINGS.showLookSwitcher).toBe(false)
    expect(DEFAULT_APP_SETTINGS.showGoogleEmailInputInSidebar).toBe(true)
    expect(DEFAULT_APP_SETTINGS.sidebarButtons).toEqual({
      addWebsite: false,
      newProject: false,
      newProfile: false,
      observer: false,
      profilesHub: false
    })
  })

  it('hides the 4 look switcher buttons on fresh start by default while keeping Basic active', () => {
    render(
      <ProfileSidebar
        {...defaultProps}
      />
    )

    expect(screen.queryByRole('group', { name: /Sidebar Appearance Look/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Basic' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Minimal' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cosmic' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ancient' })).toBeNull()
  })

  it('renders the 4 look switcher buttons when explicitly enabled in settings', () => {
    render(
      <ProfileSidebar
        {...defaultProps}
        showLookSwitcher={true}
      />
    )

    expect(screen.getByRole('group', { name: /Sidebar Appearance Look/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Basic' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Minimal' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cosmic' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ancient' })).toBeTruthy()
  })

  it('hides Recent section on fresh start when recentWorkspaces is empty even if profiles have workspaces', () => {
    const { container } = render(
      <ProfileSidebar
        {...defaultProps}
        recentWorkspaces={[]}
      />
    )

    // Should NOT render recent-strip
    expect(container.querySelector('.recent-strip')).toBeNull()
    expect(screen.queryByText('Recent')).toBeNull()
  })

  it('renders Recent section once a workspace has been explicitly opened into recentWorkspaces', () => {
    render(
      <ProfileSidebar
        {...defaultProps}
        recentWorkspaces={[
          {
            profileId: 'p1',
            appId: 'teams',
            teamId: 'T2',
            label: 'Personal',
            at: '2026-11-02T10:00:00.000Z'
          }
        ]}
      />
    )

    expect(screen.getByText('Recent')).toBeTruthy()
    expect(screen.getByText('Personal')).toBeTruthy()
  })

  it('renders Google email input and Continue with Google on fresh start by default', () => {
    render(
      <ProfileSidebar
        {...defaultProps}
      />
    )

    expect(screen.getByLabelText(/Google email/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Continue with Google/i })).toBeTruthy()
  })

  it('hides Google email input when explicitly disabled', () => {
    render(
      <ProfileSidebar
        {...defaultProps}
        showGoogleEmailInputInSidebar={false}
      />
    )

    expect(screen.queryByLabelText(/Google email/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Continue with Google/i })).toBeNull()
  })

  it('shows only Settings button at the bottom by default and hides the other 5 buttons', () => {
    render(
      <ProfileSidebar
        {...defaultProps}
      />
    )

    // Permanent Settings button is present
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()

    // The other 5 buttons are hidden
    expect(screen.queryByRole('button', { name: 'Add Website' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New Project' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New Profile' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Observer' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Profiles' })).toBeNull()
  })

  it('shows extra bottom buttons when explicitly configured in sidebarButtons', () => {
    render(
      <ProfileSidebar
        {...defaultProps}
        onNewProject={vi.fn()}
        onNewProfile={vi.fn()}
        onObserver={vi.fn()}
        onOpenProfilesHub={vi.fn()}
        sidebarButtons={{
          addWebsite: true,
          newProject: true,
          newProfile: false,
          observer: false,
          profilesHub: true
        }}
      />
    )

    expect(screen.getByRole('button', { name: 'Add Website' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New Project' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Profiles' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()

    expect(screen.queryByRole('button', { name: 'New Profile' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Observer' })).toBeNull()
  })
})
