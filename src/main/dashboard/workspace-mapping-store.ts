import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { log } from '../logging'

export interface WorkspaceMapping {
  workspaceId: string
  projectIds: string[]
  updatedAt: string
}

interface MappingFile {
  mappings: Record<string, string[]>
  updatedAt?: string
}

export class WorkspaceMappingStore {
  private readonly filePath: string
  private queue: Promise<void> = Promise.resolve()

  constructor(options: { rootDir: string }) {
    this.filePath = join(options.rootDir, 'workspace-mappings.json')
  }

  /** All mappings, newest first. */
  async listMappings(): Promise<WorkspaceMapping[]> {
    const data = await this.read()
    return Object.entries(data.mappings)
      .map(([workspaceId, projectIds]) => ({
        workspaceId,
        projectIds: [...projectIds],
        updatedAt: data.updatedAt ?? ''
      }))
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
  }

  /** Project IDs mapped to a workspace. */
  async getMapping(workspaceId: string): Promise<string[] | null> {
    const data = await this.read()
    return data.mappings[workspaceId] ?? null
  }

  /** Reverse lookup: which workspace is a project mapped to? */
  async getWorkspaceForProject(projectId: string): Promise<string | null> {
    const data = await this.read()
    for (const [workspaceId, projectIds] of Object.entries(data.mappings)) {
      if (projectIds.includes(projectId)) return workspaceId
    }
    return null
  }

  /** Save a mapping. Deleted/unknown project IDs are dropped automatically. */
  async saveMapping(
    workspaceId: string,
    projectIds: string[],
    validProjectIds?: string[]
  ): Promise<void> {
    const valid = validProjectIds ?? []
    const clean = projectIds.filter((id) => valid.length === 0 || valid.includes(id))
    await this.mutate((current) => {
      current.mappings[workspaceId] = clean
      return current
    })
    log.info('workspace mapping saved', { workspaceId, projectIds: clean })
  }

  /** Remove a mapping entirely. */
  async deleteMapping(workspaceId: string): Promise<boolean> {
    let removed = false
    await this.mutate((current) => {
      if (current.mappings[workspaceId] === undefined) return current
      removed = true
      const { [workspaceId]: _removed, ...rest } = current.mappings
      return { ...current, mappings: rest }
    })
    return removed
  }

  /** Remove a project from all workspaces except the specified set. */
  async syncProjectWorkspaces(projectId: string, activeWorkspaceIds: Set<string>): Promise<void> {
    await this.mutate((current) => {
      const next: Record<string, string[]> = {}
      for (const [wsId, pIds] of Object.entries(current.mappings)) {
        if (activeWorkspaceIds.has(wsId)) {
          if (!pIds.includes(projectId)) {
            next[wsId] = [...pIds, projectId]
          } else {
            next[wsId] = pIds
          }
        } else {
          const filtered = pIds.filter((id) => id !== projectId)
          if (filtered.length > 0) {
            next[wsId] = filtered
          }
        }
      }
      for (const wsId of activeWorkspaceIds) {
        if (!next[wsId]) {
          next[wsId] = [projectId]
        } else if (!next[wsId].includes(projectId)) {
          next[wsId] = [...next[wsId], projectId]
        }
      }
      return { ...current, mappings: next }
    })
  }

  /** Drop project IDs that no longer exist from all mappings. */
  async cleanupDeletedProjects(validProjectIds: string[]): Promise<void> {
    const validSet = new Set(validProjectIds)
    let changed = false
    await this.mutate((current) => {
      const next: Record<string, string[]> = {}
      for (const [workspaceId, projectIds] of Object.entries(current.mappings)) {
        const filtered = projectIds.filter((id) => validSet.has(id))
        if (filtered.length !== projectIds.length) changed = true
        if (filtered.length > 0) next[workspaceId] = filtered
      }
      return { ...current, mappings: next }
    })
    if (changed) log.info('cleaned up deleted project IDs from mappings')
  }

  private async read(): Promise<MappingFile> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<MappingFile>
      return {
        mappings: parsed.mappings ?? {},
        updatedAt: parsed.updatedAt
      }
    } catch {
      return { mappings: {} }
    }
  }

  private async mutate(
    fn: (current: MappingFile) => MappingFile
  ): Promise<void> {
    const run = async (): Promise<void> => {
      const current = await this.read()
      const next = fn(current)
      next.updatedAt = new Date().toISOString()
      await mkdir(join(this.filePath, '..'), { recursive: true })
      const tmpPath = `${this.filePath}.tmp`
      await writeFile(tmpPath, JSON.stringify(next, null, 2), 'utf8')
      await rename(tmpPath, this.filePath)
    }
    this.queue = this.queue.then(run, run)
    return this.queue
  }
}