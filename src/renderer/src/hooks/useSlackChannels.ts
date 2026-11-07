import { useEffect, useState } from 'react'
import type { DashboardProject, DashboardSource } from '../../../shared/dashboard-contract'

export interface SlackChannelListing {
  loading: boolean
  error: string | null
  channels: Array<{ id: string; name: string }>
}

const EMPTY: SlackChannelListing = { loading: false, error: null, channels: [] }
const LOADING: SlackChannelListing = { loading: true, error: null, channels: [] }

/** The last settled listing, tagged with the workspace it was fetched for. The
 * tag is what lets the hook tell "this workspace's list" from "the previous
 * one's list" during render, without writing state before the fetch settles. */
interface SettledListing extends SlackChannelListing {
  key: string | null
}

const UNSETTLED: SettledListing = { key: null, ...EMPTY }

/** Every channel the selected workspace's token can reach. `source` is the
 * card's own client workspace by default; 'ours' reads the one team workspace
 * connected globally. A failure stays a failure: the dropdown shows the reason
 * rather than an empty list that would read as "no channels". While a fetch is
 * in flight, or right after the workspace changed, the listing reads as
 * loading so one workspace never shows another's channels. */
export function useSlackChannels(
  project: DashboardProject | null,
  source: DashboardSource = 'client'
): SlackChannelListing {
  const [settled, setSettled] = useState<SettledListing>(UNSETTLED)
  // Our workspace is global, so it does not depend on which card asked.
  const key = source === 'ours' ? 'ours' : (project?.id ?? null)
  const tokenSource = project?.tokenSource ?? 'oauth'
  const profileId = project?.profileId
  const teamId = project?.teamId
  const manualTokenKey = project?.manualTokenKey

  useEffect(() => {
    if (!key) return
    let cancelled = false
    window.api.dashboard
      .listChannels({ source, tokenSource, profileId, teamId, manualTokenKey })
      .then((channels) => {
        if (cancelled) return
        setSettled({
          key,
          loading: false,
          error: null,
          channels: channels.map((c) => ({ id: c.id, name: c.name }))
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setSettled({
          key,
          loading: false,
          error: err instanceof Error ? err.message : 'Could not list the channels.',
          channels: []
        })
      })
    return () => {
      cancelled = true
    }
  }, [key, source, tokenSource, profileId, teamId, manualTokenKey])

  if (!key) return EMPTY
  if (settled.key !== key) return LOADING
  return { loading: settled.loading, error: settled.error, channels: settled.channels }
}
