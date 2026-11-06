import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  session as electronSession,
  type Session,
  type WebContents,
  type WebPreferences
} from 'electron'
import type { AppId } from '../../shared/types'
import { SLACK_CLIENT_URL } from '../../shared/slack-url'
import { log } from '../logging'

export {
  parseSlackTeamDomain,
  parseTeamIdFromSlackClientUrl,
  resolvePinnedOpenUrl,
  resolveTeamIdInput,
  SLACK_CLIENT_URL,
  slackClientUrlForTeam
} from '../../shared/slack-url'

export const TEAMS_HOME_URL = 'https://teams.microsoft.com/v2/'
export const WHATSAPP_WEB_URL = 'https://web.whatsapp.com/'

/** Major Chrome brand version — keep Client Hints aligned with Electron’s Chromium. */
const CHROME_MAJOR = (process.versions.chrome ?? '142.0.0.0').split('.')[0] ?? '142'
const CHROME_FULL = process.versions.chrome ?? `${CHROME_MAJOR}.0.0.0`

/**
 * Electron’s default UA contains “Electron”, so Slack shows an unsupported-browser
 * banner and Microsoft may serve Classic Teams. Spoof stock Chrome matching this
 * Electron build’s Chromium (see `process.versions.chrome`).
 */
export const CHROME_USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36`

/**
 * Brave-compatible Chromium UA for Slack embed / Google SSO.
 * (Brave ships Chromium; Electron cannot load Brave.app itself inside a WebContentsView.)
 */
export const BRAVE_USER_AGENT = CHROME_USER_AGENT

/** @deprecated Prefer CHROME_USER_AGENT — kept as alias for Teams call sites. */
export const TEAMS_CHROME_USER_AGENT = CHROME_USER_AGENT

/**
 * Partition-level Chrome UA. Safe to call repeatedly.
 * No-op when Electron session APIs aren’t available (unit tests).
 * Note: do not rewrite Sec-CH-UA — mismatched Client Hints make Google more likely
 * to show “This browser or app may not be secure.”
 */
export function applyChromeSessionTweaks(partition: string): Session | null {
  if (typeof electronSession?.fromPartition !== 'function') {
    return null
  }
  const ses = electronSession.fromPartition(partition)
  ses.setUserAgent(CHROME_USER_AGENT)
  return ses
}

/** Official Teams web (MSAL) public client — same as teams.microsoft.com authorize. */
export const TEAMS_WEB_CLIENT_ID = '5e3ce6c0-2b1f-4285-8d4b-75ee78787346'
export const TEAMS_AUTH_REDIRECT_URI = 'https://teams.microsoft.com/v2/authv2'

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Microsoft identity authorize URL matching Teams web MSAL
 * (login.microsoftonline.com → teams.microsoft.com/v2/authv2).
 * Fresh PKCE / nonce / state each call — do not reuse a captured browser URL.
 */
export function buildTeamsMicrosoftLoginUrl(): string {
  const verifier = base64Url(randomBytes(32))
  const codeChallenge = base64Url(createHash('sha256').update(verifier).digest())
  const requestId = randomUUID()
  const interactionId = randomUUID()
  const statePayload = Buffer.from(
    JSON.stringify({
      id: interactionId,
      meta: { interactionType: 'redirect' }
    }),
    'utf8'
  ).toString('base64')
  const postLogin = 'https://teams.microsoft.com/v2/?culture=en-in&country=in&enablemcasfort21=true'

  const params = new URLSearchParams({
    client_id: TEAMS_WEB_CLIENT_ID,
    scope: 'openId profile openid offline_access',
    redirect_uri: TEAMS_AUTH_REDIRECT_URI,
    'client-request-id': requestId,
    response_mode: 'fragment',
    client_info: '1',
    clidata: '1',
    nonce: randomUUID(),
    state: `${statePayload}|${postLogin}`,
    'x-client-SKU': 'msal.js.browser',
    'x-client-VER': '5.6.3',
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    sso_reload: 'true',
    prompt: 'select_account'
  })

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
}

export function isMicrosoftIdentityHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'login.microsoftonline.com' ||
    host.endsWith('.microsoftonline.com') ||
    host === 'login.live.com' ||
    host.endsWith('.live.com') ||
    host === 'account.live.com' ||
    host === 'login.microsoft.com' ||
    host.endsWith('.microsoft.com') ||
    host.endsWith('.msauth.net') ||
    host.endsWith('.msftauth.net') ||
    host.endsWith('.office.com') ||
    host.endsWith('.office365.com') ||
    host.includes('teams.microsoft.com') ||
    host.includes('teams.live.com')
  )
}

/**
 * Session isolation per profile + app.
 * First-login window and embedded view MUST use the same string for profileId+appId.
 */
export function partitionForProfile(profileId: string, appId: AppId = 'slack'): string {
  return `persist:profile-${profileId}-${appId}`
}

/**
 * Dedicated session isolation per project card + app.
 * Ensures complete independence between dashboard project cards.
 */
export function partitionForCard(projectId: string, appId: AppId = 'slack'): string {
  return `persist:card-${projectId}-${appId}`
}

/** @deprecated Prefer partitionForProfile(profileId, appId). */
export function partitionForProfileLegacy(profileId: string): string {
  return `persist:profile-${profileId}`
}

export function profileSessionWebPreferences(
  profileId: string,
  appId: AppId = 'slack'
): Pick<WebPreferences, 'partition' | 'sandbox' | 'contextIsolation' | 'nodeIntegration'> {
  const partition = partitionForProfile(profileId, appId)
  // Apply before any BrowserWindow/WebContentsView is created on this partition.
  applyChromeSessionTweaks(partition)
  return {
    partition,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false
  }
}

export function cardSessionWebPreferences(
  projectId: string,
  appId: AppId = 'slack'
): Pick<WebPreferences, 'partition' | 'sandbox' | 'contextIsolation' | 'nodeIntegration'> {
  const partition = partitionForCard(projectId, appId)
  applyChromeSessionTweaks(partition)
  return {
    partition,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false
  }
}

export function homeUrlForApp(appId: AppId): string {
  if (appId === 'teams') {
    return TEAMS_HOME_URL
  }
  if (appId === 'whatsapp') {
    return WHATSAPP_WEB_URL
  }
  return SLACK_CLIENT_URL
}

export function isTeamsAppUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    const host = url.hostname.toLowerCase()
    if (host.includes('login.microsoftonline.com')) {
      return false
    }
    return host.includes('teams.microsoft.com') || host.includes('teams.live.com')
  } catch {
    return false
  }
}

/** Microsoft logout / "you signed out" pages (not a valid Teams session). */
export function isMicrosoftSignedOutUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    const host = url.hostname.toLowerCase()
    const path = url.pathname.toLowerCase()
    const full = urlString.toLowerCase()
    if (
      full.includes('oauth20_logout') ||
      full.includes('signedout') ||
      full.includes('signed-out') ||
      path.includes('/logout') ||
      path.includes('/signout')
    ) {
      return true
    }
    if (
      (host.includes('login.live.com') ||
        host.includes('account.live.com') ||
        host.includes('login.microsoftonline.com')) &&
      (path.includes('logout') || full.includes('wa=wsignoutcleanup'))
    ) {
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Real Teams app shell after Microsoft sign-in.
 * Excludes OAuth bounce (`/v2/authv2`) and logout pages — those must not count as success.
 */
export function isTeamsSignedInUrl(urlString: string): boolean {
  if (!isTeamsAppUrl(urlString) || isMicrosoftSignedOutUrl(urlString)) {
    return false
  }
  try {
    const path = new URL(urlString).pathname.toLowerCase()
    if (path.includes('/authv2') || path === '/go' || path.startsWith('/go/')) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/** True when URL is classic Teams (no /v2) and should be upgraded. */
export function needsTeamsV2Upgrade(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    const host = url.hostname.toLowerCase()
    if (!host.includes('teams.microsoft.com') && !host.includes('teams.live.com')) {
      return false
    }
    const path = url.pathname.toLowerCase()
    if (path.startsWith('/v2')) {
      return false
    }
    // Keep identity / download marketing hosts alone if not teams app host
    return true
  } catch {
    return false
  }
}

/** Force new Teams web (`/v2/`) instead of classic Teams. */
export function normalizeTeamsOpenUrl(urlString: string): string {
  if (!urlString.trim()) {
    return TEAMS_HOME_URL
  }
  if (urlString.startsWith('msteams:')) {
    return TEAMS_HOME_URL
  }
  try {
    const url = new URL(urlString)
    const host = url.hostname.toLowerCase()
    if (!host.includes('teams.microsoft.com') && !host.includes('teams.live.com')) {
      return urlString
    }
    if (!url.pathname.toLowerCase().startsWith('/v2')) {
      const rest = url.pathname === '/' ? '' : url.pathname.replace(/^\//, '')
      url.pathname = rest ? `/v2/${rest}` : '/v2/'
    }
    if (url.hash.startsWith('#/')) {
      url.hash = ''
    }
    return url.toString()
  } catch {
    return TEAMS_HOME_URL
  }
}

const CLASSIC_TEAMS_GATE_SCRIPT = `(() => {
  try {
    const text = (document.body && document.body.innerText) || '';
    if (/Classic Teams is no longer available/i.test(text)) {
      location.replace('https://teams.microsoft.com/v2/');
    }
  } catch (_) {}
})()`

/**
 * Make Teams web work inside Electron: Chrome UA, block classic/msteams deep links,
 * auto-escape classic retirement page without opening the system browser.
 */
export function applyTeamsWebContentsTweaks(contents: WebContents): void {
  contents.setUserAgent(CHROME_USER_AGENT)

  contents.on('will-navigate', (event, url) => {
    if (url.startsWith('msteams:')) {
      event.preventDefault()
      void contents.loadURL(TEAMS_HOME_URL)
      return
    }
    if (needsTeamsV2Upgrade(url)) {
      event.preventDefault()
      void contents.loadURL(normalizeTeamsOpenUrl(url))
    }
  })

  contents.on('did-finish-load', () => {
    void contents.executeJavaScript(CLASSIC_TEAMS_GATE_SCRIPT, true).catch(() => {
      /* ignore */
    })
  })
}

/** Slack embed / Google login: Brave Chromium UA (same Chromium family as Brave Browser). */
export function applySlackWebContentsTweaks(contents: WebContents): void {
  contents.setUserAgent(BRAVE_USER_AGENT)
}

export const WHATSAPP_DARK_CSS = `
  html, body, #app, .landing-wrapper, [data-testid="landing-wrapper"], [data-asset-chat-background-dark] {
    height: 100% !important;
    min-height: 100vh !important;
    background-color: #111b21 !important;
    color: #e9edef !important;
  }
  .landing-window, [data-testid="landing-window"], [data-testid="qrcode-container"], [data-testid="qrcode-wrapper"] {
    background-color: #222e35 !important;
    color: #e9edef !important;
    border-radius: 16px !important;
    border: 1px solid rgba(255, 255, 255, 0.08) !important;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45) !important;
  }
  .landing-title, .landing-header, .landing-wrapper span, .landing-wrapper div, .landing-wrapper ol, .landing-wrapper li, [data-testid="landing-window"] * {
    color: #e9edef !important;
  }
  .landing-wrapper a, [data-testid="landing-window"] a {
    color: #25d366 !important;
  }
