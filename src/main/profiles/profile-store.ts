import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import type {
  AppId,
  AppSession,
  AppSessionStatus,
  AvailableWorkspace,
  CustomLink,
  PinnedWorkspace,
  Profile,
  ProfileApps,
  SlackSessionStatus,
  TeamsSessionStatus,
  WhatsAppSessionStatus
} from '../../shared/types'
import {
  APP_IDS,
  GLOBAL_PROFILE_ID,
  emptyProfileApps,
  emptySlackSession,
  emptyTeamsSession,
  emptyWhatsAppSession
} from '../../shared/types'
import {
  isSlackPlaceholderName,
  parseSlackClientPath,
  resolvePinnedOpenUrl
} from '../../shared/slack-url'
import {
  canonicalizeTeamsWorkspaceId,
  isGenericTeamsName,
  isTeamsPersonalTenantId
} from './discover-workspaces'
import { TEAMS_HOME_URL, WHATSAPP_WEB_URL } from './session-partition'

const AVATAR_COLORS = ['#2BAC76', '#1264A3', '#E01E5A', '#ECB22E', '#611F69', '#1D9BD1']

/** Higher = prefer when resolving duplicate emails. */
function profileAuthScore(p: Profile): number {
  let s = 0
  if (p.googleAuthStatus === 'signed-in') s += 10
  for (const id of APP_IDS) {
    if (p.apps[id].sessionStatus === 'signed-in') s += 20
  }
  return s
}

export interface ProfileStoreOptions {
  filePath: string
}

const SLACK_TRANSITIONS: Record<SlackSessionStatus, readonly SlackSessionStatus[]> = {
  // Classic first-login jumps straight to signing-in-slack; two-step flow still uses google first.
  'not-signed-in': ['signing-in-google', 'signing-in-slack'],
  'signing-in-google': ['signing-in-slack', 'not-signed-in'],
  'signing-in-slack': ['signed-in', 'not-signed-in'],
  'signed-in': ['signing-in-google', 'signing-in-slack', 'not-signed-in']
}

const TEAMS_TRANSITIONS: Record<TeamsSessionStatus, readonly TeamsSessionStatus[]> = {
  'not-signed-in': ['signing-in'],
  'signing-in': ['signed-in', 'not-signed-in'],
  'signed-in': ['signing-in', 'not-signed-in']
}

const WHATSAPP_TRANSITIONS: Record<WhatsAppSessionStatus, readonly WhatsAppSessionStatus[]> = {
  'not-signed-in': ['signing-in'],
  'signing-in': ['signed-in', 'not-signed-in'],
  'signed-in': ['signing-in', 'not-signed-in']
}

function normalizeSlackStatus(raw: unknown): SlackSessionStatus {
  if (raw === 'signing-in') {
    return 'signing-in-google'
  }
  if (
    raw === 'not-signed-in' ||
    raw === 'signing-in-google' ||
    raw === 'signing-in-slack' ||
    raw === 'signed-in'
  ) {
    return raw
  }
  return 'not-signed-in'
}

function normalizeTeamsStatus(raw: unknown): TeamsSessionStatus {
  if (raw === 'signing-in-google' || raw === 'signing-in-slack') {
    return 'signing-in'
  }
  if (raw === 'not-signed-in' || raw === 'signing-in' || raw === 'signed-in') {
    return raw
  }
  return 'not-signed-in'
}

function normalizeWhatsAppStatus(raw: unknown): WhatsAppSessionStatus {
  if (raw === 'signing-in-google' || raw === 'signing-in-slack') {
    return 'signing-in'
  }
  if (raw === 'not-signed-in' || raw === 'signing-in' || raw === 'signed-in') {
    return raw
  }
  return 'not-signed-in'
}

function emptySessionFor(appId: AppId): AppSession {
  if (appId === 'slack') {
    return emptySlackSession()
  }
  if (appId === 'teams') {
    return emptyTeamsSession()
  }
  return emptyWhatsAppSession()
}

function defaultOpenUrlForApp(appId: AppId): string {
  if (appId === 'slack') {
    return 'https://app.slack.com/client'
  }
  if (appId === 'teams') {
    return TEAMS_HOME_URL
  }
  return WHATSAPP_WEB_URL
}

function preferSlackOpenUrl(nextUrl: string, prevUrl?: string): string {
  const nextDepth = parseSlackClientPath(nextUrl)?.conversationId ? 2 : 1
  const prevDepth = prevUrl && parseSlackClientPath(prevUrl)?.conversationId ? 2 : 1
  if (nextDepth >= prevDepth) return nextUrl
  return prevUrl || nextUrl
}

function workspaceFromRaw(
  teamId: string,
  teamName: string,
  openUrl?: string,
  teamDomain?: string,
  lastSeenAt?: string,
  appId: AppId = 'slack',
  lastChannelName?: string
): AvailableWorkspace {
  let id = teamId.trim()
  if (appId === 'teams') {
    id = canonicalizeTeamsWorkspaceId(id)
  }
  const domain = teamDomain?.trim() || undefined
  const resolved =
    openUrl?.trim() ||
    (appId === 'slack'
      ? resolvePinnedOpenUrl({ teamId: id, openUrl, teamDomain: domain })
      : defaultOpenUrlForApp(appId))
  let name = appId === 'teams' && id === 'teams-home' ? 'Personal' : teamName.trim() || id
  if (appId === 'slack' && isSlackPlaceholderName(name) && domain) {
    name = domain
  }
  return {
    teamId: id,
    teamName: name,
    openUrl: appId === 'teams' && id === 'teams-home' ? TEAMS_HOME_URL : resolved,
    lastSeenAt: lastSeenAt ?? new Date().toISOString(),
    ...(domain ? { teamDomain: domain } : {}),
    ...(lastChannelName?.trim() ? { lastChannelName: lastChannelName.trim() } : {})
  }
}

