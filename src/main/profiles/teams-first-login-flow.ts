import { type WebContents } from 'electron'
import { log } from '../logging'
import {
  applyTeamsWebContentsTweaks,
  isMicrosoftIdentityHost,
  isMicrosoftSignedOutUrl,
  isTeamsSignedInUrl,
  partitionForProfile,
  TEAMS_HOME_URL
} from './session-partition'

export type TeamsLoginResult = 'signed-in' | 'cancelled'

export interface TeamsLoginOptions {
  parentWindow?: Electron.BrowserWindow | null
  contents: WebContents
  onPhaseChange?: (phase: 'signing-in') => void | Promise<void>
}

/**
 * Confirms Teams UI is authenticated.
 * Strict on purpose — weak `#app` / main-role matches fire on loading shells and caused early ✓.
 */
export const VERIFY_TEAMS_SESSION_SCRIPT = `(() => {
  try {
    const href = location.href || '';
    if (/login\\.microsoftonline\\.com|login\\.live\\.com|login\\.microsoft\\.com|account\\.live\\.com/i.test(href)) {
      return false;
    }
    if (/\\/authv2\\b/i.test(href)) return false;
    if (!/teams\\.(microsoft|live)\\.com/i.test(href)) return false;

    const text = (document.body && document.body.innerText) || '';
    if (/Classic Teams is no longer available/i.test(text)) return false;
    if (/You signed out of your account/i.test(text)) return false;
    if (/Sign in to (your account|Microsoft|Teams)/i.test(text) && /password|email|phone/i.test(text)) {
      return false;
    }
    if (/Pick an account|Choose an account|Stay signed in/i.test(text.slice(0, 900))) {
      return false;
    }

    const strongWork =
      document.querySelector('[data-tid="app-layout-area"], [data-tid="app-layout-root"], #app-bar-main') &&
      document.querySelector(
        '[data-tid="left-rail"], [aria-label="App bar"], [data-tid="app-bar-rail"], [data-tid="chat-list"], [data-tid="channel-list"]'
      );
    if (strongWork) return true;

    const personalChat =
      document.querySelector('[data-tid="chat-list"], [data-tid="chat-list-item"], [data-tid="simple-collab-rail"]') &&
      (/favorites|meeting chats|unmuted|unread|chat/i.test(text.slice(0, 1200)) ||
        Boolean(document.querySelector('[data-tid="me-control-avatar-trigger"]')));
    if (personalChat) return true;

    if (
      document.querySelector('[data-tid="me-control-avatar-trigger"]') &&
      /favorites/i.test(text) &&
      /(meeting chats|unmuted|unread|chat list)/i.test(text)
    ) {
      return true;
    }

    return false;
  } catch (_) {
    return false;
  }
})()`

function isMicrosoftLoginUrl(urlString: string): boolean {
  const host = (() => {
    try {
      return new URL(urlString).hostname.toLowerCase()
    } catch {
      return ''
    }
  })()
  return (
    host.includes('login.microsoftonline.com') ||
    host.includes('login.live.com') ||
    host.includes('login.microsoft.com') ||
    host.includes('account.live.com')
  )
}

function safeHostname(urlString: string): string {
  try {
    return new URL(urlString).hostname
  } catch {
    return ''
  }
}

/**
 * Teams sign-in via Microsoft identity (Azure AD / MSA) inside the Orbit embed.
 * The right pane loads teams.microsoft.com (redirects to login.microsoftonline.com).
 */
