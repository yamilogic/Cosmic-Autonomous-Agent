import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { DashboardProject } from '../../../../shared/dashboard-contract'

export interface CardRemoveOrDeleteModalProps {
  open: boolean
  project: DashboardProject | null
  onClose: () => void
  onHide: (project: DashboardProject) => Promise<void> | void
  onDelete: (projectId: string) => Promise<void> | void
}

export function CardRemoveOrDeleteModal({
  open,
  project,
  onClose,
  onHide,
  onDelete
}: CardRemoveOrDeleteModalProps): React.JSX.Element | null {
  const [showPermanentDeleteSection, setShowPermanentDeleteSection] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setShowPermanentDeleteSection(false)
      setBusy(false)
    }
  }, [open, project])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && open && !busy) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, busy, onClose])

  if (!open || !project || typeof document === 'undefined') return null

  const projectName = project.name || project.teamName || 'Project Card'

  const handleHide = async (): Promise<void> => {
    setBusy(true)
    try {
      await onHide(project)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    setBusy(true)
    try {
      await onDelete(project.id)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-action-title"
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
          maxWidth: '480px',
          background: 'rgba(15, 23, 42, 0.98)',
          border: '1px solid rgba(99, 102, 241, 0.35)',
          borderRadius: '14px',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.7), 0 0 24px rgba(99, 102, 241, 0.15)',
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
            background: 'rgba(99, 102, 241, 0.08)'
          }}
        >
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'rgba(99, 102, 241, 0.18)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              flexShrink: 0
            }}
          >
            👁️‍🗨️
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3
              id="card-action-title"
              style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: 650,
                color: '#f8fafc'
              }}
            >
              Remove Card from Sidebar
            </h3>
            <p
              style={{
                margin: '2px 0 0',
                fontSize: '12px',
                color: '#94a3b8'
              }}
            >
              Hide from view or permanently delete
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '18px',
              padding: '4px 8px',
              borderRadius: '6px',
              lineHeight: 1
            }}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '14px', color: '#e2e8f0', marginBottom: '8px' }}>
              Do you want to Remove or Hide{' '}
              <strong style={{ color: '#fff' }}>{projectName}</strong> from the sidebar?
            </div>
            <div
              style={{
                background: 'rgba(30, 41, 59, 0.65)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                fontSize: '12.5px',
                color: '#cbd5e1'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#a5b4fc' }}>
                <span>✨</span>
                <span>
                  <strong>Hiding keeps all data safe:</strong> All your chats, sources, channels, and card settings remain intact.
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8', marginTop: '2px' }}>
                <span>🔄</span>
                <span>
                  You can make this card visible again anytime by going to the <strong>Profiles</strong> page and clicking <strong>Show in sidebar</strong> on this card.
                </span>
              </div>
            </div>
          </div>

          {/* Primary Action Button: Hide from Sidebar */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              className="btn primary"
              onClick={handleHide}
              disabled={busy}
              style={{
                flex: 1,
                padding: '10px 16px',
                fontSize: '13px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                borderRadius: '8px'
              }}
            >
              <span>👁️‍🗨️</span>
              {busy ? 'Hiding...' : 'Hide from Sidebar'}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={onClose}
              disabled={busy}
              style={{
                padding: '10px 16px',
                fontSize: '13px',
                borderRadius: '8px'
              }}
            >
              Cancel
            </button>
          </div>

          {/* Secondary Action: Permanent Delete */}
          <div
            style={{
              marginTop: '4px',
              paddingTop: '14px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            {!showPermanentDeleteSection ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Want to permanently delete this card instead?
                </span>
                <button
                  type="button"
                  onClick={() => setShowPermanentDeleteSection(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#f87171',
                    fontSize: '12px',
                    fontWeight: 500,
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: '2px 4px'
                  }}
                >
                  Delete Card permanently...
                </button>
              </div>
            ) : (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
              >
                <div style={{ fontSize: '12px', color: '#fca5a5' }}>
                  ⚠️ <strong>Permanent Deletion:</strong> This will permanently delete this project card and all its cached sync messages and channel mappings.
                </div>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    onClick={() => setShowPermanentDeleteSection(false)}
                    disabled={busy}
                    style={{ fontSize: '11px', padding: '4px 10px' }}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={busy}
                    style={{
                      background: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '5px 12px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {busy ? 'Deleting...' : 'Yes, Permanently Delete Card'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

