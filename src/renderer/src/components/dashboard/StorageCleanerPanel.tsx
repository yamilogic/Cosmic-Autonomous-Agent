import type React from 'react'
import { useEffect, useState } from 'react'
import type { PartitionStorageInfo, StorageSummaryResult } from '../../../../shared/ipc-contract'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export default function StorageCleanerPanel(): React.ReactElement {
  const [summary, setSummary] = useState<StorageSummaryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<'all' | 'global' | 'profile' | 'card' | 'orphaned'>('all')

  const loadSummary = async (): Promise<void> => {
    setLoading(true)
    try {
      const res = await window.api.storage.getSummary()
      setSummary(res)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to scan storage')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSummary()
  }, [])

  const handleCleanJunk = async (partitionIds?: string[], removeOrphaned = true): Promise<void> => {
    setCleaning(true)
    setNotice(null)
    try {
      const res = await window.api.storage.clean({
        mode: 'safe_cache_only',
        partitionIds,
        removeOrphaned
      })
      if (res.ok) {
        setNotice(`Cleaned junk cache: reclaimed ${formatBytes(res.freedBytes)} across ${res.cleanedCount} items. (Logins preserved)`)
        await loadSummary()
      } else {
        setNotice(res.error || 'Clean failed')
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Error cleaning storage')
    } finally {
      setCleaning(false)
    }
  }

  const handleFullReset = async (partition: PartitionStorageInfo): Promise<void> => {
    if (!confirm(`Are you sure you want to completely reset "${partition.label}"? This will log out of this session.`)) {
      return
    }
    setCleaning(true)
    try {
      const res = await window.api.storage.clean({
        mode: 'full_reset',
        partitionIds: [partition.id],
        removeOrphaned: true
      })
      if (res.ok) {
        setNotice(`Reset "${partition.label}": reclaimed ${formatBytes(res.freedBytes)}.`)
        await loadSummary()
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setCleaning(false)
    }
  }

  const filteredPartitions = (summary?.partitions ?? []).filter((p) => {
    if (filterType === 'all') return true
    return p.type === filterType
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Top Banner Stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '10px',
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '12px'
        }}
      >
        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>
            Total Partitions
          </span>
          <strong style={{ fontSize: '18px', color: 'var(--text)' }}>
            {summary ? summary.partitions.length : '—'}
          </strong>
        </div>

        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>
            Total Disk Used
          </span>
          <strong style={{ fontSize: '18px', color: 'var(--text)' }}>
            {summary ? formatBytes(summary.totalDiskUsageBytes) : '—'}
          </strong>
        </div>

        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>
            Cleanable Junk
          </span>
          <strong style={{ fontSize: '18px', color: '#10b981' }}>
            {summary ? formatBytes(summary.totalCacheUsageBytes) : '—'}
          </strong>
        </div>

        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>
            Orphaned
          </span>
          <strong style={{ fontSize: '18px', color: summary && summary.orphanedCount > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
            {summary ? `${summary.orphanedCount} dead` : '—'}
          </strong>
        </div>
      </div>

      {/* Main Action Bar */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="dash-primary"
          disabled={cleaning || loading}
          onClick={() => void handleCleanJunk(undefined, true)}
          style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <span>🧹</span>
          <span>{cleaning ? 'Cleaning caches…' : 'Clear Junk Cache (Keep Logins)'}</span>
        </button>

        {summary && summary.orphanedCount > 0 ? (
          <button
            type="button"
            className="dash-subtle"
            disabled={cleaning || loading}
            onClick={() => {
              const orphanedIds = summary.partitions.filter((p) => p.type === 'orphaned').map((p) => p.id)
              void handleCleanJunk(orphanedIds, true)
            }}
            style={{ padding: '8px 14px', fontSize: '13px', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)' }}
          >
            🗑 Remove {summary.orphanedCount} Orphaned Partitions
          </button>
        ) : null}

        <button
          type="button"
          className="dash-subtle"
          disabled={loading || cleaning}
          onClick={() => void loadSummary()}
          style={{ padding: '8px 12px', fontSize: '13px', marginLeft: 'auto' }}
          title="Refresh breakdown"
        >
          🔄 Refresh
        </button>
      </div>

      {notice ? (
        <div
          style={{
            padding: '10px 14px',
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            color: '#60a5fa',
            borderRadius: '6px',
            fontSize: '13px'
          }}
        >
          {notice}
        </div>
      ) : null}

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
        {(
          [
            { id: 'all', label: 'All Sessions' },
            { id: 'global', label: 'Global Accounts' },
            { id: 'profile', label: 'Profiles' },
            { id: 'card', label: 'Project Cards' },
            { id: 'orphaned', label: 'Orphaned' }
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilterType(t.id)}
            style={{
              background: filterType === t.id ? 'var(--surface-hover, rgba(255,255,255,0.08))' : 'transparent',
              color: filterType === t.id ? 'var(--text)' : 'var(--text-muted)',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 10px',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: filterType === t.id ? 600 : 400
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Sessions & Partitions List */}
      <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {loading && !summary ? (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '16px 0', textAlign: 'center' }}>
            Scanning storage partitions…
          </p>
        ) : filteredPartitions.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '16px 0', textAlign: 'center' }}>
            No partitions found for this filter.
          </p>
        ) : (
          filteredPartitions.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '13px'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '3px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      background:
                        p.type === 'global'
                          ? 'rgba(59, 130, 246, 0.2)'
                          : p.type === 'card'
                            ? 'rgba(139, 92, 246, 0.2)'
                            : p.type === 'orphaned'
                              ? 'rgba(239, 68, 68, 0.2)'
                              : 'rgba(255, 255, 255, 0.08)',
                      color:
                        p.type === 'global'
                          ? '#60a5fa'
                          : p.type === 'card'
                            ? '#a78bfa'
                            : p.type === 'orphaned'
                              ? '#f87171'
                              : 'var(--text)'
                    }}
                  >
                    {p.type}
                  </span>
                  <strong style={{ color: 'var(--text)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                    {p.label}
                  </strong>
                  {p.hasSession ? (
                    <span style={{ fontSize: '10px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      ● Logged in
                    </span>
                  ) : null}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Total: {formatBytes(p.totalSizeBytes)} • Cache: {formatBytes(p.cacheSizeBytes)}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="dash-subtle"
                  disabled={cleaning}
                  onClick={() => void handleCleanJunk([p.id], false)}
                  style={{ fontSize: '11px', padding: '4px 8px' }}
                  title="Purge HTTP, Code, and Service Worker caches without logging out"
                >
                  🧹 Clear Cache
                </button>
                <button
                  type="button"
                  className="dash-subtle"
                  disabled={cleaning}
                  onClick={() => void handleFullReset(p)}
                  style={{ fontSize: '11px', padding: '4px 8px', color: '#ef4444' }}
                  title="Delete cookies and local storage (logs out)"
                >
                  Wipe
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

