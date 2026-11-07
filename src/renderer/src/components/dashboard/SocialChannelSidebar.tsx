import React, { useState, useMemo, useRef, useCallback } from 'react'
import type { ProjectSource, ProjectSourceChannel } from '../../../../shared/dashboard-contract'

export interface SocialChannelSidebarProps {
  source: ProjectSource
  activeChannelId: string | null
  onSelectChannel: (channelId: string | null) => void
}

const STORAGE_WIDTH_KEY = 'cosmic:social-sidebar-width'
const STORAGE_COLLAPSED_KEY = 'cosmic:social-sidebar-collapsed'
const MIN_WIDTH = 180
const MAX_WIDTH = 380
const DEFAULT_WIDTH = 240

export default function SocialChannelSidebar({
  source,
  activeChannelId,
  onSelectChannel
}: SocialChannelSidebarProps): React.JSX.Element {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_COLLAPSED_KEY) === 'true'
    } catch {
      return false
    }
  })

  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_WIDTH_KEY))
      if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) return saved
    } catch {
      // fallback
    }
    return DEFAULT_WIDTH
  })

  const [filterQuery, setFilterQuery] = useState('')
  const resizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(width)

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_COLLAPSED_KEY, String(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  const startResizing = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      resizingRef.current = true
      startXRef.current = e.clientX
      startWidthRef.current = width

      const onMouseMove = (moveEvent: MouseEvent): void => {
        if (!resizingRef.current) return
        const delta = moveEvent.clientX - startXRef.current
        const nextWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta))
        setWidth(nextWidth)
      }

      const onMouseUp = (): void => {
        resizingRef.current = false
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        try {
          localStorage.setItem(STORAGE_WIDTH_KEY, String(width))
        } catch {
          // ignore
        }
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [width]
  )

  const allChannels = useMemo(() => {
    return (source.channels ?? []).filter((ch) => ch.enabled !== false)
  }, [source.channels])

  const filteredChannels = useMemo(() => {
    if (!filterQuery.trim()) return allChannels
    const q = filterQuery.trim().toLowerCase()
    return allChannels.filter((ch) => ch.name.toLowerCase().includes(q))
  }, [allChannels, filterQuery])

  const isDmChannel = (c: ProjectSourceChannel): boolean =>
    Boolean(
      c.isDm ||
        c.kind === 'dm' ||
        c.name.startsWith('@') ||
        c.name.startsWith('#@') ||
        c.name.toLowerCase().includes('you')
    )

  const publicChannels = useMemo(() => {
    return filteredChannels.filter((c) => !c.isPrivate && c.kind !== 'private' && !isDmChannel(c))
  }, [filteredChannels])

  const privateChannels = useMemo(() => {
    return filteredChannels.filter((c) => (c.isPrivate || c.kind === 'private') && !isDmChannel(c))
  }, [filteredChannels])

  const dmChannels = useMemo(() => {
    return filteredChannels.filter(isDmChannel)
  }, [filteredChannels])

  const platform = (source.platform || 'slack').toLowerCase()
  const workspaceTitle = source.workspaceName || (platform === 'teams' ? 'Teams' : platform === 'whatsapp' ? 'WhatsApp' : 'Slack')

  // Render collapsed compact icon bar (48px)
  if (isCollapsed) {
    return (
      <aside
        className="social-inner-sidebar-collapsed"
        style={{
          width: 48,
          minWidth: 48,
          background: 'rgba(15, 23, 42, 0.45)',
          borderRight: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '10px 4px',
          gap: 6,
          userSelect: 'none',
          zIndex: 10
        }}
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Expand Channels Sidebar"
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 6,
            color: '#94a3b8',
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            marginBottom: 8
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* All Channels Icon Button */}
        <button
          type="button"
          onClick={() => onSelectChannel(null)}
          title={`All ${workspaceTitle} Channels (Workspace Overview)`}
          style={{
            width: 36,
            height: 32,
            borderRadius: 6,
            border: 'none',
            background: activeChannelId === null ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
            color: activeChannelId === null ? '#a5b4fc' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: 12
          }}
        >
          ⚡
        </button>

        <div style={{ width: '80%', height: 1, background: 'rgba(255, 255, 255, 0.06)', margin: '4px 0' }} />

        {/* Compact list of active channels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', alignItems: 'center', overflowY: 'auto' }}>
          {allChannels.slice(0, 15).map((ch) => {
            const isSelected = activeChannelId === ch.id
            const isDm = ch.isDm || ch.kind === 'dm' || ch.name.startsWith('@')
            const isPriv = ch.isPrivate || ch.kind === 'private'
            const symbol = isDm ? '👤' : isPriv ? '🔒' : '#'

            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => onSelectChannel(ch.id)}
                title={`${symbol} ${ch.name}${ch.agentWrite ? ' (Write Authorized)' : ' (Read Monitored)'}`}
                style={{
                  width: 34,
                  height: 30,
                  borderRadius: 6,
                  border: isSelected ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid transparent',
                  background: isSelected ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                  color: isSelected ? '#e9d5ff' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600
                }}
              >
                {symbol}
              </button>
            )
          })}
        </div>
      </aside>
    )
  }

  // Render expanded resizable sidebar
  return (
    <aside
      className="social-inner-sidebar"
      style={{
        width,
        minWidth: MIN_WIDTH,
        maxWidth: MAX_WIDTH,
        background: 'rgba(15, 23, 42, 0.4)',
        borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        userSelect: 'none',
        flexShrink: 0
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 12px 8px 14px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {workspaceTitle} Chats
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 650,
              padding: '1px 5px',
              borderRadius: 4,
              background: 'rgba(99, 102, 241, 0.15)',
              color: '#818cf8'
            }}
          >
            {allChannels.length}
          </span>
        </div>

        <button
          type="button"
          onClick={toggleCollapsed}
          title="Collapse Channels Sidebar"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      {/* Filter / Search input */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 6,
            padding: '4px 8px'
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Filter channels & DMs..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 11,
              color: '#f8fafc',
              width: '100%'
            }}
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => setFilterQuery('')}
              style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 11, padding: 0 }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Channel lists */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {/* All Channels Mode */}
        <button
          type="button"
          onClick={() => onSelectChannel(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '6px 8px',
            borderRadius: 6,
            border: activeChannelId === null ? '1px solid rgba(99, 102, 241, 0.35)' : '1px solid transparent',
            background: activeChannelId === null ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
            color: activeChannelId === null ? '#a5b4fc' : '#94a3b8',
            cursor: 'pointer',
            textAlign: 'left',
            marginBottom: 8,
            fontSize: 12,
            fontWeight: 600
          }}
        >
          <span style={{ fontSize: 13 }}>⚡</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            All {workspaceTitle} Channels
          </span>
          <span style={{ fontSize: 9, opacity: 0.7, background: 'rgba(255,255,255,0.06)', padding: '1px 4px', borderRadius: 3 }}>
            overview
          </span>
        </button>

        {/* Public Channels Group */}
        {publicChannels.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#64748b',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '4px 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <span>Public Channels</span>
              <span>{publicChannels.length}</span>
            </div>
            {publicChannels.map((ch) => renderChannelRow(ch, '#', activeChannelId, onSelectChannel))}
          </div>
        )}

        {/* Private Channels Group */}
        {privateChannels.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#64748b',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '4px 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <span>Private Channels</span>
              <span>{privateChannels.length}</span>
            </div>
            {privateChannels.map((ch) => renderChannelRow(ch, '🔒', activeChannelId, onSelectChannel))}
          </div>
        )}

        {/* Direct Messages Group */}
        {dmChannels.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#64748b',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '4px 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <span>Direct Messages</span>
              <span>{dmChannels.length}</span>
            </div>
            {dmChannels.map((ch) => renderChannelRow(ch, '👤', activeChannelId, onSelectChannel))}
          </div>
        )}

        {filteredChannels.length === 0 && (
          <div style={{ padding: '16px 8px', textAlign: 'center', color: '#64748b', fontSize: 11 }}>
            {filterQuery ? 'No matching channels.' : 'No monitored channels in this source.'}
          </div>
        )}
      </div>

      {/* Resize Handle */}
      <div
        onMouseDown={startResizing}
        title="Drag to resize channel sidebar"
        style={{
          position: 'absolute',
          top: 0,
          right: -3,
          width: 6,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 20
        }}
      />
    </aside>
  )
}

