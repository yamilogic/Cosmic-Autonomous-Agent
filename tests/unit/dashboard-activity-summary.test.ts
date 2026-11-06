import { describe, expect, it } from 'vitest'
import {
  buildProjectActivity,
  type ActivityInputRow
} from '../../src/main/dashboard/activity-summary'

const NOW = Date.parse('2026-10-25T12:00:00Z')
const iso = (minutesAgo: number): string => new Date(NOW - minutesAgo * 60_000).toISOString()

function row(overrides: Partial<ActivityInputRow> = {}): ActivityInputRow {
  return {
    source: 'client',
    channelId: 'C1',
    channelName: 'client-general',
    ts: String((NOW - 60_000) / 1000),
    userId: 'U-client',
    userName: 'Priya',
    isMine: false,
    text: 'Can you share the latest?',
    ...overrides
  }
}

describe('buildProjectActivity — ball in court', () => {
  it('is yours when the client wrote after our last reply', () => {
    const activity = buildProjectActivity({
      now: NOW,
      rows: [
        row({
          ts: String((NOW - 7_200_000) / 1000),
          isMine: true,
          userId: 'U-us',
          userName: 'You'
        }),
        row({ ts: String((NOW - 3_600_000) / 1000) })
      ]
    })
    expect(activity.ballInCourt).toBe('you')
    expect(activity.latestClientAt).toBe(iso(60))
  })

  it("is the client's when we replied last", () => {
    const activity = buildProjectActivity({
      now: NOW,
      rows: [
        row({ ts: String((NOW - 3_600_000) / 1000) }),
        row({ ts: String((NOW - 1_800_000) / 1000), isMine: true, userId: 'U-us' })
      ]
    })
    expect(activity.ballInCourt).toBe('client')
  })

  it('is yours when the client wrote and we never replied', () => {
    const activity = buildProjectActivity({ now: NOW, rows: [row()] })
    expect(activity.ballInCourt).toBe('you')
    expect(activity.latestOursAt).toBeNull()
  })

  it('is null when the client never wrote', () => {
    const activity = buildProjectActivity({
      now: NOW,
      rows: [row({ source: 'ours', isMine: true, userId: 'U-us' })]
    })
    expect(activity.ballInCourt).toBeNull()
    expect(activity.latestClientAt).toBeNull()
  })

  it('only counts client-workspace rows for the ball', () => {
    const activity = buildProjectActivity({
      now: NOW,
      rows: [
        row({ ts: String((NOW - 7_200_000) / 1000) }),
        row({
          source: 'ours',
          ts: String((NOW - 60_000) / 1000),
          channelId: 'T1',
          userId: 'U-team',
          isMine: true
        })
      ]
    })
    expect(activity.ballInCourt).toBe('you')
  })
})

describe('buildProjectActivity — recent messages', () => {
  it('merges both workspaces newest-first and caps at six', () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      row({
        ts: String((NOW - (index + 1) * 60_000) / 1000),
        source: index % 2 === 0 ? 'client' : 'ours',
        channelId: index % 2 === 0 ? 'C1' : 'T1',
        channelName: index % 2 === 0 ? 'client-general' : 'team-project',
        text: `message ${index}`
      })
    )
    const activity = buildProjectActivity({ now: NOW, rows })

    expect(activity.recent).toHaveLength(6)
    expect(activity.recent.map((m) => m.text)).toEqual([
      'message 0',
      'message 1',
      'message 2',
      'message 3',
      'message 4',
      'message 5'
    ])
  })

  it('drops empty text and Slack noise subtypes', () => {
    const activity = buildProjectActivity({
      now: NOW,
      rows: [
        row({ text: '  ' }),
        row({ subtype: 'channel_join', text: 'joined' }),
        row({ subtype: 'message_changed', text: 'edited' }),
        row({ text: 'real message' })
      ]
    })
    expect(activity.recent.map((m) => m.text)).toEqual(['real message'])
  })
})

describe('buildProjectActivity — 14-day rollups', () => {
  it('takes the top 3 participants and channels inside the window', () => {
    const activity = buildProjectActivity({
      now: NOW,
      rows: [
        row({ userId: 'U-a', userName: 'Ana', channelId: 'C1', ts: String((NOW - 60_000) / 1000) }),
        row({
          userId: 'U-a',
          userName: 'Ana',
          channelId: 'C1',
          ts: String((NOW - 120_000) / 1000)
        }),
        row({
          userId: 'U-b',
          userName: 'Bo',
          channelId: 'C2',
          channelName: 'client-2',
          ts: String((NOW - 180_000) / 1000)
        }),
        row({
          userId: 'U-b',
          userName: 'Bo',
          channelId: 'C2',
          channelName: 'client-2',
          ts: String((NOW - 240_000) / 1000)
        }),
        row({
          source: 'ours',
          userId: 'U-us',
          userName: 'You',
          channelId: 'T1',
          channelName: 'team-project',
          isMine: true,
          ts: String((NOW - 300_000) / 1000)
        }),
        row({
          userId: 'U-c',
          userName: 'Cy',
          channelId: 'C3',
          channelName: 'client-3',
          ts: String((NOW - 360_000) / 1000)
        }),
        row({
          userId: 'U-d',
          userName: 'Di',
          channelId: 'C4',
          channelName: 'client-4',
          ts: String((NOW - 16 * 24 * 60 * 60_000) / 1000)
        })
      ]
    })

    expect(activity.participants.map((p) => [p.name, p.count])).toEqual([
      ['Ana', 2],
      ['Bo', 2],
      ['Cy', 1]
    ])
    expect(activity.channels.map((c) => [c.channelName, c.count])).toEqual([
      ['client-2', 2],
      ['client-general', 2],
      ['client-3', 1]
    ])
    expect(activity.counts14d).toEqual({ client: 5, ours: 1 })
  })
})
