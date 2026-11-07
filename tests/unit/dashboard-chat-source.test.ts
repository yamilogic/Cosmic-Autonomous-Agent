const fakeVault = { encrypt: (p: string) => Buffer.from(p).toString('base64'), decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8') }
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import {
  DashboardChatService,
  type ChatPoller
} from '../../src/main/dashboard/chat-service'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true }).catch(() => {})))
  dirs.length = 0
})

const poller: ChatPoller = {
  authTest: async () => ({ valid: true, userId: 'U_SELF' }),
  usersList: async () =>
    new Map([
      ['U_SELF', 'Me'],
      ['U_CLIENT', 'Client Person'],
      ['U_TEAM', 'Team Person']
    ]),
  postMessage: async (input) => ({ ts: '999.0', channelId: input.channelId })
}

async function setup(): Promise<{
  service: DashboardChatService
  monitorStore: MonitorStore
  delta: DashboardDeltaStore
  projectId: string
}> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-chat-src-'))
  dirs.push(dir)
  const monitorStore = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
  const delta = new DashboardDeltaStore({ rootDir: dir })
  const project = await monitorStore.upsertProject({
    project: {
      id: '',
      name: 'Acme',
      clientName: 'Client',
      profileId: 'pf_client',
      teamId: 'T_CLIENT',
      appId: 'slack',
      tokenSource: 'oauth',
      monitors: [{ channelId: 'C_CLIENT', channelName: 'client-dev' }]
    }
  })

  await delta.appendMessages({
    profileId: 'pf_client',
    teamId: 'T_CLIENT',
    channelId: 'C_CLIENT',
    channelName: 'client-dev',
    source: 'client',
    messages: [{ ts: '100.0', user: 'U_CLIENT', text: 'client-only message' }]
  })
  await delta.appendMessages({
    profileId: 'pf_team',
    teamId: 'T_TEAM',
    channelId: 'C_TEAM',
    channelName: 'team-project',
    source: 'ours',
    messages: [{ ts: '200.0', user: 'U_TEAM', text: 'team-only message' }]
  })

  const service = new DashboardChatService({
    monitorStore,
    deltaStore: delta,
    oauthTokenProvider: { tryGet: async () => 'xoxp-client' },
    teamWorkspace: {
      getConnection: async () => ({
        profileId: 'pf_team',
        teamId: 'T_TEAM',
        token: 'xoxp-team',
        channels: [{ channelId: 'C_TEAM', channelName: 'team-project' }]
      })
    },
    pollerFactory: () => poller
  })

  return { service, monitorStore, delta, projectId: project.id }
}

describe('DashboardChatService — source isolation', () => {
  it('reads only the client workspace by default', async () => {
    const { service, projectId } = await setup()
    const page = await service.loadMessages({ projectId })

    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].text).toBe('client-only message')
    expect(page.messages[0].source).toBe('client')
  })

  it('reads only our team workspace when asked for ours', async () => {
    const { service, projectId } = await setup()
    const page = await service.loadMessages({ projectId, source: 'ours' })

    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].text).toBe('team-only message')
    expect(page.messages[0].source).toBe('ours')
  })

  it('returns an empty page for ours when nothing is connected', async () => {
    const { monitorStore, delta, projectId } = await setup()
    const noTeam = new DashboardChatService({
      monitorStore,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => 'xoxp' },
      pollerFactory: () => poller
    })
    const page = await noTeam.loadMessages({ projectId, source: 'ours' })
    expect(page).toEqual({ messages: [], nextBeforeTs: null, hasMore: false })
  })

  it('refuses to post into a channel that is not in the chosen source', async () => {
    const { service, projectId } = await setup()
    const teamChannelAsClient = await service.sendMessage({
      projectId,
      source: 'client',
      channelId: 'C_TEAM',
      text: 'nope'
    })
    expect(teamChannelAsClient.ok).toBe(false)
    if (!teamChannelAsClient.ok) expect(teamChannelAsClient.code).toBe('channel_not_found')

    const clientChannelAsTeam = await service.sendMessage({
      projectId,
      source: 'ours',
      channelId: 'C_CLIENT',
      text: 'nope'
    })
    expect(clientChannelAsTeam.ok).toBe(false)
  })

  it('posts into our team workspace with the team token and tags the reply', async () => {
    const { service, projectId } = await setup()
    const sent = await service.sendMessage({
      projectId,
      source: 'ours',
      channelId: 'C_TEAM',
      text: 'shipping today'
    })

    expect(sent.ok).toBe(true)
    if (sent.ok && sent.message) {
      expect(sent.message.source).toBe('ours')
      expect(sent.message.text).toBe('shipping today')
    }
  })

  it('never lets an ours request fall through to client channels', async () => {
    const { service, projectId } = await setup()
    const page = await service.loadMessages({ projectId, source: 'ours', channelId: 'C_CLIENT' })
    expect(page.messages).toEqual([])
  })
})
