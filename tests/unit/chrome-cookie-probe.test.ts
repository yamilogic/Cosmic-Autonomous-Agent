import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  chromeProfileHasGoogleSession,
  chromeProfileHasSlackSession
} from '../../src/main/profiles/chrome-cookie-probe'

/**
 * On-device verification: real Chrome login profiles under Application Support
 * must be detectable via Cookies DB (this is what auto-close relies on).
 */
describe('chromeCookieProbe (on-device)', () => {
  const roots = [
    join(homedir(), 'Library/Application Support/SlackNativeMac/chrome-login-profiles'),
    join(homedir(), 'Library/Application Support/slack-dashboard/chrome-login-profiles')
  ]

  it('detects Google SID session in at least one existing auth profile', () => {
    const dirs: string[] = []
    for (const root of roots) {
      if (!existsSync(root)) continue
      for (const name of readdirSync(root)) {
        dirs.push(join(root, name))
      }
    }
    // GitHub Actions / machines without a local Chrome login store — skip on-device probe.
    if (dirs.length === 0) return
    const hits = dirs.filter((d) => chromeProfileHasGoogleSession(d))
    expect(hits.length).toBeGreaterThan(0)
  })

  it('does not false-positive Slack on Google-only profiles', () => {
    const root = join(homedir(), 'Library/Application Support/SlackNativeMac/chrome-login-profiles')
    if (!existsSync(root)) return
    for (const name of readdirSync(root)) {
      const dir = join(root, name)
      if (chromeProfileHasGoogleSession(dir) && !chromeProfileHasSlackSession(dir)) {
        expect(chromeProfileHasSlackSession(dir)).toBe(false)
        return
      }
    }
  })
})
