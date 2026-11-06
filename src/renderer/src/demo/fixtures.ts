import type {
  DashboardMetrics,
  DashboardProject,
  DashboardProjectActivity,
  DashboardProjectSnapshot,
  ProjectInsight
} from '../../../shared/dashboard-contract'

const NOW = Date.now()
const minutesAgo = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString()
const hoursAgo = (hours: number): string => minutesAgo(hours * 60)
const daysAgo = (days: number): string => hoursAgo(days * 24)
const dayKey = (daysBack: number): string =>
  new Date(NOW - daysBack * 86_400_000).toISOString().slice(0, 10)

const richProject: DashboardProject = {
  id: 'demo-rich',
  name: 'Aurora storefront',
  clientName: 'Northwind Retail',
  profileId: 'demo',
  teamId: 'T_NORTHWIND',
  teamName: 'Northwind Retail',
  appId: 'slack',
  tokenSource: 'manual',
  selfUserId: 'U_ME',
  monitors: [
    { channelId: 'C_AURORA', channelName: 'aurora-build' },
    { channelId: 'C_LAUNCH', channelName: 'launch-room' }
  ],
  ourSlackChannels: [{ channelId: 'C_OURS', channelName: 'project-aurora' }],
  ourSlackTeamId: 'T_ORBIT',
  ourSlackTeamName: 'Orbit Studio',
  startDate: '2026-10-01',
  endDate: '2026-11-08',
  createdAt: '2026-09-20T09:00:00Z'
}

const richInsight: ProjectInsight = {
  status: 'at-risk',
  statusReason: 'Two client questions are waiting on us.',
  statusChange: 'on-track → at-risk',
  mood: 'tense',
  moodReason: 'Client repeated the Friday deadline twice.',
  moodQuote: 'We need this before Friday.',
  progress: 64,
  progressEvidence: 'Draft review moved to final QA.',
  situationLine: 'Final QA is underway; two client questions are still open.',
  recentLine: 'Client asked whether SSO can land in Friday’s build.',
  highlights: [],
  blockers: [
    { what: 'SSO sandbox access is still missing.', owner: 'Orbit', sinceIso: daysAgo(2) }
  ],
  nextStep: 'Confirm the SSO scope with Priya and send the Friday plan.',
  dates: { startDate: '2026-10-01', endDate: '2026-11-08', evidence: 'Kickoff and launch notes' },
  clientAsk: {
    needsReply: true,
    urgency: 'high',
    lastClientMessage: {
      who: 'Priya Nair',
      whenIso: hoursAgo(3),
      quote: 'Can SSO make Friday’s build?',
      source: 'client',
      channelId: 'C_AURORA',
      ts: '100.3'
    },
    openQuestions: ['Can SSO make Friday’s build?', 'Which environments need the new login flow?']
  },
  commitments: [],
  decisions: [{ what: 'Launch stays on 8 Nov.', whenIso: daysAgo(4) }],
  risks: ['The Friday build may slip if the SSO scope grows.'],
  keywords: ['sso', 'launch', 'invoice export'],
  requirements: [
    { text: 'Export invoices as CSV.', whenIso: daysAgo(5) },
    { text: 'Add SSO to the Friday build.', whenIso: daysAgo(2) },
    { text: 'Show order history on the account page.', whenIso: daysAgo(1) },
    { text: 'Move launch copy to the shared doc.', whenIso: hoursAgo(3) }
  ],
  scope: { in: [], out: [] },
  deliverables: [
    { name: 'Checkout copy pass', status: 'done' },
    { name: 'Order history', status: 'in-progress' },
    { name: 'SSO login', status: 'in-progress' },
    { name: 'Invoice export', status: 'pending' },
    { name: 'Launch checklist', status: 'not-started' }
  ],
  files: [],
  people: [],
  milestones: []
}

const clientSeries = [3, 1, 4, 0, 5, 2, 6, 3, 4, 2, 7, 5, 4, 6]
const ourSeries = [2, 0, 1, 0, 3, 1, 2, 1, 2, 1, 4, 2, 3, 3]

