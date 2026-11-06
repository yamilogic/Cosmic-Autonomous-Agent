import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NimProvider } from '../../src/main/dashboard/ai-provider'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { HistoryStore } from '../../src/main/dashboard/history-store'
import { InsightEngine } from '../../src/main/dashboard/insight-engine'
import { buildWaiting } from '../../src/main/dashboard/metrics'
import { log } from '../../src/main/logging'
import type {
  DashboardProject,
  DashboardProjectSnapshot,
  ProjectInsight
} from '../../src/shared/dashboard-contract'

const dirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})))
  dirs.length = 0
})

async function tmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-audit-'))
  dirs.push(dir)
  return dir
}

function project(): DashboardProject {
  return {
    id: 'audit-p1',
    name: 'Audit Project',
    clientName: 'Acme',
    profileId: 'manual:AUDIT_KEY',
    teamId: 'T1',
    teamName: 'Audit Workspace',
    appId: 'slack',
    tokenSource: 'manual',
    manualTokenKey: 'AUDIT_KEY',
    monitors: [{ channelId: 'C1', channelName: 'general' }],
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

function snapshot(p: DashboardProject): DashboardProjectSnapshot {
  return {
    project: p,
    summary: '',
    newMessageCount: 0,
    totalMessageCount: 0,
    completion: 0,
    pace: 'on-track',
    mood: { state: 'neutral', signal: '' },
    extractedDates: {},
    effectiveDates: {},
    perChannel: [],
    lastUpdatedAt: '2026-10-25T00:00:00.000Z',
    syncState: 'idle'
  }
}

function insight(): ProjectInsight {
  return {
    status: 'on-track',
    statusReason: '',
    statusChange: '',
    mood: 'neutral',
    moodReason: '',
    moodQuote: '',
    progress: 30,
    progressEvidence: 'client said 30%',
    situationLine: '',
    recentLine: '',
    highlights: [],
    blockers: [],
    nextStep: '',
    dates: {},
    clientAsk: {
      needsReply: true,
      urgency: 'high',
      lastClientMessage: {
        who: 'Client',
        whenIso: '2026-10-24T10:00:00.000Z',
        quote: 'Can you send the updated deck?'
      },
      openQuestions: ['When is the review?']
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
  } as ProjectInsight
}

function providerStub(calls: { count: number }): NimProvider {
  return {
    chatJson: async () => {
      calls.count += 1
      return { data: {}, content: '{}', modelUsed: 'audit-model' }
    }
  } as unknown as NimProvider
}

describe('audit findings — expected to expose gaps', () => {
  it('security: logging must redact an NVIDIA key value and an apiKey field', () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })

    log.info('key check', {
      apiKey: 'nvapi-SECRET-1234',
      note: 'raw nvapi-SECRET-1234 in a message'
    })

    expect(lines.join('\n')).not.toContain('nvapi-SECRET-1234')
  })

  it('B5: only a row with a real Slack anchor claims it can jump', () => {
    const items = buildWaiting(insight()).items
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item.source, `${item.kind} has no source`).toBeTruthy()
      if (item.canJump) {
        expect(item.channelId).not.toBe('unknown')
        expect(item.ts, `${item.kind} can jump with no ts`).toBeTruthy()
        expect(item.ts).toMatch(/^\d{10}\.\d+$/)
      } else {
        // an ISO date stuffed into `ts` used to look jumpable and never matched
        expect(item.ts, `${item.kind} offers a ts it cannot jump to`).toBeUndefined()
      }
    }
  })

  it('B5: a row anchored to a real Slack message is jumpable', () => {
    const base = insight()
    const anchored = buildWaiting({
      ...base,
      clientAsk: {
        ...base.clientAsk,
        lastClientMessage: {
          ...base.clientAsk.lastClientMessage!,
          ts: '1761234567.000100',
          channelId: 'C1',
          permalink: 'https://acme.slack.com/archives/C1/p1761234567000100'
        }
      }
    } as ProjectInsight)
    const reply = anchored.items.find((item) => item.kind === 'needs-reply')
    expect(reply?.canJump).toBe(true)
    expect(reply?.ts).toBe('1761234567.000100')
    expect(reply?.channelId).toBe('C1')
  })

  it('E2: a quiet sync must make zero model calls when not forced', async () => {
    const dir = await tmpDir()
    const calls = { count: 0 }
    const p = project()
    const engine = new InsightEngine({
      provider: providerStub(calls),
      historyStore: new HistoryStore({ rootDir: dir }),
      deltaStore: new DashboardDeltaStore({ rootDir: dir })
    })

    await engine.refresh(p, 'xoxp-audit', snapshot(p))

    expect(calls.count).toBe(0)
  })

  it('E2: even a forced daily re-check must not call the model with zero new messages', async () => {
    const dir = await tmpDir()
    const calls = { count: 0 }
    const p = project()
    const engine = new InsightEngine({
      provider: providerStub(calls),
      historyStore: new HistoryStore({ rootDir: dir }),
      deltaStore: new DashboardDeltaStore({ rootDir: dir })
    })

    await engine.refresh(p, 'xoxp-audit', snapshot(p), { force: true })

    expect(calls.count).toBe(0)
  })
})
