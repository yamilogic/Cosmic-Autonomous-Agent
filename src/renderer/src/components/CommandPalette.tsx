import { useMemo, useState } from 'react'
import type { AppId, Profile } from '../../../shared/types'
import { APP_IDS, appLabel, profileDisplayLabel } from '../../../shared/types'

export type CommandItem = {
  id: string
  label: string
  hint?: string
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  profiles: Profile[]
  projects?: Array<{ id: string; name: string; clientName?: string }>
  onClose: () => void
  onSelectProfile: (profileId: string) => void
  onSelectApp: (profileId: string, appId: AppId) => void
  onOpenWorkspace: (profileId: string, appId: AppId, teamId: string) => void
  onOpenInSplit?: (profileId: string, appId: AppId) => void
  onSelectProject?: (projectId: string) => void
  onOpenSettings?: () => void
  onLockApp?: () => void
  onSyncAll?: () => void
  onOpenObserver?: () => void
}

export function CommandPalette({
  open,
  profiles,
  projects,
  onClose,
  onSelectProfile,
  onSelectApp,
  onOpenWorkspace,
  onOpenInSplit,
  onSelectProject,
  onOpenSettings,
  onLockApp,
  onSyncAll,
  onOpenObserver
}: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  const items = useMemo((): CommandItem[] => {
    if (!open) return []
    const q = query.trim().toLowerCase()
    const out: CommandItem[] = []
    const seenWs = new Set<string>()

    // Global quick action commands
    if (onOpenSettings) {
      out.push({
        id: 'cmd:settings',
        label: '⚙ Open Settings Hub',
        hint: 'Settings',
        run: onOpenSettings
      })
    }
    if (onOpenObserver) {
      out.push({
        id: 'cmd:observer',
        label: '🔭 Open Observer Mode',
        hint: 'Observer',
        run: onOpenObserver
      })
    }
    if (onSyncAll) {
      out.push({
        id: 'cmd:sync',
        label: '🔄 Sync All Projects',
        hint: 'Sync',
        run: onSyncAll
      })
    }
    if (onLockApp) {
      out.push({
        id: 'cmd:lock',
        label: '🔒 Lock App',
        hint: 'Lock',
        run: onLockApp
      })
    }

    // Projects index
    if (projects && onSelectProject) {
      for (const proj of projects) {
        const client = proj.clientName ? ` · ${proj.clientName}` : ''
        out.push({
          id: `proj:${proj.id}`,
          label: `📁 ${proj.name}${client}`,
          hint: 'Project',
          run: () => onSelectProject(proj.id)
        })
      }
    }

    // Profiles, apps & workspaces index
    for (const p of profiles) {
      const name = profileDisplayLabel(p)
      out.push({
        id: `p:${p.id}`,
        label: name,
        hint: 'Profile',
        run: () => onSelectProfile(p.id)
      })
      for (const appId of APP_IDS) {
        out.push({
          id: `a:${p.id}:${appId}`,
          label: `${name} · ${appLabel(appId)}`,
          hint: p.apps[appId].sessionStatus === 'signed-in' ? 'Open' : 'Sign in',
          run: () => onSelectApp(p.id, appId)
        })
        if (onOpenInSplit) {
          out.push({
            id: `split:${p.id}:${appId}`,
            label: `Open in split · ${name} · ${appLabel(appId)}`,
            hint: 'Split',
            run: () => onOpenInSplit(p.id, appId)
          })
        }
        const session = p.apps[appId]
        for (const ws of [...session.pinnedWorkspaces, ...session.availableWorkspaces]) {
          const wk = `${p.id}:${appId}:${ws.teamId}`
          if (seenWs.has(wk)) continue
          seenWs.add(wk)
          out.push({
            id: `w:${wk}`,
            label: `${name} · ${ws.teamName}`,
            hint: appLabel(appId),
            run: () => onOpenWorkspace(p.id, appId, ws.teamId)
          })
        }
      }
    }
    if (!q) return out.slice(0, 40)
    return out
      .filter((i) => i.label.toLowerCase().includes(q) || (i.hint ?? '').toLowerCase().includes(q))
      .slice(0, 40)
  }, [
    open,
    profiles,
    projects,
    query,
    onSelectProfile,
    onSelectApp,
    onOpenWorkspace,
    onOpenInSplit,
    onSelectProject,
    onOpenSettings,
    onLockApp,
    onSyncAll,
    onOpenObserver
  ])

  if (!open) return null

  const active = items[Math.min(index, Math.max(0, items.length - 1))]

  return (
    <div
      className="cmdk-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="cmdk"
        role="dialog"
        aria-label="Command palette"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIndex((i) => Math.min(i + 1, items.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIndex((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && active) {
            e.preventDefault()
            active.run()
            onClose()
          }
        }}
      >
        <input
          className="cmdk-input"
          autoFocus
          placeholder="Jump to project, profile, app, or action…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
        />
        <ul className="cmdk-list">
          {items.length === 0 ? (
            <li className="cmdk-empty">No matches</li>
          ) : (
            items.map((item, i) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`cmdk-item${i === index ? ' is-active' : ''}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => {
                    item.run()
                    onClose()
                  }}
                >
                  <span>{item.label}</span>
                  {item.hint ? <span className="cmdk-hint">{item.hint}</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="cmdk-footer">↑↓ navigate · Enter open · Esc close</p>
      </div>
    </div>
  )
}
