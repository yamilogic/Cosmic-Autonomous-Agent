#!/usr/bin/env node
/**
 * Electron 42+ uses UNNotification on macOS, which rejects unsigned /
 * linker-signed apps (notifications emit `failed` silently).
 * Ad-hoc deep-sign after packaging so local Orbit builds can show banners.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

if (process.platform !== 'darwin') process.exit(0)

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

function findApps(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name.endsWith('.app')) out.push(p)
    else if (!name.includes('.') || name.startsWith('mac')) {
      try {
        findApps(p, out)
      } catch {
        /* ignore */
      }
    }
  }
  return out
}

const apps = findApps(dist).filter((p) => /Orbit\.app$|Workspace Dashboard\.app$/.test(p))
if (apps.length === 0) {
  console.warn('[codesign-mac-app] no Orbit.app found under dist/')
  process.exit(0)
}

for (const app of apps) {
  spawnSync('xattr', ['-cr', app], { stdio: 'inherit' })
  const r = spawnSync('codesign', ['--force', '--deep', '--sign', '-', app], {
    encoding: 'utf8'
  })
  if (r.status !== 0) {
    console.error('[codesign-mac-app] failed:', app, r.stderr || r.stdout)
    process.exit(r.status ?? 1)
  }
  const check = spawnSync('codesign', ['-dv', '--verbose=2', app], { encoding: 'utf8' })
  const detail = `${check.stderr || ''}${check.stdout || ''}`
  if (detail.includes('linker-signed')) {
    console.warn('[codesign-mac-app] still linker-signed (notifications may fail):', app)
  } else {
    console.log('[codesign-mac-app] signed (adhoc):', app)
  }
}
