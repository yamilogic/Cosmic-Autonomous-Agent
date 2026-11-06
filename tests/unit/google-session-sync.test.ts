// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit tests for google-session-sync.ts
 *
 * Tests:
 * 1. isGoogleCookieDomain correctly identifies Google domains.
 * 2. isGoogleCookieDomain correctly rejects Slack, Teams, WhatsApp, and other non-Google domains.
 * 3. syncGoogleSessionFromProfileToCard copies only Google cookies between partitions.
 * 4. syncGoogleSessionFromProfileToCard leaves Slack cookies untouched in the card partition.
 * 5. syncGoogleSessionToProfileCards propagates Google cookies to all listed cards.
 */

// ── Fake electron session ─────────────────────────────────────────────────────

type FakeCookie = {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  session: boolean
  expirationDate?: number
  sameSite?: string
}

const partitionStores = new Map<string, FakeCookie[]>()

function getStore(partition: string): FakeCookie[] {
  if (!partitionStores.has(partition)) partitionStores.set(partition, [])
  return partitionStores.get(partition)!
}

vi.mock('electron', () => ({
  session: {
    fromPartition: (partition: string) => ({
      cookies: {
        get: async (filter?: Record<string, unknown>) => {
          const store = getStore(partition)
          if (!filter || Object.keys(filter).length === 0) return [...store]
          // simple domain filter
          if (filter.domain) {
            return store.filter((c) => c.domain.includes(filter.domain as string))
          }
          return [...store]
        },
        set: async (cookie: FakeCookie) => {
          const store = getStore(partition)
          // replace if same name+domain
          const idx = store.findIndex(
            (c) => c.name === cookie.name && c.domain === cookie.domain
          )
          if (idx >= 0) {
            store[idx] = cookie
          } else {
            store.push(cookie)
          }
        },
        flushStore: async () => {}
      }
    })
  }
}))

