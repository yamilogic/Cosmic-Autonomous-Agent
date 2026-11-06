import type {
  DashboardAiModelsQueryPayload,
  DashboardAiModelsResult,
  DashboardAiSettingsQueryPayload,
  DashboardAiSettingsSavePayload,
  DashboardAiSettingsView,
  DashboardAiTestResult,
  DashboardGlobalConfig,
  DashboardProjectDefaults,
  DashboardListChannelsPayload,
  DashboardDiscoverSourceChannelsPayload,
  DashboardDiscoverSourceChannelsResult,
  DashboardUpdateSourcePayload,
  DashboardUpdateSourceResult,
  DashboardAppClientConfig,
  DashboardChatMessage,
  DashboardChannelHistoryPayload,
  DashboardChannelHistoryResult,
  DashboardChatPage,
  DashboardChatQueryPayload,
  DashboardChatTokenStatus,
  DashboardProjectChatChunkEvent,
  DashboardProjectChatDoneEvent,
  DashboardProjectChatErrorEvent,
  DashboardProjectChatHistoryResult,
  DashboardProjectChatPayload,
  DashboardProjectChatStartResult,
  DashboardProjectChatStatus,
  DashboardProjectActivity,
  DashboardSendErrorCode,
  DashboardSendMessagePayload,
  DashboardSendMessageResult,
  DashboardSendAgentMessagePayload,
  DashboardSendAgentMessageResult,
  InsightHistoryEntryContract,
  DashboardManualToken,
  DashboardMarkViewedPayload,
  DashboardCancelScrapePayload,
  DashboardScrapePayload,
  DashboardSourceSchedulePayload,
  DashboardSourceScheduleState,
  ScrapeRunLog,
  ScrapeRunQuery,
  DashboardPinnedOrderPayload,
  DashboardRunSchedulePayload,
  DashboardSchedulesState,
  DashboardSnapshot,
  DashboardSyncProgressPayload,
  DashboardUpdateSchedulePayload,
  DashboardTeamWorkspace,
  DashboardTeamWorkspaceCandidate,
  DashboardTeamWorkspaceChannelsPayload,
  DashboardTeamWorkspaceConnectPayload,
  DashboardViewSetPayload,
  ManualTokenPayload,
  ProjectDeletePayload,
  ProjectUpsertPayload,
  RecentActivity,
  SidebarState,
  ProjectSidebarState,
  SyncNowPayload,
  ValidateTokenResultPayload
} from './dashboard-contract'
import type {
  ActivateAppPayload,
  ActivateProfilePayload,
  AppId,
  ChannelHistoryPayload,
  CreateProfileInput,
  CurrentWorkspaceInfo,
  OpenWorkspacePayload,
  PinFromAvailablePayload,
  Profile,
  ProfileIdPayload,
  ProfileSessionStatusPayload,
  SlackChannelSummary,
  SlackMessageSummary,
  SlackWorkspaceLink,
  StartAppLoginPayload,
  SyncWorkspacesPayload,
  UnpinWorkspacePayload,
  ViewportBounds,
  WorkspacePayload,
  WorkspaceThemePayload,
  WorkspaceMapping,
  StartGoogleAuthPayload
} from './types'

