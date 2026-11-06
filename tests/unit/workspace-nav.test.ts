import { describe, it, expect } from 'vitest'
import {
  DEFAULT_NAV,
  INFO_GROUPS,
  NAV_CONNECTORS,
  NAV_REV,
  NAV_SECTIONS,
  NAV_WIDTH_DEFAULT,
  NAV_WIDTH_MAX,
  NAV_WIDTH_MIN,
  buildConnectorChannelLists,
  clampNavWidth,
  infoGroupOf,
  migrateNavState,
  migrateOpenGroup,
  navFromEntryProps,
  navRowOf,
  openGroupNav,
  railSectionSelection,
  resizeNav,
  restoreDashboardOpen,
  selectNav,
  sectionOfSelection,
  slackSourceOf,
  toggleInfoGroupNav,
  toggleSectionNav,
  xomniModeOf,
  type WorkspaceNavState
} from '../../src/renderer/src/components/dashboard/workspace-nav'

describe('nav model shape (v6)', () => {
  it('has four dropdown sections in the reference order', () => {
    expect(NAV_SECTIONS.map((s) => s.key)).toEqual(['xomni', 'slack', 'info', 'viz'])
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual([
      'Xomni',
      'Accounts',
      'Project info',
      'Visualizations'
    ])
  })

  it('lists Our Slack first, then Client Slack, then future connectors', () => {
    expect(NAV_CONNECTORS.map((c) => c.key)).toEqual([
      'team',
      'client',
      'upwork',
      'teams',
      'whatsapp',
      'googlechat',
      'discord'
    ])
    expect(NAV_CONNECTORS.map((c) => c.label)).toEqual([
      'My Accounts',
      'Client Accounts',
      'Upwork',
      'Microsoft Teams',
      'WhatsApp',
      'Google Chat',
      'Discord'
    ])
  })

  it('carries the reference row lists per section', () => {
    expect(rowsOf('xomni')).toEqual(['Chat with project', 'Talk to AgentWork', 'Schedules'])
    expect(rowsOf('slack')).toEqual(['All channels', 'All channels'])
    expect(NAV_SECTIONS.find((s) => s.key === 'slack')!.rows.map((r) => r.id)).toEqual([
      's:client',
      's:team'
    ])
    expect(rowsOf('viz')).toEqual(['Progress', 'Time elapsed', 'Last 7 days'])
    expect(INFO_GROUPS.map((g) => g.key)).toEqual(['attention', 'project', 'signals'])
    expect(labelsOfGroup('attention')).toEqual(['Needs reply', 'Blockers', 'Risks', 'Next steps'])
    expect(labelsOfGroup('project')).toEqual([
      'Requirements',
      'Scope and deliverables',
      'Decisions',
      'Commitments',
      'Files and links',
      'People and channels'
    ])
    expect(labelsOfGroup('signals')).toEqual(['Client mood', 'Activity', 'History'])
  })

  it('gives every row a one-line description and an icon', () => {
    for (const section of NAV_SECTIONS) {
      for (const row of section.rows) {
        expect(row.desc.length).toBeGreaterThan(10)
        expect(row.icon.length).toBeGreaterThan(0)
      }
    }
  })

  it('defaults to Dashboard, all sections open, every sub-group closed', () => {
    expect(DEFAULT_NAV.rev).toBe(NAV_REV)
    expect(DEFAULT_NAV.openGroup).toBe('dash')
    expect(DEFAULT_NAV.selection).toBeNull()
    expect(DEFAULT_NAV.openSections).toEqual(['xomni', 'slack', 'info', 'viz'])
    expect(DEFAULT_NAV.openInfoGroups).toEqual([])
    expect(DEFAULT_NAV.sectionSelections).toEqual({})
    expect(DEFAULT_NAV.width).toBe(NAV_WIDTH_DEFAULT)
  })

  it('maps selections to their owning section and sub-group', () => {
    expect(sectionOfSelection('m:project')).toBe('xomni')
    expect(sectionOfSelection('s:team')).toBe('slack')
    expect(sectionOfSelection('d:blockers')).toBe('info')
    expect(sectionOfSelection('g:3')).toBe('info')
    expect(sectionOfSelection('v:week')).toBe('viz')

    expect(infoGroupOf('d:blockers')).toBe('attention')
    expect(infoGroupOf('g:3')).toBe('project')
    expect(infoGroupOf('d:mood')).toBe('signals')
    expect(infoGroupOf('v:week')).toBeNull()
    expect(infoGroupOf('s:client')).toBeNull()
  })

  it('looks a row up by id', () => {
    expect(navRowOf('v:progress')?.label).toBe('Progress')
    expect(navRowOf('s:client')?.desc.length).toBeGreaterThan(10)
    expect(navRowOf(null)).toBeNull()
  })

  it('clamps width to the rail bounds', () => {
    expect(clampNavWidth(50)).toBe(NAV_WIDTH_MIN)
    expect(clampNavWidth(9999)).toBe(NAV_WIDTH_MAX)
    expect(clampNavWidth(Number.NaN)).toBe(NAV_WIDTH_DEFAULT)
  })
})

