import { describe, expect, it, vi } from 'vitest'
import { log } from '../../src/main/logging'

function capture(run: () => void): string {
  const lines: string[] = []
  const spy = vi
    .spyOn(console, 'log')
    .mockImplementation((line: unknown) => void lines.push(String(line)))
  try {
    run()
  } finally {
    spy.mockRestore()
  }
  return lines.join('\n')
}

describe('logging redaction', () => {
  it('does not throw when logging token-like strings', () => {
    expect(() =>
      log.info('token check', {
        Authorization: 'Bearer xoxp-should-not-leak',
        note: 'xoxp-1234567890-abcdefgh'
      })
    ).not.toThrow()
  })

  it('redacts token values in nested objects and arrays', () => {
    const out = capture(() =>
      log.info('nested', {
        outer: { chat: { note: 'key nvapi-SECRET1234 used' } },
        list: ['xoxb-1234-5678', 'nothing to hide'],
        authHeader: 'Bearer abc.def.ghi'
      })
    )
    expect(out).not.toContain('nvapi-SECRET1234')
    expect(out).not.toContain('xoxb-1234-5678')
    expect(out).not.toContain('abc.def.ghi')
    expect(out).toContain('nothing to hide')
  })

  it('redacts secret-named metadata keys at any depth, value and all', () => {
    const out = capture(() =>
      log.info('keys', {
        apiKey: 'visible-text',
        botToken: 'visible-text',
        secret: 'visible-text',
        password: 'visible-text',
        authorization: 'visible-text',
        token: 'visible-text',
        nested: { manualTokenKey: 'DASH_ACME', refreshToken: 'visible-text' }
      })
    )
    expect(out).not.toContain('visible-text')
    expect(out.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(7)
  })

  it('redacts a secret inside the message string itself', () => {
    const out = capture(() => log.error('sync failed for nvapi-LEAKME in channel'))
    expect(out).not.toContain('nvapi-LEAKME')
  })
})
