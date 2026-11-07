import { describe, expect, it } from 'vitest'
import {
  resolveProjectMessageSources,
  type ResolveProjectMessageSourcesOptions
} from '../../src/main/dashboard/message-sources'
import type { DashboardProject, ProjectSource } from '../../src/shared/dashboard-contract'

function project(overrides: Partial<DashboardProject> = {}): DashboardProject {
  return {
    id: 'proj-1',
    name: 'Acme',
    clientName: 'Acme',
    profileId: 'prof-1',
    teamId: 'T1',
    teamName: 'Acme Slack',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [],
    sources: [],
    sourcePreference: 'token_first',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function browserSource(overrides: Partial<ProjectSource> = {}): ProjectSource {
  return {
    id: 'src-browser-1',
    kind: 'browser',
    platform: 'slack',
    profileId: 'prof-1',
    workspaceId: 'T1',
    workspaceName: 'Acme Slack',
    channels: [],
    role: 'client',
    enabled: true,
    backfillDays: 7,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function resolve(projectValue: DashboardProject, options: ResolveProjectMessageSourcesOptions = {}) {
  return resolveProjectMessageSources(projectValue, options)
}

describe('resolveProjectMessageSources', () => {
  it('reads a browser-only card from its selected source channels, not project.monitors', () => {
    const p = project({
      sourcePreference: 'browser_only',
      monitors: [],
      sources: [
        browserSource({
          channels: [
            { id: 'C1', name: 'general', enabled: true, kind: 'public' },
            { id: 'C2', name: 'noise', enabled: false, kind: 'public' },
            { id: 'D1', name: 'Priya', enabled: true, kind: 'dm', isDm: true }
          ]
        })
      ]
    })

    const result = resolve(p)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      source: 'client',
      profileId: 'prof-1',
      teamId: 'T1',
      origin: 'source',
      projectSourceId: 'src-browser-1'
    })
    expect(result[0]!.channels.map((c) => c.channelId)).toEqual(['C1', 'D1'])
  })

  it('falls back to legacy project.monitors for a token card with no sources', () => {
    const p = project({
      monitors: [{ channelId: 'C9', channelName: 'legacy' }]
    })

    const result = resolve(p)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ source: 'client', origin: 'legacy' })
    expect(result[0]!.channels).toEqual([
      expect.objectContaining({ channelId: 'C9', channelName: 'legacy' })
    ])
  })

  it('ignores mirrored legacy monitors on a browser-only card', () => {
    const p = project({
      sourcePreference: 'browser_only',
      monitors: [
        { channelId: 'C1', channelName: 'general' },
        { channelId: 'C_NOT_SELECTED', channelName: 'accidental' }
      ],
      sources: [
        browserSource({
          channels: [{ id: 'C1', name: 'general', enabled: true }]
        })
      ]
    })

    const result = resolve(p)

    expect(result[0]!.channels.map((c) => c.channelId)).toEqual(['C1'])
    expect(result.flatMap((s) => s.channels.map((c) => c.channelId))).not.toContain(
      'C_NOT_SELECTED'
    )
  })

  it('keeps distinct token monitors on a mixed card but dedupes a channel already in a source', () => {
    const p = project({
      monitors: [
        { channelId: 'C1', channelName: 'general' },
        { channelId: 'C9', channelName: 'token-only' }
      ],
      sources: [
        browserSource({
          channels: [{ id: 'C1', name: 'general', enabled: true }]
        })
      ]
    })

    const result = resolve(p)
    const ids = result.flatMap((s) => s.channels.map((c) => c.channelId))

    expect(ids).toEqual(['C1', 'C9'])
    expect(result.find((s) => s.channels.some((c) => c.channelId === 'C1'))?.origin).toBe('source')
  })

  it('excludes a disabled source', () => {
    const p = project({
      sources: [
        browserSource({
          enabled: false,
          channels: [{ id: 'C1', name: 'general', enabled: true }]
        })
      ]
    })

    expect(resolve(p)).toEqual([])
  })

  it('excludes ticked channels when the source is in exclude mode', () => {
    const p = project({
      sourcePreference: 'browser_only',
      sources: [
        browserSource({
          selectionMode: 'exclude',
          channels: [
            { id: 'C1', name: 'noisy', enabled: true, kind: 'public' },
            { id: 'C2', name: 'team', enabled: false, kind: 'public' },
            { id: 'C3', name: 'alerts', enabled: false, kind: 'public' }
          ]
        })
      ]
    })

    const result = resolve(p)

    expect(result[0]!.channels.map((channel) => channel.channelId)).toEqual(['C2', 'C3'])
  })

  it('uses the mapped workspace id for legacy monitors', () => {
    const p = project({ monitors: [{ channelId: 'C9', channelName: 'legacy' }] })

    const result = resolve(p, { mappedTeamId: 'T_MAPPED' })

    expect(result[0]!.teamId).toBe('T_MAPPED')
  })

  it('adds the global Our Slack workspace without duplicating it', () => {
    const p = project({
      monitors: [{ channelId: 'C9', channelName: 'legacy' }]
    })

    const result = resolve(p, {
      ourSlack: {
        profileId: 'prof-ours',
        teamId: 'T_OURS',
        channels: [{ channelId: 'CO1', channelName: 'our-team' }]
      }
    })

    expect(result).toHaveLength(2)
    expect(result.find((s) => s.source === 'ours')).toMatchObject({
      origin: 'our-slack',
      profileId: 'prof-ours',
      teamId: 'T_OURS'
    })
  })

  it('prefers per-card ourSlackChannels over global Our Slack channels', () => {
    const p = project({
      ourSlackChannels: [{ channelId: 'CO_CARD', channelName: 'card-channel' }],
      sources: []
    })

    const result = resolve(p, {
      ourSlack: {
        profileId: 'prof-ours',
        teamId: 'T_OURS',
        channels: [{ channelId: 'CO_GLOBAL', channelName: 'global-channel' }]
      }
    })

    const ours = result.filter((s) => s.source === 'ours')
    expect(ours).toHaveLength(1)
    expect(ours[0]!.channels.map((c) => c.channelId)).toEqual(['CO_CARD'])
  })
})
