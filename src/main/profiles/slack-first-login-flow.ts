/**
 * Two-step first-login in ONE BrowserWindow (same partition as Slack embed):
 * 1) Google account (password + 2SV)
 * 2) Slack via Sign in with Google on that same session
 * Then embed app.slack.com with those cookies.
 */
import { BrowserWindow, type WebContents } from 'electron'
import { log } from '../logging'
import {
  buildGoogleSignInUrl,
  isGoogleOauthPageUrl,
  isGoogleSignedInUrl,
  isSlackClientLoggedInUrl,
  SLACK_GOOGLE_SIGNIN_ENTRY_URL,
  VERIFY_SLACK_SESSION_SCRIPT
} from './login-helpers'
import {
  applySlackWebContentsTweaks,
  partitionForProfile,
  profileSessionWebPreferences
} from './session-partition'

export type SlackFirstLoginResult = 'signed-in' | 'cancelled'

export type SlackFirstLoginPhase = 'signing-in-google' | 'signing-in-slack'

export interface SlackFirstLoginOptions {
  parentWindow?: BrowserWindow | null
  loginHint?: string
  /** Skip Electron Google — cookies already imported from docked Chrome. */
  googleAlreadySignedIn?: boolean
  onPhaseChange?: (phase: SlackFirstLoginPhase) => void | Promise<void>
}

