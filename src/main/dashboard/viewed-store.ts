/**
 * When the owner last looked at a card's Dashboard page. Only a timestamp per
 * project: "new since your last visit" needs nothing else, and no message data
 * is duplicated here.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface ViewsFile {
  views: Record<string, string>
}

export class DashboardViewedStore {
  private readonly filePath: string
  private queue: Promise<void> = Promise.resolve()

  constructor(options: { rootDir: string }) {
    this.filePath = join(options.rootDir, 'views.json')
  }

  async get(projectId: string): Promise<string | null> {
    const views = (await this.read()).views
    const iso = views[projectId]
    return typeof iso === 'string' && Number.isFinite(new Date(iso).getTime()) ? iso : null
  }

  async markViewed(projectId: string, atIso?: string): Promise<string> {
    const at = atIso ?? new Date().toISOString()
    await this.mutate((current) => ({
      views: { ...current.views, [projectId]: at }
    }))
    return at
  }

  async clear(projectId: string): Promise<void> {
    await this.mutate((current) => {
      const views = { ...current.views }
      delete views[projectId]
      return { views }
    })
  }

  private async mutate(fn: (current: ViewsFile) => ViewsFile): Promise<void> {
    const run = async (): Promise<void> => {
      const next = fn(await this.read())
      await mkdir(join(this.filePath, '..'), { recursive: true })
      const tmp = `${this.filePath}.tmp`
      await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
      await rename(tmp, this.filePath)
    }
    this.queue = this.queue.then(run, run)
    return this.queue
  }

  private async read(): Promise<ViewsFile> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as ViewsFile
      if (!parsed || typeof parsed !== 'object' || typeof parsed.views !== 'object') {
        return { views: {} }
      }
      return { views: parsed.views ?? {} }
    } catch {
      return { views: {} }
    }
  }
}
