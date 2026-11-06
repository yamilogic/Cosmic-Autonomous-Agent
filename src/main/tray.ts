import { Menu, Tray, app, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import { join } from 'path'
import { APP_DISPLAY_NAME } from '../shared/brand'
import type { Profile } from '../shared/types'
import { log } from './logging'

export type TrayController = {
  update: (profiles: Profile[], unreadTotal: number) => void
  destroy: () => void
}

/** Menu-bar tray: black Orbit cat glyph with padding (matches status-icon scale). */
export function createTrayNativeImage(iconPath: string): NativeImage {
  const raw = nativeImage.createFromPath(iconPath)
  if (raw.isEmpty()) return nativeImage.createEmpty()

  if (process.platform === 'darwin') {
    const { width, height } = raw.getSize()
    const img =
      width > 32 || height > 32 ? raw.resize({ width: 32, height: 32, quality: 'best' }) : raw
    // Keep black (not macOS template white) so the cat stays black on the menu bar.
    img.setTemplateImage(false)
    return img
  }

  return raw.resize({ width: 16, height: 16, quality: 'best' })
}

export function createAppTray(options: {
  iconPath: string
  getMainWindow: () => BrowserWindow | null
  onSelectProfile: (profileId: string) => void
  onLock: () => void
}): TrayController {
  let tray: Tray | null = null
  let lastProfileSig = ''
  let lastUnreadTotal = -1

  try {
    const img = createTrayNativeImage(options.iconPath)
    if (img.isEmpty()) {
      log.warn('tray icon empty', { path: options.iconPath })
    }
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img)
    tray.setToolTip(APP_DISPLAY_NAME)
    tray.setIgnoreDoubleClickEvents(true)
    tray.on('click', () => {
      const win = options.getMainWindow()
      if (!win || win.isDestroyed()) return
      if (win.isVisible()) {
        win.focus()
      } else {
        win.show()
        win.focus()
      }
    })
  } catch (err) {
    log.warn('tray create failed', { err: String(err) })
    return {
      update: () => undefined,
      destroy: () => undefined
    }
  }

  const rebuildMenu = (profiles: Profile[]): void => {
    if (!tray) return
    const profileItems = profiles.slice(0, 12).map((p) => ({
      label: p.displayName,
      click: () => {
        options.onSelectProfile(p.id)
        const win = options.getMainWindow()
        if (win && !win.isDestroyed()) {
          win.show()
          win.focus()
        }
      }
    }))
    const menu = Menu.buildFromTemplate([
      {
        label: `Show ${APP_DISPLAY_NAME}`,
        click: () => {
          const win = options.getMainWindow()
          if (win && !win.isDestroyed()) {
            win.show()
            win.focus()
          }
        }
      },
      { type: 'separator' },
      ...(profileItems.length
        ? ([
            { label: 'Profiles', enabled: false },
            ...profileItems
          ] as Electron.MenuItemConstructorOptions[])
        : [{ label: 'No profiles', enabled: false }]),
      { type: 'separator' },
      { label: 'Lock', click: () => options.onLock() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
    tray.setContextMenu(menu)
  }

  const applyBadge = (unreadTotal: number): void => {
    if (!tray) return
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setBadge(unreadTotal > 0 ? (unreadTotal > 99 ? '99+' : String(unreadTotal)) : '')
    }
    tray.setToolTip(
      unreadTotal > 0 ? `${APP_DISPLAY_NAME} (${unreadTotal} unread)` : APP_DISPLAY_NAME
    )
  }

  rebuildMenu([])
  applyBadge(0)

  return {
    update: (profiles, unreadTotal) => {
      const sig = profiles.map((p) => `${p.id}:${p.displayName}:${p.muted ? 1 : 0}`).join('|')
      if (sig !== lastProfileSig) {
        lastProfileSig = sig
        rebuildMenu(profiles)
      }
      if (unreadTotal !== lastUnreadTotal) {
        lastUnreadTotal = unreadTotal
        applyBadge(unreadTotal)
      }
    },
    destroy: () => {
      tray?.destroy()
      tray = null
    }
  }
}

export function resolveTrayIconPath(resourcesDir: string): string {
  return join(resourcesDir, 'trayIcon.png')
}
