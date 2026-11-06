const fakeVault = { encrypt: (p: string) => Buffer.from(p).toString('base64'), decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8') }
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { maskKey, AiSettingsStore } from '../../src/main/dashboard/ai-settings-store'
import { AiSettingsService } from '../../src/main/dashboard/ai-settings'

const dirs: string[] = []

async function tmpStore(): Promise<AiSettingsStore> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-ai-settings-'))
  dirs.push(dir)
  return new AiSettingsStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
}

function makeService(store: AiSettingsStore): AiSettingsService {
  return new AiSettingsService({
    store,
    defaults: {
      chatModel: 'default/chat',
      embeddingModel: 'default/embed'
    }
  })
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true }).catch(() => {})))
  dirs.length = 0
})

describe('maskKey', () => {
  it('never exposes more than the last four characters', () => {
    expect(maskKey(null)).toBeNull()
    expect(maskKey('')).toBeNull()
    expect(maskKey('short')).toBe('••••')
    expect(maskKey('nvapi-abcdefgh1234')).toBe('••••1234')
  })
})

describe('AiSettingsStore', () => {
  it('stores global and per-project records separately', async () => {
    const store = await tmpStore()
    await store.saveGlobal({ model: 'global-model' })
    await store.saveProject('p1', { model: 'project-model' })

    expect((await store.readGlobal()).model).toBe('global-model')
    expect((await store.readProject('p1'))?.model).toBe('project-model')
    expect(await store.readProject('p2')).toBeNull()
  })

  it('turns useGlobal off when a project key or model is saved, unless set explicitly', async () => {
    const store = await tmpStore()
    await store.saveProject('p1', { model: 'm1' })
    expect((await store.readProject('p1'))?.useGlobal).toBe(false)

    await store.saveProject('p2', { useGlobal: true, model: 'm2' })
    expect((await store.readProject('p2'))?.useGlobal).toBe(true)
  })

  it('blocks api key save when OS encryption unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-'))
    const store = new AiSettingsStore({ rootDir: dir, encryptionAvailable: false })
    const service = new AiSettingsService({ store, defaults: { chatModel: 'default/chat' } })
    await expect(service.save({ apiKey: 'secret' })).rejects.toThrow('OS encryption unavailable')
  })

  it('keeps values on undefined and clears them on null', async () => {
    const store = await tmpStore()
    await store.saveProject('p1', { model: 'm1', apiKey: 'project-key-1234' })

    await store.saveProject('p1', { provider: 'nvidia-nim' })
    let record = await store.readProject('p1')
    expect(record?.model).toBe('m1')
    expect(await store.readKey(record)).toBe('project-key-1234')

    await store.saveProject('p1', { model: null, apiKey: null })
    record = await store.readProject('p1')
    expect(record?.model).toBeUndefined()
    expect(await store.readKey(record)).toBeNull()
  })

  it('clearProject removes every override for one project', async () => {
    const store = await tmpStore()
    await store.saveProject('p1', { apiKey: 'key-1111' })
    await store.clearProject('p1')
    expect(await store.readProject('p1')).toBeNull()
  })
})

describe('AiSettingsService.resolveSettings', () => {
  it('prefers the project, then global, then built-in defaults', async () => {
    const store = await tmpStore()
    const service = makeService(store)

    let resolved = await service.resolveSettings('p1')
    expect(resolved.apiKey).toBeNull()
    expect(resolved.chatModel).toBe('default/chat')
    expect(resolved.embeddingModel).toBe('default/embed')
    expect(resolved.keySource).toBe('none')
    expect(resolved.chatModelSource).toBe('default')

    await store.saveGlobal({ apiKey: 'global-key-2222', model: 'global-model' })
    resolved = await service.resolveSettings('p1')
    expect(resolved.apiKey).toBe('global-key-2222')
    expect(resolved.chatModel).toBe('global-model')
    expect(resolved.keySource).toBe('global')
    expect(resolved.chatModelSource).toBe('global')

    await service.save({ projectId: 'p1', model: 'project-model', apiKey: 'project-key-3333' })
    resolved = await service.resolveSettings('p1')
    expect(resolved.apiKey).toBe('project-key-3333')
    expect(resolved.chatModel).toBe('project-model')
    expect(resolved.keySource).toBe('project')
    expect(resolved.chatModelSource).toBe('project')
  })

  it('ignores project overrides while useGlobal is on', async () => {
    const store = await tmpStore()
    const service = makeService(store)
    await store.saveGlobal({ model: 'global-model', apiKey: 'global-key-2222' })
    await store.saveProject('p1', {
      useGlobal: true,
      model: 'project-model',
      apiKey: 'project-key-3333'
    })

    const resolved = await service.resolveSettings('p1')
    expect(resolved.chatModel).toBe('global-model')
    expect(resolved.apiKey).toBe('global-key-2222')
    expect(resolved.chatModelSource).toBe('global')
    expect(resolved.keySource).toBe('global')
  })

  it('resolves chat and embedding overrides independently', async () => {
    const store = await tmpStore()
    const service = makeService(store)
    await store.saveGlobal({
      apiKey: 'global-key-2222',
      model: 'global-chat',
      embeddingModel: 'global-embed'
    })
    await service.save({
      projectId: 'p1',
      useGlobal: false,
      model: 'project-chat',
      embeddingModel: null
    })

    const resolved = await service.resolveSettings('p1')
    expect(resolved.apiKey).toBe('global-key-2222')
    expect(resolved.chatModel).toBe('project-chat')
    expect(resolved.embeddingModel).toBe('global-embed')
    expect(resolved.chatModelSource).toBe('project')
    expect(resolved.embeddingModelSource).toBe('global')
    expect(resolved.keySource).toBe('global')
  })

  it('returns no key when nothing is configured', async () => {
    const store = await tmpStore()
    const service = makeService(store)
    const resolved = await service.resolveSettings('missing')
    expect(resolved.apiKey).toBeNull()
    expect(resolved.keySource).toBe('none')
  })
})

