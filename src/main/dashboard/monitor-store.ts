import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type DashboardProject,
  type DashboardProjectDefaults,
  type ProjectSource,
  DASHBOARD_SCHEDULE_INTERVALS
} from '../../shared/dashboard-contract'

/** Workspace facts discovered when a manual token was validated. */
export interface ManualTokenMeta {
  teamId: string
  teamName: string
  userName?: string
  /** Slack user id of the token owner (= the freelancer). */
  userId?: string
}

interface MonitorFile {
  projects: DashboardProject[]
  manualTokens: Record<string, string>
  /** v2.2 — workspace facts per vault key (never the token itself). */
  manualTokenMeta?: Record<string, ManualTokenMeta>
  /** v2.2 — channelId → owning workspace id (enforces 1 workspace = 1 card). */
  channelOwners?: Record<string, string>
  /** Client-projects page: user-owned Pinned order (newest pin last). */
  pinnedOrder?: string[]
  /** App-wide defaults for newly added project cards. */
  dashboardDefaults?: DashboardProjectDefaults
  syncIntervalSeconds?: number
  updatedAt?: string
}

/** Lazy safeStorage import so constructor stays sync (matches existing seams). */
interface EncryptedVault {
  encrypt(plain: string): string
  decrypt(b64: string): string
}

/** A raw Slack token an older build left on disk before saves were blocked. */
const PLAINTEXT_TOKEN_RE = /^xox[a-zA-Z]-[A-Za-z0-9-]+$/

export const DEFAULT_PROJECT_DEFAULTS: DashboardProjectDefaults = {
  allowDms: 'off',
  scheduleEnabled: true,
  intervalMinutes: 0.333,
  backfillHours: 6,
  catchUpCapDays: 7
}

/** Fill the source fields that a new card inherits from global settings. */
function normalizeSource(
  source: ProjectSource,
  defaults: DashboardProjectDefaults
): ProjectSource {
  return {
    ...source,
    channels: Array.isArray(source.channels) ? source.channels : [],
    selectionMode: source.selectionMode ?? 'include',
    scheduleEnabled: source.scheduleEnabled ?? defaults.scheduleEnabled,
    scheduleIntervalMinutes: source.scheduleIntervalMinutes ?? defaults.intervalMinutes,
    backfillHours: source.backfillHours ?? defaults.backfillHours,
    allowDms: source.allowDms ?? defaults.allowDms,
    catchUpCapDays: source.catchUpCapDays ?? defaults.catchUpCapDays
  }
}

let vault: EncryptedVault | null = null

async function getVaultOverride(override: EncryptedVault | null): Promise<EncryptedVault> {
  if (override) return override
  if (!vault) {
    const { safeStorage } = (await import('electron')) as typeof import('electron')
    vault = {
      encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
      decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64'))
    }
  }
  return vault
}

/** Persisted monitor config: projects + manual tokens + sync interval. */
export class MonitorStore {
  private readonly filePath: string
  private encryptionAvailable: boolean

