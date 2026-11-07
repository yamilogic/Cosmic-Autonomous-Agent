import { app, session, type WebContentsView } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { log } from '../logging'

export interface SlackSessionCredentials {
  /** Client token starting with xoxc- */
  token: string
  /** Session cookie d starting with xoxd- */
  cookie: string
}

export interface ExtractTokenOptions {
  /** Candidate partition names to probe (e.g. persist:card-..., persist:profile-...) */
  partitions?: string[]
  /** Custom userData directory override */
  userDataDir?: string
}

/**
 * Passive in-memory script to read the xoxc client token from Slack Web's JavaScript state.
 * Performs zero network requests and zero typing.
 */
export const EXTRACT_TOKEN_SCRIPT = `
(function() {
  try {
    // 1. Check official boot_data
    if (window.boot_data && window.boot_data.api_token && typeof window.boot_data.api_token === 'string') {
      if (window.boot_data.api_token.startsWith('xoxc-')) {
        return window.boot_data.api_token;
      }
    }
    // 2. Check TS global model
    if (window.TS && window.TS.boot_data && window.TS.boot_data.api_token && typeof window.TS.boot_data.api_token === 'string') {
      if (window.TS.boot_data.api_token.startsWith('xoxc-')) {
        return window.TS.boot_data.api_token;
      }
    }
    // 3. Inspect localStorage localConfig_v2 for client token
    const localRaw = localStorage.getItem('localConfig_v2');
    if (localRaw) {
      const parsed = JSON.parse(localRaw);
      const teams = parsed.teams || {};
      for (const t of Object.values(teams)) {
        const teamObj = t as any;
        if (teamObj && typeof teamObj.token === 'string' && teamObj.token.startsWith('xoxc-')) {
          return teamObj.token;
        }
      }
    }
    // 4. Inspect redux/TS models if exposed
    if (window.TS && window.TS.model && window.TS.model.api_token) {
      return String(window.TS.model.api_token);
    }
  } catch (_) {
    // ignore
  }
  return '';
})()
`

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

export class SessionTokenExtractor {
  private readonly cache = new Map<string, { creds: SlackSessionCredentials; expiresAt: number }>()

