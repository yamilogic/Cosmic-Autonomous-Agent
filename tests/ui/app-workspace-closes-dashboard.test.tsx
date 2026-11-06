// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/renderer/src/App'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'
import { useProfileStore } from '../../src/renderer/src/hooks/useProfiles'
import type { DashboardSnapshot } from '../../src/shared/dashboard-contract'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../../src/shared/ipc-contract'
import type { Profile } from '../../src/shared/types'

const PROFILE: Profile = {
  id: 'p1',
  displayName: 'owner@example.com',
  createdAt: '2026-10-01T00:00:00.000Z',
  avatarColor: '#3f7cff',
  googleAuthStatus: 'signed-in',
  apps: {
    slack: {
      sessionStatus: 'signed-in',
      availableWorkspaces: [
        {
          teamId: 'T1',
          teamName: 'Acme',
          openUrl: 'https://acme.slack.com',
          lastSeenAt: '2026-10-26T09:00:00.000Z',
          lastChannelName: 'general'
        }
      ],
      pinnedWorkspaces: [{ teamId: 'T1', teamName: 'Acme', openUrl: 'https://acme.slack.com' }]
    },
    teams: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] },
    whatsapp: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] }
  }
}

const SNAPSHOT: DashboardSnapshot = {
  projects: [],
  manualTokens: [],
  syncIntervalSeconds: 300
}

const SETTINGS: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  sidebarLook: 'ancient',
  recentWorkspaces: [
    {
      profileId: 'p1',
      appId: 'slack',
      teamId: 'T1',
      label: 'Acme',
      at: '2026-10-26T10:00:00.000Z'
    }
  ]
}

function installApi(
  options: { activate?: () => Promise<void> } = {}
): { setEmbedVisible: ReturnType<typeof vi.fn> } {
  const off = (): void => undefined
  const setEmbedVisible = vi.fn(async () => undefined)

  const api = {
    app: {
      adminStatus: vi.fn(async () => ({
        authenticated: true,
        configured: true,
        envPathHint: '/tmp/.env'
      })),
      getSettings: vi.fn(async () => SETTINGS),
      setSettings: vi.fn(async () => SETTINGS),
      reportActivity: vi.fn(async () => undefined),
      pushRecent: vi.fn(async () => SETTINGS),
      lock: vi.fn(async () => undefined),
      unlock: vi.fn(async () => undefined),
      adminLogout: vi.fn(async () => undefined),
      testNotification: vi.fn(async () => ({ ok: true })),
      checkUpdates: vi.fn(async () => ({ ok: true })),
      onLockStateChanged: vi.fn(() => off),
      onToast: vi.fn(() => off),
      onSettingsChanged: vi.fn(() => off)
    },
    profiles: {
      list: vi.fn(async () => [PROFILE]),
      clearStuckAuth: vi.fn(async () => [PROFILE]),
      clearAll: vi.fn(async () => []),
      delete: vi.fn(async () => undefined),
      activate: vi.fn(options.activate ?? (async () => undefined)),
      activateApp: vi.fn(async () => undefined),
      activateSplit: vi.fn(async () => undefined),
      clearSplit: vi.fn(async () => undefined),
      openWorkspace: vi.fn(async () => undefined),
      updateBounds: vi.fn(async () => undefined),
      syncChromeEmbedBounds: vi.fn(async () => undefined),
      setEmbedVisible,
      startAppLogin: vi.fn(async () => PROFILE),
      startGoogleAuth: vi.fn(async () => PROFILE),
      cancelAuthBusy: vi.fn(async () => [PROFILE]),
      cancelChromeEmbed: vi.fn(async () => undefined),
      setCustomName: vi.fn(async () => PROFILE),
      setMuted: vi.fn(async () => PROFILE),
      reorder: vi.fn(async () => [PROFILE]),
      exportMetadata: vi.fn(async () => [PROFILE]),
      importMetadata: vi.fn(async () => [PROFILE]),
      onSessionStatusChanged: vi.fn(() => off),
      onProfileUpdated: vi.fn(() => off),
      onWorkspaceThemeChanged: vi.fn(() => off),
      onAuthProgress: vi.fn(() => off),
      onUnreadCountsChanged: vi.fn(() => off),
      onDeepLink: vi.fn(() => off)
    },
    slack: {
      listWorkspaces: vi.fn(async () => [
        {
          profileId: 'p1',
          teamId: 'T1',
          teamName: 'Acme',
          teamDomain: 'acme',
          connectedAt: '2026-10-01T00:00:00.000Z',
          scopes: []
        }
      ]),
      listChannels: vi.fn(async () => [])
    },
    dashboard: {
      getSnapshot: vi.fn(async () => SNAPSHOT),
      getRecent: vi.fn(async () => []),
      getGlobalConfig: vi.fn(async () => null),
      onSnapshotChanged: vi.fn(() => off),
      onSyncProgress: vi.fn(() => off),
      onConfigChanged: vi.fn(() => off),
      onSchedulesChanged: vi.fn(() => off)
    }
  }

  window.api = api as unknown as Window['api']
  return { setEmbedVisible }
}

