import React, { useState, useEffect, useCallback } from 'react'
import type { AppSettings } from '../../../../shared/ipc-contract'
import type { DashboardGlobalConfig } from '../../../../shared/dashboard-contract'
import { CustomLink, Profile } from '../../../../shared/types'
import { useProfileStore } from '../../hooks/useProfiles'
import { useDashboardStore } from '../../hooks/useDashboard'
import { DeleteConfirmNoticeModal, type ProfileDeleteTarget } from './DeleteConfirmNoticeModal'
import { modKey } from '../../lib/shortcut-label'
import AiSettingsForm from './AiSettingsForm'
import { LogsObservabilityTab } from './LogsObservabilityTab'
import { ScrapeLogsTab } from './ScrapeLogsTab'
export type SettingsTabKey =
  | 'general'
  | 'sidebar'
  | 'ai'
  | 'accounts'
  | 'logs'
  | 'scrape-logs'
  | 'maintenance'
  | 'advance'

interface UnifiedSettingsModalProps {
  open: boolean
  initialTab?: SettingsTabKey
  settings: AppSettings
  onClose: () => void
  onChangeSettings: (patch: Partial<AppSettings>) => void
  onClearAllProfiles: () => void
  onExportProfiles: () => void
  onImportProfiles: () => void
  onAdminLogout: () => void
  onAddGoogleAccount?: () => void
  onDeleteProfile?: (profileId: string, deleteCards?: boolean) => void
  onSelectProfile?: (profileId: string) => void
  onOpenCustomLink?: (profileId: string, link: CustomLink) => void
}

