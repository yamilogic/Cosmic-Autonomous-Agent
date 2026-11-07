const fakeVault = { encrypt: (p: string) => Buffer.from(p).toString('base64'), decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8') }
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { HistoryStore } from '../../src/main/dashboard/history-store'
import { InsightEngine } from '../../src/main/dashboard/insight-engine'
import { NimProvider } from '../../src/main/dashboard/ai-provider'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import { migrateWorkspaceCards } from '../../src/main/dashboard/workspace-migration'
import type {
  DashboardProject,
  DashboardProjectSnapshot
} from '../../src/shared/dashboard-contract'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})))
  dirs.length = 0
})

/** Write a legacy card straight into the store file (as old versions did). */
async function writeLegacyProject(
  rootDir: string,
  project: Record<string, unknown>
): Promise<void> {
  const { readFile, writeFile } = await import('node:fs/promises')
  const path = join(rootDir, 'monitors.json')
  let file: { projects: unknown[]; manualTokens: Record<string, string> } = {
    projects: [],
    manualTokens: {}
  }
  try {
    file = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    /* fresh file */
  }
  file.projects.push(project)
  await writeFile(path, JSON.stringify(file, null, 2), 'utf8')
}

async function tmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-v22-'))
  dirs.push(dir)
  return dir
}

function project(overrides: Partial<DashboardProject> = {}): DashboardProject {
  return {
    id: 'p1',
    name: 'Acme Website Redesign',
    clientName: 'Acme',
    profileId: 'manual:DASH_TOKEN_ACME',
    teamId: 'T1',
    teamName: 'Workspace A',
    appId: 'slack',
    tokenSource: 'manual',
    manualTokenKey: 'DASH_TOKEN_ACME',
    monitors: [{ channelId: 'C1', channelName: 'general' }],
    createdAt: new Date().toISOString(),
    ...overrides
  }
}

function snapshot(p: DashboardProject): DashboardProjectSnapshot {
  return {
    project: p,
    summary: 'client asked for the mockups\ndesign review tomorrow',
    newMessageCount: 2,
    totalMessageCount: 12,
    completion: 40,
    pace: 'on-track',
    mood: { state: 'good', signal: 'client replied' },
    extractedDates: {},
    effectiveDates: {},
    perChannel: [],
    lastUpdatedAt: new Date().toISOString(),
    syncState: 'idle'
  }
}

async function seedMessages(store: DashboardDeltaStore, p: DashboardProject): Promise<void> {
  await store.appendMessages({
    profileId: p.profileId,
    teamId: p.teamId,
    channelId: p.monitors[0].channelId,
    channelName: p.monitors[0].channelName,
    messages: [
      { ts: '1700000001.000001', user: 'U1', text: 'client asks: when demo?' },
      { ts: '1700000002.000002', user: 'U2', text: 'we reply friday' }
    ]
  })
}

