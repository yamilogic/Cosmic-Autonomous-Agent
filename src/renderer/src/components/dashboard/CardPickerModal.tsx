import React from 'react'
import type { DashboardProject } from '../../../../shared/dashboard-contract'
import { useDashboardStore } from '../../hooks/useDashboard'
import { useProfileStore } from '../../hooks/useProfiles'
import { profileDisplayLabel } from '../../../../shared/types'

interface CardPickerModalProps {
  open: boolean
  profileId: string
  onClose: () => void
  onPickCard: (project: DashboardProject) => void
}

export function CardPickerModal({
  open,
  profileId,
  onClose,
  onPickCard
}: CardPickerModalProps): React.JSX.Element | null {
  const snapshot = useDashboardStore((s) => s.snapshot)
  const profiles = useProfileStore((s) => s.profiles)

  const profile = profiles.find((p) => p.id === profileId)
  const profileCards = (snapshot?.projects ?? [])
    .map((p) => p.project)
    .filter((p) => p.profileId === profileId && (p.workflowStatus ?? 'active') !== 'removed')

  if (!open) return null

  return (
    <div className="add-platform-backdrop" onClick={onClose} style={{ zIndex: 1350 }}>
      <div
        className="add-platform-panel"
        style={{ width: '520px', maxWidth: '92vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Pick a project card"
      >
        <div className="add-platform-header">
          <div>
            <h2 style={{ margin: 0, fontSize: '17px', color: '#f8fafc' }}>+ Add Website / Platform to Card</h2>
            <p className="add-section-sub" style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
              {profile ? `Select a project card for "${profileDisplayLabel(profile)}"` : 'Select a project card'}
            </p>
          </div>
          <button type="button" className="btn ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {profileCards.length === 0 ? (
          <div style={{ padding: '36px 20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
            No active project cards found for this profile.
            <div style={{ marginTop: '8px', color: '#94a3b8' }}>
              Create a card first using <b>+ Project</b> in the sidebar.
            </div>
          </div>
        ) : (
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
            {profileCards.map((card) => (
              <button
                key={card.id}
                type="button"
                className="btn ghost"
                style={{
                  textAlign: 'left',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                onClick={() => onPickCard(card)}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ fontWeight: 600, fontSize: '14px', color: '#f8fafc' }}>
                    📁 {card.name}
                  </span>
                  <span style={{ fontSize: '11px', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '2px 8px', borderRadius: '4px' }}>
                    Select Card →
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Client: {card.clientName || 'General'} • {card.sources?.length ?? 0} connected sources
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default CardPickerModal