/** Collapse consumer tenants + teams-home duplicates into one Personal row. */
function collapseTeamsWorkspaces(list: AvailableWorkspace[]): AvailableWorkspace[] {
  const byId = new Map<string, AvailableWorkspace>()
  for (const ws of list) {
    if (/^teams-/i.test(ws.teamId) && ws.teamId !== 'teams-home') {
      continue
    }
    const id = canonicalizeTeamsWorkspaceId(ws.teamId)
    const next: AvailableWorkspace = {
      ...ws,
      teamId: id,
      teamName: id === 'teams-home' ? 'Personal' : ws.teamName,
      openUrl: id === 'teams-home' ? 'https://teams.microsoft.com/v2/' : ws.openUrl
    }
    const prev = byId.get(id)
    if (!prev) {
      byId.set(id, next)
      continue
    }
    const preferNext =
      id !== 'teams-home' && !isGenericTeamsName(next.teamName) && isGenericTeamsName(prev.teamName)
    byId.set(id, preferNext ? next : { ...prev, ...next, teamName: prev.teamName || next.teamName })
  }
  const out = [...byId.values()]

  const isHomeLikeUrl = (openUrl: string): boolean => {
    try {
      const u = new URL(openUrl)
      if (!/teams\.(microsoft|live)\.com/i.test(u.hostname)) {
        return false
      }
      const tenant = u.searchParams.get('tenantId') || u.searchParams.get('tenant')
      if (!tenant) {
        return true
      }
      return isTeamsPersonalTenantId(`tenant-${tenant}`)
    } catch {
      return true
    }
  }

  const distinctOrgs = out.filter(
    (w) =>
      w.teamId !== 'teams-home' && !isTeamsPersonalTenantId(w.teamId) && !isHomeLikeUrl(w.openUrl)
  )
  if (distinctOrgs.length === 0) {
    return [
      {
        teamId: 'teams-home',
        teamName: 'Personal',
        openUrl: 'https://teams.microsoft.com/v2/',
        lastSeenAt: out[0]?.lastSeenAt ?? new Date().toISOString()
      }
    ]
  }
  return distinctOrgs
}

function normalizeAvailableList(raw: unknown, appId: AppId = 'slack'): AvailableWorkspace[] {
  const seen = new Set<string>()
  const out: AvailableWorkspace[] = []
  if (!Array.isArray(raw)) {
    return out
  }
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const rec = item as {
      teamId?: unknown
      teamName?: unknown
      openUrl?: unknown
      teamDomain?: unknown
      lastSeenAt?: unknown
      lastChannelName?: unknown
    }
    if (typeof rec.teamId !== 'string' || !rec.teamId.trim()) {
      continue
    }
    const ws = workspaceFromRaw(
      rec.teamId.trim(),
      typeof rec.teamName === 'string' ? rec.teamName : rec.teamId.trim(),
      typeof rec.openUrl === 'string' ? rec.openUrl : undefined,
      typeof rec.teamDomain === 'string' ? rec.teamDomain : undefined,
      typeof rec.lastSeenAt === 'string' ? rec.lastSeenAt : undefined,
      appId,
      typeof rec.lastChannelName === 'string' ? rec.lastChannelName : undefined
    )
    if (seen.has(ws.teamId)) {
      continue
    }
    seen.add(ws.teamId)
    out.push(ws)
  }
  return appId === 'teams' ? collapseTeamsWorkspaces(out) : out
}

function normalizePinnedWorkspaces(
  raw: unknown,
  legacyTeamIds?: unknown,
  appId: AppId = 'slack'
): PinnedWorkspace[] {
  const seen = new Set<string>()
  const out: PinnedWorkspace[] = []

  const push = (teamId: string, teamName: string, openUrl?: string, teamDomain?: string): void => {
    const id = teamId.trim()
    const name = teamName.trim() || id
    if (!id || seen.has(id)) {
      return
    }
    seen.add(id)
    const domain = teamDomain?.trim() || undefined
    const ws = workspaceFromRaw(id, name, openUrl, domain, undefined, appId)
    out.push({
      teamId: ws.teamId,
      teamName: ws.teamName,
      openUrl: ws.openUrl,
      ...(ws.teamDomain ? { teamDomain: ws.teamDomain } : {})
    })
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        push(item, item)
        continue
      }
      if (item && typeof item === 'object') {
        const rec = item as {
          teamId?: unknown
          teamName?: unknown
          openUrl?: unknown
          teamDomain?: unknown
        }
        if (typeof rec.teamId === 'string') {
          push(
            rec.teamId,
            typeof rec.teamName === 'string' ? rec.teamName : rec.teamId,
            typeof rec.openUrl === 'string' ? rec.openUrl : undefined,
            typeof rec.teamDomain === 'string' ? rec.teamDomain : undefined
          )
        }
      }
    }
  }

  if (Array.isArray(legacyTeamIds)) {
    for (const item of legacyTeamIds) {
      if (typeof item === 'string') {
        push(item, item)
      }
    }
  }

  return out
}

function toPinned(ws: AvailableWorkspace): PinnedWorkspace {
  return {
    teamId: ws.teamId,
    teamName: ws.teamName,
    openUrl: ws.openUrl,
    ...(ws.teamDomain ? { teamDomain: ws.teamDomain } : {})
  }
}

function reconcilePins(
  available: AvailableWorkspace[],
  pinned: PinnedWorkspace[]
): PinnedWorkspace[] {
  const byId = new Map(available.map((w) => [w.teamId, w]))
  const out: PinnedWorkspace[] = []
  const seen = new Set<string>()
  for (const pin of pinned) {
    const avail = byId.get(pin.teamId)
    if (!avail || seen.has(pin.teamId)) {
      continue
    }
    seen.add(pin.teamId)
    out.push(toPinned(avail))
  }
  return out
}

