import type React from 'react'
import { useMemo } from 'react'
import AccordionSidebar, { SidebarSection } from './AccordionSection'
import type { CardRightSidebar } from './card-view'

interface RightSidebarProps {
  data: CardRightSidebar
  projectId: string
  onSectionChange?: (section: number | null) => void
  onWidthChange?: (width: number) => void
  onCollapseChange?: (collapsed: boolean) => void
}

function formatDate(iso?: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function formatTimeAgo(iso?: string): string {
  if (!iso) return 'never'
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function getMoodClass(mood: string): string {
  switch (mood) {
    case 'good': return 'bg-green-500/15 text-green-400 border-green-500/30'
    case 'tense': return 'bg-red-500/15 text-red-400 border-red-500/30'
    default: return 'bg-gray-500/15 text-gray-400 border-gray-500/30'
  }
}

function getMoodLabel(mood: string): string {
  switch (mood) {
    case 'good': return 'Good'
    case 'tense': return 'Tense'
    default: return 'Neutral'
  }
}

function getUrgencyClass(urgency: string): string {
  switch (urgency) {
    case 'high': return 'bg-red-500/15 text-red-400 border-red-500/30'
    case 'low': return 'bg-gray-500/15 text-gray-400 border-gray-500/30'
    default: return 'bg-purple-500/15 text-purple-400 border-purple-500/30'
  }
}

export default function RightSidebar({
  data,
  projectId,
  onSectionChange,
  onWidthChange,
  onCollapseChange
}: RightSidebarProps): React.ReactElement {
  const sections = useMemo<SidebarSection[]>(() => [
    {
      number: 1,
      title: 'Needs Reply & Open Questions',
      hint: data.needsReplyOpenQuestions.needsReply
        ? `Needs reply (${data.needsReplyOpenQuestions.urgency} urgency), ${data.needsReplyOpenQuestions.openQuestions.length} open question${data.needsReplyOpenQuestions.openQuestions.length !== 1 ? 's' : ''}`
        : data.needsReplyOpenQuestions.openQuestions.length > 0
        ? `${data.needsReplyOpenQuestions.openQuestions.length} open question${data.needsReplyOpenQuestions.openQuestions.length !== 1 ? 's' : ''}`
        : 'No reply needed, no open questions',
      content: (
        <div className="space-y-4">
          {data.needsReplyOpenQuestions.needsReply ? (
            <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <span className={`dash-chip px-2 py-1 rounded-full text-xs font-medium border ${getUrgencyClass(data.needsReplyOpenQuestions.urgency)}`}>
                Needs my reply
              </span>
              <span className="text-xs text-muted-dark">{data.needsReplyOpenQuestions.urgency} urgency</span>
            </div>
          ) : (
            <p className="text-sm text-green-400 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">✓ No reply needed from you</p>
          )}

          {data.needsReplyOpenQuestions.lastClientMessage && (
            <div className="pt-2 border-t border-border-dark/50 space-y-2">
              <span className="text-xs font-semibold text-muted-dark block">Last Client Message</span>
              <div className="p-3 bg-surface-2-dark border border-border-dark rounded-lg space-y-2">
                <p className="text-sm text-text-dark italic">"{data.needsReplyOpenQuestions.lastClientMessage.quote}"</p>
                <div className="flex flex-wrap gap-3 text-xs text-muted-dark">
                  <span>from {data.needsReplyOpenQuestions.lastClientMessage.who}</span>
                  <span>{formatDateTime(data.needsReplyOpenQuestions.lastClientMessage.whenIso)}</span>
                </div>
              </div>
            </div>
          )}

          {data.needsReplyOpenQuestions.openQuestions.length > 0 ? (
            <div className="pt-2 border-t border-border-dark/50 space-y-2">
              <span className="text-xs font-semibold text-muted-dark block">Open Questions</span>
              <ul className="space-y-2">
                {data.needsReplyOpenQuestions.openQuestions.map((q, i) => (
                  <li key={i} className="flex items-start gap-3 p-2 bg-surface-2-dark border border-border-dark rounded">
                    <span className="text-yellow-400 font-bold flex-shrink-0">?</span>
                    <span className="text-sm text-text-dark flex-1 min-w-0">{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-dark italic pt-2 border-t border-border-dark/50">No open questions</p>
          )}
        </div>
      ),
      isEmpty: !data.needsReplyOpenQuestions.needsReply && data.needsReplyOpenQuestions.openQuestions.length === 0
    },
    {
      number: 2,
      title: 'Blockers',
      hint: data.blockers.length > 0
        ? `${data.blockers.length} blocker${data.blockers.length !== 1 ? 's' : ''}`
        : 'No blockers',
      content: (
        <div className="space-y-3">
          {data.blockers.length > 0 ? (
            <ul className="space-y-3">
              {data.blockers.map((b, i) => (
                <li key={i} className="p-3 bg-surface-2-dark border border-border-dark rounded-lg border-l-3 border-yellow-400 space-y-1">
                  <p className="text-sm text-text-dark">{b.what}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-dark">
                    {b.owner && <span>owner: {b.owner}</span>}
                    {b.sinceIso && <span>since {formatDate(b.sinceIso)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-dark italic">No blockers — work can proceed</p>
          )}
        </div>
      ),
      isEmpty: data.blockers.length === 0
    },
    {
      number: 3,
      title: 'Risks',
      hint: data.risks.length > 0
        ? `${data.risks.length} risk${data.risks.length !== 1 ? 's' : ''}`
        : 'No risks identified',
      content: (
        <div className="space-y-3">
          {data.risks.length > 0 ? (
            <ul className="space-y-2">
              {data.risks.map((r, i) => (
                <li key={i} className="flex items-start gap-3 p-2 bg-surface-2-dark border border-border-dark rounded">
                  <span className="text-red-400 flex-shrink-0">⚠</span>
                  <span className="text-sm text-text-dark flex-1 min-w-0">{r}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-dark italic">No risks identified in chat</p>
          )}
        </div>
      ),
      isEmpty: data.risks.length === 0
    },
    {
      number: 4,
      title: 'Next Steps',
      hint: data.nextSteps.length > 0
        ? `${data.nextSteps.length} step${data.nextSteps.length !== 1 ? 's' : ''}`
        : 'No next steps defined',
      content: (
        <div className="space-y-3">
          {data.nextSteps.length > 0 ? (
            <ul className="space-y-2">
              {data.nextSteps.map((step, i) => (
                <li key={i} className="flex items-start gap-3 p-2 bg-surface-2-dark border border-border-dark rounded">
                  <span className="text-accent font-bold flex-shrink-0">→</span>
                  <span className="text-sm text-text-dark flex-1 min-w-0">{step}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-dark italic">No next steps — add one in the centre panel</p>
          )}
        </div>
      ),
      isEmpty: data.nextSteps.length === 0
    },
    {
      number: 5,
      title: 'Client Mood & Signals',
      hint: `Mood: ${getMoodLabel(data.moodSignals.mood)} — ${data.moodSignals.moodReason || 'no signal'}`,
      content: (
        <div className="space-y-4">
          <div className="p-3 bg-surface-2-dark border border-border-dark rounded-lg space-y-2">
            <span className={`dash-chip px-2 py-1 rounded-full text-xs font-medium border ${getMoodClass(data.moodSignals.mood)}`}>
              {getMoodLabel(data.moodSignals.mood)}
            </span>
            <p className="text-sm text-text-dark">{data.moodSignals.moodReason || 'No mood signal detected'}</p>
          </div>
          {data.moodSignals.moodQuote && (
            <div className="pt-2 border-t border-border-dark/50 space-y-2">
              <span className="text-xs font-semibold text-muted-dark block">Client Quote</span>
              <blockquote className="text-sm text-muted-dark italic border-l-2 border-accent pl-3 py-1 bg-surface-2-dark rounded-r-lg">
                "{data.moodSignals.moodQuote}"
              </blockquote>
            </div>
          )}
        </div>
      ),
      isEmpty: false
    },
    {
      number: 6,
      title: 'Activity',
      hint: `24h: ${data.activity.messages24h}, 7d: ${data.activity.messages7d}, last client ${data.activity.lastClientMessage ? formatTimeAgo(data.activity.lastClientMessage.whenIso) : 'never'}, my reply ${data.activity.myLastReply ? formatTimeAgo(data.activity.myLastReply.whenIso) : 'never'}`,
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col items-center gap-1 p-3 bg-surface-2-dark border border-border-dark rounded-lg text-center">
              <span className="text-xs font-semibold text-muted-dark">Messages (24h)</span>
              <span className="text-xl font-bold text-text-dark">{data.activity.messages24h}</span>
            </div>
            <div className="flex flex-col items-center gap-1 p-3 bg-surface-2-dark border border-border-dark rounded-lg text-center">
              <span className="text-xs font-semibold text-muted-dark">Messages (7d)</span>
              <span className="text-xl font-bold text-text-dark">{data.activity.messages7d}</span>
            </div>
            <div className="flex flex-col items-center gap-1 p-3 bg-surface-2-dark border border-border-dark rounded-lg text-center">
              <span className="text-xs font-semibold text-muted-dark">Last Client Msg</span>
              <span className="text-sm font-bold text-text-dark">
                {data.activity.lastClientMessage ? formatTimeAgo(data.activity.lastClientMessage.whenIso) : 'never'}
              </span>
            </div>
            <div className="flex flex-col items-center gap-1 p-3 bg-surface-2-dark border border-border-dark rounded-lg text-center">
              <span className="text-xs font-semibold text-muted-dark">My Last Reply</span>
              <span className="text-sm font-bold text-text-dark">
                {data.activity.myLastReply ? formatTimeAgo(data.activity.myLastReply.whenIso) : 'never'}
              </span>
            </div>
          </div>

          {data.activity.lastClientMessage && (
            <div className="pt-2 border-t border-border-dark/50 space-y-2">
              <span className="text-xs font-semibold text-muted-dark block">Last Client Message</span>
              <div className="p-3 bg-surface-2-dark border border-border-dark rounded-lg space-y-2">
                <p className="text-sm text-text-dark italic">"{data.activity.lastClientMessage.quote}"</p>
                <div className="flex flex-wrap gap-3 text-xs text-muted-dark">
                  <span>from {data.activity.lastClientMessage.who}</span>
                  <span>{formatDateTime(data.activity.lastClientMessage.whenIso)}</span>
                </div>
              </div>
            </div>
          )}

          {data.activity.myLastReply && (
            <div className="pt-2 border-t border-border-dark/50 space-y-2">
              <span className="text-xs font-semibold text-muted-dark block">My Last Reply</span>
              <div className="p-3 bg-surface-2-dark border border-border-dark rounded-lg space-y-2">
                <p className="text-sm text-text-dark italic">"{data.activity.myLastReply.quote}"</p>
                <div className="flex flex-wrap gap-3 text-xs text-muted-dark">
                  <span>from {data.activity.myLastReply.who}</span>
                  <span>{formatDateTime(data.activity.myLastReply.whenIso)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      ),
      isEmpty: false
    },
    {
      number: 7,
      title: 'History',
      hint: data.history.length > 0
        ? `${data.history.length} status change${data.history.length !== 1 ? 's' : ''}`
        : 'No status history yet',
      content: (
        <div className="space-y-3">
          {data.history.length > 0 ? (
            <ul className="space-y-3">
              {data.history.map((h, i) => (
                <li key={i} className="p-3 bg-surface-2-dark border border-border-dark rounded-lg">
                  <div className="flex items-center gap-2 text-sm mb-1">
                    <span className="text-muted-dark">{h.from}</span>
                    <span className="text-accent font-bold">→</span>
                    <span className="text-text-dark font-semibold">{h.to}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-dark">
                    <span>{formatDateTime(h.dateIso)}</span>
                    <span>+{h.msgCount} msgs</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-dark italic">No status changes recorded yet — history builds as insights refresh</p>
          )}
        </div>
      ),
      isEmpty: data.history.length === 0
    }
  ], [data])

  return (
    <AccordionSidebar
      sections={sections}
      sidebarId="right"
      projectId={projectId}
      onSectionChange={onSectionChange}
      onWidthChange={onWidthChange}
      onCollapseChange={onCollapseChange}
    />
  )
}