describe('buildConnectorChannelLists', () => {
  it('keeps Our Slack and Client Slack channels in their own lists', () => {
    const lists = buildConnectorChannelLists({
      clientLoading: false,
      clientError: null,
      clientChannels: [{ id: 'C1', name: 'client-general' }],
      watchedChannels: [{ id: 'C1', name: 'client-general' }],
      teamChannels: [{ id: 'T1', name: 'team-general' }],
      teamWatched: [{ id: 'T1', name: 'team-general' }],
      teamConnected: true
    })

    expect(lists.client?.entries).toEqual([{ id: 'C1', name: 'client-general', watched: true }])
    expect(lists.team?.entries).toEqual([{ id: 'T1', name: 'team-general', watched: true }])
  })

  it('keeps a mapped Our Slack channel the token cannot list', () => {
    const lists = buildConnectorChannelLists({
      clientLoading: false,
      clientError: null,
      clientChannels: [],
      watchedChannels: [],
      teamChannels: [],
      teamWatched: [{ id: 'T9', name: 'archived-project' }]
    })

    expect(lists.team?.entries).toEqual([{ id: 'T9', name: 'archived-project', watched: true }])
  })

  it('sorts each connector list by channel name', () => {
    const lists = buildConnectorChannelLists({
      clientLoading: false,
      clientError: null,
      clientChannels: [
        { id: 'C2', name: 'zulu' },
        { id: 'C1', name: 'alpha' }
      ],
      watchedChannels: []
    })

    expect(lists.client?.entries.map((c) => c.name)).toEqual(['alpha', 'zulu'])
  })
})

describe('migrateOpenGroup', () => {
  it('maps legacy keys onto current groups', () => {
    expect(migrateOpenGroup('summary')).toBe('info')
    expect(migrateOpenGroup('visual')).toBe('viz')
    expect(migrateOpenGroup('agent')).toBe('xomni')
    expect(migrateOpenGroup('viz')).toBe('viz')
    expect(migrateOpenGroup('nonsense')).toBe('dash')
  })
})

