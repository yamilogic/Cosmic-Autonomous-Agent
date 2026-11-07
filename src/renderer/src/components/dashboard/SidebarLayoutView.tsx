import React from 'react'
import {
  SidebarLayout,
  LayoutMode,
  SIDEBAR_REGISTRY
} from './sidebar-layout'
import NavIcon from './nav-icons'

interface SidebarLayoutTabProps {
  layout: SidebarLayout
  onModeChange: (mode: LayoutMode) => void
  onToggleSection: (sectionKey: string) => void
  onReset: () => void
}

function SectionGraphic({ name }: { name: string }): React.ReactElement {
  switch (name) {
    case 'dashboard':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      )
    case 'xomni':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      )
    case 'slack':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="13" y="2" width="3" height="8" rx="1.5" />
          <path d="M19 8.5a2.5 2.5 0 0 1-5 0" />
          <rect x="8" y="14" width="3" height="8" rx="1.5" />
          <path d="M5 15.5a2.5 2.5 0 0 1 5 0" />
        </svg>
      )
    case 'info':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      )
    case 'viz':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="4" />
          <line x1="12" y1="20" x2="12" y2="10" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      )
    case 'settings':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82V9a1.65 1.65 0 0 0 1.51-1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      )
    default:
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="2" />
        </svg>
      )
  }
}

