/**
 * Dev helper: drive the running dashboard renderer over the Chrome DevTools
 * Protocol to exercise the real IPC path (validate token → list channels →
 * create card → sync). Nothing here bypasses the app: it calls the same
 * window.api.dashboard.* functions the wizard calls.
 *
 * Usage: node scripts/dev-add-workspace.mjs <vaultKey> <token> <projectName>
 */
import { readFileSync } from 'node:fs'

const [vaultKey, token, projectName] = process.argv.slice(2)
if (!vaultKey || !token || !projectName) {
  console.error('usage: node scripts/dev-add-workspace.mjs <vaultKey> <token> <projectName>')
  process.exit(1)
}

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('no renderer page found')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

function evaluate(expression) {
  const callId = ++id
  return new Promise((resolve, reject) => {
    pending.set(callId, (msg) => {
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else if (msg.result?.exceptionDetails) {
        reject(new Error(msg.result.exceptionDetails.exception?.description ?? 'exception'))
      } else resolve(msg.result?.result?.value)
    })
    ws.send(
      JSON.stringify({
        id: callId,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true }
      })
    )
  })
}

const script = `(async () => {
  const key = ${JSON.stringify(vaultKey)}
  const token = ${JSON.stringify(token)}
  const name = ${JSON.stringify(projectName)}

  // 1) validate + store the connector in the encrypted vault (wizard step 2)
  const validation = await window.api.dashboard.validateManualToken({ key, token })
  if (!validation.valid) return { step: 'validate', ok: false, validation }

  // 2) list the channels of THAT workspace only (wizard step 3)
  const channels = await window.api.dashboard.listChannels({
    tokenSource: 'manual',
    manualTokenKey: key
  })

  // 3) create the card, bound to that one workspace (wizard step 4)
  const snapshot = await window.api.dashboard.upsertProject({
    project: {
      name,
      clientName: validation.teamName ?? name,
      profileId: 'manual:' + key,
      teamId: validation.teamId,
      teamName: validation.teamName,
      selfUserId: validation.userId,
      appId: 'slack',
      tokenSource: 'manual',
      manualTokenKey: key,
      monitors: channels.map((c) => ({ channelId: c.id, channelName: c.name }))
    }
  })

  const card = snapshot.projects.find((p) => p.project.name === name)

  // 4) first sync (wizard step 5)
  if (card) await window.api.dashboard.syncNow({ projectId: card.project.id })

  return {
    step: 'done',
    ok: true,
    team: { teamId: validation.teamId, teamName: validation.teamName, user: validation.userName },
    channels: channels.map((c) => c.name),
    cards: snapshot.projects.map((p) => ({
      name: p.project.name,
      teamName: p.project.teamName,
      teamId: p.project.teamId,
      channels: p.project.monitors.length
    }))
  }
})()`

const result = await evaluate(script)
console.log(JSON.stringify(result, null, 2))
ws.close()
