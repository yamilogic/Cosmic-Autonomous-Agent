import type React from 'react'
import { useEffect, useState } from 'react'
import type {
  DashboardTeamWorkspace,
  DashboardTeamWorkspaceCandidate
} from '../../../../shared/dashboard-contract'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const SOURCE_LABEL: Record<DashboardTeamWorkspace['source'], string> = {
  oauth: 'Connected account',
  manual: 'Bot token',
  none: 'Not connected'
}

/**
 * Global Our Slack: connect one workspace once. Channels are selected per
 * project (wizard + card settings), so this surface only owns the connection.
 */
export default function TeamSlackSettings(): React.ReactElement {
  const [workspace, setWorkspace] = useState<DashboardTeamWorkspace | null>(null)
  const [candidates, setCandidates] = useState<DashboardTeamWorkspaceCandidate[]>([])
  const [choice, setChoice] = useState('')
  const [manualToken, setManualToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [howToOpen, setHowToOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [current, list] = await Promise.all([
          window.api.dashboard.getTeamWorkspace(),
          window.api.dashboard.listTeamWorkspaceCandidates()
        ])
        if (cancelled) return
        setWorkspace(current)
        setCandidates(list)
      } catch (err) {
        if (!cancelled) setError(errorText(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function connect(): Promise<void> {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const selected = candidates.find((c) => c.teamId === choice)
      const next =
        selected !== undefined
          ? await window.api.dashboard.connectTeamWorkspace({
              source: 'oauth',
              profileId: selected.profileId,
              teamId: selected.teamId
            })
          : await window.api.dashboard.connectTeamWorkspace({
              source: 'manual',
              token: manualToken.trim()
            })
      setWorkspace(next)
      setManualToken('')
      setReplacing(false)
      setNotice('Connected. Each project can now choose its Our Slack channels.')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function disconnect(): Promise<void> {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const next = await window.api.dashboard.clearTeamWorkspace()
      setWorkspace(next)
      setNotice('Disconnected. Stored messages are kept.')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <p className="ai-settings-hint">Checking Our Slack…</p>
  }

  if (workspace?.connected && !replacing) {
    return (
      <div className="ai-settings">
        <div className="global-config-connected">
          <div>
            <span className="ai-settings-label">Connected workspace</span>
            <b>{workspace.teamName ?? workspace.teamId}</b>
            <small className="ai-settings-hint">
              {SOURCE_LABEL[workspace.source]}
              {workspace.maskedToken ? ` ${workspace.maskedToken}` : ''}
              {workspace.teamDomain ? ` · ${workspace.teamDomain}.slack.com` : ''}
            </small>
          </div>
          {workspace.status === 'connected' ? (
            <span className="global-config-status is-ok">Connected</span>
          ) : (
            <span className="ws-detail-badge tone-danger team-reconnect-badge">
              Needs reconnect
            </span>
          )}
        </div>

        <p className="ai-settings-hint">
          {workspace.lastVerifiedAt
            ? `Last checked ${new Date(workspace.lastVerifiedAt).toLocaleString()}.`
            : 'Not checked yet.'}{' '}
          The bot must be invited to the channels a project selects.
        </p>

        <div className="ai-settings-actions">
          <button
            type="button"
            className="dash-subtle"
            disabled={busy}
            onClick={() => {
              setReplacing(true)
              setNotice(null)
              setError(null)
            }}
          >
            Replace token
          </button>
          <button
            type="button"
            className="dash-subtle"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            {busy ? 'Working…' : 'Disconnect'}
          </button>
        </div>

        {error ? <p className="ai-settings-error">{error}</p> : null}
        {notice ? <p className="ai-settings-notice">{notice}</p> : null}
      </div>
    )
  }

  return (
    <div className="ai-settings">
      <label className="ai-settings-field">
        <span>Use a workspace already connected to this app</span>
        <select
          value={choice}
          disabled={busy || candidates.length === 0}
          onChange={(e) => {
            setChoice(e.target.value)
            setNotice(null)
          }}
        >
          <option value="">
            {candidates.length === 0
              ? 'None connected yet — paste a bot token below'
              : 'Pick a workspace'}
          </option>
          {candidates.map((candidate) => (
            <option key={candidate.teamId} value={candidate.teamId}>
              {candidate.teamName} · {candidate.profileName}
            </option>
          ))}
        </select>
      </label>

      <label className="ai-settings-field">
        <span>Or paste a Slack bot token</span>
        <div className="ai-settings-inline">
          <input
            type={showToken ? 'text' : 'password'}
            value={manualToken}
            disabled={busy || choice !== ''}
            placeholder="xoxb-…"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setManualToken(e.target.value)}
          />
          <button
            type="button"
            className="dash-subtle"
            disabled={busy || choice !== ''}
            onClick={() => setShowToken((prev) => !prev)}
          >
            {showToken ? 'Hide' : 'Show'}
          </button>
        </div>
        <small className="ai-settings-hint">
          Verified with Slack before saving. Required scopes: channels:read, groups:read,
          channels:history, groups:history, users:read, chat:write. Encrypted in the main process;
          never sent back to this window.
        </small>
      </label>

      <div className="ai-settings-actions">
        <button
          type="button"
          className="dash-primary"
          disabled={busy || (choice === '' && manualToken.trim() === '')}
          onClick={() => void connect()}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        {replacing ? (
          <button
            type="button"
            className="dash-subtle"
            disabled={busy}
            onClick={() => {
              setReplacing(false)
              setManualToken('')
              setError(null)
            }}
          >
            Cancel
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className="global-config-howto-toggle"
        onClick={() => setHowToOpen((prev) => !prev)}
      >
        {howToOpen ? 'Hide setup steps' : 'How to get this token'}
      </button>
      {howToOpen ? (
        <ol className="global-config-howto">
          <li>Create a Slack app at api.slack.com/apps and choose your team workspace.</li>
          <li>
            Add bot scopes: channels:read, groups:read, channels:history, groups:history,
            users:read, chat:write.
          </li>
          <li>Install the app to the workspace and copy the Bot User OAuth Token (xoxb-…).</li>
          <li>Invite the bot to every channel a project will read.</li>
        </ol>
      ) : null}

      {error ? <p className="ai-settings-error">{error}</p> : null}
      {notice ? <p className="ai-settings-notice">{notice}</p> : null}

      <p className="ai-settings-hint">
        This is your own team workspace. Each project chooses which of its channels the agent reads.
      </p>
    </div>
  )
}