export const IpcChannels = {
  ProfileList: 'profile:list',
  ProfileCreate: 'profile:create',
  ProfileDelete: 'profile:delete',
  ProfileDeleteUnsignedDuplicates: 'profile:delete-unsigned-duplicates',
  ProfileClearStuckAuth: 'profile:clear-stuck-auth',
  ProfileCancelAuthBusy: 'profile:cancel-auth-busy',
  ProfileActivate: 'profile:activate',
  ProfileActivateApp: 'profile:activate-app',
  ProfileUpdateBounds: 'profile:update-bounds',
  ProfileSetEmbedVisible: 'profile:set-embed-visible',
  ProfileActivateCardSlackEmbed: 'profile:activate-card-slack-embed',
  ProfileActivateCardWebEmbed: 'profile:activate-card-web-embed',
  ProfileReloadCardEmbed: 'profile:reload-card-embed',
  ProfileStartCardAppLogin: 'profile:start-card-app-login',
  ProfileUpdateCardSlackEmbedBounds: 'profile:update-card-slack-embed-bounds',
  ProfileClearCardSlackEmbed: 'profile:clear-card-slack-embed',
  ProfileStartFirstLogin: 'profile:start-first-login',
  ProfileStartGoogleAuth: 'profile:start-google-auth',
  ProfileStartAppLogin: 'profile:start-app-login',
  ProfileConfirmChromeEmbed: 'profile:confirm-chrome-embed',
  ProfileCancelChromeEmbed: 'profile:cancel-chrome-embed',
  ProfileSyncChromeEmbedBounds: 'profile:sync-chrome-embed-bounds',
  ProfileSyncWorkspaces: 'profile:sync-workspaces',
  ProfilePinFromAvailable: 'profile:pin-from-available',
  ProfileUnpinWorkspace: 'profile:unpin-workspace',
  ProfileGetCurrentWorkspace: 'profile:get-current-workspace',
  ProfileOpenWorkspace: 'profile:open-workspace',
  ProfileSetCustomName: 'profile:set-custom-name',
  ProfileSetMuted: 'profile:set-muted',
  ProfileReorder: 'profile:reorder',
  ProfileClearAll: 'profile:clear-all',
  ProfileExportMetadata: 'profile:export-metadata',
  ProfileImportMetadata: 'profile:import-metadata',
  ProfileActivateSplit: 'profile:activate-split',
  ProfileClearSplit: 'profile:clear-split',
  ProfileAddCustomLink: 'profile:add-custom-link',
  ProfileUpdateCustomLink: 'profile:update-custom-link',
  ProfileRemoveCustomLink: 'profile:remove-custom-link',
  ProfileReorderCustomLinks: 'profile:reorder-custom-links',
  ProfileListCustomLinks: 'profile:list-custom-links',
  ProfileSetHiddenInSidebar: 'profile:set-hidden-in-sidebar',
  ProfileSetAccountScope: 'profile:set-account-scope',
  ProfileSetLinkHiddenInSidebar: 'profile:set-link-hidden-in-sidebar',
  ProfileActivateCustomLink: 'profile:activate-custom-link',
  ProfileSessionStatusChanged: 'profile:session-status-changed',
  ProfileUpdated: 'profile:updated',
  ProfileAuthProgress: 'profile:auth-progress',
  ProfileDeepLink: 'profile:deep-link',
  UnreadCountsChanged: 'unread:counts-changed',
  WorkspaceThemeChanged: 'ui:workspace-theme-changed',
  AppToast: 'app:toast',

  AppSettingsGet: 'app:settings-get',
  AppSettingsSet: 'app:settings-set',
  AppSettingsChanged: 'app:settings-changed',
  AppLock: 'app:lock',
  AppUnlock: 'app:unlock',
  AppLockStateChanged: 'app:lock-state-changed',
  AppIdleActivity: 'app:idle-activity',
  AppPushRecent: 'app:push-recent',
  AppCheckUpdates: 'app:check-updates',
  AppTestNotification: 'app:test-notification',
  AppAdminStatus: 'app:admin-status',
  AppAdminLogin: 'app:admin-login',
  AppAdminLogout: 'app:admin-logout',

  LogsGetRecent: 'logs:get-recent',
  LogsSetRetention: 'logs:set-retention',
  LogsClear: 'logs:clear',
  LogsExport: 'logs:export',
  LogsLogAction: 'logs:log-action',
  LogsOnEntry: 'logs:on-entry',

  OauthStartWorkspaceConnect: 'oauth:start-workspace-connect',

  SlackWorkspacesForProfile: 'slack:workspaces-for-profile',
  SlackChannelsForWorkspace: 'slack:channels-for-workspace',
  SlackHistoryForChannel: 'slack:history-for-channel',

  DashboardGetSnapshot: 'dashboard:get-snapshot',
  DashboardMarkViewed: 'dashboard:mark-viewed',
  DashboardGetAppConfig: 'dashboard:get-app-config',
  DashboardGetHistory: 'dashboard:get-history',
  DashboardGetRecent: 'dashboard:get-recent',
  DashboardListChannels: 'dashboard:list-channels',
  DashboardDiscoverSourceChannels: 'dashboard:discover-source-channels',
  DashboardUpdateSource: 'dashboard:update-source',
  DashboardViewSet: 'dashboard:view-set',
  DashboardPinnedOrderSet: 'dashboard:pinned-order-set',
  DashboardUpsertProject: 'dashboard:upsert-project',
  DashboardDeleteProject: 'dashboard:delete-project',
  DashboardSyncNow: 'dashboard:sync-now',
  DashboardAddManualToken: 'dashboard:add-manual-token',
  DashboardValidateManualToken: 'dashboard:validate-manual-token',
  DashboardSnapshotChanged: 'dashboard:snapshot-changed',
  DashboardSyncProgress: 'dashboard:sync-progress',
  DashboardSchedulesGet: 'dashboard:schedules-get',
  DashboardSchedulesUpdate: 'dashboard:schedules-update',
  DashboardSchedulesRun: 'dashboard:schedules-run',
  DashboardSchedulesChanged: 'dashboard:schedules-changed',

  DashboardSidebarGet: 'dashboard:sidebar-get',
  DashboardSidebarSet: 'dashboard:sidebar-set',
  DashboardSidebarUpdate: 'dashboard:sidebar-update',
  DashboardGetMessages: 'dashboard:get-messages',
  DashboardSendMessage: 'dashboard:send-message',
  DashboardSendAgentMessage: 'dashboard:send-agent-message',
  DashboardChatTokenStatus: 'dashboard:chat-token-status',
  DashboardProjectActivity: 'dashboard:project-activity',
  DashboardProjectChat: 'dashboard:project-chat',
  DashboardProjectChatClear: 'dashboard:project-chat-clear',
  DashboardProjectChatCancel: 'dashboard:project-chat-cancel',
  DashboardProjectChatHistory: 'dashboard:project-chat-history',
  DashboardProjectChatStatus: 'dashboard:project-chat-status',
  DashboardProjectChatChunk: 'dashboard:project-chat-chunk',
  DashboardProjectChatDone: 'dashboard:project-chat-done',
  DashboardProjectChatError: 'dashboard:project-chat-error',

  DashboardGetAiSettings: 'dashboard:get-ai-settings',
  DashboardSaveAiSettings: 'dashboard:save-ai-settings',
  DashboardListAiModels: 'dashboard:list-ai-models',
  DashboardTestAi: 'dashboard:test-ai',
  DashboardConfigGet: 'dashboard:config-get',
  DashboardConfigChanged: 'dashboard:config-changed',
  DashboardProjectDefaultsSet: 'dashboard:project-defaults-set',

  DashboardTeamWorkspaceGet: 'dashboard:team-workspace-get',
  DashboardTeamWorkspaceCandidates: 'dashboard:team-workspace-candidates',
  DashboardTeamWorkspaceConnect: 'dashboard:team-workspace-connect',
  DashboardTeamWorkspaceChannels: 'dashboard:team-workspace-channels',
  DashboardTeamWorkspaceClear: 'dashboard:team-workspace-clear',
  DashboardWorkspaceMappingList: 'dashboard:workspace-mapping-list',
  DashboardWorkspaceMappingGet: 'dashboard:workspace-mapping-get',
  DashboardWorkspaceMappingSave: 'dashboard:workspace-mapping-save',
  DashboardWorkspaceMappingDelete: 'dashboard:workspace-mapping-delete',
  DashboardGetProjects: 'dashboard:get-projects',
  DashboardCardCheckAuth: 'dashboard:card-check-auth',
  DashboardSyncSource: 'dashboard:sync-source',
  DashboardGetRunLogs: 'dashboard:get-run-logs',
  DashboardGetScrapeRuns: 'dashboard:get-scrape-runs',
  DashboardCancelScrape: 'dashboard:cancel-scrape',
  DashboardSetSourceSchedule: 'dashboard:set-source-schedule',
  DashboardGetChannelHistory: 'dashboard:get-channel-history',
  DashboardUploadDocument: 'dashboard:upload-document',
  DashboardListDocuments: 'dashboard:list-documents',
  DashboardDeleteDocument: 'dashboard:delete-document',
  DashboardStartWatchLive: 'dashboard:start-watch-live',
  DashboardStopWatchLive: 'dashboard:stop-watch-live',
  DashboardScrapeEvent: 'dashboard:scrape-event',

  StorageGetSummary: 'storage:get-summary',
  StorageClean: 'storage:clean'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/** Key: `${profileId}:${appId}` → unread count */
export type UnreadCountsMap = Record<string, number>

export interface AppSettings {
  notificationsEnabled: boolean
  idleLockMinutes: number
  theme: 'system' | 'light' | 'dark'
  sidebarDensity: 'comfortable' | 'compact'
  /** Sidebar pixel width (user-resizable). */
  sidebarWidth: number
  /** When true, primary sidebar is collapsed (IDE-style). */
  sidebarCollapsed: boolean
  idleSleepMinutes: number
  splitViewEnabled: boolean
  notificationSound: boolean
  recentWorkspaces: Array<{
    profileId: string
    appId: string
    teamId: string
    label: string
    at: string
  }>
  sidebarLook: 'minimal' | 'ancient' | 'new-cosmic' | 'basic'
  showLookSwitcher: boolean
  showRecentSection: boolean
  sidebarButtons: {
    addWebsite: boolean
    newProject: boolean
    newProfile: boolean
    observer: boolean
    profilesHub: boolean
  }
  showScrapeProgressLine?: boolean
  /** Global gate for scraping personal DMs. Cards may override. Default: false. */
  scrapePersonalDms?: boolean
  showGoogleEmailInputInSidebar?: boolean
  showProfileScopeSelector?: boolean
  /** When true, show "OBSERVER VIEW" label + divider above the 6 bottom sidebar buttons. Default: false. */
  showObserverViewHeader?: boolean
  /** Base layout presets for sidebar apps: none (empty), standard (Slack, Teams, WhatsApp), extended, full */
  baseAppLayout?: 'none' | 'standard' | 'extended' | 'full'
  /** When true, display quick actions (hide/remove) on sidebar items hover. Default: true. */
  showSidebarItemActions?: boolean
  /** When true, display the hide (👁) button on profile headers in the main sidebar. Default: false. */
  showSidebarProfileHideButton?: boolean
  /** When true, display Profile navigation button in sidebar (All Profiles / Profile). Default: true. */
  showSidebarProfileNavButton?: boolean
  /** When true, display Dashboard navigation button in sidebar (Full Dashboard / Dashboard). Default: true. */
  showSidebarDashboardNavButton?: boolean
  /** Backward compatibility: display Profile and Dashboard navigation buttons in sidebar. Default: true. */
  showCosmicProfileNavButtons?: boolean
  /** When true, display "Linked Accounts & Workspaces" section in the Create Project Card modal. Default: false. */
  showNewProjectLinkedAccounts?: boolean
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  showNewProjectLinkedAccounts: false,
  baseAppLayout: 'standard',
  showSidebarItemActions: true,
  showSidebarProfileHideButton: false,
  showSidebarProfileNavButton: true,
  showSidebarDashboardNavButton: true,
  showCosmicProfileNavButtons: true,
  notificationsEnabled: true,
  idleLockMinutes: 15,
  theme: 'dark',
  sidebarDensity: 'comfortable',
  sidebarWidth: 300,
  sidebarCollapsed: false,
  idleSleepMinutes: 30,
  splitViewEnabled: false,
  notificationSound: false,
  recentWorkspaces: [],
  sidebarLook: 'basic',
  showLookSwitcher: false,
  showRecentSection: true,
  showScrapeProgressLine: true,
  scrapePersonalDms: false,
  showGoogleEmailInputInSidebar: true,
  showProfileScopeSelector: false,
  showObserverViewHeader: false,
  sidebarButtons: {
    addWebsite: false,
    newProject: false,
    newProfile: false,
    observer: false,
    profilesHub: false
  }
}

export type AdminStatus = {
  authenticated: boolean
  configured: boolean
  envPathHint: string
}

export type AdminLoginResult = { ok: true } | { ok: false; message: string }

export interface IpcApi {
  profiles: {
    list: () => Promise<Profile[]>
    create: (displayName: string) => Promise<Profile>
    delete: (profileId: string, deleteCards?: boolean) => Promise<void>
    deleteUnsignedDuplicates: () => Promise<Profile[]>
    clearStuckAuth: () => Promise<Profile[]>
    cancelAuthBusy: (profileId?: string) => Promise<Profile[]>
    clearAll: () => Promise<Profile[]>
    setCustomName: (profileId: string, customName: string | null) => Promise<Profile>
    setMuted: (profileId: string, muted: boolean) => Promise<Profile>
    reorder: (orderedIds: string[]) => Promise<Profile[]>
    exportMetadata: () => Promise<Profile[]>
    importMetadata: (profiles: Profile[]) => Promise<Profile[]>
    activate: (profileId: string, bounds: ViewportBounds) => Promise<void>
    activateApp: (profileId: string, appId: AppId, bounds: ViewportBounds) => Promise<void>
    activateSplit: (
      primary: { profileId: string; appId: AppId; bounds: ViewportBounds },
      secondary: { profileId: string; appId: AppId; bounds: ViewportBounds }
    ) => Promise<void>
    clearSplit: () => Promise<void>
    addCustomLink: (profileId: string, link: { name: string; url: string }) => Promise<Profile>
    updateCustomLink: (
      profileId: string,
      linkId: string,
      patch: { name?: string; url?: string }
    ) => Promise<Profile>
    removeCustomLink: (profileId: string, linkId: string) => Promise<Profile>
    reorderCustomLinks: (profileId: string, orderedIds: string[]) => Promise<Profile>
    listCustomLinks: (profileId: string) => Promise<import('./types').CustomLink[]>
    setHiddenInSidebar: (profileId: string, hidden: boolean) => Promise<Profile>
    setAccountScope: (profileId: string, scope: import('./types').ProfileScope) => Promise<Profile>
    setLinkHiddenInSidebar: (profileId: string, linkId: string, hidden: boolean) => Promise<Profile>
    activateCustomLink: (
      profileId: string,
      linkId: string,
      url: string,
      bounds: ViewportBounds
    ) => Promise<void>
    updateBounds: (bounds: ViewportBounds) => Promise<void>
    setEmbedVisible: (visible: boolean) => Promise<void>
    activateCardSlackEmbed: (payload: { projectId?: string; profileId: string; teamId?: string; appId?: AppId; bounds: ViewportBounds }) => Promise<void>
    activateCardWebEmbed: (payload: {
      projectId?: string
      profileId: string
      linkId: string
      url: string
      bounds: ViewportBounds
    }) => Promise<void>
    reloadCardEmbed: () => Promise<void>
    startCardAppLogin: (payload: { projectId: string; profileId: string; appId: AppId; bounds?: ViewportBounds }) => Promise<Profile>
    updateCardSlackEmbedBounds: (bounds: ViewportBounds) => Promise<void>
    clearCardSlackEmbed: () => Promise<void>
    startGoogleAuth: (profileId: string, bounds?: ViewportBounds) => Promise<Profile>
    startAppLogin: (profileId: string, appId: AppId, bounds?: ViewportBounds) => Promise<Profile>
    startFirstLogin: (profileId: string, bounds?: ViewportBounds) => Promise<Profile>
    confirmChromeEmbed: () => Promise<boolean>
    cancelChromeEmbed: () => Promise<boolean>
    syncChromeEmbedBounds: (bounds: ViewportBounds) => Promise<void>
    syncWorkspaces: (profileId: string, appId: AppId, bounds: ViewportBounds) => Promise<Profile>
    pinFromAvailable: (profileId: string, appId: AppId, teamId: string) => Promise<Profile>
    unpinWorkspace: (profileId: string, appId: AppId, teamId: string) => Promise<Profile>
    getCurrentWorkspace: (profileId: string, appId: AppId) => Promise<CurrentWorkspaceInfo | null>
    openWorkspace: (
      profileId: string,
      appId: AppId,
      teamId: string,
      bounds: ViewportBounds
    ) => Promise<void>
    onSessionStatusChanged: (callback: (payload: ProfileSessionStatusPayload) => void) => () => void
    onProfileUpdated: (callback: (profile: Profile) => void) => () => void
    onAuthProgress: (callback: (message: string) => void) => () => void
    onWorkspaceThemeChanged: (callback: (payload: WorkspaceThemePayload) => void) => () => void
    onUnreadCountsChanged: (callback: (counts: UnreadCountsMap) => void) => () => void
    onDeepLink: (
      callback: (payload: { profileId: string; appId?: AppId; teamId?: string }) => void
    ) => () => void
  }
  app: {
    getSettings: () => Promise<AppSettings>
    setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
    pushRecent: (entry: {
      profileId: string
      appId: string
      teamId: string
      label: string
    }) => Promise<AppSettings>
    lock: () => Promise<void>
    unlock: () => Promise<boolean>
    reportActivity: () => Promise<void>
    checkUpdates: () => Promise<{ ok: boolean; message: string }>
    testNotification: () => Promise<{ ok: boolean; message: string }>
    adminStatus: () => Promise<AdminStatus>
    adminLogin: (
      username: string,
      password: string,
      remember?: boolean
    ) => Promise<AdminLoginResult>
    adminLogout: () => Promise<void>
    onLockStateChanged: (callback: (locked: boolean) => void) => () => void
    onToast: (callback: (message: string) => void) => () => void
    onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void
  }
  slack: {
    connectWorkspace: (profileId: string) => Promise<SlackWorkspaceLink>
    listWorkspaces: (profileId: string) => Promise<SlackWorkspaceLink[]>
    listChannels: (profileId: string, teamId: string) => Promise<SlackChannelSummary[]>
    listHistory: (
      profileId: string,
      teamId: string,
      channelId: string,
      limit?: number
    ) => Promise<SlackMessageSummary[]>
  }
  dashboard: {
    getSnapshot: () => Promise<DashboardSnapshot>
    markViewed: (payload: DashboardMarkViewedPayload) => Promise<string>
    getSchedules: () => Promise<DashboardSchedulesState>
    updateSchedules: (payload: DashboardUpdateSchedulePayload) => Promise<DashboardSchedulesState>
    runSchedule: (payload: DashboardRunSchedulePayload) => Promise<DashboardSchedulesState>
    onSchedulesChanged: (callback: (state: DashboardSchedulesState) => void) => () => void
    getAppConfig: () => Promise<DashboardAppClientConfig>
    getHistory: (payload: { projectId: string }) => Promise<InsightHistoryEntryContract[]>
    getRecent: () => Promise<RecentActivity[]>
    listChannels: (payload: DashboardListChannelsPayload) => Promise<SlackChannelSummary[]>
    discoverSourceChannels: (
      payload: DashboardDiscoverSourceChannelsPayload
    ) => Promise<DashboardDiscoverSourceChannelsResult>
    updateSource: (payload: DashboardUpdateSourcePayload) => Promise<DashboardUpdateSourceResult>
    upsertProject: (payload: ProjectUpsertPayload) => Promise<DashboardSnapshot>
    deleteProject: (payload: ProjectDeletePayload) => Promise<DashboardSnapshot>
    syncNow: (payload?: SyncNowPayload) => Promise<void>
    addManualToken: (payload: ManualTokenPayload) => Promise<DashboardSnapshot>
    validateManualToken: (payload: ManualTokenPayload) => Promise<ValidateTokenResultPayload>
    setView: (payload: DashboardViewSetPayload) => Promise<void>
    setPinnedOrder: (payload: DashboardPinnedOrderPayload) => Promise<DashboardSnapshot>
    onSnapshotChanged: (callback: (snapshot: DashboardSnapshot) => void) => () => void
    onSyncProgress: (callback: (payload: DashboardSyncProgressPayload) => void) => () => void
    getSidebarState: (projectId: string) => Promise<ProjectSidebarState>
    setSidebarState: (projectId: string, state: ProjectSidebarState) => Promise<void>
    updateSidebarState: (
      projectId: string,
      sidebar: 'left' | 'right',
      patch: Partial<SidebarState>
    ) => Promise<SidebarState>
    getMessages: (payload: DashboardChatQueryPayload) => Promise<DashboardChatPage>
    sendMessage: (payload: DashboardSendMessagePayload) => Promise<DashboardSendMessageResult>
    sendAgentMessage: (
      payload: DashboardSendAgentMessagePayload
    ) => Promise<DashboardSendAgentMessageResult>
    getChatTokenStatus: (projectId: string) => Promise<DashboardChatTokenStatus>
    getProjectActivity: (projectId: string) => Promise<DashboardProjectActivity>
    projectChat: (payload: DashboardProjectChatPayload) => Promise<DashboardProjectChatStartResult>
    cancelProjectChat: (payload: { projectId: string; runId?: string }) => Promise<{ ok: boolean }>
    getProjectChatHistory: (projectId: string) => Promise<DashboardProjectChatHistoryResult>
    clearProjectChat: (projectId: string) => Promise<{ ok: boolean }>
    getProjectChatStatus: (projectId: string) => Promise<DashboardProjectChatStatus>
    onProjectChatChunk: (callback: (event: DashboardProjectChatChunkEvent) => void) => () => void
    onProjectChatDone: (callback: (event: DashboardProjectChatDoneEvent) => void) => () => void
    onProjectChatError: (callback: (event: DashboardProjectChatErrorEvent) => void) => () => void
    getAiSettings: (payload?: DashboardAiSettingsQueryPayload) => Promise<DashboardAiSettingsView>
    saveAiSettings: (payload: DashboardAiSettingsSavePayload) => Promise<DashboardAiSettingsView>
    listAiModels: (payload?: DashboardAiModelsQueryPayload) => Promise<DashboardAiModelsResult>
    testAi: (payload?: DashboardAiSettingsQueryPayload) => Promise<DashboardAiTestResult>
    getGlobalConfig: () => Promise<DashboardGlobalConfig>
    saveProjectDefaults: (
      payload: Partial<DashboardProjectDefaults>
    ) => Promise<DashboardGlobalConfig>
    onConfigChanged: (callback: (config: DashboardGlobalConfig) => void) => () => void
    getTeamWorkspace: () => Promise<DashboardTeamWorkspace>
    listTeamWorkspaceCandidates: () => Promise<DashboardTeamWorkspaceCandidate[]>
    connectTeamWorkspace: (
      payload: DashboardTeamWorkspaceConnectPayload
    ) => Promise<DashboardTeamWorkspace>
    setTeamWorkspaceChannels: (
      payload: DashboardTeamWorkspaceChannelsPayload
    ) => Promise<DashboardTeamWorkspace>
    clearTeamWorkspace: () => Promise<DashboardTeamWorkspace>
    listWorkspaceMappings: () => Promise<WorkspaceMapping[]>
    getWorkspaceMapping: (workspaceId: string) => Promise<string[] | null>
    saveWorkspaceMapping: (payload: {
      workspaceId: string
      projectIds: string[]
    }) => Promise<void>
    deleteWorkspaceMapping: (workspaceId: string) => Promise<boolean>
    getProjects: () => Promise<{ id: string; name: string; clientName: string; teamId: string; profileId: string }[]>
    checkCardAuth: (payload: { projectId: string; appId?: AppId }) => Promise<boolean>
    syncSource: (payload: DashboardScrapePayload) => Promise<{
      runId: string
      channelsRead: number
      newMessages: number
      status: 'success' | 'partial' | 'error' | 'stopped'
      error?: string
    }>
    cancelScrape: (payload: DashboardCancelScrapePayload) => Promise<{ ok: boolean; cancelled: number }>
    setSourceSchedule: (payload: DashboardSourceSchedulePayload) => Promise<DashboardSourceScheduleState>
    getRunLogs: (payload: ScrapeRunQuery & { projectId: string }) => Promise<ScrapeRunLog[]>
    getScrapeRuns: (payload: ScrapeRunQuery) => Promise<ScrapeRunLog[]>
    getChannelHistory: (
      payload: DashboardChannelHistoryPayload
    ) => Promise<DashboardChannelHistoryResult[]>
    uploadDocument: (payload: {
      projectId: string
      name: string
      mimeType: string
      dataBase64: string
    }) => Promise<{ ok: boolean; document?: import('./dashboard-contract').ProjectDocument; error?: string }>
    listDocuments: (payload: {
      projectId: string
    }) => Promise<import('./dashboard-contract').ProjectDocument[]>
    deleteDocument: (payload: {
      projectId: string
      documentId: string
    }) => Promise<{ ok: boolean; error?: string }>
    startWatchLive: (payload: {
      projectId: string
      bounds: { x: number; y: number; width: number; height: number }
    }) => Promise<{ ok: boolean; error?: string }>
    stopWatchLive: () => Promise<void>
    onScrapeEvent: (
      callback: (event: {
        type:
          | 'navigate'
          | 'scroll'
          | 'highlight'
          | 'status'
          | 'read'
          | 'queued'
          | 'run_started'
          | 'run_finished'
          | 'run_failed'
          | 'run_cancelled'
          | 'paused'
          | 'waiting_for_user'
          | 'challenge'
        runId?: string
        projectId?: string
        sourceId?: string
        workspaceName?: string
        channelName?: string
        scrollIndex?: number
        maxScroll?: number
        messageCount?: number
        queueLength?: number
        bounds?: { x: number; y: number; width: number; height: number }
        text?: string
      }) => void
    ) => () => void
  }
  logs: {
    getRecent: (filter?: LogFilter) => Promise<LogEntry[]>
    setRetention: (minutes: number) => Promise<void>
    clear: () => Promise<void>
    export: () => Promise<{ ok: boolean; count: number; content: string }>
    logAction: (
      category: LogCategory,
      level: LogLevel,
      message: string,
      meta?: unknown
    ) => Promise<void>
    onLogEntry: (callback: (entry: LogEntry) => void) => () => void
  }
  storage: {
    getSummary: () => Promise<StorageSummaryResult>
    clean: (payload: CleanStoragePayload) => Promise<CleanStorageResult>
  }
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'security'
export type LogCategory = 'ui' | 'nav' | 'ipc' | 'sync' | 'auth' | 'sec' | 'system' | 'error'

export interface LogEntry {
  id: string
  level: LogLevel
  category: LogCategory
  message: string
  meta?: unknown
  ts: string
}

export interface LogFilter {
  level?: LogLevel | 'all'
  category?: LogCategory | 'all'
  query?: string
}

export type {
  ActivateAppPayload,
  DashboardAiModelsQueryPayload,
  DashboardAiModelsResult,
  DashboardAiSettingsQueryPayload,
  DashboardAiSettingsSavePayload,
  DashboardAiSettingsView,
  DashboardListChannelsPayload,
  DashboardDiscoverSourceChannelsPayload,
  DashboardDiscoverSourceChannelsResult,
  DashboardUpdateSourcePayload,
  DashboardUpdateSourceResult,
  DashboardProjectDefaults,
  DashboardMarkViewedPayload,
  ActivateProfilePayload,
  AppId,
  ChannelHistoryPayload,
  CreateProfileInput,
  CurrentWorkspaceInfo,
  DashboardChatMessage,
  DashboardChannelHistoryPayload,
  DashboardChannelHistoryResult,
  DashboardChatPage,
  DashboardChatQueryPayload,
  DashboardChatTokenStatus,
  DashboardProjectChatChunkEvent,
  DashboardProjectChatDoneEvent,
  DashboardProjectChatErrorEvent,
  DashboardProjectChatHistoryResult,
  DashboardProjectChatPayload,
  DashboardProjectChatStartResult,
  DashboardProjectChatStatus,
  DashboardProjectActivity,
  DashboardManualToken,
  DashboardSendErrorCode,
  DashboardSendMessagePayload,
  DashboardSendMessageResult,
  DashboardSendAgentMessagePayload,
  DashboardSendAgentMessageResult,
  DashboardSnapshot,
  DashboardSyncProgressPayload,
  DashboardTeamWorkspace,
  DashboardTeamWorkspaceCandidate,
  DashboardViewSetPayload,
  ManualTokenPayload,
  OpenWorkspacePayload,
  PinFromAvailablePayload,
  Profile,
  ProfileIdPayload,
  ProfileSessionStatusPayload,
  ProjectDeletePayload,
  ProjectUpsertPayload,
  SlackChannelSummary,
  SlackMessageSummary,
  SlackWorkspaceLink,
  StartAppLoginPayload,
  StartGoogleAuthPayload,
  SyncNowPayload,
  SyncWorkspacesPayload,
  UnpinWorkspacePayload,
  ValidateTokenResultPayload,
  ViewportBounds,
  WorkspaceMapping,
  WorkspacePayload,
  WorkspaceThemePayload
}

export interface PartitionStorageInfo {
  id: string
  partitionName: string
  label: string
  type: 'global' | 'profile' | 'card' | 'custom_link' | 'orphaned'
  ownerName?: string
  totalSizeBytes: number
  cacheSizeBytes: number
  hasSession: boolean
}

export interface StorageSummaryResult {
  totalDiskUsageBytes: number
  totalCacheUsageBytes: number
  orphanedCount: number
  partitions: PartitionStorageInfo[]
}

export interface CleanStoragePayload {
  mode: 'safe_cache_only' | 'full_reset'
  partitionIds?: string[]
  removeOrphaned?: boolean
}

export interface CleanStorageResult {
  ok: boolean
  freedBytes: number
  cleanedCount: number
  error?: string
}