const richMetrics: DashboardMetrics = {
  daily: clientSeries.map((client, index) => ({
    date: dayKey(13 - index),
    client,
    ours: ourSeries[index],
    isToday: index === 13
  })),
  messages24h: { client: 6, ours: 3 },
  lastClientContactAt: hoursAgo(3),
  ourResponse: { medianSeconds: 5220, pairs: 8, windowDays: 14 },
  waiting: {
    count: 2,
    oldestIso: daysAgo(1),
    blockers: 1,
    risks: 2,
    items: [
      {
        kind: 'needs-reply',
        text: 'Priya asked whether SSO can land before Friday’s build.',
        atIso: hoursAgo(3),
        source: 'client',
        channelId: 'C_AURORA',
        ts: '100.3'
      },
      {
        kind: 'question',
        text: 'Which environments need the new login flow?',
        atIso: daysAgo(1),
        source: 'client',
        channelId: 'C_LAUNCH',
        ts: '99.1'
      },
      {
        kind: 'blocker',
        text: 'SSO sandbox access is still missing.',
        atIso: daysAgo(2)
      },
      {
        kind: 'risk',
        text: 'The Friday build may slip if the SSO scope grows.',
        atIso: daysAgo(2)
      },
      {
        kind: 'requirement',
        text: 'Export invoices as CSV.',
        atIso: daysAgo(5),
        source: 'client',
        channelId: 'C_AURORA',
        ts: '95.4'
      },
      {
        kind: 'decision',
        text: 'Launch stays on 8 Nov.',
        atIso: daysAgo(4)
      }
    ]
  },
  statusSince: '2026-10-18T09:00:00Z',
  moodTrend: [
    { atIso: daysAgo(12), mood: 'neutral' },
    { atIso: daysAgo(8), mood: 'good' },
    { atIso: daysAgo(4), mood: 'neutral' },
    { atIso: daysAgo(1), mood: 'tense' }
  ],
  newSince: {
    lastViewedAt: daysAgo(1),
    counts: {
      requirements: 2,
      decisions: 1,
      commitments: 1,
      files: 1,
      statusChanges: 1,
      questions: 1
    },
    items: [
      { kind: 'requirement', text: 'Move launch copy to the shared doc.', atIso: hoursAgo(3) },
      { kind: 'question', text: 'Can SSO make Friday’s build?', atIso: hoursAgo(3) },
      { kind: 'decision', text: 'Launch stays on 8 Nov.', atIso: daysAgo(4) },
      { kind: 'commitment', text: 'Maya sends the Friday plan.', atIso: daysAgo(1) },
      { kind: 'file', text: 'aurora-launch-plan.pdf', atIso: daysAgo(1) },
      { kind: 'status', text: 'Status moved to at-risk.', atIso: hoursAgo(5) },
      { kind: 'requirement', text: 'Show order history on the account page.', atIso: daysAgo(1) }
    ]
  }
}

export const richSnapshot: DashboardProjectSnapshot = {
  project: richProject,
  summary: 'Final QA is underway; the client is asking about SSO for Friday.',
  newMessageCount: 7,
  totalMessageCount: 214,
  completion: 64,
  pace: 'on-track',
  mood: { state: 'tense', signal: 'Client repeated the deadline.' },
  extractedDates: { startDate: '2026-10-01', endDate: '2026-11-08' },
  effectiveDates: { startDate: '2026-10-01', endDate: '2026-11-08' },
  perChannel: [
    {
      channelId: 'C_AURORA',
      channelName: 'aurora-build',
      source: 'client',
      messageCount: 128,
      latestMessageAt: hoursAgo(3),
      cursor: '100.3',
      lastSyncAt: minutesAgo(4)
    },
    {
      channelId: 'C_LAUNCH',
      channelName: 'launch-room',
      source: 'client',
      messageCount: 52,
      latestMessageAt: daysAgo(1),
      cursor: '99.1',
      lastSyncAt: minutesAgo(4)
    },
    {
      channelId: 'C_OURS',
      channelName: 'project-aurora',
      source: 'ours',
      messageCount: 34,
      latestMessageAt: minutesAgo(12),
      cursor: '200.9',
      lastSyncAt: minutesAgo(4)
    }
  ],
  lastUpdatedAt: minutesAgo(4),
  syncState: 'idle',
  metrics: richMetrics,
  insight: richInsight,
  insightUpdatedAt: minutesAgo(30),
  insightModel: 'demo-model',
  insightSource: 'ai'
}

