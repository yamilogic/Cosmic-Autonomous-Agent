import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type {
  DashboardGlobalConfig,
  DashboardSyncProgressPayload
} from '../../../../shared/dashboard-contract'
import { useDashboardStore } from '../../hooks/useDashboard'
import ProjectCard from './ProjectCard'
import { buildCardSummary } from './card-view'
import DashboardWizard from './DashboardWizard'
import { NewProjectModal } from './NewProjectModal'
import GlobalSettingsPanel from './GlobalSettingsPanel'
import ErrorBoundary from './ErrorBoundary'
import RecentStrip from './RecentStrip'
import { NewProfileModal } from './NewProfileModal'
import { DeleteConfirmNoticeModal, type CardDeleteTarget } from './DeleteConfirmNoticeModal'
import { useProfileStore } from '../../hooks/useProfiles'
import { isIndividualProfile } from '../../../../shared/types'
import {
  filterCounts,
  matchesFilter,
  movePinned,
  normalisePinnedOrder,
  pinProject,
  sortUnpinned,
  unpinProject,
  type ProjectEntry,
  type ProjectFilter
} from './dashboard-page-selectors'
import type { AppSettings } from '../../../../shared/ipc-contract'

function fmtAge(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}


function SyncGlyph(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 11a8 8 0 0 0-14.9-4M4 13a8 8 0 0 0 14.9 4M4 5v6h6M20 19v-6h-6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Dashboard page (v2.8): one header, one focus line, then a dense list of
 * project rows. A row expands in place into the full workspace.
 */
export default function DashboardView(): React.ReactElement | null {
  const snapshot = useDashboardStore((s) => s.snapshot)
  const loading = useDashboardStore((s) => s.loading)
  const error = useDashboardStore((s) => s.error)
  const loadSnapshot = useDashboardStore((s) => s.loadSnapshot)
  const applySnapshot = useDashboardStore((s) => s.applySnapshot)
  const applyProgress = useDashboardStore((s) => s.applyProgress)
  const deleteProject = useDashboardStore((s) => s.deleteProject)
  const setPinnedOrder = useDashboardStore((s) => s.setPinnedOrder)
  const syncNow = useDashboardStore((s) => s.syncNow)
  const progress = useDashboardStore((s) => s.progress)
  const syncingProjectIds = useDashboardStore((s) => s.syncingProjectIds)
  const recent = useDashboardStore((s) => s.recent)
  const loadRecent = useDashboardStore((s) => s.loadRecent)
  const wizardOpenFor = useDashboardStore((s) => s.wizardOpenFor)
  const [renderError, setRenderError] = useState<Error | null>(null)
  const [deleteCardTarget, setDeleteCardTarget] = useState<CardDeleteTarget | null>(null)
  const [viewMode, setViewMode] = useState<'compact' | 'expanded' | 'mixed'>(() => {
    try {
      const saved = localStorage.getItem('orbit.view') as 'compact' | 'expanded' | 'mixed' | null
      return saved ?? 'mixed'
    } catch {
      return 'mixed'
    }
  })
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [focusGuideSection, setFocusGuideSection] = useState<Record<string, number>>({})
  const [focusDetailKey, setFocusDetailKey] = useState<
    Record<string, 'needs-reply' | 'blockers' | 'risks'>
  >({})
  const [settingsTarget, setSettingsTarget] = useState<{
    projectId: string
    nonce: number
  } | null>(null)
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false)
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false)
  const [showLinkedAccounts, setShowLinkedAccounts] = useState(false)

  useEffect(() => {
    void window.api?.app?.getSettings?.().then((s) => {
      if (typeof s?.showNewProjectLinkedAccounts === 'boolean') {
        setShowLinkedAccounts(s.showNewProjectLinkedAccounts)
      }
    })
    const unsub = window.api?.app?.onSettingsChanged?.((s) => {
      if (typeof s?.showNewProjectLinkedAccounts === 'boolean') {
        setShowLinkedAccounts(s.showNewProjectLinkedAccounts)
      }
    })
    const handleCustom = (e: Event): void => {
      const s = (e as CustomEvent<AppSettings>).detail
      if (typeof s?.showNewProjectLinkedAccounts === 'boolean') {
        setShowLinkedAccounts(s.showNewProjectLinkedAccounts)
      }
    }
    window.addEventListener('orbit:settings-changed', handleCustom)
    return () => {
      unsub?.()
      window.removeEventListener('orbit:settings-changed', handleCustom)
    }
  }, [])
  const [globalConfig, setGlobalConfig] = useState<DashboardGlobalConfig | null>(null)
  const [filter, setFilter] = useState<ProjectFilter>(() => {
    try {
      const saved = localStorage.getItem('orbit.filter')
      return saved === 'urgent' || saved === 'inactive' ? saved : 'all'
    } catch {
      return 'all'
    }
  })
  const [schedulePaused, setSchedulePaused] = useState(false)
  const [newProfileModalOpen, setNewProfileModalOpen] = useState(false)
  const cosmicLevel1 = useDashboardStore((s) => s.cosmicLevel1)
  const [selectedProfileFilter, setSelectedProfileFilter] = useState<string>(() => {
    if (cosmicLevel1 && cosmicLevel1 !== 'all' && cosmicLevel1 !== 'global') {
      return cosmicLevel1
    }
    return 'all'
  })
  const profiles = useProfileStore((s) => s.profiles)

  // Synchronize dashboard profile filter when cosmicLevel1 changes
  useEffect(() => {
    if (cosmicLevel1 && cosmicLevel1 !== 'all' && cosmicLevel1 !== 'global') {
      setSelectedProfileFilter(cosmicLevel1)
    } else if (cosmicLevel1 === 'all' || cosmicLevel1 === 'global') {
      setSelectedProfileFilter('all')
    }
  }, [cosmicLevel1])
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const [syncRun, setSyncRun] = useState<{ total: number; done: number } | null>(null)
  const lastProgressRef = useRef<DashboardSyncProgressPayload | null>(null)
  const pointerDrag = useRef<{ id: string; pointerId: number } | null>(null)
  const pointerDrop = useRef<string | null>(null)

  useEffect(() => {
    void loadSnapshot()
    const timer = window.setInterval(() => {
      void loadSnapshot().catch(() => {})
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [loadSnapshot])

  // Main pushes a snapshot the moment a sync finishes; the 60s poll is only a
  // backstop. Progress events also drive the per-card "syncing" state.
  useEffect(() => {
    const offSnapshot = window.api.dashboard.onSnapshotChanged((snapshot) =>
      applySnapshot(snapshot)
    )
    const offProgress = window.api.dashboard.onSyncProgress((payload) => {
      applyProgress(payload)
      if (payload.phase === 'complete' || payload.phase === 'error') {
        window.setTimeout(() => {
          void loadSnapshot().catch(() => {})
        }, 250)
      }
    })
    return () => {
      offSnapshot()
      offProgress()
    }
  }, [applySnapshot, applyProgress, loadSnapshot])

  useEffect(() => {
    let cancelled = false
    void window.api.dashboard
      .getGlobalConfig()
      .then((next) => {
        if (!cancelled) setGlobalConfig(next)
      })
      .catch(() => undefined)
    const off = window.api.dashboard.onConfigChanged((next) => {
      if (!cancelled) setGlobalConfig(next)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  useEffect(() => {
    const api = window.api?.dashboard
    if (!api?.getSchedules || !api.onSchedulesChanged) return
    let cancelled = false
    const apply = (state: { settings: { slackSync: { enabled: boolean } } }): void => {
      if (!cancelled) setSchedulePaused(!state.settings.slackSync.enabled)
    }
    void api
      .getSchedules()
      .then(apply)
      .catch(() => undefined)
    const off = api.onSchedulesChanged(apply)
    return () => {
      cancelled = true
      off()
    }
  }, [])

  useEffect(() => {
    const load = (): void => {
      void loadRecent().catch(() => undefined)
    }
    load()
    const timer = window.setInterval(load, 60_000)
    return () => window.clearInterval(timer)
  }, [loadRecent])

  const focusProject = (projectId: string): void => {
    const el = document.getElementById(`dash-card-anchor-${projectId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('is-flash')
    window.setTimeout(() => el.classList.remove('is-flash'), 1400)
  }

  useEffect(() => {
    if (!syncRun) return
    if (!progress || progress === lastProgressRef.current) return
    if (progress.phase !== 'complete' && progress.phase !== 'error') return
    lastProgressRef.current = progress
    setSyncRun((prev) => {
      if (!prev) return null
      const done = prev.done + 1
      return done >= prev.total ? null : { ...prev, done }
    })
  }, [progress, syncRun])

  useEffect(() => {
    if (error) setSyncRun(null)
  }, [error])

  /** Drop any chip-driven tab focus so the gear can win. */
  const clearCardFocus = (projectId: string): void => {
    setFocusGuideSection((prev) => {
      if (!(projectId in prev)) return prev
      const next = { ...prev }
      delete next[projectId]
      return next
    })
    setFocusDetailKey((prev) => {
      if (!(projectId in prev)) return prev
      const next = { ...prev }
      delete next[projectId]
      return next
    })
  }

  /** Card-header gear → expand the card and land on its Settings tab. */
  const openProjectSettings = (projectId: string): void => {
    clearCardFocus(projectId)
    setExpandedIds((prev) => new Set(prev).add(projectId))
    setSettingsTarget((prev) => ({ projectId, nonce: (prev?.nonce ?? 0) + 1 }))
    window.setTimeout(() => focusProject(projectId), 140)
  }

  // Render error boundary fallback
  if (renderError) {
    return (
      <section
        className="flex flex-col h-full w-full bg-background-dark text-text-dark p-12"
        data-testid="dashboard-view-error"
      >
        <div className="flex flex-col items-center justify-center h-full text-center">
          <h2 className="text-2xl font-semibold text-red-400 mb-4">Dashboard Error</h2>
          <p className="text-muted-dark mb-6">{renderError.message}</p>
          <button
            type="button"
            className="px-4 py-2 bg-accent text-accent-on rounded-lg font-medium hover:bg-accent-dim"
            onClick={() => {
              setRenderError(null)
              void loadSnapshot()
            }}
          >
            Retry
          </button>
        </div>
      </section>
    )
  }

  if (error && !snapshot) {
    return (
      <section
        className="flex flex-col h-full w-full bg-background-dark text-text-dark p-12"
        data-testid="dashboard-view-error"
      >
        <div className="flex flex-col items-center justify-center h-full text-center">
          <h2 className="text-2xl font-semibold text-red-400 mb-4">Failed to load dashboard</h2>
          <p className="text-muted-dark mb-6">{error}</p>
          <button
            type="button"
            className="px-4 py-2 bg-accent text-accent-on rounded-lg font-medium hover:bg-accent-dim"
            onClick={() => void loadSnapshot()}
          >
            Retry
          </button>
        </div>
      </section>
    )
  }

  if (loading && !snapshot) {
    return (
      <section
        className="flex flex-col h-full w-full bg-background-dark text-text-dark p-6"
        data-testid="dashboard-view-loading"
      >
        <div className="flex flex-col items-center justify-center h-full">
          <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-muted-dark">Loading dashboard…</p>
        </div>
      </section>
    )
  }

  const digest = snapshot?.digest ?? null
  const projects = snapshot?.projects ?? []
  const lastSync = projects.reduce<string | null>(
    (acc, p) => (p.lastUpdatedAt && (!acc || p.lastUpdatedAt > acc) ? p.lastUpdatedAt : acc),
    null
  )

  const handleViewChange = (mode: 'compact' | 'expanded' | 'mixed'): void => {
    setViewMode(mode)
    try {
      localStorage.setItem('orbit.view', mode)
    } catch {
      // localStorage can be unavailable in hardened sessions; view still changes.
    }
    if (mode === 'compact') setExpandedIds(new Set())
    else if (mode === 'expanded')
      setExpandedIds(new Set((snapshot?.projects ?? []).map((p) => p.project.id)))
  }

  const setupPending = Boolean(
    globalConfig && (!globalConfig.ourSlack.connected || !globalConfig.nvidia.configured)
  )

  const cardEntries: ProjectEntry[] = projects.map((projectSnapshot, index) => ({
    snapshot: projectSnapshot,
    summary: buildCardSummary(projectSnapshot, index)
  }))
  const entryById = new Map(cardEntries.map((entry) => [entry.snapshot.project.id, entry]))
  const projectIds = projects.map((projectSnapshot) => projectSnapshot.project.id)
  const pinnedOrder = normalisePinnedOrder(snapshot?.pinnedOrder ?? [], projectIds)
  const pinnedIds = new Set(pinnedOrder)
  const pinnedEntries = pinnedOrder
    .map((id) => entryById.get(id))
    .filter((entry): entry is ProjectEntry => Boolean(entry))
  const unpinnedEntries = sortUnpinned(
    cardEntries.filter((entry) => !pinnedIds.has(entry.snapshot.project.id))
  )
  const matchesProfile = (entry: ProjectEntry): boolean => {
    if (selectedProfileFilter === 'all') return true
    const p = entry.snapshot.project
    if (p.profileId === selectedProfileFilter) return true
    const browserSrc = (p.sources ?? []).find((s) => s.kind === 'browser')
    if (browserSrc?.profileId === selectedProfileFilter) return true
    return false
  }

  const profileScopedPinned = pinnedEntries.filter(matchesProfile)
  const profileScopedUnpinned = unpinnedEntries.filter(matchesProfile)
  const counts = filterCounts(profileScopedUnpinned)
  const filteredEntries = profileScopedUnpinned.filter((entry) => matchesFilter(filter, entry))
  const syncingAll = Boolean(syncRun) || Boolean(progress?.syncing) || syncingProjectIds.length > 0
  const syncLabel = syncRun
    ? `Syncing ${Math.min(syncRun.total, syncRun.done + 1)}/${syncRun.total}`
    : progress?.syncing
      ? `Syncing ${progress.current}/${progress.total}`
      : syncingAll
        ? 'Syncing…'
        : 'Sync all'

  const changeFilter = (next: ProjectFilter): void => {
    setFilter(next)
    try {
      localStorage.setItem('orbit.filter', next)
    } catch {
      // Filter still works for this session.
    }
  }

  const togglePin = (projectId: string): void => {
    const next = pinnedIds.has(projectId)
      ? unpinProject(pinnedOrder, projectId)
      : pinProject(pinnedOrder, projectId)
    void setPinnedOrder(next)
  }

  const movePin = (projectId: string, delta: -1 | 1): void => {
    void setPinnedOrder(movePinned(pinnedOrder, projectId, delta))
  }

  const dropPin = (fromId: string | null, toId: string): void => {
    setDragId(null)
    setDropId(null)
    if (!fromId || fromId === toId) return
    const next = [...pinnedOrder]
    const fromIndex = next.indexOf(fromId)
    const toIndex = next.indexOf(toId)
    if (fromIndex < 0 || toIndex < 0) return
    next.splice(fromIndex, 1)
    next.splice(toIndex, 0, fromId)
    void setPinnedOrder(next)
  }

  const pinnedUnder = (x: number, y: number): string | null => {
    const slot = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-pinned-id]')
    return slot?.dataset.pinnedId ?? null
  }

  const startPinDrag = (event: React.PointerEvent<HTMLButtonElement>, id: string): void => {
    if (event.button !== 0) return
    pointerDrag.current = { id, pointerId: event.pointerId }
    pointerDrop.current = null
    setDragId(id)
    setDropId(null)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const movePinDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (!pointerDrag.current) return
    event.preventDefault()
    const target = pinnedUnder(event.clientX, event.clientY)
    if (target !== pointerDrop.current) {
      pointerDrop.current = target
      setDropId(target)
    }
    if (event.clientY < 90) window.scrollBy({ top: -18 })
    else if (window.innerHeight - event.clientY < 90) window.scrollBy({ top: 18 })
  }

  const endPinDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = pointerDrag.current
    if (!drag) return
    pointerDrag.current = null
    const target = pinnedUnder(event.clientX, event.clientY) ?? pointerDrop.current
    pointerDrop.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    dropPin(drag.id, target ?? drag.id)
  }

  const cancelPinDrag = (): void => {
    pointerDrag.current = null
    pointerDrop.current = null
    setDragId(null)
    setDropId(null)
  }

  const openFromRecent = (projectId: string): void => {
    const entry = entryById.get(projectId)
    if (entry && !matchesFilter(filter, entry)) changeFilter('all')
    if (viewMode === 'compact') handleViewChange('mixed')
    if (!expandedIds.has(projectId)) {
      setExpandedIds((prev) => new Set(prev).add(projectId))
    }
    window.setTimeout(() => focusProject(projectId), 180)
  }

  const toggleCard = (projectId: string): void => {
    // A single click in Compact or Expanded must not be swallowed by the
    // page-wide mode: move to Mixed so the clicked card is the one that changes.
    if (viewMode === 'expanded') {
      handleViewChange('mixed')
      setExpandedIds((prev) => {
        const next = new Set(prev)
        next.delete(projectId)
        return next
      })
      setSettingsTarget((prev) => (prev?.projectId === projectId ? null : prev))
    } else {
      const willCollapse = expandedIds.has(projectId)
      if (!willCollapse && viewMode === 'compact') handleViewChange('mixed')
      setExpandedIds((prev) => {
        const next = new Set(prev)
        if (next.has(projectId)) next.delete(projectId)
        else next.add(projectId)
        return next
      })
      if (willCollapse) {
        setSettingsTarget((prev) => (prev?.projectId === projectId ? null : prev))
      }
    }
    const el = document.getElementById(`dash-card-anchor-${projectId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.classList.add('is-flash')
      window.setTimeout(() => el.classList.remove('is-flash'), 1400)
    }
  }

  const renderCard = (entry: ProjectEntry, index: number, pinned: boolean): React.ReactElement => {
    const projectSnapshot = entry.snapshot
    const id = projectSnapshot.project.id
    const isExpanded = viewMode === 'expanded' || (viewMode === 'mixed' && expandedIds.has(id))
    const pinIndex = pinnedOrder.indexOf(id)
    return (
      <ErrorBoundary key={id} label={`card-${index}`}>
        <ProjectCard
          snapshot={projectSnapshot}
          index={index}
          expanded={isExpanded}
          pinned={pinned}
          onTogglePin={() => togglePin(id)}
          canMoveUp={pinned && pinIndex > 0}
          canMoveDown={pinned && pinIndex >= 0 && pinIndex < pinnedOrder.length - 1}
          onMoveUp={() => movePin(id, -1)}
          onMoveDown={() => movePin(id, 1)}
          pinOrderKey={pinnedOrder.join('|')}
          pageMode={viewMode}
          initialTab={settingsTarget?.projectId === id ? 'settings' : undefined}
          tabNonce={settingsTarget?.projectId === id ? settingsTarget.nonce : 0}
          initialGuideSection={focusGuideSection[id]}
          initialDetailKey={focusDetailKey[id]}
          onOpenSettings={openProjectSettings}
          onToggle={() => toggleCard(id)}
          onDelete={(projectId) => {
            const p = projectSnapshot.project
            setDeleteCardTarget({
              id: projectId,
              name: p.name || p.teamName || 'Card',
              clientName: p.clientName,
              teamName: p.teamName,
              channelCount: p.monitors?.length ?? 0
            })
          }}
          onExpandSection={(section) => {
            setSettingsTarget((prev) => (prev?.projectId === id ? null : prev))
            if (section === 101) {
              setFocusDetailKey((prev) => ({ ...prev, [id]: 'needs-reply' }))
              setFocusGuideSection((prev) => {
                const next = { ...prev }
                delete next[id]
                return next
              })
            } else if (section === 102) {
              setFocusDetailKey((prev) => ({ ...prev, [id]: 'blockers' }))
              setFocusGuideSection((prev) => {
                const next = { ...prev }
                delete next[id]
                return next
              })
            } else if (section === 103) {
              setFocusDetailKey((prev) => ({ ...prev, [id]: 'risks' }))
              setFocusGuideSection((prev) => {
                const next = { ...prev }
                delete next[id]
                return next
              })
            } else {
              setFocusGuideSection((prev) => ({ ...prev, [id]: section }))
              setFocusDetailKey((prev) => {
                const next = { ...prev }
                delete next[id]
                return next
              })
            }
            setExpandedIds((prev) => new Set(prev).add(id))
          }}
        />
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary label="dashboard-view">
      <section className="dash-view" data-testid="dashboard-view">
        <header className="dash-head">
          <div className="dash-head-copy">
            <h1>Client projects</h1>
            <p className="dash-head-sub">
              <span>{projects.length === 1 ? '1 project' : `${projects.length} projects`}</span>
              <span>
                {progress?.syncing
                  ? `Syncing ${progress.current}/${progress.total}`
                  : `Synced ${fmtAge(lastSync)}`}
              </span>
              <span>Every {Math.round((snapshot?.syncIntervalSeconds ?? 300) / 60)} min</span>
            </p>
          </div>

          <div className="dash-head-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Profile Dropdown Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Profile:</span>
              <select
                value={selectedProfileFilter}
                onChange={(e) => setSelectedProfileFilter(e.target.value)}
                style={{
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '13px'
                }}
              >
                {(() => {
                  const individualProfiles = profiles.filter(isIndividualProfile)
                  return (
                    <>
                      <option value="all">All Profiles ({individualProfiles.length})</option>
                      {individualProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.customName || p.displayName || p.id}
                        </option>
                      ))}
                    </>
                  )
                })()}
              </select>
            </div>

            {/* + New Profile Button */}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setNewProfileModalOpen(true)}
              style={{ fontSize: '13px', padding: '6px 12px' }}
            >
              + New Profile
            </button>

            {/* + Add Project Button */}
            <button
              type="button"
              className="btn btn-primary"
              data-testid="btn-add-project"
              onClick={() => setNewProjectModalOpen(true)}
              style={{ fontSize: '13px', padding: '6px 12px' }}
            >
              + Add Project
            </button>

            <div className="segmented" role="group" aria-label="View mode">
              {(['compact', 'expanded', 'mixed'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  data-mode={mode}
                  aria-pressed={viewMode === mode}
                  onClick={() => handleViewChange(mode)}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="btn btn-secondary dash-sync-all"
              data-testid="sync-all"
              disabled={syncingAll}
              aria-label={syncLabel}
              onClick={() => void syncNow()}
            >
              <SyncGlyph />
              {syncLabel}
            </button>

            {schedulePaused ? <span className="dash-paused">Schedule paused</span> : null}
          </div>
        </header>

        {setupPending ? (
          <button
            type="button"
            className="dash-global-pending"
            data-testid="global-setup-pending"
            onClick={() => setGlobalSettingsOpen(true)}
          >
            <span>
              <b>Global setup pending</b> —{' '}
              {!globalConfig?.ourSlack.connected && !globalConfig?.nvidia.configured
                ? 'connect Our Slack and NVIDIA'
                : !globalConfig?.ourSlack.connected
                  ? 'connect Our Slack'
                  : 'add an NVIDIA key'}{' '}
              in Settings. Cards keep their client data; AI and Our Slack stay off until then.
            </span>
            <span aria-hidden>→</span>
          </button>
        ) : null}

        {digest ? (
          <p className="dash-focus" data-testid="dash-digest">
            <span className="dash-focus-label">Across workspaces</span>
            <span>{digest.topPriority}</span>
          </p>
        ) : null}

        {error ? (
          <p className="dash-inline-error" role="alert">
            Sync failed: {error}
          </p>
        ) : null}

        <RecentStrip items={recent} pinnedIds={pinnedIds} onOpen={openFromRecent} />

        {profileScopedPinned.length > 0 ? (
          <section className="dash-section dash-pinned" aria-labelledby="dash-pinned-title">
            <div className="dash-section-head">
              <h2 id="dash-pinned-title">
                Pinned <span className="dash-count">{profileScopedPinned.length}</span>
              </h2>
            </div>
            <div className="dash-list" data-testid="dash-pinned">
              {profileScopedPinned.map((entry, index) => {
                const id = entry.snapshot.project.id
                return (
                  <div
                    key={id}
                    data-pinned-id={id}
                    className={`dash-pinned-slot${dragId === id ? ' is-dragging' : ''}${
                      dropId === id && dragId !== id ? ' is-drop-target' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="dash-grip"
                      aria-label={`Reorder ${entry.summary.name}`}
                      title="Drag to reorder"
                      onPointerDown={(event) => startPinDrag(event, id)}
                      onPointerMove={movePinDrag}
                      onPointerUp={endPinDrag}
                      onPointerCancel={cancelPinDrag}
                      onLostPointerCapture={() => {
                        if (pointerDrag.current) cancelPinDrag()
                      }}
                      onKeyDown={(event) => {
                        if (!event.altKey) return
                        if (event.key === 'ArrowUp') {
                          event.preventDefault()
                          movePin(id, -1)
                        } else if (event.key === 'ArrowDown') {
                          event.preventDefault()
                          movePin(id, 1)
                        }
                      }}
                    >
                      <span aria-hidden>⠿</span>
                    </button>
                    {renderCard(entry, index, true)}
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}

        <section className="dash-section dash-projects" aria-labelledby="dash-projects-title">
          <div className="dash-section-head">
            <h2 id="dash-projects-title">
              Projects <span className="dash-count">{counts.all}</span>
            </h2>
            <div className="dash-filters" role="group" aria-label="Filter projects">
              {(
                [
                  ['all', 'All'],
                  ['urgent', 'Urgent'],
                  ['inactive', 'Inactive 24h+']
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`dash-filter${filter === value ? ' is-active' : ''}`}
                  aria-pressed={filter === value}
                  onClick={() => changeFilter(value)}
                >
                  {label} <span>{counts[value]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="dash-list" data-testid="dash-grid">
            {filteredEntries.map((entry, index) => renderCard(entry, index, false))}

            {projects.length === 0 ? (
              <div
                className="dash-clean-empty"
                style={{
                  padding: '48px 16px',
                  textAlign: 'center',
                  color: 'var(--text-muted, #94a3b8)',
                  fontSize: '13px',
                  gridColumn: '1 / -1'
                }}
              >
                <p style={{ margin: 0, opacity: 0.85 }}>
                  No projects added yet. Click <strong>+ Add Project</strong> above to create one.
                </p>
              </div>
            ) : filteredEntries.length === 0 ? (
              <p className="dash-filter-empty">Nothing matches this filter.</p>
            ) : null}
          </div>
        </section>

        {wizardOpenFor ? <DashboardWizard /> : null}
        <NewProjectModal
          open={newProjectModalOpen}
          onClose={() => setNewProjectModalOpen(false)}
          showLinkedAccounts={showLinkedAccounts}
        />
        <NewProfileModal
          open={newProfileModalOpen}
          onClose={() => setNewProfileModalOpen(false)}
          onCreate={async (name, email, mode, forceReauth) => {
            const profile = await useProfileStore.getState().createProfile(email.trim())
            const targetProfileId = profile.id
            const finalDisplayName = name.trim() || email.trim()
            await window.api.profiles.setCustomName(targetProfileId, finalDisplayName)

            const scope = mode === 'under_global' ? 'global' : mode === 'both' ? 'both' : 'individual'
            await window.api.profiles.setAccountScope(targetProfileId, scope)
            await useProfileStore.getState().loadProfiles()

            const latest = useProfileStore.getState().profiles.find((p) => p.id === targetProfileId)
            if (latest?.googleAuthStatus === 'signed-in' && !forceReauth) {
              return
            }

            // Initiate Google Authentication in Chrome
            try {
              useProfileStore.setState((s) => ({
                profiles: s.profiles.map((p) =>
                  p.id === targetProfileId ? { ...p, googleAuthStatus: 'signing-in' } : p
                )
              }))
              await useProfileStore.getState().startGoogleAuth(targetProfileId)
              await useProfileStore.getState().loadProfiles()
            } catch {
              // startGoogleAuth handles its own status & error state
            }
          }}
        />
        <GlobalSettingsPanel
          open={globalSettingsOpen}
          onClose={() => setGlobalSettingsOpen(false)}
        />
        <DeleteConfirmNoticeModal
          open={Boolean(deleteCardTarget)}
          onClose={() => setDeleteCardTarget(null)}
          target={deleteCardTarget ? { type: 'card', card: deleteCardTarget } : null}
          onConfirmCardDelete={async (cardId) => {
            await deleteProject(cardId)
            setDeleteCardTarget(null)
          }}
        />
      </section>
    </ErrorBoundary>
  )
}
