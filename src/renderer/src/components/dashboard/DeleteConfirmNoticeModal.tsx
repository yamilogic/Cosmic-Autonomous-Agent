import React, { useState, useEffect } from 'react'

export interface CardDeleteTarget {
  id: string
  name: string
  clientName?: string
  teamName?: string
  channelCount?: number
}

export interface ProfileDeleteTarget {
  id: string
  name: string
  email?: string
  cards: Array<{ id: string; name: string }>
}

export interface DeleteConfirmNoticeModalProps {
  open: boolean
  onClose: () => void
  target:
    | { type: 'card'; card: CardDeleteTarget }
    | { type: 'profile'; profile: ProfileDeleteTarget }
    | null
  onConfirmCardDelete?: (cardId: string) => Promise<void> | void
  onConfirmProfileDelete?: (profileId: string, deleteCards: boolean) => Promise<void> | void
}

export function DeleteConfirmNoticeModal({
  open,
  onClose,
  target,
  onConfirmCardDelete,
  onConfirmProfileDelete
}: DeleteConfirmNoticeModalProps): React.JSX.Element | null {
  const [deleteCardsAlso, setDeleteCardsAlso] = useState<boolean>(true)
  const [busy, setBusy] = useState<boolean>(false)

  useEffect(() => {
    if (open) {
      setDeleteCardsAlso(true)
      setBusy(false)
    }
  }, [open, target])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && open && !busy) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, busy, onClose])

  if (!open || !target) return null

  const handleConfirm = async (): Promise<void> => {
    setBusy(true)
    try {
      if (target.type === 'card' && onConfirmCardDelete) {
        await onConfirmCardDelete(target.card.id)
      } else if (target.type === 'profile' && onConfirmProfileDelete) {
        await onConfirmProfileDelete(target.profile.id, deleteCardsAlso)
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const isCard = target.type === 'card'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-notice-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(6px)',
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          background: 'rgba(15, 23, 42, 0.98)',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          borderRadius: '14px',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.7), 0 0 24px rgba(239, 68, 68, 0.15)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'modalSlideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '18px 22px 14px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
            background: 'rgba(239, 68, 68, 0.08)'
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'rgba(239, 68, 68, 0.18)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              flexShrink: 0
            }}
          >
            ⚠️
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3
              id="delete-notice-title"
              style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: 650,
                color: '#f8fafc'
              }}
            >
              {isCard ? 'Delete Project Card' : 'Delete Profile Account'}
            </h3>
            <p
              style={{
                margin: '2px 0 0',
                fontSize: '12px',
                color: '#94a3b8'
              }}
            >
              Permanent destructive action notice
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              fontSize: '16px',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px'
            }}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {isCard ? (
            <>
              <p style={{ margin: 0, fontSize: '13.5px', color: '#e2e8f0', lineHeight: 1.5 }}>
                Are you sure you want to permanently delete project card{' '}
                <strong style={{ color: '#fff' }}>&ldquo;{target.card.name}&rdquo;</strong>?
              </p>

              {/* Card Meta Box */}
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.35)',
                  border: '1px solid rgba(255, 255, 255, 0.07)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  fontSize: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                {target.card.clientName && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8' }}>Client:</span>
                    <span style={{ color: '#cbd5e1', fontWeight: 550 }}>{target.card.clientName}</span>
                  </div>
                )}
                {target.card.teamName && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8' }}>Workspace:</span>
                    <span style={{ color: '#cbd5e1', fontWeight: 550 }}>{target.card.teamName}</span>
                  </div>
                )}
                {typeof target.card.channelCount === 'number' && target.card.channelCount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8' }}>Monitored channels:</span>
                    <span style={{ color: '#cbd5e1', fontWeight: 550 }}>{target.card.channelCount}</span>
                  </div>
                )}
              </div>

              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  fontSize: '11.5px',
                  color: '#fca5a5',
                  lineHeight: 1.4
                }}
              >
                All stored channel data, sync logs, and isolated browser session cookies for this card will be permanently deleted.
              </div>
            </>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: '13.5px', color: '#e2e8f0', lineHeight: 1.5 }}>
                Are you sure you want to permanently delete profile{' '}
                <strong style={{ color: '#fff' }}>&ldquo;{target.profile.name}&rdquo;</strong>?
              </p>

              {/* Profile Details Box */}
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.35)',
                  border: '1px solid rgba(255, 255, 255, 0.07)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  fontSize: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                {target.profile.email && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8' }}>Email:</span>
                    <span style={{ color: '#cbd5e1', fontWeight: 550 }}>{target.profile.email}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>Associated project cards:</span>
                  <span style={{ color: '#cbd5e1', fontWeight: 550 }}>{target.profile.cards.length}</span>
                </div>
              </div>

              {/* Associated Cards Section */}
              {target.profile.cards.length > 0 && (
                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>
                    Linked Cards ({target.profile.cards.length}):
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '6px',
                      maxHeight: '90px',
                      overflowY: 'auto'
                    }}
                  >
                    {target.profile.cards.map((c) => (
                      <span
                        key={c.id}
                        style={{
                          background: 'rgba(255, 255, 255, 0.06)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          color: '#cbd5e1'
                        }}
                      >
                        📁 {c.name}
                      </span>
                    ))}
                  </div>

                  {/* Cascade Option Checkbox */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '9px',
                      cursor: 'pointer',
                      marginTop: '4px',
                      paddingTop: '8px',
                      borderTop: '1px solid rgba(255, 255, 255, 0.07)'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={deleteCardsAlso}
                      onChange={(e) => setDeleteCardsAlso(e.target.checked)}
                      style={{ marginTop: '2px', cursor: 'pointer' }}
                    />
                    <div style={{ fontSize: '12px' }}>
                      <span style={{ fontWeight: 600, color: '#f8fafc' }}>
                        Also delete all {target.profile.cards.length} project card(s) linked to this profile
                      </span>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#94a3b8', lineHeight: 1.35 }}>
                        If unchecked, these cards will remain available in &ldquo;All Projects&rdquo; as independent cards.
                      </p>
                    </div>
                  </label>
                </div>
              )}

              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  fontSize: '11.5px',
                  color: '#fca5a5',
                  lineHeight: 1.4
                }}
              >
                Profile sessions, OAuth tokens, and preferences will be permanently wiped.
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '10px',
            padding: '14px 22px',
            borderTop: '1px solid rgba(255, 255, 255, 0.07)',
            background: 'rgba(0, 0, 0, 0.2)'
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: '7px 16px',
              fontSize: '12.5px',
              fontWeight: 550,
              borderRadius: '7px',
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#cbd5e1',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy}
            style={{
              padding: '7px 18px',
              fontSize: '12.5px',
              fontWeight: 650,
              borderRadius: '7px',
              background: '#dc2626',
              border: '1px solid #ef4444',
              color: '#fff',
              cursor: busy ? 'wait' : 'pointer',
              boxShadow: '0 2px 8px rgba(220, 38, 38, 0.4)',
              transition: 'all 0.15s ease'
            }}
          >
            {busy ? 'Deleting…' : isCard ? 'Delete Card' : 'Delete Profile'}
          </button>
        </div>
      </div>
    </div>
  )
}

