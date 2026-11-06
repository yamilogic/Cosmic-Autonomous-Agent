/**
 * Dashboard feature contract — additive, no impact on existing channels.
 * See docs/adr/0007-dashboard-module.md and docs/tickets/dashboard-v2.md.
 */
import type { AppId } from './types'

export type DashboardAppId = 'slack'
export type DashboardTokenSource = 'oauth' | 'manual'
export type DashboardMood = 'good' | 'neutral' | 'tense'
export type DashboardSyncState = 'idle' | 'syncing' | 'error'

/** Where a stored message came from: the card's client workspace, or our own. */
export type DashboardSource = 'client' | 'ours' | `browser:${string}`

export type DashboardTeamWorkspaceSource = 'oauth' | 'manual' | 'none'

/** One workspace the app can already reach, offered when connecting ours. */
export interface DashboardTeamWorkspaceCandidate {
  profileId: string
  profileName: string
  teamId: string
  teamName: string
  teamDomain: string
  scopes: string[]
}

/** Public view of the one team workspace shared by every card. Never a token. */
export interface DashboardTeamWorkspace {
  connected: boolean
  profileId: string | null
  teamId: string | null
  teamName: string | null
  teamDomain: string | null
  source: DashboardTeamWorkspaceSource
  /** Mask such as "••••abcd"; null when nothing is connected. */
  maskedToken: string | null
  /** Last known health of the connected token. */
  status: 'connected' | 'needs-reconnect'
  lastVerifiedAt: string | null
  /**
   * Legacy global pins. Kept for existing cards until per-project Our Slack
   * channel mapping lands; new cards map channels on the project.
   */
  channels: DashboardMonitor[]
  updatedAt: string | null
}

export interface DashboardTeamWorkspaceConnectPayload {
  source: 'oauth' | 'manual'
  profileId?: string
  teamId?: string
  /** Raw token, only for source = 'manual'. Never returned by main. */
  token?: string
}

export interface DashboardTeamWorkspaceChannelsPayload {
  channels: DashboardMonitor[]
}

export interface DashboardMonitor {
  /** Monitored Slack channel (public channel, private group, or mpim). */
  channelId: string
  channelName: string
}

export type ProjectSourceChannelKind = 'public' | 'private' | 'dm' | 'group-dm'

/** Effective at scrape time: card override wins, otherwise the global setting. */
export type ProjectSourceDmPolicy = 'inherit' | 'on' | 'off'

/** Include = read only ticked channels. Exclude = read everything except ticked. */
export type ProjectSourceSelectionMode = 'include' | 'exclude'

export interface ProjectSourceChannel {
  id: string
  name: string
  isPrivate?: boolean
  isDm?: boolean
  /** Explicit kind; kept optional so older stored sources stay valid. */
  kind?: ProjectSourceChannelKind
  enabled?: boolean
  /** Context read for AI agents (defaults to false) */
  agentRead?: boolean
  /** Write permission for AI agents / schedules to post messages (defaults to false) */
  agentWrite?: boolean
  /** Real-time autonomous auto-reply authorization (defaults to false) */
  autoReply?: boolean
  created?: number
  memberCount?: number
  topic?: string
}

export type ProjectSourceStatus =
  'connected' | 'needs-login' | 'challenge' | 'adapter-broken' | 'paused' | 'running'

export interface ProjectSource {
  id: string
  kind: 'token' | 'browser'
  platform: 'slack' | 'teams' | 'whatsapp' | 'upwork' | 'discord' | 'googlechat' | 'custom' | string
  profileId?: string
  workspaceId: string
  workspaceName: string
  /** Optional direct URL for web-only card sources (non-Slack platforms). */
  url?: string
  channels: ProjectSourceChannel[]
  role: 'client' | 'ours'
  enabled: boolean
  backfillDays: 1 | 7 | 30
  /** Configurable historical depth in days (defaults to 30 for 1-month lookback). */
  historyWindowDays?: number
  /** Include selected channels only, or exclude the ticked ones. */
  selectionMode?: ProjectSourceSelectionMode
  /** Set once the user has reviewed the channel picker; legacy sources are unset. */
  channelsReviewedAt?: string
  /** Hard limit for sleep/wake catch-up. Defaults to the global 7 days. */
  catchUpCapDays?: number
  status?: ProjectSourceStatus
  lastReadAt?: string
  lastReadNewCount?: number
  /** Per-source auto-scrape. Absent = legacy behaviour (enabled, 5 min). */
  scheduleEnabled?: boolean
  scheduleIntervalMinutes?: DashboardScheduleInterval
  /** Hours of history a run tries to cover. Default 6. */
  backfillHours?: number
  /** DM scraping override; effective policy = this, else global AppSettings. */
  allowDms?: ProjectSourceDmPolicy
  /** Engine used for ingestion & dispatch: direct_api (~150ms zero-DOM) or browser_dom. Defaults to direct_api. */
  engine?: 'direct_api' | 'browser_dom'
  /** Persisted sender allow-list (display names). Empty = everyone. */
  selectedPeople?: string[]
  /** Ingestion engine mode: 'direct_api' for fast token-based API polling, 'browser' for headless DOM scraping. Default 'direct_api'. */
  engineMode?: 'direct_api' | 'browser'
  lastScrapeAt?: string
  lastScrapeStatus?: ScrapeRunStatus
  lastScrapeError?: string
  lastScrapeRunId?: string
  createdAt: string
  updatedAt: string
}

