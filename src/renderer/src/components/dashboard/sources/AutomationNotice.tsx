import React from 'react'

interface AutomationNoticeProps {
  acknowledged: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}

export const AutomationNotice: React.FC<AutomationNoticeProps> = ({
  acknowledged,
  onChange,
  disabled
}) => {
  return (
    <div
      className="automation-notice"
      style={{
        padding: 14,
        borderRadius: 8,
        backgroundColor: 'rgba(234, 179, 8, 0.08)',
        border: '1px solid rgba(234, 179, 8, 0.25)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }}
    >
      <div style={{ fontSize: 13, color: '#fef08a', lineHeight: 1.5 }}>
        <strong>Passive Read-Only Automation Notice:</strong>
        <br />
        Cosmic will read visible messages from the selected channels using your local logged-in session in the background. It will <em>never</em> send messages, compose text, or take actions on your behalf.
      </div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 13,
          color: '#fef3c7',
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      >
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <span>I understand and permit passive reading of selected channels</span>
      </label>
    </div>
  )
}
