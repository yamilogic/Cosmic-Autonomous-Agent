import { systemPreferences, type BrowserWindow } from 'electron'
import { APP_DISPLAY_NAME } from '../shared/brand'
import { IpcChannels } from '../shared/ipc-contract'
import type { AppSettingsStore } from './app-settings'
import { log } from './logging'

export { notifyUnreadIncrease } from './desktop-notify'

export class AppLockController {
  private locked = false
  private idleTimer: ReturnType<typeof setInterval> | null = null
  private lastActivity = Date.now()

  constructor(
    private readonly settingsStore: AppSettingsStore,
    private readonly getMainWindow: () => BrowserWindow | null,
    private readonly onLockChange: (locked: boolean) => void
  ) {}

  isLocked(): boolean {
    return this.locked
  }

  startIdleWatch(): void {
    if (this.idleTimer) return
    this.idleTimer = setInterval(() => {
      void this.tickIdle()
    }, 15_000)
  }

  stopIdleWatch(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
  }

  noteActivity(): void {
    this.lastActivity = Date.now()
  }

  async lock(): Promise<void> {
    if (this.locked) return
    this.locked = true
    this.emit()
    this.onLockChange(true)
  }

  async unlock(): Promise<boolean> {
    if (!this.locked) return true
    if (process.platform === 'darwin') {
      try {
        await systemPreferences.promptTouchID(`Unlock ${APP_DISPLAY_NAME}`)
      } catch (err) {
        log.warn('Touch ID unlock failed', { err: String(err) })
        try {
          await systemPreferences.promptTouchID(`Unlock ${APP_DISPLAY_NAME}`)
        } catch {
          return false
        }
      }
    }
    this.locked = false
    this.lastActivity = Date.now()
    this.emit()
    this.onLockChange(false)
    return true
  }

  private emit(): void {
    const win = this.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.AppLockStateChanged, this.locked)
    }
  }

  private async tickIdle(): Promise<void> {
    if (this.locked) return
    const settings = await this.settingsStore.get()
    const ms = Math.max(1, settings.idleLockMinutes) * 60_000
    if (Date.now() - this.lastActivity >= ms) {
      await this.lock()
    }
  }
}
