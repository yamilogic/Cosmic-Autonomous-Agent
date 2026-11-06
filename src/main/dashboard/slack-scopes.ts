/**
 * Slack scopes Orbit needs for a client/Our Slack bot token. Validation is
 * exact: the UI shows the missing names, never a generic "invalid token".
 */
export const REQUIRED_SLACK_SCOPES = [
  'channels:read',
  'groups:read',
  'channels:history',
  'groups:history',
  'users:read',
  'chat:write'
] as const

/** Scopes without which read-only sync can work but replies cannot. */
export const WRITE_SLACK_SCOPES = ['chat:write'] as const

export function missingSlackScopes(granted: readonly string[] | null | undefined): string[] {
  if (!granted) return []
  const have = new Set(granted.map((scope) => scope.trim()).filter(Boolean))
  return REQUIRED_SLACK_SCOPES.filter((scope) => !have.has(scope))
}

export function describeMissingScopes(missing: readonly string[]): string {
  if (missing.length === 0) return ''
  return `Slack token is missing required scopes: ${missing.join(', ')}.`
}
