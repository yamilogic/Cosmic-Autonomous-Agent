import React from 'react'

interface BackfillSelectProps {
  days: number
  onChange: (days: number) => void
  disabled?: boolean
}

export const BackfillSelect: React.FC<BackfillSelectProps> = ({ days, onChange, disabled }) => {
  return (
    <div className="backfill-select" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-dim, #9ca3af)' }}>
        Initial Backfill Window
      </label>
      <select
        value={days}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        style={{
          width: '100%',
          padding: '8px 12px',
          borderRadius: 6,
          backgroundColor: 'var(--color-input-bg, #1f2937)',
          border: '1px solid var(--color-border, #374151)',
          color: 'var(--color-text-main, #f3f4f6)',
          fontSize: 14,
          outline: 'none'
        }}
      >
        <option value={1}>Last 24 hours (Fastest)</option>
        <option value={7}>Last 7 days (Recommended)</option>
        <option value={30}>Last 30 days (Full context)</option>
      </select>
    </div>
  )
}