describe('migrateNavState', () => {
  it("keeps a v5 blob's own open/closed lists", () => {
    const next = migrateNavState({
      rev: NAV_REV,
      openGroup: 'info',
      selection: 'd:needs-reply',
      collapsed: false,
      width: 250,
      openSections: ['viz'],
      openInfoGroups: ['attention'],
      sectionSelections: { info: 'd:needs-reply' }
    })
    expect(next?.rev).toBe(NAV_REV)
    expect(next?.openSections).toEqual(['viz'])
    expect(next?.openInfoGroups).toEqual(['attention'])
    expect(next?.sectionSelections.info).toBe('d:needs-reply')
  })

  it('opens everything for a pre-v5 blob and keeps its info groups', () => {
    const next = migrateNavState({
      openGroup: 'info',
      selection: 'd:needs-reply',
      width: 250,
      openSections: ['info'],
      openInfoGroups: ['attention', 'visual'],
      sectionSelections: { info: 'd:needs-reply' }
    })
    expect(next?.openSections).toEqual(['xomni', 'slack', 'info', 'viz'])
    // the retired `visual` group key is dropped
    expect(next?.openInfoGroups).toEqual(['attention'])
    expect(next?.width).toBe(250)
  })

  it('opens the sub-group that holds a migrated legacy selection', () => {
    const next = migrateNavState({ openGroup: 'info', selection: 'g:4', openInfoGroups: [] })
    expect(next?.openInfoGroups).toEqual(['project'])
  })

  it('moves a legacy visualization selection to the viz section', () => {
    const next = migrateNavState({ openGroup: 'info', selection: 'v:time' })
    expect(next?.selection).toBe('v:time')
    expect(next?.openGroup).toBe('viz')
    expect(next?.sectionSelections.viz).toBe('v:time')
    expect(next?.sectionSelections.info).toBeUndefined()
  })

  it('lets a remembered row own the centre, whatever group the blob saved', () => {
    // A saved state can disagree: openGroup 'dash' with a row still selected
    // would render the Dashboard body with no active row.
    const next = migrateNavState({ openGroup: 'dash', selection: 'd:needs-reply' })
    expect(next?.openGroup).toBe('info')
    expect(next?.sectionSelections.info).toBe('d:needs-reply')
  })

  it('accepts the new slack selections', () => {
    const next = migrateNavState({
      rev: NAV_REV,
      openGroup: 'slack',
      selection: 's:team',
      openSections: ['slack'],
      openInfoGroups: []
    })
    expect(next?.selection).toBe('s:team')
    expect(slackSourceOf(next!)).toBe('team')
  })

  it('carries v3 openInfoGroups when subOpen was true', () => {
    const next = migrateNavState({
      openGroup: 'info',
      selection: 'd:risks',
      subOpen: true,
      openInfoGroups: ['attention']
    })
    expect(next?.openInfoGroups).toEqual(['attention'])
  })

  it('validates arrays and drops junk', () => {
    const next = migrateNavState({
      rev: NAV_REV,
      openGroup: 'dash',
      selection: 'm:agentwork',
      collapsed: true,
      width: 5000,
      openSections: ['xomni', 'bogus'],
      openInfoGroups: ['attention', 'bogus'],
      sectionSelections: { xomni: 'm:agentwork', info: 's:gone', bogus: 'd:risks' }
    })
    expect(next?.openSections).toEqual(['xomni'])
    expect(next?.openInfoGroups).toEqual(['attention'])
    expect(next?.width).toBe(NAV_WIDTH_MAX)
    expect(next?.collapsed).toBe(true)
    expect(next?.sectionSelections).toEqual({ xomni: 'm:agentwork' })
  })

  it('drops unknown or stale selections to null', () => {
    expect(migrateNavState({ openGroup: 'info', selection: 's:old' })?.selection).toBeNull()
    expect(migrateNavState({ openGroup: 'info', selection: 'd:gone' })?.selection).toBeNull()
    expect(migrateNavState({ openGroup: 'info', selection: 'visual' })?.selection).toBeNull()
  })

  it('rejects non-object payloads', () => {
    expect(migrateNavState(null)).toBeNull()
    expect(migrateNavState('nope')).toBeNull()
  })
})

