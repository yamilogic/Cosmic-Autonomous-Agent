import type { IpcApi } from '../../../shared/ipc-contract'

type DashboardApi = IpcApi['dashboard']

let override: DashboardApi | null = null

export function dashboardApi(): DashboardApi {
  return override ?? window.api.dashboard
}

/** Demo/screenshot builds only; the production bundle never calls this. */
export function setDashboardApi(next: DashboardApi | null): void {
  override = next
}
