/**
 * Local loopback server for browser-based auth callbacks (Google’s recommended pattern).
 * Google/Slack password entry stays in real Chrome; success hits 127.0.0.1 and notifies Electron.
 */
import { createServer, type Server } from 'node:http'
import { APP_DISPLAY_NAME } from '../../shared/brand'
import { log } from '../logging'

export type LoopbackPath = '/google-done' | '/slack-done'

export interface LoopbackAuthServer {
  port: number
  /** Resolves when the browser hits the success path. */
  done: Promise<'done'>
  close: () => void
  successUrl: string
}

function successHtml(kind: 'google' | 'slack'): string {
  const title = kind === 'google' ? 'Google sign-in successful' : 'Slack sign-in successful'
  const body =
    kind === 'google'
      ? `Return to ${APP_DISPLAY_NAME} and choose Slack, Teams, or WhatsApp.`
      : `Return to ${APP_DISPLAY_NAME} — Slack will embed in the app.`
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f1410; color: #e8eaed;
    display: grid; place-items: center; min-height: 100vh; margin: 0; }
  main { text-align: center; max-width: 28rem; padding: 2rem; }
  h1 { color: #7ddea3; font-size: 1.35rem; }
  p { color: #c4c7ce; line-height: 1.45; }
</style></head>
<body><main><h1>${title}</h1><p>${body}</p>
<p style="color:#8b909a;font-size:0.9rem">You can close this tab.</p></main></body></html>`
}

export function startLoopbackAuthServer(path: LoopbackPath): Promise<LoopbackAuthServer> {
  return new Promise((resolve, reject) => {
    let settled = false
    let doneResolve: ((v: 'done') => void) | null = null
    const done = new Promise<'done'>((r) => {
      doneResolve = r
    })

    const server: Server = createServer((req, res) => {
      const url = req.url ?? ''
      const pathname = url.split('?')[0]
      if (pathname === path || pathname === `${path}/`) {
        const kind = path.includes('google') ? 'google' : 'slack'
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(successHtml(kind))
        if (!settled) {
          settled = true
          log.info('loopback auth callback received', { path })
          doneResolve?.('done')
        }
        return
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Could not bind loopback auth server'))
        return
      }
      const { port } = addr
      const successUrl = `http://127.0.0.1:${port}${path}`
      log.info('loopback auth server listening', { port, path })
      resolve({
        port,
        done,
        successUrl,
        close: () => {
          try {
            server.close()
          } catch {
            /* ignore */
          }
        }
      })
    })

    server.on('error', reject)
  })
}
