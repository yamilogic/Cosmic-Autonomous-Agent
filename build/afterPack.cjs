/**
 * electron-builder afterPack — ad-hoc sign before zip/dmg so UNNotification works on macOS.
 * @param {import('electron-builder').AfterPackContext} context
 */
const { spawnSync } = require('child_process')
const { join } = require('path')
const fs = require('fs')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'linux') {
    const cosmicBin = join(context.appOutDir, 'Cosmic')
    const slackBin = join(context.appOutDir, 'slack-dashboard')
    if (fs.existsSync(cosmicBin) && !fs.existsSync(slackBin)) {
      try {
        fs.symlinkSync('Cosmic', slackBin)
        console.log(`[afterPack] Created compatibility symlink: ${slackBin} -> Cosmic`)
      } catch (err) {
        console.warn(`[afterPack] Could not create symlink: ${err.message}`)
      }
    }
    return
  }

  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = join(context.appOutDir, `${appName}.app`)

  spawnSync('xattr', ['-cr', appPath], { stdio: 'inherit' })
  const r = spawnSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    encoding: 'utf8'
  })
  if (r.status !== 0) {
    throw new Error(`afterPack codesign failed: ${r.stderr || r.stdout}`)
  }
  console.log(`[afterPack] ad-hoc signed ${appPath}`)
}
