// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RecentStrip from '../../src/renderer/src/components/dashboard/RecentStrip'
import type { RecentActivity, InsightStatus } from '../../src/shared/dashboard-contract'

afterEach(cleanup)

const baseItem: RecentActivity = {
  projectId: 'p1',
  projectName: 'Aurora storefront',
  teamName: 'Northwind Retail',
  channelName: 'aurora-build',
  who: 'Priya Nair',
  text: 'Can SSO make Friday’s build?',
  ts: '2026-10-26T10:00:00Z',
  kind: 'client-question',
  needsReply: true,
  status: 'at-risk',
  score: 45,
  oneLine: 'Can SSO make Friday’s build?',
  delta: 'on-track → at-risk',
  hoursSinceLastMessage: 3
}

function renderStrip(
  items: RecentActivity[] = [baseItem],
  pinnedIds: ReadonlySet<string> = new Set(),
  onOpen: (projectId: string) => void = vi.fn()
): void {
  render(<RecentStrip items={items} pinnedIds={pinnedIds} onOpen={onOpen} />)
}

describe('RecentStrip — basic rendering', () => {
  it('renders project name and workspace', () => {
    renderStrip()
    expect(screen.getByText('Aurora storefront')).toBeTruthy()
    expect(screen.getByText('Northwind Retail')).toBeTruthy()
  })

  it('renders recent line', () => {
    renderStrip()
    expect(screen.getByText("Can SSO make Friday’s build?")).toBeTruthy()
  })

  it('renders status label', () => {
    renderStrip()
    expect(screen.getByText('At risk')).toBeTruthy()
  })

  it('returns null when no items', () => {
    render([])
    expect(screen.queryByText('Recent')).toBeNull()
  })
})

describe('RecentStrip — status labels', () => {
  const statuses: Array<[InsightStatus, string]> = [
    ['on-track', 'On track'],
    ['at-risk', 'At risk'],
    ['blocked', 'Blocked'],
    ['waiting-on-client', 'Waiting on client']
  ]

  it.each(statuses)('shows %s for status %s', (status, label) => {
    renderStrip([{ ...baseItem, status }])
    expect(screen.getByText(label)).toBeTruthy()
  })
})

describe('RecentStrip — pinned and new indicators', () => {
  it('shows pin indicator for pinned item', () => {
    renderStrip([baseItem], new Set(['p1']))
    expect(screen.getByTitle('Pinned')).toBeTruthy()
  })

  it('shows new indicator when newMessages > 0', () => {
    renderStrip([{ ...baseItem, newMessages: 2 }])
    expect(screen.getByTitle('2 new since your last visit')).toBeTruthy()
  })
})

describe('RecentStrip — reason and age', () => {
  it('shows reason label', () => {
    renderStrip([{ ...baseItem, delta: 'on-track → at-risk' }])
    expect(screen.getByText('At risk')).toBeTruthy()
  })

  it('shows age label', () => {
    renderStrip([{ ...baseItem, hoursSinceLastMessage: 3 }])
    expect(screen.getByText('3h')).toBeTruthy()
  })

  it('shows channel name', () => {
    renderStrip([{ ...baseItem, channelName: 'aurora-build' }])
    expect(screen.getByText('#aurora-build')).toBeTruthy()
  })
})

describe('RecentStrip — interaction', () => {
  it('calls onOpen when item clicked', () => {
    const onOpen = vi.fn()
    renderStrip([baseItem], new Set(), onOpen)
    fireEvent.click(screen.getByRole('button', { name: 'Open Aurora storefront' }))
    expect(onOpen).toHaveBeenCalledWith('p1')
  })

  it('deduplicates by projectId', () => {
    renderStrip([baseItem, { ...baseItem, projectId: 'p1', projectName: 'Duplicate' }])
    expect(screen.getAllByText('Aurora storefront')).toHaveLength(1)
  })

  it('limits to 6 items', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      ...baseItem,
      projectId: `p${i}`,
      projectName: `Project ${i}`,
      teamName: `Workspace ${i}`
    }))
    renderStrip(items)
    expect(screen.getAllByRole('button', { name: /Open Project/ })).toHaveLength(6)
  })
})