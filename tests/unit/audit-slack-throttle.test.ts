import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  reportSlackRateLimit,
  slackTokenKey,
  withSlackLimit
} from '../../src/main/dashboard/slack-throttle'
import { SlackPoller } from '../../src/main/dashboard/slack-poller'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('withSlackLimit', () => {
  it('caps in-flight calls at two per token key and drains the queue FIFO', async () => {
    let inFlight = 0
    let peak = 0
    const startedOrder: number[] = []
    const finishedOrder: number[] = []
    const releases: Array<() => void> = []
    const call = (n: number): Promise<void> =>
      withSlackLimit('key-cap', () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        startedOrder.push(n)
        return new Promise<void>((resolve) => {
          releases.push(() => {
            inFlight -= 1
            finishedOrder.push(n)
            resolve()
          })
        })
      })

    const all = [call(1), call(2), call(3), call(4)]
    expect(peak).toBe(2)
    while (releases.length > 0) {
      releases.shift()?.()
      // let the limiter's finally-handler start the next queued call
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await Promise.all(all)
    expect(peak).toBe(2)
    expect(startedOrder).toEqual([1, 2, 3, 4])
    expect(finishedOrder).toEqual([1, 2, 3, 4])
  })

  it('does not block other token keys while one key is saturated', async () => {
    withSlackLimit('key-sat-a', () => new Promise<void>(() => undefined))
    withSlackLimit('key-sat-a', () => new Promise<void>(() => undefined))
    withSlackLimit('key-sat-a', () => new Promise<void>(() => undefined))
    let otherStarted = false
    await withSlackLimit('key-sat-b', async () => {
      otherStarted = true
    })
    expect(otherStarted).toBe(true)
  })

  it('blocks new starts until the reported Retry-After window passes', async () => {
    const key = 'key-window'
    let starts = 0
    await withSlackLimit(key, async () => {
      starts += 1
    })
    reportSlackRateLimit(key, 120)
    const t0 = Date.now()
    await withSlackLimit(key, async () => {
      starts += 1
    })
    expect(starts).toBe(2)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100)
  })

  it('derives a log-safe key that never contains the token', () => {
    const key = slackTokenKey('xoxb-secret-material')
    expect(key).not.toContain('secret')
    expect(key).toBe(slackTokenKey('xoxb-secret-material'))
    expect(key).not.toBe(slackTokenKey('xoxb-other-token'))
  })
})

describe('SlackPoller HTTP 429 handling', () => {
  it('treats a bare HTTP 429 as a rate limit even when the body is not Slack JSON', async () => {
    vi.useFakeTimers()
    let historyAttempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const method = String(url).split('/api/')[1] ?? String(url)
        if (method === 'auth.test') {
          return {
            status: 200,
            json: async () => ({ ok: true, url: 'https://acme.slack.com' }),
            headers: { get: () => null }
          }
        }
        historyAttempts += 1
        if (historyAttempts === 1) {
          // A proxy-level 429: no Slack JSON body at all.
          return {
            status: 429,
            json: async () => {
              throw new Error('not JSON')
            },
            headers: { get: (k: string) => (k === 'Retry-After' ? '2' : null) }
          }
        }
        return {
          status: 200,
          json: async () => ({ ok: true, messages: [{ ts: '100.0', text: 'after 429' }] }),
          headers: { get: () => null }
        }
      })
    )

    const pending = new SlackPoller().fetchHistory({ token: 'xoxp-429', channelId: 'C_429' })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2000)
    const result = await pending
    expect(result.messages.map((m) => m.ts)).toEqual(['100.0'])
    expect(historyAttempts).toBe(2)
  })
})
