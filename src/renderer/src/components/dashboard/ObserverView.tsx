import React, { useMemo } from 'react'
import { useProfileStore } from '../../hooks/useProfiles'
import { GLOBAL_PROFILE_ID } from '../../../../shared/types'

interface ObserverViewProps {
  onBack: () => void
}

/**
 * Dedicated In-Place Canvas View for Observer Mode & Channel Streams
 */
export function ObserverView({ onBack }: ObserverViewProps): React.JSX.Element {
  const profiles = useProfileStore((s) => s.profiles)

  // List observer or monitored sources
  const observerProfiles = useMemo(() => {
    return profiles.filter((p) => p.accountScope === 'observer' || p.id !== GLOBAL_PROFILE_ID)
  }, [profiles])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-page)',
        color: '#f8fafc',
        overflowY: 'auto'
      }}
    >
      {/* Top Banner / Breadcrumb */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            className="btn ghost btn-sm"
            onClick={onBack}
            style={{
              color: '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              padding: '6px 12px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px'
            }}
          >
            ← Back to Dashboard
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🔭</span>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 650 }}>
              Observer Mode & Channel Streams
            </h2>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: '#34d399',
              background: 'rgba(16, 185, 129, 0.1)',
              padding: '4px 10px',
              borderRadius: '12px',
              border: '1px solid rgba(16, 185, 129, 0.2)'
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#10b981'
              }}
            />
            Live Monitor Active
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ padding: '28px', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
        <div
          style={{
            background: 'rgba(30, 41, 59, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px'
          }}
        >
          <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600 }}>
            Passive Slack & Channel Observer
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
            Observer mode monitors incoming channel messages passively across active accounts without
            triggering noisy writes or interrupting ongoing project cards. Real-time updates and notifications
            stream into the central dashboard and status bar.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#cbd5e1' }}>
            Connected Channels & Observer Workspaces ({observerProfiles.length})
          </h4>

          {observerProfiles.length === 0 ? (
            <div
              style={{
                padding: '32px',
                textAlign: 'center',
                background: 'rgba(15, 23, 42, 0.4)',
                borderRadius: '8px',
                border: '1px dashed rgba(255, 255, 255, 0.1)',
                color: '#64748b',
                fontSize: '13px'
              }}
            >
              No observer accounts configured yet. Accounts added with Observer scope will appear here.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
              {observerProfiles.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: 'rgba(15, 23, 42, 0.7)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '10px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px', color: '#f1f5f9' }}>
                      {p.customName || p.displayName || p.id}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: 'rgba(99, 102, 241, 0.15)',
                        color: '#818cf8'
                      }}
                    >
                      {p.accountScope || 'active'}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    Slack: {p.apps?.slack?.sessionStatus || 'idle'} · Teams: {p.apps?.teams?.sessionStatus || 'idle'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
export default ObserverView

