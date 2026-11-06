/**
 * Real Google Chrome for Google + Slack auth, docked over the app’s right pane.
 * Separate process, but sized/positioned to match the auth dock rectangle.
 * Same chromeProfileKey (profileId) = same Chrome user-data dir for both steps.
 */
import type { BrowserWindow } from 'electron'
import { app, screen } from 'electron'
import { existsSync, cpSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../logging'
import { chromeProfileHasGoogleSession, chromeProfileHasSlackSession } from './chrome-cookie-probe'
import {
  closeDockedChrome,
  launchDockedChromeStay,
  resolveChromeExecutable,
  runChromeSystemLogin,
  updateLiveChromeDock
} from './chrome-system-login'
import { buildGoogleSignInUrl, SLACK_GOOGLE_SIGNIN_ENTRY_URL } from './login-helpers'
import { partitionForProfile, TEAMS_HOME_URL } from './session-partition'
import { SLACK_CLIENT_URL } from '../../shared/slack-url'

export type ChromeBrowserPhase = 'google' | 'slack'
export type ChromeBrowserResult = 'signed-in' | 'cancelled' | 'failed'

export interface ChromeBrowserAuthOptions {
  parentWindow?: BrowserWindow | null
  loginHint?: string
  /** Renderer dock rect relative to the window content area. */
  contentBounds?: { x: number; y: number; width: number; height: number }
  targetPartition?: string
  chromeKey?: string
}

type PendingController = {
  profileId: string
  phase: ChromeBrowserPhase
  parentWindow?: BrowserWindow
  contentBounds?: { x: number; y: number; width: number; height: number }
  resolveDone: () => void
  resolveCancel: () => void
  boundsReady?: () => void
}

let pending: PendingController | null = null

/** Stay-open Chrome over the right pane (Slack/Teams after auth — like Native chromeEmbed). */
type StayEmbed = {
  profileId: string
  appId: 'slack' | 'teams'
  parentWindow?: BrowserWindow
  contentBounds?: { x: number; y: number; width: number; height: number }
  onMoveOrResize?: () => void
  onEnterFullScreen?: () => void
}

let stayEmbed: StayEmbed | null = null

export function getPendingChromeBrowserAuth(): {
  profileId: string
  phase: ChromeBrowserPhase
} | null {
  if (!pending) return null
  return { profileId: pending.profileId, phase: pending.phase }
}

export function getChromeStayEmbed(): { profileId: string; appId: 'slack' | 'teams' } | null {
  if (!stayEmbed) return null
  return { profileId: stayEmbed.profileId, appId: stayEmbed.appId }
}

/** Renderer “I’ve signed in — Continue”. */
export function confirmChromeBrowserAuthDone(): boolean {
  if (!pending) return false
  pending.resolveDone()
  return true
}

export function cancelChromeBrowserAuth(): boolean {
  let acted = false
  if (pending) {
    pending.resolveCancel()
    acted = true
  }
  if (closeChromeStayEmbed()) {
    acted = true
  }
  return acted
}

function detachStayListeners(): void {
  if (!stayEmbed) return
  const parent = stayEmbed.parentWindow
  if (parent && !parent.isDestroyed()) {
    if (stayEmbed.onMoveOrResize) {
      parent.removeListener('move', stayEmbed.onMoveOrResize)
      parent.removeListener('resize', stayEmbed.onMoveOrResize)
    }
    if (stayEmbed.onEnterFullScreen) {
      parent.removeListener('enter-full-screen', stayEmbed.onEnterFullScreen)
    }
  }
}

/** Close stay-open Chrome pane (does not cancel in-flight Google/Slack auth). */
export function closeChromeStayEmbed(): boolean {
  if (!stayEmbed) {
    closeDockedChrome()
    return false
  }
  detachStayListeners()
  stayEmbed = null
  closeDockedChrome()
  return true
}

/**
 * Open Slack/Teams in real Chrome docked over the right pane (same profile as Google).
 * WebContentsView is skipped for Slack — Slack blocks non-Chrome embeds.
 */
export async function openChromeStayEmbed(
  profileId: string,
  appId: 'slack' | 'teams',
  options: ChromeBrowserAuthOptions & { startUrl?: string } = {}
): Promise<boolean> {
  if (!resolveChromeExecutable()) {
    log.error('Google Chrome not found for stay embed')
    return false
  }

  closeChromeStayEmbed()

  const parent =
    options.parentWindow && !options.parentWindow.isDestroyed() ? options.parentWindow : undefined

  const contentBounds = options.contentBounds
  const screenAnchor = toScreenAnchor(parent, contentBounds)
  const startUrl = options.startUrl ?? (appId === 'teams' ? TEAMS_HOME_URL : SLACK_CLIENT_URL)

  const ok = await launchDockedChromeStay({
    chromeProfileKey: profileId,
    startUrl,
    anchorBounds: screenAnchor,
    attachToWindow: parent
  })
  if (!ok) return false

  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  const onMoveOrResize = (): void => {
    if (!stayEmbed || !parent || parent.isDestroyed()) return
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      if (!stayEmbed || !parent || parent.isDestroyed()) return
      const screenRect = toScreenAnchor(parent, stayEmbed.contentBounds ?? contentBounds)
      if (screenRect) updateLiveChromeDock(screenRect)
    }, 80)
  }
  const onEnterFullScreen = (): void => {
    if (!parent || parent.isDestroyed()) return
    parent.setFullScreen(false)
  }

  if (parent?.isFullScreen()) {
    parent.setFullScreen(false)
  }
  parent?.on('move', onMoveOrResize)
  parent?.on('resize', onMoveOrResize)
  parent?.on('enter-full-screen', onEnterFullScreen)

  stayEmbed = {
    profileId,
    appId,
    parentWindow: parent,
    contentBounds,
    onMoveOrResize,
    onEnterFullScreen
  }

  log.info('Chrome stay embed open', { profileId, appId, startUrl: startUrl.slice(0, 80) })
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
  const dip = !contentBounds
    ? {
        x: Math.round(win.x + 300),
        y: Math.round(win.y),
        width: Math.max(480, Math.round(win.width - 300)),
        height: Math.max(320, Math.round(win.height - 72))
      }
    : {
        x: Math.round(win.x + contentBounds.x),
        y: Math.round(win.y + contentBounds.y),
        width: Math.max(320, Math.round(contentBounds.width)),
        height: Math.max(240, Math.round(contentBounds.height))
      }

  // On Windows, convert DIP → screen pixels. On macOS AppleScript already uses points (= DIP).
  if (process.platform === 'win32') {
    try {
      const converted = screen.dipToScreenRect(parent, dip)
      return {
        x: Math.round(converted.x),
        y: Math.round(converted.y),
        width: Math.round(converted.width),
        height: Math.round(converted.height)
      }
    } catch {
      return dip
    }
  }
  return dip
}

