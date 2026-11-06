/**
 * Dev helper: read what the dashboard currently renders (snapshot + Recent
 * strip + digest) over the Chrome DevTools Protocol.
 */
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

const out = await evaluate(`(async () => {
  const snapshot = await window.api.dashboard.getSnapshot()
  const recent = await window.api.dashboard.getRecent()
  return {
    digest: snapshot.digest,
    recent: recent.map((r) => ({
      project: r.projectName,
      workspace: r.teamName,
      status: r.status,
      score: Math.round(r.score),
      needsReply: r.needsReply,
      kind: r.kind,
      oneLine: r.oneLine,
      delta: r.delta || null,
      channel: r.channelName
    })),
    cards: snapshot.projects.map((p) => ({
      project: p.project.name,
      workspace: p.project.teamName,
      teamId: p.project.teamId,
      channels: p.project.monitors.length,
      status: p.insight?.status ?? null,
      source: p.insightSource ?? null,
      progress: p.insight?.progress ?? p.completion,
      needsReply: p.insight?.clientAsk?.needsReply ?? false,
      situation: p.insight?.situationLine ?? p.summary,
      recentLine: p.insight?.recentLine ?? null,
      nextStep: p.insight?.nextStep ?? null,
      clientMessage: p.insight?.clientAsk?.lastClientMessage ?? null,
      openQuestions: p.insight?.clientAsk?.openQuestions ?? [],
      highlights: (p.insight?.highlights ?? []).map((h) => h.what),
      blockers: (p.insight?.blockers ?? []).map((b) => b.what),
      keywords: p.insight?.keywords ?? [],
      updatedAt: p.insightUpdatedAt
    }))
  }
})()`)

console.log(JSON.stringify(out, null, 2))
ws.close()