describe('InsightEngine — graceful degradation', () => {
  it('falls back to heuristics when NVIDIA NIM is not configured', async () => {
    const dir = await tmpDir()
    const deltaStore = new DashboardDeltaStore({ rootDir: dir })
    const historyStore = new HistoryStore({ rootDir: dir })
    const p = project()
    await seedMessages(deltaStore, p)

    const engine = new InsightEngine({
      provider: null,
      historyStore,
      deltaStore
    })
    const out = await engine.refresh(p, 'xoxp-token', snapshot(p))

    expect(out.insight).toBeTruthy()
    expect(out.insightSource).toBe('heuristic')
    expect(out.insight?.progress).toBe(40)
    expect(out.insight?.situationLine).toContain('client asked for the mockups')

    const history = await historyStore.read(p.id)
    expect(history).toHaveLength(1)
    expect(history[0].source).toBe('heuristic')
  })

  it('falls back to heuristics when the NIM call fails', async () => {
    const dir = await tmpDir()
    const deltaStore = new DashboardDeltaStore({ rootDir: dir })
    const historyStore = new HistoryStore({ rootDir: dir })
    const p = project()
    await seedMessages(deltaStore, p)

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
      const engine = new InsightEngine({ provider, historyStore, deltaStore })
      const out = await engine.refresh(p, 'xoxp-token', snapshot(p))
      expect(out.insightSource).toBe('heuristic')
      expect(out.insight).toBeTruthy()
    } finally {
      globalThis.fetch = oldFetch
    }
  })

  it('uses the LLM insight when the model answers with valid JSON', async () => {
    const dir = await tmpDir()
    const deltaStore = new DashboardDeltaStore({ rootDir: dir })
    const historyStore = new HistoryStore({ rootDir: dir })
    const p = project()
    await seedMessages(deltaStore, p)

    const provider = new NimProvider({
      apiKey: 'k',
      modelPrimary: 'primary',
      baseUrl: 'http://_FAKE'
    })
    const oldFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: 'primary',
          choices: [
            {
              message: {
                content:
                  '{"status":"at-risk","mood":"tense","progress":42,"situationLine":"client waits for mockups","nextStep":"send mockups"}'
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as unknown as typeof fetch
    try {
      const engine = new InsightEngine({ provider, historyStore, deltaStore })
      const out = await engine.refresh(p, 'xoxp-token', snapshot(p))
      expect(out.insightSource).toBe('ai')
      expect(out.insightModel).toBe('primary')
      expect(out.insight?.status).toBe('at-risk')
      expect(out.insight?.progress).toBe(42)
      expect(out.insight?.situationLine).toBe('client waits for mockups')
    } finally {
      globalThis.fetch = oldFetch
    }
  })
})

describe('NimProvider.chatJson', () => {
  it('retries once when the reply is not JSON', async () => {
    const provider = new NimProvider({
      apiKey: 'k',
      modelPrimary: 'primary',
      baseUrl: 'http://_FAKE'
    })
    let calls = 0
    const oldFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      calls += 1
      const content = calls === 1 ? 'sorry, no json here' : '{"status":"on-track","progress":10}'
      return new Response(
        JSON.stringify({ model: 'primary', choices: [{ message: { content } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }) as unknown as typeof fetch
    try {
      const res = await provider.chatJson([{ role: 'user', content: 'go' }])
      expect(calls).toBe(2)
      expect(res.data.status).toBe('on-track')
    } finally {
      globalThis.fetch = oldFetch
    }
  })
})

describe('MonitorStore — one workspace per card', () => {
  async function store(): Promise<MonitorStore> {
    const dir = await tmpDir()
    return new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
  }

  it('stamps the workspace from the vault metadata', async () => {
    const s = await store()
    await s.saveManualToken('DASH_TOKEN_ACME', 'xoxp-1', {
      teamId: 'T1',
      teamName: 'Workspace A'
    })
    const created = await s.upsertProject({
      project: {
        name: 'Acme',
        clientName: 'Acme',
        profileId: 'manual:DASH_TOKEN_ACME',
        teamId: 'manual',
        appId: 'slack',
        tokenSource: 'manual',
        manualTokenKey: 'DASH_TOKEN_ACME',
        monitors: [{ channelId: 'C1', channelName: 'general' }]
      }
    })
    expect(created.teamId).toBe('T1')
    expect(created.teamName).toBe('Workspace A')
  })

  it('rejects a channel that belongs to another workspace', async () => {
    const s = await store()
    await s.upsertProject({
      project: {
        name: 'Acme',
        clientName: 'Acme',
        profileId: 'manual:KEY_A',
        teamId: 'T1',
        teamName: 'Workspace A',
        appId: 'slack',
        tokenSource: 'manual',
        manualTokenKey: 'KEY_A',
        monitors: [{ channelId: 'C1', channelName: 'general' }]
      }
    })
    await expect(
      s.upsertProject({
        project: {
          name: 'Other',
          clientName: 'Other',
          profileId: 'manual:KEY_B',
          teamId: 'T2',
          teamName: 'Workspace B',
          appId: 'slack',
          tokenSource: 'manual',
          manualTokenKey: 'KEY_B',
          monitors: [{ channelId: 'C1', channelName: 'general' }]
        }
      })
    ).rejects.toThrow(/another workspace/)
  })

  it('rejects moving an existing card to another workspace', async () => {
    const s = await store()
    const created = await s.upsertProject({
      project: {
        name: 'Acme',
        clientName: 'Acme',
        profileId: 'manual:KEY_A',
        teamId: 'T1',
        teamName: 'Workspace A',
        appId: 'slack',
        tokenSource: 'manual',
        manualTokenKey: 'KEY_A',
        monitors: []
      }
    })
    await expect(
      s.upsertProject({
        project: {
          ...created,
          teamId: 'T2',
          teamName: 'Workspace B'
        }
      })
    ).rejects.toThrow(/one workspace/i)
  })
})

describe('workspace migration', () => {
  it('splits a mixed card into one card per workspace', async () => {
    const dir = await tmpDir()
    const store = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    // legacy card: written by an old version, before workspaces were stamped
    await writeLegacyProject(dir, {
      id: 'legacy-1',
      name: 'Mixed',
      clientName: 'Mixed',
      profileId: 'manual:KEY_A',
      teamId: 'manual',
      appId: 'slack',
      tokenSource: 'manual',
      manualTokenKey: 'KEY_A',
      monitors: [
        { channelId: 'CA', channelName: 'a-channel' },
        { channelId: 'CB', channelName: 'b-channel' }
      ],
      createdAt: new Date().toISOString()
    })

    await store.saveManualToken('KEY_A', 'xoxp-a', { teamId: 'T1', teamName: 'Workspace A' })
    await store.saveManualToken('KEY_B', 'xoxp-b', { teamId: 'T2', teamName: 'Workspace B' })

    const result = await migrateWorkspaceCards({
      monitorStore: store,
      listTokenKeys: async () => ['KEY_A', 'KEY_B'],
      resolveTokenMeta: async (key) =>
        key === 'KEY_A'
          ? { teamId: 'T1', teamName: 'Workspace A' }
          : { teamId: 'T2', teamName: 'Workspace B' },
      listChannelsForKey: async (key) =>
        key === 'KEY_A' ? [{ id: 'CA', name: 'a-channel' }] : [{ id: 'CB', name: 'b-channel' }]
    })

    expect(result.split).toBe(1)
    const projects = await store.listProjects()
    expect(projects).toHaveLength(2)
    const a = projects.find((p) => p.teamId === 'T1')
    const b = projects.find((p) => p.teamId === 'T2')
    expect(a?.teamName).toBe('Workspace A')
    expect(a?.monitors.map((m) => m.channelId)).toEqual(['CA'])
    expect(b?.teamName).toBe('Workspace B')
    expect(b?.monitors.map((m) => m.channelId)).toEqual(['CB'])
    expect(b?.name).toContain('Workspace B')
  })

  it('stamps a legacy card that only watches one workspace', async () => {
    const dir = await tmpDir()
    const store = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    await writeLegacyProject(dir, {
      id: 'legacy-2',
      name: 'Legacy',
      clientName: 'Legacy',
      profileId: 'manual:KEY_A',
      teamId: 'manual',
      appId: 'slack',
      tokenSource: 'manual',
      manualTokenKey: 'KEY_A',
      monitors: [{ channelId: 'CA', channelName: 'a-channel' }],
      createdAt: new Date().toISOString()
    })

    await store.saveManualToken('KEY_A', 'xoxp-a', { teamId: 'T1', teamName: 'Workspace A' })

    const result = await migrateWorkspaceCards({
      monitorStore: store,
      listTokenKeys: async () => ['KEY_A'],
      resolveTokenMeta: async () => ({ teamId: 'T1', teamName: 'Workspace A' }),
      listChannelsForKey: async () => [{ id: 'CA', name: 'a-channel' }]
    })

    expect(result.stamped).toBe(1)
    const [card] = await store.listProjects()
    expect(card.teamName).toBe('Workspace A')
    expect(card.teamId).toBe('T1')
  })

  it('does nothing when every card already knows its workspace', async () => {
    const dir = await tmpDir()
    const store = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    await store.upsertProject({
      project: {
        name: 'Clean',
        clientName: 'Clean',
        profileId: 'manual:KEY_A',
        teamId: 'T1',
        teamName: 'Workspace A',
        appId: 'slack',
        tokenSource: 'manual',
        manualTokenKey: 'KEY_A',
        selfUserId: 'U_ME',
        monitors: []
      }
    })
    let called = false
    const result = await migrateWorkspaceCards({
      monitorStore: store,
      listTokenKeys: async () => ['KEY_A'],
      resolveTokenMeta: async () => ({ teamId: 'T1', teamName: 'Workspace A' }),
      listChannelsForKey: async () => {
        called = true
        return []
      }
    })
    expect(called).toBe(false)
    expect(result.untouched).toBe(1)
  })
})

describe('one card = one workspace (hard rule)', () => {
  it('refuses to store a card without a real workspace', async () => {
    const dir = await tmpDir()
    const store = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    await expect(
      store.upsertProject({
        project: {
          name: 'No workspace',
          clientName: 'No workspace',
          profileId: 'manual:K1',
          teamId: 'manual',
          appId: 'slack',
          tokenSource: 'manual',
          manualTokenKey: 'K1',
          monitors: [{ channelId: 'C1', channelName: 'general' }]
        }
      })
    ).rejects.toThrow(/workspace unknown/i)
    expect(await store.listProjects()).toHaveLength(0)
  })

  it('stamps the workspace from the vault metadata when it is missing', async () => {
    const dir = await tmpDir()
    const store = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    await store.saveManualToken('K1', 'xoxp-1', { teamId: 'T1', teamName: 'Workspace A' })
    const created = await store.upsertProject({
      project: {
        name: 'Acme',
        clientName: 'Acme',
        profileId: 'manual:K1',
        teamId: 'manual',
        appId: 'slack',
        tokenSource: 'manual',
        manualTokenKey: 'K1',
        monitors: [{ channelId: 'C1', channelName: 'general' }]
      }
    })
    expect(created.teamId).toBe('T1')
    expect(created.teamName).toBe('Workspace A')
  })
})
