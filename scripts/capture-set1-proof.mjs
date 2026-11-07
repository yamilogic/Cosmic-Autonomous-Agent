import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function capture() {
  const screenshotsDir = '/home/lap-19/Desktop/Company-Project-dashboard/slack-dashboard-main/.omc/screenshots/settings'
  await mkdir(screenshotsDir, { recursive: true })

  const cdpPort = 9298
  const electronEnv = { ...process.env }
  delete electronEnv.ELECTRON_RUN_AS_NODE

  const electronProcess = spawn(
    'xvfb-run',
    [
      '-a',
      '-s',
      '-screen 0 1600x1200x24',
      'node_modules/electron/dist/electron',
      '.',
      `--remote-debugging-port=${cdpPort}`,
      '--no-sandbox',
      '--disable-gpu',
      '--ozone-platform=x11',
      '--user-data-dir=/tmp/orbit-capture-data'
    ],
    {
      cwd: '/home/lap-19/Desktop/Company-Project-dashboard/slack-dashboard-main',
      env: electronEnv
    }
  )

  await sleep(2500)
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
  const versionData = await res.json()
  const browserWs = new WebSocket(versionData.webSocketDebuggerUrl)
  await new Promise(r => { browserWs.onopen = r })

  let id = 1
  function bsend(method, params = {}) {
    return new Promise(resolve => {
      const curId = id++
      const handler = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.id === curId) {
          browserWs.removeEventListener('message', handler)
          resolve(msg)
        }
      }
      browserWs.addEventListener('message', handler)
      browserWs.send(JSON.stringify({ id: curId, method, params }))
    })
  }

  await bsend('Target.setDiscoverTargets', { discover: true })
  await sleep(2000)

  const targetsRes = await bsend('Target.getTargets')
  const page = targetsRes.result.targetInfos.find(t => t.type === 'page' || t.url.includes('index.html'))
  const sessionId = (await bsend('Target.attachToTarget', { targetId: page.targetId, flatten: true })).result.sessionId

  function psend(method, params = {}) {
    return new Promise(resolve => {
      const curId = id++
      const handler = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.id === curId) {
          browserWs.removeEventListener('message', handler)
          resolve(msg)
        }
      }
      browserWs.addEventListener('message', handler)
      browserWs.send(JSON.stringify({ id: curId, method, params, sessionId }))
    })
  }

  await psend('Page.enable')
  await psend('Runtime.enable')
  await sleep(2000)

  console.log('Opening Card Settings...')
  await psend('Runtime.evaluate', {
    expression: `(async function() {
      const dRail = document.querySelector('[data-testid="dashboard-toggle"]');
      if (dRail) dRail.click();
      await new Promise(r => setTimeout(r, 500));
      const sub = document.querySelector('[data-testid="dashboard-app-slack"]');
      if (sub) sub.click();
      await new Promise(r => setTimeout(r, 2000));

      const firstCard = document.querySelector('.proj-row');
      const moreBtn = firstCard ? firstCard.querySelector('.proj-more') : null;
      if (moreBtn) moreBtn.click();
      await new Promise(r => setTimeout(r, 500));

      const menuBtns = Array.from(document.querySelectorAll('.dash-menu button'));
      const sBtn = menuBtns.find(b => b.innerText && b.innerText.includes('Project settings'));
      if (sBtn) sBtn.click();
      await new Promise(r => setTimeout(r, 2000));
    })()`,
    awaitPromise: true,
    returnByValue: true
  })

  // Set 1280px width
  await psend('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  })
  await sleep(1500)

  // Capture after-settings-1280.png
  const shot1280 = await psend('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(screenshotsDir, 'after-settings-1280.png'), Buffer.from(shot1280.result.data, 'base64'))
  console.log('Saved after-settings-1280.png!')

  // Set 900px width
  await psend('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  })
  await sleep(1500)

  // Capture after-settings-900.png
  const shot900 = await psend('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(screenshotsDir, 'after-settings-900.png'), Buffer.from(shot900.result.data, 'base64'))
  console.log('Saved after-settings-900.png!')

  // Switch to Channels tab and capture
  await psend('Runtime.evaluate', {
    expression: `(function() {
      const btn = document.querySelector('[data-testid="tab-channels"]');
      if (btn) btn.click();
    })()`
  })
  await sleep(1000)
  const shotChannels = await psend('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(screenshotsDir, 'after-settings-channels.png'), Buffer.from(shotChannels.result.data, 'base64'))
  console.log('Saved after-settings-channels.png!')

  // Switch to Schedule tab and capture
  await psend('Runtime.evaluate', {
    expression: `(function() {
      const btn = document.querySelector('[data-testid="tab-schedule"]');
      if (btn) btn.click();
    })()`
  })
  await sleep(1000)
  const shotSchedule = await psend('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(screenshotsDir, 'after-settings-schedule.png'), Buffer.from(shotSchedule.result.data, 'base64'))
  console.log('Saved after-settings-schedule.png!')

  // Select all text to test selection contrast
  await psend('Runtime.evaluate', {
    expression: `(function() {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('.ws-settings') || document.body);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    })()`
  })
  await sleep(1000)
  const shotSelectAll = await psend('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(screenshotsDir, 'after-settings-selectall.png'), Buffer.from(shotSelectAll.result.data, 'base64'))
  console.log('Saved after-settings-selectall.png!')

  browserWs.close()
  electronProcess.kill('SIGINT')
  await sleep(1000)
  try { electronProcess.kill('SIGKILL') } catch {}
  console.log('Phase 1 capture completed successfully!')
}

capture().then(() => process.exit(0)).catch(e => {
  console.error(e)
  process.exit(1)
})

