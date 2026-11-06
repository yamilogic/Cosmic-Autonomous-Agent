import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useDashboardStore } from '../../hooks/useDashboard'
import { useProfileStore } from '../../hooks/useProfiles'
import { buildManifest, USER_SCOPES } from './slack-manifest'
import {
  SourcePicker,
  WorkspacePicker,
  BackfillSelect,
  AutomationNotice,
  type SourceType,
  type ProfileWorkspaceOption
} from './sources'
import type { ProjectSource } from '../../../../shared/dashboard-contract'
import { GLOBAL_PROFILE_ID } from '../../../../shared/types'

/**
 * Add-project wizard (v2.1 — docs/tickets/dashboard-v2.1.md):
 * Step 1 is a guided setup: create the Slack app (with ready-to-paste manifest),
 * install it to the workspace, copy the xoxp token, then paste it to connect.
 * Steps 2/3: choose channels → confirm card → automatic first sync.
 */

const OPTIONAL_SCOPES = new Set([
  'users:read',
  'users.profile:read',
  'im:read',
  'im:history',
  'mpim:read',
  'mpim:history',
  'emoji:read',
  'chat:write'
])

const APPS_HOME = 'https://api.slack.com/apps'

function maskToken(token: string): string {
  if (token.length < 14) return '•'.repeat(token.length)
  return `${token.slice(0, 9)}…${token.slice(-4)}`
}

interface TokenResult {
  valid: boolean
  teamName?: string
  teamId?: string
  userName?: string
  userId?: string
  scopes?: string[]
  error?: string
}

function safeVaultKey(teamName: string): string {
  return (
    'DASH_TOKEN_' +
    teamName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  )
}

/** Vault key naming scheme: DASH_TOKEN_<PROJECT> — fixed, not user-invented. */
function vaultKeyForProject(projectName: string): string {
  const key = safeVaultKey(projectName)
  return key === 'DASH_TOKEN_' ? '' : key
}

const STEPS = [
  'Choose source',
  'Connect & configure',
  'Choose channels',
  'Confirm card',
  'Finish'
] as const

interface ChannelQuery {
  tokenSource: 'oauth' | 'manual'
  profileId?: string
  teamId?: string
  manualTokenKey?: string
}

/** Channel list for a connector (module scope = stable for effects). */
async function fetchChannels(query: ChannelQuery): Promise<Array<{ id: string; name: string }>> {
  const found = await window.api.dashboard.listChannels(query)
  return found.map((c) => ({ id: c.id, name: c.name }))
}

interface DashboardWizardProps {
  /** Render inside the Settings tab instead of a modal overlay. */
  inline?: boolean
  /** Project to edit when rendered inline. */
  projectId?: string
  /** Called when an inline edit finishes. */
  onDone?: () => void
}

