import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlackPoller, slackPermalink } from '../../src/main/dashboard/slack-poller'

function reply(body: unknown, headers: Record<string, string> = {}): unknown {
  return {
    json: async () => body,
    headers: { get: (key: string) => headers[key] ?? null }
  }
}

function methodOf(url: string): string {
  return url.split('/api/')[1] ?? url
}

function paramsOf(init: { body?: unknown }): URLSearchParams {
  return new URLSearchParams(String(init.body ?? ''))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('slackPermalink', () => {
  it('builds the canonical archive link and rejects a missing base', () => {
    expect(slackPermalink('https://acme.slack.com/', 'C123', '1700000000.000100')).toBe(
      'https://acme.slack.com/archives/C123/p1700000000000100'
    )
    expect(slackPermalink(null, 'C123', '1.2')).toBeUndefined()
  })
})

describe('SlackPoller.fetchHistory', () => {
  it('follows pagination, adds permalinks, and expands thread replies once', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body?: unknown }) => {
        const method = methodOf(url)
        calls.push(method)
        const params = paramsOf(init)
        if (method === 'auth.test') {
          return reply({ ok: true, url: 'https://acme.slack.com/' })
        }
        if (method === 'conversations.history') {
          if (params.get('cursor') === 'page2') {
            return reply({
              ok: true,
              messages: [{ ts: '200.0', user: 'U2', text: 'older but new to us' }]
            })
          }
          return reply({
            ok: true,
            messages: [
              { ts: '300.0', user: 'U1', text: 'parent with answers', reply_count: 2 },
              { ts: '250.0', user: 'U2', text: 'plain message' }
            ],
            response_metadata: { next_cursor: 'page2' }
          })
        }
        if (method === 'conversations.replies') {
          expect(params.get('ts')).toBe('300.0')
          return reply({
            ok: true,
            messages: [
              { ts: '300.0', user: 'U1', text: 'parent with answers', thread_ts: '300.0' },
              { ts: '301.0', user: 'U3', text: 'first answer', thread_ts: '300.0' },
              { ts: '302.0', user: 'U4', text: 'second answer', thread_ts: '300.0' }
            ]
          })
        }
        throw new Error(`unexpected method ${method}`)
      })
    )

    const result = await new SlackPoller().fetchHistory({
      token: 'xoxp-1',
      channelId: 'C_TEAM',
      afterTs: '100.0'
    })

    expect(result.messages.map((m) => m.ts).sort()).toEqual(['200.0', '250.0', '300.0', '301.0', '302.0'])
    expect(result.hasMore).toBe(false)
    expect(result.messages.find((m) => m.ts === '300.0')?.replyCount).toBe(2)
    expect(result.messages.find((m) => m.ts === '301.0')?.threadTs).toBe('300.0')
    expect(result.messages.find((m) => m.ts === '301.0')?.permalink).toBe(
      'https://acme.slack.com/archives/C_TEAM/p3010'
    )
    // The parent is not duplicated by conversations.replies.
    expect(result.messages.filter((m) => m.ts === '300.0')).toHaveLength(1)
    // auth.test is cached for the token: one call, not one per message.
    expect(calls.filter((m) => m === 'auth.test')).toHaveLength(1)
  })

  it('reports hasMore when Slack still has pages beyond the safety cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const method = methodOf(url)
        if (method === 'auth.test') return reply({ ok: true, url: 'https://acme.slack.com' })
        // Always hand back another cursor; the poller must stop at its cap.
        return reply({
          ok: true,
          messages: [{ ts: String(Date.now()), text: 'm' }],
          response_metadata: { next_cursor: 'more' }
        })
      })
    )
    const result = await new SlackPoller().fetchHistory({ token: 'xoxp-1', channelId: 'C1' })
    expect(result.hasMore).toBe(true)
  })

  it('keeps the parent message when a thread read fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const method = methodOf(url)
        if (method === 'auth.test') return reply({ ok: true, url: 'https://acme.slack.com' })
        if (method === 'conversations.history') {
          return reply({
            ok: true,
            messages: [{ ts: '300.0', user: 'U1', text: 'parent', reply_count: 1 }]
          })
        }
        return reply({ ok: false, error: 'thread_not_found' })
      })
    )
    const result = await new SlackPoller().fetchHistory({ token: 'xoxp-1', channelId: 'C1' })
    expect(result.messages.map((m) => m.ts)).toEqual(['300.0'])
  })

  it('honours Retry-After once, then returns the data', async () => {
    vi.useFakeTimers()
    let historyAttempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const method = methodOf(url)
        if (method === 'auth.test') return reply({ ok: true, url: 'https://acme.slack.com' })
        historyAttempts += 1
        if (historyAttempts === 1) {
          return reply({ ok: false, error: 'ratelimited' }, { 'Retry-After': '2' })
        }
        return reply({ ok: true, messages: [{ ts: '100.0', text: 'after wait' }] })
      })
    )

    const pending = new SlackPoller().fetchHistory({ token: 'xoxp-1', channelId: 'C1' })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2000)
    const result = await pending
    expect(result.messages.map((m) => m.ts)).toEqual(['100.0'])
    expect(historyAttempts).toBe(2)
  })

  it('gives up after three rate-limit retries instead of looping forever', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const method = methodOf(url)
        if (method === 'auth.test') return reply({ ok: true, url: 'https://acme.slack.com' })
        return reply({ ok: false, error: 'ratelimited' }, { 'Retry-After': '1' })
      })
    )

    const pending = new SlackPoller()
      .fetchHistory({ token: 'xoxp-1', channelId: 'C1' })
      .catch((err: Error) => err)
    await vi.advanceTimersByTimeAsync(4000)
    const outcome = (await pending) as Error
    expect(outcome).toBeInstanceOf(Error)
    expect(outcome.message).toMatch(/still rate limited/)
  })
})
