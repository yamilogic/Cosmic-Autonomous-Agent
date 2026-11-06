import React, { useState, useRef, useEffect, useMemo } from 'react'

interface AiModelComboboxProps {
  value: string
  options: string[]
  placeholder?: string
  inheritLabel: string
  disabled?: boolean
  onChange: (val: string) => void
  onRefresh?: () => void
  refreshing?: boolean
  refreshLabel?: string
  'data-testid'?: string
}

export function AiModelCombobox({
  value,
  options,
  placeholder = 'Search models…',
  inheritLabel,
  disabled = false,
  onChange,
  onRefresh,
  refreshing = false,
  refreshLabel = '⟳ Models',
  'data-testid': testId
}: AiModelComboboxProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Group models by provider prefix: e.g. "nvidia/", "meta/", "google/"
  const groupedOptions = useMemo(() => {
    const filtered = options.filter((opt) =>
      opt.toLowerCase().includes(search.toLowerCase().trim())
    )

    const groups: Record<string, string[]> = {}
    for (const opt of filtered) {
      const parts = opt.split('/')
      const provider = parts.length > 1 ? parts[0] : 'other'
      if (!groups[provider]) groups[provider] = []
      groups[provider].push(opt)
    }

    // Sort providers alphabetically, but keep nvidia first if present
    const sortedProviders = Object.keys(groups).sort((a, b) => {
      if (a === 'nvidia') return -1
      if (b === 'nvidia') return 1
      return a.localeCompare(b)
    })

    return { filtered, sortedProviders, groups }
  }, [options, search])

  // Flat list for arrow navigation (index 0 is always "inherit from global")
  const flatItems = useMemo(() => {
    return ['', ...groupedOptions.filtered]
  }, [groupedOptions.filtered])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev + 1) % flatItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev - 1 + flatItems.length) % flatItems.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selected = flatItems[highlightIndex]
      if (selected !== undefined) {
        onChange(selected)
        setOpen(false)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  const displayLabel = value === '' ? inheritLabel : value

  return (
    <div
      ref={containerRef}
      className="ai-model-combobox-wrap"
      style={{ position: 'relative', width: '100%' }}
      data-testid={testId}
    >
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              setOpen(!open)
              setTimeout(() => inputRef.current?.focus(), 50)
            }
          }}
          style={{
            flex: 1,
            height: '42px',
            borderRadius: 'var(--radius-input)',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: value ? 'var(--text)' : 'var(--text-muted)',
            padding: '0 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '14px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            textAlign: 'left'
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayLabel}
          </span>
          <span style={{ opacity: 0.6, fontSize: '11px', marginLeft: '8px' }}>▾</span>
        </button>

        {onRefresh && (
          <button
            type="button"
            className="dash-subtle"
            disabled={refreshing || disabled}
            onClick={onRefresh}
            style={{ height: '42px', whiteSpace: 'nowrap', padding: '0 12px' }}
          >
            {refreshing ? 'Loading…' : refreshLabel}
          </button>
        )}
      </div>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 100,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-input)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
            maxHeight: '340px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          <div style={{ padding: '8px', borderBottom: '1px solid var(--border)' }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              placeholder={placeholder}
              onChange={(e) => {
                setSearch(e.target.value)
                setHighlightIndex(0)
              }}
              onKeyDown={handleKeyDown}
              style={{
                width: '100%',
                height: '34px',
                padding: '0 10px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: '13px'
              }}
            />
          </div>

          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {/* Option 0: Inherit from global */}
            <div
              role="option"
              aria-selected={value === ''}
              style={{
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: 600,
                color: value === '' ? 'var(--accent)' : 'var(--text)',
                background: highlightIndex === 0 ? 'var(--hover)' : 'transparent',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border)'
              }}
              onMouseEnter={() => setHighlightIndex(0)}
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              {inheritLabel}
            </div>

            {groupedOptions.sortedProviders.map((provider) => {
              const list = groupedOptions.groups[provider]
              return (
                <div key={provider} style={{ marginTop: '6px' }}>
                  <div
                    style={{
                      padding: '4px 12px',
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--text-faint)'
                    }}
                  >
                    {provider}
                  </div>
                  {list.map((m) => {
                    const itemIdx = flatItems.indexOf(m)
                    const isSelected = value === m
                    const isHighlighted = highlightIndex === itemIdx
                    return (
                      <div
                        key={m}
                        role="option"
                        aria-selected={isSelected}
                        style={{
                          padding: '7px 12px 7px 20px',
                          fontSize: '13px',
                          color: isSelected ? 'var(--accent)' : 'var(--text)',
                          background: isHighlighted ? 'var(--hover)' : 'transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between'
                        }}
                        onMouseEnter={() => setHighlightIndex(itemIdx)}
                        onClick={() => {
                          onChange(m)
                          setOpen(false)
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m}</span>
                        {isSelected && <span style={{ fontSize: '12px' }}>✓</span>}
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {groupedOptions.filtered.length === 0 && (
              <div
                style={{
                  padding: '16px',
                  textAlign: 'center',
                  fontSize: '13px',
                  color: 'var(--text-muted)'
                }}
              >
                No models match &ldquo;{search}&rdquo;
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
