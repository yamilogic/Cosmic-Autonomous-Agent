import type { AppId, WorkspaceThemePayload } from '../../../shared/types'

const DARK_SIDEBAR = '#121419'
const LIGHT_SIDEBAR = '#f0f2f5'
const DEFAULT_ACCENT = '#a99bff'
const DEFAULT_ACCENT_DIM = '#5b3ad6'

type BrandTheme = {
  accent: string
  accentDim: string
  sidebarDark: string
  sidebarLight: string
}

/**
 * Soft brand accents — Slack is muted aubergine/slate, not loud purple.
 * Surfaces stay mostly neutral; accent drives buttons / highlights.
 */
const APP_BRAND: Record<AppId, BrandTheme> = {
  slack: {
    accent: '#7a6b8a',
    accentDim: '#63586f',
    sidebarDark: '#1a1820',
    sidebarLight: '#f3f1f5'
  },
  teams: {
    accent: '#6264a7',
    accentDim: '#5059c9',
    sidebarDark: '#1b1f3b',
    sidebarLight: '#eef0fa'
  },
  whatsapp: {
    accent: '#25d366',
    accentDim: '#1da851',
    sidebarDark: '#111b21',
    sidebarLight: '#e8f8ee'
  }
}

/** Skip redundant CSS writes (theme IPC can fire more than once). */
let lastPaintKey = ''

function resolvedTheme(): 'light' | 'dark' {
  const t = document.documentElement.dataset.theme
  if (t === 'light' || t === 'dark') return t
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.replace('#', '').trim()
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  const n = Number.parseInt(full, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return `rgba(169, 155, 255, ${alpha})`
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

function mixToward(hex: string, towardHex: string, amount: number): string {
  const a = hexToRgb(hex)
  const b = hexToRgb(towardHex)
  if (!a || !b) return hex
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * amount)
  const r = mix(a.r, b.r).toString(16).padStart(2, '0')
  const g = mix(a.g, b.g).toString(16).padStart(2, '0')
  const bl = mix(a.b, b.b).toString(16).padStart(2, '0')
  return `#${r}${g}${bl}`
}

/** Pull loud sampled Slack purples toward a calmer accent — never toward white. */
function softenAccent(hex: string): string {
  if (isNearWhite(hex) || isNearBlack(hex)) return APP_BRAND.slack.accent
  return mixToward(hex, '#6e6578', 0.35)
}

function luminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const f = (c: number): number => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b)
}

function isNearWhite(hex: string): boolean {
  return luminance(hex) > 0.78
}

function isNearBlack(hex: string): boolean {
  return luminance(hex) < 0.04
}

function sanitizeSlackSidebar(hex: string | undefined, mode: 'light' | 'dark'): string {
  const brand = mode === 'light' ? APP_BRAND.slack.sidebarLight : APP_BRAND.slack.sidebarDark
  if (!hex || isNearWhite(hex)) return brand
  // Light-mode sidebar sample that's still very pale → keep a soft tint, not pure white
  if (mode === 'light' && luminance(hex) > 0.9) return brand
  // Dark mode must not use light samples
  if (mode === 'dark' && luminance(hex) > 0.35) return brand
  return hex
}

function sanitizeSlackAccent(hex: string | undefined, mode: 'light' | 'dark'): string {
  const brand = APP_BRAND.slack.accent
  if (!hex || isNearWhite(hex) || isNearBlack(hex)) return brand
  if (luminance(hex) > 0.62) return mode === 'light' ? '#4a154b' : brand
  return softenAccent(hex)
}

export function applyDocumentTheme(preference: 'system' | 'light' | 'dark'): void {
  const root = document.documentElement
  if (preference === 'system') {
    const light = window.matchMedia('(prefers-color-scheme: light)').matches
    root.dataset.theme = light ? 'light' : 'dark'
  } else {
    root.dataset.theme = preference
  }
  if (!root.dataset.themeApp || root.dataset.themeApp === 'default') {
    lastPaintKey = ''
    root.style.setProperty(
      '--sidebar-tint',
      resolvedTheme() === 'light' ? LIGHT_SIDEBAR : DARK_SIDEBAR
    )
  }
}

