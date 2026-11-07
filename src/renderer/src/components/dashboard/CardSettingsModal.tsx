import type React from 'react'
import { useState, useCallback } from 'react'
import { SidebarLayout, LayoutMode, DEFAULT_LAYOUT, SIDEBAR_REGISTRY } from './sidebar-layout'
import { loadSidebarLayout, saveSidebarLayout } from './use-sidebar-layout'

interface CardSettingsModalProps {
  open: boolean
  projectId: string
  projectName: string
  onClose: () => void
  onSaveLayout?: (layout: SidebarLayout) => void
}

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'channels', label: 'Channels' },
  { key: 'sidebar', label: 'Sidebar layout' },
  { key: 'advanced', label: 'Advanced' },
  { key: 'danger', label: 'Danger zone' }
] as const

type TabKey = (typeof TABS)[number]['key']

function loadLayout(projectId: string): SidebarLayout {
  return loadSidebarLayout(projectId)
}

function saveLayout(projectId: string, layout: SidebarLayout): void {
  saveSidebarLayout(projectId, layout)
}

const ICON_MAP: Record<string, React.ReactNode> = {
  dashboard: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M3 9l18-18"/></svg>,
  xomni: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2v20M2 12h20"/></svg>,
  slack: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 8c-1.4 0-2.7.9-3.2 2.1l-1.4-2.3C9.5 5.2 8.2 4 6.7 4S3.9 5.2 3.4 7.3c-.5 1.2-.6 2.6-.2 3.8l2.4-1.8c.3-.4.8-.6 1.3-.6 1.3 0 2.4 1.1 2.4 2.4 0 1.4-1.1 2.5-2.4 2.5-0.5 0-1-.2-1.3-.6L1 15c.4 1.2.3 2.6-.2 3.8-0.5 1.2-.3 2.6.5 3.8 1.2 1.8 2.9 2.9 4.8 2.9 1.4 0 2.7-0.3 3.9-1l1.4 2.3c0.5 1.2 1.8 2 3.2 2 1.3 0 2.6-0.7 3.2-2l1.4-2.3c0.5-1.2 0.3-2.6-0.2-3.8-0.5-1.2-1.5-2.2-2.7-2.2-1.3 0-2.4 1-2.4 2.4 0 1.4 1.1 2.5 2.4 2.5 0.5 0 1 0.2 1.3 0.6l2.4 1.8c-0.4-1.2-0.3-2.6 0.2-3.8 0.5-1.2 1.5-2.2 2.7-2.2 1.3 0 2.4-1 2.4-2.4 0-1.4-1.1-2.5-2.4-2.5z"/></svg>,
  info: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>,
  viz: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="4"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="4"/></svg>,
  settings: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33-1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
}

export default function CardSettingsModal({
  open, projectId, projectName, onClose, onSaveLayout
}: CardSettingsModalProps): React.ReactElement | null {
  if (!open) return null

  const [activeTab, setActiveTab] = useState<TabKey>('sidebar')
  const [layout, setLayout] = useState<SidebarLayout>(() => loadLayout(projectId))
  const [unsaved, setUnsaved] = useState(false)

  const handleTabChange = useCallback((key: TabKey) => { setActiveTab(key) }, [])
  const handleModeChange = useCallback((mode: LayoutMode) => {
    setLayout((prev) => { setUnsaved(true); return { ...prev, mode } })
  }, [])
  const handleToggleSection = useCallback((sectionKey: string) => {
    setLayout((prev) => {
      const hidden = new Set(prev.custom.hiddenSections)
      if (hidden.has(sectionKey)) hidden.delete(sectionKey)
      else hidden.add(sectionKey)
      setUnsaved(true)
      return { ...prev, custom: { ...prev.custom, hiddenSections: [...hidden] } }
    })
  }, [])
  const handleReset = useCallback(() => { setLayout({ ...DEFAULT_LAYOUT }); setUnsaved(true) }, [])
  const handleSave = useCallback(() => {
    saveLayout(projectId, layout)
    setUnsaved(false)
    onSaveLayout?.(layout)
  }, [projectId, layout, onSaveLayout])
  const modeSelected = (mode: LayoutMode) => layout.mode === mode

  return (
    <div role="dialog" aria-modal="true" aria-label="Card Settings"
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', padding: '16px' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: '16px', width: '100%', maxWidth: '720px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 48px rgba(0,0,0,0.4)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-panel)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text)' }}>Card Settings</h2>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>{projectName} · project settings</p>
          </div>
          <button type="button" onClick={onClose} style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-panel)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Close settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-panel)', overflowX: 'auto' }}>
          {TABS.map((tab) => {
            const selected = activeTab === tab.key
            return (
              <button key={tab.key} type="button" onClick={() => handleTabChange(tab.key)} style={{ flex: 'none', padding: '12px 16px', fontSize: '12px', fontWeight: 600, color: selected ? 'var(--accent)' : 'var(--text-muted)', borderBottom: selected ? '2px solid var(--accent)' : '2px solid transparent', background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>{tab.label}</button>
            )
          })}
        </div>
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          {activeTab === 'general' && <GeneralTab projectName={projectName} />}
          {activeTab === 'channels' && <ChannelsTab projectId={projectId} />}
          {activeTab === 'sidebar' && <SidebarLayoutTab layout={layout} onModeChange={handleModeChange} onToggleSection={handleToggleSection} onReset={handleReset} modeSelected={modeSelected} />}
          {activeTab === 'advanced' && <AdvancedTab />}
          {activeTab === 'danger' && <DangerTab projectName={projectName} onClose={onClose} />}
        </div>
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-panel)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" onClick={onClose} disabled={!unsaved} style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 600, borderRadius: '10px', background: 'transparent', border: '1px solid var(--border-panel)', color: 'var(--text-muted)', cursor: !unsaved ? 'not-allowed' : 'pointer', opacity: !unsaved ? 0.5 : 1 }}>Cancel</button>
          {unsaved && <button type="button" onClick={handleSave} style={{ padding: '8px 18px', fontSize: '13px', fontWeight: 600, borderRadius: '10px', background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', cursor: 'pointer' }}>Save changes</button>}
        </div>
      </div>
    </div>
  )

function GeneralTab({ projectName }: { projectName: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-panel)', borderRadius: '14px', padding: '16px 20px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-label)', margin: '0 0 12px' }}>Card identity</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-panel)' }}>
            <span style={{ fontSize: '13px', color: 'var(--text)' }}>Project name</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{projectName}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
            <span style={{ fontSize: '13px', color: 'var(--text)' }}>Workspace</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Slack · {projectName}</span>
          </div>
        </div>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>General card preferences. Channels and sidebar layout are configured on their own tabs.</p>
    </div>
  )
}

