import { create } from 'zustand'
import {
  AppId,
  AppSessionStatus,
  Profile,
  SlackChannelSummary,
  SlackWorkspaceLink,
  ViewportBounds
} from '../../../shared/types'

interface ProfileState {
  profiles: Profile[]
  activeProfileId: string | null
  activeAppId: AppId | null
  workspaces: SlackWorkspaceLink[]
  workspacesByProfileId: Record<string, SlackWorkspaceLink[]>
  channels: SlackChannelSummary[]
  selectedTeamId: string | null
  loading: boolean
  syncingProfileId: string | null
  error: string | null
  loadProfiles: () => Promise<void>
  createProfile: (displayName: string) => Promise<Profile>
  deleteProfile: (profileId: string, deleteCards?: boolean) => Promise<void>
  deleteUnsignedDuplicates: () => Promise<void>
  clearStuckAuth: () => Promise<void>
  activateProfile: (profileId: string, bounds: ViewportBounds) => Promise<void>
  selectApp: (profileId: string, appId: AppId, bounds: ViewportBounds) => Promise<void>
  clearActiveApp: () => void
  startGoogleAuth: (profileId: string, bounds?: ViewportBounds) => Promise<void>
  startFirstLogin: (profileId: string, bounds?: ViewportBounds) => Promise<Profile | undefined>
  startAppLogin: (profileId: string, appId: AppId, bounds?: ViewportBounds) => Promise<void>
  connectWorkspace: (profileId: string) => Promise<void>
  loadWorkspaces: (profileId: string) => Promise<void>
  loadWorkspacesForAll: () => Promise<void>
  loadChannels: (profileId: string, teamId: string) => Promise<void>
  syncWorkspaces: (profileId: string, appId: AppId, bounds: ViewportBounds) => Promise<void>
  pinFromAvailable: (profileId: string, appId: AppId, teamId: string) => Promise<void>
  unpinWorkspace: (profileId: string, appId: AppId, teamId: string) => Promise<void>
  openWorkspace: (
    profileId: string,
    appId: AppId,
    teamId: string,
    bounds: ViewportBounds
  ) => Promise<void>
  applyProfileUpdate: (profile: Profile) => void
  applySessionStatus: (profileId: string, appId: AppId, sessionStatus: AppSessionStatus) => void
  clearError: () => void
}

