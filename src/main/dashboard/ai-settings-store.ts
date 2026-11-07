/** AI provider settings (v2.7): one dashboard-level record plus a per-project
 * override. API keys are encrypted with Electron safeStorage and are never
 * returned to the renderer — callers only ever see a masked tail.
 *
 * File: <dashboardRoot>/ai-settings.json — atomic temp+rename writes.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AiProviderId } from '../../shared/dashboard-contract'

export interface StoredAiSettings {
  provider?: AiProviderId
  /** Legacy chat-model field (pre-v2.8). New writes also set `chatModel`. */
  model?: string
  chatModel?: string
  embeddingModel?: string
  /** safeStorage ciphertext (base64). */
  apiKeyEnc?: string
  /** Plaintext fallback when OS encryption is unavailable (dev / tests). */
  apiKeyPlain?: string
  status?: 'ok' | 'invalid' | 'not-configured'
  lastVerifiedAt?: string
}

export interface StoredProjectAiSettings extends StoredAiSettings {
  /** Legacy coarse switch. true = ignore every project AI field. */
  useGlobal?: boolean
}

interface AiSettingsFile {
  global: StoredAiSettings
  projects: Record<string, StoredProjectAiSettings>
  updatedAt?: string
}

export interface AiSettingsPatch {
  provider?: AiProviderId
  /** null clears the override; undefined keeps it. */
  model?: string | null
  /** null clears the override; undefined keeps it. */
  embeddingModel?: string | null
  /** null clears the key; undefined keeps it. */
  apiKey?: string | null
  useGlobal?: boolean
}

interface EncryptedVault {
  encrypt(plain: string): string
  decrypt(b64: string): string
}

let vault: EncryptedVault | null = null

async function getVault(): Promise<EncryptedVault> {
  if (!vault) {
    const { safeStorage } = (await import('electron')) as typeof import('electron')
    vault = {
      encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
      decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64'))
    }
  }
  return vault
}

/** "nvapi-1234abcd" → "••••abcd". Short keys are fully hidden. */
export function maskKey(key: string | null | undefined): string | null {
  if (!key) return null
  if (key.length <= 8) return '••••'
  return `••••${key.slice(-4)}`
}

function cleanModel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function cleanKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/[\r\n]/g, '').trim()
  return trimmed ? trimmed : null
}

function normalizeRecord<T extends StoredAiSettings>(record: T): T {
  if (record.chatModel || !record.model) return record
  return { ...record, chatModel: record.model }
}

export class AiSettingsStore {
  private readonly filePath: string
  private readonly encryptionAvailable: boolean
  private queue: Promise<void> = Promise.resolve()

  private vaultOverride: EncryptedVault | null = null
  constructor(options: { rootDir: string; encryptionAvailable: boolean; vault?: EncryptedVault }) {
    this.filePath = join(options.rootDir, 'ai-settings.json')
    this.encryptionAvailable = options.encryptionAvailable
    this.vaultOverride = options.vault ?? null
  }
  private async activeVault(): Promise<EncryptedVault> {
    return this.vaultOverride ?? getVault()
  }

  async readGlobal(): Promise<StoredAiSettings> {
    return normalizeRecord((await this.read()).global)
  }

  async readProject(projectId: string): Promise<StoredProjectAiSettings | null> {
    const project = (await this.read()).projects[projectId]
    return project ? normalizeRecord(project) : null
  }

  async listProjectIds(): Promise<string[]> {
    return Object.keys((await this.read()).projects)
  }

  async markVerified(
    status: 'ok' | 'invalid' | 'not-configured',
    atIso = new Date().toISOString()
  ): Promise<void> {
    await this.update((data) => {
      data.global = { ...data.global, status, lastVerifiedAt: atIso }
    })
  }

  async saveGlobal(patch: AiSettingsPatch): Promise<void> {
    await this.update((data) => {
      data.global = this.applyPatch(data.global, patch)
    })
  }