function normalizeAppSession(raw: unknown, appId: AppId): AppSession {
  if (!raw || typeof raw !== 'object') {
    return emptySessionFor(appId)
  }
  const rec = raw as {
    sessionStatus?: unknown
    availableWorkspaces?: unknown
    pinnedWorkspaces?: unknown
  }
  let availableWorkspaces = normalizeAvailableList(rec.availableWorkspaces, appId)
  let pinnedWorkspaces = normalizePinnedWorkspaces(rec.pinnedWorkspaces, undefined, appId)
  if (availableWorkspaces.length === 0 && pinnedWorkspaces.length > 0) {
    const now = new Date().toISOString()
    availableWorkspaces = pinnedWorkspaces.map((p) =>
      workspaceFromRaw(p.teamId, p.teamName, p.openUrl, p.teamDomain, now, appId)
    )
  }
  pinnedWorkspaces = reconcilePins(availableWorkspaces, pinnedWorkspaces)
  let sessionStatus: AppSessionStatus
  if (appId === 'slack') {
    sessionStatus = normalizeSlackStatus(rec.sessionStatus)
  } else if (appId === 'teams') {
    sessionStatus = normalizeTeamsStatus(rec.sessionStatus)
  } else {
    sessionStatus = normalizeWhatsAppStatus(rec.sessionStatus)
  }
  return {
    sessionStatus,
    availableWorkspaces,
    pinnedWorkspaces
  }
}

type RawProfile = {
  id: string
  displayName: string
  customName?: unknown
  createdAt?: string
  avatarColor?: string
  avatarUrl?: unknown
  sortOrder?: unknown
  muted?: unknown
  hiddenInSidebar?: unknown
  accountScope?: unknown
  isGlobalProfile?: unknown
  googleAuthStatus?: unknown
  apps?: unknown
  customLinks?: unknown
  /** Legacy Slack-only fields */
  sessionStatus?: unknown
  availableWorkspaces?: unknown
  pinnedWorkspaces?: unknown
  pinnedTeamIds?: unknown
}

function normalizeProfile(raw: RawProfile): Profile {
  let apps: ProfileApps

  if (raw.apps && typeof raw.apps === 'object') {
    const appsRaw = raw.apps as { slack?: unknown; teams?: unknown; whatsapp?: unknown }
    apps = {
      slack: normalizeAppSession(appsRaw.slack, 'slack'),
      teams: normalizeAppSession(appsRaw.teams, 'teams'),
      whatsapp: normalizeAppSession(appsRaw.whatsapp, 'whatsapp')
    }
  } else {
    // Migrate legacy top-level Slack fields → apps.slack
    let availableWorkspaces = normalizeAvailableList(raw.availableWorkspaces, 'slack')
    let pinnedWorkspaces = normalizePinnedWorkspaces(
      raw.pinnedWorkspaces,
      raw.pinnedTeamIds,
      'slack'
    )
    if (availableWorkspaces.length === 0 && pinnedWorkspaces.length > 0) {
      const now = new Date().toISOString()
      availableWorkspaces = pinnedWorkspaces.map((p) =>
        workspaceFromRaw(p.teamId, p.teamName, p.openUrl, p.teamDomain, now, 'slack')
      )
    }
    pinnedWorkspaces = reconcilePins(availableWorkspaces, pinnedWorkspaces)
    apps = {
      slack: {
        sessionStatus: normalizeSlackStatus(raw.sessionStatus),
        availableWorkspaces,
        pinnedWorkspaces
      },
      teams: emptyTeamsSession(),
      whatsapp: emptyWhatsAppSession()
    }
  }

  const avatarUrl =
    typeof raw.avatarUrl === 'string' && raw.avatarUrl.trim() ? raw.avatarUrl.trim() : undefined
  const customName =
    typeof raw.customName === 'string' && raw.customName.trim() ? raw.customName.trim() : undefined
  const sortOrder =
    typeof raw.sortOrder === 'number' && Number.isFinite(raw.sortOrder)
      ? Math.round(raw.sortOrder)
      : undefined

  return {
    id: raw.id,
    displayName: raw.displayName,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    avatarColor: raw.avatarColor ?? AVATAR_COLORS[0],
    googleAuthStatus:
      raw.googleAuthStatus === 'signed-in' ||
      raw.googleAuthStatus === 'signing-in' ||
      raw.googleAuthStatus === 'not-signed-in'
        ? raw.googleAuthStatus
        : 'not-signed-in',
    muted: raw.muted === true,
    hiddenInSidebar: raw.hiddenInSidebar === true,
    ...(raw.accountScope === 'global' || raw.accountScope === 'individual' || raw.accountScope === 'both' || raw.accountScope === 'observer'
      ? { accountScope: raw.accountScope }
      : raw.hiddenInSidebar !== true
        ? { accountScope: 'global' as const }
        : {}),
    ...(raw.isGlobalProfile === true || (raw.hiddenInSidebar !== true && raw.accountScope !== 'individual')
      ? { isGlobalProfile: true }
      : {}),
    ...(typeof sortOrder === 'number' ? { sortOrder } : {}),
    ...(customName ? { customName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    apps,
    customLinks: normalizeCustomLinks(raw.customLinks)
  }
}

function normalizeCustomLinks(raw: unknown): CustomLink[] {
  if (!Array.isArray(raw)) return []
  const out: CustomLink[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    if (typeof rec.id !== 'string' || !rec.id.trim()) continue
    if (typeof rec.name !== 'string' || !rec.name.trim()) continue
    if (typeof rec.url !== 'string' || !rec.url.trim()) continue
    out.push({
      id: rec.id.trim(),
      name: rec.name.trim(),
      url: rec.url.trim(),
      order: typeof rec.order === 'number' && Number.isFinite(rec.order) ? rec.order : out.length,
      createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : new Date().toISOString(),
      partition:
        typeof rec.partition === 'string' && rec.partition.trim()
          ? rec.partition.trim()
          : `persist:profile-link-${rec.id.trim()}`,
      hiddenInSidebar: rec.hiddenInSidebar === true
    })
  }
  return out.sort((a, b) => a.order - b.order)
}

export function validateCustomLinkInput(
  name: string,
  url: string,
  existingLinks: CustomLink[] = []
): { valid: true; name: string; url: string } | { valid: false; message: string } {
  const trimmedName = (name ?? '').trim()
  if (!trimmedName || trimmedName.length < 1 || trimmedName.length > 40) {
    return { valid: false, message: 'Name must be between 1 and 40 characters.' }
  }

  const trimmedUrl = (url ?? '').trim()
  if (!trimmedUrl) {
    return { valid: false, message: 'URL is required.' }
  }

  if (
    trimmedUrl.toLowerCase().startsWith('javascript:') ||
    trimmedUrl.toLowerCase().startsWith('file:') ||
    trimmedUrl.toLowerCase().startsWith('data:')
  ) {
    return { valid: false, message: 'Insecure URL scheme rejected.' }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmedUrl)
  } catch {
    return { valid: false, message: 'Invalid URL format.' }
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, message: 'https only URL is required.' }
  }

  if (!parsed.hostname || !parsed.hostname.trim()) {
    return { valid: false, message: 'URL host cannot be empty.' }
  }

  if (existingLinks.length >= 30) {
    return {
      valid: false,
      message: 'Maximum limit of 30 custom links per profile reached.'
    }
  }

  const normalizedTarget = parsed.href.toLowerCase().replace(/\/$/, '')
  const duplicate = existingLinks.some(
    (l) => l.url.trim().toLowerCase().replace(/\/$/, '') === normalizedTarget
  )
  if (duplicate) {
    return { valid: false, message: 'This URL has already been added to this profile.' }
  }

  return { valid: true, name: trimmedName, url: parsed.href }
}

