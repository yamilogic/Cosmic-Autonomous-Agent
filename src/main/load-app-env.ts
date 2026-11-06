import { config as loadEnv } from 'dotenv'
import { app } from 'electron'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Resolve .env locations for dev + packaged installs.
 * Packaged apps do not see the project folder cwd — use Resources and userData instead.
 */
export function resolveEnvFileCandidates(): string[] {
  const paths: string[] = []
  const push = (p: string): void => {
    if (p && !paths.includes(p)) paths.push(p)
  }

  if (!app.isPackaged) {
    push(join(process.cwd(), '.env'))
  }

  try {
    push(join(app.getPath('userData'), '.env'))
  } catch {
    /* app path unavailable */
  }

  // Stable fallback if productName / getName diverges across builds
  push(join(homedir(), 'Library/Application Support/slack-dashboard/.env'))
  push(join(homedir(), 'Library/Application Support/Orbit/.env'))
  push(join(homedir(), 'Library/Application Support/Workspace Dashboard/.env'))

  if (app.isPackaged) {
    try {
      push(join(process.resourcesPath, '.env'))
    } catch {
      /* ignore */
    }
    push(join(process.cwd(), '.env'))
  }

  return paths
}

/** Load first existing .env (no override). Returns path loaded, or null. */
export function loadAppEnv(): string | null {
  for (const path of resolveEnvFileCandidates()) {
    if (!existsSync(path)) continue
    const result = loadEnv({ path, override: false })
    if (!result.error) return path
  }
  return null
}

/** Hint shown when admin credentials are missing. */
export function adminEnvPathHint(): string {
  try {
    return join(app.getPath('userData'), '.env')
  } catch {
    return join(homedir(), 'Library/Application Support/slack-dashboard/.env')
  }
}
