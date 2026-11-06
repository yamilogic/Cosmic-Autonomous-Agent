import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_NAV,
  migrateNavState,
  navFromEntryProps,
  openGroupNav,
  resizeNav,
  restoreDashboardOpen,
  selectNav,
  toggleConnectorNav,
  toggleInfoGroupNav,
  toggleSectionNav,
  type ConnectorKey,
  type InfoGroupKey,
  type NavEntry,
  type OpenGroup,
  type SectionKey,
  type SelectionId,
  type WorkspaceNavState
} from '../components/dashboard/workspace-nav'

const STORAGE_PREFIX = 'orbit.workspace.nav.'

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`
}

function readState(projectId: string): WorkspaceNavState {
  try {
    const raw = localStorage.getItem(storageKey(projectId))
    if (!raw) return DEFAULT_NAV
    const migrated = migrateNavState(JSON.parse(raw))
    if (!migrated) return DEFAULT_NAV
    // A card always opens on the Dashboard. Only section open/close state and
    // the rail width survive a restart; the last selected row does not.
    return restoreDashboardOpen(migrated)
  } catch {
    return DEFAULT_NAV
  }
}

/** Per-project nav state for the single-sidebar workspace: which rail entry is
 * open, the current centre selection, the open sections, Project Info
 * sub-groups and connector channel lists, and whether the rail is collapsed. A
 * deep-link entry (compact chip / gear) moves the selection on top of the
 * persisted state; it never resets the width, the rail or the dropdowns the
 * user closed. */
export function useWorkspaceNav(
  projectId: string,
  entry?: NavEntry | null
): {
  nav: WorkspaceNavState
  openGroup: (group: OpenGroup) => void
  select: (selection: SelectionId) => void
  toggleSection: (key: SectionKey) => void
  toggleInfoGroup: (key: InfoGroupKey) => void
  toggleConnector: (key: ConnectorKey) => void
  toggleCollapse: () => void
  resize: (width: number) => void
} {
  const [nav, setNav] = useState<WorkspaceNavState>(() => {
    const persisted = readState(projectId)
    return (entry && navFromEntryProps(entry, persisted)) || persisted
  })

  useEffect(() => {
    if (!entry) return
    setNav((prev) => navFromEntryProps(entry, prev) ?? prev)
  }, [entry])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(projectId), JSON.stringify(nav))
    } catch {
      // Storage unavailable — nav still works for this session.
    }
  }, [projectId, nav])

  const openGroup = useCallback(
    (group: OpenGroup): void => setNav((prev) => openGroupNav(prev, group)),
    []
  )
  const select = useCallback(
    (selection: SelectionId): void => setNav((prev) => selectNav(prev, selection)),
    []
  )
  const toggleSection = useCallback(
    (key: SectionKey): void => setNav((prev) => toggleSectionNav(prev, key)),
    []
  )
  const toggleInfoGroup = useCallback(
    (key: InfoGroupKey): void => setNav((prev) => toggleInfoGroupNav(prev, key)),
    []
  )
  const toggleConnector = useCallback(
    (key: ConnectorKey): void => setNav((prev) => toggleConnectorNav(prev, key)),
    []
  )
  const toggleCollapse = useCallback(
    (): void => setNav((prev) => ({ ...prev, collapsed: !prev.collapsed })),
    []
  )
  const resize = useCallback((width: number): void => setNav((prev) => resizeNav(prev, width)), [])

  return {
    nav,
    openGroup,
    select,
    toggleSection,
    toggleInfoGroup,
    toggleConnector,
    toggleCollapse,
    resize
  }
}
