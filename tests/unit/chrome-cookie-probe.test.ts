import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  chromeProfileHasGoogleSession,
  chromeProfileHasSlackSession
} from '../../src/main/profiles/chrome-cookie-probe'

describe('chromeCookieProbe (unit & isolated DB)', () => {
  let testProfileDir: string
  let dbPath: string

  beforeEach(() => {
    testProfileDir = mkdtempSync(join(tmpdir(), 'test-probe-profile-'))
    const networkDir = join(testProfileDir, 'Default', 'Network')
    mkdirSync(networkDir, { recursive: true })
    dbPath = join(networkDir, 'Cookies')

    spawnSync('/usr/bin/sqlite3', [
      dbPath,
      `CREATE TABLE cookies(
        creation_utc INTEGER NOT NULL,
        host_key TEXT NOT NULL,
        top_frame_site_key TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        encrypted_value BLOB NOT NULL,
        path TEXT NOT NULL,
        expires_utc INTEGER NOT NULL,
        is_secure INTEGER NOT NULL,
        is_httponly INTEGER NOT NULL,
        last_access_utc INTEGER NOT NULL,
        has_expires INTEGER NOT NULL,
        is_persistent INTEGER NOT NULL,
        priority INTEGER NOT NULL,
        samesite INTEGER NOT NULL,
        source_scheme INTEGER NOT NULL,
        source_port INTEGER NOT NULL,
        last_update_utc INTEGER NOT NULL,
        source_type INTEGER NOT NULL,
        has_cross_site_ancestor INTEGER NOT NULL
      );`
    ])
  })

  afterEach(() => {
    try {
      rmSync(testProfileDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('returns false for empty database', () => {
    expect(chromeProfileHasSlackSession(testProfileDir)).toBe(false)
    expect(chromeProfileHasGoogleSession(testProfileDir)).toBe(false)
  })

  it('returns false when only Slack tracking cookies like b, x, or utm exist (prevents premature popup auto-close)', () => {
    spawnSync('/usr/bin/sqlite3', [
      dbPath,
      `INSERT INTO cookies (creation_utc, host_key, top_frame_site_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, last_access_utc, has_expires, is_persistent, priority, samesite, source_scheme, source_port, last_update_utc, source_type, has_cross_site_ancestor)
       VALUES
       (1, '.slack.com', '', 'b', 'd8382a0e5c7d4facc5ad63922a2444e4', X'', '/', 0, 1, 0, 0, 0, 1, 1, 0, 2, 443, 0, 1, 0),
       (2, '.slack.com', '', 'x', 'd8382a0e5c7d4facc5ad63922a2444e4.1794007728', X'', '/', 0, 1, 0, 0, 0, 1, 1, 0, 2, 443, 0, 1, 0),
       (3, '.slack.com', '', 'utm', '%7B%7D', X'', '/', 0, 1, 0, 0, 0, 1, 1, 0, 2, 443, 0, 1, 0);`
    ])

    // Tracking cookies must NOT be treated as a finished login!
    expect(chromeProfileHasSlackSession(testProfileDir)).toBe(false)
  })

  it('returns false when d cookie is too short (< 20 chars)', () => {
    spawnSync('/usr/bin/sqlite3', [
      dbPath,
      `INSERT INTO cookies (creation_utc, host_key, top_frame_site_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, last_access_utc, has_expires, is_persistent, priority, samesite, source_scheme, source_port, last_update_utc, source_type, has_cross_site_ancestor)
       VALUES
       (1, '.slack.com', '', 'd', 'short_dummy_val', X'', '/', 0, 1, 1, 0, 0, 1, 1, 0, 2, 443, 0, 1, 0);`
    ])

    expect(chromeProfileHasSlackSession(testProfileDir)).toBe(false)
  })

  it('returns true when authentic Slack session token d exists in value', () => {
    const realToken = 'xoxd-11973077475174-11961720956039-abcdef1234567890abcdef1234567890'
    spawnSync('/usr/bin/sqlite3', [
      dbPath,
      `INSERT INTO cookies (creation_utc, host_key, top_frame_site_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, last_access_utc, has_expires, is_persistent, priority, samesite, source_scheme, source_port, last_update_utc, source_type, has_cross_site_ancestor)
       VALUES
       (1, '.slack.com', '', 'd', '${realToken}', X'', '/', 0, 1, 1, 0, 0, 1, 1, 0, 2, 443, 0, 1, 0);`
    ])

    expect(chromeProfileHasSlackSession(testProfileDir)).toBe(true)
  })

  it('returns true when authentic Slack session token d-s exists in encrypted_value BLOB', () => {
    const blobHex = '01000000d08c9ddf0115d1118c7a00c04fc297eb0100000021c252251147a44f'
    spawnSync('/usr/bin/sqlite3', [
      dbPath,
      `INSERT INTO cookies (creation_utc, host_key, top_frame_site_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, last_access_utc, has_expires, is_persistent, priority, samesite, source_scheme, source_port, last_update_utc, source_type, has_cross_site_ancestor)
       VALUES
       (1, '.slack.com', '', 'd-s', '', X'${blobHex}', '/', 0, 1, 1, 0, 0, 1, 1, 0, 2, 443, 0, 1, 0);`
    ])

    expect(chromeProfileHasSlackSession(testProfileDir)).toBe(true)
  })

  it('validates Google session requiring at least 2 auth cookies', () => {
    spawnSync('/usr/bin/sqlite3', [
      dbPath,
      `INSERT INTO cookies (creation_utc, host_key, top_frame_site_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, last_access_utc, has_expires, is_persistent, priority, samesite, source_scheme, source_port, last_update_utc, source_type, has_cross_site_ancestor)
       VALUES
       (1, '.google.com', '', 'SID', 'valid-sid-value', X'', '/', 0, 1, 1, 0, 0, 1, 1, 0, 2, 443, 0, 1, 0);`
    ])
    expect(chromeProfileHasGoogleSession(testProfileDir)).toBe(false)

    spawnSync('/usr/bin/sqlite3', [
      dbPath,
      `INSERT INTO cookies (creation_utc, host_key, top_frame_site_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, last_access_utc, has_expires, is_persistent, priority, samesite, source_scheme, source_port, last_update_utc, source_type, has_cross_site_ancestor)
       VALUES
       (2, '.google.com', '', 'HSID', 'valid-hsid-value', X'', '/', 0, 1, 1, 0, 0, 1, 1, 0, 2, 443, 0, 1, 0);`
    ])
    expect(chromeProfileHasGoogleSession(testProfileDir)).toBe(true)
  })
})

describe('chromeCookieProbe (on-device profiles)', () => {
  it('does not false-positive Slack on unauthenticated profiles', () => {
    const unauthDir = join(tmpdir(), 'slack-test-unauth-profile-' + Date.now())
    mkdirSync(join(unauthDir, 'Default'), { recursive: true })
    try {
      expect(chromeProfileHasSlackSession(unauthDir)).toBe(false)
    } finally {
      rmSync(unauthDir, { recursive: true, force: true })
    }
  })
})
