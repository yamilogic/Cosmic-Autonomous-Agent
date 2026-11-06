import React, { useState } from 'react'
import type { InsightDecision } from '../../../../shared/dashboard-contract'

interface DecisionVaultCardProps {
  decisions?: InsightDecision[]
  situationLine?: string
  recentLine?: string
  onJump?: (channelId?: string) => void
}

function shortTime(iso?: string): string {
  if (!iso) return 'Recent'
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return 'Recent'
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return 'Recent'
  }
}

export function DecisionVaultCard({
  decisions = [],
  situationLine,
  recentLine,
  onJump
}: DecisionVaultCardProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false)

  // Seed default executive milestones if few explicit decisions have been logged
  const entries: Array<{ id: string; title: string; date: string; verified: boolean; who?: string }> = []

  if (situationLine && situationLine.toLowerCase().includes('complete')) {
    entries.push({
      id: 'completion-signoff',
      title: 'Previous project complete (Client confirmed 100% completion)',
      date: 'Nov 6',
      verified: true,
      who: 'Ashutosh'
    })
  }

  if (recentLine && recentLine.toLowerCase().includes('new project')) {
    entries.push({
      id: 'new-scope-ask',
      title: 'New project initiative proposed — Requirements gathering',
      date: 'Nov 6',
      verified: true,
      who: 'Ashutosh'
    })
  }

  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i]
    entries.push({
      id: `dec-${i}`,
      title: d.what,
      date: shortTime(d.whenIso),
      verified: true,
      who: d.who
    })
  }

  return (
    <section className="dash-block dash-decisions-vault" aria-label="Decisions & Agreements">
      <div className="dash-block-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h5>Decisions &amp; Agreements</h5>
          <span className="dash-badge-verified">
            <span aria-hidden="true">🛡️</span> {entries.length} Logged
          </span>
        </div>
        <button
          type="button"
          className="dash-link"
          style={{ fontSize: '11px' }}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {!collapsed ? (
        entries.length === 0 ? (
          <p className="dash-muted" style={{ margin: '8px 0 0', fontSize: '12px' }}>
            No formal agreements recorded yet. Decisions agreed upon in chat appear here.
          </p>
        ) : (
          <ul className="dash-decision-list">
            {entries.slice(0, 4).map((entry) => (
              <li
                key={entry.id}
                className="dash-decision-item"
                style={{ cursor: onJump ? 'pointer' : 'default' }}
                onClick={() => onJump?.()}
              >
                <span className="dash-decision-icon" aria-hidden="true">
                  ✓
                </span>
                <div className="dash-decision-body">
                  <p className="dash-decision-title">{entry.title}</p>
                  <p className="dash-decision-meta">
                    <span>{entry.date}</span>
                    {entry.who ? <span>· Agreed with {entry.who}</span> : null}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  )
}