`

/** WhatsApp Web: Chrome UA so WA treats us like a normal desktop browser + official dark theme injection */
export function applyWhatsAppWebContentsTweaks(contents: WebContents): void {
  contents.setUserAgent(CHROME_USER_AGENT)

  const injectDarkTheme = (): void => {
    contents.insertCSS(WHATSAPP_DARK_CSS).catch(() => undefined)
    void contents
      .executeJavaScript(
        `(() => {
          try {
            const applyDark = () => {
              if (document.documentElement && !document.documentElement.classList.contains('dark')) {
                document.documentElement.classList.add('dark');
              }
              if (document.body && !document.body.classList.contains('dark')) {
                document.body.classList.add('dark');
              }
              if (window.localStorage && window.localStorage.getItem('theme') !== '"dark"') {
                window.localStorage.setItem('theme', '"dark"');
              }
            };
            applyDark();
            const obs = new MutationObserver(applyDark);
            if (document.documentElement) {
              obs.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class'] });
            }
          } catch (_) {}
        })()`,
        true
      )
      .catch(() => undefined)
  }

  contents.on('dom-ready', injectDarkTheme)
  contents.on('did-finish-load', injectDarkTheme)
}

const HIDE_DM_CSS = `
  [data-qa="dm_list"] { display: none !important; }
  [data-qa="direct_messages"] { display: none !important; }
