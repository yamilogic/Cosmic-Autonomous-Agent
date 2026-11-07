/**
 * Docked Chrome over the Electron right pane (Google then Slack).
 * Continue / cancel come from the right-pane bottom strip — not a popup.
 */
import type { BrowserWindow } from 'electron'
import { log } from '../logging'
import {
  resolveChromeExecutable,
  runChromeSystemLogin,
  updateLiveChromeDock
} from './chrome-system-login'
import { buildGoogleSignInUrl, SLACK_GOOGLE_SIGNIN_ENTRY_URL } from './login-helpers'
import { partitionForProfile } from './session-partition'

export type ChromeEmbedPhase = 'google' | 'slack'
export type ChromeEmbedResult = 'signed-in' | 'cancelled' | 'failed'

export interface ChromeEmbedOptions {
  parentWindow?: BrowserWindow | null
  loginHint?: string
  /** Renderer dock rect relative to the window content area. */
  contentBounds?: { x: number; y: number; width: number; height: number }
}

type PendingController = {
  profileId: string
  phase: ChromeEmbedPhase
  parentWindow?: BrowserWindow
  resolveDone: () => void
  resolveCancel: () => void
}

let pending: PendingController | null = null

export function getPendingChromeEmbed(): { profileId: string; phase: ChromeEmbedPhase } | null {
  if (!pending) return null
  return { profileId: pending.profileId, phase: pending.phase }
}

/** Called from renderer “I’ve signed in — Continue”. */
export function confirmChromeEmbedDone(): boolean {
  if (!pending) return false
  pending.resolveDone()
  return true
}

/** Called if the user cancels from the app UI. */
export function cancelChromeEmbed(): boolean {
  if (!pending) return false
  pending.resolveCancel()
  return true
}

function toScreenAnchor(
  parent: BrowserWindow | undefined,
  contentBounds?: { x: number; y: number; width: number; height: number }
): { x: number; y: number; width: number; height: number } | undefined {
  if (!parent || parent.isDestroyed()) {
    return contentBounds
  }
  const win = parent.getContentBounds()
  if (!contentBounds) {
    return {
      x: Math.round(win.x + 300),
      y: Math.round(win.y),
      width: Math.max(480, Math.round(win.width - 300)),
      height: Math.round(win.height - 72)
    }
  }
  return {
    x: Math.round(win.x + contentBounds.x),
    y: Math.round(win.y + contentBounds.y),
    width: Math.round(contentBounds.width),
    height: Math.round(contentBounds.height)
  }
}

/** Keep Chrome aligned when the right-pane dock resizes / moves. */
export function syncChromeEmbedBounds(
  contentBounds: { x: number; y: number; width: number; height: number },
  parentWindow?: BrowserWindow | null
): void {
  if (!pending) return
  const parent =
    parentWindow && !parentWindow.isDestroyed()
      ? parentWindow
      : pending.parentWindow && !pending.parentWindow.isDestroyed()
        ? pending.parentWindow
        : undefined
  const screen = toScreenAnchor(parent, contentBounds)
  if (screen) {
    updateLiveChromeDock(screen)
  }
}

async function runChromeEmbedPhase(
  profileId: string,
  phase: ChromeEmbedPhase,
  options: ChromeEmbedOptions
): Promise<ChromeEmbedResult> {
  if (!resolveChromeExecutable()) {
    log.error('Google Chrome not found for pane embed')
    return 'failed'
  }

  const parent =
    options.parentWindow && !options.parentWindow.isDestroyed() ? options.parentWindow : undefined
  const screenAnchor = toScreenAnchor(parent, options.contentBounds)
  const partition = partitionForProfile(profileId, 'slack')
  const startUrl =
    phase === 'google' ? buildGoogleSignInUrl(options.loginHint) : SLACK_GOOGLE_SIGNIN_ENTRY_URL

  let resolveDone!: () => void
  let resolveCancel!: () => void
  const donePromise = new Promise<'done'>((r) => {
    resolveDone = () => r('done')
  })
  const abortPromise = new Promise<'cancelled'>((r) => {
    resolveCancel = () => r('cancelled')
  })

  pending = {
    profileId,
    phase,
    parentWindow: parent,
    resolveDone,
    resolveCancel
  }

  try {
    const result = await runChromeSystemLogin({
      partition,
      chromeProfileKey: profileId,
      startUrl,
      loginHint: options.loginHint,
      abortPromise,
      donePromise,
      anchorBounds: screenAnchor,
      phase: phase === 'google' ? 'signing-in-google' : 'signing-in-slack'
    })
    log.info('Chrome pane-embed phase finished', { profileId, phase, result })
    return result
  } finally {
    if (pending?.profileId === profileId && pending.phase === phase) {
      pending = null
    }
  }
}

export async function runGoogleChromeEmbedLogin(
  profileId: string,
  options: ChromeEmbedOptions = {}
): Promise<ChromeEmbedResult> {
  return runChromeEmbedPhase(profileId, 'google', options)
}

export async function runSlackChromeEmbedLogin(
  profileId: string,
  options: ChromeEmbedOptions = {}
): Promise<ChromeEmbedResult> {
  return runChromeEmbedPhase(profileId, 'slack', options)
}