export type ProjectWorkflowStatus = 'active' | 'stopped' | 'removed' | 'completed'

export type ScrapeTrigger = 'scheduled' | 'manual' | 'startup'
export type ScrapeRunStatus = 'success' | 'partial' | 'error' | 'stopped'
export type ScrapeChannelKind = 'public' | 'private' | 'dm' | 'group-dm'

export interface ScrapeRunWindow {
  /** Slack ts (or ISO for token sources) the window starts at. */
  startTs: string
  /** Slack ts (or ISO) the window ends at. */
  endTs: string
  backfillHours: number
  /** Seconds of history the reader could not reach (scroll/DOM cap). */
  gapSeconds?: number
}

export interface ScrapeRunChannel {
  channelId: string
  channelName: string
  kind: ScrapeChannelKind
  messagesRead: number
  newMessages: number
  status: 'read' | 'empty' | 'skipped' | 'error'
  skippedReason?: string
  error?: string
  engineMode?: 'direct_api' | 'browser'
}

export interface ScrapeRunPerson {
  name: string
  messages: number
}

export interface ScrapeRunFilters {
  includeKinds: ScrapeChannelKind[]
  channelIds?: string[]
  people?: string[]
}

export interface ScrapeRunMessageSnippet {
  channelId: string
  channelName?: string
  sender: string
  ts: string
  snippet: string
}

/** One persisted audit row for a scrape (scheduled or manual). */
export interface ScrapeRunLog {
  runId: string
  ts: string
  startedAt: string
  trigger: ScrapeTrigger
  projectId: string
  projectName: string
  sourceId: string
  sourceKind: 'token' | 'browser'
  /** Ingestion engine used for this scrape run: direct Slack API or browser DOM scraper. */
  engineMode?: 'direct_api' | 'browser'
  workspaceId: string
  workspaceName: string
  channelsRead: number
  messagesRead?: number
  newMessages: number
  snippets?: ScrapeRunMessageSnippet[]
  window: ScrapeRunWindow
  channels: ScrapeRunChannel[]
  people: ScrapeRunPerson[]
  filters: ScrapeRunFilters
  durationMs: number
  llmCalls: number
  status: ScrapeRunStatus
  error?: string
  errorCode?: string
}

export interface ScrapeRunQuery {
  projectId?: string
  limit?: number
  status?: ScrapeRunStatus | 'all'
  trigger?: ScrapeTrigger | 'all'
  engineMode?: 'direct_api' | 'browser' | 'all'
}

/** Per-run overrides. Never persisted unless the user saves them. */
export interface DashboardScrapeOptions {
  channelIds?: string[]
  people?: string[]
  includePublic?: boolean
  includePrivate?: boolean
  includeDms?: boolean
  /** Per-run override of the persisted source scope. */
  selectionMode?: ProjectSourceSelectionMode
  /** When true, forces a full 30-day (1-month) lookback window from now. */
  force30Days?: boolean
  /** When true, ignores existing cursor and re-scrapes entire channel history back to genesis inception (sinceTs = 0). */
  forceGenesis?: boolean
  /** Time lookback window in days (e.g., 30, 90, 230). 0 indicates genesis inception. */
  days?: number
}

export interface DashboardScrapePayload {
  projectId: string
  sourceId?: string
  trigger?: ScrapeTrigger
  options?: DashboardScrapeOptions
}

export interface DashboardCancelScrapePayload {
  projectId?: string
  runId?: string
}

export interface DashboardSourceSchedulePayload {
  projectId: string
  sourceId: string
  scheduleEnabled?: boolean
  scheduleIntervalMinutes?: DashboardScheduleInterval
  backfillHours?: number
  allowDms?: ProjectSourceDmPolicy
  selectedPeople?: string[]
}

export interface DashboardSourceScheduleState {
  projectId: string
  projectName: string
  sourceId: string
  workspaceName: string
  enabled: boolean
  scheduleEnabled: boolean
  intervalMinutes: DashboardScheduleInterval
  lastRunAt: string | null
  lastStatus?: ScrapeRunStatus
  nextRunAt: string | null
  running: boolean
}

