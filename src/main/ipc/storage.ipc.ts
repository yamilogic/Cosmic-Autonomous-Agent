import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc-contract'
import type { CleanStoragePayload } from '../../shared/ipc-contract'
import type { StorageCleanerService } from '../storage/storage-cleaner'

export function registerStorageIpc(cleaner: StorageCleanerService): void {
  ipcMain.handle(IpcChannels.StorageGetSummary, async () => {
    return cleaner.getStorageSummary()
  })

  ipcMain.handle(IpcChannels.StorageClean, async (_event, payload: CleanStoragePayload) => {
    return cleaner.cleanStorage(payload)
  })
}

