import { useCallback, useEffect, useState } from 'react'

/** Persisted collapse state for the Summary tab's two sidebars. */
export interface SidebarCollapseState {
  left: boolean
  right: boolean
}

const STORAGE_PREFIX = 'orbit.sidebars.'

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`
}

function readState(projectId: string): SidebarCollapseState {
  try {
    const raw = localStorage.getItem(storageKey(projectId))
    if (!raw) return { left: false, right: false }
    const parsed = JSON.parse(raw) as Partial<SidebarCollapseState>
    return { left: Boolean(parsed.left), right: Boolean(parsed.right) }
  } catch {
    // Corrupt or unavailable storage — start with both sidebars expanded.
    return { left: false, right: false }
  }
}

/**
 * Collapse state for the Summary tab sidebars, persisted per project under
 * `orbit.sidebars.<projectId>` so a workspace keeps its layout between visits.
 */
export function useSidebarCollapse(projectId: string): {
  leftCollapsed: boolean
  rightCollapsed: boolean
  toggleLeft: () => void
  toggleRight: () => void
} {
  const [state, setState] = useState<SidebarCollapseState>(() => readState(projectId))

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(projectId), JSON.stringify(state))
    } catch {
      // Storage unavailable — collapse still works for this session.
    }
  }, [projectId, state])

  const toggleLeft = useCallback((): void => {
    setState((prev) => ({ ...prev, left: !prev.left }))
  }, [])

  const toggleRight = useCallback((): void => {
    setState((prev) => ({ ...prev, right: !prev.right }))
  }, [])

  return {
    leftCollapsed: state.left,
    rightCollapsed: state.right,
    toggleLeft,
    toggleRight
  }
}
