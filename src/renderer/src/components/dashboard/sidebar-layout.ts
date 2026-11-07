/** Sidebar layout registry and layout model for the expanded card's left sidebar.
 *
 * Dashboard (top) and Settings (bottom) are always fixed — they cannot be
 * hidden, moved, or reordered. Everything between them is user-configurable
 * via 3 layouts: Minimal, Full, Custom.
 *
 * Layout preference is GLOBAL (same for all cards). New sections/items added
 * to the registry appear in Full automatically, and are hidden by default in
 * Custom until the user opts in.
 */

export type LayoutMode = 'minimal' | 'full' | 'custom'

export interface SidebarItem {
  id: string
  label: string
  icon: string
  status: 'ready' | 'soon'
  locked?: boolean
}

export interface SidebarSection {
  key: string
  label: string
  icon: string
  items: SidebarItem[]
  locked?: boolean
}

export interface SidebarLayout {
  mode: LayoutMode
  custom: {
    sectionOrder: string[]
    hiddenSections: string[]
    itemOrder: Record<string, string[]>
    hiddenItems: Record<string, string[]>
    /** Global item IDs (workspaces 'ws:profileId:teamId' and links 'linkId') active for this card and accessible to AI. */
    activeGlobalItems?: string[]
    /** Specific global items allowed/visible in this card's sidebar (must also be active). If undefined, all active items show. */
    allowedGlobalLinks?: string[]
    /** When true, hide the "+ Add" button from this card's sidebar footer */
    hideAddButton?: boolean
  }
}

export const DEFAULT_LAYOUT: SidebarLayout = {
  mode: 'full',
  custom: {
    sectionOrder: [],
    hiddenSections: [],
    itemOrder: {},
    hiddenItems: {},
    activeGlobalItems: undefined,
    allowedGlobalLinks: undefined,
    hideAddButton: true
  }
}

export const SIDEBAR_LAYOUT_STORAGE_KEY = 'orbit:sidebar-layout:v1'

export const SIDEBAR_REGISTRY: SidebarSection[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: 'dashboard', status: 'ready', locked: true }],
    locked: true
  },
  {
    key: 'xomni',
    label: 'Xomni',
    icon: 'xomni',
    items: [
      { id: 'm:project', label: 'Chat with project', icon: 'chat', status: 'ready' },
      { id: 'm:agentwork', label: 'Talk to AgentWork', icon: 'agent', status: 'ready' },
      { id: 'm:schedules', label: 'Schedules', icon: 'schedule', status: 'ready' }
    ]
  },
  {
    key: 'slack',
    label: 'Accounts',
    icon: 'slack',
    items: [
      { id: 's:global', label: 'Global Accounts', icon: 'globe', status: 'ready' },
      { id: 's:team', label: 'My Accounts', icon: 'users', status: 'ready' },
      { id: 's:client', label: 'Client Accounts', icon: 'slack', status: 'ready' },
      { id: 'c:upwork', label: 'Upwork', icon: 'upwork', status: 'soon' },
      { id: 'c:teams', label: 'Microsoft Teams', icon: 'teams', status: 'soon' },
      { id: 'c:whatsapp', label: 'WhatsApp', icon: 'whatsapp', status: 'soon' },
      { id: 'c:googlechat', label: 'Google Chat', icon: 'googlechat', status: 'soon' },
      { id: 'c:discord', label: 'Discord', icon: 'discord', status: 'soon' }
    ]
  },
  {
    key: 'info',
    label: 'Project info',
    icon: 'folder',
    items: [
      { id: 'g:2', label: 'Needs attention', icon: 'alert', status: 'ready' },
      { id: 'g:3', label: 'Project', icon: 'project', status: 'ready' },
      { id: 'g:7', label: 'Signals', icon: 'activity', status: 'ready' }
    ]
  },
  {
    key: 'viz',
    label: 'Visualizations',
    icon: 'chart',
    items: [{ id: 'v:progress', label: 'Progress', icon: 'progress', status: 'ready' }]
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: 'settings',
    items: [{ id: 'settings', label: 'Settings', icon: 'settings', status: 'ready', locked: true }],
    locked: true
  }
]

export function sectionByKey(key: string): SidebarSection | undefined {
  return SIDEBAR_REGISTRY.find((s) => s.key === key)
}

export function itemById(id: string): SidebarItem | undefined {
  for (const section of SIDEBAR_REGISTRY) {
    const item = section.items.find((i) => i.id === id)
    if (item) return item
  }
  return undefined
}

export function readyItemIds(): string[] {
  return SIDEBAR_REGISTRY.flatMap((s) =>
    s.items.filter((i) => i.status === 'ready').map((i) => i.id)
  )
}

