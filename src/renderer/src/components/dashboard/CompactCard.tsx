import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { CardSummary } from './card-view'
import ProjectPinButton from './ProjectPinButton'

interface CompactCardProps {
  summary: CardSummary
  profileName?: string | null
  onToggle: () => void
  onExpandSection?: (section: number) => void
  onSync: (id: string) => void
  onScrape?: (id: string) => void
  onSettings: () => void
  onRemove: () => void
  syncing: boolean
  scraping?: boolean
  pinned?: boolean
  onTogglePin?: () => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  onMoveUp?: () => void
  onMoveDown?: () => void
}

const STATUS_LABEL: Record<string, string> = {
  'on-track': 'On track',
  'at-risk': 'At risk',
  blocked: 'Blocked',
  'waiting-on-client': 'Waiting on client'
}

const MOOD_LABEL: Record<string, string> = {
  good: 'Good',
  neutral: 'Neutral',
  tense: 'Tense'
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 15

function fmtAge(iso: string | null | undefined): string {
  if (!iso) return '—'
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function replyTime(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86_400)}d`
}

function MoreGlyph(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  )
}

function SyncGlyph(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 11a8 8 0 0 0-14.9-4M4 13a8 8 0 0 0 14.9 4M4 5v6h6M20 19v-6h-6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function isInteractive(target: EventTarget | null): boolean {
  return Boolean(
    target instanceof Element &&
    target.closest('button, a, input, textarea, select, [role="menu"], [role="menuitem"]')
  )
}

/** One dense project row with three honest tiers. Anything without evidence is
 *  hidden or rendered as an em dash — never as a fabricated zero. */
export default function CompactCard({
  summary,
  profileName,
  onToggle,
  onExpandSection,
  onSync,
  onScrape,
  onSettings,
  onRemove,
  syncing,
  scraping = false,
  pinned = false,
  onTogglePin,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown
}: CompactCardProps): React.ReactElement {
  const {
    projectId,
    index,
    name,
    workspaceName,
    clientName,
    status,
    needsReply,
    inactive,
    situationLine,
    justChanged,
    nextStep,
    progress,
    pace,
    paceLabel,
    daysTotal,
    week,
    lastClientAt,
    counts,
    mood,
    updatedAt,
    newSince,
    medianReplySeconds,
    deliverables,
    ballInCourt
  } = summary

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const openSection = (section: number): void => {
    if (onExpandSection) onExpandSection(section)
    else onToggle()
  }

  const statusLabel = status ? (STATUS_LABEL[status] ?? status) : null
  const clientAge = lastClientAt ? fmtAge(lastClientAt) : null
  const myAge = summary.myLastReplyAt ? fmtAge(summary.myLastReplyAt) : null
  const median = replyTime(medianReplySeconds)
  const weekCounts = week ?? []
  const weekMax = Math.max(...weekCounts.map((day) => day.count), 1)
  const moodLabel = mood ? (MOOD_LABEL[mood] ?? null) : null
  const newCount = newSince ?? 0

  const chipCounts =
    counts.questions + counts.blockers + counts.risks + newCount + (deliverables?.total ?? 0)

  return (
    <article
      className={`proj-row${status ? ` is-${status}` : ''}`}
      id={`dash-card-anchor-${projectId}`}
      data-testid={`dash-card-${index}`}
      tabIndex={0}
      aria-label={`Open ${name}`}
      onClick={(event) => {
        if (isInteractive(event.target)) return
        onToggle()
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle()
        }
      }}
    >
      <span className="proj-row-bar" aria-hidden />

      <div className="proj-row-body">
        <div className="proj-row-head">
          <div className="proj-row-identity">
            {onTogglePin ? (
              <ProjectPinButton
                pinned={pinned}
                projectName={name}
                onToggle={onTogglePin}
                className="proj-pin-inline"
              />
            ) : null}
            <span className="proj-row-name" title={name}>
              {name}
            </span>
            <span className="proj-row-tags">
              <span className="proj-row-ws" title={workspaceName}>
                {workspaceName}
              </span>
              {profileName ? (
                <span
                  className="proj-row-profile-tag"
                  title={`Belongs to individual profile: ${profileName}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: '10.5px',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap'
                  }}
                >
                  👤 {profileName}
                </span>
              ) : null}
              {clientName && clientName !== workspaceName ? (
                <span className="proj-row-client" title={clientName}>
                  {clientName}
                </span>
              ) : null}
              {summary.sourceKind === 'browser' ? (
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: 'rgba(99, 102, 241, 0.15)',
                    color: '#818cf8',
                    border: '1px solid rgba(99, 102, 241, 0.3)'
                  }}
                  title="Messages read via logged-in browser session"
                >
                  ⚡ Browser session
                </span>
              ) : null}
              {statusLabel ? <span className="proj-row-status">{statusLabel}</span> : null}
              {needsReply ? <span className="proj-flag">Needs reply</span> : null}
              {inactive ? <span className="proj-flag is-muted">Inactive 24h+</span> : null}
            </span>
          </div>

          <span className="proj-row-head-actions">
            {onScrape ? (
              <button
                type="button"
                className="proj-icon-btn"
                disabled={scraping || syncing}
                aria-label={`Scrape ${name}`}
                title={scraping ? 'Scraping browser session…' : 'Scrape Slack channels'}
                onClick={() => onScrape(projectId)}
                style={{ fontSize: '12px' }}
              >
                {scraping ? <span className="proj-spin" aria-hidden /> : '🕷'}
              </button>
            ) : null}
            <button
              type="button"
              className="proj-icon-btn"
              disabled={syncing || scraping}
              aria-label={`Sync ${name}`}
              title={syncing ? 'Syncing…' : 'Sync now'}
              onClick={() => onSync(projectId)}
            >
              {syncing ? <span className="proj-spin" aria-hidden /> : <SyncGlyph />}
            </button>
            <div className="dash-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="proj-more"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Actions for ${name}`}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MoreGlyph />
              </button>
              {menuOpen ? (
                <div
                  className="dash-menu"
                  role="menu"
                  aria-label={`Actions for ${name}`}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setMenuOpen(false)
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={syncing}
                    onClick={() => {
                      onSync(projectId)
                      setMenuOpen(false)
                    }}
                  >
                    {syncing ? 'Syncing…' : 'Sync now'}
                  </button>
                  {pinned && onMoveUp ? (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!canMoveUp}
                      onClick={() => {
                        onMoveUp()
                        setMenuOpen(false)
                      }}
                    >
                      Move up
                    </button>
                  ) : null}
                  {pinned && onMoveDown ? (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!canMoveDown}
                      onClick={() => {
                        onMoveDown()
                        setMenuOpen(false)
                      }}
                    >
                      Move down
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onSettings()
                      setMenuOpen(false)
                    }}
                  >
                    Project settings
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    onClick={() => {
                      onRemove()
                      setMenuOpen(false)
                    }}
                  >
                    Delete project
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="proj-chevron"
              onClick={onToggle}
              aria-label={`Open ${name}`}
            />
          </span>
        </div>

        <span
          className={`proj-row-line${situationLine ? '' : ' is-empty'}`}
          title={situationLine || 'No summary yet'}
        >
          {situationLine || 'No summary yet'}
        </span>

        {justChanged ? (
          <span className="proj-row-changed" title={justChanged}>
            <b>Just changed</b> {justChanged}
          </span>
        ) : null}

        {nextStep ? (
          <span className="proj-row-next" title={nextStep}>
            <b>Next</b> {nextStep}
          </span>
        ) : null}

        <div className="proj-row-meta">
          {ballInCourt ? (
            <span className={`proj-court is-${ballInCourt}`}>
              {ballInCourt === 'yours' ? 'Your court' : "Client's court"}
            </span>
          ) : null}
          {clientAge ? (
            <span className="proj-meta-item">
              Client {clientAge} ago{myAge ? ` · Me ${myAge} ago` : ' · Me —'}
            </span>
          ) : null}
          {median ? <span className="proj-meta-item">Reply {median}</span> : null}

          {chipCounts > 0 ? (
            <span className="proj-row-chips">
              {counts.questions > 0 ? (
                <button type="button" className="proj-chip" onClick={() => openSection(101)}>
                  {counts.questions} {counts.questions === 1 ? 'question' : 'questions'}
                </button>
              ) : null}
              {counts.blockers > 0 ? (
                <button
                  type="button"
                  className="proj-chip is-danger"
                  onClick={() => openSection(102)}
                >
                  {counts.blockers} {counts.blockers === 1 ? 'blocker' : 'blockers'}
                </button>
              ) : null}
              {counts.risks > 0 ? (
                <button
                  type="button"
                  className="proj-chip is-warn"
                  onClick={() => openSection(103)}
                >
                  {counts.risks} {counts.risks === 1 ? 'risk' : 'risks'}
                </button>
              ) : null}
              {newCount > 0 ? <span className="proj-chip is-muted">{newCount} new</span> : null}
              {deliverables ? (
                <span className="proj-chip is-muted">
                  {deliverables.done}/{deliverables.total} deliverables
                </span>
              ) : null}
            </span>
          ) : null}

          {moodLabel ? <span className={`proj-mood is-${mood}`}>{moodLabel}</span> : null}
          {updatedAt ? <span className="proj-meta-item">Updated {fmtAge(updatedAt)}</span> : null}
        </div>
      </div>

      <div className="proj-row-side">
        <span
          className={`proj-progress${progress === null ? ' is-unknown' : ''}`}
          title={
            progress === null
              ? 'Progress not stated in chat'
              : `${progress}% complete. ${paceLabel}`
          }
        >
          <span className="proj-ring">
            <svg viewBox="0 0 36 36" aria-hidden>
              <circle className="proj-ring-track" cx="18" cy="18" r="15" />
              {progress === null ? null : (
                <circle
                  className="proj-ring-fill"
                  cx="18"
                  cy="18"
                  r="15"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={
                    RING_CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, progress)) / 100)
                  }
                />
              )}
            </svg>
            <span className="proj-ring-num">{progress === null ? '—' : `${progress}%`}</span>
          </span>
          {progress === null ? (
            <span className="proj-progress-hint">Not enough info</span>
          ) : null}
        </span>

        {daysTotal ? (
          <>
            <span className="proj-pace" title={paceLabel}>
              {summary.daysUsed ?? 0} of {daysTotal} days
            </span>
            {progress !== null ? (
              <span className={`proj-pace-verdict is-${pace}`}>{paceLabel}</span>
            ) : null}
          </>
        ) : (
          <>
            <span className="proj-pace" title={paceLabel}>
              No dates
            </span>
            <button type="button" className="proj-add-dates" onClick={onSettings}>
              Add dates
            </button>
          </>
        )}

        {weekCounts.some((day) => day.count > 0) ? (
          <span className="proj-week" aria-label="Last 7 days activity">
            {weekCounts.map((day) => (
              <span
                key={day.date}
                className={`proj-week-bar${day.isToday ? ' is-today' : ''}`}
                title={`${day.date}: ${day.count} message${day.count === 1 ? '' : 's'}`}
                style={{ height: `${Math.max(2, Math.round((day.count / weekMax) * 16))}px` }}
              />
            ))}
          </span>
        ) : (
          <span className="proj-week-empty">No messages this week</span>
        )}
      </div>
    </article>
  )
}
