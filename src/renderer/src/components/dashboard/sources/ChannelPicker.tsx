import React, { useState, useMemo } from 'react'

export interface ChannelOption {
  id: string
  name: string
  isPrivate?: boolean
}

interface ChannelPickerProps {
  channels: ChannelOption[]
  selectedChannelIds: string[]
  onChange: (selectedIds: string[]) => void
  disabled?: boolean
  loading?: boolean
}

export const ChannelPicker: React.FC<ChannelPickerProps> = ({
  channels,
  selectedChannelIds,
  onChange,
  disabled,
  loading
}) => {
  const [filter, setFilter] = useState('')

  const filteredChannels = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return channels
    return channels.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
  }, [channels, filter])

  const toggleChannel = (id: string) => {
    if (disabled) return
    if (selectedChannelIds.includes(id)) {
      onChange(selectedChannelIds.filter((item) => item !== id))
    } else {
      onChange([...selectedChannelIds, id])
    }
  }

  const selectAll = () => {
    if (disabled) return
    const ids = Array.from(new Set([...selectedChannelIds, ...filteredChannels.map((c) => c.id)]))
    onChange(ids)
  }

  const clearSelection = () => {
    if (disabled) return
    onChange([])
  }

  if (loading) {
    return <div style={{ fontSize: 13, color: 'var(--color-text-dim, #9ca3af)', padding: 12 }}>Loading channels from Slack session...</div>
  }

  return (
    <div className="channel-picker" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-dim, #9ca3af)' }}>
          Monitored Channels ({selectedChannelIds.length} selected)
        </label>
        <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
          <button
            type="button"
            onClick={selectAll}
            disabled={disabled || filteredChannels.length === 0}
            style={{ background: 'none', border: 'none', color: 'var(--color-primary, #6366f1)', cursor: 'pointer' }}
          >
            Select All
          </button>
          <span style={{ color: '#4b5563' }}>|</span>
          <button
            type="button"
            onClick={clearSelection}
            disabled={disabled || selectedChannelIds.length === 0}
            style={{ background: 'none', border: 'none', color: 'var(--color-text-dim, #9ca3af)', cursor: 'pointer' }}
          >
            Clear
          </button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search channels..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        disabled={disabled}
        style={{
          width: '100%',
          padding: '6px 10px',
          borderRadius: 6,
          backgroundColor: 'var(--color-input-bg, #1f2937)',
          border: '1px solid var(--color-border, #374151)',
          color: 'var(--color-text-main, #f3f4f6)',
          fontSize: 13,
          outline: 'none'
        }}
      />

      <div
        style={{
          maxHeight: 180,
          overflowY: 'auto',
          border: '1px solid var(--color-border, #374151)',
          borderRadius: 6,
          backgroundColor: 'var(--color-bg-subtle, #111827)'
        }}
      >
        {filteredChannels.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: '#6b7280' }}>
            No channels found.
          </div>
        ) : (
          filteredChannels.map((ch) => {
            const checked = selectedChannelIds.includes(ch.id)
            return (
              <label
                key={ch.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  backgroundColor: checked ? 'rgba(99, 102, 241, 0.06)' : 'transparent'
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleChannel(ch.id)}
                  disabled={disabled}
                />
                <span style={{ fontSize: 13, color: checked ? '#fff' : '#d1d5db' }}>
                  {ch.isPrivate ? '🔒' : '#'} {ch.name}
                </span>
              </label>
            )
          })
        )}
      </div>
    </div>
  )
}
