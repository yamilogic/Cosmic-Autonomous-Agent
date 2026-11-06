import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigService } from '../../src/main/dashboard/config-service'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import { WorkspaceMappingStore } from '../../src/main/dashboard/workspace-mapping-store'
import type { DashboardProject, ProjectSource } from '../../src/shared/dashboard-contract'

describe('Project Sources Model & Migration (SLK-1)', () => {
  let dir: string
  let monitorStore: MonitorStore
  let mappingStore: WorkspaceMappingStore
  let configService: ConfigService

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orbit-project-sources-'))
    monitorStore = new MonitorStore({ rootDir: dir, encryptionAvailable: false })
    mappingStore = new WorkspaceMappingStore({ rootDir: dir })

    configService = new ConfigService({
      aiSettings: {
        resolveSettings: async () => ({
          activeProvider: 'nvidia',
          activeModel: 'nemotron',
          activeEmbeddingModel: 'embedqa',
          isOverridden: false,
          effectiveKeyMasked: '••••',
          hasKey: true
        })
      } as any,
      teamWorkspace: {
        getConnection: async () => null
      } as any,
      monitorStore,
      workspaceMapping: mappingStore,
      oauthTokenProvider: {
        tryGet: async () => null
      }
    })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('normalizes legacy projects without sources to empty array and token_first preference', async () => {
    const legacyProject: DashboardProject = {
      id: 'proj_legacy_1',
      name: 'Legacy Project',
      clientName: 'Legacy Client',
      profileId: 'prof_1',
      teamId: 'T12345',
      teamName: 'Acme Corp',
      appId: 'slack',
      tokenSource: 'oauth',
      monitors: [{ channelId: 'C111', channelName: 'general' }],
      createdAt: new Date().toISOString()
    }

    await writeFile(
      join(dir, 'monitors.json'),
      JSON.stringify({ projects: [legacyProject], manualTokens: {} }, null, 2)
    )

    const list = await monitorStore.listProjects()
    expect(list).toHaveLength(1)
    expect(list[0]!.sources).toEqual([])
    expect(list[0]!.sourcePreference).toBe('token_first')

    const resolved = await configService.resolveSettings('proj_legacy_1')
    expect(resolved.client.sources).toEqual([])
    expect(resolved.client.sourcePreference).toBe('token_first')
  })

  it('upserts a project with browser source and stores multi-source configuration', async () => {
    const browserSource: ProjectSource = {
      id: 'src_browser_1',
      kind: 'browser',
      platform: 'slack',
      profileId: 'prof_google_1',
      workspaceId: 'T_BROWSER_99',
      workspaceName: 'Browser Workspace',
      channels: [{ id: 'C_DEV', name: 'dev' }],
      role: 'client',
      enabled: true,
      backfillDays: 7,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    const created = await monitorStore.upsertProject({
      project: {
        id: 'proj_browser_1',
        name: 'Browser Automated Project',
        clientName: 'Modern Client',
        profileId: 'prof_google_1',
        teamId: 'T_BROWSER_99',
        teamName: 'Browser Workspace',
        appId: 'slack',
        tokenSource: 'oauth',
        monitors: [],
        sources: [browserSource],
        sourcePreference: 'browser_only'
      }
    })

    expect(created.sources).toHaveLength(1)
    expect(created.sources![0]!.id).toBe('src_browser_1')
    expect(created.sources![0]!.kind).toBe('browser')
    expect(created.sourcePreference).toBe('browser_only')

    const resolved = await configService.resolveSettings('proj_browser_1')
    expect(resolved.client.sources).toHaveLength(1)
    expect(resolved.client.sources![0]!.workspaceId).toBe('T_BROWSER_99')
    expect(resolved.client.sourcePreference).toBe('browser_only')
  })

  it('keeps multi-source project data isolated between projects', async () => {
    const sourceA: ProjectSource = {
      id: 'src_A',
      kind: 'browser',
      platform: 'slack',
      workspaceId: 'T_A',
      workspaceName: 'Workspace A',
      channels: [{ id: 'C_A', name: 'general-a' }],
      role: 'client',
      enabled: true,
      backfillDays: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    const sourceB: ProjectSource = {
      id: 'src_B',
      kind: 'browser',
      platform: 'slack',
      workspaceId: 'T_B',
      workspaceName: 'Workspace B',
      channels: [{ id: 'C_B', name: 'general-b' }],
      role: 'client',
      enabled: true,
      backfillDays: 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    await monitorStore.upsertProject({
      project: {
        id: 'proj_A',
        name: 'Project A',
        clientName: 'Client A',
        profileId: 'prof_1',
        teamId: 'T_A',
        teamName: 'Workspace A',
        appId: 'slack',
        tokenSource: 'oauth',
        monitors: [],
        sources: [sourceA]
      }
    })

    await monitorStore.upsertProject({
      project: {
        id: 'proj_B',
        name: 'Project B',
        clientName: 'Client B',
        profileId: 'prof_2',
        teamId: 'T_B',
        teamName: 'Workspace B',
        appId: 'slack',
        tokenSource: 'oauth',
        monitors: [],
        sources: [sourceB]
      }
    })

    const resolvedA = await configService.resolveSettings('proj_A')
    const resolvedB = await configService.resolveSettings('proj_B')

    expect(resolvedA.client.sources).toHaveLength(1)
    expect(resolvedA.client.sources![0]!.workspaceName).toBe('Workspace A')

    expect(resolvedB.client.sources).toHaveLength(1)
    expect(resolvedB.client.sources![0]!.workspaceName).toBe('Workspace B')
  })
})