/** Keep Chrome locked to the right-pane dock while the user resizes / moves the app. */
export function syncChromeBrowserBounds(
  contentBounds: { x: number; y: number; width: number; height: number },
  parentWindow?: BrowserWindow | null
): void {
  // Critical: ignore mid-layout / sidebar-only reports so we never crush Chrome
  // into a tiny strip. Dock updates only apply for a full right-pane rect.
  if (!isUsableDockBounds(contentBounds)) return

  if (pending) {
    pending.contentBounds = contentBounds
    const ready = pending.boundsReady
    pending.boundsReady = undefined
    ready?.()

    const parent =
      parentWindow && !parentWindow.isDestroyed()
        ? parentWindow
        : pending.parentWindow && !pending.parentWindow.isDestroyed()
          ? pending.parentWindow
          : undefined
    const screenRect = toScreenAnchor(parent, contentBounds)
    if (screenRect) {
      updateLiveChromeDock(screenRect)
    }
    return
  }

  if (stayEmbed) {
    stayEmbed.contentBounds = contentBounds
    const parent =
      parentWindow && !parentWindow.isDestroyed()
        ? parentWindow
        : stayEmbed.parentWindow && !stayEmbed.parentWindow.isDestroyed()
          ? stayEmbed.parentWindow
          : undefined
    const screenRect = toScreenAnchor(parent, contentBounds)
    if (screenRect) {
      updateLiveChromeDock(screenRect)
    }
  }
}

function isUsableDockBounds(b?: { x: number; y: number; width: number; height: number }): boolean {
  // Full right pane is typically ≥400×360; the old centered hint box was ~360×200.
  return Boolean(b && b.width >= 420 && b.height >= 360)
}

function waitForDockBounds(timeoutMs: number): Promise<void> {
  if (!pending) return Promise.resolve()
  if (isUsableDockBounds(pending.contentBounds)) {
    return Promise.resolve()
  }
  // Drop tiny/placeholder bounds so we wait for AuthChromePane’s full-pane report.
  pending.contentBounds = undefined
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), timeoutMs)
    const onReady = (): void => {
      if (!isUsableDockBounds(pending?.contentBounds)) {
        // Keep listening — first report can be mid-layout.
        if (pending) pending.boundsReady = onReady
        return
      }
      clearTimeout(timer)
      resolve()
    }
    pending!.boundsReady = onReady
  })
}

function chromeLoginProfileDir(profileId: string): string {
  return join(
    app.getPath('userData'),
    'chrome-login-profiles',
    profileId.replace(/[^a-zA-Z0-9_-]/g, '_')
  )
}

/**
 * Copies the profile's Chrome directory (which contains the authenticated Google session)
 * into a card-specific Chrome directory so that when Chrome launches for the card,
 * Google already has the profile's Google account pre-logged-in for OAuth.
 */