function ChannelsTab({ }: { projectId: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-panel)', borderRadius: '14px', padding: '16px 20px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-label)', margin: '0 0 12px' }}>Monitored channels</p>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 12px' }}>Choose which Slack channels feed this card. Changes take effect on next sync.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0' }}>
            <input type="checkbox" id="chan-general" defaultChecked style={{ accentColor: 'var(--accent)' }} />
            <label htmlFor="chan-general" style={{ fontSize: '13px', color: 'var(--text)', cursor: 'pointer', flex: 1 }}>#general</label>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--success)' }}>Active</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderTop: '1px solid var(--border-panel)' }}>
            <input type="checkbox" id="chan-random" defaultChecked style={{ accentColor: 'var(--accent)' }} />
            <label htmlFor="chan-random" style={{ fontSize: '13px', color: 'var(--text)', cursor: 'pointer', flex: 1 }}>#random</label>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Synced 2h ago</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function AdvancedTab(): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-panel)', borderRadius: '14px', padding: '16px 20px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-label)', margin: '0 0 12px' }}>Sync & performance</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: '1px solid var(--border-panel)' }}>
          <input type="checkbox" id="adv-auto-sync" defaultChecked style={{ accentColor: 'var(--accent)' }} />
          <label htmlFor="adv-auto-sync" style={{ fontSize: '13px', color: 'var(--text)', cursor: 'pointer', flex: 1 }}>Auto-sync on card open</label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0' }}>
          <input type="checkbox" id="adv-notifications" defaultChecked style={{ accentColor: 'var(--accent)' }} />
          <label htmlFor="adv-notifications" style={{ fontSize: '13px', color: 'var(--text)', cursor: 'pointer', flex: 1 }}>Desktop notifications for this card</label>
        </div>
      </div>
    </div>
  )
}

function DangerTab({ projectName, onClose }: { projectName: string; onClose: () => void }): React.ReactElement {
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-panel)', borderRadius: '14px', padding: '16px 20px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-label)', margin: '0 0 12px' }}>Remove card</p>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>Removing this card will delete the project and all its synced data. This cannot be undone.</p>
      </div>
      {confirmDelete ? (
        <div style={{ background: '#3d2024', border: '1px solid #5c2a2a', borderRadius: '14px', padding: '16px 20px' }}>
          <p style={{ fontSize: '13px', color: '#ff9a9a', fontWeight: 600, margin: '0 0 12px' }}>Type "{projectName}" to confirm removal</p>
          <input type="text" autoFocus style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', background: 'var(--bg-card)', border: '1px solid var(--border-panel)', color: 'var(--text)', fontSize: '13px', fontFamily: 'ui-monospace, monospace' }} />
          <div style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
            <button type="button" onClick={() => setConfirmDelete(false)} style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 600, borderRadius: '10px', background: 'transparent', border: '1px solid var(--border-panel)', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
            <button type="button" onClick={() => onClose()} style={{ padding: '8px 18px', fontSize: '12px', fontWeight: 600, borderRadius: '10px', background: '#ff7a7a', color: '#1a1426', border: 'none', cursor: 'pointer' }}>Remove project</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirmDelete(true)} style={{ padding: '8px 18px', fontSize: '13px', fontWeight: 600, borderRadius: '10px', background: 'transparent', border: '1px solid #ff7a7a', color: '#ff7a7a', cursor: 'pointer' }}>Remove project</button>
      )}
    </div>
  )
}

