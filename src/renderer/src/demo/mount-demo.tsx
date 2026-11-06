import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  DashboardProjectActivity,
  DashboardSchedulesState
} from '../../../shared/dashboard-contract'
import DashboardPage from '../components/dashboard/DashboardPage'
import { buildCardSummary, buildCardView } from '../components/dashboard/card-view'
import { setDashboardApi } from '../lib/dashboard-api'
import { emptyActivity, richActivity, richSnapshot, sparseSnapshot } from './fixtures'
import './demo.css'

type DemoMode = 'sparse' | 'rich'

const schedules: DashboardSchedulesState = {
  settings: {
    slackSync: { enabled: true, intervalMinutes: 15 },
    dailyRecheck: { enabled: false, hour: 9 }
  },
  lastRunAt: {
    'slack-sync': new Date(Date.now() - 6 * 60_000).toISOString(),
    'agent-analysis': null,
    'daily-recheck': null
  },
  nextRunAt: new Date(Date.now() + 9 * 60_000).toISOString(),
  nextDailyRunAt: null,
  running: false,
  runs: []
}

export function mountDemo(mode: DemoMode): void {
  const snapshot = mode === 'rich' ? richSnapshot : sparseSnapshot
  const activity: DashboardProjectActivity = mode === 'rich' ? richActivity : emptyActivity
  const base = window.api.dashboard

  // The fixture owns every read and turns every action into a no-op so a demo
  // run cannot reach a store, the disk, or Slack.
  setDashboardApi({
    ...base,
    getSchedules: async () => schedules,
    onSchedulesChanged: () => () => undefined,
    getProjectChatStatus: async () => ({
      hasKey: mode === 'rich',
      model: 'demo-model',
      modelSource: 'global',
      keySource: 'global'
    }),
    onConfigChanged: () => () => undefined,
    getProjectActivity: async () => activity
  })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <div className="demo-shell">
        <span className="demo-watermark">Demo data</span>
        <DashboardPage
          view={buildCardView(snapshot, 0)}
          summary={buildCardSummary(snapshot, 0)}
          project={snapshot.project}
          snapshot={snapshot}
          syncing={false}
          onSync={() => undefined}
          onOpenSettings={() => undefined}
          onSelect={() => undefined}
        />
      </div>
    </StrictMode>
  )
}
