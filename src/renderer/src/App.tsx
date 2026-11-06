import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { APP_DISPLAY_NAME } from '../../shared/brand'
import type { AppSettings } from '../../shared/ipc-contract'
import { DEFAULT_APP_SETTINGS } from '../../shared/ipc-contract'
import type { AppId, Profile, ViewportBounds } from '../../shared/types'
import { APP_IDS } from '../../shared/types'
import appIcon from './assets/app-icon.png'
import { AuthChromePane, type AuthChromePhase } from './components/AuthChromePane'
import { AdminLoginOverlay } from './components/AdminLoginOverlay'
import { CommandPalette } from './components/CommandPalette'
import { LockOverlay } from './components/LockOverlay'
import { ProfileSidebar } from './components/ProfileSidebar'
import DashboardView from './components/dashboard/DashboardView'
import DashboardRail from './components/dashboard/DashboardRail'
import { CosmicWorkspaceView } from './components/dashboard/CosmicWorkspaceView'
import { useDashboardStore } from './hooks/useDashboard'
import ObserverView from './components/dashboard/ObserverView'
import { SidebarPanelIcon } from './components/SidebarPanelIcon'
import { SlackViewport } from './components/SlackViewport'
import { PlatformSettingsPanel } from './components/dashboard/PlatformSettingsPanel'
import { AddPlatformPage } from './components/dashboard/AddPlatformPage'
import { AccountsManagementModal } from './components/dashboard/AccountsManagementModal'
import { DeleteConfirmNoticeModal, type ProfileDeleteTarget } from './components/dashboard/DeleteConfirmNoticeModal'
import { UnifiedSettingsModal, type SettingsTabKey } from './components/dashboard/UnifiedSettingsModal'
import { NewProfileModal } from './components/dashboard/NewProfileModal'
import { NewProjectModal } from './components/dashboard/NewProjectModal'
import { CardPickerModal } from './components/dashboard/CardPickerModal'
import { CardAddModal } from './components/dashboard/CardAddModal'
import type { DashboardProject } from '../../shared/dashboard-contract'
import { sidebarToastFor } from './lib/sidebar-toast'
import { modKey, modShift } from './lib/shortcut-label'
import { useProfileStore } from './hooks/useProfiles'
import {
  applyAppBrandTheme,
  applyDocumentTheme,
  applySidebarDensity,
  applySidebarWidth,
  applyWorkspaceTheme,
  resetWorkspaceTheme
} from './lib/workspace-theme'

function viewportBounds(): ViewportBounds {
  const el = document.querySelector('[data-testid="slack-viewport"]')
  const rect = el?.getBoundingClientRect()
  if (rect && rect.width >= 40 && rect.height >= 40) {
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  }
  const rail = document.querySelector('.sidebar-rail')
  const topbar = document.querySelector('.app-topbar')
  const railW = rail?.getBoundingClientRect().width ?? 300
  const topH = topbar?.getBoundingClientRect().height ?? 0
  return {
    x: Math.round(railW),
    y: Math.round(topH),
    width: Math.max(40, Math.round(window.innerWidth - railW)),
    height: Math.max(40, Math.round(window.innerHeight - topH))
  }
}

