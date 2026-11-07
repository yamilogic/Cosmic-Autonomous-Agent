import { describe, expect, it } from 'vitest'
import { BrowserViewManager } from '../../src/main/profiles/browser-view-manager'
import { __test__ as firstLogin } from '../../src/main/profiles/first-login-flow'
import {
  partitionForProfile,
  profileSessionWebPreferences,
  SLACK_CLIENT_URL
} from '../../src/main/profiles/session-partition'

/**
 * Contract: first-login BrowserWindow and embedded WebContentsView are one continuous
 * Chromium session. If these assertions fail, the embedded view will re-prompt login.
 */
describe('shared profile session (first-login ↔ embedded view)', () => {
  const profileId = '11111111-2222-4333-8444-555555555555'

  it('uses the identical partition string from one helper', () => {
    const expected = `persist:profile-${profileId}-slack`
    expect(partitionForProfile(profileId, 'slack')).toBe(expected)
    expect(firstLogin.partitionForProfile(profileId, 'slack')).toBe(expected)
    expect(BrowserViewManager.partitionFor(profileId, 'slack')).toBe(expected)
    expect(firstLogin.profileSessionWebPreferences(profileId, 'slack').partition).toBe(expected)
    expect(profileSessionWebPreferences(profileId, 'slack').partition).toBe(expected)
  })

  it('loads the same Slack client URL in both flows', () => {
    expect(SLACK_CLIENT_URL).toBe('https://app.slack.com/client')
    expect(firstLogin.SLACK_CLIENT_URL).toBe(SLACK_CLIENT_URL)
    expect(BrowserViewManager.clientUrl()).toBe(SLACK_CLIENT_URL)
  })

  it('does not treat bare /client as logged-in (avoids closing on initial loadURL)', () => {
    expect(firstLogin.isSlackClientLoggedInUrl('https://app.slack.com/client')).toBe(false)
    expect(firstLogin.isSlackClientLoggedInUrl('https://app.slack.com/client/')).toBe(false)
  })

  it('treats /client/<teamId>/... as logged-in success', () => {
    expect(
      firstLogin.isSlackClientLoggedInUrl('https://app.slack.com/client/T01234567/C01234567')
    ).toBe(true)
  })
})
