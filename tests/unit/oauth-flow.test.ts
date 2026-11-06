import { describe, expect, it } from 'vitest'
import { __test__ } from '../../src/main/slack/oauth-flow'

describe('oauth-flow helpers', () => {
  it('builds authorize URL with user scopes and state', () => {
    const url = __test__.buildSlackAuthorizeUrl(
      'client-123',
      __test__.DEFAULT_REDIRECT_URI,
      'state-abc'
    )
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://slack.com/oauth/v2/authorize')
    expect(parsed.searchParams.get('client_id')).toBe('client-123')
    expect(parsed.searchParams.get('user_scope')).toBe(__test__.USER_SCOPES)
    expect(parsed.searchParams.get('user_scope')).toContain('chat:write')
    expect(parsed.searchParams.get('state')).toBe('state-abc')
  })

  it('parses redirect callback query params', () => {
    const redirect = `${__test__.DEFAULT_REDIRECT_URI}?code=abc&state=xyz`
    expect(__test__.parseRedirect(redirect, __test__.DEFAULT_REDIRECT_URI)).toEqual({
      code: 'abc',
      state: 'xyz'
    })
  })

  it('returns null for unrelated URLs', () => {
    expect(
      __test__.parseRedirect('https://slack.com/oauth', __test__.DEFAULT_REDIRECT_URI)
    ).toBeNull()
  })
})
