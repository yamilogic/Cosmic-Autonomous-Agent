const fakeVault = { encrypt: (p: string) => Buffer.from(p).toString('base64'), decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8') }
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { maskToken, TeamWorkspaceStore } from '../../src/main/dashboard/team-workspace-store'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true }).catch(() => {})))
  dirs.length = 0
})

async function makeStore(): Promise<{ store: TeamWorkspaceStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-team-'))
  dirs.push(dir)
  return { store: new TeamWorkspaceStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault }), dir }
}

async function makeEncryptedStore(): Promise<{ store: TeamWorkspaceStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-team-enc-'))
  dirs.push(dir)
  return {
    store: new TeamWorkspaceStore({
      rootDir: dir,
      encryptionAvailable: true,
      vault: {
        encrypt: (plain) => Buffer.from(`sealed:${plain}`, 'utf8').toString('base64'),
        decrypt: (b64) =>
          Buffer.from(b64, 'base64').toString('utf8').replace(/^sealed:/, '')
      }
    }),
    dir
  }
}

describe('TeamWorkspaceStore', () => {
  it('reports nothing connected before the first connect', async () => {
    const { store } = await makeStore()
    const view = await store.readPublic()
    expect(view.connected).toBe(false)
    expect(view.source).toBe('none')
    expect(view.channels).toEqual([])
    expect(await store.getConnection()).toBeNull()
  })

  it('connects a manual workspace, masks the token, and returns the raw one only to main', async () => {
    const { store, dir } = await makeStore()
    const view = await store.connect({
      payload: { source: 'manual', token: 'xoxp-secret-abcd' },
      profileId: 'manual:T_TEAM',
      teamId: 'T_TEAM',
      teamName: 'Our Team',
      token: 'xoxp-secret-abcd',
      now: '2026-10-25T10:00:00.000Z'
    })

    expect(view.connected).toBe(true)
    expect(view.teamName).toBe('Our Team')
    expect(view.source).toBe('manual')
    expect(view.maskedToken).toBe('••••abcd')
    expect(JSON.stringify(view)).not.toContain('xoxp-secret')

    const connection = await store.getConnection()
    expect(connection?.token).toBe('xoxp-secret-abcd')
    expect(connection?.profileId).toBe('manual:T_TEAM')

    // With OS encryption available the secret is stored as ciphertext.
    const onDisk = await readFile(join(dir, 'team-workspace.json'), 'utf8')
    expect(onDisk).toContain('tokenEnc')
  })

  it('encrypts the manual token when OS encryption is available', async () => {
    const { store, dir } = await makeEncryptedStore()
    await store.connect({
      payload: { source: 'manual', token: 'xoxp-secret-abcd' },
      profileId: 'manual:T_TEAM',
      teamId: 'T_TEAM',
      teamName: 'Our Team',
      token: 'xoxp-secret-abcd'
    })

    const onDisk = await readFile(join(dir, 'team-workspace.json'), 'utf8')
    expect(onDisk).not.toContain('xoxp-secret-abcd')
    expect(onDisk).toContain('tokenEnc')
    expect((await store.readPublic()).maskedToken).toBe('••••abcd')
    expect((await store.getConnection())?.token).toBe('xoxp-secret-abcd')
  })

  it('never stores a raw token for an OAuth connection', async () => {
    const { store, dir } = await makeStore()
    await store.connect({
      payload: { source: 'oauth', profileId: 'pf1', teamId: 'T1' },
      profileId: 'pf1',
      teamId: 'T1',
      teamName: 'Client Workspace',
      maskedToken: '••••wxyz'
    })

    const onDisk = await readFile(join(dir, 'team-workspace.json'), 'utf8')
    expect(onDisk).not.toContain('tokenEnc')
    expect(onDisk).not.toContain('tokenPlain')
    expect(onDisk).toContain('••••wxyz')
    expect((await store.getConnection())?.token).toBeNull()
  })

  it('replaces the old record on reconnect instead of accumulating workspaces', async () => {
    const { store } = await makeStore()
    await store.connect({
      payload: { source: 'manual', token: 'xoxp-first-1111' },
      profileId: 'manual:T_ONE',
      teamId: 'T_ONE',
      teamName: 'First',
      token: 'xoxp-first-1111',
      channels: [{ channelId: 'C_FIRST', channelName: 'first' }]
    })
    await store.connect({
      payload: { source: 'manual', token: 'xoxp-second-2222' },
      profileId: 'manual:T_TWO',
      teamId: 'T_TWO',
      teamName: 'Second',
      token: 'xoxp-second-2222'
    })

    const view = await store.readPublic()
    expect(view.teamId).toBe('T_TWO')
    // Fresh connect starts with no pins; the old workspace's channels are gone.
    expect(view.channels).toEqual([])
    expect((await store.getConnection())?.token).toBe('xoxp-second-2222')
  })

  it('re-pins channels without touching the secret', async () => {
    const { store } = await makeStore()
    await store.connect({
      payload: { source: 'manual', token: 'xoxp-team-9999' },
      profileId: 'manual:T_TEAM',
      teamId: 'T_TEAM',
      teamName: 'Team',
      token: 'xoxp-team-9999'
    })

    const view = await store.setChannels([
      { channelId: 'C1', channelName: 'dev' },
      { channelId: 'C2', channelName: 'design' }
    ])
    expect(view.channels).toHaveLength(2)
    expect((await store.getConnection())?.token).toBe('xoxp-team-9999')
  })

  it('refuses to pin channels before a workspace exists', async () => {
    const { store } = await makeStore()
    await expect(store.setChannels([{ channelId: 'C1', channelName: 'dev' }])).rejects.toThrow(
      /No team workspace/i
    )
  })

  it('blocks manual connect when OS encryption unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tw-'))
    const store = new TeamWorkspaceStore({ rootDir: dir, encryptionAvailable: false })
    await expect(store.connect({
      payload: { source: 'manual' } as any,
      teamId: 'T', teamName: 'Team', profileId: 'manual:K', token: 'secret'
    })).rejects.toThrow('OS encryption unavailable')
  })

  it('clears the record and the secret on disconnect', async () => {
    const { store, dir } = await makeStore()
    await store.connect({
      payload: { source: 'manual', token: 'xoxp-team-9999' },
      profileId: 'manual:T_TEAM',
      teamId: 'T_TEAM',
      teamName: 'Team',
      token: 'xoxp-team-9999',
      channels: [{ channelId: 'C1', channelName: 'dev' }]
    })
    await store.clear()

    expect((await store.readPublic()).connected).toBe(false)
    expect(await store.getConnection()).toBeNull()
    const onDisk = await readFile(join(dir, 'team-workspace.json'), 'utf8')
    expect(onDisk).not.toContain('xoxp-team-9999')
  })
})

describe('maskToken', () => {
  it('keeps only the last four characters and never short tokens', () => {
    expect(maskToken(null)).toBeNull()
    expect(maskToken('short')).toBe('••••')
    expect(maskToken('xoxp-secret-abcd')).toBe('••••abcd')
  })
})
