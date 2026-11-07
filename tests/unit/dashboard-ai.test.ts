import { describe, expect, it } from 'vitest'
import { extractJsonObject, NimProvider } from '../../src/main/dashboard/ai-provider'
import { buildInsightMessages, mergeInsight } from '../../src/main/dashboard/insights'

const okFetch = (body: Record<string, unknown>): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch

describe('NimProvider', () => {
  it('chat uses primary model and returns content', async () => {
    const p = new NimProvider({
      apiKey: 'k',
      modelPrimary: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
      baseUrl: 'http://_FAKE'
    })
    const oldFetch = globalThis.fetch
    globalThis.fetch = okFetch({
      model: 'primary',
      choices: [{ message: { content: 'OK' } }],
      usage: { total_tokens: 9 }
    }) as typeof fetch
    try {
      const r = await p.chat([{ role: 'user', content: 'hi' }])
      expect(r.content).toBe('OK')
      expect(r.modelUsed).toBe('primary')
      expect(r.tokens).toBe(9)
    } finally {
      globalThis.fetch = oldFetch
    }
  })

  it('falls back to fallback model on failure', async () => {
    const p = new NimProvider({
      apiKey: 'k',
      modelPrimary: 'primary',
      modelFallback: 'fallback',
      baseUrl: 'http://_FAKE'
    })
    let calls = 0
    const oldFetch = globalThis.fetch
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      const body = JSON.parse(String((init as RequestInit).body))
      if (body.model === 'primary') return new Response('boom', { status: 500 })
      return new Response(
        JSON.stringify({
          model: 'fallback',
          choices: [{ message: { content: 'ok2' } }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof fetch
    try {
      const r = await p.chat([{ role: 'user', content: 'hi' }])
      expect(r.modelUsed).toBe('fallback')
      expect(calls).toBe(2)
    } finally {
      globalThis.fetch = oldFetch
    }
  })
})

describe('insights prompt + merge', () => {
  it('builds messages with previous insight and new messages only', () => {
    const msgs = buildInsightMessages({
      projectName: 'P',
      workspaceName: 'W',
      previous: null,
      newCount: 2,
      newMessages: [
        { ts: '2026-10-21T10:00:00Z', who: 'Client', text: 'when demo?', isClient: true },
        { ts: '2026-10-21T10:05:00Z', who: 'Me', text: 'friday', isClient: false }
      ]
    })
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].content).toContain('(CLIENT)')
    expect(msgs[1].content).toContain('when demo?')
  })

  it('formats threaded replies with hierarchical indentation', () => {
    const msgs = buildInsightMessages({
      projectName: 'P',
      workspaceName: 'W',
      previous: null,
      newCount: 2,
      newMessages: [
        { ts: '2026-10-21T10:00:00Z', who: 'Client', text: 'Where is the login button?', isClient: true },
        { ts: '2026-10-21T10:05:00Z', who: 'Dev', text: 'It was moved to top right', isClient: false, threadTs: '2026-10-21T10:00:00Z' }
      ]
    })
    expect(msgs[1].content).toContain('[2026-10-21T10:00:00Z] Client (CLIENT): Where is the login button?')
    expect(msgs[1].content).toContain('    ↳ [2026-10-21T10:05:00Z] Dev (reply): It was moved to top right')
  })

  it('merges parsed fields and carries over unknowns', () => {
    const prev = mergeInsight(
      null,
      mergeInsight(
        {
          status: 'at-risk',
          progress: 40,
          situationLine: 'waiting',
          dates: { endDate: '2026-12-01' }
        },
        null
      )
    )
    // the status change needs an evidenced item beside it (H1 guard)
    const merged = mergeInsight(
      {
        status: 'on-track',
        progress: 60,
        situationLine: 'moving',
        decisions: [{ what: 'Client approved the scope' }]
      },
      { ...prev, blockers: [{ what: 'assets' }] }
    )
    expect(merged.status).toBe('on-track')
    expect(merged.progress).toBe(60)
    expect(merged.blockers).toEqual([{ what: 'assets' }])
    expect(merged.dates.endDate).toBe('2026-12-01')
  })

  it('rejects invalid status/progress values', () => {
    const merged = mergeInsight({ status: 'crap', progress: 900 }, null)
    expect(merged.status).toBe('on-track')
    expect(merged.progress).toBe(0)
  })
})

describe('extractJsonObject', () => {
  it('parses fenced JSON', () => {
    const o = extractJsonObject('text before\n```json\n{"a":1}\n```\nafter')
    expect(o).toEqual({ a: 1 })
  })
  it('parses inline JSON', () => {
    expect(extractJsonObject('here {"b":2} done')).toEqual({ b: 2 })
  })
  it('returns null when no object', () => {
    expect(extractJsonObject('no json')).toBeNull()
  })
})
