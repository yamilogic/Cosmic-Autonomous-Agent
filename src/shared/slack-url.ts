export const SLACK_CLIENT_URL = 'https://app.slack.com/client'

export function slackClientUrlForTeam(teamId: string): string {
  const trimmed = teamId.trim()
  if (
    !trimmed ||
    trimmed.startsWith('team-') ||
    trimmed === 'T-PENDING' ||
    trimmed === 'team' ||
    !/^T[A-Z0-9]+$/i.test(trimmed)
  ) {
    return SLACK_CLIENT_URL
  }
  return `${SLACK_CLIENT_URL}/${trimmed}`
}

/** Team + conversation from https://app.slack.com/client/T…/C… (channel restored on switch). */
export function parseSlackClientPath(
  urlString: string
): { teamId: string; conversationId?: string } | null {
  try {
    const url = new URL(urlString)
    if (url.hostname !== 'app.slack.com') {
      return null
    }
    const match = url.pathname.match(/^\/client\/(T[A-Z0-9]+)(?:\/([CDG][A-Z0-9]+))?/i)
    if (!match?.[1]) {
      return null
    }
    return {
      teamId: match[1],
      ...(match[2] ? { conversationId: match[2] } : {})
    }
  } catch {
    return null
  }
}

export function slackClientUrlForConversation(teamId: string, conversationId?: string): string {
  if (conversationId?.trim()) {
    return `${SLACK_CLIENT_URL}/${teamId.trim()}/${conversationId.trim()}`
  }
  return slackClientUrlForTeam(teamId)
}

export function isSlackPlaceholderName(name: string | undefined | null): boolean {
  const t = name?.trim() ?? ''
  return (
    !t ||
    /^T[A-Z0-9]+$/i.test(t) ||
    /^slack$/i.test(t) ||
    /^unknown$/i.test(t) ||
    /^\d+\s+new\s+items?/i.test(t) ||
    /^new\s+item/i.test(t) ||
    /^\(\d+\)/.test(t)
  )
}

/** Canonical open URL for a pin (prefer stored URL, else client URL from team id). */
export function resolvePinnedOpenUrl(input: {
  teamId: string
  openUrl?: string
  teamDomain?: string
}): string {
  const stored = input.openUrl?.trim()
  if (
    stored &&
    !stored.includes('/client/team-') &&
    stored !== 'https://app.slack.com/client/team' &&
    !stored.includes('glitch')
  ) {
    return stored
  }
  const domain = input.teamDomain?.trim()
  if (domain && domain !== 'team' && domain !== 'unknown' && !domain.startsWith('team-')) {
    return `https://${domain}.slack.com`
  }
  return slackClientUrlForTeam(input.teamId)
}

/** Parse subdomain from https://acme.slack.com (ignores app/api/status hosts). */
export function parseSlackTeamDomain(urlString: string): string | null {
  try {
    const url = new URL(urlString)
    const match = url.hostname.match(/^([a-z0-9-]+)\.slack\.com$/i)
    if (!match) {
      return null
    }
    const domain = match[1].toLowerCase()
    if (domain === 'app' || domain === 'api' || domain === 'status' || domain === 'slackb') {
      return null
    }
    return domain
  } catch {
    return null
  }
}

/** Extract Slack team id from an app.slack.com/client/... URL. */
export function parseTeamIdFromSlackClientUrl(urlString: string): string | null {
  return parseSlackClientPath(urlString)?.teamId ?? null
}

/** Accept a team id or a full Slack client URL and return a normalized team id. */
export function resolveTeamIdInput(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  if (/^T[A-Z0-9]+$/i.test(trimmed)) {
    return trimmed
  }
  return parseTeamIdFromSlackClientUrl(trimmed)
}
