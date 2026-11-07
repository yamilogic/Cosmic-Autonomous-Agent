import { describe, expect, it } from 'vitest'
import { detectAgentAction } from '../../src/main/dashboard/agent-action-engine'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

describe('agent-action-commands tests', () => {
  const dummyProject: DashboardProject = {
    id: 'proj-test-1',
    name: 'Ashutosh Workspace',
    clientName: 'Ashutosh',
    createdAt: '2026-01-01T00:00:00Z',
    profileId: 'prof-1',
    teamId: 'team-1',
    appId: 'slack',
    tokenSource: 'manual',
    sources: [
      {
        id: 'src-1',
        kind: 'browser',
        platform: 'slack',
        workspaceId: 'team-1',
        workspaceName: 'AgentWork',
        role: 'client',
        backfillDays: 7,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        enabled: true,
        channels: [
          {
            id: 'C0CF72BSYKT',
            name: 'agentworkprojecttesting',
            isPrivate: true,
            isDm: false,
            enabled: true,
            agentRead: true,
            agentWrite: true,
            autoReply: true
          },
          {
            id: 'D0C7E3FSVNE',
            name: '@Ashutosh',
            isPrivate: false,
            isDm: true,
            enabled: true,
            agentRead: true,
            agentWrite: true,
            autoReply: true
          }
        ]
      }
    ],
    monitors: []
  }

  it('correctly handles colon verbatim syntax with /send @slack #Ashutosh : hello bro', () => {
    const action = detectAgentAction(
      '/send @slack #Ashutosh : hello bro how are you?',
      dummyProject
    )
    expect(action).not.toBeNull()
    expect(action?.type).toBe('send_slack')
    expect(action?.channelNameOrId).toBe('Ashutosh')
    expect(action?.text).toBe('hello bro how are you?')
  })

  it('correctly handles colon verbatim syntax with send to #Ashutosh : exact text here', () => {
    const action = detectAgentAction(
      'send to #Ashutosh : exact text here with : multiple colons : intact',
      dummyProject
    )
    expect(action).not.toBeNull()
    expect(action?.type).toBe('send_slack')
    expect(action?.channelNameOrId).toBe('Ashutosh')
    expect(action?.text).toBe('exact text here with : multiple colons : intact')
  })

  it('correctly handles colon verbatim syntax scoped to active channel', () => {
    const action = detectAgentAction('send : hello world', dummyProject, 'D0C7E3FSVNE')
    expect(action).not.toBeNull()
    expect(action?.type).toBe('send_slack')
    expect(action?.channelNameOrId).toBe('D0C7E3FSVNE')
    expect(action?.text).toBe('hello world')
  })

  it('correctly parses /ai-ans command with target and persona', () => {
    const action = detectAgentAction(
      '/ai-ans @slack #Ashutosh [friendly] : ask how the project is going',
      dummyProject
    )
    expect(action).not.toBeNull()
    expect(action?.type).toBe('generate_ai_reply')
    expect(action?.channelNameOrId).toBe('Ashutosh')
    expect(action?.persona).toBe('friendly')
    expect(action?.text).toBe('ask how the project is going')
  })

  it('correctly parses /ai-ans command with default persona when omitted', () => {
    const action = detectAgentAction('/ai-ans #Ashutosh : clarify release date', dummyProject)
    expect(action).not.toBeNull()
    expect(action?.type).toBe('generate_ai_reply')
    expect(action?.channelNameOrId).toBe('Ashutosh')
    expect(action?.persona).toBe('professional')
    expect(action?.text).toBe('clarify release date')
  })

  it('correctly handles /help and /help-slack', () => {
    const helpAction = detectAgentAction('/help', dummyProject)
    expect(helpAction).toEqual({ type: 'show_help', platform: 'all' })

    const slackHelpAction = detectAgentAction('/help-slack', dummyProject)
    expect(slackHelpAction).toEqual({ type: 'show_help', platform: 'slack' })
  })

  it('strips conversational preamble from natural language dispatch (Image 5 scenario)', () => {
    const action = detectAgentAction(
      'send the message to the Ashutosh properly like hiii how are you bro',
      dummyProject
    )
    expect(action).not.toBeNull()
    expect(action?.type).toBe('send_slack')
    expect(action?.channelNameOrId).toBe('Ashutosh')
    expect(action?.text).toBe('hiii how are you bro')
  })

  it('correctly handles order-independent mention syntax: @AgentWork #agentworkprojecttesting /send : hii bro how are you ??', () => {
    const action = detectAgentAction(
      '@AgentWork #agentworkprojecttesting /send : hii bro how are you ??',
      dummyProject
    )
    expect(action).not.toBeNull()
    expect(action?.type).toBe('send_slack')
    expect(action?.channelNameOrId).toBe('agentworkprojecttesting')
    expect(action?.text).toBe('hii bro how are you ??')
  })

  it('correctly handles order-independent mention syntax: @AgentWork #agentworkprojecttesting /ai-ans [professional] : gave their 10 anime name', () => {
    const action = detectAgentAction(
      '@AgentWork #agentworkprojecttesting /ai-ans [professional] : gave their 10 anime name',
      dummyProject
    )
    expect(action).not.toBeNull()
    expect(action?.type).toBe('generate_ai_reply')
    expect(action?.channelNameOrId).toBe('agentworkprojecttesting')
    expect(action?.persona).toBe('professional')
    expect(action?.text).toBe('gave their 10 anime name')
  })

  it('handles #channel /send : text format', () => {
    const action = detectAgentAction(
      '#agentworkprojecttesting /send : update status now',
      dummyProject
    )
    expect(action).not.toBeNull()
    expect(action?.type).toBe('send_slack')
    expect(action?.channelNameOrId).toBe('agentworkprojecttesting')
    expect(action?.text).toBe('update status now')
  })
})
