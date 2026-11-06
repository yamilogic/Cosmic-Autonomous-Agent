import { describe, expect, it } from 'vitest'
import { __test__ } from '../../src/main/profiles/first-login-flow'

describe('first-login-flow URL detection', () => {
  it('detects Google account signed-in landing URLs', () => {
    expect(__test__.isGoogleSignedInUrl('https://myaccount.google.com/')).toBe(true)
    expect(__test__.isGoogleSignedInUrl(__test__.GOOGLE_SIGN_IN_URL)).toBe(false)
  })

  it('detects Google OAuth pages used by Slack Continue with Google', () => {
    expect(
      __test__.isGoogleOauthPageUrl(
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=123&redirect_uri=https://slack.com'
      )
    ).toBe(true)
    expect(__test__.isGoogleOauthPageUrl('https://myaccount.google.com/')).toBe(false)
  })

  it('detects Slack sign-in entry used after Google account login', () => {
    expect(__test__.isSlackSignInEntryUrl(__test__.SLACK_GOOGLE_SIGNIN_ENTRY_URL)).toBe(true)
    expect(__test__.isSlackSignInEntryUrl('https://slack.com/signin')).toBe(true)
  })

  it('prefills Google sign-in URL with email login_hint', () => {
    const url = new URL(__test__.buildGoogleSignInUrl('atul@gmail.com'))
    expect(url.searchParams.get('login_hint')).toBe('atul@gmail.com')
    expect(url.searchParams.get('Email')).toBe('atul@gmail.com')
  })
})
