import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceMappingStore } from '../../src/main/dashboard/workspace-mapping-store'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true }).catch(() => {})))
  dirs.length = 0
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dash-mapping-'))
  dirs.push(root)
  return new WorkspaceMappingStore({ rootDir: root })
}

describe('WorkspaceMappingStore', () => {
  it('saves and loads a mapping', async () => {
    const store = await harness()
    await store.saveMapping('ws1', ['p1', 'p2'])
    const mapping = await store.getMapping('ws1')
    expect(mapping).toEqual(['p1', 'p2'])

    const all = await store.listMappings()
    expect(all).toHaveLength(1)
    expect(all[0].workspaceId).toBe('ws1')
    expect(all[0].projectIds).toEqual(['p1', 'p2'])
    expect(all[0].updatedAt).toBeDefined()
  })

  it('supports one workspace mapped to multiple cards', async () => {
    const store = await harness()
    await store.saveMapping('ws1', ['p1', 'p2', 'p3'])
    const mapping = await store.getMapping('ws1')
    expect(mapping).toHaveLength(3)
    expect(mapping).toContain('p1')
    expect(mapping).toContain('p2')
    expect(mapping).toContain('p3')
  })

  it('supports one card mapped to one workspace', async () => {
    const store = await harness()
    await store.saveMapping('ws1', ['p1'])
    await store.saveMapping('ws2', ['p1'])
    // getWorkspaceForProject returns the first workspace found for a project
    expect(await store.getWorkspaceForProject('p1')).toBe('ws1')
  })

  it('getWorkspaceForProject returns null when unmapped', async () => {
    const store = await harness()
    expect(await store.getWorkspaceForProject('p999')).toBeNull()
  })

  it('deletes a mapping', async () => {
    const store = await harness()
    await store.saveMapping('ws1', ['p1'])
    expect(await store.getMapping('ws1')).toEqual(['p1'])
    const deleted = await store.deleteMapping('ws1')
    expect(deleted).toBe(true)
    expect(await store.getMapping('ws1')).toBeNull()
  })

  it('deleteMapping returns false for unknown workspace', async () => {
    const store = await harness()
    const deleted = await store.deleteMapping('nonexistent')
    expect(deleted).toBe(false)
  })

  it('cleanupDeletedProjects removes dropped project IDs', async () => {
    const store = await harness()
    await store.saveMapping('ws1', ['p1', 'p2', 'p3'])
    await store.cleanupDeletedProjects(['p1', 'p2'])
    const mapping = await store.getMapping('ws1')
    expect(mapping).toEqual(['p1', 'p2'])
  })

  it('cleanupDeletedProjects removes workspaces with no remaining projects', async () => {
    const store = await harness()
    await store.saveMapping('ws1', ['p1'])
    await store.cleanupDeletedProjects(['p2'])
    expect(await store.getMapping('ws1')).toBeNull()
  })

  it('saveMapping drops unknown project IDs when valid list provided', async () => {
    const store = await harness()
    await store.saveMapping('ws1', ['p1', 'p2', 'p999'], ['p1', 'p2'])
    const mapping = await store.getMapping('ws1')
    expect(mapping).toEqual(['p1', 'p2'])
  })

  it('syncProjectWorkspaces adds and removes project mappings across workspaces', async () => {
    const store = await harness()
    await store.saveMapping('ws1', ['p1', 'p2'])
    await store.saveMapping('ws2', ['p1'])
    // p1 now only belongs to ws2 and ws3
    await store.syncProjectWorkspaces('p1', new Set(['ws2', 'ws3']))
    expect(await store.getMapping('ws1')).toEqual(['p2'])
    expect(await store.getMapping('ws2')).toEqual(['p1'])
    expect(await store.getMapping('ws3')).toEqual(['p1'])

    // p1 removed from all
    await store.syncProjectWorkspaces('p1', new Set())
    expect(await store.getMapping('ws1')).toEqual(['p2'])
    expect(await store.getMapping('ws2')).toBeNull()
    expect(await store.getMapping('ws3')).toBeNull()
  })

  it('returns empty list when no mappings', async () => {
    const store = await harness()
    expect(await store.listMappings()).toEqual([])
    expect(await store.getMapping('ws1')).toBeNull()
  })
})