export interface DashboardProject {
  id: string
  /** Display name, e.g. "Acme redesign". */
  name: string
  /** Client person/company shown on the card. */
  clientName: string
  profileId: string
  teamId: string
  /** Slack app the project reads from (Phase 1: slack only). */
  appId: DashboardAppId
  tokenSource: DashboardTokenSource
  /** Used when tokenSource = manual (vault key, not raw token). */
  manualTokenKey?: string
  /** Workspace display name (v2.2) — stamped at create, drives card header. */
  teamName?: string
  /** Slack user id of the token owner (= the freelancer, not the client). */
  selfUserId?: string
  monitors: DashboardMonitor[]
  /** Project lifecycle/workflow status (Active, Stopped, Removed/Cancelled, Completed) */
  workflowStatus?: ProjectWorkflowStatus
  /** When true, desktop notifications are silenced for this project card */
  muted?: boolean
  /** When true, this project card is hidden from the sidebar view */
  hiddenInSidebar?: boolean
  /** Additive multi-source model (SLK-1) */
  sources?: ProjectSource[]
  sourcePreference?: 'token_first' | 'browser_only'
  /** Automation mode: per_approval = confirm dialog before scrape, autonomous = direct, scheduled = cron */
  scrapeMode?: 'per_approval' | 'autonomous' | 'scheduled'
  /** Cron or human string when scrapeMode === 'scheduled' */
  scrapeSchedule?: string
  /** Per-card visual automation overlay settings override */
  automationOverride?: {
    showLiveBorder?: boolean
    borderStyle?: 'thin' | 'glow'
    showCursorOverlay?: boolean
    showMessageHighlight?: boolean
  }
  /**
   * Our Slack channels this project reads. Empty means none; per-project
   * mapping replaces the legacy global pin set.
   */
  ourSlackChannels?: DashboardMonitor[]
  /** Vault key for a project-specific Our Slack token (advanced override). */
  ourSlackTokenKey?: string
  ourSlackTeamId?: string
  ourSlackTeamName?: string
  /** User-set dates (ISO yyyy-mm-dd) — win over extractedDates. */
  startDate?: string
  endDate?: string
  /** User-set completion 0–100 — wins over auto estimate. */
  manualCompletion?: number
  /** When true, exposes advanced participant role tagging and manual target management in UI. Default false. */
  advanceDashboardControl?: boolean
  /** Explicit participant role mapping: 'me' | 'client' | 'team' | 'bot' */
  personRoles?: Record<string, PersonRole>
  /** Uploaded client requirements documents and project specifications */
  documents?: ProjectDocument[]
  createdAt: string
}

export interface ProjectDocument {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  uploadedAt: string
  extractedText: string
  summary?: string
}

export type PersonRole = 'me' | 'client' | 'team' | 'bot'

export interface ScrapedChannelMessage {
  ts: string
  user?: string
  text?: string
  subtype?: string
  permalink?: string
  source?: DashboardSource
  threadTs?: string
  replyCount?: number
  role?: PersonRole
}

export interface DashboardChannelHistoryPayload {
  projectId: string
  channelId?: string
}

export interface DashboardChannelHistoryResult {
  channelId: string
  channelName: string
  messages: ScrapedChannelMessage[]
  cursor?: string
  lastSyncAt?: string
}

/** One day of message activity, split by workspace. Deterministic, main-process. */
export interface DashboardActivityDay {
  /** yyyy-mm-dd (UTC) */
  date: string
  client: number
  ours: number
  isToday: boolean
}

/** Median first-reply time over the last `windowDays`, or null under 3 pairs. */
export interface DashboardResponseStats {
  medianSeconds: number | null
  pairs: number
  windowDays: number
}

export type DashboardAttentionKind =
  | 'question'
  | 'needs-reply'
  | 'blocker'
  | 'risk'
  | 'requirement'
  | 'decision'
  | 'commitment'
  | 'file'
  | 'status'

/** One row for "Needs your attention" / "New since your last visit". */
export interface DashboardAttentionItem {
  kind: DashboardAttentionKind
  text: string
  atIso?: string
  source?: DashboardSource
  channelId?: string
  /** Real Slack message ts only — never an ISO date (an ISO can't match `[data-ts]`). */
  ts?: string
  /** True when source + channelId + ts can address a real Slack message row. */
  canJump?: boolean
  permalink?: string
}

export interface DashboardNewSinceCounts {
  requirements: number
  decisions: number
  commitments: number
  files: number
  statusChanges: number
  questions: number
}