describe('AiSettingsService.publicView', () => {
  it('masks every key and never serialises the raw value', async () => {
    const store = await tmpStore()
    const service = makeService(store)
    await service.save({ apiKey: 'global-key-2222', model: 'global-model' })
    await service.save({
      projectId: 'p1',
      useGlobal: false,
      apiKey: 'project-key-3333',
      model: 'project-model'
    })

    const view = await service.publicView('p1')
    expect(view.global.apiKeyMask).toBe('••••2222')
    expect(view.project?.apiKeyMask).toBe('••••3333')
    expect(view.effective.apiKeyMask).toBe('••••3333')

    const serialised = JSON.stringify(view)
    expect(serialised).not.toContain('global-key-2222')
    expect(serialised).not.toContain('project-key-3333')
  })

  it('reports useGlobal and the effective source for a project', async () => {
    const store = await tmpStore()
    const service = makeService(store)
    await service.save({ apiKey: 'global-key-2222', model: 'global-model' })

    const view = await service.publicView('p1')
    expect(view.project?.useGlobal).toBe(true)
    expect(view.effective.modelSource).toBe('global')
    expect(view.effective.keySource).toBe('global')
  })
})

describe('AiSettingsService.save — the Global Settings seam', () => {
  it('writes the single global record when no project is named', async () => {
    const store = await tmpStore()
    const service = makeService(store)

    await service.save({ provider: 'nvidia-nim', model: 'global/model', apiKey: 'global-key-2222' })

    expect((await store.readGlobal()).model).toBe('global/model')
    expect(await store.readKey(await store.readGlobal())).toBe('global-key-2222')
    // A global save must not create a project record.
    expect(await store.readProject('p1')).toBeNull()
  })

  it('rejects a provider it does not support', async () => {
    const service = makeService(await tmpStore())
    await expect(
      service.save({ provider: 'openai' as 'nvidia-nim', model: 'gpt-x' })
    ).rejects.toThrow(/provider/i)
  })

  it('rejects an API key or model id past the stored limits', async () => {
    const service = makeService(await tmpStore())
    await expect(service.save({ apiKey: 'k'.repeat(513) })).rejects.toThrow(/too long/i)
    await expect(service.save({ model: 'm'.repeat(201) })).rejects.toThrow(/too long/i)

    const store = await tmpStore()
    await new AiSettingsService({
      store,
      defaults: { chatModel: 'default/chat' }
    }).save({
      apiKey: 'k'.repeat(512)
    })
    expect(await store.readKey(await store.readGlobal())).toBe('k'.repeat(512))
  })

  it('answers a global save with masks only', async () => {
    const service = makeService(await tmpStore())
    const view = await service.save({ apiKey: 'global-key-2222', model: 'global/model' })

    expect(view.global.apiKeyMask).toBe('••••2222')
    expect(view.project).toBeNull()
    expect(JSON.stringify(view)).not.toContain('global-key-2222')
  })
})

describe('AiSettingsService.listModels', () => {
  it('returns an error when no key is configured anywhere', async () => {
    const store = await tmpStore()
    const service = new AiSettingsService({
      store,
      defaults: { chatModel: 'default/chat' }
    })
    const result = await service.listModels()
    expect(result.models).toEqual([])
    expect(result.embeddingModels).toEqual([])
    expect(result.source).toBe('none')
    expect(result.error).toBeTruthy()
  })

  it('loads models with the resolved key and de-duplicates them', async () => {
    const store = await tmpStore()
    const service = makeService(store)
    await store.saveGlobal({ apiKey: 'global-key-2222', model: 'global-model' })

    const oldFetch = globalThis.fetch
    let authHeader = ''
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      authHeader = String((init?.headers as Record<string, string>)?.Authorization ?? '')
      return new Response(
        JSON.stringify({ data: [{ id: 'model/b' }, { id: 'model/a' }, { id: 'model/a' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof fetch
    try {
      const result = await service.listModels()
      expect(result.models).toEqual(['model/a', 'model/b'])
      expect(result.source).toBe('global')
      expect(authHeader).toBe('Bearer global-key-2222')
    } finally {
      globalThis.fetch = oldFetch
    }
  })
})
