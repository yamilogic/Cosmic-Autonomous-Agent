import { beforeEach, describe, expect, it, vi } from 'vitest'
import { log, redact, sweepExpiredLogs } from '../../src/main/logging'

describe('Ephemeral Logging Engine & Ring Buffer', () => {
  beforeEach(() => {
    log.clear()
    log.setRetention(15) // default 15 minutes
  })

  it('redacts sensitive tokens, passwords, and authorization keys', () => {
    const raw = {
      token: 'xoxp-123456789-abcdefg',
      apiKey: 'nvapi-987654321',
      authorization: 'Bearer secret_payload_123',
      normalField: 'all good'
    }
    const sanitized = redact(raw) as any
    expect(sanitized.token).toBe('[REDACTED]')
    expect(sanitized.apiKey).toBe('[REDACTED]')
    expect(sanitized.authorization).toBe('[REDACTED]')
    expect(sanitized.normalField).toBe('all good')
  })

  it('appends entries to ring buffer with structured tags', () => {
    log.action('ui', 'info', 'User opened Settings')
    log.action('sync', 'warn', 'Slow delta response', { durationMs: 450 })
    log.error('Critical crash simulated')

    const entries = log.getRecent()
    expect(entries.length).toBe(3)

    const uiEntry = entries.find((e) => e.category === 'ui')
    expect(uiEntry).toBeDefined()
    expect(uiEntry?.message).toBe('User opened Settings')
    expect(uiEntry?.level).toBe('info')

    const errorEntry = entries.find((e) => e.level === 'error')
    expect(errorEntry?.category).toBe('error')
    expect(errorEntry?.message).toBe('Critical crash simulated')
  })

  it('filters recent logs by level, category, and text query', () => {
    log.action('ui', 'info', 'Clicked on Minimal look')
    log.action('nav', 'info', 'Switched to Observer view')
    log.action('sync', 'warn', 'Sync heartbeat delayed')
    log.action('sec', 'security', 'App lock engaged')
    log.error('Failed to connect to gateway')

    // Filter by level
    const errorsOnly = log.getRecent({ level: 'error' })
    expect(errorsOnly.length).toBe(1)
    expect(errorsOnly[0].message).toBe('Failed to connect to gateway')

    // Filter by category
    const syncOnly = log.getRecent({ category: 'sync' })
    expect(syncOnly.length).toBe(1)
    expect(syncOnly[0].message).toBe('Sync heartbeat delayed')

    // Filter by search query
    const observerLogs = log.getRecent({ query: 'Observer' })
    expect(observerLogs.length).toBe(1)
    expect(observerLogs[0].message).toContain('Observer')
  })

  it('automatically purges logs older than retention window (TTL)', () => {
    vi.useFakeTimers()
    try {
      const now = new Date('2026-11-01T12:00:00.000Z')
      vi.setSystemTime(now)

      log.setRetention(15) // 15 minutes TTL

      log.info('Old message at 12:00')
      expect(log.getRecent().length).toBe(1)

      // Fast-forward 10 minutes (entry should still be kept)
      vi.setSystemTime(new Date('2026-11-01T12:10:00.000Z'))
      expect(sweepExpiredLogs()).toBe(0)
      expect(log.getRecent().length).toBe(1)

      // Fast-forward another 6 minutes (total 16 minutes > 15m retention)
      vi.setSystemTime(new Date('2026-11-01T12:16:00.000Z'))

      // sweepExpiredLogs directly purges the 16-minute-old log
      const purged = sweepExpiredLogs()
      expect(purged).toBe(1)
      expect(log.getRecent().length).toBe(0)

      log.info('New message at 12:16')
      const remaining = log.getRecent()
      expect(remaining.length).toBe(1)
      expect(remaining[0].message).toBe('New message at 12:16')
    } finally {
      vi.useRealTimers()
    }
  })

  it('exports formatted JSON logs and supports manual clear', () => {
    log.info('Event 1')
    log.warn('Event 2')

    const exp = log.export()
    expect(exp.ok).toBe(true)
    expect(exp.count).toBe(2)
    expect(exp.content).toContain('Event 1')
    expect(exp.content).toContain('Event 2')

    log.clear()
    expect(log.getRecent().length).toBe(0)
  })

  it('notifies subscribers in real-time when new logs arrive', () => {
    const received: string[] = []
    const unsubscribe = log.subscribe((entry) => {
      received.push(entry.message)
    })

    log.info('Live broadcast 1')
    log.error('Live broadcast 2')

    expect(received).toEqual(['Live broadcast 1', 'Live broadcast 2'])

    unsubscribe()
    log.info('Live broadcast 3')
    expect(received).toEqual(['Live broadcast 1', 'Live broadcast 2'])
  })
})
