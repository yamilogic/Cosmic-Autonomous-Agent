import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useDashboardStore } from '../../hooks/useDashboard'

interface SecretsPanelProps {
  onClose: () => void
}

/**
 * Bottom-of-sidebar "Dashboard settings / secrets" surface:
 * paste manual xoxp tokens for workspaces not connected via OAuth,
 * and create projects (which channels each client project reads).
 */
export default function SecretsPanel({ onClose }: SecretsPanelProps): React.ReactElement {
  const snapshot = useDashboardStore((s) => s.snapshot)
  const addManualToken = useDashboardStore((s) => s.addManualToken)
  const upsertProject = useDashboardStore((s) => s.upsertProject)

  const [tokenKey, setTokenKey] = useState('')
  const [tokenValue, setTokenValue] = useState('')
  const [tokenMsg, setTokenMsg] = useState<string | null>(null)

  const [projectName, setProjectName] = useState('')
  const [clientName, setClientName] = useState('')
  const [selectedTokenKey, setSelectedTokenKey] = useState('')
  const [selectedChannels, setSelectedChannels] = useState<string[]>([])
  const [channels, setChannels] = useState<Array<{ id: string; name: string }>>([])
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [channelSource, setChannelSource] = useState<{ profileId: string; teamId: string } | null>(
    null
  )
  const [projectMsg, setProjectMsg] = useState<string | null>(null)

  const usedKeys = useMemo(() => snapshot?.manualTokens.map((t) => t.key) ?? [], [snapshot])

  // resolve channels from the chosen token source (OAuth workspace or manual vault key)
  useEffect(() => {
    void (async () => {
      setLoadingChannels(true)
      try {
        if (selectedTokenKey) {
          setChannels(
            await window.api.dashboard
              .listChannels({
                tokenSource: 'manual',
                manualTokenKey: selectedTokenKey
              })
              .then((found: Array<{ id: string; name: string }>) =>
                found.map((c) => ({ id: c.id, name: c.name }))
              )
          )
          setChannelSource({ profileId: `manual:${selectedTokenKey}`, teamId: 'manual' })
        } else {
          const profiles = await window.api.profiles.list()
          const first = profiles[0]
          if (!first) return
          const workspaces = await window.api.slack.listWorkspaces(first.id)
          const teamId = workspaces[0]?.teamId ?? ''
          setChannelSource({ profileId: first.id, teamId })
          if (teamId) {
            const found = await window.api.dashboard.listChannels({
              tokenSource: 'oauth',
              profileId: first.id,
              teamId
            })
            setChannels(found.map((c) => ({ id: c.id, name: c.name })))
          }
        }
      } finally {
        setLoadingChannels(false)
      }
    })()
  }, [selectedTokenKey])

  const saveToken = async (): Promise<void> => {
    if (!tokenKey.trim() || !tokenValue.trim()) return
    const result = await addManualToken(tokenKey.trim(), tokenValue.trim())
    setTokenMsg(
      result.valid
        ? `✅ token saved (${tokenKey.trim()})`
        : `❌ ${result.error ?? 'token rejected'} — nothing was saved`
    )
    if (result.valid) {
      setTokenKey('')
      setTokenValue('')
    }
  }

  const createProject = async (): Promise<void> => {
    if (!projectName.trim()) {
      setProjectMsg('❌ name is required')
      return
    }
    if (selectedChannels.length === 0) {
      setProjectMsg('❌ pick at least one channel')
      return
    }
    await upsertProject({
      name: projectName.trim(),
      clientName: clientName.trim() || projectName.trim(),
      profileId: channelSource?.profileId ?? 'manual',
      teamId: channelSource?.teamId ?? '',
      appId: 'slack',
      tokenSource: selectedTokenKey ? 'manual' : 'oauth',
      manualTokenKey: selectedTokenKey || undefined,
      monitors: selectedChannels.map((id) => ({
        channelId: id,
        channelName: channels.find((c) => c.id === id)?.name ?? id
      }))
    })
    setProjectMsg('✅ project created — it syncs every 5 minutes')
    setProjectName('')
    setClientName('')
    setSelectedChannels([])
  }

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <section
        className="settings-panel dash-secrets-panel"
        role="dialog"
        aria-label="Dashboard secrets"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-header">
          <h3>Dashboard — Secrets &amp; Projects</h3>
        </header>

        <h4>Manual workspace token (xoxp)</h4>
        <label className="settings-row">
          <p className="settings-hint">
            Vault key (e.g. <code>DASH_TOKEN_ACME</code>)
          </p>
          <input
            value={tokenKey}
            onChange={(e) => setTokenKey(e.target.value.toUpperCase())}
            placeholder="DASH_TOKEN_ACME"
          />
        </label>
        <label className="settings-row">
          <p className="settings-hint">
            Paste a user token with scopes: channels/groups read+history, team:read, users:read,
            users.profile:read, im/mpim read+history, emoji:read
          </p>
          <input
            type="password"
            value={tokenValue}
            onChange={(e) => setTokenValue(e.target.value)}
            placeholder="xoxp-…"
          />
        </label>
        <div className="settings-actions">
          <button type="button" className="dash-primary" onClick={() => void saveToken()}>
            Validate &amp; save
          </button>
        </div>
        {tokenMsg ? <p className="settings-hint">{tokenMsg}</p> : null}
        {usedKeys.length > 0 ? (
          <p className="settings-hint">Saved vault keys: {usedKeys.join(', ')}</p>
        ) : null}

        <hr />
        <h4>New project card</h4>
        <label className="settings-row">
          <p className="settings-hint">Project name (the card title)</p>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Acme redesign"
          />
        </label>
        <label className="settings-row">
          <p className="settings-hint">Client</p>
          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Acme Corp"
          />
        </label>
        {loadingChannels ? <p className="settings-hint">Loading channels…</p> : null}

        <label className="settings-row">
          <p className="settings-hint">
            Token source — Workspace has been OAuth-connected already, or use a manual vault key
          </p>
          <select
            value={selectedTokenKey}
            onChange={(e) => {
              setSelectedTokenKey(e.target.value)
              setSelectedChannels([])
            }}
          >
            <option value="">OAuth (the workspace connected in the app)</option>
            {snapshot?.manualTokens.map((t) => (
              <option key={t.key} value={t.key}>
                {t.key}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="dash-channel-picker">
          <legend>Monitored channels</legend>
          {channels.map((c) => (
            <label key={c.id} className="dash-channel-option">
              <input
                type="checkbox"
                checked={selectedChannels.includes(c.id)}
                onChange={(e) => {
                  setSelectedChannels((prev) =>
                    e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                  )
                }}
              />
              <span>#{c.name}</span>
            </label>
          ))}
          {channels.length === 0 && !loadingChannels ? (
            <p className="settings-hint">No channels visible — connect a workspace first.</p>
          ) : null}
        </fieldset>

        <div className="settings-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="dash-primary" onClick={() => void createProject()}>
            Create project
          </button>
        </div>
        {projectMsg ? <p className="settings-hint">{projectMsg}</p> : null}
      </section>
    </div>
  )
}
