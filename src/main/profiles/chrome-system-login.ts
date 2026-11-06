/**
 * Google blocks Electron embeds AND browsers controlled via automation (CDP).
 * Interactive sign-in runs in normal Chrome (no remote-debugging).
 * After the user confirms, we briefly reopen the same profile headless to export cookies.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { app, screen, session as electronSession, type BrowserWindow } from 'electron'
import { log } from '../logging'

export type ChromeSystemLoginPhase = 'signing-in-google' | 'signing-in-slack'

export interface ChromeSystemLoginOptions {
  partition: string
  /** Shared Chrome user-data dir key (usually profileId). Same key = same browser for Google + Slack. */
  chromeProfileKey: string
  /** Page to open (Google sign-in OR Slack sign-in). */
  startUrl: string
  loginHint?: string
  onPhaseChange?: (phase: ChromeSystemLoginPhase) => void | Promise<void>
  abortPromise?: Promise<'cancelled'>
  donePromise?: Promise<'done'>
  /** Extra signal (e.g. loopback http://127.0.0.1/…/google-done). */
  loopbackDonePromise?: Promise<'done'>
  anchorBounds?: { x: number; y: number; width: number; height: number }
  /** Initial phase reported while Chrome is open. */
  phase?: ChromeSystemLoginPhase
  /**
   * popup = normal Chrome window (default).
   * docked = force-position over the Electron right pane.
   */
  mode?: 'popup' | 'docked'
  /** When set, auth Chrome hides with this window and only reappears when it is focused. */
  attachToWindow?: BrowserWindow | null
}

export type ChromeSystemLoginResult = 'signed-in' | 'cancelled' | 'failed'

const CHROME_CANDIDATES = process.env.CHROME_EXECUTABLE_CANDIDATES
  ? process.env.CHROME_EXECUTABLE_CANDIDATES.split(':')
  : [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/opt/google/chrome/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/brave-browser',
      '/snap/bin/chromium'
    ]

export function resolveChromeExecutable(): string | null {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        server.close()
        reject(new Error('Could not allocate a free port'))
        return
      }
      const { port } = addr
      server.close((err) => {
        if (err) reject(err)
        else resolve(port)
      })
    })
    server.on('error', reject)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface CdpCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  session?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

class CdpClient {
  private ws: WebSocket
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >()

  private constructor(ws: WebSocket) {
    this.ws = ws
    this.ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          id?: number
          result?: unknown
          error?: { message?: string }
        }
        if (msg.id == null) return
        const waiter = this.pending.get(msg.id)
        if (!waiter) return
        this.pending.delete(msg.id)
        if (msg.error) waiter.reject(new Error(msg.error.message ?? 'CDP error'))
        else waiter.resolve(msg.result)
      } catch {
        /* ignore */
      }
    })
  }

  static async connect(webSocketDebuggerUrl: string): Promise<CdpClient> {
    const ws = new WebSocket(webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error('CDP WebSocket failed')), { once: true })
    })
    return new CdpClient(ws)
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP timeout: ${method}`))
        }
      }, 15000)
    })
  }

  async getAllCookies(): Promise<CdpCookie[]> {
    await this.send('Network.enable')
    const result = (await this.send('Network.getAllCookies')) as { cookies?: CdpCookie[] }
    return result.cookies ?? []
  }

  close(): void {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
  }
}

function mapSameSite(
  sameSite?: CdpCookie['sameSite']
): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  if (sameSite === 'Strict') return 'strict'
  if (sameSite === 'Lax') return 'lax'
  if (sameSite === 'None') return 'no_restriction'
  return 'unspecified'
}

function cookieUrl(cookie: CdpCookie): string {
  const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain
  const scheme = cookie.secure ? 'https' : 'http'
  return `${scheme}://${domain}${cookie.path || '/'}`
}

