import type { DashboardProject } from '../../../../shared/dashboard-contract'

type CardChannel = DashboardProject['monitors'][number]

function sameChannels(a: CardChannel[], b: CardChannel[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (channel, i) =>
        channel.channelId === b[i].channelId && channel.channelName === b[i].channelName
    )
  )
}

/** The project fields the card renders. Kept pure so the memo guard can be
 * tested without mounting React or pulling the renderer into a Node typecheck. */
export function sameProjectForCard(a: DashboardProject, b: DashboardProject): boolean {
  return (
    a.name === b.name &&
    a.clientName === b.clientName &&
    a.teamName === b.teamName &&
    a.startDate === b.startDate &&
    a.endDate === b.endDate &&
    a.manualCompletion === b.manualCompletion &&
    sameChannels(a.monitors, b.monitors) &&
    sameChannels(a.ourSlackChannels ?? [], b.ourSlackChannels ?? [])
  )
}
