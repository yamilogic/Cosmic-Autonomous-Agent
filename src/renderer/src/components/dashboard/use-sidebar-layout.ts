import { useState, useEffect, useCallback } from 'react'
import {
  SidebarLayout,
  DEFAULT_LAYOUT,
  SIDEBAR_LAYOUT_STORAGE_KEY,
  normalizeLayout
} from './sidebar-layout'

export { SIDEBAR_LAYOUT_STORAGE_KEY }

export const SIDEBAR_LAYOUT_EVENT = 'orbit:sidebar-layout-change'

export function loadSidebarLayout(projectId: string): SidebarLayout {
  try {
    const raw = localStorage.getItem(`${SIDEBAR_LAYOUT_STORAGE_KEY}:${projectId}`)
    if (raw) return normalizeLayout(JSON.parse(raw))
  } catch {
    // fallback
  }
  return DEFAULT_LAYOUT
}

export function saveSidebarLayout(projectId: string, layout: SidebarLayout): void {
  try {
    localStorage.setItem(`${SIDEBAR_LAYOUT_STORAGE_KEY}:${projectId}`, JSON.stringify(layout))
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_LAYOUT_EVENT, {
        detail: { projectId, layout }
      })
    )
  } catch {
    // ignore
  }
}

export function useSidebarLayout(projectId: string): {
  layout: SidebarLayout
  updateLayout: (next: SidebarLayout) => void
  setLayout: (next: SidebarLayout) => void
} {
  const [layout, setLayoutState] = useState<SidebarLayout>(() => loadSidebarLayout(projectId))

  useEffect(() => {
    setLayoutState(loadSidebarLayout(projectId))

    const handleLayoutChange = (e: Event): void => {
      const customEvent = e as CustomEvent<{ projectId: string; layout: SidebarLayout }>
      if (customEvent.detail && customEvent.detail.projectId === projectId) {
        setLayoutState(customEvent.detail.layout)
      }
    }

    window.addEventListener(SIDEBAR_LAYOUT_EVENT, handleLayoutChange)
    return () => {
      window.removeEventListener(SIDEBAR_LAYOUT_EVENT, handleLayoutChange)
    }
  }, [projectId])

  const updateLayout = useCallback(
    (next: SidebarLayout): void => {
      setLayoutState(next)
      saveSidebarLayout(projectId, next)
    },
    [projectId]
  )

  return {
    layout,
    updateLayout,
    setLayout: updateLayout
  }
}