export function SidebarLayoutView({
  layout,
  onModeChange,
  onToggleSection,
  onReset
}: SidebarLayoutTabProps): React.ReactElement {
  const nonLocked = SIDEBAR_REGISTRY.filter((s) => !s.locked)
  const hidden = new Set(layout.custom.hiddenSections)

  const modeOptions: Array<{
    key: LayoutMode
    title: string
    subtitle: string
    badge: string
    svgPath: React.ReactNode
  }> = [
    {
      key: 'minimal',
      title: 'Minimal',
      subtitle: 'Pure dashboard focus',
      badge: 'Dashboard only',
      svgPath: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <rect x="3" y="3" width="18" height="18" rx="3" strokeDasharray="2 2" opacity="0.3" />
          <rect x="5" y="5" width="6" height="6" rx="1.5" />
          <line x1="5" y1="18" x2="9" y2="18" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    },
    {
      key: 'full',
      title: 'Full Suite',
      subtitle: 'All channels & signals',
      badge: 'Complete navigation',
      svgPath: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <line x1="8" y1="3" x2="8" y2="21" opacity="0.4" />
          <circle cx="5.5" cy="7" r="1.25" fill="currentColor" />
          <circle cx="5.5" cy="12" r="1.25" fill="currentColor" />
          <circle cx="5.5" cy="17" r="1.25" fill="currentColor" />
          <line x1="12" y1="8" x2="18" y2="8" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
          <line x1="12" y1="13" x2="16" y2="13" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
        </svg>
      )
    },
    {
      key: 'custom',
      title: 'Manual',
      subtitle: 'Handpick sections and accounts',
      badge: 'Personalized',
      svgPath: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <line x1="4" y1="7" x2="20" y2="7" strokeLinecap="round" />
          <circle cx="9" cy="7" r="2.5" fill="var(--bg-card)" stroke="currentColor" strokeWidth="2" />
          <line x1="4" y1="17" x2="20" y2="17" strokeLinecap="round" />
          <circle cx="15" cy="17" r="2.5" fill="var(--bg-card)" stroke="currentColor" strokeWidth="2" />
        </svg>
      )
    }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* MODE SELECTION CARDS */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div>
            <h4 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>
              Layout density
            </h4>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
              Control what appears in this project card&apos;s navigation sidebar.
            </p>
          </div>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', fontWeight: 600 }}>
            Active: {layout.mode}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
          {modeOptions.map((opt) => {
            const isSelected = layout.mode === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onModeChange(opt.key)}
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  padding: '18px 20px',
                  borderRadius: '14px',
                  border: isSelected
                    ? '1.5px solid var(--accent-btn)'
                    : '1px solid var(--border)',
                  background: isSelected
                    ? 'color-mix(in srgb, var(--accent-btn) 9%, var(--bg-card))'
                    : 'var(--bg-card)',
                  boxShadow: isSelected
                    ? '0 0 0 1px var(--accent-btn), 0 4px 16px rgba(0, 0, 0, 0.25)'
                    : '0 2px 8px rgba(0, 0, 0, 0.12)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                  outline: 'none'
                }}
              >
                <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: isSelected
                        ? 'var(--accent-btn)'
                        : 'color-mix(in srgb, var(--text) 7%, transparent)',
                      color: isSelected ? '#ffffff' : 'var(--text-muted)',
                      transition: 'all 0.18s ease'
                    }}
                  >
                    {opt.svgPath}
                  </div>
                  {isSelected && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '3px 8px',
                        borderRadius: '999px',
                        background: 'color-mix(in srgb, var(--accent-btn) 20%, transparent)',
                        color: 'var(--accent-btn)',
                        fontSize: '11px',
                        fontWeight: 700,
                        letterSpacing: '0.02em'
                      }}
                    >
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent-btn)' }} />
                      Selected
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', marginBottom: '3px' }}>
                  {opt.title}
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  {opt.subtitle}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* CUSTOM SECTION TOGGLES (Shown only in custom mode) */}
      {layout.mode === 'custom' && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            padding: '22px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px'
          }}
        >
          <div>
            <h4 style={{ margin: '0 0 4px', fontSize: '14.5px', fontWeight: 600, color: 'var(--text)' }}>
              Configure visible modules
            </h4>
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)' }}>
              Toggle individual navigation sections on or off for this project.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            {nonLocked.map((sec) => {
              const isHidden = hidden.has(sec.key)
              return (
                <div
                  key={sec.key}
                  onClick={() => onToggleSection(sec.key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault()
                      onToggleSection(sec.key)
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    background: isHidden ? 'transparent' : 'color-mix(in srgb, var(--accent-btn) 5%, transparent)',
                    border: isHidden ? '1px solid var(--border)' : '1px solid color-mix(in srgb, var(--accent-btn) 40%, var(--border))',
                    cursor: 'pointer',
                    userSelect: 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div
                      style={{
                        color: isHidden ? 'var(--text-muted)' : 'var(--accent-btn)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: isHidden ? 0.6 : 1
                      }}
                    >
                      <SectionGraphic name={sec.key} />
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: '13.5px',
                          fontWeight: 600,
                          color: isHidden ? 'var(--text-muted)' : 'var(--text)'
                        }}
                      >
                        {sec.label}
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-faint)' }}>
                        {sec.items.length} items
                      </div>
                    </div>
                  </div>

                  {/* Switch Pill */}
                  <div
                    style={{
                      width: '40px',
                      height: '22px',
                      borderRadius: '999px',
                      background: isHidden
                        ? 'color-mix(in srgb, var(--text) 15%, transparent)'
                        : 'var(--accent-btn)',
                      padding: '2px',
                      position: 'relative',
                      transition: 'background 0.2s ease',
                      flexShrink: 0
                    }}
                  >
                    <div
                      style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        background: '#ffffff',
                        transform: isHidden ? 'translateX(0)' : 'translateX(18px)',
                        transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)'
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* INTERACTIVE MINI SIDEBAR PREVIEW */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          padding: '22px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h4 style={{ margin: '0 0 4px', fontSize: '14.5px', fontWeight: 600, color: 'var(--text)' }}>
              Interactive sidebar preview
            </h4>
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)' }}>
              Live reflection of how the left sidebar appears with this layout.
            </p>
          </div>
          <button
            type="button"
            className="dash-subtle"
            style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer' }}
            onClick={onReset}
          >
            Reset to default
          </button>
        </div>

        {/* Replica of the actual sidebar */}
        <div
          style={{
            maxWidth: '320px',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '10px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}
        >
          {/* Dashboard Fixed Row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              borderRadius: '8px',
              background: 'color-mix(in srgb, var(--accent-btn) 12%, transparent)',
              color: 'var(--accent-btn)',
              fontSize: '13px',
              fontWeight: 600
            }}
          >
            <NavIcon name="dashboard" />
            <span>Dashboard</span>
            <span style={{ marginLeft: 'auto', fontSize: '10px', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              fixed
            </span>
          </div>

          {/* Dynamic Middle Sections */}
          {layout.mode === 'minimal' ? (
            <div
              style={{
                padding: '16px 12px',
                textAlign: 'center',
                color: 'var(--text-faint)',
                fontSize: '12px',
                fontStyle: 'italic',
                borderTop: '1px dashed var(--border)',
                borderBottom: '1px dashed var(--border)',
                margin: '8px 0'
              }}
            >
              Middle modules hidden (Minimal mode)
            </div>
          ) : (
            nonLocked.map((sec) => {
              const isHidden = layout.mode === 'custom' && hidden.has(sec.key)
              if (isHidden) return null
              return (
                <div
                  key={sec.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    color: 'var(--text)',
                    fontSize: '13px',
                    opacity: 0.85
                  }}
                >
                  <span style={{ color: 'var(--text-muted)' }}>
                    <SectionGraphic name={sec.key} />
                  </span>
                  <span>{sec.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-faint)' }}>
                    ▼
                  </span>
                </div>
              )
            })
          )}

          {/* Settings Fixed Row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              borderRadius: '8px',
              color: 'var(--text-muted)',
              fontSize: '13px',
              marginTop: '6px',
              borderTop: '1px solid color-mix(in srgb, var(--border) 60%, transparent)'
            }}
          >
            <NavIcon name="settings" />
            <span>Settings</span>
            <span style={{ marginLeft: 'auto', fontSize: '10px', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              fixed
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
