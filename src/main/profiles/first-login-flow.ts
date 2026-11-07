import { BrowserWindow, type WebContents } from 'electron'
import { log } from '../logging'
import { resolveChromeExecutable, runChromeSystemLogin } from './chrome-system-login'
import {
  runGoogleAuthEmbedded,
  runSlackAuthEmbedded,
  type EmbeddedAuthResult
} from './embedded-browser-auth'
import { startLoopbackAuthServer } from './local-auth-server'
import {
  buildGoogleSignInUrl,
  GOOGLE_SIGN_IN_URL,
  isGoogleOauthPageUrl,
  isGoogleSignedInUrl,
  isSlackClientLoggedInUrl,
  isSlackSignInEntryUrl,
  SLACK_GOOGLE_SIGNIN_ENTRY_URL,
  VERIFY_SLACK_SESSION_SCRIPT
} from './login-helpers'
import {
  partitionForProfile,
  profileSessionWebPreferences,
  SLACK_CLIENT_URL
} from './session-partition'

export {
  buildGoogleSignInUrl,
  GOOGLE_SIGN_IN_URL,
  isGoogleOauthPageUrl,
  isGoogleSignedInUrl,
  isSlackClientLoggedInUrl,
  isSlackSignInEntryUrl,
  SLACK_GOOGLE_SIGNIN_ENTRY_URL,
  VERIFY_SLACK_SESSION_SCRIPT
}

export type FirstLoginResult = 'signed-in' | 'cancelled'

export type FirstLoginPhase = 'signing-in-google' | 'signing-in-slack'

export async function clickSlackContinueWithGoogle(contents: WebContents): Promise<boolean> {
  try {
    const clicked = (await contents.executeJavaScript(`
      (() => {
        const selectors = [
          '[data-qa="sign_in_with_google"]',
          'a[data-qa="sign_in_with_google"]',
          'button[data-qa="sign_in_with_google"]',
          'a[href*="google"]'
        ];
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el) { el.click(); return true; }
        }
        const nodes = Array.from(document.querySelectorAll('a, button, div[role="button"], span'));
        const hit = nodes.find((n) =>
          /continue with google|sign in with google|^google$/i.test((n.textContent || '').trim())
        );
        if (hit) { hit.click(); return true; }
        return false;
      })()
    `)) as boolean
    return Boolean(clicked)
  } catch (err) {
    log.warn('click Continue with Google failed', { err: String(err) })
    return false
  }
}

export interface ChromeAuthUiOptions {
  parentWindow?: BrowserWindow | null
  loginHint?: string
  onPhaseChange?: (phase: FirstLoginPhase) => void | Promise<void>
}

function bringToFront(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.moveTop()
}

const DONE_URL = 'slack-dashboard://chrome-login-done'

