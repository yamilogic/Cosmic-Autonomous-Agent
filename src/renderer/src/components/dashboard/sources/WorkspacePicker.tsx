import React from 'react'

export interface ProfileWorkspaceOption {
  profileId: string
  profileEmail: string
  workspaceId: string
  workspaceName: string
}

interface WorkspacePickerProps {
  options: ProfileWorkspaceOption[]
  selectedKey: string // `${profileId}:${workspaceId}`
  onChange: (key: string) => void
  disabled?: boolean
}

export const WorkspacePicker: React.FC<WorkspacePickerProps> = ({
  options,
  selectedKey,
  onChange,
  disabled
}) => {
  if (options.length === 0) {
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 8,
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          fontSize: 13,
          color: '#f87171'
        }}
      >
        No connected Slack workspaces found in your profiles. Log into Slack under your Google Profile in the sidebar first.
      </div>
    )
  }

  return (
    <div className="workspace-picker" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-dim, #9ca3af)' }}>
        Select Slack Workspace
      </label>
      <select
        value={selectedKey}
        onChange={(e) => onChange(e.target.value)}
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
        <option value="" disabled>
          -- Choose workspace --
        </option>
        {options.map((opt) => (
          <option key={`${opt.profileId}:${opt.workspaceId}`} value={`${opt.profileId}:${opt.workspaceId}`}>
            {opt.workspaceName} ({opt.profileEmail})
          </option>
        ))}
      </select>
    </div>
  )
}
