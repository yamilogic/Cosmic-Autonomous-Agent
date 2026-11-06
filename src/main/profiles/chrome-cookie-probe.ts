/**
 * Detect Google/Slack session cookies in an isolated Chrome user-data-dir.
 * Copy + sqlite3 read — works while interactive Chrome holds the live DB.
 * Verified on-device: logged-in profiles expose SID/HSID/SSID; AppleScript does not see --app windows.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const GOOGLE_NAMES = ['SID', 'SSID', 'HSID', 'LSID', '__Secure-1PSID', '__Secure-3PSID']
const SLACK_NAMES = ['d', 'e', 'b']

function cookieDbCandidates(profileDir: string): string[] {
  return [join(profileDir, 'Default', 'Network', 'Cookies'), join(profileDir, 'Default', 'Cookies')]
}

function queryAuthCount(dbPath: string, hostLike: string, names: string[]): number {
  const dir = mkdtempSync(join(tmpdir(), 'sd-cookies-'))
  const tmp = join(dir, 'Cookies')
  try {
    copyFileSync(dbPath, tmp)
    for (const suffix of ['-journal', '-wal', '-shm']) {
      const side = `${dbPath}${suffix}`
      if (existsSync(side)) {
        try {
          copyFileSync(side, `${tmp}${suffix}`)
        } catch {
          /* ignore */
        }
      }
    }
    const nameList = names.map((n) => `'${n}'`).join(',')
    const sql = `SELECT count(*) FROM cookies WHERE host_key LIKE '${hostLike}' AND name IN (${nameList});`
    const out = spawnSync('/usr/bin/sqlite3', [tmp, sql], { encoding: 'utf8' })
    const n = Number((out.stdout || '').trim())
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

export function chromeProfileHasGoogleSession(profileDir: string): boolean {
  for (const db of cookieDbCandidates(profileDir)) {
    if (!existsSync(db)) continue
    if (queryAuthCount(db, '%google%', GOOGLE_NAMES) >= 2) return true
  }
  return false
}

export function chromeProfileHasSlackSession(profileDir: string): boolean {
  for (const db of cookieDbCandidates(profileDir)) {
    if (!existsSync(db)) continue
    if (queryAuthCount(db, '%slack%', SLACK_NAMES) >= 1) return true
  }
  return false
}