export function seedChromeCardProfile(profileId: string, cardChromeKey: string): void {
  try {
    const src = chromeLoginProfileDir(profileId)
    const dst = chromeLoginProfileDir(cardChromeKey)
    if (src === dst || !existsSync(src) || existsSync(dst)) return

    mkdirSync(dst, { recursive: true })
    cpSync(src, dst, { recursive: true })
    log.info('seeded Chrome profile from profileId to cardKey', { profileId, cardChromeKey })
  } catch (err) {
    log.warn('seedChromeCardProfile failed', { profileId, cardChromeKey, err: String(err) })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Auto-confirm when isolated Chrome profile Cookies show a real session.
 * Verified on-device: AppleScript cannot read `--user-data-dir` windows; Cookies can.
 */
async function autoConfirmWhenSignedIn(
  phase: ChromeBrowserPhase,
  profileDir: string,
  isCancelled: () => boolean,
  confirm: () => void
): Promise<void> {
  const graceMs = phase === 'google' ? 3000 : 2000
  const started = Date.now()
  const deadline = started + 10 * 60 * 1000
  while (Date.now() < deadline) {
    if (isCancelled() || !pending) return
    if (Date.now() - started < graceMs) {
      await sleep(400)
      continue
    }
    const done =
      phase === 'google'
        ? chromeProfileHasGoogleSession(profileDir)
        : chromeProfileHasSlackSession(profileDir)
    if (done) {
      log.info('auto-confirm via Chrome Cookies DB', { phase, profileDir })
      confirm()
      return
    }
    await sleep(750)
  }
}

async function runChromeBrowserPhase(
  profileId: string,
  phase: ChromeBrowserPhase,
  options: ChromeBrowserAuthOptions = {}
): Promise<ChromeBrowserResult> {
  if (!resolveChromeExecutable()) {
    log.error('Google Chrome not found for in-app browser auth')
    return 'failed'
  }

  const parent =
    options.parentWindow && !options.parentWindow.isDestroyed() ? options.parentWindow : undefined

  let resolveDone!: () => void
  let resolveCancel!: () => void
  let cancelled = false
  const donePromise = new Promise<'done'>((r) => {
    resolveDone = () => r('done')
  })
  const abortPromise = new Promise<'cancelled'>((r) => {
    resolveCancel = () => {
      cancelled = true
      r('cancelled')
    }
  })

  pending = {
    profileId,
    phase,
    parentWindow: parent,
    contentBounds: options.contentBounds,
    resolveDone,
    resolveCancel
  }

  // Let the renderer mount AuthChromePane and report the full right-pane dock rect.
  await waitForDockBounds(2500)

  const contentBounds = pending.contentBounds ?? options.contentBounds
  const screenAnchor = toScreenAnchor(parent, contentBounds)
  const partition = options.targetPartition || partitionForProfile(profileId, 'slack')

  if (options.chromeKey && options.chromeKey !== profileId) {
    seedChromeCardProfile(profileId, options.chromeKey)
  }

  const profileDir = chromeLoginProfileDir(options.chromeKey || profileId)

  // Google: continue=https://www.google.com/ (NOT 127.0.0.1 — that causes Error 400).
  // Auto-close is driven by Cookies DB poll (SID/HSID), not loopback.
  const startUrl =
    phase === 'google'
      ? buildGoogleSignInUrl(options.loginHint, 'https://www.google.com/')
      : SLACK_GOOGLE_SIGNIN_ENTRY_URL

  log.info('dock-ready, launching Chrome in right-pane slot', {
    profileId,
    phase,
    contentBounds,
    screenAnchor
  })

  // Keep the full dashboard window. Chrome overlays the right pane at that pane’s size
  // (no sidebar shrink).
  void autoConfirmWhenSignedIn(
    phase,
    profileDir,
    () => cancelled || !pending,
    () => {
      if (pending) pending.resolveDone()
    }
  )

  try {
    const result = await runChromeSystemLogin({
      partition,
      chromeProfileKey: options.chromeKey || profileId,
      startUrl,
      loginHint: options.loginHint,
      abortPromise,
      donePromise,
      mode: 'docked',
      anchorBounds: screenAnchor,
      attachToWindow: parent,
      phase: phase === 'google' ? 'signing-in-google' : 'signing-in-slack'
    })
    log.info('Chrome auth phase finished', { profileId, phase, result })
    return result
  } finally {
    if (parent && !parent.isDestroyed()) {
      parent.focus()
    }
    if (pending?.profileId === profileId && pending.phase === phase) {
      pending = null
    }
  }
}

export async function runGoogleChromeBrowserLogin(
  profileId: string,
  options: ChromeBrowserAuthOptions = {}
): Promise<ChromeBrowserResult> {
  return runChromeBrowserPhase(profileId, 'google', options)
}

export async function runSlackChromeBrowserLogin(
  profileId: string,
  options: ChromeBrowserAuthOptions = {}
): Promise<ChromeBrowserResult> {
  return runChromeBrowserPhase(profileId, 'slack', options)
}