/** Everything the Dashboard page shows that is computed from stored messages. */
export interface DashboardMetrics {
  daily: DashboardActivityDay[]
  messages24h: { client: number; ours: number }
  lastClientContactAt: string | null
  ourResponse: DashboardResponseStats
  waiting: {
    /** needs-reply + open questions, deduped. */
    count: number
    /** Oldest real timestamp among the attention items; null when none is timed. */
    oldestIso: string | null
    /** Reported separately; never added to `count`. */
    blockers: number
    risks: number
    items: DashboardAttentionItem[]
  }
  statusSince: string | null
  /** Empty until at least 3 runs have been recorded. */
  moodTrend: Array<{ atIso: string; mood: InsightMood }>
  newSince: {
    lastViewedAt: string | null
    counts: DashboardNewSinceCounts
    items: DashboardAttentionItem[]
  }
}

export interface DashboardMarkViewedPayload {
  projectId: string
  atIso?: string
}

/* ===== v3 — Schedules ===== */

export type DashboardScheduleKind = 'slack-sync' | 'agent-analysis' | 'daily-recheck'

/** The only intervals the selector offers; sub-minute fast intervals (3s, 5s, 10s, 15s, 20s, 30s) down to 0.05m. */
export const DASHBOARD_SCHEDULE_INTERVALS = [0.05, 0.083, 0.167, 0.25, 0.333, 0.5, 1, 5, 10, 15, 30, 60] as const
export type DashboardScheduleInterval = (typeof DASHBOARD_SCHEDULE_INTERVALS)[number]

export interface DashboardScheduleSettings {
  slackSync: { enabled: boolean; intervalMinutes: DashboardScheduleInterval }
  /** Default off; a once-a-day re-ground while Orbit is open. */
  dailyRecheck: { enabled: boolean; hour: number }
}

export interface DashboardScheduleRunSource {
  source: DashboardSource
  ok: boolean
  error?: string | null
}

export interface DashboardScheduleRun {
  id: string
  kind: DashboardScheduleKind
  startedAt: string
  finishedAt: string
  status: 'ok' | 'error' | 'skipped'
  /** One honest line for the history row. */
  detail: string
  projects?: number
  newMessages?: number
  sources?: DashboardScheduleRunSource[]
}

export interface DashboardSchedulesState {
  settings: DashboardScheduleSettings
  lastRunAt: Record<DashboardScheduleKind, string | null>
  /** Next Slack sync; null while paused. */
  nextRunAt: string | null
  /** Next daily re-check; null while off. */
  nextDailyRunAt: string | null
  running: boolean
  runs: DashboardScheduleRun[]
  /** Per-source schedules derived from each card's `sources[]`. */
  sources?: DashboardSourceScheduleState[]
}

export interface DashboardUpdateSchedulePayload {
  slackSync?: { enabled?: boolean; intervalMinutes?: number }
  dailyRecheck?: { enabled?: boolean; hour?: number }
}

export interface DashboardRunSchedulePayload {
  kind: 'slack-sync' | 'daily-recheck'
}

export interface DashboardChannelDelta {
  channelId: string
  channelName: string
  /** Which workspace this channel belongs to (absent on rows stored before v3). */
  source?: DashboardSource
  messageCount: number
  /** New messages added by the latest sync (tiny +N chip on the card). */
  newMessageCount?: number
  /** ISO of newest stored message. */
  latestMessageAt: string
  /** Slack ts cursor of newest stored message. */
  cursor: string
  lastSyncAt: string
}

export interface DashboardProjectSnapshot {
  project: DashboardProject
  /** 1-line summary of latest activity (latest messages distilled locally). */
  summary: string
  newMessageCount: number
  totalMessageCount: number
  /** 0–100 completion: manual if set, else activity estimate. */
  completion: number
  /** Derived pace hint: 'ahead' | 'on-track' | 'stale'. */
  pace: 'ahead' | 'on-track' | 'stale'
  mood: { state: DashboardMood; signal: string }
  /** Dates found in messages (heuristic) — manual project dates win. */
  extractedDates: { startDate?: string; endDate?: string }
  effectiveDates: { startDate?: string; endDate?: string }
  perChannel: DashboardChannelDelta[]
  /** ISO of the last successful sync covering this project. */
  lastUpdatedAt: string | null
  syncState: DashboardSyncState
  /** Set when our team workspace failed while the client workspace synced fine. */
  ourWorkspaceError?: string | null
  /** Deterministic Dashboard-page metrics (absent until the first snapshot build). */
  metrics?: DashboardMetrics
  /** v2.2 NVIDIA NIM rolling insight (undefined/null = not generated yet). */
  insight?: ProjectInsight | null
  insightUpdatedAt?: string | null
  insightModel?: string | null
  /** 'ai' = NVIDIA NIM, 'heuristic' = local fallback. */
  insightSource?: 'ai' | 'heuristic' | null
  newSinceLastInsight?: number
}

