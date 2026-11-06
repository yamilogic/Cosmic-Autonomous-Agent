import { BrowserWindow } from 'electron'
import { handleInvoke } from './handle'
import {
  IpcChannels,
  type LogCategory,
  type LogEntry,
  type LogFilter,
  type LogLevel
} from '../../shared/ipc-contract'
import { log } from '../logging'

export function registerLogsIpc(): () => void {
  // Subscribe to logging engine and broadcast to active renderer windows
  const unsubscribe = log.subscribe((entry: LogEntry) => {
    try {
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannels.LogsOnEntry, entry)
        }
      }
    } catch {
      // Ignore broadcast errors during window close/destruction
    }
  })

  handleInvoke(IpcChannels.LogsGetRecent, async (payload: { filter?: LogFilter } | undefined) => {
    return log.getRecent(payload?.filter)
  })

  handleInvoke(IpcChannels.LogsSetRetention, async (payload: { minutes: number }) => {
    log.setRetention(payload?.minutes ?? 15)
  })

  handleInvoke(IpcChannels.LogsClear, async () => {
    log.clear()
  })

  handleInvoke(IpcChannels.LogsExport, async () => {
    return log.export()
  })

  handleInvoke(
    IpcChannels.LogsLogAction,
    async (payload: {
      category: LogCategory
      level: LogLevel
      message: string
      meta?: unknown
    }) => {
      log.action(payload.category, payload.level, payload.message, payload.meta)
    }
  )

  return unsubscribe
}

