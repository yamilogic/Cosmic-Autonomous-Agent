/**
 * In-app Google / Slack auth via an isolated BrowserWindow (not <webview>).
 * Strips Node integration, spoofs Chrome UA, hides webdriver — Google may still
 * block some accounts; callers can fall back to system Chrome.
 */
import { join } from 'node:path'
import { BrowserWindow, type WebContents } from 'electron'
import { log } from '../logging'
import {
  buildGoogleSignInUrl,
  isGoogleSignedInUrl,
  isSlackClientLoggedInUrl,
  SLACK_GOOGLE_SIGNIN_ENTRY_URL,
  VERIFY_SLACK_SESSION_SCRIPT
} from './login-helpers'
import {
  applyChromeSessionTweaks,
  CHROME_USER_AGENT,
  partitionForProfile
} from './session-partition'

export type EmbeddedAuthResult = 'signed-in' | 'cancelled' | 'blocked'

export interface EmbeddedAuthUiOptions {
  parentWindow?: BrowserWindow | null
  loginHint?: string
  onPhaseChange?: (phase: 'signing-in-google' | 'signing-in-slack') => void | Promise<void>
}

const DETECT_GOOGLE_BLOCK_SCRIPT = `(() => {
  try {
    const text = (document.body && document.body.innerText) || '';
    return /This browser or app may not be secure|browser.*(not|isn't) secure|couldn't sign you in/i.test(
      text.slice(0, 2500)
    );
  } catch (_) {
    return false;
  }
})()`

function authHidePreloadPath(): string {
  return join(__dirname, '../preload/auth-hide.js')
}

function bringToFront(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function applyAuthWindowTweaks(contents: WebContents): void {
  contents.setUserAgent(CHROME_USER_AGENT)
  // Deny DevTools so Google cannot see open inspector hooks as easily.
  contents.on('devtools-opened', () => {
    contents.closeDevTools()
  })
}

async function pageLooksBlocked(contents: WebContents): Promise<boolean> {
  try {
    return (await contents.executeJavaScript(DETECT_GOOGLE_BLOCK_SCRIPT, true)) === true
  } catch {
    return false
  }
}

function createAuthWindow(options: {
  title: string
  partition: string
  parent?: BrowserWindow
  width?: number
  height?: number
}): BrowserWindow {
  applyChromeSessionTweaks(options.partition)

  const win = new BrowserWindow({
    width: options.width ?? 500,
    height: options.height ?? 680,
    show: false,
    parent: options.parent,
    modal: Boolean(options.parent),
    center: true,
    title: options.title,
    autoHideMenuBar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      partition: options.partition,
      preload: authHidePreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: false
    }
  })

  applyAuthWindowTweaks(win.webContents)
  return win
}

/**
 * Step 1: Google password + 2SV in an isolated BrowserWindow on the profile Slack partition.
 */
export async function runGoogleAuthEmbedded(
  profileId: string,
  options: EmbeddedAuthUiOptions = {}
): Promise<EmbeddedAuthResult> {
  const partition = partitionForProfile(profileId, 'slack')
  const parent =
    options.parentWindow && !options.parentWindow.isDestroyed() ? options.parentWindow : undefined

  void Promise.resolve(options.onPhaseChange?.('signing-in-google'))

  const loginWindow = createAuthWindow({
    title: 'Sign in with Google',
    partition,
    parent
  })

  let settled = false
  let pollTimer: ReturnType<typeof setInterval> | null = null

  try {
    const result = await new Promise<EmbeddedAuthResult>((resolve) => {
      const finish = (outcome: EmbeddedAuthResult): void => {
        if (settled) return
        settled = true
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
        cleanup()
        resolve(outcome)
      }

      const check = async (): Promise<void> => {
        if (settled || loginWindow.isDestroyed()) return
        const url = loginWindow.webContents.getURL()
        if (await pageLooksBlocked(loginWindow.webContents)) {
          log.warn('Google blocked embedded BrowserWindow', { profileId, url: url.slice(0, 120) })
          finish('blocked')
          return
        }
        if (isGoogleSignedInUrl(url)) {
          log.info('Google embedded sign-in verified', { profileId, url: url.slice(0, 120) })
          finish('signed-in')
        }
      }

      const onNavigate = (_e: Electron.Event, url: string): void => {
        log.info('google auth navigate', { profileId, url: url.slice(0, 140) })
        void check()
      }
      const onRedirect = (_e: Electron.Event, url: string): void => {
        void check()
        if (isGoogleSignedInUrl(url)) {
          // Redirect target is enough
        }
      }
      const onFinishLoad = (): void => {
        void check()
      }
      const onClosed = (): void => {
        finish('cancelled')
      }

      const cleanup = (): void => {
        loginWindow.webContents.removeListener('did-navigate', onNavigate)
        loginWindow.webContents.removeListener('did-navigate-in-page', onNavigate)
        loginWindow.webContents.removeListener('will-redirect', onRedirect)
        loginWindow.webContents.removeListener('did-finish-load', onFinishLoad)
        loginWindow.removeListener('closed', onClosed)
      }

      loginWindow.webContents.on('did-navigate', onNavigate)
      loginWindow.webContents.on('did-navigate-in-page', onNavigate)
      loginWindow.webContents.on('will-redirect', onRedirect)
      loginWindow.webContents.on('did-finish-load', onFinishLoad)
      loginWindow.on('closed', onClosed)

      loginWindow.once('ready-to-show', () => bringToFront(loginWindow))

      pollTimer = setInterval(() => {
        void check()
      }, 800)

      const startUrl = buildGoogleSignInUrl(options.loginHint)
      void loginWindow.loadURL(startUrl).catch((err) => {
        log.warn('google embedded load failed', { profileId, err: String(err) })
        finish('cancelled')
      })
    })

    return result
  } finally {
    if (pollTimer) clearInterval(pollTimer)
    if (!loginWindow.isDestroyed()) {
      loginWindow.destroy()
    }
  }
}