export async function runTeamsLoginForProfile(
  profileId: string,
  options: TeamsLoginOptions
): Promise<TeamsLoginResult> {
  const partition = partitionForProfile(profileId, 'teams')
  const contents = options.contents
  if (contents.isDestroyed()) {
    return 'cancelled'
  }

  applyTeamsWebContentsTweaks(contents)

  let settled = false
  let successTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let sawMicrosoftLogin = false
  let consecutiveOk = 0

  try {
    void Promise.resolve(options.onPhaseChange?.('signing-in'))

    const result = await new Promise<TeamsLoginResult>((resolve) => {
      const finish = (outcome: TeamsLoginResult): void => {
        if (settled) {
          return
        }
        settled = true
        if (successTimer) {
          clearTimeout(successTimer)
          successTimer = null
        }
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
        cleanup()
        resolve(outcome)
      }

      const verifyAndMaybeSucceed = (): void => {
        if (contents.isDestroyed()) {
          return
        }
        const current = contents.getURL()
        if (!isTeamsSignedInUrl(current) || isMicrosoftSignedOutUrl(current)) {
          consecutiveOk = 0
          return
        }
        void contents
          .executeJavaScript(VERIFY_TEAMS_SESSION_SCRIPT, true)
          .then((ok) => {
            if (settled || contents.isDestroyed()) {
              return
            }
            if (ok !== true) {
              consecutiveOk = 0
              return
            }
            consecutiveOk += 1
            const need = sawMicrosoftLogin ? 2 : 3
            if (consecutiveOk < need) {
              return
            }
            log.info('teams microsoft sign-in verified', {
              profileId,
              partition,
              sawMicrosoftLogin,
              consecutiveOk,
              url: current.slice(0, 120)
            })
            finish('signed-in')
          })
          .catch(() => {
            consecutiveOk = 0
          })
      }

      const scheduleSuccessCheck = (url: string): void => {
        if (!isTeamsSignedInUrl(url) || isMicrosoftSignedOutUrl(url)) {
          consecutiveOk = 0
          return
        }
        if (successTimer) {
          clearTimeout(successTimer)
        }
        const delay = sawMicrosoftLogin ? 500 : 1200
        successTimer = setTimeout(() => {
          verifyAndMaybeSucceed()
        }, delay)
      }

      const handleUrl = (url: string): void => {
        if (isMicrosoftLoginUrl(url)) {
          sawMicrosoftLogin = true
          log.info('on microsoft identity page', { profileId, url: url.slice(0, 120) })
        }
        if (isMicrosoftSignedOutUrl(url)) {
          log.warn('teams login hit microsoft signed-out page', {
            profileId,
            url: url.slice(0, 120)
          })
          if (successTimer) {
            clearTimeout(successTimer)
            successTimer = null
          }
          return
        }
        scheduleSuccessCheck(url)
      }

      const onNavigate = (_event: Electron.Event, url: string): void => {
        handleUrl(url)
      }
      const onRedirect = (_event: Electron.Event, url: string): void => {
        handleUrl(url)
      }
      const onFinishLoad = (): void => {
        if (!contents.isDestroyed()) {
          handleUrl(contents.getURL())
        }
      }
      const onDestroyed = (): void => {
        log.info('teams microsoft login embed destroyed', {
          profileId,
          partition,
          outcome: settled ? 'already-finished' : 'cancelled',
          sawMicrosoftLogin
        })
        finish('cancelled')
      }

      const cleanup = (): void => {
        contents.removeListener('did-navigate', onNavigate)
        contents.removeListener('will-redirect', onRedirect)
        contents.removeListener('did-finish-load', onFinishLoad)
        contents.removeListener('destroyed', onDestroyed)
      }

      contents.on('did-navigate', onNavigate)
      contents.on('will-redirect', onRedirect)
      contents.on('did-finish-load', onFinishLoad)
      contents.on('destroyed', onDestroyed)

      pollTimer = setInterval(() => {
        if (settled || contents.isDestroyed()) {
          return
        }
        const url = contents.getURL()
        if (isMicrosoftLoginUrl(url)) {
          sawMicrosoftLogin = true
        }
        if (isTeamsSignedInUrl(url)) {
          verifyAndMaybeSucceed()
        }
      }, 600)

      const current = contents.getURL()
      const alreadyOnFlow =
        Boolean(current) &&
        current !== 'about:blank' &&
        (isTeamsSignedInUrl(current) ||
          isMicrosoftLoginUrl(current) ||
          isMicrosoftIdentityHost(safeHostname(current)))

      if (alreadyOnFlow) {
        handleUrl(current)
      } else {
        void contents.loadURL(TEAMS_HOME_URL).catch((err) => {
          log.warn('teams home login entry failed', { profileId, err: String(err) })
          finish('cancelled')
        })
      }
    })

    return result
  } finally {
    if (successTimer) {
      clearTimeout(successTimer)
    }
    if (pollTimer) {
      clearInterval(pollTimer)
    }
  }
}

export const __test__ = {
  isTeamsSignedInUrl,
  isMicrosoftSignedOutUrl,
  isMicrosoftIdentityHost,
  TEAMS_HOME_URL,
  VERIFY_TEAMS_SESSION_SCRIPT,
  partitionForProfile
}
