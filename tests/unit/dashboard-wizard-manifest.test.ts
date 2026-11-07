import { describe, expect, it } from 'vitest'
import { buildManifest } from '../../src/renderer/src/components/dashboard/slack-manifest'

const REDIRECT = 'https://localhost/slack/oauth/callback'

interface Manifest {
  oauth_config: {
    redirect_urls: string[]
    scopes: { user: string[]; bot?: string[] }
  }
  settings: {
    interactivity: { is_enabled: boolean }
    token_rotation_enabled: boolean
  }
}

function parse(redirectUri = REDIRECT): Manifest {
  return JSON.parse(buildManifest(redirectUri))
}

describe('dashboard wizard Slack manifest', () => {
  it('uses the Slack manifest schema for settings', () => {
    const manifest = parse()
    expect(manifest.settings.interactivity).toEqual({ is_enabled: false })
    expect(manifest.settings.token_rotation_enabled).toBe(false)
    expect(manifest.settings).not.toHaveProperty('interactivity.enabled')
  })

  it('keeps the redirect URL and falls back to the default when unset', () => {
    expect(parse().oauth_config.redirect_urls).toEqual([REDIRECT])
    expect(parse('').oauth_config.redirect_urls).toEqual([REDIRECT])
  })

  it('requests the user scopes the token validation expects', () => {
    const scopes = parse().oauth_config.scopes.user
    expect(scopes).toHaveLength(13)
    for (const scope of ['channels:history', 'groups:history', 'users:read', 'chat:write']) {
      expect(scopes).toContain(scope)
    }
    expect(parse().oauth_config.scopes.bot).toBeUndefined()
  })
})
