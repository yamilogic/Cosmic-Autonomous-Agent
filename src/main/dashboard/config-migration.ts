/**
 * One-time, idempotent config migration. Existing encrypted stores are kept;
 * environment defaults are copied into Global Config once so runtime never
 * reads NVIDIA keys from the environment again. Old records are backed up.
 */

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AiSettingsStore } from './ai-settings-store'

const MARKER = 'config-migration-v1.json'

export interface ConfigMigrationOptions {
  rootDir: string
  aiSettingsStore: AiSettingsStore
  env?: {
    nvidiaApiKey?: string
    nvidiaChatModel?: string
    nvidiaEmbeddingModel?: string
  }
  now?: string
}

export interface ConfigMigrationResult {
  migrated: boolean
  backupDir: string | null
  seededGlobalAi: boolean
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

export async function migrateConfigV1(
  options: ConfigMigrationOptions
): Promise<ConfigMigrationResult> {
  const markerPath = join(options.rootDir, MARKER)
  if (await exists(markerPath)) {
    return { migrated: false, backupDir: null, seededGlobalAi: false }
  }

  const now = options.now ?? new Date().toISOString()
  const stamp = now.replace(/[:.]/g, '-')
  const backupDir = join(options.rootDir, 'backup', `pre-config-v1-${stamp}`)
  await mkdir(backupDir, { recursive: true })

  for (const file of ['ai-settings.json', 'team-workspace.json', 'monitors.json']) {
    const source = join(options.rootDir, file)
    if (await exists(source)) {
      await copyFile(source, join(backupDir, file)).catch(() => undefined)
    }
  }

  let seededGlobalAi = false
  const global = await options.aiSettingsStore.readGlobal()
  const globalKey = await options.aiSettingsStore.readKey(global)
  const envKey = options.env?.nvidiaApiKey?.trim() || null
  if (!globalKey && envKey) {
    await options.aiSettingsStore.saveGlobal({
      apiKey: envKey,
      ...(global.chatModel || global.model
        ? {}
        : { model: options.env?.nvidiaChatModel?.trim() || null }),
      ...(global.embeddingModel
        ? {}
        : { embeddingModel: options.env?.nvidiaEmbeddingModel?.trim() || null })
    })
    seededGlobalAi = true
  } else if (!global.chatModel && !global.model && options.env?.nvidiaChatModel?.trim()) {
    await options.aiSettingsStore.saveGlobal({ model: options.env.nvidiaChatModel.trim() })
    seededGlobalAi = true
  }

  await writeFile(
    markerPath,
    JSON.stringify(
      {
        version: 1,
        at: now,
        backupDir,
        seededGlobalAi
      },
      null,
      2
    ),
    'utf8'
  )

  return { migrated: true, backupDir, seededGlobalAi }
}
