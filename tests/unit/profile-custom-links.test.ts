import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ProfileStore,
  validateCustomLinkInput
} from '../../src/main/profiles/profile-store'

describe('Profile Custom Links (Phase 1 LNK-1)', () => {
  let dir: string
  let store: ProfileStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orbit-custom-links-'))
    store = new ProfileStore({ filePath: join(dir, 'profiles.json') })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  describe('Validation - validateCustomLinkInput', () => {
    it('rejects empty, whitespace-only or overly long names', () => {
      expect(validateCustomLinkInput('', 'https://google.com')).toEqual({
        valid: false,
        message: 'Name must be between 1 and 40 characters.'
      })
      expect(validateCustomLinkInput('   ', 'https://google.com')).toEqual({
        valid: false,
        message: 'Name must be between 1 and 40 characters.'
      })
      expect(validateCustomLinkInput('a'.repeat(41), 'https://google.com')).toEqual({
        valid: false,
        message: 'Name must be between 1 and 40 characters.'
      })
    })

    it('rejects missing or empty URL', () => {
      expect(validateCustomLinkInput('Valid', '')).toEqual({
        valid: false,
        message: 'URL is required.'
      })
      expect(validateCustomLinkInput('Valid', '   ')).toEqual({
        valid: false,
        message: 'URL is required.'
      })
    })

    it('rejects insecure url schemes (javascript:, file:, data:)', () => {
      expect(validateCustomLinkInput('XSS', 'javascript:alert(1)')).toEqual({
        valid: false,
        message: 'Insecure URL scheme rejected.'
      })
      expect(validateCustomLinkInput('File', 'file:///etc/passwd')).toEqual({
        valid: false,
        message: 'Insecure URL scheme rejected.'
      })
      expect(validateCustomLinkInput('Data', 'data:text/html,<h1>hi</h1>')).toEqual({
        valid: false,
        message: 'Insecure URL scheme rejected.'
      })
    })

    it('rejects non-https URLs (http)', () => {
      const res = validateCustomLinkInput('HTTP link', 'http://insecure.example.com')
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.message).toBe('https only URL is required.')
      }
    })

    it('rejects malformed URLs without host', () => {
      const res = validateCustomLinkInput('No Host', 'https://')
      expect(res.valid).toBe(false)
    })

    it('rejects duplicates within the same profile case-insensitively and ignoring trailing slash', () => {
      const existing = [
        {
          id: 'link-1',
          name: 'Claude AI',
          url: 'https://claude.ai/',
          order: 0,
          createdAt: new Date().toISOString(),
          partition: 'persist:profile-1-link-1'
        }
      ]

      const dupRes = validateCustomLinkInput('Another Claude', 'https://claude.ai', existing)
      expect(dupRes.valid).toBe(false)
      if (!dupRes.valid) {
        expect(dupRes.message).toBe('This URL has already been added to this profile.')
      }
    })

    it('rejects exceeding 30 custom links limit', () => {
      const links = Array.from({ length: 30 }, (_, i) => ({
        id: `link-${i}`,
        name: `Link ${i}`,
        url: `https://example${i}.com`,
        order: i,
        createdAt: new Date().toISOString(),
        partition: `persist:profile-1-link-${i}`
      }))

      const res = validateCustomLinkInput('31st Link', 'https://example31.com', links)
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.message).toBe('Maximum limit of 30 custom links per profile reached.')
      }
    })

    it('accepts valid https URL and trims name', () => {
      const res = validateCustomLinkInput('  My Docs  ', 'https://docs.google.com/document/d/123')
      expect(res).toEqual({
        valid: true,
        name: 'My Docs',
        url: 'https://docs.google.com/document/d/123'
      })
    })
  })

  describe('Store Operations & Per-Profile Isolation', () => {
    it('adds custom link to profile A without leaking to profile B', async () => {
      const pA = await store.create('userA@gmail.com')
      const pB = await store.create('userB@gmail.com')

      const updatedA = await store.addCustomLink(pA.id, {
        name: 'Github',
        url: 'https://github.com'
      })

      expect(updatedA.customLinks).toHaveLength(1)
      expect(updatedA.customLinks![0]!.name).toBe('Github')
      expect(updatedA.customLinks![0]!.url).toBe('https://github.com/')
      expect(updatedA.customLinks![0]!.partition).toBe(
        `persist:profile-${pA.id}-link-${updatedA.customLinks![0]!.id}`
      )

      // Profile B remains unaffected
      const fetchedB = await store.get(pB.id)
      expect(fetchedB?.customLinks).toEqual([])

      const listA = await store.listCustomLinks(pA.id)
      const listB = await store.listCustomLinks(pB.id)
      expect(listA).toHaveLength(1)
      expect(listB).toHaveLength(0)
    })

    it('updates an existing custom link', async () => {
      const p = await store.create('user@gmail.com')
      const updated = await store.addCustomLink(p.id, {
        name: 'Old Name',
        url: 'https://linear.app'
      })
      const linkId = updated.customLinks![0]!.id

      const edited = await store.updateCustomLink(p.id, linkId, {
        name: 'Linear Workspaces'
      })

      expect(edited.customLinks![0]!.name).toBe('Linear Workspaces')
      expect(edited.customLinks![0]!.url).toBe('https://linear.app/')
    })

    it('removes custom link and adjusts order indices', async () => {
      const p = await store.create('user@gmail.com')
      await store.addCustomLink(p.id, { name: 'Link 1', url: 'https://one.com' })
      const p2 = await store.addCustomLink(p.id, { name: 'Link 2', url: 'https://two.com' })
      const link1Id = p2.customLinks![0]!.id

      const afterRemove = await store.removeCustomLink(p.id, link1Id)
      expect(afterRemove.customLinks).toHaveLength(1)
      expect(afterRemove.customLinks![0]!.name).toBe('Link 2')
      expect(afterRemove.customLinks![0]!.order).toBe(0)
    })

    it('reorders custom links', async () => {
      const p = await store.create('user@gmail.com')
      const p1 = await store.addCustomLink(p.id, { name: 'A', url: 'https://a.com' })
      const p2 = await store.addCustomLink(p.id, { name: 'B', url: 'https://b.com' })
      const idA = p1.customLinks![0]!.id
      const idB = p2.customLinks![1]!.id

      const reordered = await store.reorderCustomLinks(p.id, [idB, idA])
      expect(reordered.customLinks![0]!.id).toBe(idB)
      expect(reordered.customLinks![0]!.order).toBe(0)
      expect(reordered.customLinks![1]!.id).toBe(idA)
      expect(reordered.customLinks![1]!.order).toBe(1)
    })

    it('normalizes legacy profiles without customLinks to empty array', async () => {
      const legacyRaw = {
        profiles: [
          {
            id: 'legacy-profile-1',
            displayName: 'legacy@example.com',
            createdAt: '2026-01-01T00:00:00.000Z',
            googleAuthStatus: 'signed-in',
            apps: {
              slack: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] },
              teams: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] },
              whatsapp: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] }
            }
          }
        ]
      }

      const rawPath = join(dir, 'profiles.json')
      await writeFile(rawPath, JSON.stringify(legacyRaw), 'utf-8')

      const legacyStore = new ProfileStore({ filePath: rawPath })
      const profile = await legacyStore.get('legacy-profile-1')
      expect(profile).toBeDefined()
      expect(profile?.customLinks).toEqual([])
    })

    it('toggles sidebar visibility for profile and links', async () => {
      const p = await store.create('user@gmail.com')
      expect(p.hiddenInSidebar).toBe(false)

      const hiddenProf = await store.setSidebarVisibility(p.id, true)
      expect(hiddenProf.hiddenInSidebar).toBe(true)

      const shownProf = await store.setSidebarVisibility(p.id, false)
      expect(shownProf.hiddenInSidebar).toBe(false)

      const withLink = await store.addCustomLink(p.id, { name: 'Claude', url: 'https://claude.ai' })
      const linkId = withLink.customLinks![0]!.id
      expect(withLink.customLinks![0]!.hiddenInSidebar).toBe(false)

      const hiddenLink = await store.setLinkSidebarVisibility(p.id, linkId, true)
      expect(hiddenLink.customLinks![0]!.hiddenInSidebar).toBe(true)
    })
  })
})

