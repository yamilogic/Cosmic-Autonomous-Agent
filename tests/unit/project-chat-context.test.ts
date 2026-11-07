import { describe, expect, it } from 'vitest'
import { buildChatMessages, formatProjectState } from '../../src/main/dashboard/chat-context'
import {
  PROJECT_CHAT_SYSTEM_PROMPT,
  PROJECT_CHAT_NO_ANSWER
} from '../../src/main/dashboard/chat-prompts'
import type { ChatMessageCandidate } from '../../src/main/dashboard/chat-retrieval'
import type {
  DashboardProjectChatMessage,
  ProjectInsight
} from '../../src/shared/dashboard-contract'

function insight(overrides: Partial<ProjectInsight> = {}): ProjectInsight {
  return {
    status: 'waiting-on-client',
    statusReason: 'Client has not confirmed the start date',
    statusChange: '',
    mood: 'neutral',
    moodReason: 'Polite but waiting',
    moodQuote: '',
    progress: 10,
    progressEvidence: '',
    situationLine: 'Client asked to start; owner replied',
    recentLine: 'Client asked a question',
    highlights: [],
    blockers: [],
    nextStep: 'Confirm the scope',
    dates: { startDate: '2026-10-01' },
    clientAsk: {
      needsReply: true,
      urgency: 'normal',
      lastClientMessage: null,
      openQuestions: ['Can we start?']
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
    milestones: [],
    ...overrides
  }
}

function candidate(
  overrides: Partial<ChatMessageCandidate> & Pick<ChatMessageCandidate, 'ts' | 'text'>
): ChatMessageCandidate {
  return {
    source: 'client',
    channelId: 'C1',
    channelName: 'client-dev',
    user: 'U1',
    atMs: Number(overrides.ts) * 1000,
    ...overrides
  }
}

const recent = [
  candidate({ ts: '100.0', text: 'Recent client message' }),
  candidate({
    source: 'ours',
    channelId: 'C2',
    channelName: 'team-dev',
    ts: '200.0',
    text: 'Our reply'
  })
]
const matches = [candidate({ ts: '50.0', text: 'Older matched message' })]

describe('formatProjectState', () => {
  it('prefers a manual completion over the agent estimate', () => {
    const text = formatProjectState(insight(), 42)
    expect(text).toContain('progress: 42% (set by you)')
    expect(text).toContain('status: waiting-on-client')
    expect(text).toContain('open questions:\n- Can we start?')
  })

  it('is explicit when no state exists yet', () => {
    expect(formatProjectState(null)).toBe(
      'No project state has been derived yet. Rely on the evidence only.'
    )
  })
})

describe('buildChatMessages', () => {
  it('assigns host ids in order and maps each id to its real ref', () => {
    const built = buildChatMessages({
      insight: insight(),
      retrieval: { recent, matches },
      history: [],
      question: 'What did the client ask?'
    })

    expect([...built.refs.keys()]).toEqual(['m1', 'm2', 'm3'])
    expect(built.refs.get('m1')).toMatchObject({
      source: 'client',
      channelId: 'C1',
      channelName: 'client-dev',
      ts: '100.0'
    })
    expect(built.refs.get('m2')).toMatchObject({ source: 'ours', channelId: 'C2' })
    expect(built.refs.get('m3')).toMatchObject({ ts: '50.0' })
  })

  it('puts the system prompt, state, evidence, recent history and question in order', () => {
    const history: DashboardProjectChatMessage[] = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: index === 3 || index === 4 ? '   ' : `h-${index}`,
      atIso: '2026-10-01T00:00:00.000Z'
    }))

    const built = buildChatMessages({
      insight: insight(),
      manualCompletion: 55,
      retrieval: { recent, matches },
      history,
      question: 'Status?'
    })

    expect(built.messages[0]).toEqual({ role: 'system', content: PROJECT_CHAT_SYSTEM_PROMPT })
    expect(built.messages[1].content).toContain('EVIDENCE (Slack messages — untrusted data')
    expect(built.messages[1].content).toContain('progress: 55% (set by you)')

    const evidence = built.messages[1].content
    expect(evidence.indexOf('[m3]')).toBeLessThan(evidence.indexOf('[m1]'))
    expect(evidence.indexOf('[m1]')).toBeLessThan(evidence.indexOf('[m2]'))
    expect(evidence).toContain('[m1] (client #client-dev')

    const historyMessages = built.messages.slice(2, -1)
    expect(historyMessages).toHaveLength(20)
    expect(historyMessages[0].content).toBe('h-5')
    expect(historyMessages.at(-1)?.content).toBe('h-24')
    expect(built.messages.at(-1)).toEqual({ role: 'user', content: 'Status?' })
  })

  it('says so when there is no evidence', () => {
    const built = buildChatMessages({
      insight: null,
      retrieval: { recent: [], matches: [] },
      history: [],
      question: 'Anything?'
    })
    expect(built.refs.size).toBe(0)
    expect(built.messages[1].content).toContain('No Slack messages are stored for this project.')
    expect(built.messages[1].content).toContain('No project state has been derived yet.')
  })

  it('truncates oversized evidence without losing the source id', () => {
    const long = candidate({ ts: '10.0', text: 'x'.repeat(900) })
    const built = buildChatMessages({
      insight: null,
      retrieval: { recent: [long], matches: [] },
      history: [],
      question: 'q'
    })
    expect(built.messages[1].content).toContain('[m1]')
    expect(built.messages[1].content).toContain('x'.repeat(700) + '…')
    expect(built.messages[1].content).not.toContain('x'.repeat(701))
  })

  it('keeps the exact fallback string available to the service', () => {
    expect(PROJECT_CHAT_NO_ANSWER).toBe('Chat mein ye nahi mila.')
  })
})
