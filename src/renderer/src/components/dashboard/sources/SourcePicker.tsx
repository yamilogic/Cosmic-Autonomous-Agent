import React from 'react'

export type SourceType = 'token' | 'browser' | 'both'

interface SourcePickerProps {
  value: SourceType
  onChange: (val: SourceType) => void
  disabled?: boolean
}

export const SourcePicker: React.FC<SourcePickerProps> = ({ value, onChange, disabled }) => {
  return (
    <div className="source-picker" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: 12,
          borderRadius: 8,
          border: `1px solid ${value === 'browser' ? 'var(--color-primary, #6366f1)' : 'var(--color-border, #333)'}`,
          backgroundColor: value === 'browser' ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      >
        <input
          type="radio"
          name="source-type"
          value="browser"
          checked={value === 'browser'}
          onChange={() => onChange('browser')}
          disabled={disabled}
          style={{ marginTop: 4 }}
        />
        <div>
          <div style={{ fontWeight: 600, color: 'var(--color-text-main, #f3f4f6)' }}>
            Logged-in Slack Web Session (Recommended)
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-dim, #9ca3af)', marginTop: 2 }}>
            Passively read messages from your logged-in Slack tab under your profile. No admin bot token or app install required.
          </div>
        </div>
      </label>

      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: 12,
          borderRadius: 8,
          border: `1px solid ${value === 'token' ? 'var(--color-primary, #6366f1)' : 'var(--color-border, #333)'}`,
          backgroundColor: value === 'token' ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      >
        <input
          type="radio"
          name="source-type"
          value="token"
          checked={value === 'token'}
          onChange={() => onChange('token')}
          disabled={disabled}
          style={{ marginTop: 4 }}
        />
        <div>
          <div style={{ fontWeight: 600, color: 'var(--color-text-main, #f3f4f6)' }}>
            Official Slack App Token
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-dim, #9ca3af)', marginTop: 2 }}>
            Connect via OAuth or Bot User OAuth token (xoxb-...) if your workspace administrator allows custom Slack apps.
          </div>
        </div>
      </label>
    </div>
  )
}
