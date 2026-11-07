import React from 'react'
import type { ProjectSourceStatus } from '../../../../../shared/dashboard-contract'

interface SourceStatusBadgeProps {
  status: ProjectSourceStatus
  lastReadAt?: string
}

export const SourceStatusBadge: React.FC<SourceStatusBadgeProps> = ({ status, lastReadAt }) => {
  const config: Record<ProjectSourceStatus, { label: string; bg: string; color: string; border: string }> = {
    connected: {
      label: 'Connected',
      bg: 'rgba(34, 197, 94, 0.12)',
      color: '#4ade80',
      border: 'rgba(34, 197, 94, 0.3)'
    },
    'needs-login': {
      label: 'Needs Login',
      bg: 'rgba(239, 68, 68, 0.12)',
      color: '#f87171',
      border: 'rgba(239, 68, 68, 0.3)'
    },
    challenge: {
      label: 'Action Required',
      bg: 'rgba(245, 158, 11, 0.12)',
      color: '#fbbf24',
      border: 'rgba(245, 158, 11, 0.3)'
    },
    'adapter-broken': {
      label: 'Format Changed',
      bg: 'rgba(239, 68, 68, 0.12)',
      color: '#f87171',
      border: 'rgba(239, 68, 68, 0.3)'
    },
    paused: {
      label: 'Paused',
      bg: 'rgba(156, 163, 175, 0.12)',
      color: '#9ca3af',
      border: 'rgba(156, 163, 175, 0.3)'
    },
    running: {
      label: 'Reading...',
      bg: 'rgba(99, 102, 241, 0.12)',
      color: '#818cf8',
      border: 'rgba(99, 102, 241, 0.3)'
    }
  }

  const { label, bg, color, border } = config[status] ?? config.connected

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        borderRadius: 12,
        backgroundColor: bg,
        border: `1px solid ${border}`,
        fontSize: 11,
        fontWeight: 600,
        color
      }}
      title={lastReadAt ? `Last read: ${new Date(lastReadAt).toLocaleString()}` : undefined}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: color
        }}
      />
      {label}
    </div>
  )
}
