import { describe, expect, it } from 'vitest'
import {
  isSlackPlaceholderName,
  parseSlackClientPath,
  parseTeamIdFromSlackClientUrl
} from '../../src/shared/slack-url'

describe('parseSlackClientPath', () => {
  it('reads team and channel so switching can restore the last conversation', () => {
    expect(parseSlackClientPath('https://app.slack.com/client/T06ER3VQYDP/C0123456789')).toEqual({
      teamId: 'T06ER3VQYDP',
      conversationId: 'C0123456789'
    })
  })

  it('reads team-only URLs', () => {
    expect(parseSlackClientPath('https://app.slack.com/client/T8X079UBD')).toEqual({
      teamId: 'T8X079UBD'
    })
    expect(parseTeamIdFromSlackClientUrl('https://app.slack.com/client/T8X079UBD')).toBe(
      'T8X079UBD'
    )
  })

  it('treats T… strings as placeholder names, not workspace titles', () => {
    expect(isSlackPlaceholderName('T06ER3VQYDP')).toBe(true)
    expect(isSlackPlaceholderName('Acme Inc')).toBe(false)
  })
})