async function importCookiesToPartition(
  partition: string,
  cookies: CdpCookie[],
  options?: { hosts?: 'google' | 'slack' | 'all' }
): Promise<number> {
  const hosts = options?.hosts ?? 'all'
  const ses = electronSession.fromPartition(partition)
  let imported = 0
  for (const cookie of cookies) {
    const host = cookie.domain.replace(/^\./, '')
    const isGoogle = /(^|\.)google\.com$/i.test(host) || /(^|\.)youtube\.com$/i.test(host)
    const isSlack =
      /(^|\.)slack\.com$/i.test(host) ||
      /(^|\.)slack-edge\.com$/i.test(host) ||
      /(^|\.)slackb\.com$/i.test(host)
    if (hosts === 'google' && !isGoogle) continue
    if (hosts === 'slack' && !isSlack) continue
    if (hosts === 'all' && !isGoogle && !isSlack) continue
    try {
      await ses.cookies.set({
        url: cookieUrl(cookie),
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        expirationDate: !cookie.session && cookie.expires > 0 ? cookie.expires : undefined,
        sameSite: mapSameSite(cookie.sameSite)
      })
      imported += 1
    } catch (err) {
      log.warn('cookie import skipped', {
        name: cookie.name,
        domain: cookie.domain,
        err: String(err)
      })
    }
  }
  await ses.cookies.flushStore()
  return imported
}

function killProcess(child: ChildProcess | null): void {
  if (!child || child.killed) return
  try {
    child.kill('SIGTERM')
    setTimeout(() => {
      if (!child.killed) {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }
    }, 2500)
  } catch {
    /* ignore */
  }
}

/** Kill every Chrome process tied to our isolated user-data-dir (closes the Google/Slack window). */
let authChromeKillTimer: ReturnType<typeof setTimeout> | null = null

function killAuthChromeProcesses(): void {
  if (authChromeKillTimer) {
    clearTimeout(authChromeKillTimer)
    authChromeKillTimer = null
  }
  // Snapshot PIDs now. A delayed SIGKILL must NOT re-query pgrep — that was killing
  // the freshly launched auth Chrome ~1.5s after open (popup flash-close).
  const pids = resolveAuthChromePids()
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* ignore */
    }
  }
  if (pids.length === 0) return
  authChromeKillTimer = setTimeout(() => {
    authChromeKillTimer = null
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* ignore */
      }
    }
  }, 1500)
}

/** Cancel any pending SIGKILL sweep before starting a new auth Chrome. */
function cancelPendingAuthChromeKill(): void {
  if (authChromeKillTimer) {
    clearTimeout(authChromeKillTimer)
    authChromeKillTimer = null
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode != null || child.killed) {
      resolve()
      return
    }
    const timer = setTimeout(() => resolve(), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function exportCookiesViaHeadlessChrome(
  chromePath: string,
  profileDir: string
): Promise<CdpCookie[]> {
  const port = await findFreePort()
  const child = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      'about:blank'
    ],
    { stdio: 'ignore', detached: false }
  )

  let cdp: CdpClient | null = null
  try {
    const deadline = Date.now() + 20000
    let debuggerUrl: string | null = null
    while (Date.now() < deadline) {
      try {
        const version = await fetch(`http://127.0.0.1:${port}/json/version`)
        if (version.ok) {
          const body = (await version.json()) as { webSocketDebuggerUrl?: string }
          const list = await fetch(`http://127.0.0.1:${port}/json/list`)
          if (list.ok) {
            const pages = (await list.json()) as Array<{
              type?: string
              webSocketDebuggerUrl?: string
            }>
            const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl)
            debuggerUrl = page?.webSocketDebuggerUrl ?? body.webSocketDebuggerUrl ?? null
            if (debuggerUrl) break
          }
        }
      } catch {
        /* starting */
      }
      await sleep(250)
    }
    if (!debuggerUrl) {
      throw new Error('Headless Chrome DevTools not ready')
    }
    cdp = await CdpClient.connect(debuggerUrl)
    return await cdp.getAllCookies()
  } finally {
    cdp?.close()
    killProcess(child)
    await waitForExit(child, 4000)
  }
}

function chromePlacement(
  mode: 'popup' | 'docked',
  anchor?: { x: number; y: number; width: number; height: number }
): {
  width: number
  height: number
  x: number
  y: number
} {
  // Large centered window on the main display — always visible without Accessibility.
  if (mode === 'popup') {
    try {
      const wa = screen.getPrimaryDisplay().workArea
      const width = Math.min(980, Math.max(720, wa.width - 100))
      const height = Math.min(760, Math.max(560, wa.height - 100))
      return {
        width,
        height,
        x: Math.round(wa.x + (wa.width - width) / 2),
        y: Math.round(wa.y + Math.max(40, (wa.height - height) / 2))
      }
    } catch {
      return { width: 960, height: 720, x: 180, y: 80 }
    }
  }
  if (!anchor) {
    return { width: 960, height: 720, x: 300, y: 80 }
  }
  // Exact right-pane size — overlay the dashboard’s embed column (no shrink).
  return {
    width: Math.max(320, Math.round(anchor.width)),
    height: Math.max(280, Math.round(anchor.height)),
    x: Math.round(anchor.x),
    y: Math.round(anchor.y)
  }
}

