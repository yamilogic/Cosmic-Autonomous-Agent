const fakeVault = { encrypt: (p: string) => Buffer.from(p).toString('base64'), decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8') }
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AiSettingsStore } from '../../src/main/dashboard/ai-settings-store'
import { migrateConfigV1 } from '../../src/main/dashboard/config-migration'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true }).catch(() => {})))
  dirs.length = 0
})

async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-config-migrate-'))
  dirs.push(dir)
  return dir
}

describe('migrateConfigV1', () => {
  it('seeds the global key/model from env once and backs up old files', async () => {
    const root = await tmpRoot()
    await writeFile(join(root, 'ai-settings.json'), JSON.stringify({ global: {}, projects: {} }))
    const store = new AiSettingsStore({ rootDir: root, encryptionAvailable: true, vault: fakeVault })

    const result = await migrateConfigV1({
      rootDir: root,
      aiSettingsStore: store,
      env: {
        nvidiaApiKey: 'env-key-9999',
        nvidiaChatModel: 'env/chat',
        nvidiaEmbeddingModel: 'env/embed'
      },
      now: '2026-10-25T10:00:00.000Z'
    })

    expect(result.migrated).toBe(true)
    expect(result.seededGlobalAi).toBe(true)
    expect(result.backupDir).toBeTruthy()
    expect(await readFile(join(result.backupDir!, 'ai-settings.json'), 'utf8')).toContain(
      '"global"'
    )

    const global = await store.readGlobal()
    expect(global.chatModel).toBe('env/chat')
    expect(global.embeddingModel).toBe('env/embed')
    expect(await store.readKey(global)).toBe('env-key-9999')
  })

  it('is idempotent and never overwrites a saved global key', async () => {
    const root = await tmpRoot()
    const store = new AiSettingsStore({ rootDir: root, encryptionAvailable: true, vault: fakeVault })
    await store.saveGlobal({ apiKey: 'saved-key-1111', model: 'saved/chat' })

    const first = await migrateConfigV1({
      rootDir: root,
      aiSettingsStore: store,
      env: { nvidiaApiKey: 'env-key-9999', nvidiaChatModel: 'env/chat' }
    })
    expect(first.seededGlobalAi).toBe(false)

    const second = await migrateConfigV1({
      rootDir: root,
      aiSettingsStore: store,
      env: { nvidiaApiKey: 'other-key-2222', nvidiaChatModel: 'other/chat' }
    })
    expect(second.migrated).toBe(false)

    const global = await store.readGlobal()
    expect(global.chatModel).toBe('saved/chat')
    expect(await store.readKey(global)).toBe('saved-key-1111')
    expect(await readdir(root)).toContain('config-migration-v1.json')
  })
})
