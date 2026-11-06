import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app, nativeImage, screen, shell } from 'electron'
import icon from '../../resources/icon.png?asset'
import { APP_DISPLAY_NAME } from '../shared/brand'
import { log } from './logging'

export type NotifyOptions = {
  enabled: boolean
  title: string
  body: string
  subtitle?: string
  silent?: boolean
  onClick: () => void
}

let fallbackWin: BrowserWindow | null = null
let lastBannerSig = ''
let lastBannerAt = 0

function bounceDock(): void {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.bounce('informational')
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function resolveIconPath(): string {
  const candidates = [
    icon,
    join(process.resourcesPath, 'icon.png'),
    join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'icon.png'),
    join(app.getAppPath(), 'resources', 'icon.png')
  ]
  return candidates.find((p) => Boolean(p) && existsSync(p)) ?? icon
}

function iconDataUrl(): string {
  try {
    const fromNative = nativeImage.createFromPath(resolveIconPath())
    if (!fromNative.isEmpty()) {
      return fromNative.toDataURL()
    }
  } catch {
    /* try file read */
  }
  try {
    const path = resolveIconPath()
    if (existsSync(path)) {
      return `data:image/png;base64,${readFileSync(path).toString('base64')}`
    }
  } catch {
    /* ignore */
  }
  return ''
}

/**
 * Slack-style macOS banner: app glyph, product name, bold title, preview body.
 * Always used so unsigned builds still alert, and so the Orbit logo is visible.
 */
function destroyBanner(): void {
  const current = fallbackWin
  fallbackWin = null
  if (!current || current.isDestroyed()) return
  try {
    current.destroy()
  } catch {
    /* ignore */
  }
}

function showFallbackBanner(options: NotifyOptions): void {
  destroyBanner()

  const display = screen.getPrimaryDisplay().workArea
  const width = 320
  const height = 64
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(display.x + display.width - width - 20),
    y: Math.round(display.y + 12),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    focusable: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  fallbackWin = win
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'screen-saver')

  const appName = escapeHtml(APP_DISPLAY_NAME)
  const headline = escapeHtml(options.subtitle || options.title || APP_DISPLAY_NAME)
  const body = escapeHtml(options.body)
  const glyph = iconDataUrl()
  const img = glyph
    ? `<img class="glyph" src="${glyph}" alt="" />`
    : `<div class="glyph fallback">${appName.slice(0, 1)}</div>`

  const html = `<!doctype html><html><head><meta charset="utf-8" />
<style>
  html,body{margin:0;height:100%;background:transparent;
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;}
  .card{margin:4px;height:calc(100% - 8px);border-radius:10px;padding:8px 10px;
    box-sizing:border-box;display:flex;gap:8px;align-items:center;cursor:pointer;
    background:rgba(12,12,14,.96);color:#ececec;
    border:1px solid rgba(255,255,255,.06);
    box-shadow:0 10px 28px rgba(0,0,0,.55);
    -webkit-app-region:no-drag;user-select:none;}
  .glyph{width:28px;height:28px;border-radius:6px;flex:none;object-fit:cover;}
  .glyph.fallback{display:flex;align-items:center;justify-content:center;
    background:#3a1844;font-weight:700;font-size:13px;}
  .copy{min-width:0;flex:1;}
  .meta{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0;}
  .app{font-size:10px;font-weight:600;letter-spacing:.01em;color:rgba(255,255,255,.42);margin:0;}
  .when{font-size:10px;color:rgba(255,255,255,.32);margin:0;}
  .t{font-size:12px;font-weight:650;margin:0;line-height:1.2;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .b{font-size:11px;margin:0;line-height:1.2;color:rgba(255,255,255,.62);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
</style></head><body>
<div class="card" id="c">${img}<div class="copy">
  <div class="meta"><p class="app">${appName}</p><p class="when">now</p></div>
  <p class="t">${headline}</p>
  <p class="b">${body}</p>
</div></div>
</body></html>`

  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) win.showInactive()
  })
  let acceptClick = false
  setTimeout(() => {
    acceptClick = true
  }, 350)
  win.on('focus', () => {
    if (!acceptClick) return
    options.onClick()
    if (!win.isDestroyed()) win.close()
  })
  const timer = setTimeout(() => {
    if (!win.isDestroyed()) win.close()
  }, 8000)
  win.on('closed', () => {
    clearTimeout(timer)
    if (fallbackWin === win) fallbackWin = null
  })

  if (!options.silent && process.platform === 'darwin') {
    shell.beep()
  }
  bounceDock()
  log.info('Orbit notification banner shown', { title: options.title, body: options.body })
}

/** Slack-style Orbit banner only — do not also fire a macOS banner (that stacked a duplicate). */
export async function notifyUnreadIncrease(
  options: NotifyOptions
): Promise<{ ok: boolean; error?: string; via?: 'os' | 'fallback' }> {
  if (!options.enabled) {
    log.info('notification skipped (disabled in settings)')
    return { ok: false, error: 'disabled' }
  }

  const sig = `${options.subtitle ?? ''}|${options.body}`
  const now = Date.now()
  // 60-second cooldown per signature to avoid constant desktop banner spam on polling
  if (sig === lastBannerSig && now - lastBannerAt < 60_000) {
    log.info('notification skipped (duplicate or cooldown)', { body: options.body })
    return { ok: true, via: 'fallback' }
  }
  lastBannerSig = sig
  lastBannerAt = now

  showFallbackBanner(options)
  return { ok: true, via: 'fallback' }
}