`

/** Hide Slack’s Electron/unsupported-browser deprecation strip if it still appears. */
const HIDE_UNSUPPORTED_BROWSER_CSS = `
  [data-qa="unsupported_browser_banner"],
  [data-qa="browser_warning_banner"],
  [class*="p-deprecation_banner"],
  [class*="c-banner--deprecation"],
  div[role="alert"][class*="banner"]:has(a[href*="unsupported"]),
  div[role="status"]:has([class*="warning"]):has(a[href*="learn"]) {
    display: none !important;
  }
`

export function injectHideDmCss(contents: WebContents): void {
  contents.insertCSS(HIDE_DM_CSS).catch((err) => {
    log.warn('css inject failed', { err: String(err) })
  })
  contents.insertCSS(HIDE_UNSUPPORTED_BROWSER_CSS).catch((err) => {
    log.warn('unsupported-browser css inject failed', { err: String(err) })
  })
  // Text-match fallback — Slack changes class names often
  void contents
    .executeJavaScript(
      `(() => {
        const hide = () => {
          for (const el of document.querySelectorAll('div, section, aside')) {
            const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
            if (t.length > 40 && t.length < 220 && /won't be supported|update your browser to keep using Slack/i.test(t)) {
              el.style.setProperty('display', 'none', 'important');
            }
          }
        };
        hide();
        const obs = new MutationObserver(hide);
        if (document.documentElement) {
          obs.observe(document.documentElement, { childList: true, subtree: true });
          setTimeout(() => obs.disconnect(), 15000);
        }
      })()`,
      true
    )
    .catch(() => {
      /* ignore */
    })
}