describe('navFromEntryProps', () => {
  /** A persisted state with the user's own geometry and closed sections. */
  const persisted: WorkspaceNavState = {
    rev: NAV_REV,
    openGroup: 'dash',
    selection: null,
    collapsed: true,
    width: 310,
    openSections: ['xomni'],
    openInfoGroups: [],
    openConnectors: [],
    sectionSelections: {}
  }

  it('returns null when nothing is forced', () => {
    expect(navFromEntryProps({}, persisted)).toBeNull()
  })

  it('deep-links the Slack chat to the client workspace', () => {
    const nav = navFromEntryProps({ initialTab: 'slack-chat' }, persisted)
    expect(nav?.openGroup).toBe('slack')
    expect(nav?.selection).toBe('s:client')
    expect(nav?.sectionSelections.slack).toBe('s:client')
  })

  it('deep-links ai-chat to Xomni with the project mode selected', () => {
    const nav = navFromEntryProps({ initialTab: 'ai-chat' }, persisted)
    expect(nav?.openGroup).toBe('xomni')
    expect(nav?.selection).toBe('m:project')
    expect(nav?.sectionSelections.xomni).toBe('m:project')
  })

  it('keeps the width, the rail and the sections the user closed', () => {
    const nav = navFromEntryProps({ initialDetailKey: 'risks' }, persisted)
    expect(nav?.width).toBe(310)
    expect(nav?.collapsed).toBe(true)
    // only the section the link lands in is opened; the others stay as saved
    expect(nav?.openSections).toEqual(['xomni', 'info'])
    expect(nav?.openInfoGroups).toEqual(['attention'])
  })

  it('opens the owning sub-group for detail and guide deep-links', () => {
    const risks = navFromEntryProps({ initialDetailKey: 'risks' }, DEFAULT_NAV)
    expect(risks?.openGroup).toBe('info')
    expect(risks?.selection).toBe('d:risks')
    expect(risks?.openInfoGroups).toEqual(['attention'])
    expect(risks?.sectionSelections.info).toBe('d:risks')

    const scope = navFromEntryProps({ initialGuideSection: 3 }, DEFAULT_NAV)
    expect(scope?.selection).toBe('g:3')
    expect(scope?.openInfoGroups).toEqual(['project'])
  })

  it('ignores a guide section outside the known range', () => {
    expect(navFromEntryProps({ initialGuideSection: 1 }, persisted)).toBeNull()
    expect(navFromEntryProps({ initialGuideSection: 9 }, persisted)).toBeNull()
  })

  it('keeps Settings and Dashboard as plain entries', () => {
    expect(navFromEntryProps({ initialTab: 'settings' }, persisted)?.openGroup).toBe('settings')
    const dash = navFromEntryProps({ initialTab: 'summary' }, persisted)
    expect(dash?.openGroup).toBe('dash')
    expect(dash?.selection).toBeNull()
    expect(dash?.width).toBe(310)
  })
})

describe('openGroupNav', () => {
  it('activates a plain entry with the default body', () => {
    const next = openGroupNav(DEFAULT_NAV, 'settings')
    expect(next.openGroup).toBe('settings')
    expect(next.selection).toBeNull()
  })

  it('clears the selection when returning to Dashboard', () => {
    const withSel: WorkspaceNavState = { ...DEFAULT_NAV, openGroup: 'info', selection: 'g:5' }
    expect(openGroupNav(withSel, 'dash').selection).toBeNull()
  })
})

describe('toggleSectionNav', () => {
  it('closes and reopens a section independently', () => {
    const shut = toggleSectionNav(DEFAULT_NAV, 'slack')
    expect(shut.openSections).toEqual(['xomni', 'info', 'viz'])
    expect(toggleSectionNav(shut, 'slack').openSections).toContain('slack')
  })

  it('never changes what the centre panel shows', () => {
    const base: WorkspaceNavState = { ...DEFAULT_NAV, openGroup: 'xomni', selection: 'm:agentwork' }
    const next = toggleSectionNav(base, 'info')
    expect(next.openGroup).toBe('xomni')
    expect(next.selection).toBe('m:agentwork')
  })
})

describe('toggleInfoGroupNav', () => {
  it('opens, closes and stacks sub-groups independently', () => {
    const one = toggleInfoGroupNav(DEFAULT_NAV, 'attention')
    expect(one.openInfoGroups).toEqual(['attention'])
    const two = toggleInfoGroupNav(one, 'signals')
    expect(two.openInfoGroups).toEqual(['attention', 'signals'])
    expect(toggleInfoGroupNav(two, 'attention').openInfoGroups).toEqual(['signals'])
  })

  it('does not touch the open body while toggling', () => {
    const base: WorkspaceNavState = { ...DEFAULT_NAV, openGroup: 'xomni', selection: 'm:agentwork' }
    const next = toggleInfoGroupNav(base, 'signals')
    expect(next.openGroup).toBe('xomni')
    expect(next.selection).toBe('m:agentwork')
  })
})