export interface DashboardManualToken {
  /** Vault key, e.g. "DASH_TOKEN_ACME". */
  key: string
  /** Workspace info if token already validated. */
  teamName?: string
  teamId?: string
  scopes?: string[]
  validated: boolean
  valid?: boolean
}

export interface DashboardSnapshot {
  projects: DashboardProjectSnapshot[]
  manualTokens: DashboardManualToken[]
  syncIntervalSeconds: number
  /** v2.3 — one line across all workspaces (each item names its workspace). */
  digest?: DashboardDigest | null
  /** Client-projects page: user-owned order for the Pinned section. */
  pinnedOrder?: string[]
}

export interface DashboardPinnedOrderPayload {
  order: string[]
}

/** v2.3 — cross-workspace digest (the ONLY place workspaces are combined). */
export interface DashboardDigest {
  /** ≤20 words — the single most urgent thing across all workspaces. */
  topPriority: string
  /** workspaces whose client is waiting on a reply */
  needsReply: string[]
  /** workspaces that are at risk / blocked */
  atRisk: string[]
  atIso: string
  source: 'ai' | 'local'
  /** sha256 of the digest inputs; lets refresh skip the provider when unchanged. */
  inputHash?: string
}

/** v2.3 — one item per workspace for the "Recent" strip. */
export type RecentActivityKind =
  'client-question' | 'client-message' | 'decision' | 'delivery' | 'blocker' | 'chatter'

export interface RecentActivity {
  projectId: string
  projectName: string
  /** Workspace name — ALWAYS shown so workspaces are never mixed up. */
  teamName: string
  channelName: string
  who: string
  text: string
  /** ISO timestamp of the underlying message */
  ts: string
  kind: RecentActivityKind
  needsReply: boolean
  status: InsightStatus
  /** importance score (higher = more important) */
  score: number
  /** one meaningful sentence (never raw chat noise) */
  oneLine: string
  /** "old → new" when the status changed */
  delta?: string
  /** hours since last message (for inactive filter) */
  hoursSinceLastMessage: number
  /** meaningful messages that arrived after the owner last viewed this card */
  newMessages?: number
}

export type DashboardSyncProgressPayload = {
  projectIds: Array<string>
  syncing: boolean
  current: number
  total: number
  projectId: string | null
  phase: 'idle' | 'syncing' | 'complete' | 'error'
  message?: string
}

export interface DashboardListChannelsPayload {
  tokenSource?: 'oauth' | 'manual'
  profileId?: string
  teamId?: string
  manualTokenKey?: string
  /** 'ours' lists the globally connected team workspace instead of a card's. */
  source?: DashboardSource
}

/** Discover channels with the card's existing browser session (no token). */
export interface DashboardDiscoverSourceChannelsPayload {
  /** Optional while the wizard is still creating the card. */
  projectId?: string
  /** Optional for a new source; omit to discover before the source exists. */
  sourceId?: string
  /** Optional fallbacks when the source row is being created. */
  profileId?: string
  workspaceId?: string
}

export interface DashboardDiscoverSourceChannelsResult {
  channels: ProjectSourceChannel[]
  error?: string
}

/** Atomic source patch — never replaces the whole project. */
export interface DashboardUpdateSourcePayload {
  projectId: string
  sourceId: string
  patch: Partial<Omit<ProjectSource, 'id' | 'createdAt' | 'updatedAt'>>
}

export interface DashboardUpdateSourceResult {
  source: ProjectSource
  snapshot: DashboardSnapshot
}

export interface SyncNowPayload {
  projectId?: string
}

export interface ProjectUpsertPayload {
  project:
    | Omit<DashboardProject, 'id' | 'createdAt'>
    | (Omit<DashboardProject, 'createdAt'> & { id: string })
}

export interface ProjectDeletePayload {
  projectId: string
}

export interface ManualTokenPayload {
  key: string
  token: string
}

export interface DashboardViewSetPayload {
  /** When true renderer shows dashboard view (native embed hidden). */
  open: boolean
  appId?: AppId | null
}

export interface ValidateTokenResultPayload extends DashboardManualToken {
  valid: boolean
  error?: string
  /** Slack user (display login) from auth.test — used to prefill client name. */
  userName?: string
  /** Slack user id of the token owner — used to tell "me" from "the client". */
  userId?: string
}

/** Public app identity so the wizard can render the exact manifest JSON for the user. */
export interface DashboardAppClientConfig {
  clientId: string
  redirectUri: string
}

