import { describe, expect, it, vi } from 'vitest'
import {
  detectAgentAction,
  executeAgentAction,
  formatChannelPermissionsContext,
  resolveProjectChannel,
  shouldAutoReplyToMessage
} from '../../src/main/dashboard/agent-action-engine'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

function mockProject(): DashboardProject {
  return {
    id: 'p-test',
    name: 'Ashutosh-Project-01',
    clientName: 'AgentWork',
    profileId: 'pf1',
    teamId: 'T_AGENTWORK',
    appId: 'slack',
    tokenSource: 'oauth',
    createdAt: '2026-01-01T00:00:00.000Z',
    sources: [
      {
        id: 'src-1',
        kind: 'browser',
        platform: 'slack',
        profileId: 'pf1',
        workspaceId: 'T_AGENTWORK',
        workspaceName: 'AgentWork',
        role: 'client',
        enabled: true,
        backfillDays: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        channels: [
          {
            id: 'C_WORK',
            name: 'agentworkprojecttesting',
            enabled: true,
            agentRead: true,
            agentWrite: false // write locked initially
          },
          {
            id: 'C_GRP',
            name: 'newtestinggrup',
            enabled: true,
            agentRead: true,
            agentWrite: true
          }
        ]
      }
    ],
    monitors: [
      {
        channelId: 'C_WORK',
        channelName: 'agentworkprojecttesting'
      }
    ]
  }
}