function renderChannelRow(
  channel: ProjectSourceChannel,
  symbol: string,
  activeChannelId: string | null,
  onSelect: (id: string) => void
): React.JSX.Element {
  const isSelected = activeChannelId === channel.id
  const isDm = channel.isDm || channel.kind === 'dm' || channel.name.startsWith('@') || channel.name.toLowerCase().includes('you')
  const cleanName = channel.name.replace(/^[#@]+/, '').replace(/\s*\(?you\)?$/i, '').trim() || 'channel'
  const displaySymbol = isDm ? '👤' : symbol

  return (
    <button
      key={channel.id}
      type="button"
      onClick={() => onSelect(channel.id)}
      title={`${displaySymbol} ${cleanName} · ${channel.agentWrite ? 'Agent Write Authorized' : 'Read Monitored'}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        padding: '5px 8px',
        borderRadius: 5,
        border: isSelected ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid transparent',
        background: isSelected ? 'rgba(168, 85, 247, 0.18)' : 'transparent',
        color: isSelected ? '#f1f5f9' : '#94a3b8',
        cursor: 'pointer',
        textAlign: 'left',
        fontSize: 12,
        marginBottom: 1,
        transition: 'background 0.15s ease'
      }}
    >
      <span
        style={{
          fontSize: displaySymbol === '#' ? 13 : 11,
          color: isSelected ? '#c084fc' : '#64748b',
          fontWeight: 700,
          width: 14,
          textAlign: 'center'
        }}
      >
        {displaySymbol}
      </span>

      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: isSelected ? 650 : 500
        }}
      >
        {cleanName}
      </span>

      {channel.agentWrite && (
        <span
          title="Agent Write Authorized"
          style={{
            fontSize: 9,
            padding: '1px 4px',
            borderRadius: 3,
            background: 'rgba(34, 197, 94, 0.15)',
            color: '#4ade80',
            fontWeight: 700
          }}
        >
          WRITE
        </span>
      )}

      {typeof channel.memberCount === 'number' && channel.memberCount > 1 && (
        <span style={{ fontSize: 9, color: '#64748b' }}>{channel.memberCount}</span>
      )}
    </button>
  )
}
