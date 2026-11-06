import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AiSettingsStore } from '../../src/main/dashboard/ai-settings-store'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import { TeamWorkspaceStore } from '../../src/main/dashboard/team-workspace-store'

const vault = {
  encrypt: (plain: string): string => Buffer.from(plain, 'utf8').toString('base64'),
  decrypt: (b64: string): string => Buffer.from(b64, 'base64').toString('utf8')
}

const dirs: string[] = []

async function dir(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), 'orbit-d7-'))
  dirs.push(made)
  return made
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})))
  dirs.length = 0
})

/** The shape the three vault files are asserted against, so no `any` is needed. */
type VaultFile = {
  manualTokens?: Record<string, string>
  workspace?: {
    tokenPlain?: string
    tokenEnc?: string
    status?: string
    channels?: unknown[]
  }
  global?: { apiKeyPlain?: string; apiKeyEnc?: string }
  projects?: Record<string, { apiKeyPlain?: string; apiKeyEnc?: string }>
}

async function readJson(path: string): Promise<VaultFile> {
  return JSON.parse(await readFile(path, 'utf8')) as VaultFile
}

describe('D7 — a secret is never left readable on disk', () => {
  it('blocks the whole manual-token save: no metadata is stored either', async () => {
    const root = await dir()
    const store = new MonitorStore({ rootDir: root, encryptionAvailable: false })
    await expect(
      store.saveManualToken('K', 'xoxp-123456', { teamId: 'T1', teamName: 'Ws' })
    ).rejects.toThrow('OS encryption unavailable')
    expect(await store.getManualToken('K')).toBeNull()
    expect(await store.getManualTokenMeta('K')).toBeNull()
  })

  it('re-encrypts a legacy plaintext Slack token and is idempotent', async () => {
    const root = await dir()
    const file = join(root, 'monitors.json')
    await writeFile(
      file,
      JSON.stringify({ projects: [], manualTokens: { K: 'xoxp-legacy123' } }),
      'utf8'
    )
    const store = new MonitorStore({ rootDir: root, encryptionAvailable: true, vault })

    expect(await store.migrateLegacyPlaintext()).toBe(1)
    const onDisk = await readJson(file)
    expect(onDisk.manualTokens?.K).not.toBe('xoxp-legacy123')
    expect(JSON.stringify(onDisk)).not.toContain('xoxp-legacy123')
    expect(await store.getManualToken('K')).toBe('xoxp-legacy123')
    expect(await store.migrateLegacyPlaintext()).toBe(0)
  })

  it('re-encrypts a legacy plaintext team workspace token, keeping the rest of the record', async () => {
    const root = await dir()
    const file = join(root, 'team-workspace.json')
    await writeFile(
      file,
      JSON.stringify({
        workspace: {
          profileId: 'manual:T1',
          teamId: 'T1',
          teamName: 'Our Team',
          source: 'manual',
          tokenPlain: 'xoxp-team-legacy',
          maskedToken: '••••gacy',
          status: 'needs-reconnect',
          channels: [{ channelId: 'C1', channelName: 'general' }],
          updatedAt: '2026-10-01T00:00:00.000Z'
        }
      }),
      'utf8'
    )
    const store = new TeamWorkspaceStore({ rootDir: root, encryptionAvailable: true, vault })

    expect(await store.migrateLegacyPlaintext()).toBe(1)
    const onDisk = await readJson(file)
    expect(onDisk.workspace?.tokenPlain).toBeUndefined()
    expect(onDisk.workspace?.tokenEnc).toBe(
      Buffer.from('xoxp-team-legacy', 'utf8').toString('base64')
    )
    expect(onDisk.workspace?.status).toBe('needs-reconnect')
    expect(onDisk.workspace?.channels).toHaveLength(1)
    const connection = await store.getConnection()
    expect(connection?.token).toBe('xoxp-team-legacy')
    expect(await store.migrateLegacyPlaintext()).toBe(0)
  })

  it('re-encrypts legacy plaintext api keys in the global and project records', async () => {
    const root = await dir()
    const file = join(root, 'ai-settings.json')
    await writeFile(
      file,
      JSON.stringify({
        global: { provider: 'nvidia-nim', apiKeyPlain: 'nvapi-global-legacy' },
        projects: { p1: { apiKeyPlain: 'nvapi-project-legacy' } }
      }),
      'utf8'
    )
    const store = new AiSettingsStore({ rootDir: root, encryptionAvailable: true, vault })

    expect(await store.migrateLegacyPlaintext()).toBe(2)
    const onDisk = await readJson(file)
    expect(JSON.stringify(onDisk)).not.toContain('nvapi-global-legacy')
    expect(JSON.stringify(onDisk)).not.toContain('nvapi-project-legacy')
    expect(await store.readKey(await store.readGlobal())).toBe('nvapi-global-legacy')
    expect(await store.readKey(await store.readProject('p1'))).toBe('nvapi-project-legacy')
  })

  it('writes nothing while the OS vault is unavailable', async () => {
    const root = await dir()
    const file = join(root, 'ai-settings.json')
    await writeFile(
      file,
      JSON.stringify({ global: { apiKeyPlain: 'nvapi-global-legacy' }, projects: {} }),
      'utf8'
    )
    const before = await readFile(file, 'utf8')
    const store = new AiSettingsStore({ rootDir: root, encryptionAvailable: false })

    expect(await store.migrateLegacyPlaintext()).toBe(0)
    expect(await readFile(file, 'utf8')).toBe(before)
  })
})