export function sectionKeys(): string[] {
  return SIDEBAR_REGISTRY.map((s) => s.key)
}
export function resolveLayout(layout: SidebarLayout): {
  sections: Array<{ section: SidebarSection; items: SidebarItem[] }>
} {
  const allSections = [...SIDEBAR_REGISTRY]
  const dashboardIdx = allSections.findIndex((s) => s.key === 'dashboard')
  const settingsIdx = allSections.findIndex((s) => s.key === 'settings')
  const middleSections = allSections.filter(
    (_, i) => i !== dashboardIdx && i !== settingsIdx
  )

  let ordered: string[]
  let hiddenSections: Set<string>
  let itemOrder: Record<string, string[]>
  let hiddenItems: Record<string, Set<string>>

  if (layout.mode === 'minimal') {
    ordered = []
    hiddenSections = new Set(middleSections.map((s) => s.key))
    itemOrder = {}
    hiddenItems = {}
  } else if (layout.mode === 'full') {
    ordered = middleSections.map((s) => s.key)
    hiddenSections = new Set()
    itemOrder = {}
    hiddenItems = {}
  } else {
    ordered = layout.custom.sectionOrder.filter((k) =>
      middleSections.some((s) => s.key === k)
    )
    for (const s of middleSections) {
      if (!ordered.includes(s.key)) ordered.push(s.key)
    }
    hiddenSections = new Set(layout.custom.hiddenSections)
    itemOrder = layout.custom.itemOrder
    hiddenItems = {}
    for (const [k, v] of Object.entries(layout.custom.hiddenItems)) {
      hiddenItems[k] = new Set(v)
    }
  }

  const sections: Array<{ section: SidebarSection; items: SidebarItem[] }> = []

  const dashboard = allSections[dashboardIdx]
  sections.push({
    section: dashboard,
    items: dashboard.items
  })

  for (const key of ordered) {
    const section = sectionByKey(key)
    if (!section || hiddenSections.has(key)) continue

    let items = [...section.items]
    if (layout.mode === 'custom') {
      const order = itemOrder[key]
      if (order) {
        items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
      }
      const hidden = hiddenItems[key] ?? new Set()
      items = items.filter((i) => !i.locked && !hidden.has(i.id))
    }

    if (items.length === 0) continue
    sections.push({ section, items })
  }

  const settings = allSections[settingsIdx]
  sections.push({
    section: settings,
    items: settings.items
  })

  return { sections }
}

export function normalizeLayout(raw: Partial<SidebarLayout>): SidebarLayout {
  const mode: LayoutMode =
    raw.mode === 'minimal' || raw.mode === 'full' || raw.mode === 'custom'
      ? raw.mode
      : 'full'

  const allSectionKeys = sectionKeys()
  const allItemIds = readyItemIds()

  if (mode === 'minimal') {
    return {
      mode: 'minimal',
      custom: {
        sectionOrder: [],
        hiddenSections: [],
        itemOrder: {},
        hiddenItems: {},
        hideAddButton: typeof raw.custom?.hideAddButton === 'boolean' ? raw.custom.hideAddButton : true
      }
    }
  }

  if (mode === 'full') {
    return {
      mode: 'full',
      custom: {
        sectionOrder: allSectionKeys.filter((k) => k !== 'dashboard' && k !== 'settings'),
        hiddenSections: [],
        itemOrder: {},
        hiddenItems: {},
        activeGlobalItems: raw.custom?.activeGlobalItems,
        allowedGlobalLinks: raw.custom?.allowedGlobalLinks,
        hideAddButton: typeof raw.custom?.hideAddButton === 'boolean' ? raw.custom.hideAddButton : true
      }
    }
  }

  const rawCustom = (raw.custom ?? {}) as {
    sectionOrder?: unknown
    hiddenSections?: unknown
    itemOrder?: unknown
    hiddenItems?: unknown
    activeGlobalItems?: unknown
    allowedGlobalLinks?: unknown
    hideAddButton?: unknown
  }
  let sectionOrder = ((rawCustom.sectionOrder ?? []) as unknown[]).filter((k) =>
    typeof k === 'string' && allSectionKeys.includes(k) && k !== 'dashboard' && k !== 'settings'
  )
  sectionOrder = [...new Set(sectionOrder)]
  for (const k of allSectionKeys) {
    if (k !== 'dashboard' && k !== 'settings' && !sectionOrder.includes(k)) {
      sectionOrder.push(k)
    }
  }

  const hiddenSections = new Set(
    ((rawCustom.hiddenSections ?? []) as unknown[]).filter((k) =>
      typeof k === 'string' && allSectionKeys.includes(k)
    )
  )

  const itemOrder: Record<string, string[]> = {}
  const hiddenItems: Record<string, string[]> = {}

  for (const section of SIDEBAR_REGISTRY) {
    if (section.key === 'dashboard' || section.key === 'settings') continue

    const rawOrder = (rawCustom.itemOrder as Record<string, unknown>)?.[section.key]
    const ids: string[] = []
    if (Array.isArray(rawOrder)) {
      for (const id of rawOrder) {
        if (typeof id === 'string' && allItemIds.includes(id) && !ids.includes(id)) ids.push(id)
      }
    }
    for (const id of section.items.filter((i) => i.status === 'ready').map((i) => i.id)) {
      if (!ids.includes(id)) ids.push(id)
    }
    itemOrder[section.key] = ids

    const rawHidden = (rawCustom.hiddenItems as Record<string, unknown>)?.[section.key]
    const hidden: string[] = []
    if (Array.isArray(rawHidden)) {
      for (const id of rawHidden) {
        if (typeof id === 'string' && allItemIds.includes(id) && !hidden.includes(id)) hidden.push(id)
      }
    }
    for (const item of section.items) {
      if (item.locked && hidden.includes(item.id)) {
        hidden.splice(hidden.indexOf(item.id), 1)
      }
    }
    hiddenItems[section.key] = hidden
  }

  return {
    mode: 'custom',
    custom: {
      sectionOrder: sectionOrder as string[],
      hiddenSections: [...hiddenSections] as string[],
      itemOrder,
      hiddenItems,
      activeGlobalItems: rawCustom.activeGlobalItems as string[] | undefined,
      allowedGlobalLinks: rawCustom.allowedGlobalLinks as string[] | undefined,
      hideAddButton: typeof rawCustom.hideAddButton === 'boolean' ? rawCustom.hideAddButton : true
    }
  }
}

export function seedCustomFromFull(): SidebarLayout {
  return {
    mode: 'custom',
    custom: {
      sectionOrder: sectionKeys().filter((k) => k !== 'dashboard' && k !== 'settings'),
      hiddenSections: [],
      itemOrder: {},
      hiddenItems: {},
      hideAddButton: true
    }
  }
}

