import { describe, expect, it } from 'vitest'
import {
  describeMissingScopes,
  missingSlackScopes,
  REQUIRED_SLACK_SCOPES
} from '../../src/main/dashboard/slack-scopes'

describe('slack scopes', () => {
  it('accepts a token with every required scope', () => {
    expect(missingSlackScopes([...REQUIRED_SLACK_SCOPES])).toEqual([])
  })

  it('lists exactly the missing scopes', () => {
    expect(missingSlackScopes(['channels:read', 'groups:read'])).toEqual([
      'channels:history',
      'groups:history',
      'users:read',
      'chat:write'
    ])
    expect(describeMissingScopes(['chat:write'])).toContain('chat:write')
  })

  it('skips scope checks when Slack did not report scopes', () => {
    expect(missingSlackScopes(null)).toEqual([])
    expect(missingSlackScopes(undefined)).toEqual([])
  })
})
