import { describe, expect, it } from 'vitest'
import { BrowserViewManager } from '../../src/main/profiles/browser-view-manager'
import {
  normalizeDiscoveredWorkspaces,
  normalizeTeamsDiscoveredWorkspaces
} from '../../src/main/profiles/discover-workspaces'
import {
  buildTeamsMicrosoftLoginUrl,
  isMicrosoftIdentityHost,
  isMicrosoftSignedOutUrl,
  isTeamsAppUrl,
  isTeamsSignedInUrl,
  normalizeTeamsOpenUrl,
  partitionForProfile,
  TEAMS_AUTH_REDIRECT_URI,
  TEAMS_HOME_URL,
  TEAMS_WEB_CLIENT_ID
} from '../../src/main/profiles/session-partition'
import {
  parseSlackTeamDomain,
  parseTeamIdFromSlackClientUrl,
  resolvePinnedOpenUrl,
  resolveTeamIdInput,
  slackClientUrlForTeam,
  SLACK_CLIENT_URL
} from '../../src/shared/slack-url'

describe('session-partition / slack-url', () => {
  it('names partitions with persist:profile-<id>-<app>', () => {
    expect(partitionForProfile('abc', 'slack')).toBe('persist:profile-abc-slack')
    expect(partitionForProfile('abc', 'teams')).toBe('persist:profile-abc-teams')
    expect(partitionForProfile('abc', 'whatsapp')).toBe('persist:profile-abc-whatsapp')
    expect(BrowserViewManager.partitionFor('abc', 'teams')).toBe('persist:profile-abc-teams')
    expect(BrowserViewManager.whatsappWebUrl()).toBe('https://web.whatsapp.com/')
  })

  it('builds workspace client URLs', () => {
    expect(slackClientUrlForTeam('T0123ABCD')).toBe('https://app.slack.com/client/T0123ABCD')
    expect(BrowserViewManager.workspaceClientUrl('T99')).toBe('https://app.slack.com/client/T99')
    expect(slackClientUrlForTeam('')).toBe(SLACK_CLIENT_URL)
    expect(BrowserViewManager.teamsHomeUrl()).toBe(TEAMS_HOME_URL)
  })

  it('resolves pinned open URLs', () => {
    expect(resolvePinnedOpenUrl({ teamId: 'T1', openUrl: 'https://acme.slack.com' })).toBe(
      'https://acme.slack.com'
    )
    expect(resolvePinnedOpenUrl({ teamId: 'T1', teamDomain: 'acme' })).toBe(
      'https://acme.slack.com'
    )
    expect(resolvePinnedOpenUrl({ teamId: 'T1' })).toBe('https://app.slack.com/client/T1')
  })

  it('parses team id and domain', () => {
    expect(parseTeamIdFromSlackClientUrl('https://app.slack.com/client/T0123/C456')).toBe('T0123')
    expect(parseSlackTeamDomain('https://archyai.slack.com/')).toBe('archyai')
    expect(parseSlackTeamDomain('https://app.slack.com/client/T1')).toBeNull()
    expect(resolveTeamIdInput('T0123ABCD')).toBe('T0123ABCD')
    expect(resolveTeamIdInput('https://app.slack.com/client/T99/C1')).toBe('T99')
    expect(resolveTeamIdInput('not-valid')).toBeNull()
  })

  it('detects Teams app URLs and Microsoft identity hosts', () => {
    expect(isTeamsAppUrl('https://teams.microsoft.com/v2/')).toBe(true)
    expect(isTeamsAppUrl('https://login.microsoftonline.com/common/oauth2')).toBe(false)
    expect(isMicrosoftIdentityHost('login.microsoftonline.com')).toBe(true)
    expect(isMicrosoftIdentityHost('accounts.google.com')).toBe(false)
  })

  it('only treats real Teams shell as signed-in (not authv2 / logout)', () => {
    expect(isTeamsSignedInUrl('https://teams.microsoft.com/v2/')).toBe(true)
    expect(isTeamsSignedInUrl('https://teams.microsoft.com/v2/authv2')).toBe(false)
    expect(isMicrosoftSignedOutUrl('https://login.live.com/logout.srf?wa=wsignoutcleanup1.0')).toBe(
      true
    )
    expect(isTeamsSignedInUrl('https://login.live.com/logout.srf')).toBe(false)
  })

  it('normalizes classic Teams URLs to new web /v2/', () => {
    expect(normalizeTeamsOpenUrl('https://teams.microsoft.com/')).toBe(
      'https://teams.microsoft.com/v2/'
    )
    expect(normalizeTeamsOpenUrl('msteams://teams.microsoft.com')).toBe(TEAMS_HOME_URL)
    expect(normalizeTeamsOpenUrl('https://teams.microsoft.com/v2/?foo=1')).toContain('/v2/')
  })

  it('builds Teams web MSAL authorize URL (client_id + authv2 redirect)', () => {
    const url = new URL(buildTeamsMicrosoftLoginUrl())
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
    )
    expect(url.searchParams.get('client_id')).toBe(TEAMS_WEB_CLIENT_ID)
    expect(url.searchParams.get('redirect_uri')).toBe(TEAMS_AUTH_REDIRECT_URI)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toContain('openid')
  })

  it('normalizes discovered workspaces from embed scrape', () => {
    const list = normalizeDiscoveredWorkspaces([
      {
        teamId: null,
        teamName: 'Archy AI',
        openUrl: 'https://archyai.slack.com',
        teamDomain: 'archyai'
      },
      {
        teamId: 'TABC',
        teamName: 'Inside',
        openUrl: 'https://app.slack.com/client/TABC'
      }
    ])
    expect(list).toEqual([
      {
        teamId: null,
        teamName: 'Archy AI',
        openUrl: 'https://archyai.slack.com',
        teamDomain: 'archyai'
      },
      {
        teamId: 'TABC',
        teamName: 'Inside',
        openUrl: 'https://app.slack.com/client/TABC'
      }
    ])
  })

  it('normalizes Teams discovered workspaces', () => {
    const list = normalizeTeamsDiscoveredWorkspaces([
      {
        teamId: 'tenant-1',
        teamName: 'Contoso',
        openUrl: 'https://teams.microsoft.com/?tenantId=11111111-1111-1111-1111-111111111111'
      },
      {
        teamId: 'teams-v3t2dh',
        teamName: 'Fake hash',
        openUrl: 'https://teams.microsoft.com/v2/foo'
      },
      {
        teamId: 'teams-home',
        teamName: 'Microsoft Teams',
        openUrl: 'https://teams.microsoft.com/v2/'
      },
      {
        teamId: 'tenant-9188040d-6c67-4c5b-b112-36a304b66dad',
        teamName: 'Consumers',
        openUrl: 'https://teams.microsoft.com/v2/?tenantId=9188040d-6c67-4c5b-b112-36a304b66dad'
      }
    ])
    expect(list).toEqual([
      {
        teamId: 'tenant-1',
        teamName: 'Contoso',
        openUrl: 'https://teams.microsoft.com/?tenantId=11111111-1111-1111-1111-111111111111'
      }
    ])
  })

  it('collapses personal Teams consumer tenant to a single home', () => {
    const list = normalizeTeamsDiscoveredWorkspaces([
      {
        teamId: 'teams-home',
        teamName: 'Personal',
        openUrl: 'https://teams.microsoft.com/v2/'
      },
      {
        teamId: 'tenant-9188040d-6c67-4c5b-b112-36a304b66dad',
        teamName: 'Microsoft Teams',
        openUrl: 'https://teams.microsoft.com/v2/?tenantId=9188040d-6c67-4c5b-b112-36a304b66dad'
      }
    ])
    expect(list).toEqual([
      {
        teamId: 'teams-home',
        teamName: 'Personal',
        openUrl: 'https://teams.microsoft.com/v2/'
      }
    ])
  })
})
