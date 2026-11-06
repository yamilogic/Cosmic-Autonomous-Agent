export const USER_SCOPES = [
  'channels:read',
  'channels:history',
  'groups:read',
  'groups:history',
  'team:read',
  'users:read',
  'users.profile:read',
  'im:read',
  'im:history',
  'mpim:read',
  'mpim:history',
  'emoji:read',
  'chat:write'
]

const DEFAULT_REDIRECT_URI = 'https://localhost/slack/oauth/callback'

export function buildManifest(redirectUri: string): string {
  return JSON.stringify(
    {
      display_information: {
        name: 'Orbit Dashboard Connector',
        description: 'Project feed and chat replies for the Orbit dashboard',
        background_color: '#1B1F3B'
      },
      oauth_config: {
        redirect_urls: [redirectUri || DEFAULT_REDIRECT_URI],
        scopes: { user: USER_SCOPES }
      },
      settings: {
        org_deploy_enabled: false,
        socket_mode_enabled: false,
        token_rotation_enabled: false,
        is_hosted: false,
        interactivity: { is_enabled: false }
      }
    },
    null,
    2
  )
}