function waitingHtml(kind: 'google' | 'slack', hasChrome: boolean, loopbackUrl?: string): string {
  const doneHref = loopbackUrl || DONE_URL
  const body = !hasChrome
    ? `<h1>Google Chrome required</h1>
       <p>Install <strong>Google Chrome</strong>, then try again.</p>`
    : kind === 'google'
      ? `<h1>Step 1 — Google in Chrome</h1>
         <p>Finish password + 2SV in Chrome. When you reach Google (or My Account), click below or close Chrome.</p>
         <p><a class="btn" href="${doneHref}">I’ve signed in to Google — Continue</a></p>
         <p class="muted">Closing this green strip cancels.</p>`
      : `<h1>Step 2 — Slack in Chrome</h1>
         <p>Sign in to Slack with Google in Chrome. When Slack is open, click below or close Chrome — then Slack embeds in this app.</p>
         <p><a class="btn" href="${doneHref}">I’ve signed in to Slack — Embed</a></p>
         <p class="muted">Closing this green strip cancels.</p>`
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  html, body { margin: 0; height: 100%; font-family: "Figtree", system-ui, sans-serif;
    background: #0f1410; color: #e8eaed; border: 1px solid #3d9a5f; box-sizing: border-box; }
  main { padding: 14px 18px; line-height: 1.4; }
  h1 { font-size: 1.05rem; margin: 0 0 8px; font-weight: 650; color: #7ddea3; }
  p { font-size: 0.88rem; color: #c4c7ce; margin: 0 0 10px; }
  .muted { color: #8b909a; font-size: 0.8rem; margin: 8px 0 0; }
  strong { color: #fff; }
  .btn { display: inline-block; padding: 10px 14px; border-radius: 8px;
    background: #3d9a5f; color: #fff !important; text-decoration: none; font-weight: 650; font-size: 0.9rem; }
</style></head>
<body><main>${body}</main></body></html>`
}

async function runChromeAuthWithStrip(options: {
  profileId: string
  kind: 'google' | 'slack'
  startUrl: string
  partition: string
  phase: FirstLoginPhase
  ui: ChromeAuthUiOptions
}): Promise<FirstLoginResult> {
  const parent =
    options.ui.parentWindow && !options.ui.parentWindow.isDestroyed()
      ? options.ui.parentWindow
      : undefined
  const hasChrome = Boolean(resolveChromeExecutable())
  const parentBounds = parent && !parent.isDestroyed() ? parent.getBounds() : undefined

  const loopback = hasChrome
    ? await startLoopbackAuthServer(options.kind === 'google' ? '/google-done' : '/slack-done')
    : null

  const startUrl = options.startUrl

  const stripW = 500
  const stripH = hasChrome ? 188 : 140
  const stripX = parentBounds
    ? Math.round(parentBounds.x + (parentBounds.width - stripW) / 2)
    : undefined
  const stripY = parentBounds
    ? Math.round(parentBounds.y + parentBounds.height - stripH - 16)
    : undefined

  const waitWindow = new BrowserWindow({
    width: stripW,
    height: stripH,
    x: stripX,
    y: stripY,
    show: false,
    parent,
    modal: false,
    center: !parentBounds,
    title: options.kind === 'google' ? 'Google sign-in' : 'Slack sign-in',
    autoHideMenuBar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  waitWindow.once('ready-to-show', () => bringToFront(waitWindow))
  void waitWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(
      waitingHtml(options.kind, hasChrome, loopback?.successUrl)
    )}`
  )

  const bumpStrip = setInterval(() => {
    if (waitWindow.isDestroyed()) {
      clearInterval(bumpStrip)
      return
    }
    bringToFront(waitWindow)
  }, 2000)

  if (!hasChrome) {
    clearInterval(bumpStrip)
    await new Promise<void>((resolve) => {
      waitWindow.on('closed', () => resolve())
    })
    return 'cancelled'
  }

  let cancelResolve: ((value: 'cancelled') => void) | null = null
  const abortPromise = new Promise<'cancelled'>((resolve) => {
    cancelResolve = resolve
  })
  let doneResolve: ((value: 'done') => void) | null = null
  const donePromise = new Promise<'done'>((resolve) => {
    doneResolve = resolve
  })

  const onClosed = (): void => {
    cancelResolve?.('cancelled')
  }
  const onNavigate = (event: Electron.Event, url: string): void => {
    if (url.startsWith(DONE_URL) || (loopback && url.startsWith(loopback.successUrl))) {
      event.preventDefault()
      doneResolve?.('done')
    }
  }

  waitWindow.on('closed', onClosed)
  waitWindow.webContents.on('will-navigate', onNavigate)

  try {
    const result = await runChromeSystemLogin({
      partition: options.partition,
      chromeProfileKey: options.profileId,
      startUrl,
      loginHint: options.ui.loginHint,
      abortPromise,
      donePromise,
      loopbackDonePromise: loopback?.done,
      anchorBounds: parentBounds,
      phase: options.phase,
      onPhaseChange: async (phase) => {
        await options.ui.onPhaseChange?.(phase)
      }
    })
    return result === 'signed-in' ? 'signed-in' : 'cancelled'
  } finally {
    loopback?.close()
    clearInterval(bumpStrip)
    if (!waitWindow.isDestroyed()) {
      waitWindow.webContents.removeListener('will-navigate', onNavigate)
      waitWindow.removeListener('closed', onClosed)
      waitWindow.close()
    }
  }
}

function mapEmbedded(result: EmbeddedAuthResult): FirstLoginResult | 'blocked' {
  if (result === 'signed-in') return 'signed-in'
  if (result === 'blocked') return 'blocked'
  return 'cancelled'
}

/**
 * Google auth: try isolated in-app BrowserWindow first (no system Chrome).
 * If Google shows “browser may not be secure”, fall back to system Chrome.
 */
export async function runGoogleAuthInChrome(
  profileId: string,
  options: ChromeAuthUiOptions = {}
): Promise<FirstLoginResult> {
  const partition = partitionForProfile(profileId, 'slack')

  const embedded = mapEmbedded(
    await runGoogleAuthEmbedded(profileId, {
      parentWindow: options.parentWindow,
      loginHint: options.loginHint,
      onPhaseChange: options.onPhaseChange
    })
  )

  if (embedded === 'signed-in' || embedded === 'cancelled') {
    log.info('Google auth finished (embedded)', { profileId, outcome: embedded })
    return embedded
  }

  log.info('Google blocked embedded window — falling back to system Chrome', { profileId })
  const outcome = await runChromeAuthWithStrip({
    profileId,
    kind: 'google',
    startUrl: buildGoogleSignInUrl(options.loginHint),
    partition,
    phase: 'signing-in-google',
    ui: options
  })
  log.info('Google auth finished (Chrome fallback)', { profileId, outcome })
  return outcome
}

/**
 * Slack auth: same-partition embedded BrowserWindow (reuses Google cookies),
 * then Chrome fallback if Google SSO is blocked inside Electron.
 */
export async function runSlackAuthInChrome(
  profileId: string,
  options: ChromeAuthUiOptions = {}
): Promise<FirstLoginResult> {
  const partition = partitionForProfile(profileId, 'slack')

  const embedded = mapEmbedded(
    await runSlackAuthEmbedded(profileId, {
      parentWindow: options.parentWindow,
      loginHint: options.loginHint,
      onPhaseChange: options.onPhaseChange
    })
  )

  if (embedded === 'signed-in' || embedded === 'cancelled') {
    log.info('Slack auth finished (embedded)', { profileId, outcome: embedded })
    return embedded
  }

  log.info('Slack/Google blocked embedded window — falling back to system Chrome', { profileId })
  const outcome = await runChromeAuthWithStrip({
    profileId,
    kind: 'slack',
    startUrl: SLACK_GOOGLE_SIGNIN_ENTRY_URL,
    partition,
    phase: 'signing-in-slack',
    ui: options
  })
  log.info('Slack Chrome auth finished (fallback)', { profileId, outcome })
  return outcome
}

/** @deprecated */
export async function runFirstLoginForProfile(
  profileId: string,
  options: ChromeAuthUiOptions = {}
): Promise<FirstLoginResult> {
  return runGoogleAuthInChrome(profileId, options)
}

export const __test__ = {
  isGoogleSignedInUrl,
  isGoogleOauthPageUrl,
  isSlackClientLoggedInUrl,
  isSlackSignInEntryUrl,
  GOOGLE_SIGN_IN_URL,
  buildGoogleSignInUrl,
  SLACK_GOOGLE_SIGNIN_ENTRY_URL,
  SLACK_CLIENT_URL,
  partitionForProfile,
  profileSessionWebPreferences
}