describe('agent-action-engine', () => {
  describe('detectAgentAction', () => {
    const project = mockProject()

    it('detects capabilities intent from general inquiry', () => {
      const p1 = 'hiii here tell is you can send the messsage in the slack ?'
      const a1 = detectAgentAction(p1, project)
      expect(a1).toEqual({ type: 'list_capabilities' })

      const p2 = 'is you have capability to schedule any task ??'
      const a2 = detectAgentAction(p2, project)
      expect(a2).toEqual({ type: 'list_capabilities' })

      const p3 = 'what can you do'
      const a3 = detectAgentAction(p3, project)
      expect(a3).toEqual({ type: 'list_capabilities' })
    })

    it('detects send slack intent with target channel and text extraction', () => {
      const prompt =
        'here try to send the message in the agentworkprojecttesting channel you try to send the message properly see that all proeprly and ten send the message thier hiii or hlw as yyou want in thier'
      const action = detectAgentAction(prompt, project)
      expect(action).not.toBeNull()
      expect(action?.type).toBe('send_slack')
      expect(action?.channelNameOrId).toBe('agentworkprojecttesting')
      expect(action?.text).toContain('hiii or hlw')
    })

    it('detects multi-target send slack intent with multiple contacts', () => {
      const prompt1 = "#ankita and #utkarsh send both simple -   'hiii '"
      const a1 = detectAgentAction(prompt1, project)
      expect(a1?.type).toBe('send_slack')
      expect(a1?.targetChannels).toEqual(['ankita', 'utkarsh'])
      expect(a1?.text).toBe('hiii')

      const prompt2 = 'send message in slack - ankita and utkarsh and ashutosh - send that message - just simple - " hii "'
      const a2 = detectAgentAction(prompt2, project)
      expect(a2?.type).toBe('send_slack')
      expect(a2?.targetChannels).toEqual(['ankita', 'utkarsh', 'ashutosh'])
      expect(a2?.text).toBe('hii')
    })

    it('detects read channel intent with count', () => {
      const prompt = 'tell me what are the last 3 message in the newtestinggroup tell me last 3 messages'
      const action = detectAgentAction(prompt, project)
      expect(action).toEqual({
        type: 'read_channel',
        channelNameOrId: 'newtestinggroup',
        count: 3
      })
    })

    it('detects scrape trigger', () => {
      expect(detectAgentAction('scrape now', project)).toEqual({ type: 'trigger_scrape' })
      expect(detectAgentAction('trigger the scraping', project)).toEqual({ type: 'trigger_scrape' })
      expect(detectAgentAction('sync now', project)).toEqual({ type: 'trigger_scrape' })
    })

    it('detects schedule configuration', () => {
      const a1 = detectAgentAction('schedule scraping every 20s', project)
      expect(a1?.type).toBe('set_schedule')
      expect(a1?.intervalMinutes).toBeCloseTo(20 / 60)

      const a2 = detectAgentAction('schedule every 15m', project)
      expect(a2?.type).toBe('set_schedule')
      expect(a2?.intervalMinutes).toBe(15)
    })

    it('detects explicit LLM action blocks', () => {
      const block = '```action\n{"action": "send_slack", "channel": "general", "text": "hello team"}\n```'
      const action = detectAgentAction(block, project)
      expect(action).toEqual({
        type: 'send_slack',
        channelNameOrId: 'general',
        targetChannels: ['general'],
        text: 'hello team',
        count: undefined,
        intervalMinutes: undefined,
        enabled: true
      })
    })
  })

  describe('resolveProjectChannel', () => {
    const project = mockProject()

    it('resolves exact channel name without #', () => {
      const res = resolveProjectChannel(project, 'agentworkprojecttesting')
      expect(res).not.toBeNull()
      expect(res?.channel.id).toBe('C_WORK')
    })

    it('resolves channel name with # prefix', () => {
      const res = resolveProjectChannel(project, '#agentworkprojecttesting')
      expect(res).not.toBeNull()
      expect(res?.channel.id).toBe('C_WORK')
    })

    it('fuzzy matches typos like newtestinggroup -> newtestinggrup', () => {
      const res = resolveProjectChannel(project, 'newtestinggroup')
      expect(res).not.toBeNull()
      expect(res?.channel.id).toBe('C_GRP')
      expect(res?.channel.name).toBe('newtestinggrup')
    })
  })

  describe('executeAgentAction', () => {
    it('blocks send_slack when agentWrite is false with permission_denied card', async () => {
      const project = mockProject()
      const chatService = {
        sendMessage: vi.fn()
      } as any

      const res = await executeAgentAction(
        {
          type: 'send_slack',
          channelNameOrId: 'agentworkprojecttesting',
          text: 'hello'
        },
        {
          projectId: project.id,
          project,
          chatService
        }
      )

      expect(res.handled).toBe(true)
      expect(res.ok).toBe(false)
      expect(res.cardType).toBe('permission_denied')
      expect(res.replyMarkdown).toContain('Permission Locked')
      expect(chatService.sendMessage).not.toHaveBeenCalled()
    })

    it('dispatches send_slack when agentWrite is true and includes ACTION_CARD', async () => {
      const project = mockProject()
      const chatService = {
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          message: { ts: '1700000000.000100', text: 'hiii' }
        })
      } as any

      const res = await executeAgentAction(
        {
          type: 'send_slack',
          channelNameOrId: 'newtestinggrup',
          text: 'hiii'
        },
        {
          projectId: project.id,
          project,
          chatService
        }
      )

      expect(res.handled).toBe(true)
      expect(res.ok).toBe(true)
      expect(res.cardType).toBe('slack_dispatch')
      expect(res.replyMarkdown).toContain('Message Dispatched to #newtestinggrup')
      expect(res.replyMarkdown).toContain('<!-- ACTION_CARD:')
      expect(chatService.sendMessage).toHaveBeenCalledWith({
        projectId: project.id,
        channelId: 'C_GRP',
        text: 'hiii',
        isAgent: true
      })
    })

    it('reads messages from channel and formats them', async () => {
      const project = mockProject()
      const chatService = {
        loadMessages: vi.fn().mockResolvedValue({
          messages: [
            { ts: '100', userId: 'U1', userName: 'Ashutosh', text: 'first msg', atIso: '2026-01-01T12:00:00Z' },
            { ts: '200', userId: 'U2', userName: 'Client', text: 'second msg', atIso: '2026-01-01T12:05:00Z' }
          ]
        })
      } as any

      const res = await executeAgentAction(
        {
          type: 'read_channel',
          channelNameOrId: 'newtestinggrup',
          count: 2
        },
        {
          projectId: project.id,
          project,
          chatService
        }
      )

      expect(res.handled).toBe(true)
      expect(res.ok).toBe(true)
      expect(res.cardType).toBe('channel_read')
      expect(res.replyMarkdown).toContain('Ashutosh')
      expect(res.replyMarkdown).toContain('first msg')
      expect(res.replyMarkdown).toContain('second msg')
    })

    it('triggers scrape and returns card with count', async () => {
      const project = mockProject()
      const syncEngine = {
        syncProject: vi.fn().mockResolvedValue({ newMessageCount: 7 })
      } as any
      const chatService = {
        invalidateActivityCache: vi.fn()
      } as any

      const res = await executeAgentAction(
        { type: 'trigger_scrape' },
        {
          projectId: project.id,
          project,
          syncEngine,
          chatService
        }
      )

      expect(res.handled).toBe(true)
      expect(res.ok).toBe(true)
      expect(res.cardType).toBe('scrape_trigger')
      expect(res.replyMarkdown).toContain('7 new message(s)')
      expect(syncEngine.syncProject).toHaveBeenCalledWith(project.id)
    })

    it('updates scrape schedule', async () => {
      const project = mockProject()
      const monitorStore = {
        upsertProject: vi.fn().mockResolvedValue(project)
      } as any

      const res = await executeAgentAction(
        { type: 'set_schedule', intervalMinutes: 0.333, enabled: true },
        {
          projectId: project.id,
          project,
          monitorStore
        }
      )

      expect(res.handled).toBe(true)
      expect(res.ok).toBe(true)
      expect(res.cardType).toBe('schedule_set')
      expect(res.replyMarkdown).toContain('20 seconds')
      expect(monitorStore.upsertProject).toHaveBeenCalled()
    })

    it('handles multi-recipient simultaneous dispatch with partial success summary', async () => {
      const project = mockProject()
      // C_GRP is agentWrite: true; C_WORK is agentWrite: false
      const chatService = {
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          message: { ts: '1700000000.000200', text: 'hiii team' }
        })
      } as any

      const res = await executeAgentAction(
        {
          type: 'send_slack',
          targetChannels: ['newtestinggrup', 'agentworkprojecttesting'],
          text: 'hiii team'
        },
        {
          projectId: project.id,
          project,
          chatService
        }
      )

      expect(res.handled).toBe(true)
      expect(res.ok).toBe(true)
      expect(res.cardType).toBe('slack_dispatch')
      expect(res.replyMarkdown).toContain('Message Dispatched to #newtestinggrup')
      expect(res.replyMarkdown).toContain('Permission Locked for #agentworkprojecttesting')
      expect(chatService.sendMessage).toHaveBeenCalledTimes(1)
      expect(chatService.sendMessage).toHaveBeenCalledWith({
        projectId: project.id,
        channelId: 'C_GRP',
        text: 'hiii team',
        isAgent: true
      })
    })
  })

  describe('formatChannelPermissionsContext', () => {
    it('summarizes Write, Read, and Auto-Reply channel permissions', () => {
      const project = mockProject()
      // Add auto-reply to C_GRP
      project.sources![0].channels[1].autoReply = true

      const summary = formatChannelPermissionsContext(project)
      expect(summary).toContain('Write Authorized: #newtestinggrup')
      expect(summary).toContain('Read Monitored: #agentworkprojecttesting, #newtestinggrup')
      expect(summary).toContain('Real-Time Auto-Reply: #newtestinggrup')
    })
  })

  describe('shouldAutoReplyToMessage', () => {
    const project = mockProject()
    // Make C_WORK a DM with autoReply: true
    project.sources![0].channels[0].isDm = true
    project.sources![0].channels[0].autoReply = true
    // Make C_GRP a group channel with autoReply: true
    project.sources![0].channels[1].autoReply = true

    it('triggers immediately for direct messages when autoReply is enabled', () => {
      const check = shouldAutoReplyToMessage(
        project,
        { text: 'hi there are you available?', userName: 'client_rep' },
        'C_WORK'
      )
      expect(check.shouldReply).toBe(true)
      expect(check.reason).toBe('dm')
    })

    it('triggers for group channels only when user is mentioned', () => {
      const mentioned = shouldAutoReplyToMessage(
        project,
        { text: 'hey @Ashutosh could you review this PR?', userName: 'teammate' },
        'C_GRP',
        ['Ashutosh']
      )
      expect(mentioned.shouldReply).toBe(true)
      expect(mentioned.reason).toBe('mention')

      const notMentioned = shouldAutoReplyToMessage(
        project,
        { text: 'hey team who wants lunch?', userName: 'teammate' },
        'C_GRP',
        ['Ashutosh']
      )
      expect(notMentioned.shouldReply).toBe(false)
    })

    it('does not trigger on own messages or disabled autoReply channels', () => {
      const ownMsg = shouldAutoReplyToMessage(
        project,
        { text: 'hey Ashutosh here', isMine: true },
        'C_WORK'
      )
      expect(ownMsg.shouldReply).toBe(false)

      // Turn off autoReply on C_WORK
      project.sources![0].channels[0].autoReply = false
      const disabled = shouldAutoReplyToMessage(
        project,
        { text: 'hello!', userName: 'client_rep' },
        'C_WORK'
      )
      expect(disabled.shouldReply).toBe(false)
    })
  })
})
