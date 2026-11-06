import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import type { ProjectSidebarState, SidebarState } from '../../shared/dashboard-contract'

function defaultSidebarState(): SidebarState {
  return { collapsed: false, width: 290, openSection: 1 }
}

function defaultProjectSidebarState(): ProjectSidebarState {
  return { left: defaultSidebarState(), right: defaultSidebarState() }
}

export function sidebarStateFilePath(userData: string): string {
  return join(userData, 'dashboard-sidebar-state.json')
}

export class DashboardSidebarStateStore {
  private readonly filePath: string
  private writeChain: Promise<void> = Promise.resolve()
  private cache: Record<string, ProjectSidebarState> = {}

  constructor(userData: string) {
    this.filePath = sidebarStateFilePath(userData)
  }

  private async load(): Promise<void> {
    if (Object.keys(this.cache).length > 0) return
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, ProjectSidebarState>
      this.cache = parsed
    } catch {
      this.cache = {}
    }
  }

  private async persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(dirname(this.filePath), { recursive: true })
      await fs.writeFile(this.filePath, JSON.stringify(this.cache, null, 2), 'utf8')
    })
    await this.writeChain
  }

  async get(projectId: string): Promise<ProjectSidebarState> {
    await this.load()
    const raw = this.cache[projectId]
    if (!raw || typeof raw !== 'object') return defaultProjectSidebarState()
    const validate = (s: any): SidebarState => {
      if (!s || typeof s !== 'object') return defaultSidebarState()
      return {
        collapsed: typeof s.collapsed === 'boolean' ? s.collapsed : false,
        width: typeof s.width === 'number' && s.width >= 240 && s.width <= 420 ? s.width : 290,
        openSection: typeof s.openSection === 'number' || s.openSection === null ? s.openSection : 1
      }
    }
    return {
      left: validate(raw.left),
      right: validate(raw.right)
    }
  }

  async set(projectId: string, state: ProjectSidebarState): Promise<void> {
    await this.load()
    this.cache[projectId] = state
    await this.persist()
  }

  async updateLeft(projectId: string, patch: Partial<SidebarState>): Promise<SidebarState> {
    const current = await this.get(projectId)
    const next = { ...current.left, ...patch }
    await this.set(projectId, { ...current, left: next })
    return next
  }

  async updateRight(projectId: string, patch: Partial<SidebarState>): Promise<SidebarState> {
    const current = await this.get(projectId)
    const next = { ...current.right, ...patch }
    await this.set(projectId, { ...current, right: next })
    return next
  }

  async delete(projectId: string): Promise<void> {
    await this.load()
    delete this.cache[projectId]
    await this.persist()
  }
}