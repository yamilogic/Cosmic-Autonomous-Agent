const fakeVault = { encrypt: (p: string) => Buffer.from(p).toString('base64'), decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8') }
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import { buildLocalDigest, buildDigestPrompt, refreshDigest } from '../../src/main/dashboard/digest'
import { buildRecentFeed, scoreActivity } from '../../src/main/dashboard/recent-feed'
import { isNoise } from '../../src/main/dashboard/summary-engine'
import type { DashboardProject, ProjectInsight } from '../../src/shared/dashboard-contract'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})))
  dirs.length = 0
})

async function tmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-feed-'))
  dirs.push(dir)
  return dir
}

function project(overrides: Partial<DashboardProject> = {}): DashboardProject {
  return {
    id: 'p1',
    name: 'Acme',
    clientName: 'Acme',
    profileId: 'manual:K1',
    teamId: 'T1',
    teamName: 'Workspace A',
    appId: 'slack',
    tokenSource: 'manual',
    manualTokenKey: 'K1',
    selfUserId: 'U_ME',
    monitors: [{ channelId: 'C1', channelName: 'general' }],
    createdAt: new Date().toISOString(),
    ...overrides
  }
}

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
  }
}

describe('noise filter', () => {
  it('drops join/leave notices, bot posts and greetings', () => {
    expect(isNoise({ text: '<@U0BUQTN0LP3> has joined the channel' })).toBe(true)
    expect(isNoise({ text: 'U0BUJM4GH7X has left the channel' })).toBe(true)
    expect(isNoise({ text: 'hi' })).toBe(true)
    expect(isNoise({ text: 'hii' })).toBe(true)
    expect(isNoise({ text: 'hiiiiiiiiiiiiiiii' })).toBe(true)
    expect(isNoise({ text: 'ok' })).toBe(true)
    expect(isNoise({ text: 'thanks' })).toBe(true)
    expect(isNoise({ text: 'hello', subtype: 'bot_message' })).toBe(true)
    expect(isNoise({ text: '' })).toBe(true)
  })

  it('keeps real project talk', () => {
    expect(isNoise({ text: 'can we work together here ?' })).toBe(false)
    expect(isNoise({ text: 'mockups are ready for review' })).toBe(false)
  })
})

describe('importance scoring', () => {
  it('ranks a workspace waiting on the client above a quiet one', () => {
    const waiting = scoreActivity({
      needsReply: true,
      urgency: 'normal',
      status: 'waiting-on-client',
      hoursSince: 2,
      newMessages: 1,
      stale: false
    })
    const quiet = scoreActivity({
      needsReply: false,
      urgency: 'normal',
      status: 'on-track',
      hoursSince: 2,
      newMessages: 1,
      stale: false
    })
    expect(waiting).toBeGreaterThan(quiet)
  })

  it('penalises a stale workspace', () => {
    const fresh = scoreActivity({
      needsReply: false,
      urgency: 'normal',
      status: 'on-track',
      hoursSince: 1,
      newMessages: 0,
      stale: false
    })
    const stale = scoreActivity({
      needsReply: false,
      urgency: 'normal',
      status: 'on-track',
      hoursSince: 72,
      newMessages: 0,
      stale: true
    })
    expect(fresh).toBeGreaterThan(stale)
  })
})

