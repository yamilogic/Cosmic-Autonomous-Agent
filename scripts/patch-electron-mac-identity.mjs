#!/usr/bin/env node
/**
 * macOS `npm run dev` runs Electron.app, so System Settings → Notifications
 * shows "Electron" + a gear icon. Copy our branding onto that helper bundle
 * so banners / Dock / Notifications match Orbit.
 *
 * Safe to re-run; skipped on non-macOS. Re-apply after `npm install` (postinstall).
 */
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') {
  process.exit(0)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronApp = join(root, 'node_modules/electron/dist/Electron.app')
const infoPlist = join(electronApp, 'Contents/Info.plist')
const electronIcns = join(electronApp, 'Contents/Resources/electron.icns')
const brandIcns = join(root, 'build/icon.icns')

const DISPLAY_NAME = 'Orbit'
const BUNDLE_ID = 'com.orbit.app'

if (!existsSync(infoPlist)) {
  console.warn('[patch-electron-mac-identity] Electron.app not found — skip')
  process.exit(0)
}

if (existsSync(brandIcns) && existsSync(electronIcns)) {
  copyFileSync(brandIcns, electronIcns)
}

function setPlist(key, value) {
  const r = spawnSync('/usr/bin/plutil', ['-replace', key, '-string', value, infoPlist], {
    encoding: 'utf8'
  })
  if (r.status !== 0) {
    console.warn(`[patch-electron-mac-identity] failed ${key}:`, r.stderr || r.stdout)
  }
}

setPlist('CFBundleDisplayName', DISPLAY_NAME)
setPlist('CFBundleName', DISPLAY_NAME)
setPlist('CFBundleIdentifier', BUNDLE_ID)

console.log(
  `[patch-electron-mac-identity] Electron.app → "${DISPLAY_NAME}" (${BUNDLE_ID}) + app icon`
)
