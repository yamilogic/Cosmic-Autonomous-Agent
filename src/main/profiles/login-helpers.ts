/**
 * Shared Google/Slack browser-login URL helpers (Electron embed or system Chrome).
 */

export const VERIFY_SLACK_SESSION_SCRIPT = `(() => {
  try {
    const href = location.href || '';
    if (!/app\\.slack\\.com\\/client\\/T[A-Z0-9]+/i.test(href)) return false;
    if (document.querySelector('[data-qa="team_menu_trigger"], .p-ia__sidebar_header, [data-qa="sidebar"]')) {
      return true;
    }
    const text = (document.body && document.body.innerText) || '';
    if (/sign in to slack|enter your email|workspace url/i.test(text.slice(0, 500))) {
      return false;
    }
    return /\\/client\\/T[A-Z0-9]+/i.test(href);
  } catch (_) {
    return false;
  }
})()`

export const GOOGLE_SIGN_IN_URL =
  'https://accounts.google.com/signin/v2/identifier?hl=en&continue=https%3A%2F%2Fwww.google.com%2F'

export const SLACK_GOOGLE_SIGNIN_ENTRY_URL = 'https://slack.com/get-started#/signins'

export function buildGoogleSignInUrl(loginHint?: string, continueUrl?: string): string {
  const url = new URL('https://accounts.google.com/signin/v2/identifier')
  url.searchParams.set('hl', 'en')
  // Prefer loopback continue so Electron is notified automatically after Google auth.
  url.searchParams.set('continue', continueUrl?.trim() || 'https://www.google.com/')
  url.searchParams.set('flowName', 'GlifWebSignIn')
  url.searchParams.set('flowEntry', 'ServiceLogin')
  const hint = loginHint?.trim()
  if (hint && hint.includes('@')) {
    url.searchParams.set('login_hint', hint)
    url.searchParams.set('Email', hint)
  }
  return url.toString()
}

export function isGoogleSignedInUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    const host = url.hostname.toLowerCase()
    const path = url.pathname.toLowerCase()
    if (host === 'myaccount.google.com') {
      return true
    }
    if (host === 'www.google.com' || host === 'google.com') {
      return true
    }
    if (host.includes('google.') && !host.includes('accounts.')) {
      return true
    }
    if (host !== 'accounts.google.com') {
      return false
    }
    if (
      path.includes('challenge') ||
      path.includes('identifier') ||
      path.includes('pwd') ||
      path.includes('speedbump') ||
      path.includes('signin/v2') ||
      path.includes('signin/v3')
    ) {
      return false
    }
    if (/\/b\/\d+\/ManageAccount/i.test(url.pathname) || /\/ManageAccount/i.test(url.pathname)) {
      return true
    }
    if (path.includes('checkcookie') || path.includes('signin/continue')) {
      return true
    }
    if (path === '/' || path === '') {
      return true
    }
    return false
  } catch {
    return false
  }
}

export function isGoogleOauthPageUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    if (url.hostname !== 'accounts.google.com') {
      return false
    }
    return (
      url.pathname.includes('/o/oauth2') ||
      url.pathname.includes('/signin/oauth') ||
      url.pathname.includes('/AccountChooser') ||
      url.searchParams.has('client_id')
    )
  } catch {
    return false
  }
}

export function isSlackClientLoggedInUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    if (url.hostname !== 'app.slack.com') {
      return false
    }
    return /^\/client\/T[A-Z0-9]+(\/|$)/i.test(url.pathname)
  } catch {
    return false
  }
}

export function isSlackSignInEntryUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    return (
      (url.hostname === 'slack.com' || url.hostname.endsWith('.slack.com')) &&
      (url.pathname.includes('get-started') ||
        url.pathname.includes('signin') ||
        url.hash.includes('signin'))
    )
  } catch {
    return false
  }
}
