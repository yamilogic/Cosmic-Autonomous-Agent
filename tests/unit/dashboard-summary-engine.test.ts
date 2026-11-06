import { describe, expect, it } from 'vitest'
import {
  estimateCompletion,
  extractDates,
  buildSummary,
  computeMood,
  summarizeProject
} from '../../src/main/dashboard/summary-engine'
import type { DashboardStoredMessage } from '../../src/main/dashboard/delta-store'

const msg = (ts: string, text = 'update', user = 'U1'): DashboardStoredMessage => ({
  ts,
  user,
  text
})

describe('summary-engine', () => {
  it('extract explicit ISO / month-day dates', () => {
    const dates = extractDates([
      msg('100', 'kickoff today'),
      msg('101', 'project started 2026-10-01'),
      msg('102', 'deadline is on Nov 12')
    ])
    expect(dates.startDate).toBe('2026-10-01')
    expect(dates.endDate).toBe('2026-11-12')
  })

  it('extract "by <date>" deadline patterns', () => {
    const dates = extractDates([msg('100', 'finish by 2026-12-24 please')])
    expect(dates.endDate).toBe('2026-12-24')
  })

  it('mood: positive', () => {
    const d = computeMood([
      msg('100', 'awesome! 🎉 ship it'),
      msg('101', 'great work, thank you 🙏')
    ])
    expect(d.state).toBe('good')
  })

  it('mood: tense', () => {
    const d = computeMood([
      msg('100', 'this is broken again'),
      msg('101', 'still not working, urgent!'),
      msg('102', 'deadline missed, when will this be done')
    ])
    expect(d.state).toBe('tense')
  })

  it('consecutive bot-only messages settle to neutral', () => {
    const d = computeMood([msg('100', 'build succeeded'), msg('101', 'deploy failed')])
    expect(d.state).toBe('neutral')
  })

  it('summary mentions counts + latest activity', () => {
    const s = buildSummary([msg('100', 'hello world'), msg('101', 'ship it now')])
    expect(s.at(-1)).toEqual('U1: ship it now')
    expect(s).toHaveLength(2)
  })

  it('completion estimate is time-aware', () => {
    const now = Date.now()
    const stale = estimateCompletion({ lastAt: now - 1000 * 60 * 60 * 24 * 30 })
    const active = estimateCompletion({ lastAt: now - 1000 * 60 * 10 })
    expect(stale).toBeLessThan(active)
    expect(active).toBeLessThanOrEqual(100)
  })

  it('summarizeProject merges manual date/completion wins', () => {
    const s = summarizeProject({
      project: {
        id: 'p',
        name: 'Acme',
        clientName: 'Bob',
        profileId: 'pf',
        teamId: 't',
        appId: 'slack',
        tokenSource: 'oauth',
        monitors: [],
        startDate: '2026-10-01',
        endDate: '2026-12-01',
        manualCompletion: 40,
        createdAt: new Date().toISOString()
      },
      messages: [msg('100', 'begin work 2026-10-02'), msg('101', 'deadline 2026-12-15')],
      netNewCount: 3,
      now: new Date('2026-10-20T10:00:00Z')
    })
    expect(s.effectiveDates).toEqual({ startDate: '2026-10-01', endDate: '2026-12-01' })
    expect(s.completion).toBe(40)
    expect(s.newMessageCount).toBe(3)
    expect(s.summary).toContain('begin work 2026-10-02')
  })
})
