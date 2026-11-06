import { ipcMain, type IpcMainInvokeEvent } from 'electron'

/**
 * Thin wrapper so domain modules never import ipcMain directly for registration
 * beyond this helper — keeps IPC wiring consistent.
 */
export function handleInvoke<TPayload, TResult>(
  channel: string,
  handler: (payload: TPayload) => Promise<TResult> | TResult
): void {
  ipcMain.handle(channel, async (_event, payload: TPayload) => handler(payload))
}

/** Same as handleInvoke, for handlers that must reply only to the caller. */
export function handleInvokeWithEvent<TPayload, TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, payload: TPayload) => Promise<TResult> | TResult
): void {
  ipcMain.handle(channel, async (event, payload: TPayload) => handler(event, payload))
}
