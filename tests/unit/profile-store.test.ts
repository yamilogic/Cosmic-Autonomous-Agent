import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProfileStore } from '../../src/main/profiles/profile-store'

describe('ProfileStore', () => {
  let dir: string
  let store: ProfileStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slack-dashboard-profiles-'))
    store = new ProfileStore({ filePath: join(dir, 'profiles.json') })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('creates a profile with empty slack and teams apps', async () => {
    const profile = await store.create('Atul')
    expect(profile.apps.slack.availableWorkspaces).toEqual([])
    expect(profile.apps.slack.pinnedWorkspaces).toEqual([])
    expect(profile.apps.slack.sessionStatus).toBe('not-signed-in')
    expect(profile.apps.teams.sessionStatus).toBe('not-signed-in')
    expect(profile.apps.whatsapp.sessionStatus).toBe('not-signed-in')
  })

  it('reuses the same email case-insensitively via createOrGet', async () => {
    const a = await store.createOrGet('User@Example.com')
    expect(a.created).toBe(true)
    const b = await store.createOrGet('user@example.com')
    expect(b.created).toBe(false)
    expect(b.profile.id).toBe(a.profile.id)
    expect((await store.list()).length).toBe(1)
  })

  it('createOrGet prefers the signed-in duplicate when several exist', async () => {
    const weak = await store.create('dup-pick@example.com')
    const strong = await store.create('dup-pick@example.com')
    await store.forceGoogleAuthStatus(strong.id, 'signed-in')
    await store.forceSessionStatus(strong.id, 'slack', 'signed-in')
    const picked = await store.createOrGet('dup-pick@example.com')
    expect(picked.created).toBe(false)
    expect(picked.profile.id).toBe(strong.id)
    expect(picked.profile.id).not.toBe(weak.id)
  })

  it('clears stuck signing-in statuses', async () => {
    const p = await store.create('stuck@example.com')
    await store.forceGoogleAuthStatus(p.id, 'signing-in')
    await store.forceSessionStatus(p.id, 'slack', 'signing-in-slack')
    const cleared = await store.clearStuckSigningInStatuses()
    const got = cleared.find((x) => x.id === p.id)
    expect(got?.googleAuthStatus).toBe('not-signed-in')
    expect(got?.apps.slack.sessionStatus).toBe('not-signed-in')
  })

  it('deletes unsigned duplicate emails and keeps the best profile', async () => {
    const keep = await store.create('dup@example.com')
    await store.forceGoogleAuthStatus(keep.id, 'signed-in')
    const orphan = await store.create('dup@example.com')
    expect(orphan.displayName).toBe('dup@example.com')
    // create() allows duplicates; cleanup removes unsigned extras
    const { deletedIds, profiles } = await store.deleteUnsignedDuplicates()
    expect(deletedIds).toContain(orphan.id)
    expect(profiles.map((p) => p.id)).toContain(keep.id)
    expect(profiles.map((p) => p.id)).not.toContain(orphan.id)
  })

  describe('available then pin per app', () => {
    it('upserts available and pins only from available for slack', async () => {
      const profile = await store.create('Atul')
      const withAvail = await store.upsertAvailable(profile.id, 'slack', {
        teamId: 'T123',
        teamName: 'Acme',
        openUrl: 'https://app.slack.com/client/T123',
        teamDomain: 'acme'
      })
      expect(withAvail.apps.slack.availableWorkspaces).toEqual([
        {
          teamId: 'T123',
          teamName: 'Acme',
          openUrl: 'https://app.slack.com/client/T123',
          teamDomain: 'acme',
          lastSeenAt: expect.any(String)
        }
      ])
      expect(withAvail.apps.slack.pinnedWorkspaces).toEqual([])

      const pinned = await store.pinFromAvailable(profile.id, 'slack', 'T123')
      expect(pinned.apps.slack.pinnedWorkspaces).toEqual([
        {
          teamId: 'T123',
          teamName: 'Acme',
          openUrl: 'https://app.slack.com/client/T123',
          teamDomain: 'acme'
        }
      ])

      await expect(store.pinFromAvailable(profile.id, 'slack', 'T999')).rejects.toThrow(
        /Open the workspace once/
      )

      const unpinned = await store.unpinWorkspace(profile.id, 'slack', 'T123')
      expect(unpinned.apps.slack.pinnedWorkspaces).toEqual([])
      expect(unpinned.apps.slack.availableWorkspaces).toHaveLength(1)
    })

    it('keeps teams pins independent from slack', async () => {
      const profile = await store.create('Atul')
      await store.upsertAvailable(profile.id, 'slack', {
        teamId: 'T1',
        teamName: 'Slack WS',
        openUrl: 'https://app.slack.com/client/T1'
      })
      await store.upsertAvailable(profile.id, 'teams', {
        teamId: 'tenant-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        teamName: 'Contoso',
        openUrl: 'https://teams.microsoft.com/v2/?tenantId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      })
      await store.pinFromAvailable(
        profile.id,
        'teams',
        'tenant-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      )
      const listed = await store.get(profile.id)
      expect(listed?.apps.slack.pinnedWorkspaces).toEqual([])
      expect(listed?.apps.teams.pinnedWorkspaces).toHaveLength(1)
    })

    it('migrates legacy top-level Slack fields into apps.slack', async () => {
      const { writeFile } = await import('fs/promises')
      await writeFile(
        join(dir, 'profiles.json'),
        JSON.stringify({
          profiles: [
            {
              id: 'p1',
              displayName: 'Legacy',
              createdAt: new Date().toISOString(),
              avatarColor: '#2BAC76',
              sessionStatus: 'signed-in',
              pinnedTeamIds: ['T999']
            }
          ]
        }),
        'utf8'
      )
      const listed = await store.list()
      expect(listed[0].apps.slack.sessionStatus).toBe('signed-in')
      expect(listed[0].apps.slack.availableWorkspaces[0].teamId).toBe('T999')
      expect(listed[0].apps.teams.sessionStatus).toBe('not-signed-in')
      expect(listed[0].apps.whatsapp.sessionStatus).toBe('not-signed-in')
    })

    it('recovers when profiles.json has trailing garbage after a complete document', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      const profile = await store.create('CorruptMe')
      const clean = await readFile(join(dir, 'profiles.json'), 'utf8')
      await writeFile(
        join(dir, 'profiles.json'),
        `${clean.trimEnd()}\n          ],\n          "pinnedWorkspaces": []\n        }\n`,
        'utf8'
      )
      // Fresh store instance (cold cache) — matches app restart with a corrupted file.
      const reopened = new ProfileStore({ filePath: join(dir, 'profiles.json') })
      const listed = await reopened.list()
      expect(listed).toHaveLength(1)
      expect(listed[0]!.id).toBe(profile.id)
      // Healed on disk
      JSON.parse(await readFile(join(dir, 'profiles.json'), 'utf8'))
    })

    it('allows idempotent session status updates', async () => {
      const profile = await store.create('TeamsUser')
      await store.setSessionStatus(profile.id, 'teams', 'signing-in')
      const again = await store.setSessionStatus(profile.id, 'teams', 'signing-in')
      expect(again.apps.teams.sessionStatus).toBe('signing-in')
    })
  })
})