function replaceProfile(profiles: Profile[], updated: Profile): Profile[] {
  return profiles.map((p) => (p.id === updated.id ? updated : p))
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  activeProfileId: null,
  activeAppId: null,
  workspaces: [],
  workspacesByProfileId: {},
  channels: [],
  selectedTeamId: null,
  loading: false,
  syncingProfileId: null,
  error: null,

  clearError: () => set({ error: null }),

  clearActiveApp: () => set({ activeAppId: null, channels: [], selectedTeamId: null }),

  applySessionStatus: (profileId, appId, sessionStatus) => {
    const current = get().profiles.find((p) => p.id === profileId)
    if (!current || current.apps[appId].sessionStatus === sessionStatus) {
      return
    }
    set({
      profiles: get().profiles.map((p) =>
        p.id === profileId
          ? {
              ...p,
              apps: {
                ...p.apps,
                [appId]: { ...p.apps[appId], sessionStatus }
              }
            }
          : p
      )
    })
  },

  applyProfileUpdate: (updated) => {
    const prev = get().profiles.find((p) => p.id === updated.id)
    if (prev === updated) return
    set({ profiles: replaceProfile(get().profiles, updated) })
  },

  loadProfiles: async () => {
    set({ loading: true, error: null })
    try {
      const profiles = await window.api.profiles.list()
      const currentActive = get().activeProfileId
      const hasCurrent = profiles.some((p) => p.id === currentActive)
      const defaultActive = hasCurrent ? currentActive : (profiles[0]?.id ?? null)
      set({ profiles, activeProfileId: defaultActive, loading: false })
      await get().loadWorkspacesForAll()
    } catch (err) {
      set({ loading: false, error: String(err) })
    }
  },

  loadWorkspacesForAll: async () => {
    const { profiles } = get()
    const entries = await Promise.all(
      profiles.map(async (profile) => {
        try {
          const list = await window.api.slack.listWorkspaces(profile.id)
          return [profile.id, list] as const
        } catch {
          return [profile.id, [] as SlackWorkspaceLink[]] as const
        }
      })
    )
    const workspacesByProfileId = Object.fromEntries(entries)
    const activeId = get().activeProfileId
    set({
      workspacesByProfileId,
      ...(activeId ? { workspaces: workspacesByProfileId[activeId] ?? [] } : {})
    })
  },

  createProfile: async (displayName: string) => {
    set({ error: null })
    try {
      const profile = await window.api.profiles.create(displayName)
      const existing = get().profiles.find((p) => p.id === profile.id)
      set({
        profiles: existing
          ? get().profiles.map((p) => (p.id === profile.id ? profile : p))
          : [...get().profiles, profile],
        workspacesByProfileId: {
          ...get().workspacesByProfileId,
          [profile.id]: get().workspacesByProfileId[profile.id] ?? []
        },
        activeProfileId: profile.id,
        activeAppId: null,
        channels: [],
        selectedTeamId: null,
        workspaces: get().workspacesByProfileId[profile.id] ?? []
      })
      return profile
    } catch (err) {
      set({ error: String(err) })
      throw err
    }
  },

  deleteUnsignedDuplicates: async () => {
    set({ error: null })
    try {
      const profiles = await window.api.profiles.deleteUnsignedDuplicates()
      const activeStill = profiles.some((p) => p.id === get().activeProfileId)
      set({
        profiles,
        ...(activeStill
          ? {}
          : {
              activeProfileId: null,
              activeAppId: null,
              workspaces: [],
              channels: [],
              selectedTeamId: null
            })
      })
    } catch (err) {
      set({ error: String(err) })
      throw err
    }
  },

  clearStuckAuth: async () => {
    const profiles = await window.api.profiles.clearStuckAuth()
    set({ profiles })
  },

  deleteProfile: async (profileId: string, deleteCards?: boolean) => {
    set({ error: null })
    try {
      await window.api.profiles.delete(profileId, deleteCards)
      const profiles = get().profiles.filter((p) => p.id !== profileId)
      const workspacesByProfileId = { ...get().workspacesByProfileId }
      delete workspacesByProfileId[profileId]
      const activeProfileId = get().activeProfileId === profileId ? null : get().activeProfileId
      set({
        profiles,
        workspacesByProfileId,
        activeProfileId,
        ...(activeProfileId === null
          ? { activeAppId: null, workspaces: [], channels: [], selectedTeamId: null }
          : {})
      })
    } catch (err) {
      set({ error: String(err) })
      throw err
    }
  },

  activateProfile: async (profileId, bounds) => {
    set({ error: null })
    try {
      await window.api.profiles.activate(profileId, bounds)
      set({
        activeProfileId: profileId,
        activeAppId: null,
        channels: [],
        selectedTeamId: null
      })
      await get().loadWorkspaces(profileId)
    } catch (err) {
      set({ error: String(err) })
      throw err
    }
  },

  selectApp: async (profileId, appId, bounds) => {
    set({ error: null })
    try {
      const profile = get().profiles.find((p) => p.id === profileId)
      if (!profile) {
        throw new Error('Profile not found')
      }

      if (
        get().activeProfileId === profileId &&
        get().activeAppId === appId &&
        profile.apps[appId].sessionStatus === 'signed-in'
      ) {
        await window.api.profiles.updateBounds(bounds)
        return
      }

      if (profile.apps[appId].sessionStatus !== 'signed-in') {
        if (appId === 'whatsapp' || appId === 'teams') {
          set({
            activeProfileId: profileId,
            activeAppId: appId,
            channels: [],
            selectedTeamId: null,
            workspaces: []
          })
        }
        await get().startAppLogin(profileId, appId, bounds)
      }
      const refreshed = get().profiles.find((p) => p.id === profileId)
      if (refreshed?.apps[appId].sessionStatus !== 'signed-in') {
        if (appId === 'whatsapp' || appId === 'teams') {
          // Keep WhatsApp QR / Microsoft sign-in visible even if not linked yet.
          try {
            await window.api.profiles.activateApp(profileId, appId, bounds)
          } catch {
            /* ignore */
          }
          set({
            activeProfileId: profileId,
            activeAppId: appId,
            channels: [],
            selectedTeamId: null,
            workspaces: []
          })
        }
        return
      }
      await window.api.profiles.activateApp(profileId, appId, bounds)
      set({
        activeProfileId: profileId,
        activeAppId: appId,
        channels: [],
        selectedTeamId: null
      })
      if (appId === 'slack') {
        await get().loadWorkspaces(profileId)
      } else {
        set({ workspaces: [] })
      }
    } catch (err) {
      set({ error: String(err) })
      throw err
    }
  },

  startFirstLogin: async (profileId, bounds) => {
    set({ error: null })
    try {
      const updated = await window.api.profiles.startFirstLogin(profileId, bounds)
      set({ profiles: replaceProfile(get().profiles, updated) })
      return updated
    } catch (err) {
      set({ error: String(err) })
      throw err
    }
  },

  startGoogleAuth: async (profileId, bounds) => {
    set({ error: null })
    try {
      // Optimistic: clear any premature ✓ while Chrome auth is open.
      const current = get().profiles.find((p) => p.id === profileId)
      if (current) {
        set({
          profiles: replaceProfile(get().profiles, {
            ...current,
            googleAuthStatus: 'signing-in'
          })
        })
      }
      const updated = await window.api.profiles.startGoogleAuth(profileId, bounds)
      set({ profiles: replaceProfile(get().profiles, updated) })
    } catch (err) {
      set({ error: String(err) })
      throw err
    }
  },

  startAppLogin: async (profileId, appId, bounds) => {
    set({ error: null })
    try {
      // Optimistic busy state so ✓ never sticks during in-flight auth.
      const current = get().profiles.find((p) => p.id === profileId)
      if (current) {
        let busyStatus = current.apps[appId].sessionStatus
        if (appId === 'slack') {
          busyStatus = 'signing-in-slack'
        } else if (appId === 'teams' || appId === 'whatsapp') {
          busyStatus = 'signing-in'
        }
        set({
          profiles: replaceProfile(get().profiles, {
            ...current,
            apps: {
              ...current.apps,
              [appId]: { ...current.apps[appId], sessionStatus: busyStatus }
            }
          }),
          ...(appId === 'whatsapp' || appId === 'teams'
            ? {
                activeProfileId: profileId,
                activeAppId: appId,
                channels: [],
                selectedTeamId: null,
                workspaces: []
              }
            : {})
        })
      } else if (appId === 'whatsapp') {
        set({
          activeProfileId: profileId,
          activeAppId: 'whatsapp',
          channels: [],
          selectedTeamId: null,
          workspaces: []
        })
      }
      const updated = await window.api.profiles.startAppLogin(profileId, appId, bounds)
      set({ profiles: replaceProfile(get().profiles, updated) })
      // Keep WhatsApp Web visible after QR wait ends (signed-in or still pending).
      if (appId === 'whatsapp' && get().activeProfileId === profileId) {
        set({ activeAppId: 'whatsapp' })
      }
    } catch (err) {
      set({ error: String(err) })
      throw err
    }
  },

  connectWorkspace: async (profileId: string) => {
    set({ error: null, loading: true })
    try {
      await window.api.slack.connectWorkspace(profileId)
      await get().loadProfiles()
      await get().loadWorkspaces(profileId)
      set({ loading: false })
    } catch (err) {
      set({ loading: false, error: String(err) })
      throw err
    }
  },

  loadWorkspaces: async (profileId: string) => {
    try {
      const workspaces = await window.api.slack.listWorkspaces(profileId)
      set({
        workspaces,
        workspacesByProfileId: {
          ...get().workspacesByProfileId,
          [profileId]: workspaces
        }
      })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  loadChannels: async (profileId: string, teamId: string) => {
    set({ loading: true, selectedTeamId: teamId })
    try {
      const channels = await window.api.slack.listChannels(profileId, teamId)
      set({ channels, loading: false })
    } catch (err) {
      set({ channels: [], loading: false })
      const message = String(err)
      if (!/No token for profile=/i.test(message)) {
        set({ error: message })
      }
    }
  },

  syncWorkspaces: async (profileId, appId, bounds) => {
    set({ error: null, syncingProfileId: profileId })
    try {
      const updated = await window.api.profiles.syncWorkspaces(profileId, appId, bounds)
      set({
        profiles: replaceProfile(get().profiles, updated),
        syncingProfileId: null,
        activeProfileId: profileId,
        activeAppId: appId
      })
    } catch (err) {
      set({ syncingProfileId: null, error: String(err) })
      throw err
    }
  },

  pinFromAvailable: async (profileId, appId, teamId) => {
    set({ error: null })
    try {
      const updated = await window.api.profiles.pinFromAvailable(profileId, appId, teamId)
      set({ profiles: replaceProfile(get().profiles, updated) })
    } catch (err) {
      set({ error: String(err) })
      throw err
    }
  },

  unpinWorkspace: async (profileId, appId, teamId) => {
    set({ error: null })
    try {
      const updated = await window.api.profiles.unpinWorkspace(profileId, appId, teamId)
      set({ profiles: replaceProfile(get().profiles, updated) })
    } catch (err) {
      set({ error: String(err) })
      throw err
    }
  },

  openWorkspace: async (profileId, appId, teamId, bounds) => {
    set({ error: null })
    try {
      await window.api.profiles.openWorkspace(profileId, appId, teamId, bounds)
      set({
        activeProfileId: profileId,
        activeAppId: appId,
        channels: [],
        selectedTeamId: teamId
      })
      if (appId === 'slack') {
        await get().loadWorkspaces(profileId)
        const apiLinked = (get().workspacesByProfileId[profileId] ?? []).some(
          (w) => w.teamId === teamId
        )
        if (apiLinked) {
          await get().loadChannels(profileId, teamId)
        }
      }
    } catch (err) {
      set({ error: String(err) })
      throw err
    }
  }
}))