  async saveProject(projectId: string, patch: AiSettingsPatch): Promise<void> {
    await this.update((data) => {
      const previous = data.projects[projectId] ?? {}
      const next = this.applyPatch(previous, patch)
      const hasExplicitKey = patch.apiKey !== undefined && cleanKey(patch.apiKey) !== null
      const hasExplicitModel = patch.model !== undefined && cleanModel(patch.model) !== null
      const useGlobal =
        patch.useGlobal !== undefined
          ? patch.useGlobal
          : hasExplicitKey || hasExplicitModel
            ? false
            : (previous.useGlobal ?? true)
      data.projects[projectId] = { ...next, useGlobal }
    })
  }

  async clearProject(projectId: string): Promise<void> {
    await this.update((data) => {
      delete data.projects[projectId]
    })
  }

  /** Decrypt a stored key for main-process use only. */
  async readKey(stored: StoredAiSettings | null | undefined): Promise<string | null> {
    if (!stored) return null
    if (stored.apiKeyEnc) {
      if (!this.encryptionAvailable) return null
      try {
        return (await this.activeVault()).decrypt(stored.apiKeyEnc.replace(/[\r\n]/g, ''))
      } catch {
        return null
      }
    }
    return stored.apiKeyPlain ?? null
  }

  private applyPatch(previous: StoredAiSettings, patch: AiSettingsPatch): StoredAiSettings {
    const next: StoredAiSettings = { ...previous }
    if (patch.provider !== undefined) next.provider = patch.provider
    if (patch.model !== undefined) {
      const model = cleanModel(patch.model)
      if (model) {
        next.model = model
        next.chatModel = model
      } else {
        delete next.model
        delete next.chatModel
      }
    }
    if (patch.embeddingModel !== undefined) {
      const embeddingModel = cleanModel(patch.embeddingModel)
      if (embeddingModel) next.embeddingModel = embeddingModel
      else delete next.embeddingModel
    }
    if (patch.apiKey !== undefined) {
      delete next.apiKeyEnc
      delete next.apiKeyPlain
      const key = cleanKey(patch.apiKey)
      if (key) {
        if (!this.encryptionAvailable) throw new Error('OS encryption unavailable')
        next.apiKeyPlain = key
      }
    }
    return next
  }

  /**
   * A key written while the OS vault was unavailable can still be sitting on disk
   * as plaintext. Once the vault is back, seal every plaintext key and re-save.
   * Returns how many keys were rewritten.
   */
  async migrateLegacyPlaintext(): Promise<number> {
    if (!this.encryptionAvailable) return 0
    const data = await this.read()
    const records: StoredAiSettings[] = [data.global, ...Object.values(data.projects)]
    let moved = 0
    for (const record of records) {
      if (!record.apiKeyPlain) continue
      record.apiKeyEnc = (await this.activeVault()).encrypt(record.apiKeyPlain)
      delete record.apiKeyPlain
      moved += 1
    }
    if (moved > 0) await this.write(data)
    return moved
  }

  private async update(mutator: (data: AiSettingsFile) => void): Promise<void> {
    const run = this.queue.then(async () => {
      const data = await this.read()
      mutator(data)
      await this.write(data)
    })
    this.queue = run.catch(() => undefined)
    await run
  }

  private async read(): Promise<AiSettingsFile> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<AiSettingsFile>
      return {
        global: parsed.global ?? {},
        projects: parsed.projects ?? {},
        updatedAt: parsed.updatedAt
      }
    } catch {
      return { global: {}, projects: {} }
    }
  }

  private async write(data: AiSettingsFile): Promise<void> {
    if (this.encryptionAvailable) {
      // Encrypt any plaintext key written by the patch before persisting.
      for (const record of [data.global, ...Object.values(data.projects)]) {
        if (record.apiKeyPlain) {
          record.apiKeyEnc = (await this.activeVault()).encrypt(record.apiKeyPlain)
          delete record.apiKeyPlain
        }
      }
    }
    const record: AiSettingsFile = { ...data, updatedAt: new Date().toISOString() }
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    await writeFile(tmp, JSON.stringify(record, null, 2), 'utf8')
    await rename(tmp, this.filePath)
  }
}
