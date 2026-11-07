import { describe, expect, it } from 'vitest'
import {
  detectAgentAction,
  resolveProjectChannel
} from '../../src/main/dashboard/agent-action-engine'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

function mockProjectWithChannels(): DashboardProject {
  return {
    id: 'p-fuzzy',
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
            agentWrite: true
          },
          {
            id: 'C_TEST',
            name: 'newtrestinggrup',
            enabled: true,
            agentRead: true,
            agentWrite: true
          },
          {
            id: 'D_ASHU',
            name: 'Ashutosh',
            enabled: true,
            agentRead: true,
            agentWrite: true
          }
        ]
      }
    ],
    monitors: []
  }
}

describe('agent-action-fuzzy and multi-clause tests', () => {
  const project = mockProjectWithChannels()

  describe('resolveProjectChannel with Levenshtein fuzzy matching', () => {
    it('matches typo "newtestinggroup" to actual channel "newtrestinggrup"', () => {
      const match = resolveProjectChannel(project, 'newtestinggroup')
      expect(match).not.toBeNull()
      expect(match?.channel.name).toBe('newtrestinggrup')
      expect(match?.channel.id).toBe('C_TEST')
    })

    it('matches exact name "agentworkprojecttesting"', () => {
      const match = resolveProjectChannel(project, 'agentworkprojecttesting')
      expect(match).not.toBeNull()
      expect(match?.channel.name).toBe('agentworkprojecttesting')
    })

    it('matches contact name "Ashutosh"', () => {
      const match = resolveProjectChannel(project, 'Ashutosh')
      expect(match).not.toBeNull()
      expect(match?.channel.name).toBe('Ashutosh')
    })
  })

  describe('detectAgentAction with conversational multi-clause prompts', () => {
    it('correctly parses user query with repeated send clauses', () => {
      const prompt =
        'here try to send the message in the agentworkprojecttesting channel you try to send the message properly see that all proeprly and ten send the message thier hiii or hlw as yyou want in thier'
      const action = detectAgentAction(prompt, project)
      expect(action).not.toBeNull()
      expect(action?.type).toBe('send_slack')
      expect(action?.channelNameOrId).toBe('agentworkprojecttesting')
      expect(action?.text).toBe('hiii or hlw')
    })

    it('strips preamble "to the <target> properly like" and delivers clean text', () => {
      const prompt = 'send the message to the Ashutosh properly like hiii how are you bro'
      const action = detectAgentAction(prompt, project)
      expect(action).not.toBeNull()
      expect(action?.type).toBe('send_slack')
      expect(action?.channelNameOrId).toBe('Ashutosh')
      expect(action?.text).toBe('hiii how are you bro')
    })

    it('strips preamble with channel and colon delimiter', () => {
      const prompt = 'send message to newtrestinggrup: Hello team!'
      const action = detectAgentAction(prompt, project)
      expect(action).not.toBeNull()
      expect(action?.type).toBe('send_slack')
      expect(action?.channelNameOrId).toBe('newtrestinggrup')
      expect(action?.text).toBe('Hello team!')
    })

    it('strips preamble with "in ... channel properly saying"', () => {
      const prompt = 'send message in agentworkprojecttesting channel properly saying welcome aboard'
      const action = detectAgentAction(prompt, project)
      expect(action).not.toBeNull()
      expect(action?.type).toBe('send_slack')
      expect(action?.channelNameOrId).toBe('agentworkprojecttesting')
      expect(action?.text).toBe('welcome aboard')
    })

    it('correctly parses read channel request with typo channel name', () => {
      const prompt =
        'tell me what are the last 3 message in the newtestinggroup tell me last 3 messages'
      const action = detectAgentAction(prompt, project)
      expect(action).not.toBeNull()
      expect(action?.type).toBe('read_channel')
      expect(action?.channelNameOrId).toBe('newtestinggroup')
      expect(action?.count).toBe(3)
    })
  })
})