export function UnifiedSettingsModal({
  open,
  initialTab = 'general',
  settings,
  onClose,
  onChangeSettings,
  onClearAllProfiles,
  onExportProfiles,
  onImportProfiles,
  onAdminLogout,
  onAddGoogleAccount,
  onDeleteProfile,
  onSelectProfile: _onSelectProfile,
  onOpenCustomLink: _onOpenCustomLink
}: UnifiedSettingsModalProps): React.JSX.Element | null {
  const [activeTab, setActiveTab] = useState<SettingsTabKey>(initialTab)
  const [globalConfig, setGlobalConfig] = useState<DashboardGlobalConfig | null>(null)
  const [isAdvanceMode, setIsAdvanceMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('orbit:settings-advance-mode') === 'true'
    } catch {
      return false
    }
  })

  // Accounts state
  const profiles = useProfileStore((s) => s.profiles)
  const snapshot = useDashboardStore((s) => s.snapshot)
  const [deleteProfileTarget, setDeleteProfileTarget] = useState<ProfileDeleteTarget | null>(null)
  const [addingLinkForProfileId, setAddingLinkForProfileId] = useState<string | null>(null)
  const [customName, setCustomName] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      if (initialTab !== 'general' && initialTab !== 'advance') {
        setIsAdvanceMode(true)
      }
      setActiveTab(initialTab)
    }
  }, [open, initialTab])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = (): void => {
      void window.api.dashboard
        .getGlobalConfig()
        .then((next) => {
          if (!cancelled) setGlobalConfig(next)
        })
        .catch(() => undefined)
    }
    load()
    const off = window.api.dashboard.onConfigChanged((next) => {
      if (!cancelled) setGlobalConfig(next)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [open])

  const handleToggleSidebarVisibility = useCallback(async (profile: Profile) => {
    try {
      const nextHidden = !profile.hiddenInSidebar
      const updated = await window.api.profiles.setHiddenInSidebar(profile.id, nextHidden)
      useProfileStore.setState((prev) => ({
        profiles: prev.profiles.map((p) => (p.id === updated.id ? updated : p))
      }))
    } catch (err) {
      console.error('Failed to toggle profile sidebar visibility', err)
    }
  }, [])

  const handleToggleLinkVisibility = useCallback(async (profileId: string, link: CustomLink) => {
    try {
      const nextHidden = !link.hiddenInSidebar
      const updated = await window.api.profiles.setLinkHiddenInSidebar(profileId, link.id, nextHidden)
      useProfileStore.setState((prev) => ({
        profiles: prev.profiles.map((p) => (p.id === updated.id ? updated : p))
      }))
    } catch (err) {
      console.error('Failed to toggle link sidebar visibility', err)
    }
  }, [])

  const handleRemoveCustomLink = useCallback(async (profileId: string, linkId: string) => {
    try {
      const updated = await window.api.profiles.removeCustomLink(profileId, linkId)
      useProfileStore.setState((prev) => ({
        profiles: prev.profiles.map((p) => (p.id === updated.id ? updated : p))
      }))
    } catch (err) {
      console.error('Failed to remove custom link', err)
    }
  }, [])

  const handleAddCustomLink = async (profileId: string): Promise<void> => {
    if (!customUrl.trim()) return
    setErrorMsg(null)
    try {
      const finalName = customName.trim() || customUrl.trim()
      const updated = await window.api.profiles.addCustomLink(profileId, {
        name: finalName,
        url: customUrl.trim()
      })
      useProfileStore.setState((prev) => ({
        profiles: prev.profiles.map((p) => (p.id === updated.id ? updated : p))
      }))
      setAddingLinkForProfileId(null)
      setCustomName('')
      setCustomUrl('')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to add custom app')
    }
  }

  if (!open) return null

  const nvidiaStatus = globalConfig
    ? globalConfig.nvidia.status === 'ok'
      ? 'Connected'
      : globalConfig.nvidia.configured
        ? 'Saved, not verified'
        : 'Not configured'
    : 'Checking…'

  const allNavItems: Array<{ key: SettingsTabKey; label: string; icon: string }> = [
    { key: 'general', label: 'Preferences & Appearance', icon: '🎨' },
    { key: 'advance', label: 'Advance Control', icon: '🎛️' },
    { key: 'sidebar', label: 'Sidebar & Navigation', icon: '📑' },
    { key: 'ai', label: 'Global AI & NVIDIA NIM', icon: '🤖' },
    { key: 'accounts', label: 'Accounts & Workspaces', icon: '👥' },
    { key: 'logs', label: 'App Logs', icon: '📜' },
    { key: 'scrape-logs', label: 'Scrape Logs', icon: '🕷️' },
    { key: 'maintenance', label: 'System & Maintenance', icon: '🛡️' }
  ]

  const visibleNavItems = isAdvanceMode
    ? allNavItems
    : allNavItems.filter((item) => item.key === 'general' || item.key === 'advance')

  return (
    <div
      className="platform-settings-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{ zIndex: 1250 }}
    >
      <div
        className="platform-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Global Settings Hub"
        style={{
          width: 'min(1440px, 98vw)',
          height: 'min(92vh, 920px)',
          maxHeight: 'min(92vh, 920px)',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--surface-2)',
          borderRadius: '14px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.85)',
          overflow: 'hidden'
        }}
      >
        {/* Header Bar */}
        <header
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(15, 23, 42, 0.6)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '20px' }}>⚙️</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#f8fafc' }}>
                Cosmic Global Settings Hub
              </h2>
              <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>
                Single source of truth for global preferences, AI keys, team integrations, and accounts.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn ghost"
            onClick={onClose}
            style={{ color: '#94a3b8', fontSize: '13px' }}
          >
            ✕ Close
          </button>
        </header>

        {/* 2-Column Layout */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left Navigation Rail */}
          <aside
            style={{
              width: '260px',
              borderRight: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(10, 15, 29, 0.95)',
              padding: '16px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            {/* Advance Settings Mode Switch at top of sidebar */}
            <div
              style={{
                padding: '10px 12px',
                marginBottom: '8px',
                borderRadius: '8px',
                background: isAdvanceMode ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                border: isAdvanceMode ? '1px solid rgba(59, 130, 246, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#f1f5f9' }}>
                  ⚡ Advanced Settings
                </span>
                <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                  {isAdvanceMode ? 'All 7 tabs visible' : 'Basic view (2 tabs)'}
                </span>
              </div>
              <label
                style={{
                  position: 'relative',
                  display: 'inline-block',
                  width: '34px',
                  height: '18px',
                  cursor: 'pointer',
                  margin: 0
                }}
              >
                <input
                  type="checkbox"
                  checked={isAdvanceMode}
                  onChange={(e) => {
                    const next = e.target.checked
                    setIsAdvanceMode(next)
                    try {
                      localStorage.setItem('orbit:settings-advance-mode', String(next))
                    } catch {
                      // ignore localStorage errors
                    }
                    if (!next && activeTab !== 'general' && activeTab !== 'advance') {
                      setActiveTab('general')
                    }
                  }}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span
                  style={{
                    position: 'absolute',
                    cursor: 'pointer',
                    inset: 0,
                    backgroundColor: isAdvanceMode ? '#3b82f6' : 'rgba(255, 255, 255, 0.2)',
                    transition: '0.2s',
                    borderRadius: '18px'
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      height: '14px',
                      width: '14px',
                      left: isAdvanceMode ? '18px' : '2px',
                      bottom: '2px',
                      backgroundColor: 'white',
                      transition: '0.2s',
                      borderRadius: '50%'
                    }}
                  />
                </span>
              </label>
            </div>

            {visibleNavItems.map((item) => {
              const active = activeTab === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.key)
                    void window.api?.logs?.logAction('nav', 'info', `Switched settings tab to ${item.label}`)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: active ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    color: active ? '#60a5fa' : '#94a3b8',
                    border: active ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: active ? 600 : 500,
                    textAlign: 'left',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span style={{ fontSize: '16px' }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              )
            })}
          </aside>

          {/* Right Content Pane */}
          <main
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '24px 32px',
              background: 'var(--bg-page)'
            }}
          >
            {/* TAB: GENERAL / PREFERENCES */}
            {activeTab === 'general' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <header>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#f8fafc' }}>
                    Preferences &amp; Appearance
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94a3b8' }}>
                    Configure visual appearance, notifications, workspace layout, and system idle behaviors.
                  </p>
                </header>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Card 1: Application Appearance & Theme */}
                  <div
                    style={{
                      background: 'rgba(15, 23, 42, 0.4)',
                      padding: '18px 20px',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '14px', color: '#e2e8f0', fontWeight: 600 }}>
                          🎨 Application Appearance &amp; Theme
                        </h4>
                        <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                          Visual styling and spacing applied across all views
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: 'rgba(99, 102, 241, 0.15)',
                          color: '#c7d2fe',
                          border: '1px solid rgba(99, 102, 241, 0.3)'
                        }}
                      >
                        Entire App
                      </span>
                    </div>

                    <label className="settings-row">
                      <span>Theme</span>
                      <select
                        value={settings.theme}
                        onChange={(e) => onChangeSettings({ theme: e.target.value as AppSettings['theme'] })}
                      >
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                        <option value="system">System</option>
                      </select>
                    </label>

                    <label className="settings-row">
                      <span>Sidebar density</span>
                      <select
                        value={settings.sidebarDensity}
                        onChange={(e) =>
                          onChangeSettings({
                            sidebarDensity: e.target.value as AppSettings['sidebarDensity']
                          })
                        }
                      >
                        <option value="comfortable">Comfortable</option>
                        <option value="compact">Compact</option>
                      </select>
                    </label>
                  </div>

                  {/* Card 2: Workspace & Project Cards View */}
                  <div
                    style={{
                      background: 'rgba(15, 23, 42, 0.4)',
                      padding: '18px 20px',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '14px', color: '#e2e8f0', fontWeight: 600 }}>
                          🗂️ Workspace &amp; Project Cards View
                        </h4>
                        <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                          Layout and progress monitoring within main project views
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: 'rgba(56, 189, 248, 0.15)',
                          color: '#bae6fd',
                          border: '1px solid rgba(56, 189, 248, 0.3)'
                        }}
                      >
                        Main View &amp; Cards
                      </span>
                    </div>

                    <label className="settings-row">
                      <span>
                        Split view enabled
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Side-by-side workspace split viewing
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.splitViewEnabled}
                        onChange={(e) => onChangeSettings({ splitViewEnabled: e.target.checked })}
                      />
                    </label>

                    <label className="settings-row">
                      <span>
                        Show scraping progress line in cards
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Displays real-time channel &amp; message reader progress above embedded workspace views
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.showScrapeProgressLine ?? true}
                        onChange={(e) => onChangeSettings({ showScrapeProgressLine: e.target.checked })}
                      />
                    </label>

                    {/* Split view and progress line */}
                  </div>

                  {/* Card: Project Card Scraping Settings (Important Setting) */}
                  <div
                    style={{
                      background: 'rgba(15, 23, 42, 0.4)',
                      padding: '18px 20px',
                      borderRadius: '10px',
                      border: '1px solid rgba(99, 102, 241, 0.25)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '14px', color: '#e2e8f0', fontWeight: 600 }}>
                          🛡️ Project Card Scraping Settings
                        </h4>
                        <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                          Privacy controls, DM reading permissions, and schedule cadence for project cards
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: 'rgba(239, 68, 68, 0.15)',
                          color: '#fca5a5',
                          border: '1px solid rgba(239, 68, 68, 0.3)'
                        }}
                      >
                        Project Card Important Setting
                      </span>
                    </div>

                    <label className="settings-row">
                      <span>
                        Allow Personal Direct Messages (DMs) Scraping
                        <span style={{ display: 'block', fontSize: '11px', color: '#94a3b8' }}>
                          Default is <strong>OFF</strong>. When off, 1-on-1 direct messages and private conversations are never scraped. Each project card can also override this setting.
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={(globalConfig?.defaults?.allowDms ?? (settings.scrapePersonalDms ? 'on' : 'off')) === 'on'}
                        onChange={(e) => {
                          const isChecked = e.target.checked
                          onChangeSettings({ scrapePersonalDms: isChecked })
                          void window.api.dashboard.saveProjectDefaults({ allowDms: isChecked ? 'on' : 'off' })
                            .then((cfg) => setGlobalConfig(cfg))
                            .catch(console.error)
                        }}
                      />
                    </label>

                    <label className="settings-row">
                      <span>
                        Default Scheduled Scraping Interval
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Frequency of automatic background delta scrapes for cards
                        </span>
                      </span>
                      <select
                        value={globalConfig?.defaults?.intervalMinutes ?? 15}
                        onChange={(e) => {
                          const val = Number(e.target.value) as 1 | 5 | 15 | 30 | 60
                          void window.api.dashboard.saveProjectDefaults({ intervalMinutes: val })
                            .then((cfg) => setGlobalConfig(cfg))
                            .catch(console.error)
                        }}
                      >
                        <option value={1}>Every 1 minute (Fast testing)</option>
                        <option value={5}>Every 5 minutes</option>
                        <option value={15}>Every 15 minutes (Standard)</option>
                        <option value={30}>Every 30 minutes</option>
                        <option value={60}>Every 1 hour</option>
                      </select>
                    </label>

                    <label className="settings-row">
                      <span>
                        Sleep &amp; Wake Catch-Up Safety Ceiling
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Maximum history depth backfilled after sleep (with 2-min safety overlap)
                        </span>
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#38bdf8' }}>
                        {globalConfig?.defaults?.catchUpCapDays ?? 7} Days
                      </span>
                    </label>
                  </div>

                  {/* Card 3: Desktop Notifications & Alerts */}
                  <div
                    style={{
                      background: 'rgba(15, 23, 42, 0.4)',
                      padding: '18px 20px',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '14px', color: '#e2e8f0', fontWeight: 600 }}>
                          🔔 Desktop Notifications &amp; Alerts
                        </h4>
                        <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                          System banners and audio chimes for unread messages
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: 'rgba(251, 191, 36, 0.15)',
                          color: '#fde68a',
                          border: '1px solid rgba(251, 191, 36, 0.3)'
                        }}
                      >
                        System Alerts
                      </span>
                    </div>

                    <label className="settings-row">
                      <span>Desktop notifications</span>
                      <input
                        type="checkbox"
                        checked={settings.notificationsEnabled}
                        onChange={(e) => onChangeSettings({ notificationsEnabled: e.target.checked })}
                      />
                    </label>

                    <label className="settings-row">
                      <span>Notification sound (beep on new unread)</span>
                      <input
                        type="checkbox"
                        checked={settings.notificationSound}
                        onChange={(e) => onChangeSettings({ notificationSound: e.target.checked })}
                      />
                    </label>

                    <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '2px' }}>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => {
                          void window.api.app.testNotification().then((r) => {
                            window.alert(r.message)
                          })
                        }}
                        style={{ fontSize: '12px', padding: '6px 12px' }}
                      >
                        🔔 Send test notification
                      </button>
                    </div>
                  </div>

                  {/* Card 4: Power & Idle Security */}
                  <div
                    style={{
                      background: 'rgba(15, 23, 42, 0.4)',
                      padding: '18px 20px',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '14px', color: '#e2e8f0', fontWeight: 600 }}>
                          🔒 Power &amp; Idle Security
                        </h4>
                        <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                          Automatic inactivity locking and background resource preservation
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: 'rgba(168, 85, 247, 0.15)',
                          color: '#e9d5ff',
                          border: '1px solid rgba(168, 85, 247, 0.3)'
                        }}
                      >
                        Background &amp; Idle
                      </span>
                    </div>

                    <label className="settings-row">
                      <span>Lock after idle (minutes)</span>
                      <input
                        type="number"
                        min={1}
                        max={240}
                        value={settings.idleLockMinutes}
                        onChange={(e) => onChangeSettings({ idleLockMinutes: Number(e.target.value) || 15 })}
                      />
                    </label>

                    <label className="settings-row">
                      <span>Sleep inactive embeds (minutes, 0=off)</span>
                      <input
                        type="number"
                        min={0}
                        max={240}
                        value={settings.idleSleepMinutes}
                        onChange={(e) => onChangeSettings({ idleSleepMinutes: Number(e.target.value) || 0 })}
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: ADVANCE CONTROL */}
            {activeTab === 'advance' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <header>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#f8fafc' }}>
                    🎛️ Advance Control
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94a3b8' }}>
                    Fine-grained appearance look and profile default app preset configurations.
                  </p>
                </header>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Card 1: Appearance Look & Header */}
                  <div
                    style={{
                      background: 'rgba(15, 23, 42, 0.4)',
                      padding: '18px 20px',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '14px', color: '#e2e8f0', fontWeight: 600 }}>
                          👁️ Appearance Look &amp; Header
                        </h4>
                        <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                          Theme mode and header appearance controls at the top of the sidebar
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: 'rgba(99, 102, 241, 0.15)',
                          color: '#c7d2fe',
                          border: '1px solid rgba(99, 102, 241, 0.3)'
                        }}
                      >
                        Sidebar Header
                      </span>
                    </div>

                    <label className="settings-row">
                      <span>Default Appearance Look</span>
                      <select
                        value={settings.sidebarLook ?? 'ancient'}
                        onChange={(e) =>
                          onChangeSettings({
                            sidebarLook: e.target.value as 'minimal' | 'ancient' | 'new-cosmic' | 'basic'
                          })
                        }
                      >
                        <option value="basic">Basic Look (Simple foundation)</option>
                        <option value="minimal">Minimal Look (Clean &amp; compact)</option>
                        <option value="new-cosmic">New Cosmic (Futuristic exploration)</option>
                        <option value="ancient">Ancient Look (Default established theme)</option>
                      </select>
                    </label>

                    <label className="settings-row">
                      <span>
                        Show Look Switcher in Sidebar Header
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Displays the [ Basic ] [ Minimal ] [ Cosmic ] [ Ancient ] toggle row at the top of the sidebar
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.showLookSwitcher ?? true}
                        onChange={(e) =>
                          onChangeSettings({ showLookSwitcher: e.target.checked })
                        }
                      />
                    </label>
                  </div>

                  {/* Card 2: Default App Presets */}
                  <div
                    style={{
                      background: 'rgba(15, 23, 42, 0.4)',
                      padding: '18px 20px',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '14px', color: '#e2e8f0', fontWeight: 600 }}>
                          🧩 Default App Presets
                        </h4>
                        <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                          Initial apps and web platforms preloaded into new profiles
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: 'rgba(20, 184, 166, 0.15)',
                          color: '#99f6e4',
                          border: '1px solid rgba(20, 184, 166, 0.3)'
                        }}
                      >
                        Profile Presets
                      </span>
                    </div>

                    <div className="settings-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <span>Base Default Apps Layout</span>
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Choose the default messaging apps and tools shown when creating accounts
                        </span>
                      </div>
                      <select
                        value={settings.baseAppLayout ?? 'standard'}
                        onChange={(e) =>
                          onChangeSettings({
                            baseAppLayout: e.target.value as 'none' | 'standard' | 'extended' | 'full'
                          })
                        }
                        style={{
                          background: '#0f172a',
                          color: '#f8fafc',
                          border: '1px solid rgba(255,255,255,0.15)',
                          borderRadius: '6px',
                          padding: '6px 12px',
                          fontSize: '12px',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="none">Option 0: Minimal (No default apps — show only added websites)</option>
                        <option value="standard">Option 1 (Default): Standard 3 apps (Slack, Teams, WhatsApp)</option>
                        <option value="extended">Option 2: Extended (Slack, Teams, WhatsApp + Claude, ChatGPT)</option>
                        <option value="full">Option 3: All-in-One (Slack, Teams, WhatsApp + 6 top tools)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: SIDEBAR & NAVIGATION */}
            {activeTab === 'sidebar' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <header>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#f8fafc' }}>
                    Sidebar &amp; Navigation
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94a3b8' }}>
                    Customize which sections, looks, and buttons appear in the sidebar navigation rail.
                  </p>
                </header>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Card 1: Left Sidebar Navigation Rail */}
                  <div
                    style={{
                      background: 'rgba(15, 23, 42, 0.4)',
                      padding: '18px 20px',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '14px', color: '#e2e8f0', fontWeight: 600 }}>
                          📑 Left Sidebar Navigation Rail
                        </h4>
                        <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                          Items, shortcuts, and inputs rendered inside the left sidebar body
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: 'rgba(56, 189, 248, 0.15)',
                          color: '#bae6fd',
                          border: '1px solid rgba(56, 189, 248, 0.3)'
                        }}
                      >
                        Left Sidebar
                      </span>
                    </div>

                    <div className="settings-row" style={{ opacity: 0.9 }}>
                      <span>
                        Dashboard &amp; Projects
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Permanent anchor — always visible
                        </span>
                      </span>
                      <span style={{ fontSize: '11px', color: '#4ade80', fontWeight: 600 }}>Permanent</span>
                    </div>

                    <label className="settings-row">
                      <span>
                        Show Recent Workspaces
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Quick access strip showing recently active workspaces below Dashboard
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.showRecentSection ?? true}
                        onChange={(e) =>
                          onChangeSettings({ showRecentSection: e.target.checked })
                        }
                      />
                    </label>

                    <label className="settings-row">
                      <span>
                        Show Google Email Sign-In in Sidebar
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Display Google email input and Continue with Google button in the left sidebar
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.showGoogleEmailInputInSidebar ?? false}
                        onChange={(e) =>
                          onChangeSettings({ showGoogleEmailInputInSidebar: e.target.checked })
                        }
                      />
                    </label>

                    <label className="settings-row">
                      <span>
                        Show &quot;Observer View&quot; Header in Sidebar
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Display a subtle &quot;OBSERVER VIEW&quot; divider label above the bottom 6 sidebar action buttons
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.showObserverViewHeader ?? false}
                        onChange={(e) =>
                          onChangeSettings({ showObserverViewHeader: e.target.checked })
                        }
                      />
                    </label>

                    <label className="settings-row">
                      <span>
                        Show &quot;Profile&quot; Navigation Button
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Show the &quot;All Profiles&quot; (or &quot;Profile&quot;) quick navigation button in the sidebar
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.showSidebarProfileNavButton ?? settings.showCosmicProfileNavButtons ?? true}
                        onChange={(e) =>
                          onChangeSettings({
                            showSidebarProfileNavButton: e.target.checked
                          })
                        }
                      />
                    </label>

                    <label className="settings-row">
                      <span>
                        Show &quot;Dashboard&quot; Navigation Button
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Show the &quot;Full Dashboard&quot; (or &quot;Dashboard&quot;) quick navigation button in the sidebar
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.showSidebarDashboardNavButton ?? settings.showCosmicProfileNavButtons ?? true}
                        onChange={(e) =>
                          onChangeSettings({
                            showSidebarDashboardNavButton: e.target.checked
                          })
                        }
                      />
                    </label>

                    <label className="settings-row">
                      <span>
                        Show Quick Actions on Sidebar Items
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Show hide (👁) and remove (×) action buttons when hovering over custom links in the sidebar
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.showSidebarItemActions ?? true}
                        onChange={(e) =>
                          onChangeSettings({ showSidebarItemActions: e.target.checked })
                        }
                      />
                    </label>

                    <label className="settings-row">
                      <span>
                        Show &quot;Hide&quot; Button on Profile Headers in Sidebar
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Display the eye hide button (👁) next to profile names in the main sidebar. Disabled by default to prevent accidental profile hiding.
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.showSidebarProfileHideButton ?? false}
                        onChange={(e) =>
                          onChangeSettings({ showSidebarProfileHideButton: e.target.checked })
                        }
                      />
                    </label>
                  </div>

                  {/* Card 2: Modals & Creation Dialogs */}
                  <div
                    style={{
                      background: 'rgba(15, 23, 42, 0.4)',
                      padding: '18px 20px',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '14px', color: '#e2e8f0', fontWeight: 600 }}>
                          🪟 Modals &amp; Creation Dialogs
                        </h4>
                        <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                          Options shown inside popup creation dialogs for projects and profiles
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: 'rgba(234, 179, 8, 0.15)',
                          color: '#fef08a',
                          border: '1px solid rgba(234, 179, 8, 0.3)'
                        }}
                      >
                        Popups &amp; Dialogs
                      </span>
                    </div>

                    <label className="settings-row">
                      <span>
                        Show &quot;Linked Accounts &amp; Workspaces&quot; in New Project Modal
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Display the &quot;+ Add Accounts&quot; linking section when creating a new project card
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.showNewProjectLinkedAccounts ?? false}
                        onChange={(e) =>
                          onChangeSettings({ showNewProjectLinkedAccounts: e.target.checked })
                        }
                      />
                    </label>

                    <label className="settings-row">
                      <span>
                        Show Account Scope Selector in Profile Modal
                        <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                          Display Both / Global / Individual scope chips in the Add Profile dialog (defaults to Both when off)
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.showProfileScopeSelector ?? false}
                        onChange={(e) =>
                          onChangeSettings({ showProfileScopeSelector: e.target.checked })
                        }
                      />
                    </label>
                  </div>

                  {/* Card 3: Sidebar Bottom Action Buttons */}
                  <div
                    style={{
                      background: 'rgba(15, 23, 42, 0.4)',
                      padding: '18px 20px',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '14px', color: '#e2e8f0', fontWeight: 600 }}>
                          ⚡ Sidebar Bottom Action Buttons
                        </h4>
                        <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                          Grid automatically adjusts layout based on active buttons
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: 'rgba(236, 72, 153, 0.15)',
                          color: '#fbcfe8',
                          border: '1px solid rgba(236, 72, 153, 0.3)'
                        }}
                      >
                        Sidebar Footer Grid
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div className="settings-row" style={{ opacity: 0.9 }}>
                        <span>
                          ⚙️ Settings Button
                          <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
                            Permanent anchor — opens this Global Settings Hub
                          </span>
                        </span>
                        <span style={{ fontSize: '11px', color: '#4ade80', fontWeight: 600 }}>Permanent</span>
                      </div>

                      <label className="settings-row">
                        <span>🌐 + Website (Add Platform &amp; Custom Web Links)</span>
                        <input
                          type="checkbox"
                          checked={settings.sidebarButtons?.addWebsite ?? false}
                          onChange={(e) =>
                            onChangeSettings({
                              sidebarButtons: {
                                ...(settings.sidebarButtons ?? {
                                  addWebsite: false,
                                  newProject: false,
                                  newProfile: false,
                                  observer: false,
                                  profilesHub: false
                                }),
                                addWebsite: e.target.checked
                              }
                            })
                          }
                        />
                      </label>

                      <label className="settings-row">
                        <span>📁 + Project (Create Project / Workspace)</span>
                        <input
                          type="checkbox"
                          checked={settings.sidebarButtons?.newProject ?? false}
                          onChange={(e) =>
                            onChangeSettings({
                              sidebarButtons: {
                                ...(settings.sidebarButtons ?? {
                                  addWebsite: false,
                                  newProject: false,
                                  newProfile: false,
                                  observer: false,
                                  profilesHub: false
                                }),
                                newProject: e.target.checked
                              }
                            })
                          }
                        />
                      </label>

                      <label className="settings-row">
                        <span>👤 + Profile (Create Profile / Account)</span>
                        <input
                          type="checkbox"
                          checked={settings.sidebarButtons?.newProfile ?? false}
                          onChange={(e) =>
                            onChangeSettings({
                              sidebarButtons: {
                                ...(settings.sidebarButtons ?? {
                                  addWebsite: false,
                                  newProject: false,
                                  newProfile: false,
                                  observer: false,
                                  profilesHub: false
                                }),
                                newProfile: e.target.checked
                              }
                            })
                          }
                        />
                      </label>

                      <label className="settings-row">
                        <span>🔭 Observer (Live Workspace &amp; Observer View)</span>
                        <input
                          type="checkbox"
                          checked={settings.sidebarButtons?.observer ?? false}
                          onChange={(e) =>
                            onChangeSettings({
                              sidebarButtons: {
                                ...(settings.sidebarButtons ?? {
                                  addWebsite: false,
                                  newProject: false,
                                  newProfile: false,
                                  observer: false,
                                  profilesHub: false
                                }),
                                observer: e.target.checked
                              }
                            })
                          }
                        />
                      </label>

                      <label className="settings-row">
                        <span>👥 Profiles (Profiles &amp; Accounts Management Hub)</span>
                        <input
                          type="checkbox"
                          checked={settings.sidebarButtons?.profilesHub ?? false}
                          onChange={(e) =>
                            onChangeSettings({
                              sidebarButtons: {
                                ...(settings.sidebarButtons ?? {
                                  addWebsite: false,
                                  newProject: false,
                                  newProfile: false,
                                  observer: false,
                                  profilesHub: false
                                }),
                                profilesHub: e.target.checked
                              }
                            })
                          }
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: GLOBAL AI & NVIDIA */}
            {activeTab === 'ai' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <header>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#f8fafc' }}>
                    Global AI & NVIDIA NIM
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94a3b8' }}>
                    One global API key and default models for cards that do not specify individual overrides.
                  </p>
                </header>

                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.4)',
                    padding: '20px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255, 255, 255, 0.06)'
                  }}
                >
                  <AiSettingsForm />

                  <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                    <h5 style={{ margin: '0 0 10px', fontSize: '13px', color: '#cbd5e1' }}>Usage Overview</h5>
                    <div className="global-config-usage">
                      <div>
                        <b>{globalConfig?.usage.projects ?? 0}</b>
                        <span>projects</span>
                      </div>
                      <div>
                        <b>{globalConfig?.usage.usingGlobalAi ?? 0}</b>
                        <span>using global NVIDIA</span>
                      </div>
                      <div>
                        <b>{globalConfig?.usage.usingGlobalOurSlack ?? 0}</b>
                        <span>using global Our Slack</span>
                      </div>
                    </div>
                    <p style={{ fontSize: '12px', color: '#94a3b8', margin: '8px 0 0' }}>
                      Status: <span style={{ color: '#4ade80' }}>{nvidiaStatus}</span>
                      {globalConfig?.nvidia.apiKeyMask ? ` (${globalConfig.nvidia.apiKeyMask})` : ''}
                    </p>
                  </div>
                </div>
              </div>
            )}


            {/* TAB: ACCOUNTS & WORKSPACES */}
            {activeTab === 'accounts' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '16px', color: '#f8fafc' }}>
                      Accounts & Workspaces Hub
                    </h3>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94a3b8' }}>
                      Manage connected accounts, workspace sidebar visibility, and custom links.
                    </p>
                  </div>
                  {onAddGoogleAccount && (
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={onAddGoogleAccount}
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      + Add Google Account
                    </button>
                  )}
                </header>

                {errorMsg && (
                  <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', borderRadius: 6, fontSize: 13 }}>
                    {errorMsg}
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {profiles.map((profile) => (
                    <div
                      key={profile.id}
                      style={{
                        padding: '16px',
                        background: 'rgba(15, 23, 42, 0.4)',
                        borderRadius: '10px',
                        border: '1px solid rgba(255, 255, 255, 0.08)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '16px' }}>👤</span>
                          <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '14px' }}>
                            {profile.displayName || profile.id}
                          </span>
                          {profile.customName && profile.customName !== profile.displayName && (
                            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                              ({profile.customName})
                            </span>
                          )}
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              backgroundColor:
                                profile.googleAuthStatus === 'signed-in'
                                  ? 'rgba(34, 197, 94, 0.15)'
                                  : 'rgba(239, 68, 68, 0.15)',
                              color:
                                profile.googleAuthStatus === 'signed-in'
                                  ? '#4ade80'
                                  : '#f87171',
                              fontWeight: 500
                            }}
                          >
                            {profile.googleAuthStatus === 'signed-in' ? '● Verified' : '○ Not Signed In'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => void handleToggleSidebarVisibility(profile)}
                            style={{ fontSize: '12px', padding: '4px 10px', color: profile.hiddenInSidebar ? '#94a3b8' : '#60a5fa' }}
                          >
                            {profile.hiddenInSidebar ? '👁️ Show in Sidebar' : '👁️‍🗨️ Hide from Sidebar'}
                          </button>
                          {onDeleteProfile && (
                            <button
                              type="button"
                              className="btn ghost"
                              onClick={() => {
                                const linked = (snapshot?.projects ?? [])
                                  .filter((p) => p.project.profileId === profile.id)
                                  .map((p) => ({
                                    id: p.project.id,
                                    name: p.project.name || p.project.teamName || 'Card'
                                  }))
                                setDeleteProfileTarget({
                                  id: profile.id,
                                  name: profile.customName || profile.displayName,
                                  email: profile.displayName,
                                  cards: linked
                                })
                              }}
                              style={{ fontSize: '12px', padding: '4px 10px', color: '#f87171' }}
                              title="Permanently remove account"
                            >
                              🗑️ Delete
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Custom Links for this profile */}
                      <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <span style={{ fontSize: '12px', color: '#94a3b8' }}>Custom Web Apps & Links:</span>
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => setAddingLinkForProfileId(addingLinkForProfileId === profile.id ? null : profile.id)}
                            style={{ fontSize: '11px', padding: '2px 8px' }}
                          >
                            + Add Link
                          </button>
                        </div>

                        {addingLinkForProfileId === profile.id && (
                          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                            <input
                              type="text"
                              placeholder="Name (e.g. Jira)"
                              value={customName}
                              onChange={(e) => setCustomName(e.target.value)}
                              style={{ flex: 1, padding: '6px 10px', fontSize: '12px', background: '#020617', border: '1px solid rgba(255, 255, 255, 0.1)', color: '#fff', borderRadius: 4 }}
                            />
                            <input
                              type="text"
                              placeholder="URL (https://...)"
                              value={customUrl}
                              onChange={(e) => setCustomUrl(e.target.value)}
                              style={{ flex: 2, padding: '6px 10px', fontSize: '12px', background: '#020617', border: '1px solid rgba(255, 255, 255, 0.1)', color: '#fff', borderRadius: 4 }}
                            />
                            <button
                              type="button"
                              className="btn primary"
                              onClick={() => void handleAddCustomLink(profile.id)}
                              style={{ fontSize: '12px', padding: '6px 12px' }}
                            >
                              Save
                            </button>
                          </div>
                        )}

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {(!profile.customLinks || profile.customLinks.length === 0) && (
                            <span style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>No custom links added.</span>
                          )}
                          {(profile.customLinks ?? []).map((link) => (
                            <div
                              key={link.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '4px 8px',
                                background: 'rgba(255, 255, 255, 0.05)',
                                borderRadius: '4px',
                                fontSize: '12px'
                              }}
                            >
                              <span style={{ color: '#f8fafc' }}>{link.name}</span>
                              <button
                                type="button"
                                onClick={() => void handleToggleLinkVisibility(profile.id, link)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: link.hiddenInSidebar ? 0.4 : 1 }}
                                title={link.hiddenInSidebar ? 'Hidden in sidebar' : 'Visible in sidebar'}
                              >
                                {link.hiddenInSidebar ? '🔒' : '👁️'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleRemoveCustomLink(profile.id, link.id)}
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                                title="Remove link"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB: SYSTEM & MAINTENANCE */}
            {activeTab === 'maintenance' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <header>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#f8fafc' }}>
                    System & Maintenance
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94a3b8' }}>
                    Profile backup, updates, session resets, and admin credential control.
                  </p>
                </header>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                    background: 'rgba(15, 23, 42, 0.4)',
                    padding: '20px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255, 255, 255, 0.06)'
                  }}
                >
                  <div className="settings-actions" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={onExportProfiles}
                      style={{ width: '100%', justifyContent: 'center' }}
                    >
                      📦 Export profiles & configuration
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={onImportProfiles}
                      style={{ width: '100%', justifyContent: 'center' }}
                    >
                      📥 Import profiles & configuration
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        void window.api.app.checkUpdates().then((r) => {
                          window.alert(r.message)
                        })
                      }}
                      style={{ width: '100%', justifyContent: 'center' }}
                    >
                      🔄 Check for updates
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        if (
                          window.confirm(
                            'Remove all profiles and their local sessions? This cannot be undone.'
                          )
                        ) {
                          onClearAllProfiles()
                        }
                      }}
                      style={{ width: '100%', justifyContent: 'center', color: '#ef4444' }}
                    >
                      ⚠️ Remove all profiles & sessions
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={onAdminLogout}
                      style={{ width: '100%', justifyContent: 'center', color: '#ef4444' }}
                    >
                      🚪 Sign out admin
                    </button>
                  </div>
                  <p className="settings-hint" style={{ marginTop: '10px' }}>
                    {modKey()}, opens settings anytime · All credentials stay secure on local machine.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'logs' && <LogsObservabilityTab />}
            {activeTab === 'scrape-logs' && <ScrapeLogsTab />}
          </main>
        </div>
      </div>

      <DeleteConfirmNoticeModal
        open={Boolean(deleteProfileTarget)}
        onClose={() => setDeleteProfileTarget(null)}
        target={deleteProfileTarget ? { type: 'profile', profile: deleteProfileTarget } : null}
        onConfirmProfileDelete={async (profileId, deleteCards) => {
          if (onDeleteProfile) {
            onDeleteProfile(profileId, deleteCards)
          }
          setDeleteProfileTarget(null)
        }}
      />
    </div>
  )
}