function splitBounds(): { primary: ViewportBounds; secondary: ViewportBounds } {
  const full = viewportBounds()
  const half = Math.floor(full.width / 2)
  return {
    primary: { ...full, width: half },
    secondary: { ...full, x: full.x + half, width: full.width - half }
  }
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function App(): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [localAuthPhase, setLocalAuthPhase] = useState<'google' | 'slack' | null>(null)
  const [statusLine, setStatusLine] = useState(
    'Enter Google email → Continue. Slack / Teams / WhatsApp open from the sidebar.'
  )
  const [cmdkOpen, setCmdkOpen] = useState(false)
  const [showObserverView, setShowObserverView] = useState(false)
  const [sidebarDeleteTarget, setSidebarDeleteTarget] = useState<ProfileDeleteTarget | null>(null)
  const [unifiedSettingsOpen, setUnifiedSettingsOpen] = useState(false)
  const [unifiedSettingsTab, setUnifiedSettingsTab] = useState<SettingsTabKey>('general')
  const [platformSettings, setPlatformSettings] = useState<{
    profileId: string
    appId: AppId
  } | null>(null)
  const [addPlatformOpen, setAddPlatformOpen] = useState(false)
  const [newProfileModalOpen, setNewProfileModalOpen] = useState(false)
  const [initialNewProfileEmail, setInitialNewProfileEmail] = useState<string | null>(null)
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false)
  const [accountsModalOpen, setAccountsModalOpen] = useState(false)
  const [cardPickerOpen, setCardPickerOpen] = useState(false)
  const [cardAddProject, setCardAddProject] = useState<DashboardProject | null>(null)
  const [activeCustomLinkId, setActiveCustomLinkId] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [locked, setLocked] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [adminReady, setAdminReady] = useState(false)
  const [adminAuthenticated, setAdminAuthenticated] = useState(false)
  const [adminConfigured, setAdminConfigured] = useState(true)
  const [adminEnvPathHint, setAdminEnvPathHint] = useState(
    '~/Library/Application Support/slack-dashboard/.env'
  )
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [toast, setToastState] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(
    () => localStorage.getItem('onboardingDone') !== '1'
  )
  const [splitSecondary, setSplitSecondary] = useState<{
    profileId: string
    appId: AppId
  } | null>(null)
  const lastAppByProfile = useRef<Record<string, AppId>>({})
  const sidebarCollapsedRef = useRef(settings.sidebarCollapsed)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const {
    profiles,
    activeProfileId,
    activeAppId,
    selectedTeamId,
    error,
    loadProfiles,
    createProfile,
    deleteProfile,
    clearStuckAuth,
    activateProfile,
    selectApp,
    startAppLogin,
    startGoogleAuth,
    openWorkspace,
    pinFromAvailable,
    unpinWorkspace,
    applyProfileUpdate,
    applySessionStatus,
    clearError
  } = useProfileStore(
    useShallow((s) => ({
      profiles: s.profiles,
      activeProfileId: s.activeProfileId,
      activeAppId: s.activeAppId,
      selectedTeamId: s.selectedTeamId,
      error: s.error,
      loadProfiles: s.loadProfiles,
      createProfile: s.createProfile,
      deleteProfile: s.deleteProfile,
      clearStuckAuth: s.clearStuckAuth,
      activateProfile: s.activateProfile,
      selectApp: s.selectApp,
      startAppLogin: s.startAppLogin,
      startGoogleAuth: s.startGoogleAuth,
      openWorkspace: s.openWorkspace,
      pinFromAvailable: s.pinFromAvailable,
      unpinWorkspace: s.unpinWorkspace,
      applyProfileUpdate: s.applyProfileUpdate,
      applySessionStatus: s.applySessionStatus,
      clearError: s.clearError
    }))
  )

  const refreshSettings = useCallback(async () => {
    const s = await window.api.app.getSettings()
    setSettings(s)
    applyDocumentTheme(s.theme)
    applySidebarDensity(s.sidebarDensity)
    applySidebarWidth(s.sidebarWidth)
  }, [])

  useEffect(() => {
    void window.api.app
      .adminStatus()
      .then((status) => {
        setAdminConfigured(status.configured)
        setAdminAuthenticated(status.authenticated)
        if (status.envPathHint) setAdminEnvPathHint(status.envPathHint)
        setAdminReady(true)
      })
      .catch((err) => {
        console.error('Failed to get admin status', err)
        setAdminReady(true)
      })
  }, [])

  useEffect(() => {
    if (!adminAuthenticated) return
    void (async () => {
      await clearStuckAuth()
      await loadProfiles()
      await refreshSettings()
    })()
  }, [adminAuthenticated, loadProfiles, clearStuckAuth, refreshSettings])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (): void => {
      if (settings.theme === 'system') applyDocumentTheme('system')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [settings.theme])

  useEffect(() => {
    return window.api.profiles.onSessionStatusChanged(({ profileId, appId, sessionStatus }) => {
      applySessionStatus(profileId, appId, sessionStatus)
    })
  }, [applySessionStatus])

  useEffect(() => {
    return window.api.profiles.onProfileUpdated((profile) => {
      applyProfileUpdate(profile)
    })
  }, [applyProfileUpdate])

  useEffect(() => {
    return window.api.profiles.onWorkspaceThemeChanged((payload) => {
      applyWorkspaceTheme(payload)
    })
  }, [])

  useEffect(() => {
    return window.api.profiles.onAuthProgress((message) => {
      if (message.startsWith('open-profile:')) {
        const id = message.slice('open-profile:'.length)
        void activateProfile(id, viewportBounds())
        return
      }
      if (message.startsWith('open-app:')) {
        const parts = message.split(':')
        const profileId = parts[1]
        const appId = parts[2] as AppId
        if (profileId && APP_IDS.includes(appId)) {
          lastAppByProfile.current[profileId] = appId
          void selectApp(profileId, appId, viewportBounds())
        }
        return
      }
      setStatusLine(message)
    })
  }, [activateProfile, selectApp])

  useEffect(() => {
    return window.api.profiles.onUnreadCountsChanged((counts) => {
      setUnreadCounts(counts)
    })
  }, [])

  useEffect(() => {
    return window.api.app.onLockStateChanged((next) => {
      setLocked(next)
    })
  }, [])

  useEffect(() => {
    sidebarCollapsedRef.current = settings.sidebarCollapsed
  }, [settings.sidebarCollapsed])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  const showToast = useCallback((message: string | null, ms = 4500): void => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }
    setToastState(message)
    if (message) {
      void window.api?.logs?.logAction('ui', 'info', `Notification: ${message}`)
      toastTimerRef.current = setTimeout(() => {
        toastTimerRef.current = null
        setToastState(null)
      }, ms)
    }
  }, [])

  const setToast = showToast

  useEffect(() => {
    return window.api.app.onToast((message) => showToast(message))
  }, [showToast])

  useEffect(() => {
    return window.api.app.onSettingsChanged((next) => {
      setSettings(next)
      applyDocumentTheme(next.theme)
      applySidebarDensity(next.sidebarDensity)
      applySidebarWidth(next.sidebarWidth)
      window.dispatchEvent(new CustomEvent('orbit:settings-changed', { detail: next }))
    })
  }, [])

  useEffect(() => {
    if (!window.api?.dashboard?.onSnapshotChanged) return
    const offSnapshot = window.api.dashboard.onSnapshotChanged((nextSnapshot) => {
      useDashboardStore.getState().applySnapshot(nextSnapshot)
    })
    const offProgress = window.api.dashboard.onSyncProgress?.((payload) => {
      useDashboardStore.getState().applyProgress?.(payload)
      if (payload.phase === 'complete' || payload.phase === 'error') {
        window.setTimeout(() => {
          void useDashboardStore.getState().loadSnapshot().catch(() => {})
        }, 250)
      }
    })
    return () => {
      offSnapshot()
      offProgress?.()
    }
  }, [])

  useEffect(() => {
    return window.api.profiles.onDeepLink(({ profileId, appId, teamId }) => {
      void (async () => {
        await activateProfile(profileId, viewportBounds())
        if (appId && APP_IDS.includes(appId)) {
          await selectApp(profileId, appId, viewportBounds())
          if (teamId) {
            await openWorkspace(profileId, appId, teamId, viewportBounds())
          }
        }
      })()
    })
  }, [activateProfile, selectApp, openWorkspace])

  useEffect(() => {
    let lastSent = 0
    const bump = (): void => {
      const now = Date.now()
      if (now - lastSent < 2500) return
      lastSent = now
      void window.api.app.reportActivity()
    }
    window.addEventListener('pointerdown', bump)
    window.addEventListener('keydown', bump)
    return () => {
      window.removeEventListener('pointerdown', bump)
      window.removeEventListener('keydown', bump)
    }
  }, [])

  useEffect(() => {
    if (!activeAppId) {
      resetWorkspaceTheme()
      return
    }
    applyAppBrandTheme(activeAppId)
  }, [activeAppId])

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null
  const googleSigningIn = activeProfile?.googleAuthStatus === 'signing-in'
  const slackSigningIn = activeProfile?.apps.slack.sessionStatus === 'signing-in-slack'
  const whatsappSigningIn = activeProfile?.apps.whatsapp.sessionStatus === 'signing-in'

  const authPhase: AuthChromePhase | null = googleSigningIn
    ? 'google'
    : slackSigningIn
      ? 'slack'
      : localAuthPhase

  const browserAuthBusy = authPhase === 'google' || authPhase === 'slack'
  const cosmicLevel1 = useDashboardStore((s) => s.cosmicLevel1)
  const cosmicSelectedCardId = useDashboardStore((s) => s.cosmicSelectedCardId)
  const snapshot = useDashboardStore((s) => s.snapshot)
  const commandPaletteProjects = useMemo(() => {
    if (!snapshot?.projects) return []
    return snapshot.projects
      .map((p) => {
        const proj = (p as any).project ?? p
        if (!proj || !proj.id) return null
        return {
          id: String(proj.id),
          name: String(proj.name || 'Untitled Project'),
          clientName: proj.clientName ? String(proj.clientName) : undefined
        }
      })
      .filter(Boolean) as Array<{ id: string; name: string; clientName?: string }>
  }, [snapshot])
  const isCosmicActive = settings.sidebarLook === 'new-cosmic'
  const isMinimalActive = settings.sidebarLook === 'minimal'
  const isBasicActive = settings.sidebarLook === 'basic'
  const isCosmicOrMinimal = isCosmicActive || isMinimalActive || isBasicActive
  const showCosmicCard = Boolean(isCosmicOrMinimal && cosmicSelectedCardId && !browserAuthBusy)
  const dashboardOpen = useDashboardStore((s) => s.dashboardOpen)
  const closeDashboard = useDashboardStore((s) => s.closeDashboard)
  const isCosmicProfileActive = Boolean(
    isCosmicActive && cosmicLevel1 && cosmicLevel1 !== 'all' && cosmicLevel1 !== 'global'
  )
  const showDashboard =
    !isMinimalActive &&
    !isBasicActive &&
    (dashboardOpen ||
      (isCosmicActive && (cosmicLevel1 === 'all' || (isCosmicProfileActive && !cosmicSelectedCardId)))) &&
    !browserAuthBusy &&
    !showCosmicCard
  const wizardOpen = useDashboardStore((s) => s.wizardOpenFor) != null
  const splitOn =
    settings.splitViewEnabled && Boolean(splitSecondary) && !browserAuthBusy && !locked
  // Keep embed mounted for WhatsApp QR even while status is signing-in / not yet linked.
  // Hide native WebContentsViews while HTML overlays (settings / cmdk / onboarding / modals) are open
  // — otherwise they paint above the renderer and block the modal.
  const showEmbed = Boolean(
    adminAuthenticated &&
    activeProfile &&
    (activeAppId || activeCustomLinkId) &&
    !showDashboard &&
    !showCosmicCard &&
    !showObserverView &&
    !wizardOpen &&
    !browserAuthBusy &&
    !locked &&
    !unifiedSettingsOpen &&
    !cmdkOpen &&
    !platformSettings &&
    !addPlatformOpen &&
    !accountsModalOpen &&
    !showOnboarding &&
    !newProjectModalOpen &&
    !newProfileModalOpen &&
    !cardPickerOpen &&
    !cardAddProject &&
    !sidebarDeleteTarget
  )

  useEffect(() => {
    void window.api.profiles.setEmbedVisible(showEmbed)
  }, [showEmbed])

  useEffect(() => {
    if (!splitOn || !activeProfileId || !activeAppId || !splitSecondary) {
      void window.api.profiles.clearSplit()
      return
    }
    const { primary, secondary } = splitBounds()
    void window.api.profiles.activateSplit(
      { profileId: activeProfileId, appId: activeAppId, bounds: primary },
      {
        profileId: splitSecondary.profileId,
        appId: splitSecondary.appId,
        bounds: secondary
      }
    )
  }, [splitOn, activeProfileId, activeAppId, splitSecondary])

  const handleSidebarResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = settings.sidebarWidth
      const target = e.currentTarget
      target.classList.add('is-dragging')
      document.body.classList.add('is-resizing-sidebar')
      target.setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent): void => {
        const next = Math.min(520, Math.max(220, Math.round(startW + (ev.clientX - startX))))
        applySidebarWidth(next)
        setSettings((s) => (s.sidebarWidth === next ? s : { ...s, sidebarWidth: next }))
      }

      const onUp = (ev: PointerEvent): void => {
        target.releasePointerCapture(ev.pointerId)
        target.classList.remove('is-dragging')
        document.body.classList.remove('is-resizing-sidebar')
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')
        const width = Number.parseInt(raw, 10)
        const finalW = Number.isFinite(width) ? width : startW
        void window.api.app.setSettings({ sidebarWidth: finalW }).then((s) => {
          setSettings(s)
          applySidebarWidth(s.sidebarWidth)
        })
        // Embed bounds update after layout settles.
        window.requestAnimationFrame(() => {
          const bounds = viewportBounds()
          if (useProfileStore.getState().activeAppId) {
            void window.api.profiles.updateBounds(bounds)
          }
        })
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [settings.sidebarWidth]
  )

  const setSidebarCollapsed = useCallback(
    (collapsed: boolean) => {
      void window.api.app.setSettings({ sidebarCollapsed: collapsed }).then((s) => {
        const previousCollapsed = sidebarCollapsedRef.current
        sidebarCollapsedRef.current = s.sidebarCollapsed
        setSettings(s)
        if (!s.sidebarCollapsed) {
          applySidebarWidth(s.sidebarWidth)
          if (toastTimerRef.current) {
            clearTimeout(toastTimerRef.current)
            toastTimerRef.current = null
          }
          setToast(null)
        } else {
          const message = sidebarToastFor(previousCollapsed, s.sidebarCollapsed)
          if (message) showToast(message, 6000)
        }
        window.dispatchEvent(new Event('resize'))
        window.dispatchEvent(new CustomEvent('layout-bounds-change'))
        const startTime = Date.now()
        const loop = () => {
          window.dispatchEvent(new CustomEvent('layout-bounds-change'))
          if (Date.now() - startTime < 420) {
            window.requestAnimationFrame(loop)
          }
        }
        window.requestAnimationFrame(loop)

        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            const bounds = viewportBounds()
            if (useProfileStore.getState().activeAppId && !showCosmicCard) {
              void window.api.profiles.updateBounds(bounds)
            }
          })
        })
      })
    },
    [showToast]
  )

  const handleAuthDockBounds = useCallback((bounds: ViewportBounds) => {
    void window.api.profiles.syncChromeEmbedBounds(bounds)
  }, [])

  const handleBoundsChange = useCallback(
    (bounds: ViewportBounds) => {
      if (activeProfileId && activeAppId && showEmbed && !splitOn) {
        void window.api.profiles.updateBounds(bounds)
      }
    },
    [activeProfileId, activeAppId, showEmbed, splitOn]
  )

  const handleSelectProfile = useCallback(
    async (profileId: string) => {
      setActiveCustomLinkId(null)
      if (profileId === activeProfileId) {
        return
      }
      const profile = useProfileStore.getState().profiles.find((p) => p.id === profileId)
      const lastApp = lastAppByProfile.current[profileId]
      if (lastApp && profile?.apps[lastApp].sessionStatus === 'signed-in') {
        await selectApp(profileId, lastApp, viewportBounds())
        return
      }
      await activateProfile(profileId, viewportBounds())
      setStatusLine('Choose Slack, Teams, or WhatsApp under the profile.')
    },
    [activeProfileId, activateProfile, selectApp]
  )

  const handleSelectCustomLink = useCallback(
    async (profileId: string, link: import('../../shared/types').CustomLink) => {
      closeDashboard()
      setActiveCustomLinkId(link.id)
      useProfileStore.setState({ activeProfileId: profileId, activeAppId: null })
      const bounds = viewportBounds()
      await window.api.profiles.activateCustomLink(profileId, link.id, link.url, bounds)
      setStatusLine(`Viewing ${link.name} · ${link.url}`)
    },
    [closeDashboard]
  )

  const handleSidebarSelectApp = useCallback(
    (profileId: string, appId: AppId) => {
      setActiveCustomLinkId(null)
      void (async () => {
        closeDashboard()
        const refreshed = useProfileStore.getState().profiles.find((p) => p.id === profileId)
        const signedIn = refreshed?.apps[appId].sessionStatus === 'signed-in'

        if (appId === 'slack') {
          if (!signedIn) {
            setLocalAuthPhase('slack')
            setStatusLine('Opening Chrome for Slack…')
            await nextPaint()
            try {
              await startAppLogin(profileId, appId, viewportBounds())
              const after = useProfileStore.getState().profiles.find((p) => p.id === profileId)
              if (after?.apps.slack.sessionStatus === 'signed-in') {
                await selectApp(profileId, 'slack', viewportBounds())
                lastAppByProfile.current[profileId] = 'slack'
                setStatusLine('Slack embedded — same Google browser session.')
              }
            } finally {
              setLocalAuthPhase(null)
            }
          } else {
            await selectApp(profileId, appId, viewportBounds())
            lastAppByProfile.current[profileId] = appId
            setStatusLine('Slack embedded in the right pane.')
          }
          return
        }

        await selectApp(profileId, appId, viewportBounds())
        lastAppByProfile.current[profileId] = appId
        setStatusLine(
          appId === 'teams'
            ? 'Microsoft sign-in opens in the right pane, then Teams.'
            : 'WhatsApp Web — scan the QR with your phone if prompted.'
        )
      })()
    },
    [closeDashboard, selectApp, startAppLogin]
  )

  const handleAddGoogle = useCallback(async () => {
    const hint = email.trim()
    setInitialNewProfileEmail(hint || null)
    setEmail('')
    setNewProfileModalOpen(true)
  }, [email])

  const handleCreateAndAuthProfile = useCallback(
    async (
      displayName: string,
      targetEmail: string,
      mode?: 'under_global' | 'individual' | 'both',
      forceReauth?: boolean
    ) => {
      const hint = targetEmail.trim()
      if (!hint) return
      setLocalAuthPhase('google')
      setStatusLine('Opening Chrome for Google authentication…')
      try {
        const profile = await createProfile(hint)
        const targetProfileId = profile.id
        const finalDisplayName = displayName.trim() || hint
        await window.api.profiles.setCustomName(profile.id, finalDisplayName)

        // Set account scope: 'global' for global pool, 'individual' for individual client profiles, or 'both'
        const scope = mode === 'under_global' ? 'global' : mode === 'both' ? 'both' : 'individual'
        await window.api.profiles.setAccountScope(targetProfileId, scope)
        await loadProfiles()

        const latest = useProfileStore.getState().profiles.find((p) => p.id === targetProfileId)
        const googleOk = latest?.googleAuthStatus === 'signed-in'

        if (googleOk && !forceReauth) {
          await activateProfile(targetProfileId, viewportBounds())
          setToast(
            mode === 'both'
              ? `Profile ${finalDisplayName} linked to Global & Individual accounts!`
              : mode === 'under_global'
                ? `Account ${finalDisplayName} linked to Global accounts!`
                : `Profile ${finalDisplayName} ready.`
          )
          return
        }

        useProfileStore.setState((s) => ({
          profiles: s.profiles.map((p) =>
            p.id === targetProfileId ? { ...p, googleAuthStatus: 'signing-in' } : p
          )
        }))
        await activateProfile(targetProfileId, viewportBounds())
        await nextPaint()
        await new Promise((r) => setTimeout(r, 50))
        setStatusLine('Waiting for Google / 2SV…')
        await startGoogleAuth(targetProfileId, viewportBounds())
        await loadProfiles()
        const updated = useProfileStore.getState().profiles.find((p) => p.id === targetProfileId)
        if (updated?.googleAuthStatus === 'signed-in') {
          setToast(
            mode === 'both'
              ? `Google verified! Account available in Global and Individual profiles.`
              : mode === 'under_global'
                ? `Google verified and added to Global Accounts!`
                : `Google verified! Profile ${displayName || hint} created.`
          )
          setStatusLine('Google done. Open Slack under this profile to continue.')
        } else if (!updated) {
          setStatusLine('Cancelled — unsigned profile removed.')
        } else {
          setStatusLine('Google sign-in did not finish. Try again.')
        }
      } catch (err) {
        setStatusLine(String(err))
      } finally {
        setLocalAuthPhase(null)
      }
    },
    [createProfile, activateProfile, startGoogleAuth, loadProfiles]
  )

  const handleCancelChrome = useCallback(() => {
    void window.api.profiles.cancelAuthBusy(activeProfileId ?? undefined)
    void window.api.profiles.cancelChromeEmbed()
    setLocalAuthPhase(null)
    setStatusLine('Cancelled.')
    void loadProfiles()
  }, [activeProfileId, loadProfiles])

  const handleOpenWorkspace = useCallback(
    (profileId: string, appId: AppId, teamId: string) => {
      // Opening a workspace paints the native Slack view; the dashboard must
      // close first so React and the embed stay in sync (same as app rows).
      closeDashboard()
      void (async () => {
        await openWorkspace(profileId, appId, teamId, viewportBounds())
        const profile = useProfileStore.getState().profiles.find((p) => p.id === profileId)
        const available = profile?.apps[appId].availableWorkspaces.find((w) => w.teamId === teamId)
        const pinned = profile?.apps[appId].pinnedWorkspaces.find((w) => w.teamId === teamId)
        const next = await window.api.app.pushRecent({
          profileId,
          appId,
          teamId,
          label:
            available?.lastChannelName?.trim() || available?.teamName || pinned?.teamName || teamId
        })
        setSettings(next)
      })()
    },
    [closeDashboard, openWorkspace]
  )

  const emptyCopy = useMemo(() => {
    if (profiles.length === 0) {
      return {
        title: 'Add a Google account',
        body: 'Enter an email in the sidebar and continue with Google to create your first profile.'
      }
    }
    if (!activeProfileId) {
      return {
        title: 'Select a profile',
        body: 'Pick a profile in the sidebar, then open Slack, Teams, or WhatsApp.'
      }
    }
    if (activeProfile && activeProfile.googleAuthStatus !== 'signed-in') {
      return {
        title: 'Finish Google sign-in',
        body: 'Use Continue with Google for this email, then open an app under the profile.'
      }
    }
    return {
      title: 'Pick an app',
      body: 'Open Slack, Teams, or WhatsApp under the selected profile. The embed appears here.'
    }
  }, [profiles.length, activeProfileId, activeProfile])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!adminAuthenticated) return
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === ',') {
        e.preventDefault()
        setUnifiedSettingsTab('general')
        setUnifiedSettingsOpen((o) => !o)
        return
      }
      if (meta && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setSidebarCollapsed(!settings.sidebarCollapsed)
        return
      }
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdkOpen((o) => !o)
        return
      }
      if (meta && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        void window.api.app.lock()
        return
      }
      if (e.key === 'Escape') {
        if (unifiedSettingsOpen) {
          setUnifiedSettingsOpen(false)
          return
        }
        if (showObserverView) {
          setShowObserverView(false)
          return
        }
        if (cmdkOpen) {
          setCmdkOpen(false)
          return
        }
        if (browserAuthBusy || localAuthPhase) {
          e.preventDefault()
          handleCancelChrome()
        }
        return
      }
      if (!meta || locked) return
      if (e.key >= '1' && e.key <= '9' && !e.shiftKey) {
        const idx = Number(e.key) - 1
        const profile = useProfileStore.getState().profiles[idx]
        if (profile) {
          e.preventDefault()
          void handleSelectProfile(profile.id)
        }
        return
      }
      if (e.shiftKey && activeProfileId) {
        const k = e.key.toLowerCase()
        if (k === 's') {
          e.preventDefault()
          handleSidebarSelectApp(activeProfileId, 'slack')
        } else if (k === 't') {
          e.preventDefault()
          handleSidebarSelectApp(activeProfileId, 'teams')
        } else if (k === 'w') {
          e.preventDefault()
          handleSidebarSelectApp(activeProfileId, 'whatsapp')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    adminAuthenticated,
    activeProfileId,
    browserAuthBusy,
    localAuthPhase,
    cmdkOpen,
    showObserverView,
    settings.sidebarCollapsed,
    locked,
    handleSelectProfile,
    handleSidebarSelectApp,
    handleCancelChrome,
    setSidebarCollapsed
  ])

  if (!adminReady) {
    return <div className="admin-login-overlay" aria-busy="true" />
  }

  if (!adminAuthenticated) {
    return (
      <AdminLoginOverlay
        configured={adminConfigured}
        envPathHint={adminEnvPathHint}
        onSuccess={() => setAdminAuthenticated(true)}
      />
    )
  }

  return (
    <div className={`app-shell${settings.sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      <div className="app-body">
        <div
          className={`sidebar-rail${settings.sidebarCollapsed ? ' is-collapsed' : ''}`}
          style={{
            width: settings.sidebarCollapsed ? 44 : settings.sidebarWidth
          }}
          onTransitionEnd={(e) => {
            if (e.propertyName !== 'width') return
            const bounds = viewportBounds()
            if (useProfileStore.getState().activeAppId) {
              void window.api.profiles.updateBounds(bounds)
            }
          }}
        >
          <div className="sidebar-rail-expanded" aria-hidden={settings.sidebarCollapsed}>
            <ProfileSidebar
              dashboardSlot={<DashboardRail />}
              profiles={profiles}
              activeProfileId={activeProfileId}
              activeAppId={activeAppId}
              selectedTeamId={selectedTeamId}
              email={email}
              onEmailChange={setEmail}
              googleBusy={browserAuthBusy || localAuthPhase === 'google'}
              statusLine={error ?? statusLine}
              unreadCounts={unreadCounts}
              recentWorkspaces={settings.recentWorkspaces}
              onAddGoogle={() => void handleAddGoogle()}
              onCancelGoogle={handleCancelChrome}
              onToggleSidebar={() => setSidebarCollapsed(true)}
              onSelect={(id) => void handleSelectProfile(id)}
              onSelectApp={handleSidebarSelectApp}
              onDelete={(id) => {
                const p = profiles.find((x) => x.id === id)
                if (!p) return
                const linked = (snapshot?.projects ?? [])
                  .filter((proj) => proj.project.profileId === id)
                  .map((proj) => ({
                    id: proj.project.id,
                    name: proj.project.name || proj.project.teamName || 'Card'
                  }))
                setSidebarDeleteTarget({
                  id,
                  name: p.customName || p.displayName,
                  email: p.displayName,
                  cards: linked
                })
              }}
              onRename={(id, name) => {
                void window.api.profiles.setCustomName(id, name).then(applyProfileUpdate)
              }}
              onToggleMute={(id, muted) => {
                void window.api.profiles.setMuted(id, muted).then(applyProfileUpdate)
              }}
              onReorder={(ids) => {
                void window.api.profiles.reorder(ids).then((list) => {
                  useProfileStore.setState({ profiles: list })
                })
              }}
              onOpenInSplit={(profileId, appId) => {
                if (!settings.splitViewEnabled) {
                  setToast('Enable Split view in Settings first.')
                  return
                }
                setSplitSecondary({ profileId, appId })
              }}
              onOpenWorkspace={handleOpenWorkspace}
              syncingProfileId={null}
              onSyncWorkspaces={() => undefined}
              onPinFromAvailable={(profileId, appId, teamId) => {
                void pinFromAvailable(profileId, appId, teamId)
              }}
              onUnpin={(profileId, appId, teamId) => {
                void unpinWorkspace(profileId, appId, teamId)
              }}
              onDismissError={clearError}
              onPlatformSettings={(profileId, appId) => {
                setPlatformSettings({ profileId, appId })
              }}
              onAddPlatform={() => {
                setAddPlatformOpen(true)
              }}
              onNewProject={() => {
                useDashboardStore.getState().openDashboard()
                setNewProjectModalOpen(true)
              }}
              onNewProfile={() => setNewProfileModalOpen(true)}
              onObserver={() => {
                setShowObserverView(true)
              }}
              onOpenAccountsSettings={() => {
                setUnifiedSettingsTab('general')
                setUnifiedSettingsOpen(true)
              }}
              onOpenProfilesHub={() => {
                setAccountsModalOpen(true)
              }}
              activeCustomLinkId={activeCustomLinkId}
              onSelectCustomLink={handleSelectCustomLink}
              sidebarLook={settings.sidebarLook ?? 'basic'}
              showLookSwitcher={settings.showLookSwitcher ?? false}
              showRecentSection={settings.showRecentSection ?? true}
              showGoogleEmailInputInSidebar={settings.showGoogleEmailInputInSidebar ?? true}
              showObserverViewHeader={settings.showObserverViewHeader ?? false}
              baseAppLayout={settings.baseAppLayout ?? 'standard'}
              showSidebarItemActions={settings.showSidebarItemActions ?? true}
              showSidebarProfileHideButton={settings.showSidebarProfileHideButton ?? false}
              showSidebarProfileNavButton={settings.showSidebarProfileNavButton ?? settings.showCosmicProfileNavButtons ?? true}
              showSidebarDashboardNavButton={settings.showSidebarDashboardNavButton ?? settings.showCosmicProfileNavButtons ?? true}
              showCosmicProfileNavButtons={settings.showCosmicProfileNavButtons ?? true}
              sidebarButtons={settings.sidebarButtons}
              onLookChange={(look) => {
                void window.api.app.setSettings({ sidebarLook: look }).then((next) => {
                  setSettings(next)
                })
              }}
              onToast={setToast}
            />
            <div
              className="sidebar-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              aria-valuemin={220}
              aria-valuemax={520}
              aria-valuenow={settings.sidebarWidth}
              tabIndex={settings.sidebarCollapsed ? -1 : 0}
              onPointerDown={handleSidebarResizeStart}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                e.preventDefault()
                const delta = e.key === 'ArrowRight' ? 16 : -16
                const next = Math.min(520, Math.max(220, settings.sidebarWidth + delta))
                applySidebarWidth(next)
                void window.api.app.setSettings({ sidebarWidth: next }).then((s) => {
                  setSettings(s)
                  applySidebarWidth(s.sidebarWidth)
                })
              }}
            />
          </div>

          <aside
            className="sidebar-collapsed-rail"
            aria-label="Sidebar hidden"
            aria-hidden={!settings.sidebarCollapsed}
          >
            <button
              type="button"
              className="sidebar-reopen"
              onClick={() => setSidebarCollapsed(false)}
              title={`Show sidebar (${modKey()}B) · ${APP_DISPLAY_NAME}`}
              aria-label="Show sidebar"
              tabIndex={settings.sidebarCollapsed ? 0 : -1}
            >
              <SidebarPanelIcon collapsed />
            </button>
          </aside>
        </div>

        <main className={`main-column${splitOn ? ' is-split' : ''}`} style={{ display: 'flex', flexDirection: 'column' }}>
          {browserAuthBusy && authPhase ? (
            <AuthChromePane
              phase={authPhase}
              onBoundsChange={handleAuthDockBounds}
              onCancel={handleCancelChrome}
            />
          ) : null}

          {whatsappSigningIn ? (
            <div className="auth-pane-banner" role="status">
              Scan the WhatsApp QR code in the right pane to sign in.
            </div>
          ) : null}

          {showObserverView ? (
            <ObserverView onBack={() => setShowObserverView(false)} />
          ) : showCosmicCard ? (
            <CosmicWorkspaceView sidebarLook={settings.sidebarLook ?? 'ancient'} />
          ) : showDashboard ? (
            <DashboardView />
          ) : showEmbed ? (
            <div className={`main-embed${splitOn ? ' is-split' : ''}`}>
              <SlackViewport hasActiveProfile={true} onBoundsChange={handleBoundsChange} />
              {splitOn ? (
                <div className="split-pane-label" aria-hidden>
                  Split
                </div>
              ) : null}
            </div>
          ) : null}

          {!browserAuthBusy && !showEmbed && !showDashboard && !showCosmicCard && !showObserverView && !locked ? (
            <div className="empty-main">
              <img className="empty-main-icon" src={appIcon} alt="" aria-hidden />
              <h1>{emptyCopy.title}</h1>
              <p>{emptyCopy.body}</p>
              <p className="empty-main-hint">
                Shortcuts: {modKey()}K jump · {modKey()}B sidebar · {modKey()}, settings ·{' '}
                {modKey()}1–9 profiles · {modShift()}S/T/W apps · {modKey()}L lock
              </p>
            </div>
          ) : null}
        </main>
      </div>

      <CommandPalette
        open={cmdkOpen && !locked}
        profiles={profiles}
        projects={commandPaletteProjects}
        onClose={() => setCmdkOpen(false)}
        onSelectProfile={(id) => {
          setShowObserverView(false)
          void handleSelectProfile(id)
        }}
        onSelectApp={(profileId, appId) => {
          setShowObserverView(false)
          handleSidebarSelectApp(profileId, appId)
        }}
        onOpenWorkspace={(profileId, appId, teamId) => {
          setShowObserverView(false)
          handleOpenWorkspace(profileId, appId, teamId)
        }}
        onOpenInSplit={(profileId, appId) => {
          if (!settings.splitViewEnabled) {
            setToast('Enable Split view in Settings first.')
            return
          }
          setShowObserverView(false)
          setSplitSecondary({ profileId, appId })
        }}
        onSelectProject={(projectId) => {
          setShowObserverView(false)
          useDashboardStore.getState().setCosmicNavigation('all', projectId)
          useDashboardStore.getState().openDashboard()
        }}
        onOpenSettings={() => {
          setUnifiedSettingsTab('general')
          setUnifiedSettingsOpen(true)
          void window.api?.logs?.logAction('ui', 'info', 'Opened Settings Hub')
        }}
        onLockApp={() => {
          void window.api.app.lock()
          void window.api?.logs?.logAction('sec', 'info', 'App locked by user command')
        }}
        onSyncAll={() => {
          void useDashboardStore.getState().syncNow()
          setToast('Syncing all project cards…')
          void window.api?.logs?.logAction('sync', 'info', 'Manual sync triggered for all projects')
        }}
        onOpenObserver={() => {
          setShowObserverView(true)
          void window.api?.logs?.logAction('nav', 'info', 'Opened Observer View')
        }}
      />

      {/* Unified Global Settings Hub: single source of truth for all global configs */}
      <UnifiedSettingsModal
        open={unifiedSettingsOpen && !locked}
        initialTab={unifiedSettingsTab}
        settings={settings}
        onClose={() => {
          setUnifiedSettingsOpen(false)
          void window.api?.logs?.logAction('ui', 'info', 'Closed Settings Hub')
        }}
        onChangeSettings={(patch) => {
          void window.api.app.setSettings(patch).then((s) => {
            setSettings(s)
            applyDocumentTheme(s.theme)
            applySidebarDensity(s.sidebarDensity)
            applySidebarWidth(s.sidebarWidth)
            if (!s.splitViewEnabled) setSplitSecondary(null)
            window.dispatchEvent(new CustomEvent('orbit:settings-changed', { detail: s }))
          })
        }}
        onClearAllProfiles={() => {
          void window.api.profiles.clearAll().then(async () => {
            useProfileStore.setState({
              profiles: [],
              activeProfileId: null,
              activeAppId: null
            })
            const s = await window.api.app.getSettings()
            setSettings(s)
          })
        }}
        onExportProfiles={() => {
          void window.api.profiles.exportMetadata().then((list) => {
            const blob = new Blob([JSON.stringify(list, null, 2)], {
              type: 'application/json'
            })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = 'cosmic-profiles.json'
            a.click()
          })
        }}
        onImportProfiles={() => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'application/json,.json'
          input.onchange = () => {
            const file = input.files?.[0]
            if (!file) return
            void file.text().then(async (text) => {
              const parsed = JSON.parse(text) as Profile[]
              const list = await window.api.profiles.importMetadata(parsed)
              useProfileStore.setState({ profiles: list })
              setToast(`Imported — ${list.length} profiles total (sessions still need sign-in).`)
            })
          }
          input.click()
        }}
        onAdminLogout={() => {
          void window.api.app.adminLogout().then(() => {
            setAdminAuthenticated(false)
            void window.api.profiles.setEmbedVisible(false)
          })
        }}
        onAddGoogleAccount={() => {
          setUnifiedSettingsOpen(false)
          setNewProfileModalOpen(true)
        }}
        onDeleteProfile={(id, deleteCards) => {
          void deleteProfile(id, deleteCards).then(async () => {
            const s = await window.api.app.getSettings()
            setSettings(s)
            await useDashboardStore.getState().loadSnapshot()
          })
        }}
        onSelectProfile={(id) => {
          setUnifiedSettingsOpen(false)
          void handleSelectProfile(id)
        }}
        onOpenCustomLink={(pId, link) => {
          setUnifiedSettingsOpen(false)
          void handleSelectCustomLink(pId, link)
        }}
      />

      <NewProfileModal
        open={newProfileModalOpen}
        onClose={() => {
          setNewProfileModalOpen(false)
          setInitialNewProfileEmail(null)
        }}
        onCreate={handleCreateAndAuthProfile}
        initialEmail={initialNewProfileEmail || undefined}
        showScopeSelector={settings.showProfileScopeSelector ?? false}
      />

      {platformSettings ? (
        <PlatformSettingsPanel
          open={true}
          profileId={platformSettings.profileId}
          appId={platformSettings.appId}
          onClose={() => setPlatformSettings(null)}
        />
      ) : null}

      {newProjectModalOpen ? (
        <NewProjectModal
          open={true}
          onClose={() => setNewProjectModalOpen(false)}
          onSuccess={(projectId) => {
            setNewProjectModalOpen(false)
            if (isBasicActive) {
              useDashboardStore.getState().setBasicNavigation(projectId, 'dashboard')
            } else {
              const p = useDashboardStore.getState().snapshot?.projects.find((proj) => proj.project.id === projectId)
              const pProfileId = p?.project.profileId || 'all'
              useDashboardStore.getState().setCosmicNavigation(pProfileId, projectId)
            }
            useProfileStore.getState().clearActiveApp()
          }}
          showLinkedAccounts={settings.showNewProjectLinkedAccounts ?? false}
        />
      ) : null}

      {addPlatformOpen ? (
        <AddPlatformPage
          open={true}
          onClose={() => setAddPlatformOpen(false)}
          initialProfileId={activeProfileId}
          onOpenProfilesHub={() => setAccountsModalOpen(true)}
          onNewProject={() => {
            useDashboardStore.getState().openDashboard()
            setNewProjectModalOpen(true)
          }}
          onNewProfile={() => setNewProfileModalOpen(true)}
        />
      ) : null}

      {/* Card Picker — Step 1 for Individual Profile "+ Website" */}
      {cardPickerOpen && activeProfileId ? (
        <CardPickerModal
          open={cardPickerOpen}
          profileId={activeProfileId}
          onClose={() => setCardPickerOpen(false)}
          onPickCard={(project) => {
            setCardPickerOpen(false)
            setCardAddProject(project)
          }}
        />
      ) : null}

      {/* Card Add Modal — Step 2 (isolated to selected project card) */}
      {cardAddProject ? (
        <CardAddModal
          open={true}
          project={cardAddProject}
          onClose={() => setCardAddProject(null)}
          onSuccess={(msg) => {
            setToast(msg)
            setCardAddProject(null)
          }}
        />
      ) : null}

      {accountsModalOpen ? (
        <AccountsManagementModal
          open={true}
          onClose={() => setAccountsModalOpen(false)}
          onAddWebsite={() => {
            setAccountsModalOpen(false)
            setAddPlatformOpen(true)
          }}
          onNewProject={() => {
            setAccountsModalOpen(false)
            useDashboardStore.getState().openDashboard()
            setNewProjectModalOpen(true)
          }}
          onNewProfile={() => {
            setAccountsModalOpen(false)
            setNewProfileModalOpen(true)
          }}
          onSelectProfile={(id) => void handleSelectProfile(id)}
          onOpenCustomLink={(pId, link) => void handleSelectCustomLink(pId, link)}
          onOpenObserver={() => setShowObserverView(true)}
        />
      ) : null}

      <DeleteConfirmNoticeModal
        open={Boolean(sidebarDeleteTarget)}
        onClose={() => setSidebarDeleteTarget(null)}
        target={sidebarDeleteTarget ? { type: 'profile', profile: sidebarDeleteTarget } : null}
        onConfirmProfileDelete={async (profileId, deleteCards) => {
          await deleteProfile(profileId, deleteCards)
          const s = await window.api.app.getSettings()
          setSettings(s)
          await useDashboardStore.getState().loadSnapshot()
          setSidebarDeleteTarget(null)
        }}
      />

      {showOnboarding && !locked ? (
        <div className="onboarding-backdrop">
          <div className="onboarding-card">
            <h2>Welcome</h2>
            <ol>
              <li>Enter a Google email and continue.</li>
              <li>Finish password + 2SV in the Chrome pane.</li>
              <li>Open Slack, Teams, or WhatsApp under the profile.</li>
            </ol>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                localStorage.setItem('onboardingDone', '1')
                setShowOnboarding(false)
              }}
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          className="app-toast"
          role="status"
          onClick={() => setToast(null)}
          title="Click to dismiss"
        >
          <span className="app-toast-text">{toast}</span>
          <button
            type="button"
            className="app-toast-close"
            onClick={(e) => {
              e.stopPropagation()
              setToast(null)
            }}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ) : null}

      {locked ? (
        <LockOverlay
          unlocking={unlocking}
          onUnlock={() => {
            setUnlocking(true)
            void window.api.app.unlock().finally(() => setUnlocking(false))
          }}
        />
      ) : null}
    </div>
  )
}

export default App