function updateApp(profile: Profile, appId: AppId, session: AppSession): Profile {
  return {
    ...profile,
    apps: {
      ...profile.apps,
      [appId]: session
    }
  }
}

export class ProfileStore {
  private readonly filePath: string
  /** Serialize disk writes — concurrent writeFile races corrupt profiles.json. */
  private writeChain: Promise<void> = Promise.resolve()
  /** In-memory snapshot — avoids re-reading profiles.json on every list/get. */
  private cache: Profile[] | null = null

  constructor(options: ProfileStoreOptions) {
    this.filePath = options.filePath
  }

  async list(): Promise<Profile[]> {
    const data = await this.read()
    return [...data.profiles].sort((a, b) => {
      const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER
      const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER
      if (ao !== bo) return ao - bo
      return a.createdAt.localeCompare(b.createdAt)
    })
  }

  async ensureGlobalProfile(): Promise<Profile> {
    const data = await this.read()
    const found = data.profiles.find((p) => p.id === GLOBAL_PROFILE_ID || p.isGlobalProfile)
    if (found) return found

    const globalProfile: Profile = {
      id: GLOBAL_PROFILE_ID,
      displayName: 'Global Account',
      customName: 'Global Account',
      createdAt: '1970-01-01T00:00:00.000Z',
      avatarColor: '#6366f1',
      googleAuthStatus: 'not-signed-in',
      sortOrder: -1,
      muted: false,
      hiddenInSidebar: false,
      isGlobalProfile: true,
      apps: emptyProfileApps(),
      customLinks: []
    }
    data.profiles.unshift(globalProfile)
    await this.write(data)
    return globalProfile
  }

  async findByDisplayNameIgnoreCase(displayName: string): Promise<Profile | null> {
    const key = displayName.trim().toLowerCase()
    if (!key) return null
    const data = await this.read()
    const matches = data.profiles.filter((p) => p.displayName.trim().toLowerCase() === key)
    if (matches.length === 0) return null
    if (matches.length === 1) return matches[0]
    return [...matches].sort((a, b) => {
      const d = profileAuthScore(b) - profileAuthScore(a)
      if (d !== 0) return d
      return a.createdAt.localeCompare(b.createdAt)
    })[0]
  }

  /**
   * Create a profile, or return the existing one with the same email (case-insensitive).
   * When duplicates exist, prefers the most signed-in profile.
   */
  async createOrGet(displayName: string): Promise<{ profile: Profile; created: boolean }> {
    const trimmed = displayName.trim()
    if (!trimmed) {
      throw new Error('displayName is required')
    }
    const existing = await this.findByDisplayNameIgnoreCase(trimmed)
    if (existing) {
      return { profile: existing, created: false }
    }
    const profile = await this.create(trimmed)
    return { profile, created: true }
  }

  async create(displayName: string): Promise<Profile> {
    const trimmed = displayName.trim()
    if (!trimmed) {
      throw new Error('displayName is required')
    }

    const data = await this.read()
    const colorIndex = data.profiles.length % AVATAR_COLORS.length
    const profile: Profile = {
      id: randomUUID(),
      displayName: trimmed,
      createdAt: new Date().toISOString(),
      avatarColor: AVATAR_COLORS[colorIndex],
      googleAuthStatus: 'not-signed-in',
      sortOrder: data.profiles.length,
      muted: false,
      hiddenInSidebar: false,
      apps: emptyProfileApps(),
      customLinks: []
    }

    data.profiles.push(profile)
    await this.write(data)
    return profile
  }

