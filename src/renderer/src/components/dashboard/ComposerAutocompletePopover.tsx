import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectSource, ProjectSourceChannel } from '../../../../shared/dashboard-contract'

export interface AutocompleteItem {
  id: string
  label: string
  sublabel?: string
  badge?: string
  badgeColor?: string
  icon: string
  insertText: string
  category: 'account' | 'channel' | 'command' | 'persona'
}

interface ComposerAutocompletePopoverProps {
  trigger: '@' | '#' | '/' | null
  query: string
  sources?: ProjectSource[]
  channels?: ProjectSourceChannel[]
  isScoped?: boolean
  onSelect: (item: AutocompleteItem) => void
  onClose: () => void
}

export default function ComposerAutocompletePopover({
  trigger,
  query,
  sources = [],
  channels = [],
  isScoped = false,
  onSelect,
  onClose
}: ComposerAutocompletePopoverProps): React.JSX.Element | null {
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo<AutocompleteItem[]>(() => {
    const q = (query || '').toLowerCase().trim()

    if (trigger === '@') {
      // 1. Account / Session mentions
      const accounts: AutocompleteItem[] = []
      const seen = new Set<string>()

      for (const s of sources) {
        if (s.enabled === false) continue
        if (s.role === 'ours') continue
        const plat = (s.platform || 'slack').toLowerCase()
        const rawName = s.workspaceName?.trim() || plat
        const key = `${plat}:${rawName}`
        if (seen.has(key)) continue
        seen.add(key)

        const cleanToken = rawName.replace(/[^a-zA-Z0-9_-]/g, '') || plat
        const platBadge = plat.toUpperCase()
        const badgeColor =
          plat === 'teams' ? '#3b82f6' : plat === 'whatsapp' ? '#22c55e' : plat === 'discord' ? '#5865f2' : '#a855f7'

        accounts.push({
          id: s.id,
          label: `@${cleanToken}`,
          sublabel: `${platBadge} Session · ${s.channels?.length || 0} channels`,
          badge: platBadge,
          badgeColor,
          icon: plat === 'teams' ? '👥' : plat === 'whatsapp' ? '📱' : plat === 'discord' ? '🎮' : '⚡',
          insertText: `@${cleanToken} `,
          category: 'account'
        })
      }

      if (!q) return accounts
      return accounts.filter(
        (a) => a.label.toLowerCase().includes(q) || (a.sublabel && a.sublabel.toLowerCase().includes(q))
      )
    }

    if (trigger === '#') {
      // 2. Channel & Contact mentions
      const chanItems: AutocompleteItem[] = []
      for (const ch of channels) {
        if (ch.enabled === false) continue
        const isDm = Boolean(
          ch.isDm || ch.kind === 'dm' || ch.name.startsWith('@') || ch.name.toLowerCase().includes('you')
        )
        const cleanName = ch.name.replace(/^[#@]+/, '').replace(/\s*\(?you\)?$/i, '').trim() || 'channel'
        const symbol = isDm ? '@' : '#'

        chanItems.push({
          id: ch.id,
          label: `${symbol}${cleanName}`,
          sublabel: isDm
            ? `Direct Message · ${ch.agentWrite ? 'Write Authorized' : 'Read Monitored'}`
            : `${ch.isPrivate ? 'Private' : 'Public'} Channel · ${ch.agentWrite ? 'Write Authorized' : 'Read Monitored'}`,
          badge: ch.agentWrite ? 'WRITE' : 'READ',
          badgeColor: ch.agentWrite ? '#22c55e' : '#64748b',
          icon: isDm ? '👤' : ch.isPrivate ? '🔒' : '#',
          insertText: `#${cleanName} `,
          category: 'channel'
        })
      }

      if (!q) return chanItems
      return chanItems.filter(
        (c) => c.label.toLowerCase().includes(q) || (c.sublabel && c.sublabel.toLowerCase().includes(q))
      )
    }

    if (trigger === '/') {
      // 3. Slash Commands
      const commands: AutocompleteItem[] = [
        {
          id: 'cmd-send',
          label: '/send',
          sublabel: 'Send exact verbatim text after colon: /send @slack #channel : <message>',
          badge: 'DIRECT DISPATCH',
          badgeColor: '#22c55e',
          icon: '🚀',
          insertText: '/send : ',
          category: 'command'
        },
        {
          id: 'cmd-ai-ans',
          label: '/ai-ans',
          sublabel: 'Draft grounded AI answer with persona: /ai-ans #channel [friendly] : <instruction>',
          badge: 'RAG COPILOT',
          badgeColor: '#a855f7',
          icon: '🤖',
          insertText: '/ai-ans [professional] : ',
          category: 'command'
        },
        {
          id: 'cmd-help',
          label: '/help',
          sublabel: 'Show interactive cheatsheet of all accounts, channels, and commands',
          badge: 'HELP',
          badgeColor: '#3b82f6',
          icon: '💡',
          insertText: '/help',
          category: 'command'
        },
        {
          id: 'cmd-help-slack',
          label: '/help-slack',
          sublabel: 'Show Slack workspace status, tokens, write permissions, and scrapers',
          badge: 'SLACK GUIDE',
          badgeColor: '#c084fc',
          icon: '⚡',
          insertText: '/help-slack',
          category: 'command'
        },
        {
          id: 'cmd-scrape',
          label: '/scrape',
          sublabel: 'Trigger immediate background scrape & sync across watched channels',
          badge: 'SYNC',
          badgeColor: '#f59e0b',
          icon: '🔄',
          insertText: '/scrape',
          category: 'command'
        },
        {
          id: 'cmd-status',
          label: '/status',
          sublabel: 'Check active token status, monitored channels, and rate limits',
          badge: 'STATUS',
          badgeColor: '#64748b',
          icon: '📊',
          insertText: '/status',
          category: 'command'
        }
      ]

      if (!q) return commands
      return commands.filter(
        (cmd) => cmd.label.toLowerCase().includes(q) || (cmd.sublabel && cmd.sublabel.toLowerCase().includes(q))
      )
    }

    return []
  }, [trigger, query, sources, channels])

  // Reset selected index when items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [items.length, trigger])

  // Keyboard navigation listener on window
  useEffect(() => {
    if (!trigger || items.length === 0) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((prev) => (prev + 1) % items.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        if (items[selectedIndex]) {
          onSelect(items[selectedIndex])
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [trigger, items, selectedIndex, onSelect, onClose])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const selectedEl = listRef.current.children[selectedIndex] as HTMLElement | undefined
    if (selectedEl && typeof selectedEl.scrollIntoView === 'function') {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (!trigger || items.length === 0) return null

  return (
    <div
      className="composer-autocomplete-popover"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        left: 12,
        right: 12,
        maxHeight: 240,
        overflowY: 'auto',
        background: 'rgba(15, 23, 42, 0.96)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(168, 85, 247, 0.35)',
        borderRadius: 8,
        boxShadow: '0 12px 30px rgba(0, 0, 0, 0.65), 0 0 1px rgba(255, 255, 255, 0.2)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        padding: 4
      }}
      ref={listRef}
      role="listbox"
      aria-label="Autocomplete Suggestions"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px 6px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          fontSize: 10,
          fontWeight: 700,
          color: '#94a3b8',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}
      >
        <span>
          {trigger === '@'
            ? isScoped
              ? 'Workspace Accounts'
              : 'Mention Account / Session'
            : trigger === '#'
              ? 'Mention Channel / Contact'
              : 'Slash Commands'}
        </span>
        <span style={{ fontSize: 9, color: '#64748b' }}>↑↓ navigate · ↵ select · esc close</span>
      </div>

      {items.map((item, index) => {
        const isSelected = index === selectedIndex
        return (
          <div
            key={item.id}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(item)}
            onMouseEnter={() => setSelectedIndex(index)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 6,
              background: isSelected ? 'rgba(168, 85, 247, 0.22)' : 'transparent',
              border: isSelected ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid transparent',
              cursor: 'pointer',
              transition: 'background 0.1s ease',
              marginTop: 2
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 4,
                background: 'rgba(255, 255, 255, 0.06)',
                fontSize: 12,
                flexShrink: 0
              }}
            >
              {item.icon}
            </span>

            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    color: isSelected ? '#f1f5f9' : '#e2e8f0',
                    fontSize: 12,
                    fontWeight: 650
                  }}
                >
                  {item.label}
                </span>
                {item.badge && (
                  <span
                    style={{
                      fontSize: 8.5,
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: 3,
                      background: item.badgeColor ? `${item.badgeColor}22` : 'rgba(255,255,255,0.1)',
                      color: item.badgeColor || '#94a3b8',
                      border: `1px solid ${item.badgeColor || '#94a3b8'}44`
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </div>
              {item.sublabel && (
                <span
                  style={{
                    color: '#94a3b8',
                    fontSize: 10.5,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {item.sublabel}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
