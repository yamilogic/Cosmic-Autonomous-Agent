/** Insight history per project (v2.2): every LLM refresh appends a snapshot,
 * so the dashboard "remembers" how the project evolved over time.
 * File: <dashboardRoot>/history/<projectId>.json — reads/writes additive. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectInsight, InsightHistoryEntryContract } from '../../shared/dashboard-contract'

export interface InsightHistoryEntry extends InsightHistoryEntryContract {
  atIso: string
  /** messages pulled into this refresh */
  newMessageCount: number
  insight: ProjectInsight
}

const MAX_ENTRIES = 200

export class HistoryStore {
  private readonly rootDir: string

  constructor(options: { rootDir: string }) {
    this.rootDir = join(options.rootDir, 'history')
  }

  private filePath(projectId: string): string {
    // project ids are app-generated slugs; keep path safety anyway
    const safe = projectId.replace(/[^A-Za-z0-9_-]/g, '_')
    return join(this.rootDir, `${safe}.json`)
  }

  async read(projectId: string): Promise<InsightHistoryEntry[]> {
    try {
      const raw = await readFile(this.filePath(projectId), 'utf8')
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? (parsed as InsightHistoryEntry[]) : []
    } catch {
      return []
    }
  }

  async append(projectId: string, entry: InsightHistoryEntry): Promise<InsightHistoryEntry[]> {
    const list = await this.read(projectId)
    list.unshift(entry)
    if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES
    await this.write(projectId, list)
    return list
  }

  async clear(projectId: string): Promise<void> {
    await this.write(projectId, [])
  }

  private async write(projectId: string, list: InsightHistoryEntry[]): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    const path = this.filePath(projectId)
    const tmp = `${path}.tmp`
    await writeFile(tmp, JSON.stringify(list, null, 2), 'utf8')
    await rename(tmp, path)
  }
}