export default function DashboardWizard({
  inline = false,
  projectId,
  onDone
}: DashboardWizardProps): React.ReactElement {
  const snapshot = useDashboardStore((s) => s.snapshot)
  const wizardOpenFor = useDashboardStore((s) => s.wizardOpenFor)
  const closeWizard = useDashboardStore((s) => s.closeWizard)
  const addManualToken = useDashboardStore((s) => s.addManualToken)
  const upsertProject = useDashboardStore((s) => s.upsertProject)
  const syncNow = useDashboardStore((s) => s.syncNow)

  const targetId = projectId ?? wizardOpenFor?.projectId ?? null
  const target = useMemo(() => {
    if (!targetId || !snapshot) return null
    return snapshot.projects.find((p) => p.project.id === targetId) ?? null
  }, [targetId, snapshot])
  const existingBrowserSource = useMemo(
    () => target?.project.sources?.find((source) => source.kind === 'browser') ?? null,
    [target]
  )

  const close = (): void => {
    if (inline && onDone) onDone()
    else closeWizard()
  }

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(target ? 3 : 1)

  // app-config for manifest (fetched once)
  const [appConfig, setAppConfig] = useState<{ clientId: string; redirectUri: string } | null>(null)
  const manifest = useMemo(() => buildManifest(appConfig?.redirectUri ?? ''), [appConfig])
  const [copied, setCopied] = useState<'manifest' | 'none'>('none')
  useEffect(() => {
    let alive = true
    void window.api.dashboard.getAppConfig().then((c) => {
      if (alive) setAppConfig(c)
    })
    return () => {
      alive = false
    }
  }, [])

  // paste/connect state
  const [tokenValue, setTokenValue] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [result, setResult] = useState<TokenResult | null>(() => {
    const key = target?.project.manualTokenKey
    const entry = key && snapshot ? snapshot.manualTokens.find((t) => t.key === key) : undefined
    return entry ? { valid: entry.validated, teamName: entry.teamName, teamId: entry.teamId } : null
  })
  const [savedKey, setSavedKey] = useState(target?.project.manualTokenKey ?? '')
  const [savedTokenMask, setSavedTokenMask] = useState(
    target?.project.manualTokenKey && target?.project.tokenSource === 'manual'
      ? maskToken(target?.project.manualTokenKey)
      : ''
  )
  const [replaceMode, setReplaceMode] = useState(false)

  // source selection state (SLK-5)
  const [sourceType, setSourceType] = useState<SourceType>(
    target?.project.sourcePreference === 'browser_only' ||
      (target?.project.sources && target.project.sources.some((s) => s.kind === 'browser'))
      ? 'browser'
      : 'token'
  )
  const profiles = useProfileStore((s) => s.profiles)
  const workspaceOptions = useMemo<ProfileWorkspaceOption[]>(() => {
    const list: ProfileWorkspaceOption[] = []
    // Workspaces for projects must come from individual separate profiles, NOT Global Account or Observer
    const individualProfiles = profiles.filter(
      (p) =>
        p.id !== GLOBAL_PROFILE_ID &&
        !p.isGlobalProfile &&
        p.accountScope !== 'global' &&
        p.accountScope !== 'observer'
    )
    for (const p of individualProfiles) {
      for (const w of p.apps.slack.availableWorkspaces) {
        list.push({
          profileId: p.id,
          profileEmail: p.customName || p.displayName,
          workspaceId: w.teamId,
          workspaceName: w.teamName
        })
      }
    }
    return list
  }, [profiles])

  const [selectedWorkspaceKey, setSelectedWorkspaceKey] = useState<string>(() => {
    if (target?.project.profileId && target?.project.teamId) {
      return `${target.project.profileId}:${target.project.teamId}`
    }
    return workspaceOptions[0] ? `${workspaceOptions[0].profileId}:${workspaceOptions[0].workspaceId}` : ''
  })

  const [backfillDays, setBackfillDays] = useState<number>(7)
  const [automationNoticeAck, setAutomationNoticeAck] = useState<boolean>(true)

  // channels
  const [channels, setChannels] = useState<Array<{ id: string; name: string; created?: number; memberCount?: number }>>([])
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [channelError, setChannelError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(
    new Set(
      existingBrowserSource
        ? existingBrowserSource.channels
            .filter((channel) => channel.enabled !== false)
            .map((channel) => channel.id)
        : (target?.project.monitors ?? []).map((monitor) => monitor.channelId)
    )
  )

  // confirm
  const [projectName, setProjectName] = useState(target?.project.name ?? '')
  const [clientName, setClientName] = useState(target?.project.clientName ?? '')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // derived — fixed naming scheme: DASH_TOKEN_<PROJECT> (never user-invented)
  const vaultKey = useMemo(() => vaultKeyForProject(projectName.trim()), [projectName])

  const missingScopes = useMemo(() => {
    if (!result?.scopes) return []
    const granted = new Set(result.scopes)
    return USER_SCOPES.filter((s) => OPTIONAL_SCOPES.has(s) && !granted.has(s))
  }, [result])

  // Manual tokens are listed by vault key; OAuth projects use their profile + team.
  const channelQuery = useMemo<ChannelQuery | null>(() => {
    if (savedKey) return { tokenSource: 'manual', manualTokenKey: savedKey }
    if (target?.project.tokenSource === 'oauth') {
      return {
        tokenSource: 'oauth',
        profileId: target.project.profileId,
        teamId: target.project.teamId
      }
    }
    return null
  }, [savedKey, target])

  async function loadChannelList(): Promise<void> {
    setLoadingChannels(true)
    setChannelError(null)
    try {
      if (!channelQuery) {
        setChannels([])
        return
      }
      setChannels(await fetchChannels(channelQuery))
    } catch (err) {
      setChannels([])
      setChannelError(err instanceof Error ? err.message : 'channel fetch failed')
    } finally {
      setLoadingChannels(false)
    }
  }

  async function loadBrowserChannels(): Promise<void> {
    const [profId, teamId] = selectedWorkspaceKey.split(':')
    if (!profId || !teamId) {
      setChannels([])
      setChannelError('Choose a workspace first.')
      return
    }
    setLoadingChannels(true)
    setChannelError(null)
    try {
      const result = await window.api.dashboard.discoverSourceChannels({
        projectId: target?.project.id,
        sourceId: existingBrowserSource?.id,
        profileId: profId,
        workspaceId: teamId
      })
      if (result.error) setChannelError(result.error)
      setChannels(result.channels.map((c) => ({
        id: c.id,
        name: c.name,
        created: c.created,
        memberCount: c.memberCount
      })))
    } catch (err) {
      setChannels([])
      setChannelError(err instanceof Error ? err.message : 'channel discovery failed')
    } finally {
      setLoadingChannels(false)
    }
  }

  // Auto-load the channel list when the channels step opens (async only —
  // no synchronous state writes inside the effect body).
  useEffect(() => {
    if (step !== 3 || channels.length > 0) return
    let alive = true
    void (async () => {
      try {
        if (sourceType === 'browser') {
          await loadBrowserChannels()
          return
        } else {
          if (!channelQuery) return
          setLoadingChannels(true)
          setChannelError(null)
          const found = await fetchChannels(channelQuery)
          if (!alive) return
          setChannels(found)
          setLoadingChannels(false)
        }
      } catch (err) {
        if (!alive) return
        setChannels([])
        setChannelError(err instanceof Error ? err.message : 'channel fetch failed')
        setLoadingChannels(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [step, sourceType, selectedWorkspaceKey, channelQuery, channels.length])

  async function connectToken(): Promise<void> {
    if (!vaultKey.trim() || !tokenValue.trim()) {
      setConnectError('Project name and token are both required.')
      return
    }
    setConnecting(true)
    setConnectError(null)
    try {
      const r = await addManualToken(vaultKey.trim(), tokenValue.trim())
      if (!r.valid) {
        setConnectError(r.error ?? 'Slack rejected this token.')
        return
      }
      setResult({
        valid: true,
        teamName: r.teamName,
        teamId: r.teamId,
        userName: r.userName,
        userId: r.userId,
        scopes: r.scopes
      })
      setSavedKey(vaultKey.trim())
      setSavedTokenMask(maskToken(tokenValue.trim()))
      setTokenValue('')
      // the client is the person you work for — not the token owner, so the
      // field stays empty until the user names them
      setStep(3)
    } finally {
      setConnecting(false)
    }
  }

  function pickChannels(): void {
    if (selected.size === 0 && sourceType !== 'browser') return
    if (!projectName.trim()) {
      if (sourceType === 'browser') {
        const found = workspaceOptions.find(
          (o) => `${o.profileId}:${o.workspaceId}` === selectedWorkspaceKey
        )
        if (found) setProjectName(found.workspaceName)
      } else if (result?.teamName) {
        setProjectName(result.teamName)
      }
    }
    setStep(4)
  }

  async function createCard(): Promise<void> {
    if (!projectName.trim()) return
    // Token cards must choose at least one channel here. Browser cards may be
    // created empty so the post-login picker can ask for channels explicitly.
    if (sourceType !== 'browser' && selected.size === 0) return
    // v2.3 — hard rule: a card must be bound to exactly one workspace
    let teamId = result?.teamId ?? target?.project.teamId
    let teamName = result?.teamName ?? target?.project.teamName
    let profileId = target?.project.profileId ?? (savedKey ? `manual:${savedKey}` : '')

    if (sourceType === 'browser') {
      const parts = selectedWorkspaceKey.split(':')
      profileId = parts[0] || profileId
      teamId = parts[1] || teamId
      const found = workspaceOptions.find(
        (o) => `${o.profileId}:${o.workspaceId}` === selectedWorkspaceKey
      )
      if (found) teamName = found.workspaceName
    }

    if (!teamId) {
      setCreateError(
        'Workspace unknown — select a workspace or reconnect the connector so the card can be bound to one workspace.'
      )
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const id =
        target?.project.id ??
        `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const monitors = channels
        .filter((c) => selected.has(c.id))
        .map((c) => ({ channelId: c.id, channelName: c.name }))

      const now = new Date().toISOString()
      const browserSources: ProjectSource[] | undefined =
        sourceType === 'browser'
          ? [
              {
                id: existingBrowserSource?.id ?? `src-browser-${Date.now().toString(36)}`,
                kind: 'browser',
                platform: 'slack',
                profileId,
                workspaceId: teamId,
                workspaceName: teamName || 'Slack Workspace',
                channels: monitors.map((m) => ({ id: m.channelId, name: m.channelName })),
                role: 'client',
                backfillDays: (backfillDays === 1 || backfillDays === 30 ? backfillDays : 7) as 1 | 7 | 30,
                enabled: true,
                status: 'connected',
                selectionMode: 'include',
                channelsReviewedAt: monitors.length > 0 ? now : undefined,
                createdAt: existingBrowserSource?.createdAt ?? now,
                updatedAt: now
              }
            ]
          : target?.project.sources

      await upsertProject({
        ...(target ? target.project : undefined),
        id,
        name: projectName.trim(),
        clientName: clientName.trim() || projectName.trim(),
        // editing an OAuth card must not silently convert it to a manual token
        profileId: profileId || `manual:${savedKey}`,
        teamId,
        teamName,
        selfUserId: result?.userId ?? target?.project.selfUserId,
        appId: 'slack',
        tokenSource: sourceType === 'browser' ? 'oauth' : (target?.project.tokenSource ?? 'manual'),
        manualTokenKey: sourceType === 'browser' ? undefined : (savedKey || target?.project.manualTokenKey),
        sourcePreference: sourceType === 'browser' ? 'browser_only' : 'token_first',
        sources: browserSources,
        monitors:
          sourceType === 'browser'
            ? monitors
            : monitors.length
              ? monitors
              : (target?.project.monitors ?? []).map((m) => ({
                  channelId: m.channelId,
                  channelName: m.channelName
                }))
      })
      setStep(5)
      if (monitors.length > 0 || sourceType !== 'browser') void syncNow(id)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'project save failed')
    } finally {
      setCreating(false)
    }
  }

  async function copyManifest(): Promise<void> {
    try {
      await navigator.clipboard.writeText(manifest)
      setCopied('manifest')
      setTimeout(() => setCopied('none'), 1800)
    } catch {
      setCopied('none')
    }
  }

  const panel = (
    <section
      className={`wizard-panel${inline ? ' is-inline' : ''}`}
      role={inline ? 'region' : 'dialog'}
      aria-label={target ? 'Edit workspace and channels' : 'Set up new project'}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="wizard-header">
        <div className="wizard-steps" aria-label="wizard progress">
          {STEPS.map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3 | 4 | 5
            return (
              <span
                key={label}
                className={`wizard-dot${step === n ? ' is-active' : ''}${step > n ? ' is-done' : ''}`}
              >
                {step > n ? '✓' : n}
              </span>
            )
          })}
          <span className="wizard-step-label">{STEPS[step - 1]}</span>
        </div>
        {!inline && (
          <button type="button" className="dash-icon-btn" onClick={close} title="Close">
            ✕
          </button>
        )}
      </header>

      {/* ===== STEP 1 — Choose Source ===== */}
      {step === 1 ? (
        <div className="wizard-body">
          <h3>Choose Connection Method</h3>
          <p className="wizard-sub">
            Select how Cosmic should read messages from your Slack workspace.
          </p>
          <SourcePicker value={sourceType} onChange={(val) => setSourceType(val)} />
          <div className="settings-actions" style={{ marginTop: 24 }}>
            <button
              type="button"
              className="dash-primary"
              onClick={() => setStep(2)}
            >
              Continue →
            </button>
          </div>
        </div>
      ) : null}

      {/* ===== STEP 2 — Connect & Configure ===== */}
      {step === 2 && sourceType === 'browser' ? (
        <div className="wizard-body">
          <h3>Logged-in Slack Workspace</h3>
          <p className="wizard-sub">
            Map a Slack workspace docked under your Google Profile in Cosmic.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <WorkspacePicker
              options={workspaceOptions}
              selectedKey={selectedWorkspaceKey}
              onChange={(key) => setSelectedWorkspaceKey(key)}
            />
            <BackfillSelect
              days={backfillDays}
              onChange={(d) => setBackfillDays(d)}
            />
            <AutomationNotice
              acknowledged={automationNoticeAck}
              onChange={(a) => setAutomationNoticeAck(a)}
            />
          </div>
          <div className="settings-actions" style={{ marginTop: 20 }}>
            <button type="button" className="dash-subtle" onClick={() => setStep(1)}>
              ← Back
            </button>
            <button
              type="button"
              className="dash-primary"
              disabled={!selectedWorkspaceKey || !automationNoticeAck}
              onClick={() => {
                setChannels([])
                setSelected(new Set())
                setStep(3)
              }}
            >
              Continue to Channels →
            </button>
          </div>
        </div>
      ) : null}

      {/* ===== STEP 2 (Token Option) — Guided Setup & Paste Token ===== */}
      {step === 2 && sourceType === 'token' ? (
        <div className="wizard-body">
          <h3>Slack App Token Setup</h3>
          {savedTokenMask && !replaceMode ? (
            <>
              <p className="wizard-saved-token">
                saved connector: <code>{savedKey}</code> · <code>{savedTokenMask}</code>
              </p>
              <div className="settings-actions">
                <button type="button" className="dash-subtle" onClick={() => setStep(1)}>
                  ← Back
                </button>
                <button type="button" className="dash-primary" onClick={() => setStep(3)}>
                  Continue with it →
                </button>
              </div>
              <button
                type="button"
                className="wizard-linklike"
                onClick={() => setReplaceMode(true)}
              >
                Replace this token…
              </button>
            </>
          ) : (
            <>
              <ol className="wizard-guide">
                <li>
                  <p>
                    <b>1. Create App from Manifest:</b> Open{' '}
                    <a href={APPS_HOME} target="_blank" rel="noreferrer">
                      api.slack.com/apps
                    </a>{' '}
                    and select <b>From an app manifest</b>.
                  </p>
                  <pre className="wizard-code">{manifest}</pre>
                  <button type="button" className="dash-subtle" onClick={() => void copyManifest()}>
                    {copied === 'manifest' ? '✓ Copied' : '⧉ Copy Manifest JSON'}
                  </button>
                </li>
                <li>
                  <p>
                    <b>2. Install App & Copy Token:</b> Under <b>OAuth & Permissions</b>, copy the{' '}
                    <code>xoxp-…</code> user token.
                  </p>
                </li>
              </ol>
              <label className="settings-row">
                <p className="settings-hint">
                  Project name — the key becomes <code>{vaultKey || 'DASH_TOKEN_<PROJECT>'}</code>{' '}
                  automatically
                </p>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. Acme Website Redesign"
                  autoFocus
                />
              </label>
              <label className="settings-row">
                <p className="settings-hint">
                  The <code>xoxp-…</code> you copied from OAuth &amp; Permissions
                </p>
                <input
                  type="password"
                  value={tokenValue}
                  onChange={(e) => setTokenValue(e.target.value)}
                  placeholder="xoxp-…"
                />
              </label>
              {connectError ? <p className="wizard-error">{connectError}</p> : null}
              {result?.valid && !savedTokenMask ? (
                <p className="settings-hint">
                  ✅ verified: <b>{result.teamName}</b> as {result.userName ?? 'workspace user'}
                  {missingScopes.length > 0
                    ? ` · partial scopes (missing ${missingScopes.join(', ')})`
                    : ''}
                </p>
              ) : null}
              <div className="settings-actions">
                <button type="button" className="dash-subtle" onClick={() => setStep(1)}>
                  ← Back
                </button>
                <button
                  type="button"
                  className="dash-primary"
                  disabled={connecting || !vaultKey}
                  onClick={() => void connectToken()}
                >
                  {connecting ? 'Validating…' : 'Validate & Add'}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* ===== STEP 2 — channels ===== */}
      {step === 3 ? (
        <div className="wizard-body">
          <h3>Choose channels</h3>
          <p className="wizard-sub">
            {loadingChannels
              ? sourceType === 'browser'
                ? 'Reading channels from the Slack browser session…'
                : 'Loading channels via token…'
              : sourceType === 'browser'
                ? `${channels.length} visible in this Slack session — tick what this card watches, or finish empty and pick after login.`
                : `${channels.length} readable with ${savedKey} — tick what this card watches.`}
          </p>
          {result?.teamName ? (
            <p className="settings-hint">
              Workspace: <b>{result.teamName}</b> — one card watches exactly one workspace.
            </p>
          ) : null}
          {channelError ? (
            <>
              <p className="wizard-error">{channelError}</p>
              <button
                type="button"
                className="dash-subtle"
                onClick={() => void (sourceType === 'browser' ? loadBrowserChannels() : loadChannelList())}
              >
                ⟳ Retry channel fetch
              </button>
            </>
          ) : null}
          <div className="wizard-channels">
            {channels.map((c) => (
              <label key={c.id} className="dash-channel-option">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(c.id)
                      else next.delete(c.id)
                      return next
                    })
                  }
                />
                <span>#{c.name}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, opacity: 0.75 }}>
                  {c.memberCount !== undefined && <span>👥 {c.memberCount}</span>}
                  {c.created ? <span>📅 {new Date(c.created * 1000).toLocaleDateString()}</span> : null}
                </div>
              </label>
            ))}
            {!loadingChannels && channels.length === 0
              ? 'No channels visible for this connector yet.'
              : null}
          </div>
          {selected.size > 0 ? <p className="settings-hint">{selected.size} selected</p> : null}
          <div className="settings-actions">
            {!inline ? (
              <button type="button" className="dash-subtle" onClick={() => setStep(2)}>
                ← Back
              </button>
            ) : null}
            <button
              type="button"
              className="dash-primary"
              disabled={selected.size === 0 && sourceType !== 'browser'}
              onClick={pickChannels}
            >
              Continue →
            </button>
          </div>
        </div>
      ) : null}

      {/* ===== STEP 3 — confirm ===== */}
      {step === 4 ? (
        <div className="wizard-body">
          <h3>Confirm card</h3>
          <p className="wizard-sub">Names are pre-filled from the workspace — edit freely.</p>
          {(result?.teamName ?? target?.project.teamName) ? (
            <p className="settings-hint">
              Workspace: <b>{result?.teamName ?? target?.project.teamName}</b> (
              <code>{result?.teamId ?? target?.project.teamId}</code>) — this card will only ever
              read this workspace.
            </p>
          ) : null}
          <label className="settings-row">
            <p className="settings-hint">Project (card title)</p>
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          </label>
          <label className="settings-row">
            <p className="settings-hint">Client — who you work for (used for AI attribution)</p>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Acme"
            />
          </label>
          <p className="settings-hint">
            {selected.size} channel{selected.size === 1 ? '' : 's'} ·{' '}
            {Array.from(selected)
              .map((chId) => channels.find((c) => c.id === chId)?.name ?? chId)
              .join(', ')}
          </p>
          {createError ? <p className="wizard-error">{createError}</p> : null}
          <p className="settings-hint">
            {target
              ? 'Saving triggers a sync so the card reflects the new channel set.'
              : 'Adding triggers an automatic first sync — the card opens with fresh data.'}
          </p>
          <div className="settings-actions">
            <button type="button" className="dash-subtle" onClick={() => setStep(3)}>
              ← Back
            </button>
            <button
              type="button"
              className="dash-primary"
              disabled={creating || !projectName.trim()}
              onClick={() => void createCard()}
            >
              {creating ? 'Syncing…' : target ? 'Save changes' : 'Add project'}
            </button>
          </div>
        </div>
      ) : null}

      {/* ===== STEP 5 — finish ===== */}
      {step === 5 ? (
        <div className="wizard-body wizard-finish">
          <p className="wizard-finish-check">✅</p>
          <h3>
            {target
              ? 'Changes saved'
              : `${projectName.trim() ? projectName.trim() : 'Project'} added to the dashboard`}
          </h3>
          <p className="wizard-sub">
            {target
              ? 'The connector and channel set are up to date. A sync is running now so the card reflects the new channels.'
              : 'The card is live and its first sync is running — fresh messages, % completion, client mood and dates will fill in within seconds.'}{' '}
            It refreshes automatically every {snapshot?.syncIntervalSeconds ?? 300}s (new messages
            only).
          </p>
          <div className="settings-actions">
            <button type="button" className="dash-primary" onClick={close}>
              {target ? 'Done' : 'Done — show me the dashboard'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )

  if (inline) return <div className="wizard-inline">{panel}</div>

  return (
    <div className="settings-backdrop wizard-backdash" onClick={close}>
      {panel}
    </div>
  )
}