export const richActivity: DashboardProjectActivity = {
  recent: [
    {
      source: 'ours',
      channelId: 'C_OURS',
      channelName: 'project-aurora',
      ts: '200.9',
      atIso: minutesAgo(12),
      userId: 'U_MAYA',
      userName: 'Maya Chen',
      isMine: false,
      text: 'Pushed the SSO fix to staging — ready for a client pass.',
      permalink: null
    },
    {
      source: 'client',
      channelId: 'C_AURORA',
      channelName: 'aurora-build',
      ts: '100.3',
      atIso: hoursAgo(3),
      userId: 'U_PRIYA',
      userName: 'Priya Nair',
      isMine: false,
      text: 'Can SSO make Friday’s build?',
      permalink: null
    },
    {
      source: 'ours',
      channelId: 'C_OURS',
      channelName: 'project-aurora',
      ts: '200.8',
      atIso: hoursAgo(5),
      userId: 'U_DEV',
      userName: 'Dev Patel',
      isMine: false,
      text: 'Yes — scope is limited to the staging tenant.',
      permalink: null
    },
    {
      source: 'client',
      channelId: 'C_LAUNCH',
      channelName: 'launch-room',
      ts: '99.1',
      atIso: daysAgo(1),
      userId: 'U_PRIYA',
      userName: 'Priya Nair',
      isMine: false,
      text: 'Launch copy is approved.',
      permalink: null
    },
    {
      source: 'client',
      channelId: 'C_AURORA',
      channelName: 'aurora-build',
      ts: '98.2',
      atIso: daysAgo(2),
      userId: 'U_TOM',
      userName: 'Tom Alvarez',
      isMine: false,
      text: 'Invoice export needs CSV, not PDF.',
      permalink: null
    },
    {
      source: 'ours',
      channelId: 'C_OURS',
      channelName: 'project-aurora',
      ts: '200.7',
      atIso: daysAgo(3),
      userId: 'U_MAYA',
      userName: 'Maya Chen',
      isMine: false,
      text: 'Draft review is done; moving to final QA.',
      permalink: null
    }
  ],
  latestClientAt: hoursAgo(3),
  latestOursAt: minutesAgo(12),
  ballInCourt: 'client',
  participants: [
    { userId: 'U_MAYA', name: 'Maya Chen', source: 'ours', count: 9 },
    { userId: 'U_PRIYA', name: 'Priya Nair', source: 'client', count: 7 },
    { userId: 'U_DEV', name: 'Dev Patel', source: 'ours', count: 4 }
  ],
  channels: [
    { channelId: 'C_AURORA', channelName: 'aurora-build', source: 'client', count: 14 },
    { channelId: 'C_OURS', channelName: 'project-aurora', source: 'ours', count: 12 },
    { channelId: 'C_LAUNCH', channelName: 'launch-room', source: 'client', count: 6 }
  ],
  counts14d: { client: 41, ours: 29 }
}

const sparseProject: DashboardProject = {
  id: 'demo-sparse',
  name: 'Harbor redesign',
  clientName: 'Harbor Goods',
  profileId: 'demo',
  teamId: 'T_HARBOR',
  teamName: 'Harbor Goods',
  appId: 'slack',
  tokenSource: 'manual',
  monitors: [{ channelId: 'C_HARBOR', channelName: 'harbor-site' }],
  createdAt: '2026-10-22T09:00:00Z'
}

export const sparseSnapshot: DashboardProjectSnapshot = {
  project: sparseProject,
  summary: '',
  newMessageCount: 0,
  totalMessageCount: 0,
  completion: 0,
  pace: 'stale',
  mood: { state: 'neutral', signal: '' },
  extractedDates: {},
  effectiveDates: {},
  perChannel: [],
  lastUpdatedAt: null,
  syncState: 'idle',
  insight: null
}

export const emptyActivity: DashboardProjectActivity = {
  recent: [],
  latestClientAt: null,
  latestOursAt: null,
  ballInCourt: null,
  participants: [],
  channels: [],
  counts14d: { client: 0, ours: 0 }
}
