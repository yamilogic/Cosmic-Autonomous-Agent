/**
 * v2.4 heuristic insight — the fallback that keeps the dashboard useful when
 * NVIDIA NIM is unavailable (no key, API error, timeout) or when the model
 * reply cannot be parsed. It reuses the local heuristics (mood, pace,
 * completion, distilled summary) so the card never goes blank because of AI.
 *
 * It produces exactly the same shape as the LLM insight, so the card renders
 * identically — only the "heuristic" label tells the two apart.
 */

import type { DashboardProjectSnapshot, ProjectInsight } from '../../shared/dashboard-contract'

export function buildHeuristicInsight(snapshot: DashboardProjectSnapshot): ProjectInsight {
  const lines = snapshot.summary
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const status: ProjectInsight['status'] =
    snapshot.mood.state === 'tense'
      ? 'at-risk'
      : snapshot.pace === 'stale'
        ? 'waiting-on-client'
        : 'on-track'

  const nextStep =
    snapshot.pace === 'stale'
      ? 'Send a short status check to the client.'
      : snapshot.newMessageCount > 0
        ? 'Reply to the newest client message.'
        : ''

  return {
    status,
    statusChange: '',
    recentLine: lines[0] ?? '',
    statusReason:
      snapshot.pace === 'stale'
        ? 'no activity for a while — the client may be waiting'
        : snapshot.mood.state === 'tense'
          ? 'tense words detected in recent messages'
          : 'local heuristics only — no AI insight yet',
    mood: snapshot.mood.state,
    moodReason: snapshot.mood.signal,
    moodQuote: '',
    progress: snapshot.completion,
    progressEvidence: snapshot.mood.signal || (lines[0] ?? ''),
    situationLine: lines[0] ?? '',
    highlights: lines.slice(0, 3).map((what) => ({ what })),
    blockers: [],
    nextStep,
    dates: {
      startDate: snapshot.effectiveDates.startDate,
      endDate: snapshot.effectiveDates.endDate
    },
    clientAsk: { needsReply: false, urgency: 'normal', lastClientMessage: null, openQuestions: [] },
    commitments: [],
    decisions: [],
    risks: [],
    keywords: [],

    // v2.4 fields — heuristic fallback leaves them empty
    requirements: [],
    scope: { in: [], out: [] },
    deliverables: [],
    files: [],
    people: [],
    milestones: []
  }
}