import { describe, expect, it } from 'vitest'
import {
  SourceStreamFilter,
  parseSourceIds,
  resolveSourceRefs
} from '../../src/main/dashboard/chat-sources'
import type { DashboardProjectChatSourceRef } from '../../src/shared/dashboard-contract'

const refs = new Map<string, DashboardProjectChatSourceRef>([
  [
    'm1',
    {
      source: 'client',
      channelId: 'C1',
      channelName: 'client-dev',
      ts: '100.0'
    }
  ],
  [
    'm2',
    {
      source: 'ours',
      channelId: 'C2',
      channelName: 'team-dev',
      ts: '200.0'
    }
  ],
  [
    'm3',
    {
      source: 'client',
      channelId: 'C1',
      channelName: 'client-dev',
      ts: '300.0'
    }
  ]
])

describe('SourceStreamFilter', () => {
  it('holds back a marker split across chunks and never leaks it', () => {
    const filter = new SourceStreamFilter()
    const chunks = ['The client ', 'is waiting.\nSOU', 'RCES: ["m1",', ' "m2"]']
    const visible = chunks.map((chunk) => filter.push(chunk))
    const finished = filter.finish()

    expect(visible.join('')).not.toContain('SOURCES')
    expect(visible.join('') + finished.tail).toBe('The client is waiting.')
    expect(finished.content).toBe('The client is waiting.')
    expect(finished.ids).toEqual(['m1', 'm2'])
  })

  it('accepts a bold marker and empty id list', () => {
    const filter = new SourceStreamFilter()
    filter.push('No match here.\n**SOURCES:** []')
    const finished = filter.finish()
    expect(finished.content).toBe('No match here.')
    expect(finished.ids).toEqual([])
  })

  it('keeps the answer and drops malformed source json', () => {
    const filter = new SourceStreamFilter()
    filter.push('Answer text.\nSOURCES: ["m1",')
    const finished = filter.finish()
    expect(finished.content).toBe('Answer text.')
    expect(finished.ids).toEqual([])
  })

  it('flushes held-back text when there is no marker', () => {
    const filter = new SourceStreamFilter()
    const first = filter.push('short')
    const finished = filter.finish()
    expect(first).toBe('')
    expect(finished.tail).toBe('short')
    expect(finished.content).toBe('short')
    expect(finished.ids).toEqual([])
  })
})

describe('parseSourceIds', () => {
  it('keeps host-shaped ids, dedupes, and ignores junk', () => {
    expect(parseSourceIds('SOURCES: ["m1","m2","m1","x2","m3"]')).toEqual(['m1', 'm2', 'm3'])
    expect(parseSourceIds('SOURCES: {"m1":1}')).toEqual([])
    expect(parseSourceIds('SOURCES: [oops')).toEqual([])
  })
})

describe('resolveSourceRefs', () => {
  it('maps only ids that exist in the host context', () => {
    const out = resolveSourceRefs(['m1', 'm9', 'm2'], refs)
    expect(out.map((ref) => `${ref.source}:${ref.channelId}:${ref.ts}`)).toEqual([
      'client:C1:100.0',
      'ours:C2:200.0'
    ])
  })

  it('dedupes repeated refs and caps the list', () => {
    const many = new Map<string, DashboardProjectChatSourceRef>()
    for (let index = 1; index <= 12; index += 1) {
      many.set(`m${index}`, {
        source: 'client',
        channelId: `C${index}`,
        channelName: `chan-${index}`,
        ts: `${index}.0`
      })
    }
    many.set('dup', many.get('m1')!)
    const out = resolveSourceRefs(['m1', 'dup', ...many.keys()], many)
    expect(out).toHaveLength(8)
    expect(new Set(out.map((ref) => ref.ts)).size).toBe(8)
  })

  it('returns nothing when every id was fabricated', () => {
    expect(resolveSourceRefs(['m8', 'm9'], refs)).toEqual([])
  })
})
