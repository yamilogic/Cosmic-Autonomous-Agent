import type {
  DashboardMonitor,
  DashboardProject,
  DashboardSource,
  ProjectSource,
  ProjectSourceChannel,
  ProjectSourceChannelKind
} from '../../shared/dashboard-contract'

/** One channel the dashboard is allowed to read for a project. */
export interface ResolvedChannel {
  channelId: string
  channelName: string
  kind: ProjectSourceChannelKind
  isPrivate?: boolean
  isDm?: boolean
  enabled: boolean
}

/**
 * A (workspace, channel set) pair. `source` is the dashboard-wide bucket
 * (`client` / `ours`); browser cards still land in `client` so existing
 * metrics and insights keep working.
 */
export interface ResolvedMessageSource {
  source: DashboardSource
  profileId: string
  teamId: string
  channels: ResolvedChannel[]
  role: 'client' | 'ours'
  origin: 'source' | 'legacy' | 'our-slack'
  projectSourceId?: string
}

export interface OurSlackSource {
  profileId: string
  teamId: string
  channels: DashboardMonitor[]
}

export interface ResolveProjectMessageSourcesOptions {
  /** Workspace mapping overrides the project's own team id for legacy monitors. */
  mappedTeamId?: string
  /** Globally connected Our Slack workspace, when available. */
  ourSlack?: OurSlackSource | null
}

function kindOfChannel(channel: {
  id?: string
  kind?: ProjectSourceChannelKind
  isPrivate?: boolean
  isDm?: boolean
}): ProjectSourceChannelKind {
  if (channel.kind) return channel.kind
  if (channel.isDm) return 'dm'
  if (channel.isPrivate) return 'private'
  const id = channel.id ?? ''
  if (id.startsWith('D')) return 'dm'
  if (id.startsWith('G')) return 'private'
  return 'public'
}

function fromSourceChannel(channel: ProjectSourceChannel): ResolvedChannel {
  return {
    channelId: channel.id,
    channelName: channel.name || channel.id,
    kind: kindOfChannel(channel),
    isPrivate: channel.isPrivate,
    isDm: channel.isDm,
    enabled: channel.enabled !== false
  }
}

function fromMonitor(channel: DashboardMonitor): ResolvedChannel {
  return {
    channelId: channel.channelId,
    channelName: channel.channelName || channel.channelId,
    kind: kindOfChannel({ id: channel.channelId }),
    enabled: true
  }
}

function hasChannels(source: ProjectSource): boolean {
  const channels =
    source.selectionMode === 'exclude'
      ? (source.channels ?? []).filter((channel) => channel.enabled === false)
      : (source.channels ?? []).filter((channel) => channel.enabled !== false)
  return channels.length > 0
}

/**
 * The single source of truth for "which stored channels belong to this card".
 *
 * Rules:
 * - Explicit, enabled sources win. Disabled sources are ignored.
 * - Browser-only cards never read the legacy `project.monitors` mirror; that
 *   mirror can contain channels the user did not select.
 * - A browser card with no token source ignores legacy monitors for the same
 *   reason. Mixed cards keep distinct token monitors.
 * - Per-card `ourSlackChannels` wins over the global Our Slack pins.
 * - Results are deduped by role + workspace + channel.
 */
export function resolveProjectMessageSources(
  project: DashboardProject,
  options: ResolveProjectMessageSourcesOptions = {}
): ResolvedMessageSource[] {
  const out: ResolvedMessageSource[] = []
  const seen = new Set<string>()

  const add = (entry: ResolvedMessageSource): void => {
    const channels = entry.channels.filter((channel) => {
      const key = `${entry.role}|${entry.profileId}|${entry.teamId}|${channel.channelId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (channels.length === 0) return
    out.push({ ...entry, channels })
  }

  const sources = (project.sources ?? []).filter((source) => source.enabled !== false)
  // New browser cards explicitly mark themselves browser_only. Older cards may
  // still carry a legacy monitors mirror; keep it so they do not go dark.
  const browserOnly = project.sourcePreference === 'browser_only'

  for (const source of sources) {
    if (!hasChannels(source)) continue
    const role: 'client' | 'ours' = source.role === 'ours' ? 'ours' : 'client'
    const readableChannels =
      source.selectionMode === 'exclude'
        ? (source.channels ?? []).filter((channel) => channel.enabled === false)
        : (source.channels ?? []).filter((channel) => channel.enabled !== false)
    add({
      source: role,
      role,
      origin: 'source',
      projectSourceId: source.id,
      profileId: source.profileId || project.profileId,
      teamId: source.workspaceId || options.mappedTeamId || project.teamId,
      channels: readableChannels.map(fromSourceChannel)
    })
  }

  // Legacy token cards (and the token half of a mixed card) still use monitors.
  if (!browserOnly && project.monitors.length > 0) {
    add({
      source: 'client',
      role: 'client',
      origin: 'legacy',
      profileId: project.profileId,
      teamId: options.mappedTeamId || project.teamId,
      channels: project.monitors.map(fromMonitor)
    })
  }

  const ourChannels =
    project.ourSlackChannels && project.ourSlackChannels.length > 0
      ? project.ourSlackChannels
      : (options.ourSlack?.channels ?? [])
  if (ourChannels.length > 0) {
    add({
      source: 'ours',
      role: 'ours',
      origin: 'our-slack',
      profileId: options.ourSlack?.profileId || project.profileId,
      teamId:
        project.ourSlackTeamId ||
        options.ourSlack?.teamId ||
        options.mappedTeamId ||
        project.teamId,
      channels: ourChannels.map(fromMonitor)
    })
  }

  return out
}
