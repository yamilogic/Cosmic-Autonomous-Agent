import type { CardLeftSidebar, CardRightSidebar, CardCentre } from './card-view'

export const GUIDE_SECTIONS = [
  { number: 1, title: 'Start & Timeline' },
  { number: 2, title: 'Client Requirements' },
  { number: 3, title: 'Scope & Deliverables' },
  { number: 4, title: 'Decisions' },
  { number: 5, title: 'Commitments' },
  { number: 6, title: 'Files & Links' },
  { number: 7, title: 'People & Channels' }
] as const

export type GuideSectionNumber = (typeof GUIDE_SECTIONS)[number]['number']

export type DetailKey =
  'needs-reply' | 'blockers' | 'risks' | 'next-steps' | 'mood' | 'activity' | 'history'

export const DETAIL_CARDS: Array<{
  key: DetailKey
  title: string
  tone: 'danger' | 'info' | 'warn' | 'success' | 'accent' | 'muted'
}> = [
  { key: 'needs-reply', title: 'Needs Reply & Open Questions', tone: 'danger' },
  { key: 'blockers', title: 'Blockers', tone: 'info' },
  { key: 'risks', title: 'Risks', tone: 'warn' },
  { key: 'next-steps', title: 'Next Steps', tone: 'success' },
  { key: 'mood', title: 'Client Mood & Signals', tone: 'accent' },
  { key: 'activity', title: 'Activity', tone: 'info' },
  { key: 'history', title: 'History', tone: 'muted' }
]

export function formatDate(iso?: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  } catch {
    return iso
  }
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return iso
  }
}

export function formatTimeAgo(iso?: string): string {
  if (!iso) return 'never'
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function guideHint(data: CardLeftSidebar, n: GuideSectionNumber): string {
  switch (n) {
    case 1:
      return data.startTimeline.startDate || data.startTimeline.endDate
        ? `${formatDate(data.startTimeline.startDate)} → ${formatDate(data.startTimeline.endDate)}`
        : 'Dates not stated in chat'
    case 2:
      return data.requirements.length > 0
        ? `${data.requirements.length} requirement${data.requirements.length === 1 ? '' : 's'}`
        : 'No requirements found in chat'
    case 3: {
      const { inScope, outOfScope, deliverables } = data.scopeDeliverables
      const total = inScope.length + outOfScope.length + deliverables.length
      return total > 0
        ? `${inScope.length} in · ${outOfScope.length} out · ${deliverables.length} deliverable${deliverables.length === 1 ? '' : 's'}`
        : 'Scope not discussed in chat'
    }
    case 4:
      return data.decisions.length > 0
        ? `${data.decisions.length} decision${data.decisions.length === 1 ? '' : 's'}`
        : 'No decisions recorded in chat'
    case 5:
      return data.commitments.length > 0
        ? `${data.commitments.length} commitment${data.commitments.length === 1 ? '' : 's'}`
        : 'No commitments found in chat'
    case 6:
      return data.files.length > 0
        ? `${data.files.length} file${data.files.length === 1 ? '' : 's'}`
        : 'No files shared in this workspace'
    case 7:
      return data.peopleChannels.people.length + data.peopleChannels.channels.length > 0
        ? `${data.peopleChannels.people.length} people · ${data.peopleChannels.channels.length} active channel${data.peopleChannels.channels.length === 1 ? '' : 's'}`
        : 'No people or channels found'
  }
}

export function guideComplete(data: CardLeftSidebar, n: GuideSectionNumber): boolean {
  switch (n) {
    case 1:
      return Boolean(
        data.startTimeline.startDate ||
        data.startTimeline.endDate ||
        data.startTimeline.milestones.length
      )
    case 2:
      return data.requirements.length > 0
    case 3:
      return (
        data.scopeDeliverables.inScope.length +
          data.scopeDeliverables.outOfScope.length +
          data.scopeDeliverables.deliverables.length >
        0
      )
    case 4:
      return data.decisions.length > 0
    case 5:
      return data.commitments.length > 0
    case 6:
      return data.files.length > 0
    case 7:
      return data.peopleChannels.people.length + data.peopleChannels.channels.length > 0
  }
}

export function detailMeta(
  data: CardRightSidebar,
  key: DetailKey
): { count: number; summary: string } {
  switch (key) {
    case 'needs-reply': {
      const q = data.needsReplyOpenQuestions.openQuestions.length
      const count = (data.needsReplyOpenQuestions.needsReply ? 1 : 0) + q
      const summary = data.needsReplyOpenQuestions.needsReply
        ? data.needsReplyOpenQuestions.openQuestions[0] ||
          data.needsReplyOpenQuestions.lastClientMessage?.quote ||
          'Needs your reply'
        : q > 0
          ? data.needsReplyOpenQuestions.openQuestions[0]
          : 'No reply needed'
      return { count, summary }
    }
    case 'blockers':
      return {
        count: data.blockers.length,
        summary:
          data.blockers[0]?.what ??
          (data.blockers.length
            ? `${data.blockers.length} blocker${data.blockers.length === 1 ? '' : 's'}`
            : 'None')
      }
    case 'risks':
      return {
        count: data.risks.length,
        summary: data.risks[0] ?? 'None'
      }
    case 'next-steps':
      return {
        count: data.nextSteps.length,
        summary: data.nextSteps[0] ?? 'No next steps'
      }
    case 'mood':
      return {
        count: data.moodSignals.moodQuote ? 1 : 0,
        summary: data.moodSignals.moodReason || `${data.moodSignals.mood} mood`
      }
    case 'activity':
      return {
        count: data.activity.messages24h > 0 ? 1 : 0,
        summary: `24h ${data.activity.messages24h}, 7d ${data.activity.messages7d}, client ${formatTimeAgo(data.activity.lastClientMessage?.whenIso)}`
      }
    case 'history':
      return {
        count: data.history.length,
        summary: data.history.length
          ? `${data.history[0].from} → ${data.history[0].to}`
          : 'No status history yet'
      }
  }
}

/** Build chat bubbles only from real insight fields — never invented. */
export function buildInsightThread(
  centre: CardCentre,
  projectName: string
): Array<{ id: string; side: 'client' | 'orbit'; who: string; whenIso?: string; body: string }> {
  const out: Array<{
    id: string
    side: 'client' | 'orbit'
    who: string
    whenIso?: string
    body: string
  }> = []
  if (centre.lastClientMessage) {
    out.push({
      id: 'client-last',
      side: 'client',
      who: centre.lastClientMessage.who || 'Client',
      whenIso: centre.lastClientMessage.whenIso,
      body: centre.lastClientMessage.quote
    })
  }
  for (const [i, h] of centre.highlights.slice(0, 5).entries()) {
    out.push({
      id: `hl-${i}`,
      side: h.who ? 'client' : 'orbit',
      who: h.who || `${projectName} insight`,
      whenIso: h.whenIso,
      body: h.what
    })
  }
  if (centre.situationLine) {
    out.push({
      id: 'situation',
      side: 'orbit',
      who: `${projectName} insight`,
      body: centre.situationLine
    })
  }
  if (centre.nextStep) {
    out.push({
      id: 'next',
      side: 'orbit',
      who: `${projectName} insight`,
      body: `Next step: ${centre.nextStep}`
    })
  }
  return out
}
