import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DashboardChatService, type ChatPoller } from '../../src/main/dashboard/chat-service'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

const fakeVault = {
  encrypt: (p: string) => Buffer.from(p).toString('base64'),
  decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8')
}

function fakePoller(overrides: Partial<ChatPoller> = {}): ChatPoller {
  return {
    authTest: async () => ({ valid: true, userId: 'U_SELF', scopes: ['chat:write'] }),
    usersList: async () => new Map([['U_SELF', 'Me'], ['U_CLIENT', 'Client Person']]),
    postMessage: async (input) => ({ ts: '1700001000.000100', channelId: input.channelId }),
    ...overrides
  }
}

describe('Agent Messaging & Permissions Guardrail', () => {
  let dir: string
  let monitorStore: MonitorStore
  let deltaStore: DashboardDeltaStore
  let project: DashboardProject

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-msg-'))
    monitorStore = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    deltaStore = new DashboardDeltaStore({ rootDir: join(dir, 'dashboard') })

    project = await monitorStore.upsertProject({
      project: {
        id: '',
        name: 'Agent Test Project',
        clientName: 'Client Co',
        profileId: 'prof-1',
        teamId: 'T_TEST',
        teamName: 'Test Team',
        appId: 'slack',
        tokenSource: 'oauth',
        monitors: [
          { channelId: 'C_PERMITTED', channelName: 'permitted-channel' },
          { channelId: 'C_LOCKED', channelName: 'locked-channel' }
        ],
        sources: [
          {
            id: 'src-1',
            kind: 'browser',
            platform: 'slack',
            profileId: 'prof-1',
            workspaceId: 'T_TEST',
            workspaceName: 'Test Team',
            role: 'client',
            enabled: true,
            backfillDays: 7,
            createdAt: '2026-11-06T10:00:00Z',
            updatedAt: '2026-11-06T10:00:00Z',
            channels: [
              {
                id: 'C_PERMITTED',
                name: 'permitted-channel',
                enabled: true,
                agentRead: true,
                agentWrite: true
              },
              {
                id: 'C_LOCKED',
                name: 'locked-channel',
                enabled: true,
                agentRead: true,
                agentWrite: false
              }
            ]
          }
        ]
      }
    })
  })

  it('rejects agent message when agentWrite is false', async () => {
    const service = new DashboardChatService({
      monitorStore,
      deltaStore,
      oauthTokenProvider: { tryGet: async () => 'xoxp-fake-token' },
      pollerFactory: () => fakePoller()
    })

    const res = await service.sendMessage({
      projectId: project.id,
      channelId: 'C_LOCKED',
      text: 'Automated agent status update',
      isAgent: true
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('permission_denied')
    expect(res.error).toContain('Agent write permission is disabled')
  })

  it('permits agent message when agentWrite is explicitly enabled', async () => {
    const service = new DashboardChatService({
      monitorStore,
      deltaStore,
      oauthTokenProvider: { tryGet: async () => 'xoxp-fake-token' },
      pollerFactory: () => fakePoller()
    })

    const res = await service.sendMessage({
      projectId: project.id,
      channelId: 'C_PERMITTED',
      text: 'Automated agent status update',
      isAgent: true
    })

    expect(res.ok).toBe(true)
    expect(res.message).toBeDefined()
    expect(res.message?.text).toBe('Automated agent status update')
  })

  it('allows manual operator message even if agentWrite is false', async () => {
    const service = new DashboardChatService({
      monitorStore,
      deltaStore,
      oauthTokenProvider: { tryGet: async () => 'xoxp-fake-token' },
      pollerFactory: () => fakePoller()
    })

    const res = await service.sendMessage({
      projectId: project.id,
      channelId: 'C_LOCKED',
      text: 'Human reply from dashboard chat panel'
    })

    expect(res.ok).toBe(true)
    expect(res.message?.text).toBe('Human reply from dashboard chat panel')
  })
})