/** Live dock target while Chrome --app is open (updated when the right pane resizes). */
let liveDockPlace: { x: number; y: number; width: number; height: number } | null = null
/** Dedicated user-data-dir for the auth Chrome (used to find the real process on macOS). */
let liveAuthProfileDir: string | null = null
/** Spawn PID (launcher); real window often belongs to a child / sibling process. */
let liveAuthChromePid: number | null = null

export function updateLiveChromeDock(
  anchor: { x: number; y: number; width: number; height: number } | null,
  bringFront = false
): void {
  liveDockPlace = anchor ? chromePlacement('docked', anchor) : null
  if (liveDockPlace) {
    positionAuthChromeWindow(liveDockPlace, bringFront)
  }
}

/**
 * Main Google Chrome browser PIDs for our user-data-dir (not Helper/GPU/renderer).
 */
function resolveAuthChromePids(): number[] {
  const pids = new Set<number>()
  if (liveAuthProfileDir) {
    try {
      const marker = liveAuthProfileDir.replace(/"/g, '')
      const out = spawnSync('pgrep', ['-fl', marker], { encoding: 'utf8' }).stdout || ''
      for (const line of out.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        if (!trimmed.includes('MacOS/Google Chrome')) continue
        if (trimmed.includes('Helper')) continue
        const n = Number(trimmed.split(/\s+/)[0])
        if (Number.isFinite(n) && n > 0) pids.add(n)
      }
    } catch {
      /* ignore */
    }
  }
  if (liveAuthChromePid) {
    try {
      process.kill(liveAuthChromePid, 0)
      pids.add(liveAuthChromePid)
    } catch {
      liveAuthChromePid = null
    }
  }
  return [...pids]
}

/**
 * True when a Chrome tab URL belongs to our Google/Slack/Teams auth flow.
 * Prevents resizing the user’s personal Chrome (e.g. example.com).
 */
function isAuthChromeUrl(url: string): boolean {
  const u = url.toLowerCase()
  return (
    u.includes('accounts.google.com') ||
    u.includes('myaccount.google.com') ||
    u.includes('google.com/signin') ||
    u.includes('slack.com') ||
    u.includes('app.slack.com') ||
    u.includes('login.microsoftonline.com') ||
    u.includes('login.live.com') ||
    u.includes('teams.microsoft.com')
  )
}

/** Front the isolated auth Chrome process (not the user’s everyday Chrome). */
function bringAuthChromeProcessFront(): void {
  if (process.platform !== 'darwin') return
  const pids = resolveAuthChromePids()
  if (pids.length === 0) return
  const pid = pids[0]
  // System Events needs Accessibility; ignore failure — launch --window-position still applies.
  spawn(
    'osascript',
    [
      '-e',
      `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`
    ],
    { stdio: 'ignore' }
  )
}

/** Read URLs Chrome AppleScript can see (often only one Chrome instance). */
function listScriptableChromeUrls(): string[] {
  if (process.platform !== 'darwin') return []
  try {
    const out = spawnSync(
      'osascript',
      ['-e', 'tell application "Google Chrome" to get URL of active tab of every window'],
      { encoding: 'utf8' }
    )
    const raw = (out.stdout || '').trim()
    if (!raw) return []
    return raw
      .split(', ')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

async function waitUntilAuthUrlScriptable(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const urls = listScriptableChromeUrls()
    if (urls.some(isAuthChromeUrl)) return true
    await sleep(250)
  }
  return listScriptableChromeUrls().some(isAuthChromeUrl)
}

/**
 * Place only an auth-related Chrome window in the right-pane slot.
 * Never touch unrelated personal Chrome tabs.
 */
function positionAuthChromeWindow(
  place: { x: number; y: number; width: number; height: number },
  bringFront = false
): void {
  if (process.platform !== 'darwin') {
    return
  }
  if (bringFront) {
    bringAuthChromeProcessFront()
  }
  const { x, y, width, height } = place
  const right = x + width
  const bottom = y + height
  // Only resize windows whose active tab is Google/Slack/Teams auth — not example.com etc.
  const script = `
tell application "Google Chrome"
  if (count of windows) = 0 then return
  repeat with w in windows
    try
      set u to URL of active tab of w as string
      if u contains "accounts.google.com" or u contains "myaccount.google.com" or u contains "google.com/signin" or u contains "slack.com" or u contains "login.microsoftonline.com" or u contains "login.live.com" or u contains "teams.microsoft.com" then
        set bounds of w to {${x}, ${y}, ${right}, ${bottom}}
        return
      end if
    end try
  end repeat
end tell`
  spawn('osascript', ['-e', script], { stdio: 'ignore' })
}

/** Blur Electron and put Chrome auth window in the right-pane rectangle. */
function revealAuthChrome(
  attach: BrowserWindow | null,
  place?: { x: number; y: number; width: number; height: number }
): void {
  try {
    if (attach && !attach.isDestroyed()) {
      attach.blur()
    }
  } catch {
    /* ignore */
  }
  bringAuthChromeProcessFront()
  if (place) {
    positionAuthChromeWindow(place, true)
  }
  for (const ms of [300, 800, 1500, 2500]) {
    void sleep(ms).then(() => {
      bringAuthChromeProcessFront()
      if (place) positionAuthChromeWindow(place, true)
    })
  }
}

/** Clear stale locks so a new --user-data-dir window can open. */
function clearChromeProfileLocks(profileDir: string): void {
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile']) {
    try {
      unlinkSync(join(profileDir, name))
    } catch {
      /* ignore */
    }
  }
}

async function waitUntilAuthChromeVisible(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (resolveAuthChromePids().length > 0) {
      return true
    }
    await sleep(150)
  }
  return resolveAuthChromePids().length > 0
}