  private vaultOverride: EncryptedVault | null
  /** Serializes source patches so two settings toggles cannot clobber each other. */
  private mutationQueue: Promise<unknown> = Promise.resolve()
  constructor(options: { rootDir: string; encryptionAvailable: boolean; vault?: EncryptedVault }) {
    this.filePath = join(options.rootDir, 'monitors.json')
    this.encryptionAvailable = options.encryptionAvailable
    this.vaultOverride = options.vault ?? null
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  /**
   * Patch one source without replacing the whole project. Read-modify-write is
   * serialized so channel selection, schedule, and DM changes cannot lose each
   * other when the UI fires them close together.
   */
  async updateSource(
    projectId: string,
    sourceId: string,
    patch: Partial<ProjectSource>
  ): Promise<ProjectSource> {
    return this.enqueueMutation(async () => {
      const data = await this.read()
      const projectIndex = data.projects.findIndex((project) => project.id === projectId)
      if (projectIndex < 0) throw new Error('Project not found')
      const project = data.projects[projectIndex]!
      const sources = project.sources ?? []
      const sourceIndex = sources.findIndex((source) => source.id === sourceId)
      if (sourceIndex < 0) throw new Error('Source not found')
      const defaults = { ...DEFAULT_PROJECT_DEFAULTS, ...data.dashboardDefaults }
      const updated: ProjectSource = normalizeSource(
        {
          ...sources[sourceIndex]!,
          ...patch,
          id: sources[sourceIndex]!.id,
          updatedAt: new Date().toISOString()
        },
        defaults
      )
      const nextSources = [...sources]
      nextSources[sourceIndex] = updated
      const nextProject = { ...project, sources: nextSources }
      if (
        nextProject.sourcePreference === 'browser_only' &&
        updated.kind === 'browser' &&
        patch.channels
      ) {
        const readable =
          updated.selectionMode === 'exclude'
            ? updated.channels.filter((channel) => channel.enabled === false)
            : updated.channels.filter((channel) => channel.enabled !== false)
        nextProject.monitors = readable.map((channel) => ({
          channelId: channel.id,
          channelName: channel.name
        }))
      }
      data.projects[projectIndex] = nextProject
      await this.write(data)
      return updated
    })
  }

  async getDashboardDefaults(): Promise<DashboardProjectDefaults> {
    const data = await this.read()
    return { ...DEFAULT_PROJECT_DEFAULTS, ...data.dashboardDefaults }
  }

  async saveDashboardDefaults(
    patch: Partial<DashboardProjectDefaults>
  ): Promise<DashboardProjectDefaults> {
    return this.enqueueMutation(async () => {
      const data = await this.read()
      const next = { ...DEFAULT_PROJECT_DEFAULTS, ...data.dashboardDefaults, ...patch }
      // Keep the persisted shape small and validated.
      const defaults: DashboardProjectDefaults = {
        allowDms: next.allowDms === 'on' ? 'on' : 'off',
        scheduleEnabled: next.scheduleEnabled !== false,
        intervalMinutes: (DASHBOARD_SCHEDULE_INTERVALS as readonly number[]).includes(
          next.intervalMinutes
        )
          ? next.intervalMinutes
          : 0.333,
        backfillHours:
          next.backfillHours === 0
            ? 0
            : Math.min(720, Math.max(1, Number(next.backfillHours) || 6)),
        catchUpCapDays: Math.min(30, Math.max(1, Number(next.catchUpCapDays) || 7))
      }
      data.dashboardDefaults = defaults
      await this.write(data)
      return defaults
    })
  }

  async listProjects(): Promise<DashboardProject[]> {
    const data = await this.read()
    const defaults = { ...DEFAULT_PROJECT_DEFAULTS, ...data.dashboardDefaults }
    return data.projects
      .filter((p) => p.id !== 'draft-project' && !p.id.startsWith('draft-'))
      .map((p) => ({
        ...p,
        sources: Array.isArray(p.sources)
          ? p.sources.map((source) => normalizeSource(source, defaults))
          : [],
        sourcePreference: p.sourcePreference ?? 'token_first'
      }))
  }

  async upsertProject(input: {
    project:
      | Omit<DashboardProject, 'id' | 'createdAt'>
      | (Omit<DashboardProject, 'createdAt'> & { id: string })
  }): Promise<DashboardProject> {
    const data = await this.read()
    let project: DashboardProject
    const incoming = input.project
    const existingId = 'id' in incoming && incoming.id ? incoming.id : null
    const existing = existingId ? data.projects.find((p) => p.id === existingId) : undefined

    // v2.2 — one card = one workspace. Stamp the workspace from the vault
    // metadata when the caller did not provide it, and never let a card
    // change the workspace it belongs to.
    const meta = incoming.manualTokenKey
      ? data.manualTokenMeta?.[incoming.manualTokenKey]
      : undefined
    const teamName = incoming.teamName ?? existing?.teamName ?? meta?.teamName
    const teamId =
      incoming.teamId && incoming.teamId !== 'manual'
        ? incoming.teamId
        : (meta?.teamId ?? existing?.teamId ?? incoming.teamId)

    // Check if project has valid sources configured (e.g. browser source)
    const hasSources = Array.isArray(incoming.sources) && incoming.sources.length > 0
    const primarySource = hasSources ? incoming.sources![0] : undefined
    const effectiveTeamId =
      teamId ||
      primarySource?.workspaceId ||
      existing?.teamId ||
      (incoming.profileId ? `pending-${existingId || 'card-' + Date.now().toString(36)}` : undefined)
    const effectiveTeamName =
      teamName ||
      primarySource?.workspaceName ||
      existing?.teamName ||
      (incoming.profileId ? incoming.name || 'Workspace' : undefined)

    // v2.3 — hard rule: a card without a real workspace is never stored.
    // Without it every workspace would share one message bucket.
    if (!effectiveTeamId || effectiveTeamId === 'manual') {
      throw new Error(
        'Workspace unknown — reconnect the connector so the card can be bound to one workspace.'
      )
    }
    if (existing?.teamName && effectiveTeamName && existing.teamName !== effectiveTeamName && !hasSources) {
      throw new Error(
        `“${existing.name}” belongs to workspace ${existing.teamName}. A card can only watch one workspace — create a separate card instead.`
      )
    }

    // v2.2 — reject channels owned by a different workspace (token monitors).
    const owners = data.channelOwners ?? {}
    for (const monitor of incoming.monitors ?? []) {
      const owner = owners[monitor.channelId]
      if (owner && effectiveTeamId && owner !== effectiveTeamId) {
        throw new Error(
          `Channel #${monitor.channelName} belongs to another workspace. One card = one workspace — pick channels from a single workspace.`
        )
      }
    }

    const defaults = { ...DEFAULT_PROJECT_DEFAULTS, ...data.dashboardDefaults }
    const normalizedSources = Array.isArray(incoming.sources)
      ? incoming.sources.map((source) => normalizeSource(source, defaults))
      : (existing?.sources ?? []).map((source) => normalizeSource(source, defaults))
    const stamped = {
      ...incoming,
      teamName: effectiveTeamName,
      teamId: effectiveTeamId,
      sources: normalizedSources,
      sourcePreference: incoming.sourcePreference ?? existing?.sourcePreference ?? 'token_first'
    } as typeof incoming
    if ('id' in stamped && stamped.id) {
      const incomingId = stamped.id
      const found = data.projects.find((p) => p.id === incomingId)
      if (found) {
        project = { ...found, ...stamped }
        data.projects = data.projects.filter((p) => p.id !== project.id)
      } else {
        project = {
          ...(stamped as Omit<DashboardProject, 'createdAt'>),
          createdAt: new Date().toISOString()
        }
      }
    } else {
      project = {
        ...(stamped as Omit<DashboardProject, 'id' | 'createdAt'>),
        id: `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString()
      }
    }
    // remember channel ownership for the cross-workspace guard
    const nextOwners = { ...owners }
    for (const monitor of project.monitors) nextOwners[monitor.channelId] = teamId
    data.channelOwners = nextOwners
    data.projects.push(project)
    await this.write(data)
    return project
  }

  async deleteProject(projectId: string): Promise<void> {
    const data = await this.read()
    data.projects = data.projects.filter((p) => p.id !== projectId)
    data.pinnedOrder = (data.pinnedOrder ?? []).filter((id) => id !== projectId)
    await this.write(data)
  }

  async unassignProjectsForProfile(profileId: string): Promise<void> {
    const data = await this.read()
    let changed = false
    for (const project of data.projects) {
      if (project.profileId === profileId) {
        project.profileId = ''
        changed = true
      }
    }
    if (changed) {
      await this.write(data)
    }
  }

  async deleteProjectsForProfile(profileId: string): Promise<string[]> {
    const data = await this.read()
    const deletedIds: string[] = []
    data.projects = data.projects.filter((p) => {
      if (p.profileId === profileId) {
        deletedIds.push(p.id)
        return false
      }
      return true
    })
    if (deletedIds.length > 0) {
      const deletedSet = new Set(deletedIds)
      data.pinnedOrder = (data.pinnedOrder ?? []).filter((id) => !deletedSet.has(id))
      await this.write(data)
    }
    return deletedIds
  }

  /** Pinned order survives restarts; unknown/deleted ids are ignored on read. */
  async readPinnedOrder(): Promise<string[]> {
    const data = await this.read()
    const projectIds = new Set(data.projects.map((project) => project.id))
    return [...new Set(data.pinnedOrder ?? [])].filter((id) => projectIds.has(id))
  }

  async setPinnedOrder(order: string[]): Promise<string[]> {
    const data = await this.read()
    const projectIds = new Set(data.projects.map((project) => project.id))
    const cleaned = [...new Set(order)].filter((id) => projectIds.has(id))
    data.pinnedOrder = cleaned
    await this.write(data)
    return cleaned
  }

  /**
   * Manual tokens are written encrypted or not at all. Without OS encryption the
   * whole save fails — the metadata is not left behind either, so a rejected
   * token never half-registers in the UI.
   */
  async saveManualToken(
    key: string,
    token: string,
    meta?: ManualTokenMeta
  ): Promise<{ plaintext: boolean }> {
    if (!this.encryptionAvailable) {
      throw new Error('OS encryption unavailable')
    }
    const data = await this.read()
    if (meta) data.manualTokenMeta = { ...(data.manualTokenMeta ?? {}), [key]: meta }
    data.manualTokens = {
      ...data.manualTokens,
      [key]: (await getVaultOverride(this.vaultOverride)).encrypt(token)
    }
    await this.write(data)
    return { plaintext: false }
  }

  /**
   * A build before the save path blocked it could leave a Slack token on disk as
   * plaintext. Once the OS vault is available, seal those entries and re-save.
   * Returns how many secrets were rewritten; 0 when there was nothing to do.
   */
  async migrateLegacyPlaintext(): Promise<number> {
    if (!this.encryptionAvailable) return 0
    const vault = await getVaultOverride(this.vaultOverride)
    const data = await this.read()
    let moved = 0
    for (const [key, raw] of Object.entries(data.manualTokens)) {
      if (!PLAINTEXT_TOKEN_RE.test(raw.trim())) continue
      data.manualTokens[key] = vault.encrypt(raw.trim())
      moved += 1
    }
    if (moved > 0) await this.write(data)
    return moved
  }

  async getManualToken(key: string): Promise<string | null> {
    const raw = (await this.read()).manualTokens[key] ?? null
    if (raw === null) return null
    if (!this.encryptionAvailable) return raw
    try {
      return (await getVaultOverride(this.vaultOverride)).decrypt(raw.replace(/[\r\n]/g, ''))
    } catch {
      // legacy plaintext entry written by the fallback path
      return raw.split('\u0000').join('')
    }
  }

  async deleteManualToken(key: string): Promise<void> {
    const data = await this.read()
    const next = { ...data.manualTokens }
    delete next[key]
    data.manualTokens = next
    await this.write(data)
  }

  async listManualTokens(): Promise<Array<{ key: string; persisted: boolean }>> {
    const data = await this.read()
    return Object.keys(data.manualTokens).map((key) => ({ key, persisted: true }))
  }

  /** Workspace facts for one vault key (team id/name discovered at validation). */
  async getManualTokenMeta(key: string): Promise<ManualTokenMeta | null> {
    const data = await this.read()
    return data.manualTokenMeta?.[key] ?? null
  }

  /** All known vault keys with their workspace facts. */
  async listManualTokenMeta(): Promise<Array<{ key: string } & ManualTokenMeta>> {
    const data = await this.read()
    const meta = data.manualTokenMeta ?? {}
    return Object.entries(meta).map(([key, value]) => ({ key, ...value }))
  }

  /** Channel → owning workspace map (used by the workspace migration). */
  async listChannelOwners(): Promise<Record<string, string>> {
    const data = await this.read()
    return { ...(data.channelOwners ?? {}) }
  }

  /** Store workspace metadata discovered during token validation. */
  async upsertManualTokenMeta(key: string, meta: ManualTokenMeta): Promise<void> {
    const data = await this.read()
    data.manualTokenMeta = { ...(data.manualTokenMeta ?? {}), [key]: meta }
    await this.write(data)
  }

  async syncIntervalSeconds(): Promise<number> {
    const data = await this.read()
    const v = data.syncIntervalSeconds
    return typeof v === 'number' && v >= 30 ? v : 300
  }

  async setSyncIntervalSeconds(seconds: number): Promise<void> {
    const data = await this.read()
    data.syncIntervalSeconds = Math.max(30, Math.floor(seconds))
    await this.write(data)
  }

  private async read(): Promise<MonitorFile> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return JSON.parse(raw) as MonitorFile
    } catch {
      return { projects: [], manualTokens: {} }
    }
  }

  private async write(data: MonitorFile): Promise<void> {
    const record: MonitorFile = {
      ...data,
      updatedAt: new Date().toISOString()
    }
    await mkdir(join(this.filePath, '..'), { recursive: true })
    const tmpPath = `${this.filePath}.tmp`
    await writeFile(tmpPath, JSON.stringify(record, null, 2), 'utf8')
    await rename(tmpPath, this.filePath)
  }
}
