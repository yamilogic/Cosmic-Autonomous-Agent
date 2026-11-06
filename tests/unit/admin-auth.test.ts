import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AdminAuthController,
  defaultAdminSessionPath,
  hashAdminCredentials,
  verifyAdminCredentials
} from '../../src/main/admin-auth'

describe('verifyAdminCredentials', () => {
  const expected = { username: 'Admin', password: 's3cret!' }

  it('accepts matching username (case-insensitive) and password', () => {
    expect(verifyAdminCredentials('admin', 's3cret!', expected)).toBe(true)
    expect(verifyAdminCredentials('ADMIN', 's3cret!', expected)).toBe(true)
  })

  it('rejects wrong password or username', () => {
    expect(verifyAdminCredentials('admin', 'wrong', expected)).toBe(false)
    expect(verifyAdminCredentials('other', 's3cret!', expected)).toBe(false)
  })
})

describe('AdminAuthController remembered session', () => {
  let dir: string
  let prevUser: string | undefined
  let prevPass: string | undefined
  let prevEmail: string | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slack-dashboard-admin-'))
    prevUser = process.env.ADMIN_USERNAME
    prevPass = process.env.ADMIN_PASSWORD
    prevEmail = process.env.ADMIN_EMAIL
    process.env.ADMIN_USERNAME = 'admin'
    process.env.ADMIN_PASSWORD = 'changeme'
    delete process.env.ADMIN_EMAIL
  })

  afterEach(async () => {
    if (prevUser === undefined) delete process.env.ADMIN_USERNAME
    else process.env.ADMIN_USERNAME = prevUser
    if (prevPass === undefined) delete process.env.ADMIN_PASSWORD
    else process.env.ADMIN_PASSWORD = prevPass
    if (prevEmail === undefined) delete process.env.ADMIN_EMAIL
    else process.env.ADMIN_EMAIL = prevEmail
    await rm(dir, { recursive: true, force: true })
  })

  it('restores authentication from disk when remember is enabled', async () => {
    const sessionPath = defaultAdminSessionPath(dir)
    const first = new AdminAuthController({ sessionPath })
    await first.ready()
    expect(first.isAuthenticated()).toBe(false)

    const result = await first.login('admin', 'changeme', { remember: true })
    expect(result.ok).toBe(true)
    expect(first.isAuthenticated()).toBe(true)

    const raw = await readFile(sessionPath, 'utf8')
    const saved = JSON.parse(raw) as { remembered: boolean; credsHash: string }
    expect(saved.remembered).toBe(true)
    expect(saved.credsHash).toBe(hashAdminCredentials('admin', 'changeme'))

    const second = new AdminAuthController({ sessionPath })
    await second.ready()
    expect(second.isAuthenticated()).toBe(true)
  })

  it('does not persist when remember is false', async () => {
    const sessionPath = defaultAdminSessionPath(dir)
    const auth = new AdminAuthController({ sessionPath })
    await auth.ready()
    await auth.login('admin', 'changeme', { remember: false })
    expect(auth.isAuthenticated()).toBe(true)

    const third = new AdminAuthController({ sessionPath })
    await third.ready()
    expect(third.isAuthenticated()).toBe(false)
  })

  it('logout clears the remembered session', async () => {
    const sessionPath = defaultAdminSessionPath(dir)
    const auth = new AdminAuthController({ sessionPath })
    await auth.ready()
    await auth.login('admin', 'changeme', { remember: true })
    await auth.logout()
    expect(auth.isAuthenticated()).toBe(false)

    const again = new AdminAuthController({ sessionPath })
    await again.ready()
    expect(again.isAuthenticated()).toBe(false)
  })

  it('invalidates session when env password changes', async () => {
    const sessionPath = defaultAdminSessionPath(dir)
    const auth = new AdminAuthController({ sessionPath })
    await auth.ready()
    await auth.login('admin', 'changeme', { remember: true })

    process.env.ADMIN_PASSWORD = 'new-secret'
    const again = new AdminAuthController({ sessionPath })
    await again.ready()
    expect(again.isAuthenticated()).toBe(false)
  })

  it('auto-authenticates and provides default credentials when running in zero-.env mode', async () => {
    delete process.env.ADMIN_USERNAME
    delete process.env.ADMIN_PASSWORD
    delete process.env.ADMIN_EMAIL

    const sessionPath = defaultAdminSessionPath(dir)
    const auth = new AdminAuthController({ sessionPath })
    await auth.ready()
    expect(auth.isAuthenticated()).toBe(true)
    expect(auth.status().configured).toBe(true)
  })
})