/**
 * Google/Slack auth in an isolated real Chrome instance (dedicated user-data-dir).
 * Opens above Electron (activate + blur) — System Events docking is optional.
 */
export async function runChromeSystemLogin(
  options: ChromeSystemLoginOptions
): Promise<ChromeSystemLoginResult> {
  const chromePath = resolveChromeExecutable()
  if (!chromePath) {
    log.error('Google Chrome not found for system login')
    return 'failed'
  }

  const profileDir = join(
    app.getPath('userData'),
    'chrome-login-profiles',
    options.chromeProfileKey.replace(/[^a-zA-Z0-9_-]/g, '_')
  )
  mkdirSync(profileDir, { recursive: true })

  const startUrl = options.startUrl
  const mode = options.mode ?? 'popup'
  const place = chromePlacement(mode, options.anchorBounds)
  liveDockPlace = mode === 'docked' ? place : null
  const phase = options.phase ?? 'signing-in-google'

  // Kill leftovers + clear locks so Chrome actually opens a window.
  liveAuthProfileDir = profileDir
  killAuthChromeProcesses()
  await sleep(500)
  cancelPendingAuthChromeKill()
  clearChromeProfileLocks(profileDir)

  // Isolated profile. Docked auth uses compact --app window in the right-pane slot.
  const args = [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-features=ChromeWhatsNewUI',
    `--window-size=${place.width},${place.height}`,
    `--window-position=${place.x},${place.y}`,
    mode === 'docked' ? `--app=${startUrl}` : startUrl
  ]
  if (mode !== 'docked') {
    args.splice(args.length - 1, 0, '--new-window')
  }

  log.info('launching isolated Chrome for auth', {
    chromePath,
    mode,
    partition: options.partition,
    chromeProfileKey: options.chromeProfileKey,
    profileDir,
    startUrl: startUrl.slice(0, 100),
    place
  })

  // Spawn the binary directly so --user-data-dir + --app create a real window.
  const child = spawn(chromePath, args, { stdio: 'ignore', detached: false })
  liveAuthChromePid = child.pid ?? null
  liveAuthProfileDir = profileDir

  const attach =
    options.attachToWindow && !options.attachToWindow.isDestroyed() ? options.attachToWindow : null

  /**
   * Initial snap over the pane (no frontmost). Resize/move re-dock is handled by
   * chrome-browser-auth via updateLiveChromeDock — do not keep a long interval
   * or focus stealing (that caused autoslide).
   */
  let dockEnabled = mode === 'docked'
  let bump: ReturnType<typeof setInterval> | null = null

  const redock = (): void => {
    if (!dockEnabled || mode !== 'docked') return
    positionAuthChromeWindow(liveDockPlace ?? place, false)
  }

  const stopDocking = (): void => {
    dockEnabled = false
    if (bump) {
      clearInterval(bump)
      bump = null
    }
  }

  const onMinimize = (): void => {
    // Do not hide auth Chrome — System Events often lacks Accessibility and
    // Chrome is already easy to lose behind Electron.
  }
  const onRestore = (): void => {
    revealAuthChrome(attach, liveDockPlace ?? place)
    redock()
  }

  if (attach) {
    attach.on('minimize', onMinimize)
    attach.on('restore', onRestore)
  }

  if (mode === 'docked' || mode === 'popup') {
    const appeared = await waitUntilAuthChromeVisible(10000)
    if (!appeared) {
      log.error('auth Chrome did not appear (no process for user-data-dir)', { profileDir })
      stopDocking()
      killProcess(child)
      killAuthChromeProcesses()
      liveDockPlace = null
      liveAuthChromePid = null
      liveAuthProfileDir = null
      return 'failed'
    }
    // Keep dashboard full-size; Chrome overlays the right pane at that pane’s bounds.
    // Never resize personal Chrome tabs (URL-gated). No sidebar shrink.
    log.info('auth Chrome visible — placing in right-pane slot', { place, mode })
    bringAuthChromeProcessFront()
    const scriptable = await waitUntilAuthUrlScriptable(5000)
    if (!scriptable) {
      log.warn(
        'AppleScript cannot see auth Chrome URL (personal Chrome may own scripting) — relying on process front + launch position'
      )
    }
    revealAuthChrome(attach, place)
    // Keep auth Chrome above the full dashboard while signing in.
    if (!bump) {
      bump = setInterval(() => {
        if (!dockEnabled) return
        bringAuthChromeProcessFront()
        positionAuthChromeWindow(liveDockPlace ?? place, true)
      }, 1500)
    }
    for (const ms of [400, 900, 1600, 2400]) {
      void sleep(ms).then(() => {
        if (dockEnabled || mode === 'popup') {
          positionAuthChromeWindow(liveDockPlace ?? place, true)
        }
      })
    }
  }

  let cancelled = false
  void options.abortPromise?.then(() => {
    cancelled = true
    stopDocking()
  })
  void options.donePromise?.then(() => {
    stopDocking()
    killAuthChromeProcesses()
    killProcess(child)
    if (attach && !attach.isDestroyed()) {
      attach.focus()
    }
  })

  try {
    await Promise.resolve(options.onPhaseChange?.(phase))

    // Do NOT race on spawn-exit for docked Chrome. On macOS the launcher PID often
    // exits while the real --user-data-dir window keeps running; treating exit as
    // "done" kills that window within seconds (popup "never comes").
    const racers: Array<Promise<'done' | 'cancelled'>> = [
      options.donePromise ?? new Promise<'done'>(() => undefined),
      options.abortPromise ?? new Promise<'cancelled'>(() => undefined)
    ]
    if (options.loopbackDonePromise) {
      racers.push(options.loopbackDonePromise)
    }
    // Popup mode: exit can mean the user closed Chrome — still listen.
    if (mode !== 'docked') {
      racers.push(waitForExit(child, 15 * 60 * 1000).then(() => 'done' as const))
    }

    const outcome = await Promise.race(racers)

    stopDocking()

    if (cancelled || outcome === 'cancelled') {
      killAuthChromeProcesses()
      killProcess(child)
      return 'cancelled'
    }

    killAuthChromeProcesses()
    killProcess(child)
    await waitForExit(child, 5000)
    await sleep(600)

    if (attach && !attach.isDestroyed()) {
      attach.focus()
    }

    log.info('exporting cookies from Chrome profile', { profileDir, phase })
    const cookies = await exportCookiesViaHeadlessChrome(chromePath, profileDir)
    // Google-only auth must not overwrite Slack cookies already in the Electron partition
    // (re-running Continue with Google for an existing email was logging Slack out).
    const hostFilter = phase === 'signing-in-google' ? 'google' : 'all'
    const imported = await importCookiesToPartition(options.partition, cookies, {
      hosts: hostFilter
    })
    log.info('imported Chrome cookies into Electron partition', {
      partition: options.partition,
      hosts: hostFilter,
      total: cookies.length,
      imported
    })
    // Soft-success only when Cookies DB still shows a session after export failed.
    if (imported === 0) {
      const { chromeProfileHasGoogleSession, chromeProfileHasSlackSession } =
        await import('./chrome-cookie-probe')
      const ok =
        phase === 'signing-in-slack'
          ? chromeProfileHasSlackSession(profileDir)
          : chromeProfileHasGoogleSession(profileDir)
      if (ok) {
        log.warn('cookie export empty but probe OK — treating as signed-in')
        return 'signed-in'
      }
      return 'failed'
    }
    return 'signed-in'
  } catch (err) {
    if (cancelled || String(err).includes('cancelled')) {
      return 'cancelled'
    }
    log.error('Chrome auth failed', { err: String(err) })
    return 'failed'
  } finally {
    stopDocking()
    if (attach && !attach.isDestroyed()) {
      attach.removeListener('minimize', onMinimize)
      attach.removeListener('restore', onRestore)
    }
    liveDockPlace = null
    liveAuthChromePid = null
    liveAuthProfileDir = null
    killAuthChromeProcesses()
    killProcess(child)
  }
}

