import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function run() {
  const cdpPort = 9299
  const electronEnv = { ...process.env }
  delete electronEnv.ELECTRON_RUN_AS_NODE

  const p = spawn('xvfb-run', [
    '-a', '-s', '-screen 0 1600x1200x24',
    'node_modules/electron/dist/electron', '.',
    `--remote-debugging-port=${cdpPort}`,
    '--no-sandbox', '--disable-gpu', '--ozone-platform=x11',
    '--user-data-dir=/tmp/orbit-app-data'
  ], { cwd: '/home/lap-19/Desktop/Company-Project-dashboard/slack-dashboard-main', env: electronEnv })

  await sleep(3000)
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
  const v = await res.json()
  const ws = new WebSocket(v.webSocketDebuggerUrl)
  await new Promise(r => ws.onopen = r)
  let id = 1
  const send = (method, params = {}) => new Promise(resolve => {
    const curId = id++
    const h = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === curId) { ws.removeEventListener('message', h); resolve(m) }
    }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id: curId, method, params }))
  })

  await send('Target.setDiscoverTargets', { discover: true })
  await sleep(2000)
  const targets = (await send('Target.getTargets')).result.targetInfos
  const page = targets.find(t => t.type === 'page' || t.url.includes('index.html'))
  const sid = (await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).result.sessionId
  const psend = (method, params = {}) => new Promise(resolve => {
    const curId = id++
    const h = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === curId) { ws.removeEventListener('message', h); resolve(m) }
    }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id: curId, method, params, sessionId: sid }))
  })

  await psend('Page.enable')
  await psend('Runtime.enable')
  await psend('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(2000)

  await psend('Runtime.evaluate', {
    expression: `
      (async () => {
        const gotIt = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Got it'));
        if (gotIt) gotIt.click();
        await new Promise(r => setTimeout(r, 400));

        const dToggle = document.querySelector('.dash-rail-toggle, [data-testid="dashboard-toggle"]');
        if (dToggle) dToggle.click();
        await new Promise(r => setTimeout(r, 500));

        const proj = document.querySelector('[data-testid="dashboard-app-slack"], .dash-rail-subitem');
        if (proj) proj.click();
        await new Promise(r => setTimeout(r, 1200));

        const expBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Expanded');
        if (expBtn) expBtn.click();
        await new Promise(r => setTimeout(r, 1000));

        const s = Array.from(document.querySelectorAll('.ws-nav-fixed, .ws-nav-item, button')).find(el => el.textContent.trim() === 'Settings' && el.closest('.ws-shell, .ws-nav'));
        if (s) s.click();
        await new Promise(r => setTimeout(r, 1000));

        const sbtab = document.querySelector('[data-testid="tab-sidebar"]');
        if (sbtab) sbtab.click();
      })()
    `,
    awaitPromise: true
  })

  await sleep(1500)
  const shot = await psend('Page.captureScreenshot', { format: 'png' })
  await writeFile('/home/lap-19/.gemini/antigravity/brain/0bfe1bb7-5e79-4df1-8b61-699269212d3a/live_proper_expanded.png', Buffer.from(shot.result.data, 'base64'))
  console.log('Saved live_proper_expanded.png')
  p.kill()
  process.exit(0)
}
run()
