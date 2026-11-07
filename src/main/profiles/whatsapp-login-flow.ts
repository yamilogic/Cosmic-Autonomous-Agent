import type { WebContents } from 'electron'
import { log } from '../logging'
import { WHATSAPP_WEB_URL } from './session-partition'

export type WhatsAppLoginResult = 'signed-in' | 'cancelled'

/**
 * True when WhatsApp Web chat shell is loaded (QR already scanned / session restored).
 */
export const VERIFY_WHATSAPP_SESSION_SCRIPT = `(() => {
  try {
    const href = location.href || '';
    if (!/web\\.whatsapp\\.com/i.test(href)) return false;

    // Still on QR / intro landing
    if (document.querySelector('canvas[aria-label*="Scan"], div[data-ref] canvas, [data-testid="qrcode"]')) {
      const pane = document.querySelector('#app, .landing-wrapper, [data-testid="intro-md-beta-logo-dark"], [data-testid="intro-md-beta-logo-light"]');
      // QR visible → not signed in yet
      if (document.querySelector('[data-testid="qrcode"], canvas')) {
        const chat = document.querySelector('#pane-side, [data-testid="chat-list"], [aria-label="Chat list"]');
        if (!chat) return false;
      }
    }

    if (document.querySelector('#pane-side, [data-testid="chat-list"], [aria-label="Chat list"]')) {
      return true;
    }
    if (document.querySelector('[data-testid="default-user-drawer"], [data-testid="menu-bar-menu"]')) {
      return true;
    }
    // Side panel with conversations
    if (document.querySelector('div[role="grid"][aria-label*="Chat"], div[aria-label="Chat list"]')) {
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
})()`

export const IS_WHATSAPP_QR_VISIBLE_SCRIPT = `(() => {
  try {
    if (document.querySelector('[data-testid="qrcode"]')) return true;
    if (document.querySelector('canvas[aria-label*="Scan" i]')) return true;
    const text = (document.body && document.body.innerText) || '';
    if (/scan (the )?qr|link with phone|use whatsapp on your phone/i.test(text.slice(0, 600))) {
      return !document.querySelector('#pane-side, [data-testid="chat-list"]');
    }
    return false;
  } catch (_) {
    return false;
  }
})()`

/**
 * Poll the WhatsApp embed until the chat shell is verified (QR scanned or session restored).
 */
export async function waitForWhatsAppSignedIn(
  contents: WebContents,
  options: { profileId: string; timeoutMs?: number; signal?: { cancelled: boolean } } = {
    profileId: ''
  }
): Promise<WhatsAppLoginResult> {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000
  const started = Date.now()
  const partitionHint = options.profileId

  // Ensure we are on WhatsApp Web
  try {
    const url = contents.getURL()
    if (!/web\.whatsapp\.com/i.test(url)) {
      await contents.loadURL(WHATSAPP_WEB_URL)
    }
  } catch (err) {
    log.warn('whatsapp load failed', { profileId: partitionHint, err: String(err) })
    return 'cancelled'
  }

  return await new Promise<WhatsAppLoginResult>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const finish = (outcome: WhatsAppLoginResult): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearInterval(timer)
      }
      resolve(outcome)
    }

    const tick = (): void => {
      if (settled || contents.isDestroyed()) {
        finish('cancelled')
        return
      }
      if (options.signal?.cancelled) {
        finish('cancelled')
        return
      }
      if (Date.now() - started > timeoutMs) {
        log.warn('whatsapp login timed out waiting for QR scan', { profileId: partitionHint })
        finish('cancelled')
        return
      }
      void contents
        .executeJavaScript(VERIFY_WHATSAPP_SESSION_SCRIPT, true)
        .then((ok) => {
          if (settled || contents.isDestroyed()) {
            return
          }
          if (ok === true) {
            log.info('whatsapp session verified', { profileId: partitionHint })
            finish('signed-in')
          }
        })
        .catch(() => {
          /* ignore transient eval errors while page loads */
        })
    }

    timer = setInterval(tick, 800)
    tick()
  })
}

export const __test__ = {
  VERIFY_WHATSAPP_SESSION_SCRIPT,
  IS_WHATSAPP_QR_VISIBLE_SCRIPT,
  WHATSAPP_WEB_URL
}
