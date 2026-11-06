import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import type { SlackWorkspaceLink } from '../../shared/types'
import { log } from '../logging'
import { partitionForProfile } from '../profiles/session-partition'
import { getTeamInfo } from './slack-api-client'
import type { TokenStore } from './token-store'
import type { SlackOauthTokenResponse } from './types'

const DEFAULT_REDIRECT_URI = 'https://localhost/slack/oauth/callback'
const USER_SCOPES = [
  'channels:read',
  'channels:history',
  'groups:read',
  'groups:history',
  'team:read',
  'chat:write'
].join(',')

export interface OauthConfig {
  clientId: string
  clientSecret: string
  redirectUri?: string
}

export interface OauthFlowDeps {
  tokenStore: TokenStore
  config: OauthConfig
}

function buildSlackAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL('https://slack.com/oauth/v2/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('user_scope', USER_SCOPES)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

function parseRedirect(
  urlString: string,
  redirectUri: string
): { code: string; state: string } | null {
  if (!urlString.startsWith(redirectUri)) {
    return null
  }
  const url = new URL(urlString)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    return null
  }
  return { code, state }
}

function waitForRedirect(
  authWindow: BrowserWindow,
  redirectUri: string
): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    const contents = authWindow.webContents

    const cleanup = (): void => {
      contents.removeListener('will-redirect', onRedirect)
      contents.removeListener('did-navigate', onNavigate)
      authWindow.removeListener('closed', onClosed)
    }

    const tryParse = (url: string): void => {
      const parsed = parseRedirect(url, redirectUri)
      if (parsed) {
        cleanup()
        resolve(parsed)
      }
    }

    const onRedirect = (event: Electron.Event, url: string): void => {
      if (url.startsWith(redirectUri)) {
        event.preventDefault()
        tryParse(url)
      }
    }

    const onNavigate = (_event: Electron.Event, url: string): void => {
      tryParse(url)
    }

    const onClosed = (): void => {
      cleanup()
      reject(new Error('OAuth window closed before completion'))
    }

    contents.on('will-redirect', onRedirect)
    contents.on('did-navigate', onNavigate)
    authWindow.on('closed', onClosed)
  })
}

async function exchangeCodeForToken(
  config: OauthConfig,
  code: string,
  redirectUri: string
): Promise<SlackOauthTokenResponse> {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri
    })
  })

  return (await res.json()) as SlackOauthTokenResponse
}

export async function connectWorkspaceForProfile(
  profileId: string,
  deps: OauthFlowDeps
): Promise<SlackWorkspaceLink> {
  const { clientId, clientSecret } = deps.config
  if (!clientId || !clientSecret) {
    throw new Error(
      'Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in the environment.'
    )
  }

  const redirectUri = deps.config.redirectUri ?? DEFAULT_REDIRECT_URI
  const state = randomUUID()
  const authWindow = new BrowserWindow({
    width: 480,
    height: 700,
    show: true,
    webPreferences: {
      partition: partitionForProfile(profileId, 'slack'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  try {
    const authorizeUrl = buildSlackAuthorizeUrl(clientId, redirectUri, state)
    await authWindow.loadURL(authorizeUrl)

    const { code, state: returnedState } = await waitForRedirect(authWindow, redirectUri)
    if (returnedState !== state) {
      throw new Error('OAuth state mismatch')
    }

    const tokenResponse = await exchangeCodeForToken(deps.config, code, redirectUri)
    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.error ?? 'unknown_error'}`)
    }

    const userToken = tokenResponse.authed_user?.access_token
    if (!userToken) {
      throw new Error('Token exchange did not return a user access token')
    }

    const teamId = tokenResponse.team?.id
    const teamName = tokenResponse.team?.name ?? 'Unknown workspace'
    if (!teamId) {
      throw new Error('Token exchange did not return a team id')
    }

    let teamDomain = ''
    try {
      const team = await getTeamInfo(userToken)
      teamDomain = team.domain ?? ''
    } catch (err) {
      log.warn('team.info follow-up failed', { err: String(err) })
    }

    const scopes = (tokenResponse.authed_user?.scope ?? tokenResponse.scope ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const link: SlackWorkspaceLink = {
      profileId,
      teamId,
      teamName,
      teamDomain,
      connectedAt: new Date().toISOString(),
      scopes
    }

    await deps.tokenStore.save(profileId, teamId, userToken, link)
    log.info('workspace connected', { profileId, teamId, teamName })
    return link
  } finally {
    if (!authWindow.isDestroyed()) {
      authWindow.close()
    }
  }
}

export const __test__ = {
  buildSlackAuthorizeUrl,
  parseRedirect,
  USER_SCOPES,
  DEFAULT_REDIRECT_URI
}
