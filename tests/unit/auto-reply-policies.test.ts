import { describe, expect, it } from 'vitest'
import { shouldAutoReplyToMessage } from '../../src/main/dashboard/agent-action-engine'
import {
  detectMessageNeedsReply,
  detectMessageIsTaskRelated,
  generatePersonaReply
} from '../../src/main/dashboard/ai-personas'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

describe('auto-reply policies & personas tests', () => {
  const createProjectWithPolicy = (
    policy: 'disabled' | 'all' | 'needs_reply' | 'task_only' | 'mention_dm' | 'draft_only',
    persona: 'friendly' | 'concise' | 'empathetic' | 'technical' | 'executive' | 'professional' = 'professional'
  ): DashboardProject => ({
    id: 'proj-p1',
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
            id: 'D0C7E3FSVNE',
            name: '@Ashutosh',
            isPrivate: false,
            isDm: true,
            enabled: true,
            agentRead: true,
            agentWrite: true,
            autoReply: policy !== 'disabled',
            autoReplyPolicy: policy,
            autoReplyPersona: persona
          },
          {
            id: 'C0CF72BSYKT',
            name: 'agentworkprojecttesting',
            isPrivate: true,
            isDm: false,
            enabled: true,
            agentRead: true,
            agentWrite: true,
            autoReply: policy !== 'disabled',
            autoReplyPolicy: policy,
            autoReplyPersona: persona
          }
        ]
      }
    ],
    monitors: []
  })

  it('anti-loop guard rejects auto-replies to own automated templates', () => {
    const project = createProjectWithPolicy('all')
    const check = shouldAutoReplyToMessage(
      project,
      { text: 'Hi @Ashutosh! I received your message. Thanks for reaching out — I am reviewing this' },
      'D0C7E3FSVNE'
    )
    expect(check.shouldReply).toBe(false)
  })

  it('disabled policy never replies', () => {
    const project = createProjectWithPolicy('disabled')
    const check = shouldAutoReplyToMessage(
      project,
      { text: 'Can you please check the task status?' },
      'D0C7E3FSVNE'
    )
    expect(check.shouldReply).toBe(false)
  })

  it('all policy replies to any non-bot message in DM', () => {
    const project = createProjectWithPolicy('all')
    const check = shouldAutoReplyToMessage(
      project,
      { text: 'hi how are you' },
      'D0C7E3FSVNE'
    )
    expect(check.shouldReply).toBe(true)
    expect(check.reason).toBe('all')
  })

  it('needs_reply policy triggers only on questions or requests', () => {
    const project = createProjectWithPolicy('needs_reply')

    const questionCheck = shouldAutoReplyToMessage(
      project,
      { text: 'When is the milestone 2 release date?' },
      'D0C7E3FSVNE'
    )
    expect(questionCheck.shouldReply).toBe(true)
    expect(questionCheck.reason).toBe('needs_reply')

    const statementCheck = shouldAutoReplyToMessage(
      project,
      { text: 'ok sounds good' },
      'D0C7E3FSVNE'
    )
    expect(statementCheck.shouldReply).toBe(false)
  })

  it('task_only policy triggers only on project deliverables, bugs or blockers', () => {
    const project = createProjectWithPolicy('task_only')

    const taskCheck = shouldAutoReplyToMessage(
      project,
      { text: 'We found a critical blocker in the login deployment pipeline' },
      'D0C7E3FSVNE'
    )
    expect(taskCheck.shouldReply).toBe(true)
    expect(taskCheck.reason).toBe('task_only')

    const casualCheck = shouldAutoReplyToMessage(
      project,
      { text: 'Good morning everyone!' },
      'D0C7E3FSVNE'
    )
    expect(casualCheck.shouldReply).toBe(false)
  })

  it('draft_only policy marks reason as draft_only', () => {
    const project = createProjectWithPolicy('draft_only')
    const check = shouldAutoReplyToMessage(
      project,
      { text: 'hello' },
      'D0C7E3FSVNE'
    )
    expect(check.shouldReply).toBe(true)
    expect(check.reason).toBe('draft_only')
  })

  it('detectMessageNeedsReply accurately detects interrogative phrases', () => {
    expect(detectMessageNeedsReply('what is the status?')).toBe(true)
    expect(detectMessageNeedsReply('please let me know when ready')).toBe(true)
    expect(detectMessageNeedsReply('any update on the PR')).toBe(true)
    expect(detectMessageNeedsReply('hello')).toBe(false)
  })

  it('detectMessageIsTaskRelated accurately detects tasks, milestones, and bugs', () => {
    expect(detectMessageIsTaskRelated('critical bug in OAuth flow')).toBe(true)
    expect(detectMessageIsTaskRelated('merged the pull request')).toBe(true)
    expect(detectMessageIsTaskRelated('milestone 1 is ready')).toBe(true)
    expect(detectMessageIsTaskRelated('lunch time')).toBe(false)
  })

  it('generatePersonaReply correctly formats response for all 6 personas', () => {
    const friendly = generatePersonaReply({
      personaKey: 'friendly',
      channelName: '@Ashutosh',
      instruction: 'ask status'
    })
    expect(friendly).toContain('Hey @Ashutosh!')
    expect(friendly).toContain('😊')

    const concise = generatePersonaReply({
      personaKey: 'concise',
      channelName: '@Ashutosh',
      instruction: 'ask status'
    })
    expect(concise).toContain('Status check:')
    expect(concise).not.toContain('😊')

    const empathetic = generatePersonaReply({
      personaKey: 'empathetic',
      channelName: '@Ashutosh',
      instruction: 'ask status'
    })
    expect(empathetic).toContain('wanted to warmly reach out')

    const technical = generatePersonaReply({
      personaKey: 'technical',
      channelName: '@Ashutosh',
      instruction: 'ask status'
    })
    expect(technical).toContain('Engineering status sync:')

    const executive = generatePersonaReply({
      personaKey: 'executive',
      channelName: '@Ashutosh',
      instruction: 'ask status'
    })
    expect(executive).toContain('Executive briefing request:')

    const professional = generatePersonaReply({
      personaKey: 'professional',
      channelName: '@Ashutosh',
      instruction: 'ask status'
    })
    expect(professional).toContain('Hello @Ashutosh')
  })
})