/* ===== v2.2 — NVIDIA NIM insight engine ===== */
export type InsightStatus = 'on-track' | 'at-risk' | 'blocked' | 'waiting-on-client'
export type InsightMood = 'good' | 'neutral' | 'tense'
export type InsightUrgency = 'low' | 'normal' | 'high'

export interface InsightClientMessage {
  who: string
  whenIso: string | null
  quote: string
  source?: DashboardSource
  channelId?: string
  ts?: string
  permalink?: string
}

/** One thing that happened (evidence-linked). */
export interface InsightHighlight {
  what: string
  who?: string
  whenIso?: string
}

/** Something that is stuck, and who owns it. */
export interface InsightBlocker {
  what: string
  owner?: string
  sinceIso?: string
}

/** A promise made in chat (owner + what). */
export interface InsightCommitment {
  who?: string
  what: string
  dueIso?: string
}

/** An agreed decision in chat. */
export interface InsightDecision {
  what: string
  who?: string
  whenIso?: string
}

export interface ProjectInsight {
  status: InsightStatus
  /** Why that status (≤15 words, evidence based). */
  statusReason: string
  /** "old → new" when the status changed with this refresh (else empty). */
  statusChange: string
  mood: InsightMood
  /** Why that mood (≤12 words). */
  moodReason: string
  /** Verbatim client quote behind the mood (empty when none). */
  moodQuote: string
  /** 0-100 */
  progress: number
  progressEvidence: string
  situationLine: string
  /** ≤12 words — the single most important thing that just changed. */
  recentLine: string
  highlights: InsightHighlight[]
  blockers: InsightBlocker[]
  nextStep: string
  dates: { startDate?: string; endDate?: string; evidence?: string }
  clientAsk: {
    needsReply: boolean
    urgency: InsightUrgency
    lastClientMessage: InsightClientMessage | null
    openQuestions: string[]
  }
  commitments: InsightCommitment[]
  decisions: InsightDecision[]
  risks: string[]
  keywords: string[]

  /* ===== v2.4 — Project Guide & Attention sidebar fields ===== */
  /** Client requirements explicitly stated (source: PDF/DOCX/chat) */
  requirements: InsightRequirement[]
  /** Scope: in-scope and out-of-scope items */
  scope: { in: string[]; out: string[] }
  /** Deliverables with status */
  deliverables: InsightDeliverable[]
  /** Files shared in the workspace */
  files: InsightFile[]
  /** People involved */
  people: InsightPerson[]
  /** Milestones with dates and completion */
  milestones: InsightMilestone[]
}

export interface InsightRequirement {
  text: string
  /** Source file name if from attachment (PDF/DOCX) */
  sourceFile?: string
  /** Who said it */
  who?: string
  /** When (ISO timestamp) */
  whenIso?: string
}

export interface InsightDeliverable {
  name: string
  /** 'done' | 'in-progress' | 'pending' | 'not-started' */
  status: 'done' | 'in-progress' | 'pending' | 'not-started'
}

export interface InsightFile {
  name: string
  /** 'pdf' | 'docx' | 'link' | 'image' | 'other' */
  type: 'pdf' | 'docx' | 'link' | 'image' | 'other'
  who?: string
  whenIso?: string
  url?: string
}

export interface InsightPerson {
  name: string
  role?: string
  /** 'client' | 'us' */
  side: 'client' | 'us'
}

export interface InsightMilestone {
  label: string
  dateIso: string | null
  done: boolean
}

export interface SidebarState {
  collapsed: boolean
  width: number
  openSection: number | null
}

export interface ProjectSidebarState {
  left: SidebarState
  right: SidebarState
}

export interface DashboardSidebarGetPayload {
  projectId: string
}

export interface DashboardSidebarSetPayload {
  projectId: string
  state: ProjectSidebarState
}

export interface DashboardSidebarUpdatePayload {
  projectId: string
  sidebar: 'left' | 'right'
  patch: Partial<SidebarState>
}

export interface InsightHistoryEntryContract {
  atIso: string
  newMessageCount: number
  insight: ProjectInsight
  /** Slack ts cursor position this insight covered (delta tracking). */
  cursorAtSummarize?: string
  /** 'ai' = NVIDIA NIM, 'heuristic' = local fallback (no key / API failure). */
  source?: 'ai' | 'heuristic'
  /** model that produced this insight (shown on the card) */
  model?: string
  /** Status before this refresh — lets the timeline show "at-risk → on-track". */
  previousStatus?: InsightStatus

  /* v2.4 — sidebar state snapshot at this insight */
  sidebarState?: { left: SidebarState; right: SidebarState }
}

/* ===== v2.6 — Slack Chat tab (local history + replies) ===== */

