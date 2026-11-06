const fakeVault = { encrypt: (p: string) => Buffer.from(p).toString('base64'), decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8') }
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NimProvider } from '../../src/main/dashboard/ai-provider'
import { buildInsightMessages, mergeInsight } from '../../src/main/dashboard/insights'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { DashboardSyncEngine } from '../../src/main/dashboard/sync-engine'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})))
  dirs.length = 0
})

async function tmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-card-'))
  dirs.push(dir)
  return dir
}

describe('NimProvider request shape', () => {
  it('disables the reasoning trace so the model always answers', async () => {
    const provider = new NimProvider({
      apiKey: 'k',
      modelPrimary: 'primary',
      baseUrl: 'http://_FAKE'
    })
    let body: Record<string, unknown> = {}
    const oldFetch = globalThis.fetch
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String((init as RequestInit).body))
      return new Response(
        JSON.stringify({ model: 'primary', choices: [{ message: { content: '{}' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof fetch
    try {
      await provider.chat([{ role: 'user', content: 'hi' }])
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
      expect(body.max_tokens).toBe(2000)
    } finally {
      globalThis.fetch = oldFetch
    }
  })

  it('keeps thinking on when explicitly enabled', async () => {
    const provider = new NimProvider({
      apiKey: 'k',
      modelPrimary: 'primary',
      baseUrl: 'http://_FAKE',
      enableThinking: true,
      maxTokens: 6000
    })
    let body: Record<string, unknown> = {}
    const oldFetch = globalThis.fetch
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String((init as RequestInit).body))
      return new Response(
        JSON.stringify({ model: 'primary', choices: [{ message: { content: '{}' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof fetch
    try {
      await provider.chat([{ role: 'user', content: 'hi' }])
      expect(body.chat_template_kwargs).toBeUndefined()
      expect(body.max_tokens).toBe(6000)
    } finally {
      globalThis.fetch = oldFetch
    }
  })

  it('reports both the primary and the fallback failure', async () => {
    const provider = new NimProvider({
      apiKey: 'k',
      modelPrimary: 'primary',
      modelFallback: 'fallback',
      baseUrl: 'http://_FAKE'
    })
    const oldFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('boom', { status: 500 })) as unknown as typeof fetch
    try {
      await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
        /primary failed.*fallback failed/s
      )
    } finally {
      globalThis.fetch = oldFetch
    }
  })
})

describe('insight prompt', () => {
  it('documents every card field and the decision rules', () => {
    const msgs = buildInsightMessages({
      projectName: 'P',
      workspaceName: 'W',
      previous: null,
      newCount: 1,
      newMessages: [{ ts: '2026-10-21T10:00:00Z', who: 'Client', text: 'hi', isClient: true }]
    })
    const system = msgs[0].content
    for (const key of [
      'statusReason',
      'progressEvidence',
      'moodReason',
      'moodQuote',
      'situationLine',
      'highlights',
      'blockers',
      'needsReply',
      'urgency',
      'openQuestions',
      'nextStep',
      'commitments',
      'decisions',
      'risks',
      'keywords'
    ]) {
      expect(system).toContain(key)
    }
    expect(system).toContain('DECISION RULES')
    expect(system).toContain('ONLY the JSON object')
  })

  it('carries the previous insight and only the new messages', () => {
    const msgs = buildInsightMessages({
      projectName: 'P',
      workspaceName: 'W',
      previous: null,
      newCount: 2,
      newMessages: [
        { ts: '2026-10-21T10:00:00Z', who: 'Client', text: 'when demo?', isClient: true },
        { ts: '2026-10-21T10:05:00Z', who: 'Me', text: 'friday', isClient: false }
      ]
    })
    expect(msgs[1].content).toContain('(CLIENT)')
    expect(msgs[1].content).toContain('when demo?')
    expect(msgs[1].content).toContain('none (first insight)')
  })

  it('adds the channel name for context (never the channel id)', () => {
    const msgs = buildInsightMessages({
      projectName: 'P',
      workspaceName: 'W',
      previous: null,
      newCount: 1,
      newMessages: [
        {
          ts: '2026-10-21T10:00:00Z',
          who: 'Client',
          text: 'hi',
          isClient: true,
          channel: 'dev-support'
        }
      ]
    })
    expect(msgs[1].content).toContain('#dev-support')
    expect(msgs[1].content).not.toContain('C0')
  })
})

describe('insight merge — evidence rules', () => {
  it('keeps a quote that exists in the chat', () => {
    const merged = mergeInsight(
      {
        status: 'waiting-on-client',
        mood: 'tense',
        moodQuote: 'is we are ready ?/',
        clientAsk: {
          needsReply: true,
          urgency: 'high',
          lastClientMessage: {
            who: 'rajesh',
            whenIso: '2026-10-21T10:00:00Z',
            quote: 'is we are ready ?/'
          },
          openQuestions: ['is we are ready ?/']
        }
      },
      null,
      ['is we are ready ?/']
    )
    expect(merged.moodQuote).toBe('is we are ready ?/')
    expect(merged.clientAsk.lastClientMessage?.quote).toBe('is we are ready ?/')
    expect(merged.clientAsk.urgency).toBe('high')
    expect(merged.clientAsk.openQuestions).toEqual(['is we are ready ?/'])
  })

  it('drops a quote the model invented', () => {
    const merged = mergeInsight(
      {
        moodQuote: 'this was never said in the chat',
        clientAsk: { needsReply: true, lastClientMessage: { who: 'x', quote: 'invented quote' } }
      },
      null,
      ['is we are ready ?/']
    )
    expect(merged.moodQuote).toBe('')
    expect(merged.clientAsk.lastClientMessage).toBeNull()
  })

  it('normalizes highlight strings into objects and caps them at three', () => {
    const merged = mergeInsight({ highlights: ['one', 'two', 'three', 'four'] }, null)
    expect(merged.highlights).toHaveLength(3)
    expect(merged.highlights[0]).toEqual({ what: 'one' })
  })

  it('keeps structured highlights with who and when', () => {
    const merged = mergeInsight(
      {
        highlights: [{ what: 'scope confirmed', who: 'rajesh', whenIso: '2026-10-21T10:00:00Z' }]
      },
      null
    )
    expect(merged.highlights[0].who).toBe('rajesh')
    expect(merged.highlights[0].whenIso).toBe('2026-10-21T10:00:00Z')
  })

  it('rejects an invalid date and keeps the previous one', () => {
    const first = mergeInsight({ dates: { startDate: '2026-03-01' } }, null)
    const second = mergeInsight({ dates: { startDate: 'March 3rd' } }, first)
    expect(second.dates.startDate).toBe('2026-03-01')
  })

  it('carries over unmapped fields and keeps blockers structured', () => {
    const first = mergeInsight(
      { blockers: [{ what: 'waiting on assets', owner: 'client' }], risks: ['scope creep'] },
      null
    )
    const second = mergeInsight({ status: 'on-track' }, first)
    expect(second.status).toBe('on-track')
    expect(second.blockers[0].owner).toBe('client')
    expect(second.risks).toEqual(['scope creep'])
  })
})

describe('cold start snapshot', () => {
  it('summarizes stored messages before the first network sync', async () => {
    const dir = await tmpDir()
    const monitorStore = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    const deltaStore = new DashboardDeltaStore({ rootDir: dir })
    const project: DashboardProject = {
      id: 'p1',
      name: 'Acme',
      clientName: 'Acme',
      profileId: 'manual:K1',
      teamId: 'T1',
      appId: 'slack',
      tokenSource: 'manual',
      manualTokenKey: 'K1',
      monitors: [{ channelId: 'C1', channelName: 'general' }],
      createdAt: new Date().toISOString()
    }
    await monitorStore.upsertProject({ project })
    await deltaStore.appendMessages({
      profileId: project.profileId,
      teamId: project.teamId,
      channelId: 'C1',
      channelName: 'general',
      messages: [
        { ts: '1788419219.097329', user: 'U1', text: 'client asked for the mockups' },
        { ts: '1788419300.000000', user: 'U2', text: 'we will send them tomorrow' }
      ]
    })

    const engine = new DashboardSyncEngine({
      monitorStore,
      deltaStore,
      oauthTokenProvider: { tryGet: async () => null }
    })
    const [snapshot] = await engine.buildSnapshot()
    expect(snapshot.totalMessageCount).toBe(2)
    expect(snapshot.summary).toContain('client asked for the mockups')
    expect(snapshot.perChannel[0].messageCount).toBe(2)
  })
})

describe('card view-model (three zones)', () => {
  const base = {
    project: {
      id: 'p1',
      name: 'Acme',
      clientName: 'Acme',
      profileId: 'manual:K1',
      teamId: 'T1',
      teamName: 'Workspace A',
      appId: 'slack' as const,
      tokenSource: 'manual' as const,
      manualTokenKey: 'K1',
      monitors: [{ channelId: 'C1', channelName: 'general' }],
      createdAt: new Date().toISOString()
    },
    summary: 'client asked for mockups\ndesign review tomorrow',
    newMessageCount: 3,
    totalMessageCount: 12,
    completion: 40,
    pace: 'on-track' as const,
    mood: { state: 'good' as const, signal: 'client replied' },
    extractedDates: {},
    effectiveDates: { startDate: '2026-03-01', endDate: '2026-11-10' },
    perChannel: [
      {
        channelId: 'C1',
        channelName: 'general',
        messageCount: 12,
        newMessageCount: 3,
        latestMessageAt: '2026-10-21T10:00:00Z',
        cursor: '1788419219.000001',
        lastSyncAt: '2026-10-21T10:00:00Z'
      },
      {
        channelId: 'C2',
        channelName: 'dev-support',
        messageCount: 4,
        newMessageCount: 0,
        latestMessageAt: '2026-10-21T09:00:00Z',
        cursor: '1788419100.000001',
        lastSyncAt: '2026-10-21T10:00:00Z'
      }
    ],
    lastUpdatedAt: new Date().toISOString(),
    syncState: 'idle' as const
  }

  it('falls back to the heuristics when there is no insight', async () => {
    const { buildCardView } = await import('../../src/renderer/src/components/dashboard/card-view')
    const view = buildCardView(base, 0)
    expect(view.centre.status).toBeNull()
    expect(view.identity.progress).toBe(40)
    expect(view.identity.mood).toBe('good')
    expect(view.centre.situationLine).toBe('client asked for mockups')
    expect(view.identity.channels[0].newCount).toBe(3)
    expect(view.identity.channels[1].newCount).toBe(0)
    expect(view.identity.dates.badge).toBe('not stated in chat')
    expect(view.identity.teamName).toBe('Workspace A')
    expect(view.aiBadge).toBe('no insight yet')
  })

  it('lets the AI insight win over the heuristics', async () => {
    const { buildCardView } = await import('../../src/renderer/src/components/dashboard/card-view')
    const view = buildCardView({
      ...base,
      insight: {
        status: 'at-risk',
        statusReason: 'client waits for the mockups',
        statusChange: 'on-track → at-risk',
        mood: 'tense',
        moodReason: 'asked twice',
        moodQuote: 'any update?',
        progress: 62,
        progressEvidence: 'mockups sent',
        situationLine: 'Waiting on the client.',
        recentLine: 'client asked again about the mockups',
        highlights: [{ what: 'scope confirmed', who: 'rajesh', whenIso: '2026-10-21T10:00:00Z' }],
        blockers: [{ what: 'assets', owner: 'client' }],
        nextStep: 'Send the mockups',
        dates: { startDate: '2026-03-03', endDate: '2026-11-10', evidence: 'deadline is Nov 10' },
        clientAsk: {
          needsReply: true,
          urgency: 'high',
          lastClientMessage: {
            who: 'rajesh',
            whenIso: '2026-10-21T10:00:00Z',
            quote: 'any update?'
          },
          openQuestions: ['any update?']
        },
        commitments: [],
        decisions: [],
        risks: ['scope creep'],
        keywords: ['mockups'],
        requirements: [],
        scope: { in: [], out: [] },
        deliverables: [],
        files: [],
        people: [],
        milestones: []
      },
      insightSource: 'ai',
      insightUpdatedAt: new Date().toISOString()
    })
    expect(view.centre.status).toBe('at-risk')
    expect(view.centre.statusChange).toBe('on-track → at-risk')
    expect(view.identity.progress).toBe(62)
    expect(view.identity.mood).toBe('tense')
    expect(view.centre.needsReply).toBe(true)
    expect(view.centre.urgency).toBe('high')
    expect(view.centre.nextStep).toBe('Send the mockups')
    expect(view.centre.recentLine ?? view.centre.situationLine).toBeTruthy()
    expect(view.identity.dates.badge).toBe('from chat')
    expect(view.identity.dates.startDate).toBe('2026-03-03')
    expect(view.detail.hasMoreDetail).toBe(true)
    expect(view.aiBadge).toContain('AI')
  })
})

describe('cold start — the AI insight is shown without a sync', () => {
  it('attaches the last stored insight to the snapshot', async () => {
    const { mkdtemp: mk, rm: rmDir } = await import('node:fs/promises')
    const { tmpdir: tmp } = await import('node:os')
    const { join: joinPath } = await import('node:path')
    const { MonitorStore: MS } = await import('../../src/main/dashboard/monitor-store')
    const { DashboardDeltaStore: DS } = await import('../../src/main/dashboard/delta-store')
    const { DashboardSyncEngine: SE } = await import('../../src/main/dashboard/sync-engine')
    const dir = await mk(joinPath(tmp(), 'dash-cold-'))
    try {
      const monitorStore = new MS({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
      const deltaStore = new DS({ rootDir: dir })
      await monitorStore.upsertProject({
        project: {
          id: 'p1',
          name: 'Acme',
          clientName: 'Acme',
          profileId: 'manual:K1',
          teamId: 'T1',
          teamName: 'Workspace A',
          appId: 'slack',
          tokenSource: 'manual',
          manualTokenKey: 'K1',
          monitors: [{ channelId: 'C1', channelName: 'general' }]
        }
      })
      const insight = {
        status: 'waiting-on-client' as const,
        statusReason: 'client asked',
        statusChange: '',
        mood: 'neutral' as const,
        moodReason: '',
        moodQuote: '',
        progress: 20,
        progressEvidence: 'asked',
        situationLine: 'client asked whether we are ready',
        recentLine: 'client asked whether we are ready',
        highlights: [],
        blockers: [],
        nextStep: 'reply',
        dates: {},
        clientAsk: {
          needsReply: true,
          urgency: 'normal' as const,
          lastClientMessage: null,
          openQuestions: []
        },
        commitments: [],
        decisions: [],
        risks: [],
        keywords: [],
        requirements: [],
        scope: { in: [], out: [] },
        deliverables: [],
        files: [],
        people: [],
        milestones: []
      }
      const engine = new SE({
        monitorStore,
        deltaStore,
        oauthTokenProvider: { tryGet: async () => null },
        insightReader: {
          getLastInsight: async () => insight,
          getLastEntry: async () => ({
            atIso: new Date().toISOString(),
            newMessageCount: 4,
            insight,
            source: 'ai' as const,
            model: 'nvidia/nemotron-3.5-super-vl-120b-a12b'
          })
        }
      })
      const [snapshot] = await engine.buildSnapshot()
      expect(snapshot.insight).toBeTruthy()
      expect(snapshot.insight?.status).toBe('waiting-on-client')
      expect(snapshot.insightSource).toBe('ai')
      expect(snapshot.insightModel).toBe('nvidia/nemotron-3.5-super-vl-120b-a12b')
    } finally {
      await rmDir(dir, { recursive: true, force: true }).catch(() => {})
    }
  })
})

describe('cached snapshot also carries the latest insight', () => {
  it('refreshes the insight on a cached snapshot', async () => {
    const { mkdtemp: mk, rm: rmDir } = await import('node:fs/promises')
    const { tmpdir: tmp } = await import('node:os')
    const { join: joinPath } = await import('node:path')
    const { MonitorStore: MS } = await import('../../src/main/dashboard/monitor-store')
    const { DashboardDeltaStore: DS } = await import('../../src/main/dashboard/delta-store')
    const { DashboardSyncEngine: SE } = await import('../../src/main/dashboard/sync-engine')
    const dir = await mk(joinPath(tmp(), 'dash-cached-'))
    try {
      const monitorStore = new MS({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
      const deltaStore = new DS({ rootDir: dir })
      await monitorStore.upsertProject({
        project: {
          id: 'p1',
          name: 'Acme',
          clientName: 'Acme',
          profileId: 'manual:K1',
          teamId: 'T1',
          teamName: 'Workspace A',
          appId: 'slack',
          tokenSource: 'manual',
          manualTokenKey: 'K1',
          monitors: [{ channelId: 'C1', channelName: 'general' }]
        }
      })
      const insight = {
        status: 'at-risk' as const,
        statusReason: 'r',
        statusChange: '',
        mood: 'neutral' as const,
        moodReason: '',
        moodQuote: '',
        progress: 55,
        progressEvidence: '',
        situationLine: 'slipping',
        recentLine: 'slipping',
        highlights: [],
        blockers: [],
        nextStep: '',
        dates: {},
        clientAsk: {
          needsReply: false,
          urgency: 'normal' as const,
          lastClientMessage: null,
          openQuestions: []
        },
        commitments: [],
        decisions: [],
        risks: [],
        keywords: [],
        requirements: [],
        scope: { in: [], out: [] },
        deliverables: [],
        files: [],
        people: [],
        milestones: []
      }
      const engine = new SE({
        monitorStore,
        deltaStore,
        oauthTokenProvider: { tryGet: async () => null },
        insightReader: {
          getLastInsight: async () => insight,
          getLastEntry: async () => ({
            atIso: new Date().toISOString(),
            newMessageCount: 1,
            insight,
            source: 'ai' as const
          })
        }
      })
      // first call fills the cache, second call must still carry the insight
      const [first] = await engine.buildSnapshot()
      expect(first.insight?.status).toBe('at-risk')
      const [second] = await engine.buildSnapshot()
      expect(second.insight?.status).toBe('at-risk')
    } finally {
      await rmDir(dir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
