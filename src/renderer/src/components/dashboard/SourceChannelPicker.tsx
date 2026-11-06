import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import type {
  ProjectSource,
  ProjectSourceChannel,
  ProjectSourceSelectionMode
} from '../../../../shared/dashboard-contract'

interface SourceChannelPickerProps {
  projectId: string
  source: ProjectSource
  open: boolean
  onClose: () => void
  onSaved?: () => void
}

function kindLabel(channel: ProjectSourceChannel): string {
  if (channel.isDm || channel.kind === 'dm') return 'DM'
  if (channel.isPrivate || channel.kind === 'private') return 'Private'
  return 'Public'
}

function formatCreatedDate(epochSeconds?: number): string | null {
  if (!epochSeconds) return null
  const d = new Date(epochSeconds * 1000)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The only place a browser source earns permission to read. Discovery runs
 * against the card's live Slack session, so no token is needed. Selection is
 * explicit: a first-time source starts with nothing ticked.
 */
export function SourceChannelPicker({
  projectId,
  source,
  open,
  onClose,
  onSaved
}: SourceChannelPickerProps): React.ReactElement | null {
  const [channels, setChannels] = useState<ProjectSourceChannel[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState<ProjectSourceSelectionMode>(
    source.selectionMode ?? 'include'
  )
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setError(null)
    setSelectionMode(source.selectionMode ?? 'include')
    const existing = new Map(source.channels.map((channel) => [channel.id, channel]))
    setSelected(
      new Set(
        source.channels
          .filter((channel) => channel.enabled !== false)
          .map((channel) => channel.id)
      )
    )
    void window.api.dashboard
      .discoverSourceChannels({
        projectId,
        sourceId: source.id,
        profileId: source.profileId,
        workspaceId: source.workspaceId
      })
      .then((result) => {
        if (!alive) return
        if (result.error) setError(result.error)
        if (result.channels.length === 0) {
          setChannels(source.channels)
          return
        }
        setChannels(
          result.channels.map((channel) => {
            const previous = existing.get(channel.id)
            return {
              ...channel,
              enabled: previous ? previous.enabled !== false : false
            }
          })
        )
      })
      .catch((err) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Channel discovery failed')
        setChannels(source.channels)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // Discovery is keyed by the source being edited, not by array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, source.id])

  const grouped = useMemo(() => {
    const publicChannels: ProjectSourceChannel[] = []
    const privateChannels: ProjectSourceChannel[] = []
    const dms: ProjectSourceChannel[] = []
    for (const channel of channels) {
      if (channel.isDm || channel.kind === 'dm') dms.push(channel)
      else if (channel.isPrivate || channel.kind === 'private') privateChannels.push(channel)
      else publicChannels.push(channel)
    }
    return { publicChannels, privateChannels, dms }
  }, [channels])

  const toggle = (channelId: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(channelId)) next.delete(channelId)
      else next.add(channelId)
      return next
    })
  }

  const changeMode = (mode: ProjectSourceSelectionMode): void => {
    if (mode === selectionMode) return
    setSelectionMode(mode)
    // The same tick now means the opposite thing; make the user re-select.
    setSelected(new Set())
  }

  const save = async (): Promise<void> => {
    if (selectionMode === 'include' && selected.size === 0) {
      setError('Tick at least one channel to scrape.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const fullList = channels.length > 0 ? channels : source.channels
      const hasDmsSelected = fullList.some(
        (channel) => selected.has(channel.id) && (channel.isDm || channel.kind === 'dm')
      )
      const nextChannels = fullList.map((channel) => ({
        ...channel,
        enabled: selected.has(channel.id)
      }))
      await window.api.dashboard.updateSource({
        projectId,
        sourceId: source.id,
        patch: {
          channels: nextChannels,
          channelsReviewedAt: new Date().toISOString(),
          selectionMode,
          allowDms: hasDmsSelected ? 'on' : 'off'
        }
      })
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save channel selection')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const renderGroup = (
    title: string,
    list: ProjectSourceChannel[],
    emptyText: string
  ): React.ReactNode => (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {title} ({list.length})
      </div>
      {list.length === 0 ? (
        <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{emptyText}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6, marginTop: 6 }}>
          {list.map((channel) => {
            const checked = selected.has(channel.id)
            return (
              <label
                key={channel.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '7px 9px',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                  color: checked ? 'var(--text)' : 'var(--text-muted)',
                  background: checked ? 'rgba(99, 102, 241, 0.16)' : 'rgba(255,255,255,0.025)',
                  border: `1px solid ${checked ? 'rgba(99, 102, 241, 0.45)' : 'var(--border)'}`
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(channel.id)} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {channel.isDm || channel.kind === 'dm'
                    ? '💬'
                    : channel.isPrivate || channel.kind === 'private'
                      ? '🔒'
                      : '#'}{' '}
                  {channel.name || channel.id}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, opacity: 0.75, flexShrink: 0 }}>
                  {channel.memberCount !== undefined ? (
                    <span title={`${channel.memberCount} members`}>👥 {channel.memberCount}</span>
                  ) : null}
                  {channel.created ? (
                    <span title={`Created ${formatCreatedDate(channel.created)}`}>
                      📅 {formatCreatedDate(channel.created)}
                    </span>
                  ) : null}
                  <span style={{ opacity: 0.85 }}>{kindLabel(channel)}</span>
                </div>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Select channels to scrape"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(2, 6, 23, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}
    >
      <div
        style={{
          width: 'min(840px, 92vw)',
          maxHeight: 'min(80vh, 720px)',
          overflowY: 'auto',
          background: 'var(--panel, #141824)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: 14,
          padding: 24,
          boxShadow: '0 25px 75px rgba(0, 0, 0, 0.8)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Select channels to scrape</h3>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              {source.workspaceName || source.workspaceId} · nothing is ticked by default. Pick the 2–3
              channels this card actually needs.
            </p>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 8,
              padding: '4px 8px',
              borderRadius: 4,
              fontSize: 11,
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              color: '#93c5fd'
            }}>
              <span>🛡️</span>
              <span><strong>Discovery only:</strong> Zero messages are read during discovery. When a channel is selected, its initial scrape pulls up to 30 days of past messages (or inception if younger), and subsequent syncs capture new messages incrementally.</span>
            </div>
          </div>
          <button type="button" className="dash-subtle" onClick={onClose} aria-label="Close channel picker">
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <button
            type="button"
            className={selectionMode === 'include' ? 'dash-primary' : 'dash-subtle'}
            style={{ fontSize: 12 }}
            onClick={() => changeMode('include')}
          >
            Scrape only selected
          </button>
          <button
            type="button"
            className={selectionMode === 'exclude' ? 'dash-primary' : 'dash-subtle'}
            style={{ fontSize: 12 }}
            onClick={() => changeMode('exclude')}
          >
            Stop only selected, scrape everything else
          </button>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
          {selectionMode === 'include'
            ? 'Ticked channels are read. Everything else is logged as skipped.'
            : 'Ticked channels are skipped. Every other visible channel is read.'}
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <b style={{ color: '#f8fafc' }}>{selected.size}</b> selected · <b style={{ color: '#f8fafc' }}>{channels.length}</b> total channels &amp; DMs
          </span>
          {selected.size > 0 && (
            <button
              type="button"
              className="dash-subtle"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={() => setSelected(new Set())}
            >
              Clear all
            </button>
          )}
        </div>

        {loading ? (
          <p style={{ marginTop: 18, fontSize: 13, color: 'var(--text-muted)' }}>
            Reading this workspace&apos;s channel list from the Slack session…
          </p>
        ) : (
          <>
            {error ? (
              <div
                style={{
                  marginTop: 12,
                  padding: '9px 11px',
                  borderRadius: 7,
                  fontSize: 12,
                  color: '#fbbf24',
                  background: 'rgba(251, 191, 36, 0.1)',
                  border: '1px solid rgba(251, 191, 36, 0.25)'
                }}
              >
                {error} You can still pick from the saved list below.
              </div>
            ) : null}
            {renderGroup('Public channels', grouped.publicChannels, 'No public channels visible.')}
            {renderGroup('Private channels', grouped.privateChannels, 'No private channels visible.')}
            {renderGroup('Direct messages (DMs)', grouped.dms, 'No direct messages found in this session.')}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button type="button" className="dash-subtle" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="dash-primary" onClick={() => void save()} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save channel selection'}
          </button>
        </div>
      </div>
    </div>
  )
}
