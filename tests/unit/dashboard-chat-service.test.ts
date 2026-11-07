const fakeVault = {
  encrypt: (p: string) => Buffer.from(p).toString('base64'),
  decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8')
}
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import {
  DashboardChatService,
  MISSING_SCOPE_MESSAGE,
  NOT_CONNECTED_MESSAGE,
  selectChatPage,
  type ChatPoller,
  type ChatRow
} from '../../src/main/dashboard/chat-service'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

const dirs: string[] = []

function slackError(error: string): Error {
  const err = new Error(`slack chat.postMessage: ${error}`)
  ;(err as Error & { slackError?: string }).slackError = error
  return err
}

function fakePoller(overrides: Partial<ChatPoller> = {}): ChatPoller {
  return {
    authTest: async () => ({ valid: true, userId: 'U_SELF' }),
    usersList: async () =>
      new Map([
        ['U_SELF', 'Me'],
        ['U_CLIENT', 'Client Person'],
        ['U_CLIENT2', 'Dev Person']
      ]),
    postMessage: async (input) => ({ ts: '1700001000.000100', channelId: input.channelId }),
    ...overrides
  }
}

describe('DashboardChatService', () => {
  let dir: string
  let monitorStore: MonitorStore
  let deltaStore: DashboardDeltaStore
  let project: DashboardProject

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dash-chat-'))
    dirs.push(dir)
    monitorStore = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    deltaStore = new DashboardDeltaStore({ rootDir: join(dir, 'dashboard') })
    project = await monitorStore.upsertProject({
      project: {
        id: '',
        name: 'Acme',
        clientName: 'Client',
        profileId: 'pf1',
        teamId: 'T1',
        teamName: 'Acme Team',
        appId: 'slack',
        tokenSource: 'oauth',
        selfUserId: 'U_SELF',
        monitors: [
          { channelId: 'C1', channelName: 'general' },
          { channelId: 'C2', channelName: 'dev' }
        ]
      }
    })

    await deltaStore.appendMessages({
      profileId: 'pf1',
      teamId: 'T1',
      channelId: 'C1',
      channelName: 'general',
      messages: [
        { ts: '1700000000.000100', user: 'U_CLIENT', text: 'Hello' },
        { ts: '1700000100.000100', user: 'U_SELF', text: 'Hi there' },
        { ts: '1700000200.000100', user: '', text: '', subtype: 'channel_join' }
      ]
    })
    await deltaStore.appendMessages({
      profileId: 'pf1',
      teamId: 'T1',
      channelId: 'C2',
      channelName: 'dev',
      messages: [{ ts: '1700000050.000100', user: 'U_CLIENT2', text: 'From dev' }]
    })
  })

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true }).catch(() => {})))
    dirs.length = 0
  })

  function service(
    options: {
      token?: string | null
      scopes?: string[] | null
      poller?: ChatPoller
      now?: () => number
      teamWorkspace?: {
        getConnection(): Promise<{
          profileId: string
          teamId: string
          token: string | null
          channels: Array<{ channelId: string; channelName: string }>
        } | null>
      }
    } = {}
  ): DashboardChatService {
    return new DashboardChatService({
      monitorStore,
      deltaStore,
      oauthTokenProvider: {
        tryGet: async () => (options.token === undefined ? 'xoxp-test' : options.token)
      },
      oauthScopesProvider: async () =>
        options.scopes === undefined ? ['channels:read', 'chat:write'] : options.scopes,
      pollerFactory: () => options.poller ?? fakePoller(),
      now: options.now,
      teamWorkspace: options.teamWorkspace,
      log: () => undefined
    })
  }

  it('paginates rows newest-first without dropping the boundary', () => {
    const rows: ChatRow[] = ['1', '2', '3', '4'].map((ts) => ({
      channelId: 'C1',
      channelName: 'general',
      msg: { ts, text: `m${ts}` }
    }))

    const first = selectChatPage(rows, undefined, 2)
    expect(first.page).toEqual(rows.slice(-2))
    expect(first.hasMore).toBe(true)
    expect(first.nextBeforeTs).toBe('3')

    const older = selectChatPage(rows, first.nextBeforeTs ?? undefined, 2)
    expect(older.page).toEqual(rows.slice(0, 2))
    expect(older.hasMore).toBe(false)
    expect(older.nextBeforeTs).toBeNull()
  })

  it('loads all watched channels sorted by ts, resolving names and ownership', async () => {
    const page = await service().loadMessages({ projectId: project.id, limit: 10 })

    expect(page.messages.map((m) => m.text)).toEqual(['Hello', 'From dev', 'Hi there'])
    expect(page.messages.map((m) => m.channelName)).toEqual(['general', 'dev', 'general'])
    expect(page.messages.map((m) => m.userName)).toEqual(['Client Person', 'Dev Person', 'Me'])
    expect(page.messages.filter((m) => m.isMine).map((m) => m.text)).toEqual(['Hi there'])
    expect(page.hasMore).toBe(false)
    expect(page.nextBeforeTs).toBeNull()
  })

  it('filters by channel and pages backwards with beforeTs', async () => {
    const onlyDev = await service().loadMessages({
      projectId: project.id,
      channelId: 'C2',
      limit: 10
    })
    expect(onlyDev.messages.map((m) => m.text)).toEqual(['From dev'])

    const newestTwo = await service().loadMessages({ projectId: project.id, limit: 2 })
    expect(newestTwo.messages.map((m) => m.text)).toEqual(['From dev', 'Hi there'])
    expect(newestTwo.hasMore).toBe(true)

    const older = await service().loadMessages({
      projectId: project.id,
      beforeTs: newestTwo.nextBeforeTs ?? undefined,
      limit: 2
    })
    expect(older.messages.map((m) => m.text)).toEqual(['Hello'])
    expect(older.hasMore).toBe(false)
  })

  it('posts a reply, persists it locally, and returns it as mine', async () => {
    const postMessage = vi.fn(async (input: { channelId: string; text: string }) => ({
      ts: '1700001000.000200',
      channelId: input.channelId
    }))
    const svc = service({ poller: fakePoller({ postMessage }) })

    const result = await svc.sendMessage({
      projectId: project.id,
      channelId: 'C1',
      text: '  On it  '
    })

    expect(result.ok).toBe(true)
    expect(result.message).toMatchObject({
      ts: '1700001000.000200',
      channelName: 'general',
      text: 'On it',
      userName: 'Me',
      isMine: true
    })
    expect(postMessage).toHaveBeenCalledWith({
      token: 'xoxp-test',
      channelId: 'C1',
      text: 'On it'
    })

    const page = await svc.loadMessages({ projectId: project.id, channelId: 'C1', limit: 10 })
    expect(page.messages.some((m) => m.ts === '1700001000.000200')).toBe(true)
  })

  it('blocks sending when stored OAuth scopes lack chat:write', async () => {
    const postMessage = vi.fn()
    const svc = service({ scopes: ['channels:read'], poller: fakePoller({ postMessage }) })

    const result = await svc.sendMessage({
      projectId: project.id,
      channelId: 'C1',
      text: 'Hello'
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'missing_scope',
      missingScope: 'chat:write',
      error: MISSING_SCOPE_MESSAGE
    })
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('maps a runtime missing_scope error to the same clear message', async () => {
    const svc = service({
      scopes: null,
      poller: fakePoller({
        postMessage: async () => {
          throw slackError('missing_scope')
        }
      })
    })

    const result = await svc.sendMessage({
      projectId: project.id,
      channelId: 'C1',
      text: 'Hello'
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'missing_scope',
      error: MISSING_SCOPE_MESSAGE
    })
  })

  it('maps channel errors and missing tokens to actionable results', async () => {
    const channelError = await service({
      poller: fakePoller({
        postMessage: async () => {
          throw slackError('not_in_channel')
        }
      })
    }).sendMessage({ projectId: project.id, channelId: 'C1', text: 'Hello' })
    expect(channelError.code).toBe('channel_not_found')

    const unwatched = await service().sendMessage({
      projectId: project.id,
      channelId: 'C9',
      text: 'Hello'
    })
    expect(unwatched).toMatchObject({ ok: false, code: 'channel_not_found' })

    const noToken = await service({ token: null }).sendMessage({
      projectId: project.id,
      channelId: 'C1',
      text: 'Hello'
    })
    expect(noToken).toMatchObject({
      ok: false,
      code: 'not_connected',
      error: NOT_CONNECTED_MESSAGE
    })
  })

  it('rejects empty and oversized messages before calling Slack', async () => {
    const postMessage = vi.fn()
    const svc = service({ poller: fakePoller({ postMessage }) })

    expect(
      await svc.sendMessage({ projectId: project.id, channelId: 'C1', text: '   ' })
    ).toMatchObject({ ok: false, code: 'invalid_text' })
    expect(
      await svc.sendMessage({ projectId: project.id, channelId: 'C1', text: 'x'.repeat(4001) })
    ).toMatchObject({ ok: false, code: 'invalid_text' })
    expect(postMessage).not.toHaveBeenCalled()
  })

  describe('chatTokenStatus', () => {
    it('reports connected + canSend and a masked token when chat:write is granted', async () => {
      const status = await service().chatTokenStatus(project.id)
      expect(status).toMatchObject({
        connected: true,
        source: 'oauth',
        teamName: 'Acme Team',
        maskedToken: '••••test',
        canSend: true,
        missingWriteScope: false
      })
      expect(status.scopes).toContain('chat:write')
      expect(JSON.stringify(status)).not.toContain('xoxp-test')
    })

    it('flags missingWriteScope when stored OAuth scopes lack chat:write', async () => {
      const status = await service({ scopes: ['channels:read'] }).chatTokenStatus(project.id)
      expect(status).toMatchObject({
        connected: true,
        canSend: false,
        missingWriteScope: true
      })
    })

    it('leaves canSend null when no scope source reports scopes (manual tokens)', async () => {
      const status = await service({ scopes: null }).chatTokenStatus(project.id)
      expect(status).toMatchObject({
        connected: true,
        scopes: null,
        canSend: null,
        missingWriteScope: false
      })
    })

    it('reports not connected when no token exists', async () => {
      const status = await service({ token: null }).chatTokenStatus(project.id)
      expect(status).toMatchObject({
        connected: false,
        source: 'oauth',
        teamName: 'Acme Team',
        maskedToken: null,
        canSend: false
      })
    })

    it('defaults to source none for an unknown project', async () => {
      const status = await service().chatTokenStatus('nope')
      expect(status).toMatchObject({ connected: false, source: 'none', canSend: null })
    })
  })

  describe('projectActivity', () => {
    const ACTIVITY_NOW = 1_700_000_300_000

    it('reads the last 14 days and computes the ball in court', async () => {
      const activity = await service({ now: () => ACTIVITY_NOW }).projectActivity(project.id)

      expect(activity.recent.map((m) => m.text)).toEqual(['Hi there', 'From dev', 'Hello'])
      expect(activity.latestClientAt).toBe(new Date(1_700_000_050_000).toISOString())
      expect(activity.latestOursAt).toBe(new Date(1_700_000_100_000).toISOString())
      expect(activity.ballInCourt).toBe('client')
      expect(activity.channels[0]).toMatchObject({ channelName: 'general', count: 2 })
      expect(activity.counts14d).toEqual({ client: 3, ours: 0 })
      expect(activity.recent[0]).toMatchObject({
        source: 'client',
        userName: 'Me',
        isMine: true,
        channelName: 'general'
      })
    })

    it('ignores rows older than the 14-day window', async () => {
      await deltaStore.appendMessages({
        profileId: 'pf1',
        teamId: 'T1',
        channelId: 'C1',
        channelName: 'general',
        messages: [{ ts: '1600000000.000100', user: 'U_CLIENT', text: 'Ancient' }]
      })

      const activity = await service({ now: () => ACTIVITY_NOW }).projectActivity(project.id)
      expect(activity.recent.map((m) => m.text)).not.toContain('Ancient')
      expect(activity.counts14d).toEqual({ client: 3, ours: 0 })
    })

    it('restricts Our Slack rows to the channels mapped on the project', async () => {
      project = await monitorStore.upsertProject({
        project: {
          ...project,
          ourSlackChannels: [{ channelId: 'T1', channelName: 'team-one' }]
        }
      })
      for (const [channelId, channelName, text] of [
        ['T1', 'team-one', 'Mapped team note'],
        ['T2', 'team-other', 'Unmapped team note']
      ] as const) {
        await deltaStore.appendMessages({
          profileId: 'pf-team',
          teamId: 'TT',
          channelId,
          channelName,
          messages: [{ ts: '1700000250.000100', user: 'U_SELF', text }]
        })
      }

      const activity = await service({
        now: () => ACTIVITY_NOW,
        teamWorkspace: {
          getConnection: async () => ({
            profileId: 'pf-team',
            teamId: 'TT',
            token: 'xoxp-team',
            channels: [
              { channelId: 'T1', channelName: 'team-one' },
              { channelId: 'T2', channelName: 'team-other' }
            ]
          })
        }
      }).projectActivity(project.id)

      expect(activity.recent.map((m) => m.text)).toContain('Mapped team note')
      expect(activity.recent.map((m) => m.text)).not.toContain('Unmapped team note')
      expect(activity.counts14d.ours).toBe(1)
    })

    it('caches for 60 seconds and then re-reads', async () => {
      let now = ACTIVITY_NOW
      const svc = service({ now: () => now })
      const first = await svc.projectActivity(project.id)
      await deltaStore.appendMessages({
        profileId: 'pf1',
        teamId: 'T1',
        channelId: 'C2',
        channelName: 'dev',
        messages: [{ ts: '1700000280.000100', user: 'U_CLIENT2', text: 'Brand new' }]
      })

      const cached = await svc.projectActivity(project.id)
      expect(cached.recent.map((m) => m.text)).toEqual(first.recent.map((m) => m.text))

      now += 61_000
      const refreshed = await svc.projectActivity(project.id)
      expect(refreshed.recent[0].text).toBe('Brand new')
    })

    it('returns an empty activity for invalid or unknown projects', async () => {
      const svc = service({ now: () => ACTIVITY_NOW })
      for (const id of ['', '   ', 'nope']) {
        const activity = await svc.projectActivity(id)
        expect(activity).toEqual({
          recent: [],
          latestClientAt: null,
          latestOursAt: null,
          ballInCourt: null,
          participants: [],
          channels: [],
          counts14d: { client: 0, ours: 0 }
        })
      }
    })
  })
})