/**
 * Step 2: Slack Google SSO in the same isolated partition (reuses Google cookies).
 */
export async function runSlackAuthEmbedded(
  profileId: string,
  options: EmbeddedAuthUiOptions = {}
): Promise<EmbeddedAuthResult> {
  const partition = partitionForProfile(profileId, 'slack')
  const parent =
    options.parentWindow && !options.parentWindow.isDestroyed() ? options.parentWindow : undefined

  void Promise.resolve(options.onPhaseChange?.('signing-in-slack'))

  const loginWindow = createAuthWindow({
    title: 'Sign in to Slack',
    partition,
    parent,
    width: 560,
    height: 720
  })

  let settled = false
  let pollTimer: ReturnType<typeof setInterval> | null = null

  try {
    const result = await new Promise<EmbeddedAuthResult>((resolve) => {
      const finish = (outcome: EmbeddedAuthResult): void => {
        if (settled) return
        settled = true
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
        cleanup()
        resolve(outcome)
      }

      const verifySlack = async (): Promise<void> => {
        if (settled || loginWindow.isDestroyed()) return
        const url = loginWindow.webContents.getURL()
        if (await pageLooksBlocked(loginWindow.webContents)) {
          log.warn('Google/Slack blocked embedded auth window', {
            profileId,
            url: url.slice(0, 120)
          })
          finish('blocked')
          return
        }
        if (!isSlackClientLoggedInUrl(url)) return
        try {
          const ok = await loginWindow.webContents.executeJavaScript(
            VERIFY_SLACK_SESSION_SCRIPT,
            true
          )
          if (ok === true) {
            log.info('Slack embedded sign-in verified', { profileId, url: url.slice(0, 120) })
            finish('signed-in')
          }
        } catch {
          /* ignore */
        }
      }

      const onNavigate = (_e: Electron.Event, url: string): void => {
        log.info('slack auth navigate', { profileId, url: url.slice(0, 140) })
        void verifySlack()
      }
      const onRedirect = (): void => {
        void verifySlack()
      }
      const onFinishLoad = (): void => {
        void verifySlack()
      }
      const onClosed = (): void => {
        finish('cancelled')
      }

      const cleanup = (): void => {
        loginWindow.webContents.removeListener('did-navigate', onNavigate)
        loginWindow.webContents.removeListener('did-navigate-in-page', onNavigate)
        loginWindow.webContents.removeListener('will-redirect', onRedirect)
        loginWindow.webContents.removeListener('did-finish-load', onFinishLoad)
        loginWindow.removeListener('closed', onClosed)
      }

      loginWindow.webContents.on('did-navigate', onNavigate)
      loginWindow.webContents.on('did-navigate-in-page', onNavigate)
      loginWindow.webContents.on('will-redirect', onRedirect)
      loginWindow.webContents.on('did-finish-load', onFinishLoad)
      loginWindow.on('closed', onClosed)

      loginWindow.once('ready-to-show', () => bringToFront(loginWindow))

      pollTimer = setInterval(() => {
        void verifySlack()
      }, 700)

      void loginWindow.loadURL(SLACK_GOOGLE_SIGNIN_ENTRY_URL).catch((err) => {
        log.warn('slack embedded load failed', { profileId, err: String(err) })
        finish('cancelled')
      })
    })

    return result
  } finally {
    if (pollTimer) clearInterval(pollTimer)
    if (!loginWindow.isDestroyed()) {
      loginWindow.destroy()
    }
  }
}

export const __test__ = {
  DETECT_GOOGLE_BLOCK_SCRIPT
}
