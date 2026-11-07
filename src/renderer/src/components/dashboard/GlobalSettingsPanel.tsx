import type React from 'react'
import { useEffect, useState } from 'react'
import type {
  DashboardGlobalConfig
} from '../../../../shared/dashboard-contract'
import AiSettingsForm from './AiSettingsForm'
import TeamSlackSettings from './TeamSlackSettings'
import StorageCleanerPanel from './StorageCleanerPanel'

interface GlobalSettingsPanelProps {
  open: boolean
  onClose: () => void
}

/**
 * The dashboard's one app-level config: Our Slack and NVIDIA. Per-project
 * overrides live on each card's Settings tab; this surface is only the default.
 */
export default function GlobalSettingsPanel({
  open,
  onClose
}: GlobalSettingsPanelProps): React.ReactElement | null {
  const [config, setConfig] = useState<DashboardGlobalConfig | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = (): void => {
      void window.api.dashboard
        .getGlobalConfig()
        .then((next) => {
          if (!cancelled) setConfig(next)
        })
        .catch(() => undefined)
    }
    load()
    const off = window.api.dashboard.onConfigChanged((next) => {
      if (!cancelled) setConfig(next)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [open])

  if (!open) return null

  const nvidiaStatus = config
    ? config.nvidia.status === 'ok'
      ? 'Connected'
      : config.nvidia.configured
        ? 'Saved, not verified'
        : 'Not configured'
    : 'Checking…'

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="settings-panel global-settings-panel"
        role="dialog"
        aria-label="Global settings"
      >
        <header className="settings-header">
          <div>
            <h2>Global settings</h2>
            <p className="settings-hint">
              Set once for every card. A project keeps its own client workspace; it can override AI
              or Our Slack later from its Settings tab.
            </p>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <section className="ws-settings-section global-settings-section">
          <div className="ws-settings-head">
            <h4>1. Our Slack</h4>
            <p>
              Your own team workspace, connected once. Each project chooses the channels the agent
              may read from it.
            </p>
          </div>
          <TeamSlackSettings />
        </section>

        <section className="ws-settings-section global-settings-section">
          <div className="ws-settings-head">
            <h4>2. NVIDIA NIM</h4>
            <p>
              One API key, chat model, and embedding model for cards that do not override them. Keys
              stay in the main process.
            </p>
          </div>
          <AiSettingsForm />
        </section>

        <section className="ws-settings-section global-settings-section">
          <div className="ws-settings-head">
            <h4>3. Storage &amp; Cache Cleaner</h4>
            <p>
              Inspect global sessions, profiles, and card partitions. Safely purge temporary HTTP,
              V8 code, and service worker caches without losing logins.
            </p>
          </div>
          <StorageCleanerPanel />
        </section>

        <section className="ws-settings-section global-settings-section">
          <div className="ws-settings-head">
            <h4>Used by</h4>
          </div>
          <div className="global-config-usage">
            <div>
              <b>{config?.usage.projects ?? 0}</b>
              <span>projects</span>
            </div>
            <div>
              <b>{config?.usage.usingGlobalAi ?? 0}</b>
              <span>using global NVIDIA</span>
            </div>
            <div>
              <b>{config?.usage.usingGlobalOurSlack ?? 0}</b>
              <span>using global Our Slack</span>
            </div>
          </div>
          <p className="ai-settings-hint">
            Our Slack:{' '}
            {config?.ourSlack.connected
              ? (config.ourSlack.teamName ?? 'connected')
              : 'not connected'}{' '}
            · NVIDIA: {nvidiaStatus}
            {config?.nvidia.apiKeyMask ? ` (${config.nvidia.apiKeyMask})` : ''}
          </p>
        </section>
      </div>
    </div>
  )
}