/** One message in the Slack Chat tab (local delta store, names resolved best-effort). */
export interface DashboardChatMessage {
  /** Slack ts — unique within a channel. Optimistic messages use `temp-…`. */
  ts: string
  channelId: string
  channelName: string
  /** Slack user id (empty when the message has no author, e.g. some bot posts). */
  userId: string
  /** Display name when resolvable; falls back to the user id (ADR-0007). */
  userName: string
  /** Workspace this message came from. */
  source: DashboardSource
  text: string
  /** ISO timestamp derived from ts. */
  atIso: string
  /** true when the token owner wrote the message. */
  isMine: boolean
  /** optimistic message, not confirmed by Slack yet. */
  pending?: boolean
  /** optimistic message whose send failed. */
  failed?: boolean
}

export interface DashboardChatPage {
  messages: DashboardChatMessage[]
  /** Pass as `beforeTs` to load the next (older) page; null when exhausted. */
  nextBeforeTs: string | null
  hasMore: boolean
}

export interface DashboardChatQueryPayload {
  projectId: string
  /** Which workspace to read; undefined = the card's client workspace. */
  source?: DashboardSource
  /** undefined = every watched channel in that workspace. */
  channelId?: string
  /** Return messages strictly older than this Slack ts. */
  beforeTs?: string
  /** Page size (default 50, max 200). */
  limit?: number
}

export interface DashboardSendMessagePayload {
  projectId: string
  /** Which workspace to post into; undefined = the card's client workspace. */
  source?: DashboardSource
  channelId: string
  text: string
  isAgent?: boolean
}

export type DashboardSendErrorCode =
  | 'missing_scope'
  | 'not_connected'
  | 'channel_not_found'
  | 'invalid_text'
  | 'permission_denied'
  | 'slack_error'
  | 'browser_error'
  | 'unknown'

export interface DashboardSendAgentMessagePayload {
  projectId: string
  channelId: string
  text: string
  source?: DashboardSource
}

export interface DashboardSendAgentMessageResult {
  ok: boolean
  ts?: string
  error?: string
  code?: DashboardSendErrorCode
}

export interface DashboardSendMessageResult {
  ok: boolean
  message?: DashboardChatMessage
  error?: string
  code?: DashboardSendErrorCode
  /** Scope Slack requires when code = 'missing_scope'. */
  missingScope?: string
}

/** Slack token health for the Settings section — scopes + send capability. */
export interface DashboardChatTokenStatus {
  connected: boolean
  source: 'oauth' | 'manual' | 'none'
  teamName: string | null
  /** Masked token ("••••abcd") so the user can identify it; never the raw token. */
  maskedToken: string | null
  /** Granted scopes, or null when Slack's auth.test didn't report them. */
  scopes: string[] | null
  /** True when chat:write is present; false when known-missing; null when unknown. */
  canSend: boolean | null
  missingWriteScope: boolean
}

/* ===== Chat with project (read-only agent chat) ===== */

/** A message the answer is allowed to cite. Built by the host from the
 * retrieved context, never trusted from the model. */
export interface DashboardProjectChatSourceRef {
  source: DashboardSource
  channelId: string
  channelName: string
  ts: string
  permalink?: string
}

export interface DashboardProjectChatMessage {
  role: 'user' | 'assistant'
  content: string
  atIso: string
  /** Only assistant messages that finished normally carry sources. */
  sources?: DashboardProjectChatSourceRef[]
  /** Assistant answer was cut short by Stop. Partial text, no sources. */
  stopped?: boolean
}

export interface DashboardProjectChatPayload {
  projectId: string
  message: string
  /** Reserved for multiple threads; the current build stores one thread. */
  conversationId?: string
  /** Re-run after an error without appending the user turn twice. */
  retry?: boolean
}

export type DashboardProjectChatErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'AI_KEY_MISSING'
  | 'RUN_ACTIVE'
  | 'AUTH_INVALID'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'CANCELLED'
  | 'INTERNAL'

export type DashboardProjectChatStartResult =
  { ok: true; runId: string } | { ok: false; code: DashboardProjectChatErrorCode; error: string }

export interface DashboardProjectChatChunkEvent {
  projectId: string
  runId: string
  chunk: string
}

export interface DashboardProjectChatDoneEvent {
  projectId: string
  runId: string
  content: string
  sources: DashboardProjectChatSourceRef[]
  stopped: boolean
}

export interface DashboardProjectChatErrorEvent {
  projectId: string
  runId: string
  code: DashboardProjectChatErrorCode
  error: string
  retryable: boolean
}

export interface DashboardProjectChatHistoryResult {
  messages: DashboardProjectChatMessage[]
}

/** Renderer-safe chat status: no key and no key mask. */
export interface DashboardProjectChatStatus {
  hasKey: boolean
  model: string
  modelSource: AiSettingsSource
  keySource: AiSettingsSource
}

