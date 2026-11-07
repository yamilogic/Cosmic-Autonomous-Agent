// @vitest-environment jsdom
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import WorkspaceSidebar from '../../src/renderer/src/components/dashboard/WorkspaceSidebar'
import { saveSidebarLayout } from '../../src/renderer/src/components/dashboard/use-sidebar-layout'
import type { CardView } from '../../src/renderer/src/components/dashboard/card-view'
import type { WorkspaceNavState } from '../../src/renderer/src/components/dashboard/workspace-nav'

const mockView: CardView = {
  identity: {
    index: 0,
    name: 'AgentWork',
    teamName: 'Test',
    clientName: 'Client',
    progress: 50,
    progressEvidence: '',
    mood: 'good',
    moodReason: '',
    moodQuote: '',
    dates: { badge: 'not stated in chat' },
    channels: []
  },
  detail: {} as any,
  syncedLabel: 'just now',
  leftSidebar: {
    startTimeline: { startDate: undefined, endDate: undefined, dateBadge: 'not stated in chat', milestones: [] },
    requirements: [],
    scopeDeliverables: { inScope: [], outOfScope: [], deliverables: [] },
    decisions: [],
    commitments: [],
    files: [],
    peopleChannels: { people: [], channels: [], quietChannelCount: 0 }
  },
  rightSidebar: {} as any,
  centre: {} as any,
  aiBadge: 'Inherited'
}

const mockNav: WorkspaceNavState = {
  rev: 1,
  openGroup: 'dash',
  selection: 'm:project',
  openSections: ['xomni', 'slack', 'info', 'viz'],
  openInfoGroups: [],
  openConnectors: [],
  sectionSelections: {},
  collapsed: false,
  width: 240
}

describe('WorkspaceSidebar layout mode reactivity', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('renders all sections when in full mode', () => {
    render(
      <WorkspaceSidebar
        projectId="proj_test_1"
        view={mockView}
        nav={mockNav}
        channels={{}}
        onOpenGroup={() => {}}
        onSelect={() => {}}
        onToggleSection={() => {}}
        onToggleInfoGroup={() => {}}
        onToggleConnector={() => {}}
        onToggleCollapse={() => {}}
        onResize={() => {}}
      />
    )

    expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Xomni').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Accounts').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Project info').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Visualizations').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0)
  })

  it('hides middle sections reactively when switching to minimal mode', () => {
    render(
      <WorkspaceSidebar
        projectId="proj_test_1"
        view={mockView}
        nav={mockNav}
        channels={{}}
        onOpenGroup={() => {}}
        onSelect={() => {}}
        onToggleSection={() => {}}
        onToggleInfoGroup={() => {}}
        onToggleConnector={() => {}}
        onToggleCollapse={() => {}}
        onResize={() => {}}
      />
    )

    expect(screen.getAllByText('Xomni').length).toBeGreaterThan(0)

    // Trigger minimal mode via storage & event
    act(() => {
      saveSidebarLayout('proj_test_1', {
        mode: 'minimal',
        custom: {
          sectionOrder: [],
          hiddenSections: [],
          itemOrder: {},
          hiddenItems: {}
        }
      })
    })

    // Now Dashboard and Settings exist, but Xomni, Slack, Project info, Visualizations are gone
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0)
    expect(screen.queryByText('Xomni')).toBeNull()
    expect(screen.queryByText('Slack')).toBeNull()
    expect(screen.queryByText('Project info')).toBeNull()
    expect(screen.queryByText('Visualizations')).toBeNull()
  })
})
