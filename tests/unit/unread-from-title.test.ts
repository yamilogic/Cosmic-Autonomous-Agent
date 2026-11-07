import { describe, expect, it } from 'vitest'
import {
  parseUnreadFromTitle,
  splitUnreadKey,
  sumUnread
} from '../../src/main/profiles/unread-from-title'

describe('parseUnreadFromTitle', () => {
  it('parses Slack-style prefix counts', () => {
    expect(parseUnreadFromTitle('(3) Acme - Slack', 'slack')).toBe(3)
    expect(parseUnreadFromTitle('Acme - Slack', 'slack')).toBe(0)
  })

  it('ignores Slack titles that mention Channel in parentheses', () => {
    expect(parseUnreadFromTitle('general (Channel) - excellencetech - Slack', 'slack')).toBe(0)
    expect(parseUnreadFromTitle('Slack (4)', 'slack')).toBe(0)
  })

  it('parses WhatsApp counts at the end of the title', () => {
    expect(parseUnreadFromTitle('WhatsApp (2)', 'whatsapp')).toBe(2)
  })

  it('parses Teams-style new counts', () => {
    expect(parseUnreadFromTitle('Chat | 2 new | Microsoft Teams', 'teams')).toBe(2)
    expect(parseUnreadFromTitle('(4) Chat | Microsoft Teams', 'teams')).toBe(4)
  })
})

describe('splitUnreadKey', () => {
  it('splits profile and app at the last colon', () => {
    expect(splitUnreadKey('abc:slack')).toEqual({ profileId: 'abc', appId: 'slack' })
  })
})

describe('sumUnread', () => {
  it('sums positive counts', () => {
    expect(sumUnread({ a: 2, b: 0, c: 5 })).toBe(7)
  })
})