describe('selectNav', () => {
  it('activates a Xomni mode and remembers it', () => {
    const next = selectNav(DEFAULT_NAV, 'm:agentwork')
    expect(next.openGroup).toBe('xomni')
    expect(next.selection).toBe('m:agentwork')
    expect(next.sectionSelections.xomni).toBe('m:agentwork')
    expect(next.openInfoGroups).toEqual([])
  })

  it('activates an info row and opens its section and sub-group', () => {
    const shut = toggleSectionNav(DEFAULT_NAV, 'info')
    const next = selectNav(shut, 'd:risks')
    expect(next.openGroup).toBe('info')
    expect(next.selection).toBe('d:risks')
    expect(next.openSections).toContain('info')
    expect(next.openInfoGroups).toEqual(['attention'])
    expect(next.sectionSelections.info).toBe('d:risks')
  })

  it('activates a Slack row without touching info groups', () => {
    const next = selectNav(DEFAULT_NAV, 's:team')
    expect(next.openGroup).toBe('slack')
    expect(next.openInfoGroups).toEqual([])
    expect(next.sectionSelections.slack).toBe('s:team')
  })

  it('keeps an already-open sub-group open', () => {
    const base: WorkspaceNavState = { ...DEFAULT_NAV, openInfoGroups: ['attention'] }
    expect(selectNav(base, 'd:blockers').openInfoGroups).toEqual(['attention'])
  })
})

describe('xomniModeOf and slackSourceOf', () => {
  it('default to project chat and the client workspace', () => {
    expect(xomniModeOf(DEFAULT_NAV)).toBe('project')
    expect(slackSourceOf(DEFAULT_NAV)).toBe('client')
    expect(slackSourceOf({ ...DEFAULT_NAV, openGroup: 'slack', selection: null })).toBe('client')
  })

  it('read the active row', () => {
    expect(xomniModeOf({ ...DEFAULT_NAV, openGroup: 'xomni', selection: 'm:agentwork' })).toBe(
      'agentwork'
    )
    expect(slackSourceOf({ ...DEFAULT_NAV, openGroup: 'slack', selection: 's:team' })).toBe('team')
  })
})

describe('collapsed rail selections', () => {
  it('defaults each section icon to its first row', () => {
    expect(railSectionSelection(DEFAULT_NAV, 'xomni')).toBe('m:project')
    expect(railSectionSelection(DEFAULT_NAV, 'slack')).toBe('s:client')
    expect(railSectionSelection(DEFAULT_NAV, 'viz')).toBe('v:progress')
  })

  it('restores the remembered row for a section', () => {
    const nav: WorkspaceNavState = {
      ...DEFAULT_NAV,
      sectionSelections: { xomni: 'm:agentwork', slack: 's:team', info: 'g:4' }
    }
    expect(railSectionSelection(nav, 'xomni')).toBe('m:agentwork')
    expect(railSectionSelection(nav, 'slack')).toBe('s:team')
    expect(railSectionSelection(nav, 'info')).toBe('g:4')
  })

  it('ignores a remembered row that belongs to another section', () => {
    const nav: WorkspaceNavState = {
      ...DEFAULT_NAV,
      sectionSelections: { xomni: 'd:mood', info: 'm:project' }
    }
    expect(railSectionSelection(nav, 'xomni')).toBe('m:project')
    expect(railSectionSelection(nav, 'info')).toBeNull()
  })

  it('has no Project info target before anything was picked', () => {
    expect(railSectionSelection(DEFAULT_NAV, 'info')).toBeNull()
  })
})

describe('resizeNav', () => {
  it('clamps and keeps state identity when unchanged', () => {
    const next = resizeNav(DEFAULT_NAV, 240)
    expect(next.width).toBe(240)
    expect(resizeNav(next, 240)).toBe(next)
    expect(resizeNav(DEFAULT_NAV, 9000).width).toBe(NAV_WIDTH_MAX)
  })
})

function rowsOf(key: string): string[] {
  return NAV_SECTIONS.find((s) => s.key === key)!.rows.map((r) => r.label)
}

function labelsOfGroup(group: string): string[] {
  return NAV_SECTIONS.flatMap((s) => s.rows)
    .filter((r) => r.group === group)
    .map((r) => r.label)
}

describe('restoreDashboardOpen', () => {
  it('drops a persisted row selection but keeps section open state', () => {
    const persisted: WorkspaceNavState = {
      ...DEFAULT_NAV,
      openGroup: 'info',
      selection: 'g:4',
      openSections: ['slack'],
      openInfoGroups: ['project']
    }
    const restored = restoreDashboardOpen(persisted)
    expect(restored.openGroup).toBe('dash')
    expect(restored.selection).toBeNull()
    expect(restored.openSections).toEqual(['slack'])
    expect(restored.openInfoGroups).toEqual(['project'])
  })
})