/** Close any live docked Chrome (auth or stay-open embed). */
export function closeDockedChrome(): void {
  killAuthChromeProcesses()
  liveDockPlace = null
  liveAuthChromePid = null
  liveAuthProfileDir = null
}

/**
 * Launch docked Chrome and leave it open (Slack/Teams viewing).
 * Same isolated profile dir as Google auth — matches Slack Native chromeEmbed.
 */
export async function launchDockedChromeStay(options: {
  chromeProfileKey: string
  startUrl: string
  anchorBounds?: { x: number; y: number; width: number; height: number }
  attachToWindow?: BrowserWindow | null
}): Promise<boolean> {
  const chromePath = resolveChromeExecutable()
  if (!chromePath) {
    log.error('Google Chrome not found for docked embed')
    return false
  }

  closeDockedChrome()
  await sleep(400)
  cancelPendingAuthChromeKill()

  const profileDir = join(
    app.getPath('userData'),
    'chrome-login-profiles',
    options.chromeProfileKey.replace(/[^a-zA-Z0-9_-]/g, '_')
  )
  mkdirSync(profileDir, { recursive: true })

  const place = chromePlacement('docked', options.anchorBounds)
  liveDockPlace = place
  liveAuthProfileDir = profileDir

  const args = [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-features=ChromeWhatsNewUI',
    '--new-window',
    `--window-size=${place.width},${place.height}`,
    `--window-position=${place.x},${place.y}`,
    options.startUrl
  ]

  log.info('launching docked Chrome stay-open embed', {
    chromeProfileKey: options.chromeProfileKey,
    startUrl: options.startUrl.slice(0, 120),
    place
  })

  liveAuthProfileDir = profileDir
  let child: ChildProcess
  if (process.platform === 'darwin') {
    child = spawn('open', ['-na', 'Google Chrome', '--args', ...args], {
      stdio: 'ignore',
      detached: false
    })
    liveAuthChromePid = null
  } else {
    child = spawn(chromePath, args, { stdio: 'ignore', detached: false })
    liveAuthChromePid = child.pid ?? null
  }

  const appeared = await waitUntilAuthChromeVisible(8000)
  if (!appeared) {
    log.error('stay-open Chrome did not appear', { profileDir })
    closeDockedChrome()
    killProcess(child)
    return false
  }

  revealAuthChrome(
    options.attachToWindow && !options.attachToWindow.isDestroyed() ? options.attachToWindow : null,
    place
  )
  for (const ms of [400, 900, 1600, 2500]) {
    void sleep(ms).then(() => {
      if (liveDockPlace) {
        positionAuthChromeWindow(liveDockPlace, true)
      }
    })
  }

  return true
}