function sectionIcon(key: string): React.ReactNode {
  return ICON_MAP[key] || <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
}

interface SidebarLayoutTabProps {
  layout: SidebarLayout
  onModeChange: (mode: LayoutMode) => void
  onToggleSection: (sectionKey: string) => void
  onReset: () => void
  modeSelected: (mode: LayoutMode) => boolean
}

function SidebarLayoutTab({ layout, onModeChange, onToggleSection, onReset, modeSelected: _modeSelected }: SidebarLayoutTabProps): React.ReactElement {
  const nonLocked = SIDEBAR_REGISTRY.filter((s) => !s.locked)
  const hidden = new Set(layout.custom.hiddenSections)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-label)', margin: '0 0 12px' }}>Layout mode</p>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 12px' }}>Choose what appears in the card's left sidebar.</p>
        <div style={{ display: 'flex', gap: '10px' }}>
          {[
            { key: 'minimal', label: 'Minimal', desc: 'Dashboard only', icon: 'dashboard' },
            { key: 'full', label: 'Full', desc: 'Everything', icon: 'slack' },
            { key: 'custom', label: 'Custom', desc: 'Your own arrangement', icon: 'settings' }
          ].map((m) => {
            const selected = layout.mode === m.key
            return (
              <button key={m.key} type="button" onClick={() => onModeChange(m.key as LayoutMode)} style={{ flex: 1, padding: '16px', borderRadius: '12px', border: selected ? '2px solid var(--accent)' : '1px solid var(--border-panel)', background: selected ? 'var(--accent-soft)' : 'var(--bg-panel)', color: selected ? 'var(--accent)' : 'var(--text)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '8px', transition: 'all 0.2s' }}>
                <div style={{ fontSize: '13px', fontWeight: 700 }}>{m.label}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{m.desc}</div>
                <div style={{ marginTop: 'auto', fontSize: '12px' }}>{sectionIcon(m.icon)}</div>
              </button>
            )
          })}
        </div>
      </div>
      {layout.mode === 'custom' && (
        <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-panel)', borderRadius: '14px', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-label)', margin: 0 }}>Arrange</p>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>(Custom only)</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {nonLocked.map((section) => {
                const isHidden = hidden.has(section.key)
                return (
                  <div key={section.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '10px', background: isHidden ? 'var(--bg-card)' : 'var(--bg-panel)', border: `1px solid ${isHidden ? 'var(--border-panel)' : 'var(--border-btn)'}`, cursor: 'pointer' }} onClick={() => onToggleSection(section.key)}>
                    <div style={{ fontSize: '13px', color: isHidden ? 'var(--text-muted)' : 'var(--text)', fontWeight: 600, flex: 1 }}>{section.label}</div>
                    {sectionIcon(section.key)}
                    <span style={{ fontSize: '10px', fontWeight: 700, color: isHidden ? 'var(--success)' : 'var(--accent)' }}>{isHidden ? 'Hidden' : 'Visible'}</span>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ padding: '8px 12px', borderRadius: '10px', background: 'var(--bg-panel)', border: '1px solid var(--border-panel)', fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>Drag to reorder sections (coming soon)</div>
            </div>
          </div>
        </div>
      )}
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-panel)', borderRadius: '14px', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-label)', margin: 0 }}>Live preview</p>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>(sidebar jaisa hi dikhega)</span>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: '12px', padding: '12px', height: '200px', overflow: 'hidden' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-label)', marginBottom: '10px' }}>Dashboard (fixed)</div>
          {nonLocked.map((section) => {
            const isHidden = hidden.has(section.key)
            if (isHidden) return null
            return (
              <div key={section.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 0', fontSize: '12px', color: 'var(--text)' }}>
                {sectionIcon(section.key)}
                <span style={{ fontWeight: 500 }}>{section.label}</span>
              </div>
            )
          })}
          <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid var(--border-panel)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              {sectionIcon('settings')}
              <span style={{ fontWeight: 600 }}>Settings (fixed)</span>
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onReset} style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 600, borderRadius: '10px', background: 'transparent', border: '1px solid var(--border-panel)', color: 'var(--text-muted)', cursor: 'pointer' }}>Reset to Full</button>
      </div>
    </div>
  )
}
}