function paintChrome(options: {
  appId: AppId | 'default'
  accent: string
  accentDim: string
  sidebar: string
  mode?: 'light' | 'dark'
}): void {
  const root = document.documentElement
  const mode = options.mode ?? resolvedTheme()
  const dark = mode === 'dark'
  const { appId, accent, accentDim, sidebar } = options

  const key = `${appId}|${accent}|${accentDim}|${sidebar}|${mode}`
  if (key === lastPaintKey) return
  lastPaintKey = key

  // Keep chrome mostly neutral — only a light sidebar hint from the workspace.
  const neutral = dark ? DARK_SIDEBAR : LIGHT_SIDEBAR
  // Never tint with near-white samples (was washing the whole UI white).
  const safeSidebar = isNearWhite(sidebar) ? neutral : sidebar
  const tint = mixToward(safeSidebar, neutral, dark ? 0.55 : 0.7)
  root.style.setProperty('--sidebar-tint', isNearWhite(tint) ? neutral : tint)
  // Borders stay neutral: accent marks action, selection and state only.
  root.style.removeProperty('--border')
  root.style.removeProperty('--border-soft')

  const safeAccent = isNearWhite(accent)
    ? appId === 'slack'
      ? APP_BRAND.slack.accent
      : DEFAULT_ACCENT
    : accent
  root.style.setProperty('--accent', safeAccent)
  root.style.setProperty('--accent-dim', isNearWhite(accentDim) ? safeAccent : accentDim)
  root.style.setProperty('--accent-soft', rgba(safeAccent, dark ? 0.18 : 0.12))
  root.style.setProperty('--accent-on', '#ffffff')

  // Avoid repainting full --bg/--surface (expensive + was making Slack feel purple).
  root.style.removeProperty('--bg')
  root.style.removeProperty('--surface')
  root.style.removeProperty('--surface-2')

  if (appId === 'default') {
    root.style.removeProperty('--border')
    root.style.removeProperty('--border-soft')
  }

  root.dataset.themeApp = appId
  // Reflect detected Slack luminance for CSS that reads data-theme chrome mode.
  root.dataset.themeChrome = mode
}

/** Immediate soft brand tint when user opens Slack / Teams / WhatsApp. */
export function applyAppBrandTheme(appId: AppId, mode?: 'light' | 'dark'): void {
  const brand = APP_BRAND[appId]
  const m = mode ?? resolvedTheme()
  paintChrome({
    appId,
    accent: brand.accent,
    accentDim: brand.accentDim,
    sidebar: m === 'light' ? brand.sidebarLight : brand.sidebarDark,
    mode: m
  })
}

/** Apply sampled workspace colors (Slack) or brand defaults — cheap + idempotent. */
export function applyWorkspaceTheme(payload: WorkspaceThemePayload): void {
  if (payload.appId === 'default') {
    resetWorkspaceTheme()
    return
  }

  const brand = APP_BRAND[payload.appId]
  // Never flip a dark dashboard to white because Slack's content pane sampled as light.
  const dash = resolvedTheme()
  const sampled = payload.mode
  const mode: 'light' | 'dark' = dash === 'dark' ? 'dark' : sampled === 'dark' ? 'dark' : dash

  let accent = payload.accent || brand.accent
  let sidebar = payload.sidebar || (mode === 'light' ? brand.sidebarLight : brand.sidebarDark)

  if (payload.appId === 'slack') {
    accent = sanitizeSlackAccent(payload.accent, mode)
    sidebar = sanitizeSlackSidebar(payload.sidebar, mode)
  }

  paintChrome({
    appId: payload.appId,
    accent,
    accentDim: brand.accentDim,
    sidebar,
    mode
  })
}

export function resetWorkspaceTheme(): void {
  lastPaintKey = ''
  const dark = resolvedTheme() === 'dark'
  const root = document.documentElement
  root.style.removeProperty('--bg')
  root.style.removeProperty('--surface')
  root.style.removeProperty('--surface-2')
  root.style.removeProperty('--border')
  root.style.removeProperty('--border-soft')
  root.style.setProperty('--accent', dark ? DEFAULT_ACCENT : DEFAULT_ACCENT_DIM)
  root.style.setProperty('--accent-dim', DEFAULT_ACCENT_DIM)
  root.style.setProperty(
    '--accent-soft',
    dark ? 'rgba(169, 155, 255, 0.18)' : 'rgba(95, 68, 216, 0.14)'
  )
  root.style.setProperty('--accent-on', '#ffffff')
  root.style.setProperty('--sidebar-tint', dark ? DARK_SIDEBAR : LIGHT_SIDEBAR)
  root.dataset.themeApp = 'default'
  delete root.dataset.themeChrome
}

export function applySidebarDensity(density: 'comfortable' | 'compact'): void {
  document.documentElement.dataset.density = density
}

export function applySidebarWidth(widthPx: number): void {
  const w = Math.min(520, Math.max(220, Math.round(widthPx)))
  document.documentElement.style.setProperty('--sidebar-width', `${w}px`)
}
