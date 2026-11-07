/**
 * Drive Google / Slack auth inside the main-window WebContentsView (right pane).
 * Same partition as the Slack embed so cookies carry into the workspace.
 */
import type { WebContents } from 'electron'
import { log } from '../logging'
import {
  buildGoogleSignInUrl,
  isGoogleSignedInUrl,
  isSlackClientLoggedInUrl,
  SLACK_GOOGLE_SIGNIN_ENTRY_URL,
  VERIFY_SLACK_SESSION_SCRIPT
} from './login-helpers'

export type PaneAuthResult = 'signed-in' | 'cancelled' | 'blocked'

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

const HIDE_WEBDRIVER_SCRIPT = `(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
  } catch (_) {}
})()`

async function pageLooksBlocked(contents: WebContents): Promise<boolean> {
  try {
    return (await contents.executeJavaScript(DETECT_GOOGLE_BLOCK_SCRIPT, true)) === true
  } catch {
    return false
  }
}

function injectHideWebdriver(contents: WebContents): void {
  void contents.executeJavaScript(HIDE_WEBDRIVER_SCRIPT, true).catch(() => {
    /* ignore */
  })
}

/**
 * Load Google Account sign-in in the right-pane WebContents and wait until signed in.
 */
export async function waitForGoogleSignedInInPane(
  contents: WebContents,
  options: { profileId: string; loginHint?: string; timeoutMs?: number }
): Promise<PaneAuthResult> {
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000
  const startUrl = buildGoogleSignInUrl(options.loginHint)

  try {
    await contents.loadURL(startUrl)
  } catch (err) {
    log.warn('pane google load failed', { profileId: options.profileId, err: String(err) })
    return 'cancelled'
  }

  injectHideWebdriver(contents)

  return await new Promise<PaneAuthResult>((resolve) => {
    let settled = false
    const started = Date.now()

    const finish = (outcome: PaneAuthResult): void => {
      if (settled || contents.isDestroyed()) return
      settled = true
      clearInterval(poll)
      contents.removeListener('did-navigate', onNav)
      contents.removeListener('did-navigate-in-page', onNav)
      contents.removeListener('did-finish-load', onNav)
      contents.removeListener('destroyed', onDestroyed)
      log.info('pane google auth finished', { profileId: options.profileId, outcome })
      resolve(outcome)
    }

    const check = async (): Promise<void> => {
      if (settled || contents.isDestroyed()) return
      if (Date.now() - started > timeoutMs) {
        finish('cancelled')
        return
      }
      injectHideWebdriver(contents)
      if (await pageLooksBlocked(contents)) {
        finish('blocked')
        return
      }
      const url = contents.getURL()
      if (isGoogleSignedInUrl(url)) {
        finish('signed-in')
      }
    }

    const onNav = (): void => {
      void check()
    }
    const onDestroyed = (): void => {
      finish('cancelled')
    }

    contents.on('did-navigate', onNav)
    contents.on('did-navigate-in-page', onNav)
    contents.on('did-finish-load', onNav)
    contents.on('destroyed', onDestroyed)

    const poll = setInterval(() => {
      void check()
    }, 700)

    void check()
  })
}

/**
 * Load Slack get-started / Google SSO in the same pane and wait for workspace client.
 */
export async function waitForSlackSignedInInPane(
  contents: WebContents,
  options: { profileId: string; timeoutMs?: number }
): Promise<PaneAuthResult> {
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000
  let lastGoogleClickAt = 0

  const clickContinueWithGoogle = async (): Promise<void> => {
    const now = Date.now()
    if (now - lastGoogleClickAt < 2500) return
    lastGoogleClickAt = now
    try {
      await contents.executeJavaScript(
        `(() => {
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
        })()`,
        true
      )
    } catch {
      /* ignore */
    }
  }

  try {
    const url = contents.getURL()
    if (!isSlackClientLoggedInUrl(url)) {
      await contents.loadURL(SLACK_GOOGLE_SIGNIN_ENTRY_URL)
    }
  } catch (err) {
    log.warn('pane slack load failed', { profileId: options.profileId, err: String(err) })
    return 'cancelled'
  }

  injectHideWebdriver(contents)

  return await new Promise<PaneAuthResult>((resolve) => {
    let settled = false
    const started = Date.now()

    const finish = (outcome: PaneAuthResult): void => {
      if (settled) return
      settled = true
      clearInterval(poll)
      if (!contents.isDestroyed()) {
        contents.removeListener('did-navigate', onNav)
        contents.removeListener('did-navigate-in-page', onNav)
        contents.removeListener('did-finish-load', onNav)
        contents.removeListener('destroyed', onDestroyed)
      }
      log.info('pane slack auth finished', { profileId: options.profileId, outcome })
      resolve(outcome)
    }

    const check = async (): Promise<void> => {
      if (settled || contents.isDestroyed()) return
      if (Date.now() - started > timeoutMs) {
        finish('cancelled')
        return
      }
      injectHideWebdriver(contents)
      if (await pageLooksBlocked(contents)) {
        finish('blocked')
        return
      }
      const url = contents.getURL()
      if (isSlackClientLoggedInUrl(url)) {
        try {
          const ok = await contents.executeJavaScript(VERIFY_SLACK_SESSION_SCRIPT, true)
          if (ok === true) {
            finish('signed-in')
            return
          }
        } catch {
          /* ignore */
        }
      } else {
        await clickContinueWithGoogle()
      }
    }

    const onNav = (): void => {
      void check()
    }
    const onDestroyed = (): void => {
      finish('cancelled')
    }

    contents.on('did-navigate', onNav)
    contents.on('did-navigate-in-page', onNav)
    contents.on('did-finish-load', onNav)
    contents.on('destroyed', onDestroyed)

    const poll = setInterval(() => {
      void check()
    }, 700)

    void check()
  })
}
