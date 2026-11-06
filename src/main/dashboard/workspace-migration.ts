/**
 * v2.2 workspace migration — one card = one workspace.
 *
 * Legacy cards were created before the workspace was stamped on the project,
 * so a single card could hold channels from two different workspaces. This
 * one-time migration:
 *   1. resolves which workspace owns every monitored channel (by asking each
 *      known connector which channels it can see),
 *   2. stamps the workspace (teamId/teamName) on cards that have exactly one,
 *   3. splits mixed cards into one clean card per workspace.
 *
 * Safe to run on every launch: cards that already carry a workspace are left
 * untouched unless their teamId is still the placeholder 'manual'.
 */

import type { DashboardProject } from '../../shared/dashboard-contract'
import type { ManualTokenMeta, MonitorStore } from './monitor-store'

export interface WorkspaceMigrationDeps {
  monitorStore: MonitorStore
  /** Vault keys that hold a saved connector token. */
  listTokenKeys: () => Promise<string[]>
  /** Workspace facts for a vault key (auth.test) — null when the token is dead. */
  resolveTokenMeta: (key: string) => Promise<ManualTokenMeta | null>
  /** Channels visible to a vault key (its own workspace only). */
  listChannelsForKey: (key: string) => Promise<Array<{ id: string; name: string }>>
}

export interface WorkspaceMigrationResult {
  /** cards that got a workspace stamp */
  stamped: number
  /** legacy cards that were split into several clean cards */
  split: number
  /** cards left untouched */
  untouched: number
  /** human readable notes for the log */
  notes: string[]
}

interface OwnerGroup {
  teamId: string
  teamName: string
  key: string
  monitors: DashboardProject['monitors']
}

function groupKey(teamId: string): string {
  return teamId
}

export async function migrateWorkspaceCards(
  deps: WorkspaceMigrationDeps
): Promise<WorkspaceMigrationResult> {
  const result: WorkspaceMigrationResult = { stamped: 0, split: 0, untouched: 0, notes: [] }
  const projects = await deps.monitorStore.listProjects()
  if (projects.length === 0) return result

  // Fast path: every card already knows its workspace and who "me" is.
  const needsWork = projects.some(
    (p) => !p.teamName || !p.teamId || p.teamId === 'manual' || !p.selfUserId
  )
  if (!needsWork) {
    result.untouched = projects.length
    return result
  }

  // every connector that could own a channel
  const keys = new Set<string>(await deps.listTokenKeys())
  for (const p of projects) if (p.manualTokenKey) keys.add(p.manualTokenKey)

  // workspace facts + channel → workspace owner, learned from every connector
  const metaByKey = new Map<string, ManualTokenMeta>()
  const channelOwner = new Map<string, { teamId: string; teamName: string; key: string }>()
  for (const key of keys) {
    let meta: ManualTokenMeta | null = null
    try {
      meta = await deps.resolveTokenMeta(key)
    } catch {
      meta = null
    }
    if (!meta) continue
    metaByKey.set(key, meta)
    let channels: Array<{ id: string; name: string }> = []
    try {
      channels = await deps.listChannelsForKey(key)
    } catch {
      continue
    }
    for (const channel of channels) {
      if (!channelOwner.has(channel.id)) {
        channelOwner.set(channel.id, {
          teamId: meta.teamId,
          teamName: meta.teamName,
          key
        })
      }
    }
  }

  for (const project of projects) {
    const projectMeta = project.manualTokenKey ? metaByKey.get(project.manualTokenKey) : undefined

    // already clean — only repair a placeholder teamId / missing "me"
    if (project.teamName && project.teamId && project.teamId !== 'manual' && project.selfUserId) {
      result.untouched += 1
      continue
    }

    const groups = new Map<string, OwnerGroup>()
    for (const monitor of project.monitors) {
      const owner = channelOwner.get(monitor.channelId)
      const teamId = owner?.teamId ?? projectMeta?.teamId ?? project.teamId ?? 'manual'
      const teamName = owner?.teamName ?? projectMeta?.teamName ?? project.teamName ?? 'Unknown'
      const key = groupKey(teamId)
      const group = groups.get(key)
      if (group) {
        group.monitors.push(monitor)
      } else {
        groups.set(key, {
          teamId,
          teamName,
          key: owner?.key ?? project.manualTokenKey ?? '',
          monitors: [monitor]
        })
      }
    }

    if (groups.size === 0) {
      // nothing to resolve — stamp what we know
      if (projectMeta && !project.teamName) {
        await deps.monitorStore.upsertProject({
          project: {
            ...project,
            teamId: projectMeta.teamId,
            teamName: projectMeta.teamName,
            selfUserId: projectMeta.userId ?? project.selfUserId,
            clientName:
              projectMeta.userName && project.clientName === projectMeta.userName
                ? projectMeta.teamName
                : project.clientName
          }
        })
        result.stamped += 1
        result.notes.push(`stamped “${project.name}” → ${projectMeta.teamName}`)
      } else {
        result.untouched += 1
      }
      continue
    }

    if (groups.size === 1) {
      const only = [...groups.values()][0]
      if (!only.teamId || only.teamId === 'manual') {
        // workspace could not be resolved — leave the legacy card alone
        result.untouched += 1
        result.notes.push(`skipped “${project.name}” — workspace unknown`)
        continue
      }
      const selfUserId = projectMeta?.userId ?? project.selfUserId
      await deps.monitorStore.upsertProject({
        project: {
          ...project,
          teamId: only.teamId,
          teamName: only.teamName,
          selfUserId,
          // the client name used to be auto-filled with the token owner —
          // replace it with the workspace when it was never edited
          clientName:
            projectMeta?.userName && project.clientName === projectMeta.userName
              ? only.teamName
              : project.clientName
        }
      })
      result.stamped += 1
      result.notes.push(`stamped “${project.name}” → ${only.teamName}`)
      continue
    }

    // mixed card → one clean card per workspace
    const ordered = [...groups.values()].filter((g) => g.teamId && g.teamId !== 'manual')
    if (ordered.length === 0) {
      result.untouched += 1
      result.notes.push(`skipped “${project.name}” — workspace unknown`)
      continue
    }
    ordered.sort((a, b) => {
      const aOwn = a.key && a.key === project.manualTokenKey ? 0 : 1
      const bOwn = b.key && b.key === project.manualTokenKey ? 0 : 1
      return aOwn - bOwn
    })
    for (const group of ordered) {
      const isPrimary = group.key && group.key === project.manualTokenKey
      const fresh: Omit<DashboardProject, 'id' | 'createdAt'> = {
        name: isPrimary ? project.name : `${project.name} (${group.teamName})`,
        clientName: isPrimary ? project.clientName : group.teamName,
        profileId: `manual:${group.key}`,
        teamId: group.teamId,
        teamName: group.teamName,
        selfUserId: metaByKey.get(group.key)?.userId ?? project.selfUserId,
        appId: project.appId,
        tokenSource: project.tokenSource,
        manualTokenKey: group.key || undefined,
        monitors: group.monitors,
        startDate: project.startDate,
        endDate: project.endDate,
        manualCompletion: project.manualCompletion
      }
      await deps.monitorStore.upsertProject({ project: fresh })
    }
    await deps.monitorStore.deleteProject(project.id)
    result.split += 1
    result.notes.push(
      `split “${project.name}” into ${ordered.length} cards (${ordered
        .map((g) => g.teamName)
        .join(', ')})`
    )
  }

  return result
}