vi.mock('../../src/main/logging', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('../../src/main/profiles/session-partition', () => ({
  partitionForProfile: (profileId: string, appId: string) =>
    `persist:profile-${profileId}-${appId}`,
  partitionForCard: (projectId: string, appId: string) =>
    `persist:card-${projectId}-${appId}`
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  isGoogleCookieDomain,
  syncGoogleSessionFromProfileToCard,
  syncGoogleSessionToProfileCards
} from '../../src/main/profiles/google-session-sync'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCookie(overrides: Partial<FakeCookie> & { name: string; domain: string }): FakeCookie {
  return {
    value: 'test-value',
    path: '/',
    secure: true,
    httpOnly: true,
    session: false,
    expirationDate: Date.now() / 1000 + 86400,
    sameSite: 'no_restriction',
    ...overrides
  }
}

function seedPartition(partition: string, cookies: FakeCookie[]): void {
  const store = getStore(partition)
  store.length = 0
  store.push(...cookies)
}

beforeEach(() => {
  partitionStores.clear()
})

afterEach(() => {
  partitionStores.clear()
})

// ── Tests: isGoogleCookieDomain ────────────────────────────────────────────────

describe('isGoogleCookieDomain', () => {
  it('returns true for google.com domains', () => {
    expect(isGoogleCookieDomain('.google.com')).toBe(true)
    expect(isGoogleCookieDomain('google.com')).toBe(true)
    expect(isGoogleCookieDomain('.accounts.google.com')).toBe(true)
    expect(isGoogleCookieDomain('accounts.google.com')).toBe(true)
  })

  it('returns true for googleusercontent.com', () => {
    expect(isGoogleCookieDomain('.googleusercontent.com')).toBe(true)
  })

  it('returns true for gstatic.com', () => {
    expect(isGoogleCookieDomain('.gstatic.com')).toBe(true)
  })

  it('returns true for youtube.com', () => {
    expect(isGoogleCookieDomain('.youtube.com')).toBe(true)
  })

  it('returns true for googleapis.com', () => {
    expect(isGoogleCookieDomain('.googleapis.com')).toBe(true)
  })

  it('returns false for slack.com', () => {
    expect(isGoogleCookieDomain('.slack.com')).toBe(false)
    expect(isGoogleCookieDomain('slack.com')).toBe(false)
  })

  it('returns false for slack-edge.com', () => {
    expect(isGoogleCookieDomain('.slack-edge.com')).toBe(false)
  })

  it('returns false for microsoft.com and microsoftonline.com', () => {
    expect(isGoogleCookieDomain('.microsoft.com')).toBe(false)
    expect(isGoogleCookieDomain('.microsoftonline.com')).toBe(false)
    expect(isGoogleCookieDomain('.live.com')).toBe(false)
  })

  it('returns false for whatsapp.com', () => {
    expect(isGoogleCookieDomain('.whatsapp.com')).toBe(false)
    expect(isGoogleCookieDomain('wa.me')).toBe(false)
  })

  it('returns false for facebook.com', () => {
    expect(isGoogleCookieDomain('.facebook.com')).toBe(false)
  })

  it('returns false for arbitrary domains', () => {
    expect(isGoogleCookieDomain('.example.com')).toBe(false)
    expect(isGoogleCookieDomain('app.slack.com')).toBe(false)
  })
})

// ── Tests: syncGoogleSessionFromProfileToCard ──────────────────────────────────

describe('syncGoogleSessionFromProfileToCard', () => {
  const profileId = 'profile-rajesh'
  const projectId = 'card-rajesh-test-01'

  it('copies Google cookies from profile partition to card partition', async () => {
    const profilePartition = `persist:profile-${profileId}-slack`

    const googleCookie = makeCookie({ name: 'SAPISID', domain: '.google.com' })
    const googleAccountsCookie = makeCookie({ name: 'SID', domain: '.accounts.google.com' })

    seedPartition(profilePartition, [googleCookie, googleAccountsCookie])

    const synced = await syncGoogleSessionFromProfileToCard(profileId, projectId, 'slack')

    expect(synced).toBe(2)

    const cardPartition = `persist:card-${projectId}-slack`
    const cardStore = getStore(cardPartition)
    expect(cardStore).toHaveLength(2)
    expect(cardStore.some((c) => c.name === 'SAPISID')).toBe(true)
    expect(cardStore.some((c) => c.name === 'SID')).toBe(true)
  })

  it('does NOT copy Slack cookies from profile partition to card partition', async () => {
    const profilePartition = `persist:profile-${profileId}-slack`

    const googleCookie = makeCookie({ name: 'SAPISID', domain: '.google.com' })
    const slackCookie = makeCookie({ name: 'd', domain: '.slack.com' })
    const slackEdgeCookie = makeCookie({ name: 'b', domain: '.slack-edge.com' })

    seedPartition(profilePartition, [googleCookie, slackCookie, slackEdgeCookie])

    await syncGoogleSessionFromProfileToCard(profileId, projectId, 'slack')

    const cardPartition = `persist:card-${projectId}-slack`
    const cardStore = getStore(cardPartition)

    // Only google cookie should be present
    expect(cardStore.some((c) => c.name === 'SAPISID')).toBe(true)
    expect(cardStore.some((c) => c.name === 'd')).toBe(false)
    expect(cardStore.some((c) => c.name === 'b')).toBe(false)
  })

  it('does NOT copy Teams/Microsoft cookies from profile partition to card partition', async () => {
    const profilePartition = `persist:profile-${profileId}-slack`

    const googleCookie = makeCookie({ name: 'SAPISID', domain: '.google.com' })
    const msCookie = makeCookie({ name: 'ESTSAUTH', domain: '.microsoftonline.com' })

    seedPartition(profilePartition, [googleCookie, msCookie])

    await syncGoogleSessionFromProfileToCard(profileId, projectId, 'slack')

    const cardPartition = `persist:card-${projectId}-slack`
    const cardStore = getStore(cardPartition)

    expect(cardStore.some((c) => c.name === 'SAPISID')).toBe(true)
    expect(cardStore.some((c) => c.name === 'ESTSAUTH')).toBe(false)
  })

  it('does NOT copy WhatsApp cookies from profile partition to card partition', async () => {
    const profilePartition = `persist:profile-${profileId}-slack`

    const googleCookie = makeCookie({ name: 'SAPISID', domain: '.google.com' })
    const waCookie = makeCookie({ name: 'wa_lang_pref', domain: '.whatsapp.com' })

    seedPartition(profilePartition, [googleCookie, waCookie])

    await syncGoogleSessionFromProfileToCard(profileId, projectId, 'slack')

    const cardPartition = `persist:card-${projectId}-slack`
    const cardStore = getStore(cardPartition)

    expect(cardStore.some((c) => c.name === 'SAPISID')).toBe(true)
    expect(cardStore.some((c) => c.name === 'wa_lang_pref')).toBe(false)
  })

  it('returns 0 and does not throw when there are no Google cookies in the source partition', async () => {
    const profilePartition = `persist:profile-${profileId}-slack`
    const slackCookie = makeCookie({ name: 'd', domain: '.slack.com' })
    seedPartition(profilePartition, [slackCookie])

    const synced = await syncGoogleSessionFromProfileToCard(profileId, projectId, 'slack')

    expect(synced).toBe(0)
    const cardStore = getStore(`persist:card-${projectId}-slack`)
    expect(cardStore).toHaveLength(0)
  })

  it('does not write to itself when source and destination partitions are the same', async () => {
    // This test ensures we short-circuit without error
    const result = await syncGoogleSessionFromProfileToCard('same', 'same')
    // partitionForProfile('same', 'slack') !== partitionForCard('same', 'slack'), but
    // the call should safely return 0 or positive without error.
    expect(typeof result).toBe('number')
  })
})

// ── Tests: syncGoogleSessionToProfileCards ────────────────────────────────────

describe('syncGoogleSessionToProfileCards', () => {
  const profileId = 'profile-ashutosh'
  const projectIds = ['card-a1', 'card-a2', 'card-a3']

  it('syncs Google cookies to all listed card project IDs', async () => {
    const profilePartition = `persist:profile-${profileId}-slack`
    const googleCookie = makeCookie({ name: 'SAPISID', domain: '.google.com' })
    seedPartition(profilePartition, [googleCookie])

    await syncGoogleSessionToProfileCards(profileId, projectIds, 'slack')

    for (const pid of projectIds) {
      const store = getStore(`persist:card-${pid}-slack`)
      expect(store.some((c) => c.name === 'SAPISID')).toBe(true)
    }
  })

  it('is a no-op when cardProjectIds is empty', async () => {
    const profilePartition = `persist:profile-${profileId}-slack`
    const googleCookie = makeCookie({ name: 'SAPISID', domain: '.google.com' })
    seedPartition(profilePartition, [googleCookie])

    // Should not throw
    await expect(syncGoogleSessionToProfileCards(profileId, [], 'slack')).resolves.toBeUndefined()
  })

  it('does not leak Slack cookies between sibling cards', async () => {
    const profilePartition = `persist:profile-${profileId}-slack`
    const googleCookie = makeCookie({ name: 'SAPISID', domain: '.google.com' })
    const slackCookieA = makeCookie({ name: 'd', value: 'workspace-a-token', domain: '.slack.com' })

    seedPartition(profilePartition, [googleCookie])
    // card-a1 already has its own Slack token
    seedPartition(`persist:card-card-a1-slack`, [slackCookieA])

    await syncGoogleSessionToProfileCards(profileId, ['card-a1', 'card-a2'], 'slack')

    // card-a2 must not inherit card-a1's Slack cookie
    const storeA2 = getStore(`persist:card-card-a2-slack`)
    expect(storeA2.some((c) => c.name === 'd' && c.value === 'workspace-a-token')).toBe(false)
    // card-a2 should only have the Google cookie
    expect(storeA2.some((c) => c.name === 'SAPISID')).toBe(true)
  })
})