function resetStores(): void {
  useDashboardStore.setState({
    dashboardOpen: false,
    dashboardAppId: null,
    snapshot: null,
    recent: [],
    loading: false,
    syncingProjectIds: [],
    progress: null,
    error: null,
    wizardOpenFor: null,
    dashRailExpanded: false
  })
  useProfileStore.setState({
    profiles: [PROFILE],
    activeProfileId: 'p1',
    activeAppId: 'slack',
    workspaces: [],
    workspacesByProfileId: {},
    channels: [],
    selectedTeamId: null,
    loading: false,
    syncingProfileId: null,
    error: null
  })
}

async function renderApp(): Promise<void> {
  render(<App />)
  // The Recent strip only appears once app.getSettings resolves; under a fully
  // parallel suite that can pass the 1s default and read as a missing element.
  await screen.findByLabelText('Recent workspaces', {}, { timeout: 5000 })
}

function clickRecentWorkspace(): void {
  const strip = screen.getByLabelText('Recent workspaces')
  fireEvent.click(within(strip).getByRole('button'))
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('onboardingDone', '1')
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false
    })) as unknown as typeof window.matchMedia
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    } as unknown as typeof window.ResizeObserver
  }
})

afterEach(() => {
  cleanup()
})

describe('workspace navigation while the dashboard is open', () => {
  it('closes the dashboard so Slack is not painted under it', async () => {
    resetStores()
    useDashboardStore.getState().openDashboard('slack')
    installApi()

    await renderApp()
    expect(screen.getByTestId('dashboard-view')).toBeTruthy()

    clickRecentWorkspace()

    await waitFor(() => {
      expect(useDashboardStore.getState().dashboardOpen).toBe(false)
    })
    expect(await screen.findByTestId('slack-viewport')).toBeTruthy()
  })

  it('leaves the dashboard Project entry working after a workspace was opened', async () => {
    resetStores()
    useDashboardStore.getState().openDashboard('slack')
    installApi()

    await renderApp()
    clickRecentWorkspace()
    await waitFor(() => {
      expect(useDashboardStore.getState().dashboardOpen).toBe(false)
    })

    fireEvent.click(screen.getByTestId('dashboard-toggle'))
    fireEvent.click(await screen.findByTestId('dashboard-app-slack'))

    expect(useDashboardStore.getState().dashboardOpen).toBe(true)
    expect(screen.getByTestId('dashboard-view')).toBeTruthy()
  })

  it('keeps the workspace open when profile activation finishes late', async () => {
    resetStores()
    useProfileStore.setState({ activeProfileId: null, activeAppId: null })
    let releaseActivate!: () => void
    const activation = new Promise<void>((resolve) => {
      releaseActivate = resolve
    })
    installApi({ activate: () => activation })

    await renderApp()
    clickRecentWorkspace()
    await waitFor(() => {
      expect(useProfileStore.getState().activeProfileId).toBe('p1')
    })

    await act(async () => {
      releaseActivate()
      await activation
    })

    await waitFor(() => {
      expect(useProfileStore.getState().activeAppId).toBe('slack')
    })
    expect(await screen.findByTestId('slack-viewport')).toBeTruthy()
  })
})
