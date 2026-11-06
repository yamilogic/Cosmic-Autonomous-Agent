import { describe, expect, it } from 'vitest'
import type { DashboardProject } from '../../src/shared/dashboard-contract'
import { sameProjectForCard } from '../../src/renderer/src/components/dashboard/project-card-compare'

const base = (): DashboardProject => ({
  id: 'p1',
  name: 'Project',
  clientName: 'Client',
  profileId: 'manual:K1',
  teamId: 'T1',
  teamName: 'Client Slack',
  appId: 'slack',
  tokenSource: 'manual',
  monitors: [{ channelId: 'C1', channelName: 'general' }],
  ourSlackChannels: [{ channelId: 'T9', channelName: 'our-project' }],
  createdAt: '2026-01-01T00:00:00Z'
})

describe('sameProjectForCard', () => {
  it('notices a changed Our Slack channel mapping', () => {
    const before = base()
    const after = {
      ...before,
      ourSlackChannels: [{ channelId: 'T10', channelName: 'our-other' }]
    }

    expect(sameProjectForCard(before, after)).toBe(false)
  })
})
