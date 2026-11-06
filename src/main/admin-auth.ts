import { createHash, timingSafeEqual } from 'crypto'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { adminEnvPathHint } from './load-app-env'
import { log } from './logging'

export type AdminLoginResult = { ok: true } | { ok: false; message: string }

export type AdminStatus = {
  authenticated: boolean
  configured: boolean
  /** Where to put .env for packaged installs when credentials are missing. */
  envPathHint: string
}

type AdminSessionFile = {
  remembered: true
  credsHash: string
  savedAt: string
}

function safeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) {
    timingSafeEqual(left, left)
    return false
  }
  return timingSafeEqual(left, right)
}

export const DEFAULT_ADMIN_CREDENTIALS = {
  username: 'admin',
  password: 'changeme'
}

/** Read admin credentials from process.env (loaded from .env). Falls back to defaults so .env is optional. */
export function getAdminCredentialsFromEnv(): { username: string; password: string } {
  const username = (process.env.ADMIN_USERNAME ?? process.env.ADMIN_EMAIL ?? '').trim()
  const password = process.env.ADMIN_PASSWORD ?? ''
  if (!username || !password) return DEFAULT_ADMIN_CREDENTIALS
  return { username, password }
}

export function hashAdminCredentials(username: string, password: string): string {
  return createHash('sha256')
    .update(`${username.trim().toLowerCase()}:${password}`, 'utf8')
    .digest('hex')
}

export function verifyAdminCredentials(
  username: string,
  password: string,
  expected: { username: string; password: string }
): boolean {
  const userOk = safeEqualString(username.trim().toLowerCase(), expected.username.toLowerCase())
  const passOk = safeEqualString(password, expected.password)
  return userOk && passOk
}

export function defaultAdminSessionPath(userData: string): string {
  return join(userData, 'admin-session.json')
}

/**
 * Admin gate: credentials from .env; optional remembered session on disk until Sign out.
 * Session stores only a hash of current env credentials — never the password.
 */
export class AdminAuthController {
  private authenticated = false
  private readonly sessionPath: string
  private restorePromise: Promise<void> | null = null

  constructor(options: { sessionPath: string }) {
    this.sessionPath = options.sessionPath
    this.restorePromise = this.restoreFromDisk()
  }

  /** Wait until disk restore has finished (call before first status from renderer). */
  async ready(): Promise<void> {
    await this.restorePromise
  }

  status(): AdminStatus {
    return {
      authenticated: this.authenticated,
      configured: true,
      envPathHint: adminEnvPathHint()
    }
  }

  isAuthenticated(): boolean {
    return this.authenticated
  }

  async login(
    username: string,
    password: string,
    options?: { remember?: boolean }
  ): Promise<AdminLoginResult> {
    await this.ready()
    const expected = getAdminCredentialsFromEnv()
    if (!username.trim() || !password) {
      return { ok: false, message: 'Enter username and password.' }
    }
    if (!verifyAdminCredentials(username, password, expected)) {
      log.warn('admin login failed')
      return { ok: false, message: 'Invalid username or password.' }
    }
    this.authenticated = true
    const remember = options?.remember !== false
    if (remember) {
      await this.writeSession(hashAdminCredentials(expected.username, expected.password))
    } else {
      await this.clearSessionFile()
    }
    log.info('admin logged in', { remember })
    return { ok: true }
  }

  async logout(): Promise<void> {
    this.authenticated = false
    await this.clearSessionFile()
    log.info('admin logged out')
  }

  private async restoreFromDisk(): Promise<void> {
    const expected = getAdminCredentialsFromEnv()
    const hasCustomEnv = Boolean(
      (process.env.ADMIN_USERNAME ?? process.env.ADMIN_EMAIL ?? '').trim() && process.env.ADMIN_PASSWORD
    )
    try {
      const raw = await fs.readFile(this.sessionPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<AdminSessionFile>
      if (!parsed?.remembered || typeof parsed.credsHash !== 'string') {
        if (!hasCustomEnv) {
          this.authenticated = true
          return
        }
        await this.clearSessionFile()
        return
      }
      const currentHash = hashAdminCredentials(expected.username, expected.password)
      if (!safeEqualString(parsed.credsHash, currentHash)) {
        if (!hasCustomEnv) {
          this.authenticated = true
          return
        }
        log.info('admin session invalidated (credentials changed)')
        await this.clearSessionFile()
        return
      }
      this.authenticated = true
      log.info('admin session restored from disk')
    } catch {
      if (!hasCustomEnv) {
        this.authenticated = true
        log.info('auto-authenticated with default credentials (no .env required)')
      }
    }
  }

  private async writeSession(credsHash: string): Promise<void> {
    const payload: AdminSessionFile = {
      remembered: true,
      credsHash,
      savedAt: new Date().toISOString()
    }
    await fs.mkdir(dirname(this.sessionPath), { recursive: true })
    await fs.writeFile(this.sessionPath, JSON.stringify(payload, null, 2), 'utf8')
  }

  private async clearSessionFile(): Promise<void> {
    try {
      await fs.unlink(this.sessionPath)
    } catch {
      /* ignore missing */
    }
  }
}
