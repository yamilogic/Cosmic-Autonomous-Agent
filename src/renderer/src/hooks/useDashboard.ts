import { create } from 'zustand'
import type {
  DashboardDiscoverSourceChannelsPayload,
  DashboardDiscoverSourceChannelsResult,
  DashboardManualToken,
  DashboardProject,
  DashboardScrapeOptions,
  DashboardSnapshot,
  DashboardSyncProgressPayload,
  DashboardUpdateSourcePayload,
  DashboardUpdateSourceResult,
  RecentActivity,
  ValidateTokenResultPayload
} from '../../../shared/dashboard-contract'

interface DashboardState {
  /** whether the dashboard page (instead of the native embed) is open */
  dashboardOpen: boolean
  dashboardAppId: 'slack' | null
  snapshot: DashboardSnapshot | null
  loading: boolean
  syncingProjectIds: string[]
  progress: DashboardSyncProgressPayload | null
  error: string | null
  /** add-project wizard: open, with optional edit target (project id) */
  wizardOpenFor: { projectId: string | null } | null
  /** sidebar Dashboard row: Slack dropdown expanded (survives sidebar re-renders) */
  dashRailExpanded: boolean
  /** v2.3 — the "Recent" strip (one item per workspace, importance ranked) */
  recent: RecentActivity[]
  /** Cosmic look: Level 1 selection ('all' | 'global' | profileId) */
  cosmicLevel1: string
  /** Cosmic look: Level 2 active project card id if selected */
  cosmicSelectedCardId: string | null
  setCosmicNavigation: (level1: string, cardId?: string | null) => void
  /** Basic look: Active tab under selected project card ('dashboard' | 'slack' | 'teams' | 'whatsapp' | string) */
  basicActiveTab: string
  setBasicNavigation: (projectId: string, tab?: string) => void

  openDashboard: (appId?: 'slack') => void
  closeDashboard: () => void
  openWizard: (projectId?: string) => void
  closeWizard: () => void
  setDashRailExpanded: (expanded: boolean) => void

  loadSnapshot: () => Promise<void>
  loadRecent: () => Promise<void>
  upsertProject: (
    project:
      | Omit<DashboardProject, 'id' | 'createdAt'>
      | (Omit<DashboardProject, 'createdAt'> & { id: string })
  ) => Promise<void>
  deleteProject: (projectId: string) => Promise<void>
  updateSource: (payload: DashboardUpdateSourcePayload) => Promise<DashboardUpdateSourceResult>
  discoverSourceChannels: (
    payload: DashboardDiscoverSourceChannelsPayload
  ) => Promise<DashboardDiscoverSourceChannelsResult>
  setPinnedOrder: (order: string[]) => Promise<void>
  syncNow: (projectId?: string) => Promise<void>
  syncSource: (payload: { projectId: string; sourceId?: string; options?: DashboardScrapeOptions }) => Promise<{
    channelsRead: number
    newMessages: number
    status: string
    error?: string
  }>
  addManualToken: (
    key: string,
    token: string
  ) => Promise<Omit<ValidateTokenResultPayload, 'validated'>>
  applySnapshot: (snapshot: DashboardSnapshot) => void
  applyProgress: (payload: DashboardSyncProgressPayload) => void
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  dashboardOpen: false,
  dashboardAppId: null,
  snapshot: null,
  recent: [],
  cosmicLevel1: 'all',
  cosmicSelectedCardId: null,
  setCosmicNavigation: (level1, cardId = null) =>
    set({
      cosmicLevel1: level1,
      cosmicSelectedCardId: cardId,
      dashboardOpen: level1 === 'all' || cardId !== null
    }),
  basicActiveTab: 'dashboard',
  setBasicNavigation: (projectId: string, tab: string = 'dashboard') =>
    set({
      cosmicSelectedCardId: projectId,
      basicActiveTab: tab,
      dashboardOpen: tab === 'dashboard'
    }),
  loading: false,
  syncingProjectIds: [],
  progress: null,
  error: null,
  wizardOpenFor: null,
  dashRailExpanded: false,

  openDashboard: (appId = 'slack') => set({ dashboardOpen: true, dashboardAppId: appId }),
  closeDashboard: () => set({ dashboardOpen: false }),
  openWizard: (projectId) => set({ wizardOpenFor: { projectId: projectId ?? null } }),
  closeWizard: () => set({ wizardOpenFor: null }),
  setDashRailExpanded: (expanded) => set({ dashRailExpanded: expanded }),

  loadSnapshot: async () => {
    const state = get()
    if (state.loading) return
    set({ loading: true, error: null })
    try {
      const snapshot = await window.api.dashboard.getSnapshot()
      set({ snapshot, loading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'failed to load dashboard',
        loading: false
      })
    }
  },

  loadRecent: async () => {
    try {
      const recent = await window.api.dashboard.getRecent()
      set({ recent })
    } catch {
      set({ recent: [] })
    }
  },

  upsertProject: async (project) => {
    const snapshot = await window.api.dashboard.upsertProject({ project })
    set({ snapshot })
  },

  deleteProject: async (projectId) => {
    const snapshot = await window.api.dashboard.deleteProject({ projectId })
    set({ snapshot })
  },

  updateSource: async (payload) => {
    const result = await window.api.dashboard.updateSource(payload)
    set({ snapshot: result.snapshot })
    return result
  },

  discoverSourceChannels: async (payload) => {
    return window.api.dashboard.discoverSourceChannels(payload)
  },

  setPinnedOrder: async (order) => {
    const snapshot = await window.api.dashboard.setPinnedOrder({ order })
    set({ snapshot })
  },

  syncNow: async (projectId) => {
    set({ error: null })
    try {
      await window.api.dashboard.syncNow({ projectId })
      const snapshot = await window.api.dashboard.getSnapshot()
      set({ snapshot })
      void get().loadRecent()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'sync failed' })
    }
  },

  syncSource: async (payload) => {
    try {
      const res = await window.api.dashboard.syncSource(payload)
      const snapshot = await window.api.dashboard.getSnapshot()
      set({ snapshot })
      void get().loadRecent()
      return res
    } catch (err) {
      return {
        channelsRead: 0,
        newMessages: 0,
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to scrape source'
      }
    }
  },

  addManualToken: async (key, token) => {
    const result = await window.api.dashboard.validateManualToken({ key, token })
    if (result.valid) {
      get().loadSnapshot()
    }
    return {
      key: result.key,
      valid: result.valid,
      error: result.error,
      teamName: result.teamName,
      teamId: result.teamId,
      userName: result.userName,
      userId: result.userId,
      scopes: result.scopes
    }
  },

  applySnapshot: (snapshot) => set({ snapshot, loading: false }),

  applyProgress: (payload) =>
    set((state) => ({
      progress: payload,
      syncingProjectIds: payload.syncing
        ? Array.from(
            new Set([...state.syncingProjectIds, ...(payload.projectId ? [payload.projectId] : [])])
          )
        : state.syncingProjectIds.filter((id) => !payload.projectIds.includes(id))
    }))
}))

export type { DashboardManualToken }