function safeHostname(urlString: string): string {
  try {
    return new URL(urlString).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function isAuthRelatedUrl(urlString: string): boolean {
  const host = safeHostname(urlString)
  if (!host) return false
  if (host === 'accounts.google.com' || host.endsWith('.google.com')) return true
  if (host === 'slack.com' || host.endsWith('.slack.com')) return true
  return isGoogleOauthPageUrl(urlString)
}

async function clickSlackContinueWithGoogle(contents: WebContents): Promise<boolean> {
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

/**
 * Google → Slack in one popup on persist:profile-<id>-slack.
 */
export async function runSlackFirstLoginForProfile(
  profileId: string,
  options: SlackFirstLoginOptions = {}
): Promise<SlackFirstLoginResult> {
  const partition = partitionForProfile(profileId, 'slack')
  const parent =
    options.parentWindow && !options.parentWindow.isDestroyed() ? options.parentWindow : undefined
  const skipGoogle = Boolean(options.googleAlreadySignedIn)

  let phase: SlackFirstLoginPhase = skipGoogle ? 'signing-in-slack' : 'signing-in-google'
  void Promise.resolve(options.onPhaseChange?.(phase))

  const loginWindow = new BrowserWindow({
    width: 520,
    height: 780,
    show: false,
    parent,
    modal: Boolean(parent),
    center: true,
    title: skipGoogle ? 'Sign in to Slack' : 'Step 1 — Sign in with Google',
    autoHideMenuBar: true,
    webPreferences: profileSessionWebPreferences(profileId, 'slack')
  })

  applySlackWebContentsTweaks(loginWindow.webContents)

  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAuthRelatedUrl(url) && !loginWindow.isDestroyed()) {
      void loginWindow.loadURL(url)
    } else {
      log.info('first-login blocked popup', { profileId, url: url.slice(0, 120) })
    }
    return { action: 'deny' }
  })

  let settled = false
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let successTimer: ReturnType<typeof setTimeout> | null = null
  let advancedToSlack = false
  let lastGoogleClickAt = 0

  const setPhase = (next: SlackFirstLoginPhase): void => {
    if (phase === next) return
    phase = next
    if (!loginWindow.isDestroyed()) {
      loginWindow.setTitle(
        next === 'signing-in-google' ? 'Step 1 — Sign in with Google' : 'Step 2 — Sign in to Slack'
      )
    }
    void Promise.resolve(options.onPhaseChange?.(next))
  }

  try {
    const result = await new Promise<SlackFirstLoginResult>((resolve) => {
      const finish = (outcome: SlackFirstLoginResult): void => {
        if (settled) return
        settled = true
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
        if (successTimer) {
          clearTimeout(successTimer)
          successTimer = null
        }
        cleanup()
        resolve(outcome)
      }

      const goToSlack = (): void => {
        if (advancedToSlack || loginWindow.isDestroyed() || settled) return
        advancedToSlack = true
        setPhase('signing-in-slack')
        log.info('Google done — loading Slack in same window', { profileId })
        void loginWindow.loadURL(SLACK_GOOGLE_SIGNIN_ENTRY_URL).catch((err) => {
          log.warn('slack entry load failed', { profileId, err: String(err) })
          finish('cancelled')
        })
      }

      const verifySlackAndMaybeSucceed = (): void => {
        if (loginWindow.isDestroyed() || phase !== 'signing-in-slack') return
        const current = loginWindow.webContents.getURL()
        if (!isSlackClientLoggedInUrl(current)) return
        void loginWindow.webContents
          .executeJavaScript(VERIFY_SLACK_SESSION_SCRIPT, true)
          .then((ok) => {
            if (settled || loginWindow.isDestroyed()) return
            if (ok === true) {
              log.info('Google+Slack first-login verified', {
                profileId,
                partition,
                url: current.slice(0, 120)
              })
              finish('signed-in')
            }
          })
          .catch(() => {
            /* ignore */
          })
      }

      const maybeClickGoogleOnSlack = (): void => {
        if (phase !== 'signing-in-slack' || loginWindow.isDestroyed()) return
        const now = Date.now()
        if (now - lastGoogleClickAt < 2500) return
        lastGoogleClickAt = now
        void clickSlackContinueWithGoogle(loginWindow.webContents)
      }

      const handleUrl = (url: string): void => {
        if (phase === 'signing-in-google') {
          if (isGoogleSignedInUrl(url)) {
            goToSlack()
          }
          return
        }
        // Slack phase: Google OAuth for Slack may briefly hit accounts.google.com again — stay here.
        if (isSlackClientLoggedInUrl(url)) {
          if (successTimer) clearTimeout(successTimer)
          successTimer = setTimeout(() => verifySlackAndMaybeSucceed(), 350)
        } else {
          maybeClickGoogleOnSlack()
        }
      }

      const onNavigate = (_e: Electron.Event, url: string): void => {
        log.info('first-login navigate', { profileId, phase, url: url.slice(0, 140) })
        handleUrl(url)
      }
      const onRedirect = (_e: Electron.Event, url: string): void => {
        handleUrl(url)
      }
      const onFinishLoad = (): void => {
        if (loginWindow.isDestroyed()) return
        const url = loginWindow.webContents.getURL()
        handleUrl(url)
        if (phase === 'signing-in-slack') {
          maybeClickGoogleOnSlack()
        }
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

      loginWindow.once('ready-to-show', () => {
        if (!loginWindow.isDestroyed()) {
          loginWindow.show()
          loginWindow.focus()
        }
      })

      pollTimer = setInterval(() => {
        if (settled || loginWindow.isDestroyed()) return
        if (phase === 'signing-in-google') {
          const url = loginWindow.webContents.getURL()
          if (isGoogleSignedInUrl(url)) {
            goToSlack()
          }
        } else {
          maybeClickGoogleOnSlack()
          verifySlackAndMaybeSucceed()
        }
      }, 700)

      const startUrl = skipGoogle
        ? SLACK_GOOGLE_SIGNIN_ENTRY_URL
        : buildGoogleSignInUrl(options.loginHint)
      advancedToSlack = skipGoogle
      void loginWindow.loadURL(startUrl).catch((err) => {
        log.warn('first-login load failed', { profileId, skipGoogle, err: String(err) })
        finish('cancelled')
      })
    })

    return result
  } finally {
    if (pollTimer) clearInterval(pollTimer)
    if (successTimer) clearTimeout(successTimer)
    if (!loginWindow.isDestroyed()) {
      loginWindow.destroy()
    }
  }
}
