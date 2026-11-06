import { BrowserWindow } from 'electron'
import { handleInvoke } from './handle'
import { APP_DISPLAY_NAME } from '../../shared/brand'
import { IpcChannels, type AppSettings } from '../../shared/ipc-contract'
import type { AdminAuthController } from '../admin-auth'
import type { AppSettingsStore } from '../app-settings'
import { notifyUnreadIncrease, type AppLockController } from '../app-lock'
import { log } from '../logging'
import type { ProfileStore } from '../profiles/profile-store'

export function registerAppIpc(deps: {
  settingsStore: AppSettingsStore
  lock: AppLockController
  adminAuth: AdminAuthController
  profileStore: ProfileStore
  getMainWindow?: () => BrowserWindow | null
  onUserActivity?: () => void
  onAdminSessionChange?: (authenticated: boolean) => void
}): void {
  const broadcastSettings = (settings: AppSettings): void => {
    try {
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannels.AppSettingsChanged, settings)
        }
      }
    } catch (err) {
      log.warn('[app-ipc] failed to broadcast settings change', { err: String(err) })
    }
  }

  handleInvoke(IpcChannels.AppSettingsGet, async () => {
    const profiles = await deps.profileStore.list()
    return deps.settingsStore.pruneRecents(profiles.map((p) => p.id))
  })

  handleInvoke(IpcChannels.AppSettingsSet, async (patch: Partial<AppSettings>) => {
    const next = await deps.settingsStore.set(patch)
    broadcastSettings(next)
    return next
  })

  handleInvoke(
    IpcChannels.AppPushRecent,
    async (entry: { profileId: string; appId: string; teamId: string; label: string }) => {
      const next = await deps.settingsStore.pushRecent(entry)
      broadcastSettings(next)
      return next
    }
  )

  handleInvoke(IpcChannels.AppLock, async () => {
    await deps.lock.lock()
  })

  handleInvoke(IpcChannels.AppUnlock, async () => deps.lock.unlock())

  handleInvoke(IpcChannels.AppIdleActivity, async () => {
    deps.lock.noteActivity()
    deps.onUserActivity?.()
  })

  handleInvoke(IpcChannels.AppAdminStatus, async () => {
    await deps.adminAuth.ready()
    return deps.adminAuth.status()
  })

  handleInvoke(
    IpcChannels.AppAdminLogin,
    async (payload: { username: string; password: string; remember?: boolean }) => {
      const result = await deps.adminAuth.login(payload.username ?? '', payload.password ?? '', {
        remember: payload.remember !== false
      })
      if (result.ok) deps.onAdminSessionChange?.(true)
      return result
    }
  )

  handleInvoke(IpcChannels.AppAdminLogout, async () => {
    await deps.adminAuth.logout()
    deps.onAdminSessionChange?.(false)
  })

  handleInvoke(IpcChannels.AppCheckUpdates, async () => {
    const feed = process.env.UPDATE_FEED_URL?.trim()
    if (!feed) {
      return { ok: false, message: 'Updates disabled (set UPDATE_FEED_URL to enable).' }
    }
    try {
      const { autoUpdater } = await import('electron-updater')
      autoUpdater.setFeedURL({ provider: 'generic', url: feed })
      const result = await autoUpdater.checkForUpdates()
      return {
        ok: true,
        message: result?.updateInfo?.version
          ? `Update available: ${result.updateInfo.version}`
          : 'Checked for updates.'
      }
    } catch (err) {
      log.warn('update check failed', { err: String(err) })
      return { ok: false, message: String(err) }
    }
  })

  handleInvoke(IpcChannels.AppTestNotification, async () => {
    const settings = await deps.settingsStore.get()
    if (!settings.notificationsEnabled) {
      return {
        ok: false,
        message: 'Desktop notifications are disabled in Settings.'
      }
    }
    const result = await notifyUnreadIncrease({
      enabled: true,
      silent: !settings.notificationSound,
      title: APP_DISPLAY_NAME,
      subtitle: 'Test',
      body: 'New message preview — this is how Cosmic alerts look.',
      onClick: () => undefined
    })
    if (result.ok) {
      return {
        ok: true,
        message: 'Slack-style Cosmic banner should appear at the top-right.'
      }
    }
    return {
      ok: false,
      message: `Notification failed: ${result.error ?? 'unknown'}. Turn on Desktop notifications in Settings.`
    }
  })
}
