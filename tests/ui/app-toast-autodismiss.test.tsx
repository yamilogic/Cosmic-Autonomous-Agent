// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/renderer/src/App'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'
import { useProfileStore } from '../../src/renderer/src/hooks/useProfiles'
import { DEFAULT_APP_SETTINGS } from '../../src/shared/ipc-contract'

describe('App toast auto-dismiss & interactive dismissal', () => {
  let toastCallback: ((msg: string) => void) | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    toastCallback = null

    useProfileStore.setState({
      profiles: [],
      activeProfileId: null,
      activeAppId: null,
      selectedTeamId: null,
      loading: false,
      error: null
    })

    useDashboardStore.setState({
      dashboardOpen: false,
      dashRailExpanded: false,
      cosmicLevel1: 'projects',
      cosmicSelectedCardId: null,
      wizardOpenFor: null,
      snapshot: { projects: [], manualTokens: [], syncIntervalSeconds: 300 },
      recent: [],
      loading: false,
      error: null,
      progress: null,
      syncingProjectIds: []
    })

    const off = (): void => undefined
    ;(window as any).api = {
      app: {
        adminStatus: vi.fn(async () => ({
          authenticated: true,
          configured: true,
          envPathHint: '/tmp/.env'
        })),
        getSettings: vi.fn(async () => DEFAULT_APP_SETTINGS),
        setSettings: vi.fn(async () => DEFAULT_APP_SETTINGS),
        reportActivity: vi.fn(async () => undefined),
        pushRecent: vi.fn(async () => DEFAULT_APP_SETTINGS),
        lock: vi.fn(async () => undefined),
        unlock: vi.fn(async () => undefined),
        adminLogout: vi.fn(async () => undefined),
        testNotification: vi.fn(async () => ({ ok: true })),
        checkUpdates: vi.fn(async () => ({ ok: true })),
        onLockStateChanged: vi.fn(() => off),
        onToast: vi.fn((cb: (msg: string) => void) => {
          toastCallback = cb
          return off
        }),
        onSettingsChanged: vi.fn(() => off)
      },
      profiles: {
        list: vi.fn(async () => []),
        clearStuckAuth: vi.fn(async () => []),
        clearAll: vi.fn(async () => []),
        delete: vi.fn(async () => undefined),
        activate: vi.fn(async () => undefined),
        activateApp: vi.fn(async () => undefined),
        activateSplit: vi.fn(async () => undefined),
        clearSplit: vi.fn(async () => undefined),
        openWorkspace: vi.fn(async () => undefined),
        updateBounds: vi.fn(async () => undefined),
        syncChromeEmbedBounds: vi.fn(async () => undefined),
        setEmbedVisible: vi.fn(async () => undefined),
        setEmbedBounds: vi.fn(async () => undefined),
        startAppLogin: vi.fn(async () => undefined),
        startGoogleAuth: vi.fn(async () => undefined),
        cancelAuthBusy: vi.fn(async () => []),
        cancelChromeEmbed: vi.fn(async () => undefined),
        setCustomName: vi.fn(async () => undefined),
        setMuted: vi.fn(async () => undefined),
        reorder: vi.fn(async () => []),
        exportMetadata: vi.fn(async () => []),
        importMetadata: vi.fn(async () => []),
        create: vi.fn(async () => 'p1'),
        onSessionStatusChanged: vi.fn(() => off),
        onProfileUpdated: vi.fn(() => off),
        onWorkspaceThemeChanged: vi.fn(() => off),
        onAuthProgress: vi.fn(() => off),
        onUnreadCountsChanged: vi.fn(() => off),
        onDeepLink: vi.fn(() => off)
      },
      slack: {
        listWorkspaces: vi.fn(async () => []),
        listChannels: vi.fn(async () => [])
      },
      dashboard: {
        getSnapshot: vi.fn(async () => ({
          projects: [],
          manualTokens: [],
          syncIntervalSeconds: 300
        })),
        getRecent: vi.fn(async () => []),
        getGlobalConfig: vi.fn(async () => null),
        onSnapshotChanged: vi.fn(() => off),
        onSyncProgress: vi.fn(() => off),
        onConfigChanged: vi.fn(() => off),
        onSchedulesChanged: vi.fn(() => off)
      }
    }

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    })
  })

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers()
    })
    vi.useRealTimers()
    cleanup()
  })

  it('renders toast message and automatically dismisses after 4500ms', async () => {
    render(<App />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByRole('status')).toBeNull()

    // Simulate sending a toast
    act(() => {
      toastCallback?.('Google verified! Account available in Global and Individual profiles.')
    })

    const toastEl = screen.getByRole('status')
    expect(toastEl).toBeTruthy()
    expect(toastEl.textContent).toContain('Google verified! Account available in Global and Individual profiles.')

    // Fast-forward 4000ms (toast should still be present)
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.getByRole('status')).toBeTruthy()

    // Fast-forward remaining 500ms (total 4500ms)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('immediately dismisses when clicking the close button', async () => {
    render(<App />)

    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      toastCallback?.('Test notification message')
    })

    expect(screen.getByRole('status')).toBeTruthy()

    const closeBtn = screen.getByRole('button', { name: 'Dismiss notification' })
    act(() => {
      fireEvent.click(closeBtn)
    })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('immediately dismisses when clicking anywhere on the toast body', async () => {
    render(<App />)

    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      toastCallback?.('Click me to dismiss')
    })

    const toastEl = screen.getByRole('status')
    act(() => {
      fireEvent.click(toastEl)
    })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('resets timer when a second toast message arrives before timeout', async () => {
    render(<App />)

    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      toastCallback?.('First message')
    })
    expect(screen.getByText('First message')).toBeTruthy()

    // Advance 3000ms
    act(() => {
      vi.advanceTimersByTime(3000)
    })

    // Second toast arrives
    act(() => {
      toastCallback?.('Second message')
    })
    expect(screen.getByText('Second message')).toBeTruthy()

    // Advance 3000ms (total 6000ms since first, but only 3000ms since second)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    // Second message should still be visible because timer reset
    expect(screen.getByText('Second message')).toBeTruthy()

    // Advance another 1500ms (4500ms since second message)
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