  /** True when Google is unsigned and no app session is signed-in. */
  isUnsignedOrphan(profile: Profile): boolean {
    if (profile.googleAuthStatus === 'signed-in') return false
    return APP_IDS.every((id) => profile.apps[id].sessionStatus !== 'signed-in')
  }

  /**
   * For each email group, keep the best profile (any signed-in app, else Google signed-in,
   * else oldest) and delete unsigned duplicates.
   */
  async deleteUnsignedDuplicates(): Promise<{ deletedIds: string[]; profiles: Profile[] }> {
    const data = await this.read()
    const groups = new Map<string, Profile[]>()
    for (const p of data.profiles) {
      const key = p.displayName.trim().toLowerCase()
      const list = groups.get(key) ?? []
      list.push(p)
      groups.set(key, list)
    }

    const deletedIds: string[] = []
    const keep = new Set<string>()

    for (const group of groups.values()) {
      if (group.length === 1) {
        keep.add(group[0].id)
        continue
      }
      const ranked = [...group].sort((a, b) => {
        const d = profileAuthScore(b) - profileAuthScore(a)
        if (d !== 0) return d
        return a.createdAt.localeCompare(b.createdAt)
      })
      keep.add(ranked[0].id)
      for (const extra of ranked.slice(1)) {
        if (this.isUnsignedOrphan(extra)) {
          deletedIds.push(extra.id)
        } else {
          keep.add(extra.id)
        }
      }
    }

    if (deletedIds.length === 0) {
      return { deletedIds, profiles: data.profiles }
    }
    data.profiles = data.profiles.filter((p) => !deletedIds.includes(p.id))
    await this.write(data)
    return { deletedIds, profiles: data.profiles }
  }

  /** Reset mid-login statuses left over after crash / cancel (idempotent). */
  async clearStuckSigningInStatuses(): Promise<Profile[]> {
    const data = await this.read()
    let changed = false
    data.profiles = data.profiles.map((p) => {
      let next = p
      if (p.googleAuthStatus === 'signing-in') {
        next = { ...next, googleAuthStatus: 'not-signed-in' }
        changed = true
      }
      for (const appId of APP_IDS) {
        const st = next.apps[appId].sessionStatus
        if (st === 'signing-in' || st === 'signing-in-google' || st === 'signing-in-slack') {
          next = updateApp(next, appId, {
            ...next.apps[appId],
            sessionStatus: 'not-signed-in'
          })
          changed = true
        }
      }
      return next
    })
    if (changed) {
      await this.write(data)
    }
    return data.profiles
  }

