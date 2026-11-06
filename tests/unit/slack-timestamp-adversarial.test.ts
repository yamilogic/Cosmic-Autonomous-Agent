import { describe, expect, it } from 'vitest'
import {
  normalizeSlackTimestamp,
  normalizeScrapedMessage,
  type RawScrapedMessage
} from '../../src/main/slack-reader/normalizer'
import { buildReadVisibleMessagesScript } from '../../src/main/slack-reader/slack-adapter'

describe('Challenger 1: Timestamp & Edge-Case Adversarial Suite', () => {
  // Regex to strictly enforce 10-digit epoch seconds with exactly 6 decimal places
  const VALID_EPOCH_6DEC_REGEX = /^\d{10}\.\d{6}$/

  describe('1. Embedded Epoch Strings', () => {
    const testCases = [
      { input: '1730795700.000100__message', expected: '1730795700.000100' },
      { input: 'C123-1730795700.000100', expected: '1730795700.000100' },
      { input: 'row_1730795700.123456_container', expected: '1730795700.123456' },
      { input: 'prefix_1730795700_suffix', expected: '1730795700.000000' },
      { input: '1730795700.1', expected: '1730795700.100000' },
      { input: '1730795700.123456789', expected: '1730795700.123456' },
      { input: 'p1730795700000100', expected: '1730795700.000100' },
      { input: '1730795700000100', expected: '1730795700.000100' },
      { input: '1730795700000', expected: '1730795700.000000' },
      { input: '  1730795700.000100  ', expected: '1730795700.000100' },
      { input: 'key:1730795700.999999:end', expected: '1730795700.999999' }
    ]

    for (const { input, expected } of testCases) {
      it(`extracts embedded epoch from "${input}" -> "${expected}"`, () => {
        const result = normalizeSlackTimestamp(input)
        expect(result).toBe(expected)
        expect(result).toMatch(VALID_EPOCH_6DEC_REGEX)
      })
    }
  })

  describe('2. Humanized Relative Dates', () => {
    const relativeCases = [
      'Today at 2:35 PM',
      'Yesterday at 4:15 PM',
      'Today at 11:59 AM',
      'Yesterday at 12:00 AM',
      'Today at 12:00 AM',
      'Today at 12:00 PM',
      'Today at 00:00',
      'Today at 23:59',
      'Yesterday at 11:59 PM',
      'today at 9:05 am',
      'yesterday at 1:00 pm',
      '  Today at 2:35 PM  ',
      'Yesterday at 12:00 PM'
    ]

    for (const input of relativeCases) {
      it(`parses relative date "${input}" into valid 6-decimal epoch`, () => {
        const result = normalizeSlackTimestamp(input)
        expect(result).not.toBeNull()
        expect(result).toMatch(VALID_EPOCH_6DEC_REGEX)
        const epochSec = Number(result)
        expect(Number.isFinite(epochSec)).toBe(true)
        expect(epochSec).toBeGreaterThan(1700000000)
      })
    }

    it('orders "Today at 2:35 PM" strictly after "Yesterday at 2:35 PM"', () => {
      const today = Number(normalizeSlackTimestamp('Today at 2:35 PM'))
      const yesterday = Number(normalizeSlackTimestamp('Yesterday at 2:35 PM'))
      const diffHours = (today - yesterday) / 3600
      expect(diffHours).toBeCloseTo(24, 1)
    })

    it('correctly distinguishes 12:00 AM (midnight) vs 12:00 PM (noon)', () => {
      const midnight = Number(normalizeSlackTimestamp('Today at 12:00 AM'))
      const noon = Number(normalizeSlackTimestamp('Today at 12:00 PM'))
      const diffHours = (noon - midnight) / 3600
      expect(diffHours).toBeCloseTo(12, 1)
    })

    it('correctly handles 11:59 AM vs 12:00 PM transition', () => {
      const morning = Number(normalizeSlackTimestamp('Today at 11:59 AM'))
      const noon = Number(normalizeSlackTimestamp('Today at 12:00 PM'))
      const diffMinutes = (noon - morning) / 60
      expect(diffMinutes).toBeCloseTo(1, 1)
    })
  })

  describe('3. Date Strings with Ordinals and Weekdays', () => {
    const ordinalCases = [
      'November 4th, 2026 at 2:35 PM',
      'Nov 4th at 2:35 PM',
      'Wednesday, Nov 4th 2:35 PM',
      'Wednesday, November 4th at 2:35 PM',
      'October 1st, 2026 at 10:00 AM',
      'Oct 2nd at 11:30 AM',
      'May 3rd, 2026 at 1:15 PM',
      'December 31st at 11:59 PM',
      'January 1st, 2026 at 12:00 AM',
      'Jan 1st at 8:00 AM',
      'February 29th, 2024 at 12:00 PM', // Leap year
      'August 15th, 2026 at 9:30 AM'
    ]

    for (const input of ordinalCases) {
      it(`parses ordinal date string "${input}" into valid 6-decimal epoch`, () => {
        const result = normalizeSlackTimestamp(input)
        expect(result, `Failed to parse: ${input}`).not.toBeNull()
        expect(result).toMatch(VALID_EPOCH_6DEC_REGEX)
        const epochSec = Number(result)
        expect(Number.isFinite(epochSec)).toBe(true)
        expect(epochSec).toBeGreaterThan(1700000000)
      })
    }
  })

  describe('4. Time-Only Strings', () => {
    const timeOnlyCases = [
      '02:35 PM',
      '2:35 PM',
      '14:35',
      '9:05 AM',
      '12:00 AM',
      '12:00 PM',
      '11:59 PM',
      '0:00',
      '23:59:59',
      '08:15:30 AM',
      '  2:35 PM  '
    ]

    for (const input of timeOnlyCases) {
      it(`parses time-only string "${input}" into today's valid 6-decimal epoch`, () => {
        const result = normalizeSlackTimestamp(input)
        expect(result, `Failed to parse: ${input}`).not.toBeNull()
        expect(result).toMatch(VALID_EPOCH_6DEC_REGEX)
        const epochSec = Number(result)
        expect(Number.isFinite(epochSec)).toBe(true)
        expect(epochSec).toBeGreaterThan(1700000000)
      })
    }

    it('correctly orders 9:05 AM before 2:35 PM on same day', () => {
      const am = Number(normalizeSlackTimestamp('9:05 AM'))
      const pm = Number(normalizeSlackTimestamp('2:35 PM'))
      expect(pm).toBeGreaterThan(am)
      expect((pm - am) / 3600).toBeCloseTo(5.5, 1)
    })
  })

  describe('5. ISO 8601 & Timezone Offsets', () => {
    const isoCases = [
      '2026-11-04T14:35:00.000Z',
      '2026-11-04T14:35:00Z',
      '2026-11-04T14:35:00+05:30',
      '2026-11-04T14:35:00-08:00',
      'Wed, 04 Nov 2026 14:35:00 GMT'
    ]

    for (const input of isoCases) {
      it(`parses ISO/RFC timezone string "${input}" into valid 6-decimal epoch`, () => {
        const result = normalizeSlackTimestamp(input)
        expect(result).not.toBeNull()
        expect(result).toMatch(VALID_EPOCH_6DEC_REGEX)
        const expectedSec = Math.floor(Date.parse(input) / 1000)
        expect(Math.floor(Number(result))).toBe(expectedSec)
      })
    }
  })

  describe('6. Invalid & Corrupted Strings (Safely return null without uncaught exceptions)', () => {
    const invalidInputs: unknown[] = [
      'Invalid',
      'not a date',
      '123',
      'abc',
      '',
      '   ',
      undefined,
      null,
      'undefined',
      'null',
      'NaN',
      NaN,
      Infinity,
      -Infinity,
      -1,
      0,
      'random text with no time or date',
      '12:65 PM', // Invalid minute
      '25:00', // Invalid hour
      'foo:bar',
      '#channel-name',
      'https://workspace.slack.com/archives/',
      {},
      [],
      true,
      false,
      () => {},
      Symbol('test')
    ]

    for (const input of invalidInputs) {
      it(`returns null or safe result for invalid input: ${typeof input === 'symbol' ? 'Symbol' : typeof input === 'function' ? 'Function' : JSON.stringify(input)}`, () => {
        expect(() => {
          const res = normalizeSlackTimestamp(input as any)
          if (res !== null) {
            // If it returns a string, it MUST strictly be a valid 6-decimal epoch
            expect(res).toMatch(VALID_EPOCH_6DEC_REGEX)
          }
        }).not.toThrow()
      })
    }

    it('explicitly returns null for non-date strings', () => {
      expect(normalizeSlackTimestamp('Invalid')).toBeNull()
      expect(normalizeSlackTimestamp('not a date')).toBeNull()
      expect(normalizeSlackTimestamp('123')).toBeNull()
      expect(normalizeSlackTimestamp('')).toBeNull()
      expect(normalizeSlackTimestamp(undefined)).toBeNull()
      expect(normalizeSlackTimestamp(null as any)).toBeNull()
      expect(normalizeSlackTimestamp(0)).toBeNull()
      expect(normalizeSlackTimestamp(-100)).toBeNull()
      expect(normalizeSlackTimestamp(NaN)).toBeNull()
      expect(normalizeSlackTimestamp(Infinity)).toBeNull()
    })
  })

  describe('7. Month Boundary, Year Boundary, and Dates', () => {
    const boundaryCases = [
      {
        input: 'December 31st, 2025 at 11:59 PM',
        expectedYear: 2025,
        expectedMonth: 11, // 0-indexed December
        expectedDate: 31
      },
      {
        input: 'January 1st, 2026 at 12:00 AM',
        expectedYear: 2026,
        expectedMonth: 0, // 0-indexed January
        expectedDate: 1
      },
      {
        input: 'February 28th, 2026 at 11:59 PM',
        expectedYear: 2026,
        expectedMonth: 1, // February
        expectedDate: 28
      },
      {
        input: 'March 1st, 2026 at 12:00 AM',
        expectedYear: 2026,
        expectedMonth: 2, // March
        expectedDate: 1
      }
    ]

    for (const { input, expectedYear, expectedMonth, expectedDate } of boundaryCases) {
      it(`handles boundary date "${input}" accurately`, () => {
        const result = normalizeSlackTimestamp(input)
        expect(result).not.toBeNull()
        expect(result).toMatch(VALID_EPOCH_6DEC_REGEX)
        const dateObj = new Date(Number(result) * 1000)
        expect(dateObj.getFullYear()).toBe(expectedYear)
        expect(dateObj.getMonth()).toBe(expectedMonth)
        expect(dateObj.getDate()).toBe(expectedDate)
      })
    }
  })

  describe('8. DOM Adapter Script & Day Divider Logic Verification', () => {
    it('generates valid self-contained JavaScript script with parameterized sinceTs floor', () => {
      const script0 = buildReadVisibleMessagesScript(0)
      expect(script0).toContain('const sinceTs = 0;')
      expect(script0).toContain('currentDateContext')
      expect(script0).toContain('day_divider')

      const scriptFloor = buildReadVisibleMessagesScript(1730795000)
      expect(scriptFloor).toContain('const sinceTs = 1730795000;')
    })

    it('simulates day divider context propagation with time-only message text', () => {
      // Simulate what the DOM adapter does when encountering day divider + time text
      const dayDividerText = 'Wednesday, November 4th'
      const messageTimeText = '2:35 PM'
      const synthesizedRawTs = `${dayDividerText} at ${messageTimeText}`

      const normalized = normalizeSlackTimestamp(synthesizedRawTs)
      expect(normalized).not.toBeNull()
      expect(normalized).toMatch(VALID_EPOCH_6DEC_REGEX)
    })

    it('simulates item key regex extraction logic from slack-adapter', () => {
      const itemKey = 'C0CE6JC10EA-1730795700.000100__message'
      const match = itemKey.match(/(\d{10}(?:\.\d+)?)/)
      expect(match).not.toBeNull()
      expect(match![1]).toBe('1730795700.000100')

      const normalized = normalizeSlackTimestamp(match![1])
      expect(normalized).toBe('1730795700.000100')
    })
  })

  describe('9. normalizeScrapedMessage Integration with RawScrapedMessage', () => {
    it('successfully normalizes message with embedded epoch in rawTs', () => {
      const raw: RawScrapedMessage = {
        rawTs: '1730795700.000100__message',
        sender: 'Atul',
        text: 'Test message with embedded rawTs'
      }
      const norm = normalizeScrapedMessage(raw, 'C0CE6JC10EA')
      expect(norm).not.toBeNull()
      expect(norm!.ts).toBe('1730795700.000100')
      expect(norm!.user).toBe('Atul')
      expect(norm!.text).toBe('Test message with embedded rawTs')
    })

    it('successfully normalizes message with humanized relative date in rawTs', () => {
      const raw: RawScrapedMessage = {
        rawTs: 'Today at 2:35 PM',
        sender: 'Alice',
        text: 'Meeting in 5 mins'
      }
      const norm = normalizeScrapedMessage(raw, 'C0CE6JC10EA')
      expect(norm).not.toBeNull()
      expect(norm!.ts).toMatch(VALID_EPOCH_6DEC_REGEX)
    })

    it('drops message if rawTs cannot be parsed', () => {
      const raw: RawScrapedMessage = {
        rawTs: 'garbage-timestamp-value',
        sender: 'Alice',
        text: 'Should be dropped'
      }
      const norm = normalizeScrapedMessage(raw, 'C0CE6JC10EA')
      expect(norm).toBeNull()
    })
  })
})
