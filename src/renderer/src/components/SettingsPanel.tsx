import { APP_DISPLAY_NAME } from '../../../shared/brand'
import type { AppSettings } from '../../../shared/ipc-contract'
import { modKey } from '../lib/shortcut-label'

interface SettingsPanelProps {
  open: boolean
  settings: AppSettings
  onClose: () => void
  onChange: (patch: Partial<AppSettings>) => void
  onClearAllProfiles: () => void
  onExportProfiles: () => void
  onImportProfiles: () => void
  onAdminLogout: () => void
}

export function SettingsPanel({
  open,
  settings,
  onClose,
  onChange,
  onClearAllProfiles,
  onExportProfiles,
  onImportProfiles,
  onAdminLogout
}: SettingsPanelProps): React.JSX.Element | null {
  if (!open) return null

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="settings-panel" role="dialog" aria-label="Settings">
        <header className="settings-header">
          <h2>Settings</h2>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <label className="settings-row">
          <span>Theme</span>
          <select
            value={settings.theme}
            onChange={(e) => onChange({ theme: e.target.value as AppSettings['theme'] })}
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
              onChange({
                sidebarDensity: e.target.value as AppSettings['sidebarDensity']
              })
            }
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>

        <label className="settings-row">
          <span>Desktop notifications</span>
          <input
            type="checkbox"
            checked={settings.notificationsEnabled}
            onChange={(e) => onChange({ notificationsEnabled: e.target.checked })}
          />
        </label>
        <p className="settings-hint" style={{ marginTop: 0 }}>
          Unread alerts show a Slack-style banner with the {APP_DISPLAY_NAME} logo (top-right).
          Unmute profiles in the sidebar if a profile is silent. Use Send test notification to
          preview.
        </p>

        <label className="settings-row">
          <span>Notification sound (beep on new unread)</span>
          <input
            type="checkbox"
            checked={settings.notificationSound}
            onChange={(e) => onChange({ notificationSound: e.target.checked })}
          />
        </label>

        <div className="settings-actions" style={{ marginTop: 0, marginBottom: 8 }}>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              void window.api.app.testNotification().then((r) => {
                window.alert(r.message)
              })
            }}
          >
            Send test notification
          </button>
        </div>

        <label className="settings-row">
          <span>Lock after idle (minutes)</span>
          <input
            type="number"
            min={1}
            max={240}
            value={settings.idleLockMinutes}
            onChange={(e) => onChange({ idleLockMinutes: Number(e.target.value) || 15 })}
          />
        </label>

        <label className="settings-row">
          <span>Sleep inactive embeds (minutes, 0=off)</span>
          <input
            type="number"
            min={0}
            max={240}
            value={settings.idleSleepMinutes}
            onChange={(e) => onChange({ idleSleepMinutes: Number(e.target.value) || 0 })}
          />
        </label>

        <label className="settings-row">
          <span>Split view</span>
          <input
            type="checkbox"
            checked={settings.splitViewEnabled}
            onChange={(e) => onChange({ splitViewEnabled: e.target.checked })}
          />
        </label>

        <div className="settings-actions">
          <button type="button" className="btn secondary" onClick={onExportProfiles}>
            Export profiles
          </button>
          <button type="button" className="btn secondary" onClick={onImportProfiles}>
            Import profiles
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              void window.api.app.checkUpdates().then((r) => {
                window.alert(r.message)
              })
            }}
          >
            Check for updates
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
          >
            Remove all profiles
          </button>
          <button type="button" className="btn secondary" onClick={onAdminLogout}>
            Sign out admin
          </button>
        </div>
        <p className="settings-hint">
          {modKey()}, opens settings · Auth / embed flows are unchanged.
        </p>
      </div>
    </div>
  )
}