  async setGoogleAuthStatus(
    profileId: string,
    next: Profile['googleAuthStatus']
  ): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index < 0) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    const current = data.profiles[index]
    if (current.googleAuthStatus === next) {
      return current
    }
    const updated: Profile = { ...current, googleAuthStatus: next }
    data.profiles[index] = updated
    await this.write(data)
    return updated
  }

  /** Force Google auth status without transition rules (cancel / stuck reset). */
  async forceGoogleAuthStatus(
    profileId: string,
    next: Profile['googleAuthStatus']
  ): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index < 0) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    const current = data.profiles[index]
    if (current.googleAuthStatus === next) {
      return current
    }
    const updated: Profile = { ...current, googleAuthStatus: next }
    data.profiles[index] = updated
    await this.write(data)
    return updated
  }

  async setSessionStatus(
    profileId: string,
    appId: AppId,
    next: AppSessionStatus
  ): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index < 0) {
      throw new Error(`Profile not found: ${profileId}`)
    }

    const current = data.profiles[index]
    const app = current.apps[appId]
    const from = app.sessionStatus

    // Idempotent: retries / double-clicks must not throw (e.g. signing-in → signing-in).
    if (from === next) {
      return current
    }

    if (appId === 'slack') {
      const allowed = SLACK_TRANSITIONS[from as SlackSessionStatus]
      if (!allowed?.includes(next as SlackSessionStatus)) {
        throw new Error(`Invalid Slack session status transition: ${from} → ${next}`)
      }
    } else if (appId === 'teams') {
      const allowed = TEAMS_TRANSITIONS[from as TeamsSessionStatus]
      if (!allowed?.includes(next as TeamsSessionStatus)) {
        throw new Error(`Invalid Teams session status transition: ${from} → ${next}`)
      }
    } else {
      const allowed = WHATSAPP_TRANSITIONS[from as WhatsAppSessionStatus]
      if (!allowed?.includes(next as WhatsAppSessionStatus)) {
        throw new Error(`Invalid WhatsApp session status transition: ${from} → ${next}`)
      }
    }

    const updated = updateApp(current, appId, { ...app, sessionStatus: next })
    data.profiles[index] = updated
    await this.write(data)
    return updated
  }

  /** Set status without transition checks (login cancel / verified success). */
  async forceSessionStatus(
    profileId: string,
    appId: AppId,
    next: AppSessionStatus
  ): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index < 0) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    const current = data.profiles[index]
    const app = current.apps[appId]
    const updated = updateApp(current, appId, { ...app, sessionStatus: next })
    data.profiles[index] = updated
    await this.write(data)
    return updated
  }

  async upsertAvailable(
    profileId: string,
    appId: AppId,
    workspace: {
      teamId: string
      teamName: string
      openUrl?: string
      teamDomain?: string
      lastSeenAt?: string
      lastChannelName?: string
    }
  ): Promise<Profile> {
    if (appId === 'whatsapp') {
      const current = await this.get(profileId)
      if (!current) {
        throw new Error(`Profile not found: ${profileId}`)
      }
      return current
    }
    const entry = workspaceFromRaw(
      workspace.teamId,
      workspace.teamName,
      workspace.openUrl,
      workspace.teamDomain,
      workspace.lastSeenAt,
      appId,
      workspace.lastChannelName
    )
    if (!entry.teamId) {
      throw new Error('teamId is required')
    }

    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index < 0) {
      throw new Error(`Profile not found: ${profileId}`)
    }

    const current = data.profiles[index]
    const app = current.apps[appId]

    if (appId === 'teams' && /^teams-/i.test(entry.teamId) && entry.teamId !== 'teams-home') {
      return current
    }

    const existingIdx = app.availableWorkspaces.findIndex((w) => w.teamId === entry.teamId)
    let availableWorkspaces: AvailableWorkspace[]
    if (existingIdx >= 0) {
      const prev = app.availableWorkspaces[existingIdx]
      const nextName =
        !isSlackPlaceholderName(entry.teamName)
          ? entry.teamName
          : !isSlackPlaceholderName(prev.teamName)
            ? prev.teamName
            : entry.teamDomain || prev.teamDomain || entry.teamName
      availableWorkspaces = app.availableWorkspaces.map((w, i) =>
        i === existingIdx
          ? {
              ...entry,
              teamName: nextName,
              teamDomain: entry.teamDomain ?? prev.teamDomain,
              openUrl:
                appId === 'slack' ? preferSlackOpenUrl(entry.openUrl, prev.openUrl) : entry.openUrl,
              lastChannelName: entry.lastChannelName || prev.lastChannelName
            }
          : w
      )
    } else {
      availableWorkspaces = [...app.availableWorkspaces, entry]
    }

    if (appId === 'teams') {
      availableWorkspaces = collapseTeamsWorkspaces(availableWorkspaces)
    }

    const pinnedWorkspaces = reconcilePins(availableWorkspaces, app.pinnedWorkspaces)
    const updated = updateApp(current, appId, {
      ...app,
      availableWorkspaces,
      pinnedWorkspaces
    })

    const unchanged =
      app.availableWorkspaces.length === availableWorkspaces.length &&
      app.pinnedWorkspaces.length === pinnedWorkspaces.length &&
      availableWorkspaces.every((w, i) => {
        const p = app.availableWorkspaces[i]
        return (
          Boolean(p) &&
          p!.teamId === w.teamId &&
          p!.teamName === w.teamName &&
          p!.openUrl === w.openUrl &&
          (p!.teamDomain ?? '') === (w.teamDomain ?? '')
        )
      })
    if (unchanged) {
      return current
    }

    data.profiles[index] = updated
    await this.write(data)
    return updated
  }

  async setAvailableWorkspaces(
    profileId: string,
    appId: AppId,
    workspaces: AvailableWorkspace[]
  ): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index < 0) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    const current = data.profiles[index]
    const app = current.apps[appId]
    const pinnedWorkspaces = reconcilePins(workspaces, app.pinnedWorkspaces)
    const updated = updateApp(current, appId, {
      ...app,
      availableWorkspaces: workspaces,
      pinnedWorkspaces
    })
    data.profiles[index] = updated
    await this.write(data)
    return updated
  }

  async mergeAvailable(
    profileId: string,
    appId: AppId,
    workspaces: AvailableWorkspace[]
  ): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index < 0) {
      throw new Error(`Profile not found: ${profileId}`)
    }

    const current = data.profiles[index]
    const app = current.apps[appId]

    // Teams sync replaces the list so stale hashed fake orgs disappear.
    if (appId === 'teams') {
      const availableWorkspaces = collapseTeamsWorkspaces(
        workspaces
          .map((ws) =>
            workspaceFromRaw(
              ws.teamId,
              ws.teamName,
              ws.openUrl,
              ws.teamDomain,
              ws.lastSeenAt,
              appId
            )
          )
          .filter((entry) => {
            if (!entry.teamId) {
              return false
            }
            if (/^teams-/i.test(entry.teamId) && entry.teamId !== 'teams-home') {
              return false
            }
            return true
          })
      )
      const pinnedWorkspaces = reconcilePins(availableWorkspaces, app.pinnedWorkspaces)
      const updated = updateApp(current, appId, {
        ...app,
        availableWorkspaces,
        pinnedWorkspaces
      })
      data.profiles[index] = updated
      await this.write(data)
      return updated
    }

    const byId = new Map(app.availableWorkspaces.map((w) => [w.teamId, w]))
    for (const ws of workspaces) {
      const entry = workspaceFromRaw(
        ws.teamId,
        ws.teamName,
        ws.openUrl,
        ws.teamDomain,
        ws.lastSeenAt,
        appId
      )
      if (!entry.teamId) {
        continue
      }
      const prev = byId.get(entry.teamId)
      byId.set(
        entry.teamId,
        prev ? { ...prev, ...entry, teamName: entry.teamName || prev.teamName } : entry
      )
    }

    const availableWorkspaces = [...byId.values()]
    const pinnedWorkspaces = reconcilePins(availableWorkspaces, app.pinnedWorkspaces)
    const updated = updateApp(current, appId, {
      ...app,
      availableWorkspaces,
      pinnedWorkspaces
    })
    data.profiles[index] = updated
    await this.write(data)
    return updated
  }

  async pinFromAvailable(profileId: string, appId: AppId, teamId: string): Promise<Profile> {
    const trimmed = teamId.trim()
    if (!trimmed) {
      throw new Error('teamId is required')
    }

    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index < 0) {
      throw new Error(`Profile not found: ${profileId}`)
    }

    const current = data.profiles[index]
    const app = current.apps[appId]
    const avail = app.availableWorkspaces.find((w) => w.teamId === trimmed)
    const alreadyPinned = app.pinnedWorkspaces.find((w) => w.teamId === trimmed)
    if (!avail && !alreadyPinned) {
      throw new Error('Open the workspace once so it appears in the list, then pin it')
    }

    const pin = alreadyPinned ?? toPinned(avail!)
    // Newest pin goes first (top priority).
    const pinnedWorkspaces = [pin, ...app.pinnedWorkspaces.filter((w) => w.teamId !== trimmed)]
    // Keep pinned workspaces at the front of Available for sidebar order.
    const availableWorkspaces = avail
      ? [avail, ...app.availableWorkspaces.filter((w) => w.teamId !== trimmed)]
      : app.availableWorkspaces

    const updated = updateApp(current, appId, { ...app, availableWorkspaces, pinnedWorkspaces })
    data.profiles[index] = updated
    await this.write(data)
    return updated
  }

  async unpinWorkspace(profileId: string, appId: AppId, teamId: string): Promise<Profile> {
    const trimmed = teamId.trim()
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index < 0) {
      throw new Error(`Profile not found: ${profileId}`)
    }

    const current = data.profiles[index]
    const app = current.apps[appId]
    if (!app.pinnedWorkspaces.some((w) => w.teamId === trimmed)) {
      return current
    }

    const updated = updateApp(current, appId, {
      ...app,
      pinnedWorkspaces: app.pinnedWorkspaces.filter((w) => w.teamId !== trimmed)
    })
    data.profiles[index] = updated
    await this.write(data)
    return updated
  }

  async delete(profileId: string): Promise<void> {
    const data = await this.read()
    const next = data.profiles.filter((p) => p.id !== profileId)
    if (next.length === data.profiles.length) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    data.profiles = next
    await this.write(data)
  }

  async clearAllProfiles(): Promise<string[]> {
    const data = await this.read()
    const ids = data.profiles.map((p) => p.id)
    data.profiles = []
    await this.write(data)
    return ids
  }

  async setCustomName(profileId: string, customName: string | null): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index < 0) throw new Error(`Profile not found: ${profileId}`)
    const current = data.profiles[index]
    const trimmed = customName?.trim() || undefined
    const updated: Profile = { ...current }
    if (trimmed) updated.customName = trimmed
    else delete updated.customName
    data.profiles[index] = updated
    await this.write(data)
    return updated
  }

  async setMuted(profileId: string, muted: boolean): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index < 0) throw new Error(`Profile not found: ${profileId}`)
    const updated: Profile = { ...data.profiles[index], muted }
    data.profiles[index] = updated
    await this.write(data)
    return updated
  }

  async reorder(orderedIds: string[]): Promise<Profile[]> {
    const data = await this.read()
    const byId = new Map(data.profiles.map((p) => [p.id, p]))
    const next: Profile[] = []
    orderedIds.forEach((id, i) => {
      const p = byId.get(id)
      if (p) {
        next.push({ ...p, sortOrder: i })
        byId.delete(id)
      }
    })
    for (const leftover of byId.values()) {
      next.push({ ...leftover, sortOrder: next.length })
    }
    data.profiles = next
    await this.write(data)
    return this.list()
  }

  /** Metadata-only export (no cookies / tokens). */
  async exportMetadata(): Promise<Profile[]> {
    return this.list()
  }

  async importMetadata(incoming: Array<Partial<Profile>>): Promise<Profile[]> {
    const data = await this.read()
    const existingEmails = new Set(data.profiles.map((p) => p.displayName.trim().toLowerCase()))
    for (const raw of incoming) {
      const email = typeof raw.displayName === 'string' ? raw.displayName.trim() : ''
      if (!email || existingEmails.has(email.toLowerCase())) continue
      existingEmails.add(email.toLowerCase())
      data.profiles.push({
        id: randomUUID(),
        displayName: email,
        createdAt: new Date().toISOString(),
        avatarColor: AVATAR_COLORS[data.profiles.length % AVATAR_COLORS.length],
        googleAuthStatus: 'not-signed-in',
        sortOrder: data.profiles.length,
        muted: false,
        ...(typeof raw.customName === 'string' && raw.customName.trim()
          ? { customName: raw.customName.trim() }
          : {}),
        apps: emptyProfileApps()
      })
    }
    await this.write(data)
    return this.list()
  }

  async get(profileId: string): Promise<Profile | undefined> {
    const data = await this.read()
    return data.profiles.find((p) => p.id === profileId)
  }

  async listCustomLinks(profileId: string): Promise<CustomLink[]> {
    const profile = await this.get(profileId)
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    return profile.customLinks ?? []
  }

  async addCustomLink(
    profileId: string,
    link: { name: string; url: string }
  ): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index === -1) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    const profile = data.profiles[index]!
    const existing = profile.customLinks ?? []

    const validated = validateCustomLinkInput(link.name, link.url, existing)
    if (!validated.valid) {
      throw new Error(validated.message)
    }

    const linkId = randomUUID()
    const newLink: CustomLink = {
      id: linkId,
      name: validated.name,
      url: validated.url,
      order: existing.length,
      createdAt: new Date().toISOString(),
      partition: `persist:profile-${profileId}-link-${linkId}`,
      hiddenInSidebar: false
    }

    const updatedProfile: Profile = {
      ...profile,
      customLinks: [...existing, newLink]
    }
    data.profiles[index] = updatedProfile
    await this.write(data)
    return updatedProfile
  }

  async updateCustomLink(
    profileId: string,
    linkId: string,
    patch: { name?: string; url?: string }
  ): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index === -1) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    const profile = data.profiles[index]!
    const existing = profile.customLinks ?? []
    const linkIdx = existing.findIndex((l) => l.id === linkId)
    if (linkIdx === -1) {
      throw new Error(`Custom link not found: ${linkId}`)
    }

    const current = existing[linkIdx]!
    const nextName = patch.name !== undefined ? patch.name : current.name
    const nextUrl = patch.url !== undefined ? patch.url : current.url

    // Exclude current link from duplicate check
    const otherLinks = existing.filter((l) => l.id !== linkId)
    const validated = validateCustomLinkInput(nextName, nextUrl, otherLinks)
    if (!validated.valid) {
      throw new Error(validated.message)
    }

    const updatedLink: CustomLink = {
      ...current,
      name: validated.name,
      url: validated.url
    }

    const nextLinks = [...existing]
    nextLinks[linkIdx] = updatedLink
    const updatedProfile: Profile = {
      ...profile,
      customLinks: nextLinks
    }
    data.profiles[index] = updatedProfile
    await this.write(data)
    return updatedProfile
  }

  async removeCustomLink(profileId: string, linkId: string): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index === -1) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    const profile = data.profiles[index]!
    const existing = profile.customLinks ?? []
    const nextLinks = existing
      .filter((l) => l.id !== linkId)
      .map((link, idx) => ({ ...link, order: idx }))

    const updatedProfile: Profile = {
      ...profile,
      customLinks: nextLinks
    }
    data.profiles[index] = updatedProfile
    await this.write(data)
    return updatedProfile
  }

  async reorderCustomLinks(profileId: string, orderedIds: string[]): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index === -1) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    const profile = data.profiles[index]!
    const existing = profile.customLinks ?? []
    const byId = new Map(existing.map((l) => [l.id, l]))

    const reordered: CustomLink[] = []
    for (let i = 0; i < orderedIds.length; i++) {
      const item = byId.get(orderedIds[i]!)
      if (item) {
        reordered.push({ ...item, order: i })
        byId.delete(orderedIds[i]!)
      }
    }
    // Append any omitted links
    for (const remaining of byId.values()) {
      reordered.push({ ...remaining, order: reordered.length })
    }

    const updatedProfile: Profile = {
      ...profile,
      customLinks: reordered
    }
    data.profiles[index] = updatedProfile
    await this.write(data)
    return updatedProfile
  }

  async setSidebarVisibility(profileId: string, hidden: boolean): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index === -1) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    const updatedProfile: Profile = {
      ...data.profiles[index]!,
      hiddenInSidebar: hidden
    }
    data.profiles[index] = updatedProfile
    await this.write(data)
    return updatedProfile
  }

  async setAccountScope(profileId: string, scope: import('../../shared/types').ProfileScope): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index === -1) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    const updatedProfile: Profile = {
      ...data.profiles[index]!,
      accountScope: scope,
      // Global accounts are shown in sidebar & flagged as global profile
      // Individual profiles are hidden from sidebar and routed to dashboard dropdown
      hiddenInSidebar: scope === 'individual',
      isGlobalProfile: scope === 'global'
    }
    data.profiles[index] = updatedProfile
    await this.write(data)
    return updatedProfile
  }

  async setLinkSidebarVisibility(
    profileId: string,
    linkId: string,
    hidden: boolean
  ): Promise<Profile> {
    const data = await this.read()
    const index = data.profiles.findIndex((p) => p.id === profileId)
    if (index === -1) {
      throw new Error(`Profile not found: ${profileId}`)
    }
    const profile = data.profiles[index]!
    const links = (profile.customLinks ?? []).map((l) =>
      l.id === linkId ? { ...l, hiddenInSidebar: hidden } : l
    )
    const updatedProfile: Profile = {
      ...profile,
      customLinks: links
    }
    data.profiles[index] = updatedProfile
    await this.write(data)
    return updatedProfile
  }

  private async read(): Promise<{ profiles: Profile[] }> {
    if (this.cache) {
      return { profiles: [...this.cache] }
    }
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      let parsed: { profiles?: RawProfile[] }
      let healed = false
      try {
        parsed = JSON.parse(raw) as { profiles?: RawProfile[] }
      } catch (parseErr) {
        try {
          parsed = parseProfilesFile(raw)
          healed = true
        } catch {
          throw parseErr
        }
      }
      const profiles = Array.isArray(parsed.profiles)
        ? parsed.profiles.map((p) => normalizeProfile(p))
        : []
      this.cache = profiles
      if (healed) {
        // Heal corrupted file (trailing garbage from overlapping writes)
        await this.write({ profiles })
      }
      return { profiles: [...profiles] }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        this.cache = []
        return { profiles: [] }
      }
      throw err
    }
  }

  private async write(data: { profiles: Profile[] }): Promise<void> {
    this.cache = [...data.profiles]
    const payload = `${JSON.stringify(data, null, 2)}\n`
    const run = async (): Promise<void> => {
      await fs.mkdir(dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(tmp, payload, 'utf8')
      await fs.rename(tmp, this.filePath)
    }
    const next = this.writeChain.then(run, run)
    this.writeChain = next.then(
      () => undefined,
      () => undefined
    )
    await next
  }
}

/** Prefer strict parse; if trailing garbage exists (race corruption), take the first value. */
function parseProfilesFile(raw: string): { profiles?: RawProfile[] } {
  try {
    return JSON.parse(raw) as { profiles?: RawProfile[] }
  } catch (err) {
    const trimmed = raw.replace(/^\uFEFF/, '').trimStart()
    if (!trimmed.startsWith('{')) {
      throw err
    }
    // Scan for first complete top-level object (handles "JSON + leftover fragment").
    let depth = 0
    let inString = false
    let escape = false
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i]!
      if (inString) {
        if (escape) {
          escape = false
        } else if (ch === '\\') {
          escape = true
        } else if (ch === '"') {
          inString = false
        }
        continue
      }
      if (ch === '"') {
        inString = true
        continue
      }
      if (ch === '{') {
        depth++
      } else if (ch === '}') {
        depth--
        if (depth === 0) {
          return JSON.parse(trimmed.slice(0, i + 1)) as { profiles?: RawProfile[] }
        }
      }
    }
    throw err
  }
}

export function defaultProfileStorePath(userDataPath: string): string {
  return join(userDataPath, 'profiles.json')
}
