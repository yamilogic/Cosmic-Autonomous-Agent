export type AutomationSessionMode = 'visible_when_idle' | 'hidden_always' | 'watch_live'
export type AutomationBorderStyle = 'thin' | 'glow'
export type AutomationStripDefault = 'collapsed' | 'expanded'

export interface AutomationSettings {
  sessionMode: AutomationSessionMode
  idleSeconds: number
  showBorder: boolean
  borderStyle: AutomationBorderStyle
  showControlStrip: boolean
  stripDefault: AutomationStripDefault
  showLiveFeed: boolean
  showAgentCursor: boolean
  showHighlights: boolean
  showStatusPill: boolean
  showScrollIndicator: boolean
  showTypingPreview: boolean // disabled "Soon"
  overlaySpeed: 'normal' | 'slow'
  enabled: boolean
  backfillDays: 1 | 7 | 30
  unreadOnly: boolean
  maxScrollScreens: number
  activeHours: string
  pauseOnChallenge: boolean
  intervalMinutes: 5 | 15 | 30 | 60
  dailyRecheck: boolean
  logRetentionDays: 7 | 30 | 90
  logMessageSnippets: boolean
  notifyOnPause: boolean
  notifyOnNewUrgent: boolean
}

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  sessionMode: 'visible_when_idle',
  idleSeconds: 30,
  showBorder: true,
  borderStyle: 'thin',
  showControlStrip: true,
  stripDefault: 'collapsed',
  showLiveFeed: true,
  showAgentCursor: true,
  showHighlights: true,
  showStatusPill: true,
  showScrollIndicator: true,
  showTypingPreview: false,
  overlaySpeed: 'normal',
  enabled: true,
  backfillDays: 7,
  unreadOnly: true,
  maxScrollScreens: 8,
  activeHours: '09:00-21:00',
  pauseOnChallenge: true,
  intervalMinutes: 15,
  dailyRecheck: false,
  logRetentionDays: 30,
  logMessageSnippets: true,
  notifyOnPause: true,
  notifyOnNewUrgent: false
}

