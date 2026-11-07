const fakeVault = { encrypt: (p: string) => Buffer.from(p).toString('base64'), decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8') }
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AiSettingsService } from '../../src/main/dashboard/ai-settings'
import { AiSettingsStore } from '../../src/main/dashboard/ai-settings-store'
import { ConfigService } from '../../src/main/dashboard/config-service'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import { TeamWorkspaceStore } from '../../src/main/dashboard/team-workspace-store'
import { WorkspaceMappingStore } from '../../src/main/dashboard/workspace-mapping-store'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true }).catch(() => {})))
  dirs.length = 0
})

async function harness(): Promise<{
  config: ConfigService
  ai: AiSettingsService
  monitor: MonitorStore
  team: TeamWorkspaceStore
  mapping: WorkspaceMappingStore
}> {
  const root = await mkdtemp(join(tmpdir(), 'dash-config-service-'))
  dirs.push(root)
  const aiStore = new AiSettingsStore({ rootDir: root, encryptionAvailable: true, vault: fakeVault })
  const ai = new AiSettingsService({
    store: aiStore,
    defaults: { chatModel: 'default/chat', embeddingModel: 'default/embed' }
  })
  const monitor = new MonitorStore({ rootDir: root, encryptionAvailable: true, vault: fakeVault })
  const team = new TeamWorkspaceStore({ rootDir: root, encryptionAvailable: true, vault: fakeVault })
  const mapping = new WorkspaceMappingStore({ rootDir: root })
  const config = new ConfigService({
    aiSettings: ai,
    teamWorkspace: team,
    monitorStore: monitor,
    workspaceMapping: mapping,
    oauthTokenProvider: { tryGet: async () => null }
  })
  return { config, ai, monitor, team, mapping }
}

async function seedProject(monitor: MonitorStore, id: string): Promise<void> {
  await monitor.saveManualToken(`client-${id}`, 'xoxb-client-1111', {
    teamId: 'T_CLIENT',
    teamName: 'Client Workspace'
  })
  await monitor.upsertProject({
    project: {
      id,
      name: 'Acme',
      clientName: 'Acme',
      profileId: 'manual:T_CLIENT',
      teamId: 'T_CLIENT',
      appId: 'slack',
      tokenSource: 'manual',
      manualTokenKey: `client-${id}`,
      teamName: 'Client Workspace',
      monitors: [{ channelId: 'C_CLIENT', channelName: 'client' }]
    }
  })
}

describe('ConfigService', () => {
  it('resolves the client, global Our Slack, and global AI', async () => {
    const { config, ai, monitor, team } = await harness()
    await seedProject(monitor, 'p1')
    await ai.save({
      apiKey: 'nvapi-global-2222',
      model: 'global/chat',
      embeddingModel: 'global/embed'
    })
    await team.connect({
      payload: { source: 'manual', token: 'xoxb-ours-9999' },
      profileId: 'manual:T_OURS',
      teamId: 'T_OURS',
      teamName: 'Our Team',
      token: 'xoxb-ours-9999',
      channels: [{ channelId: 'C_OURS', channelName: 'ours' }]
    })

    const resolved = await config.resolveSettings('p1')
    expect(resolved.client.token).toBe('xoxb-client-1111')
    expect(resolved.ourSlack.source).toBe('global')
    expect(resolved.ourSlack.token).toBe('xoxb-ours-9999')
    expect(resolved.ourSlack.channels).toEqual([{ channelId: 'C_OURS', channelName: 'ours' }])
    expect(resolved.ai.chatModel).toBe('global/chat')
    expect(resolved.ai.apiKey).toBe('nvapi-global-2222')
  })

  it('keeps the global key when only the chat model is overridden', async () => {
    const { config, ai, monitor } = await harness()
    await seedProject(monitor, 'p1')
    await ai.save({ apiKey: 'nvapi-global-2222', model: 'global/chat' })
    await ai.save({ projectId: 'p1', useGlobal: false, model: 'project/chat' })

    const resolved = await config.resolveSettings('p1')
    expect(resolved.ai.chatModel).toBe('project/chat')
    expect(resolved.ai.apiKey).toBe('nvapi-global-2222')
    expect(resolved.ai.chatModelSource).toBe('project')
    expect(resolved.ai.keySource).toBe('global')
  })

  it('reports not-configured without exposing raw secrets', async () => {
    const { config, monitor } = await harness()
    await seedProject(monitor, 'p1')

    const global = await config.publicGlobalConfig()
    expect(global.ourSlack.connected).toBe(false)
    expect(global.nvidia.configured).toBe(false)
    expect(global.nvidia.status).toBe('not-configured')
    expect(global.usage.projects).toBe(1)

    const resolved = await config.resolveSettings('p1')
    expect(resolved.ourSlack.source).toBe('none')
    expect(resolved.ourSlack.token).toBeNull()
    expect(resolved.ai.apiKey).toBeNull()

    const serialised = JSON.stringify(global)
    expect(serialised).not.toContain('xoxb-client-1111')
  })

  it('resolveSettings returns mappedWorkspaceId/null for unmapped project', async () => {
    const { config, monitor } = await harness()
    await seedProject(monitor, 'p1')
    const resolved = await config.resolveSettings('p1')
    expect(resolved.client.mappedWorkspaceId).toBeNull()
    expect(resolved.client.mappedWorkspaceName).toBeNull()
  })

  it('resolveSettings returns mappedWorkspaceId/name for mapped project', async () => {
    const { config, monitor, mapping } = await harness()
    await seedProject(monitor, 'p1')
    await mapping.saveMapping('T_CLIENT', ['p1'])
    const resolved = await config.resolveSettings('p1')
    expect(resolved.client.mappedWorkspaceId).toBe('T_CLIENT')
    expect(resolved.client.mappedWorkspaceName).toBe('Client Workspace')
  })

  it('badge count reflects mapped project count', async () => {
    const { monitor, mapping } = await harness()
    await seedProject(monitor, 'p1')
    await seedProject(monitor, 'p2')
    await mapping.saveMapping('T_CLIENT', ['p1', 'p2'])
    const all = await mapping.listMappings()
    expect(all[0].projectIds).toHaveLength(2)
    expect(all[0].projectIds).toContain('p1')
    expect(all[0].projectIds).toContain('p2')
  })

  it('card delete cleans up mapping via cleanupDeletedProjects', async () => {
    const { mapping } = await harness()
    await mapping.saveMapping('ws1', ['p1', 'p2'])
    // p1 is valid (kept), p2 is dropped
    await mapping.cleanupDeletedProjects(['p1'])
    const mappingAfter = await mapping.getMapping('ws1')
    expect(mappingAfter).toEqual(['p1'])
  })
})