describe('recent feed', () => {
  it('builds one item per workspace, ranked, with the workspace attached', async () => {
    const dir = await tmpDir()
    const monitorStore = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    const deltaStore = new DashboardDeltaStore({ rootDir: dir })

    await monitorStore.upsertProject({ project: project() })
    await monitorStore.upsertProject({
      project: project({
        id: 'p2',
        name: 'Beta',
        teamId: 'T2',
        teamName: 'Workspace B',
        manualTokenKey: 'K2',
        monitors: [{ channelId: 'C9', channelName: 'dev-support' }]
      })
    })

    await deltaStore.appendMessages({
      profileId: 'manual:K1',
      teamId: 'T1',
      channelId: 'C1',
      channelName: 'general',
      messages: [
        { ts: '1788419200.000001', user: 'U1', text: 'hi' },
        { ts: '1788419300.000001', user: 'U2', text: 'any update on the mockups?' }
      ]
    })
    await deltaStore.appendMessages({
      profileId: 'manual:K2',
      teamId: 'T2',
      channelId: 'C9',
      channelName: 'dev-support',
      messages: [{ ts: '1788419100.000001', user: 'U3', text: 'design review went fine' }]
    })

    const insights = new Map<string, ProjectInsight>([
      [
        'p1',
        insight({
          status: 'waiting-on-client',
          clientAsk: {
            needsReply: true,
            urgency: 'high',
            lastClientMessage: null,
            openQuestions: ['any update on the mockups?']
          },
          recentLine: 'client asked about the mockups'
        })
      ]
    ])

    const items = await buildRecentFeed({
      monitorStore,
      deltaStore,
      getLastInsight: async (id) => insights.get(id) ?? null,
      now: new Date('2026-10-21T12:00:00Z')
    })

    expect(items).toHaveLength(2)
    // the workspace waiting on the client comes first
    expect(items[0].projectId).toBe('p1')
    expect(items[0].teamName).toBe('Workspace A')
    expect(items[0].needsReply).toBe(true)
    expect(items[0].oneLine).toBe('client asked about the mockups')
    expect(items[1].teamName).toBe('Workspace B')
    // every item names its workspace — never mixed
    expect(items.every((i) => i.teamName.length > 0)).toBe(true)
  })

  it('counts only meaningful messages since the last visit', async () => {
    const dir = await tmpDir()
    const monitorStore = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    const deltaStore = new DashboardDeltaStore({ rootDir: dir })
    await monitorStore.upsertProject({ project: project() })
    await deltaStore.appendMessages({
      profileId: 'manual:K1',
      teamId: 'T1',
      channelId: 'C1',
      channelName: 'general',
      messages: [
        { ts: '1788419200.000001', user: 'U1', text: 'old update about the mockups' },
        { ts: '1788419300.000001', user: 'U2', text: 'hiiiiiiiiiiiiiiii' },
        { ts: '1788419400.000001', user: 'U3', text: 'new update about the mockups' }
      ]
    })

    const items = await buildRecentFeed({
      monitorStore,
      deltaStore,
      getLastInsight: async () => null,
      getLastViewedAt: async () => new Date(1788419250 * 1000).toISOString(),
      now: new Date('2026-10-21T12:00:00Z')
    })

    expect(items[0].newMessages).toBe(1)
  })

  it('shows no new dot when the card has never been viewed', async () => {
    const dir = await tmpDir()
    const monitorStore = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    const deltaStore = new DashboardDeltaStore({ rootDir: dir })
    await monitorStore.upsertProject({ project: project() })
    await deltaStore.appendMessages({
      profileId: 'manual:K1',
      teamId: 'T1',
      channelId: 'C1',
      channelName: 'general',
      messages: [{ ts: '1788419200.000001', user: 'U1', text: 'update about the mockups' }]
    })

    const items = await buildRecentFeed({
      monitorStore,
      deltaStore,
      getLastInsight: async () => null,
      now: new Date('2026-10-21T12:00:00Z')
    })

    expect(items[0].newMessages).toBe(0)
  })

  it('never shows greeting noise as the recent line', async () => {
    const dir = await tmpDir()
    const monitorStore = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    const deltaStore = new DashboardDeltaStore({ rootDir: dir })
    await monitorStore.upsertProject({ project: project() })
    await deltaStore.appendMessages({
      profileId: 'manual:K1',
      teamId: 'T1',
      channelId: 'C1',
      channelName: 'general',
      messages: [{ ts: '1788419200.000001', user: 'U1', text: 'hiiiiiiiiiiiiiiii' }]
    })
    const items = await buildRecentFeed({
      monitorStore,
      deltaStore,
      getLastInsight: async () => null
    })
    expect(items[0].oneLine).not.toMatch(/^h+i+$/i)
  })
})

describe('digest', () => {
  it('builds a local digest naming the workspaces', () => {
    const digest = buildLocalDigest([
      {
        teamName: 'Workspace A',
        projectName: 'Acme',
        insight: insight({
          clientAsk: {
            needsReply: true,
            urgency: 'normal',
            lastClientMessage: null,
            openQuestions: []
          },
          nextStep: 'Reply to the client'
        })
      },
      { teamName: 'Workspace B', projectName: 'Beta', insight: null }
    ])
    expect(digest.source).toBe('local')
    expect(digest.needsReply).toEqual(['Workspace A'])
    expect(digest.topPriority).toContain('Workspace A')
  })

  it('keeps the workspaces separate in the prompt', () => {
    const prompt = buildDigestPrompt([
      { teamName: 'Workspace A', projectName: 'Acme', insight: insight() },
      { teamName: 'Workspace B', projectName: 'Beta', insight: insight() }
    ])
    expect(prompt).toContain('Workspace A')
    expect(prompt).toContain('Workspace B')
    expect(prompt).not.toContain('Workspace A (Workspace B)')
  })

  it('falls back to the local digest when the AI is unavailable', async () => {
    const dir = await tmpDir()
    const { readFile } = await import('node:fs/promises')
    const file = join(dir, 'digest.json')
    const store = {
      read: async () => {
        try {
          return JSON.parse(await readFile(file, 'utf8'))
        } catch {
          return null
        }
      },
      write: async (d: {
        topPriority: string
        needsReply: string[]
        atRisk: string[]
        atIso: string
        source: 'ai' | 'local'
      }) => {
        await writeFile(file, JSON.stringify(d), 'utf8')
      }
    }
    const digest = await refreshDigest({
      workspaces: [{ teamName: 'Workspace A', projectName: 'Acme', insight: insight() }],
      store,
      provider: null
    })
    expect(digest.source).toBe('local')
  })
})
