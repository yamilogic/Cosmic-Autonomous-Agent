import { useEffect, useState } from 'react'
import type { DashboardProjectActivity } from '../../../shared/dashboard-contract'
import { dashboardApi } from '../lib/dashboard-api'

export interface ProjectActivityState {
  activity: DashboardProjectActivity | null
  loading: boolean
}

export function useProjectActivity(
  projectId: string,
  refreshKey?: string | null
): ProjectActivityState {
  const [entry, setEntry] = useState<{
    projectId: string
    activity: DashboardProjectActivity
  } | null>(null)

  useEffect(() => {
    let alive = true
    const api = dashboardApi()
    if (!api || typeof api.getProjectActivity !== 'function') {
      return
    }
    api
      .getProjectActivity(projectId)
      .then((next) => {
        if (alive) setEntry({ projectId, activity: next })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [projectId, refreshKey])

  // A result for another project must never render under this one.
  const activity = entry && entry.projectId === projectId ? entry.activity : null
  return { activity, loading: activity === null }
}