  /**
   * Retrieves unexpired credentials from cache if available.
   */
  getCached(key: string): SlackSessionCredentials | null {
    if (!key) return null
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }
    return entry.creds
  }

  /**
   * Clears cached credentials (all or for a specific key).
   */
  clearCache(key?: string): void {
    if (key) {
      this.cache.delete(key)
    } else {
      this.cache.clear()
    }
  }

  /**
   * Caches valid credentials under a key.
   */
  setCached(key: string, creds: SlackSessionCredentials, ttlMs = DEFAULT_CACHE_TTL_MS): void {
    if (!key || !creds) return
    this.cache.set(key, { creds, expiresAt: Date.now() + ttlMs })
  }

  /**
   * Resolves the userData path for a partition.
   */
  private resolvePartitionDir(partition: string, customUserDataDir?: string): string | null {
    const rawPart = partition.replace(/^persist:/, '')
    let userData = customUserDataDir
    if (!userData) {
      try {
        userData = app?.getPath?.('userData')
      } catch {
        // ignore
      }
    }
    if (!userData) return null
    return path.join(userData, 'Partitions', rawPart)
  }

  /**
   * Extracts the xoxc token from the partition's Local Storage leveldb files.
   */
  extractTokenFromPartitionDisk(partition: string, customUserDataDir?: string): string | null {
    try {
      const partitionDir = this.resolvePartitionDir(partition, customUserDataDir)
      if (!partitionDir || !fs.existsSync(partitionDir)) return null

      const ldbDir = path.join(partitionDir, 'Local Storage', 'leveldb')
      if (!fs.existsSync(ldbDir)) return null

      const files = fs.readdirSync(ldbDir)
      for (const file of files) {
        if (file.endsWith('.ldb') || file.endsWith('.log')) {
          try {
            const content = fs.readFileSync(path.join(ldbDir, file), 'latin1')
            const match = content.match(/xoxc-[a-zA-Z0-9-]+/)
            if (match && match[0].length > 40) {
              return match[0]
            }
          } catch {
            // ignore
          }
        }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Extracts the xoxd cookie from the partition's Cookies SQLite file on disk.
   */
  extractCookieFromPartitionDisk(partition: string, customUserDataDir?: string): string | null {
    try {
      const partitionDir = this.resolvePartitionDir(partition, customUserDataDir)
      if (!partitionDir || !fs.existsSync(partitionDir)) return null

      const cookiesPath = path.join(partitionDir, 'Cookies')
      if (!fs.existsSync(cookiesPath)) return null

      try {
        const content = fs.readFileSync(cookiesPath, 'latin1')
        const match = content.match(/xoxd-[a-zA-Z0-9%-]+/)
        if (match && match[0].length > 40) {
          return match[0]
        }
      } catch {
        // ignore
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Probes the partition's Local Storage leveldb and Cookies on disk.
   */
  extractFromPartitionDisk(partition: string, customUserDataDir?: string): SlackSessionCredentials | null {
    const token = this.extractTokenFromPartitionDisk(partition, customUserDataDir)
    if (!token) return null

    const cookie = this.extractCookieFromPartitionDisk(partition, customUserDataDir)
    if (!cookie) return null

    return { token, cookie }
  }

  /**
   * Extracts credentials from an Electron session partition (combining session cookie + disk storage).
   * Tier 2: session.fromPartition(partition).cookies.get({ name: 'd' }) + disk LevelDB xoxc-
   * Tier 3: disk Cookies SQLite file + disk LevelDB xoxc-
   */
  async extractFromPartition(
    partition: string,
    customUserDataDir?: string
  ): Promise<SlackSessionCredentials | null> {
    try {
      let cookie = ''
      try {
        if (session?.fromPartition) {
          const sess = session.fromPartition(partition)
          if (sess?.cookies) {
            const cookies = await sess.cookies.get({ name: 'd' })
            const d = cookies.find((c: any) => c.value?.startsWith('xoxd-'))
            if (d?.value) {
              cookie = d.value
            }
          }
        }
      } catch {
        // ignore
      }

      if (!cookie) {
        cookie = this.extractCookieFromPartitionDisk(partition, customUserDataDir) || ''
      }

      if (!cookie) return null

      const token = this.extractTokenFromPartitionDisk(partition, customUserDataDir)
      if (!token) return null

      return { token, cookie }
    } catch {
      return null
    }
  }

  /**
   * Extracts xoxc token and xoxd session cookie from candidate views or partition storage.
   * Checks the cache first if cacheKey is provided.
   * Returns null if no candidate yields valid credentials.
   */
  async extractSlackSessionTokens(
    viewOrViews: WebContentsView | null | (WebContentsView | null | undefined)[],
    cacheKey?: string,
    options?: ExtractTokenOptions
  ): Promise<SlackSessionCredentials | null> {
    if (cacheKey) {
      const cached = this.getCached(cacheKey)
      if (cached) {
        return cached
      }
    }

    const views = Array.isArray(viewOrViews) ? viewOrViews : [viewOrViews]

    for (const view of views) {
      if (!view || view.webContents?.isDestroyed()) continue

      try {
        const creds = await this.extractFromSingleView(view)
        if (creds) {
          if (cacheKey) {
            this.setCached(cacheKey, creds)
          }
          return creds
        }
      } catch (err) {
        log.info('[token-extractor] probe on view failed, trying next candidate:', {
          error: String(err)
        })
      }
    }

    // Fallback: check partitions directly (in-memory session + partition disk storage)
    if (options?.partitions?.length) {
      for (const part of options.partitions) {
        if (!part) continue
        const partCreds = await this.extractFromPartition(part, options.userDataDir)
        if (partCreds) {
          if (cacheKey) {
            this.setCached(cacheKey, partCreds)
          }
          return partCreds
        }
      }
    }

    return null
  }

  private async extractFromSingleView(
    view: WebContentsView
  ): Promise<SlackSessionCredentials | null> {
    // 1. Extract xoxd cookie from view partition
    const sessionObj = view.webContents.session
    if (!sessionObj?.cookies) return null

    const cookies = await sessionObj.cookies.get({ name: 'd' })
    let xoxdCookie = cookies.find((c) => c.value?.startsWith('xoxd-'))?.value

    if (!xoxdCookie) {
      const allSlackCookies = await sessionObj.cookies.get({ url: 'https://app.slack.com' })
      xoxdCookie = allSlackCookies.find((c) => c.name === 'd')?.value
    }

    if (!xoxdCookie || !xoxdCookie.startsWith('xoxd-')) {
      return null
    }

    // 2. Extract xoxc token from the page context
    let xoxcToken = ''
    try {
      xoxcToken = (await view.webContents.executeJavaScript(
        EXTRACT_TOKEN_SCRIPT,
        true
      )) as string
    } catch {
      xoxcToken = ''
    }

    if (!xoxcToken || !xoxcToken.startsWith('xoxc-')) {
      return null
    }

    return {
      token: xoxcToken.trim(),
      cookie: xoxdCookie.trim()
    }
  }

  /**
   * Refreshes the session tokens by clearing the cache key and briefly re-probing candidate views.
   */
  async refreshSlackSessionTokens(
    viewOrViews: WebContentsView | null | (WebContentsView | null | undefined)[],
    cacheKey?: string,
    options?: ExtractTokenOptions
  ): Promise<SlackSessionCredentials | null> {
    if (cacheKey) this.clearCache(cacheKey)
    return this.extractSlackSessionTokens(viewOrViews, cacheKey, options)
  }
}

export const sessionTokenExtractor = new SessionTokenExtractor()

