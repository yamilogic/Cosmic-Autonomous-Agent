import { describe, expect, it } from 'vitest'
import type { NimProvider } from '../../src/main/dashboard/ai-provider'
import {
  refreshDigest,
  type DigestStore,
  type DigestWorkspace
} from '../../src/main/dashboard/digest'
import type { DashboardDigest, ProjectInsight } from '../../src/shared/dashboard-contract'

function insight(overrides: Partial<ProjectInsight> = {}): ProjectInsight {
  return {
    status: 'on-track',
    statusReason: '',
    statusChange: '',
    mood: 'neutral',
    moodReason: '',
    moodQuote: '',
    progress: 10,
    progressEvidence: '',
    situationLine: 'all quiet',
    recentLine: '',
    highlights: [],
    blockers: [],
    nextStep: '',
    dates: {},
    clientAsk: { needsReply: false, urgency: 'normal', lastClientMessage: null, openQuestions: [] },
    commitments: [],
    decisions: [],
    risks: [],
    keywords: [],
    requirements: [],
    scope: { in: [], out: [] },
    deliverables: [],
    files: [],
    people: [],
    milestones: [],
    ...overrides
  } as ProjectInsight
}

function memoryStore(initial: DashboardDigest | null = null): DigestStore {
  let current = initial
  return {
    read: async () => current,
    write: async (digest) => {
      current = digest
    }
  }
}

function providerStub(calls: { count: number }): NimProvider {
  return {
    chatJson: async () => {
      calls.count += 1
      return {
        data: { topPriority: 'Ship the SSO fix before Friday' },
        content: '',
        modelUsed: 'test-model'
      }
    }
  } as unknown as NimProvider
}

function workspaces(i: ProjectInsight): DigestWorkspace[] {
  return [{ teamName: 'Workspace A', projectName: 'Acme', insight: i }]
}

describe('refreshDigest — input-hash gate', () => {
  it('spends one call for the same input and reuses the cache at any age', async () => {
    const store = memoryStore()
    const calls = { count: 0 }
    const first = await refreshDigest({
      workspaces: workspaces(insight()),
      store,
      provider: providerStub(calls),
      now: new Date('2026-10-25T12:00:00Z')
    })
    // a day later, far beyond maxAgeMs — the input is unchanged
    const second = await refreshDigest({
      workspaces: workspaces(insight()),
      store,
      provider: providerStub(calls),
      now: new Date('2026-10-26T12:00:00Z')
    })
    expect(calls.count).toBe(1)
    expect(second).toEqual(first)
    expect(first.inputHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('calls the provider again when the digest input changes', async () => {
    const store = memoryStore()
    const calls = { count: 0 }
    await refreshDigest({
      workspaces: workspaces(insight({ situationLine: 'all quiet' })),
      store,
      provider: providerStub(calls),
      now: new Date('2026-10-25T12:00:00Z')
    })
    await refreshDigest({
      workspaces: workspaces(insight({ situationLine: 'the client escalated' })),
      store,
      provider: providerStub(calls),
      now: new Date('2026-10-25T12:06:00Z')
    })
    expect(calls.count).toBe(2)
  })

  it('reuses a cached digest without an inputHash via the age rule (old digest.json)', async () => {
    const legacy: DashboardDigest = {
      topPriority: 'Old line',
      needsReply: [],
      atRisk: [],
      atIso: new Date('2026-10-25T11:59:00Z').toISOString(),
      source: 'ai'
    }
    const store = memoryStore(legacy)
    const calls = { count: 0 }
    const digest = await refreshDigest({
      workspaces: workspaces(insight()),
      store,
      provider: providerStub(calls),
      now: new Date('2026-10-25T12:00:00Z')
    })
    expect(digest).toEqual(legacy)
    expect(calls.count).toBe(0)
  })
})