/* ===== v2.7 — AI provider settings (global + per project) ===== */

export type AiProviderId = 'nvidia-nim'

/** Never contains the raw key — only a mask such as "••••abcd". */
export interface AiSettingsPublic {
  provider: AiProviderId
  /** Configured chat model, null when this scope does not override one. */
  model: string | null
  /** Configured embedding model, null when this scope does not override one. */
  embeddingModel: string | null
  /** Masked stored key ("••••abcd"); null when none is stored here. */
  apiKeyMask: string | null
  hasKey: boolean
  status: DashboardConfigStatus
  lastVerifiedAt: string | null
}

export interface ProjectAiSettingsPublic extends AiSettingsPublic {
  /** Legacy coarse switch. Field-level overrides are reflected in `sources`. */
  useGlobal: boolean
}

export type AiSettingsSource = 'project' | 'global' | 'default' | 'none'

/** What the insight engine / project chat will actually use. */
export interface EffectiveAiSettings {
  provider: AiProviderId
  /** Chat model. `model` is kept as a compatibility alias. */
  model: string
  chatModel: string
  embeddingModel: string
  modelSource: AiSettingsSource
  chatModelSource: AiSettingsSource
  embeddingModelSource: AiSettingsSource
  keySource: AiSettingsSource
  /** Masked key for the effective key, never the key itself. */
  apiKeyMask: string | null
}

export interface DashboardAiSettingsView {
  global: AiSettingsPublic
  /** null when the view was requested without a project. */
  project: ProjectAiSettingsPublic | null
  effective: EffectiveAiSettings
}

export interface DashboardAiSettingsQueryPayload {
  projectId?: string
}

export interface DashboardAiSettingsSavePayload {
  /** Omitted = dashboard-level global settings. */
  projectId?: string
  useGlobal?: boolean
  provider?: AiProviderId
  /** null clears the override; undefined keeps the stored value. */
  model?: string | null
  /** null clears the override; undefined keeps the stored value. */
  embeddingModel?: string | null
  /** null clears the key; undefined keeps it; a string replaces it. */
  apiKey?: string | null
}

export interface DashboardAiModelsQueryPayload {
  projectId?: string
}

export interface DashboardAiModelsResult {
  models: string[]
  /** Embedding model ids, when the provider exposes them separately. */
  embeddingModels: string[]
  source: AiSettingsSource
  error?: string
}

/* ===== Global config (one per app) ===== */

export type DashboardConfigStatus = 'ok' | 'invalid' | 'not-configured'

export interface DashboardGlobalNvidiaConfig {
  configured: boolean
  apiKeyMask: string | null
  chatModel: string | null
  embeddingModel: string | null
  status: DashboardConfigStatus
  lastVerifiedAt: string | null
}

export interface DashboardConfigUsage {
  projects: number
  usingGlobalAi: number
  usingGlobalOurSlack: number
}

/** Defaults applied to a new project card until it explicitly overrides them. */
export interface DashboardProjectDefaults {
  /** DMs stay off unless the user turns them on for a card or globally. */
  allowDms: 'on' | 'off'
  scheduleEnabled: boolean
  intervalMinutes: DashboardScheduleInterval
  backfillHours: number
  /** Sleep/wake catch-up never reaches further back than this. */
  catchUpCapDays: number
}

export interface DashboardGlobalConfig {
  ourSlack: DashboardTeamWorkspace
  nvidia: DashboardGlobalNvidiaConfig
  usage: DashboardConfigUsage
  defaults: DashboardProjectDefaults
}

export interface DashboardAiTestResult {
  ok: boolean
  error?: string
  models?: number
}

/* ===== Project activity (Dashboard centre, last 14 days) ===== */

/** One stored Slack message, ready to render. Names are resolved or the id. */
export interface DashboardActivityMessage {
  source: DashboardSource
  channelId: string
  channelName: string
  ts: string
  atIso: string
  userId: string
  userName: string
  isMine: boolean
  text: string
  permalink: string | null
}

export interface DashboardActivityParticipant {
  userId: string
  name: string
  source: DashboardSource
  count: number
}

export interface DashboardActivityChannel {
  channelId: string
  channelName: string
  source: DashboardSource
  count: number
}

export interface DashboardProjectActivity {
  /** Newest displayable messages across both workspaces. */
  recent: DashboardActivityMessage[]
  /** Latest client message and our latest reply, client workspace only. */
  latestClientAt: string | null
  latestOursAt: string | null
  /** null when the client has never written. */
  ballInCourt: 'you' | 'client' | null
  participants: DashboardActivityParticipant[]
  channels: DashboardActivityChannel[]
  counts14d: { client: number; ours: number }
}
