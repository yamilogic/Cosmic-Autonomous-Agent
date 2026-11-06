import type React from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { SidebarState } from '../../../../shared/dashboard-contract'

export interface SidebarSection {
  number: number
  title: string
  hint: string
  content: React.ReactNode
  isEmpty?: boolean
}

interface AccordionSidebarProps {
  sections: SidebarSection[]
  sidebarId: 'left' | 'right'
  projectId: string
  onSectionChange?: (section: number | null) => void
  onWidthChange?: (width: number) => void
  onCollapseChange?: (collapsed: boolean) => void
}

const MIN_WIDTH = 240
const MAX_WIDTH = 420
const NARROW_WIDTH = 290
const WIDE_WIDTH = 380
const COLLAPSED_RAIL_WIDTH = 64

function useSidebarState(sidebarId: 'left' | 'right', projectId: string): {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  width: number
  setWidth: (width: number) => void
  openSection: number | null
  setOpenSection: (openSection: number | null) => void
  loaded: boolean
} {
  const [state, setState] = useState<SidebarState>({
    collapsed: false,
    width: NARROW_WIDTH,
    openSection: 1
  })
  const [loaded, setLoaded] = useState(false)

  // Load initial state from main process
  useEffect(() => {
    let cancelled = false
    window.api.dashboard
      .getSidebarState(projectId)
      .then((fullState) => {
        if (!cancelled) {
          setState(
            fullState[sidebarId] ?? { collapsed: false, width: NARROW_WIDTH, openSection: 1 }
          )
          setLoaded(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ collapsed: false, width: NARROW_WIDTH, openSection: 1 })
          setLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId, sidebarId])

  const updateState = useCallback(async (patch: Partial<SidebarState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch }
      // Persist to main process
      window.api.dashboard.updateSidebarState(projectId, sidebarId, patch).catch(() => {})
      return next
    })
  }, [projectId, sidebarId])

  const setCollapsed = useCallback((collapsed: boolean) => updateState({ collapsed }), [updateState])
  const setWidth = useCallback((width: number) => updateState({ width }), [updateState])
  const setOpenSection = useCallback((openSection: number | null) => updateState({ openSection }), [updateState])

  return { collapsed: state.collapsed, setCollapsed, width: state.width, setWidth, openSection: state.openSection, setOpenSection, loaded }
}

export default function AccordionSidebar({
  sections,
  sidebarId,
  projectId,
  onSectionChange,
  onWidthChange,
  onCollapseChange
}: AccordionSidebarProps): React.ReactElement {
  const { collapsed, setCollapsed, width, setWidth, openSection, setOpenSection, loaded } = useSidebarState(
    sidebarId,
    projectId
  )

  const dragRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleSectionClick = (sectionNum: number) => {
    if (openSection === sectionNum) {
      setOpenSection(null)
      onSectionChange?.(null)
    } else {
      setOpenSection(sectionNum)
      onSectionChange?.(sectionNum)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent, sectionNum: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleSectionClick(sectionNum)
    }
  }

  const handleDragStart = (e: React.MouseEvent): void => {
    isDragging.current = true
    startX.current = e.clientX
    startWidth.current = width
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
    window.addEventListener('mousemove', handleDragMove)
    window.addEventListener('mouseup', handleDragEnd)
  }

  const handleDragMove = useCallback((e: MouseEvent): void => {
    if (!isDragging.current) return
    const delta = e.clientX - startX.current
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta))
    setWidth(newWidth)
    onWidthChange?.(newWidth)
  }, [width, setWidth, onWidthChange])

  const handleDragEnd = useCallback((): void => {
    if (isDragging.current) {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleDragMove)
      window.removeEventListener('mouseup', handleDragEnd)
    }
  }, [handleDragMove])

  useEffect(() => {
    if (isDragging.current) {
      window.addEventListener('mousemove', handleDragMove)
      window.addEventListener('mouseup', handleDragEnd)
    }
    return () => {
      window.removeEventListener('mousemove', handleDragMove)
      window.removeEventListener('mouseup', handleDragEnd)
    }
  }, [handleDragMove, handleDragEnd])

  const toggleCollapse = () => {
    const next = !collapsed
    setCollapsed(next)
    onCollapseChange?.(next)
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 1100

  // On mobile/small screens, start collapsed
  useEffect(() => {
    if (loaded && isMobile && !collapsed) {
      setCollapsed(true)
      onCollapseChange?.(true)
    }
  }, [isMobile, collapsed, setCollapsed, onCollapseChange, loaded])

  if (!loaded) {
    return (
      <aside
        className="dash-sidebar dash-sidebar-loading flex flex-col bg-surface-dark border-r border-border-dark"
        data-sidebar={sidebarId}
        style={{ width: `${NARROW_WIDTH}px`, minWidth: 0 }}
        role="navigation"
        aria-label={`${sidebarId === 'left' ? 'PROJECT GUIDE' : 'ATTENTION'} (loading)`}
      >
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </aside>
    )
  }

  if (collapsed) {
    return (
      <aside
        className="dash-sidebar dash-sidebar-collapsed flex flex-col bg-surface-dark border-r border-border-dark"
        data-sidebar={sidebarId}
        style={{ width: `${COLLAPSED_RAIL_WIDTH}px`, minWidth: 0 }}
        role="navigation"
        aria-label={`${sidebarId === 'left' ? 'PROJECT GUIDE' : 'ATTENTION'} (collapsed)`}
      >
        <div className="dash-sidebar-rail flex flex-col items-center p-3 gap-3 h-full">
          <button
            type="button"
            className="dash-sidebar-expand-btn w-8 h-8 rounded-lg border border-border-dark bg-surface-2-dark text-muted-dark hover:bg-accent/10 hover:border-accent hover:text-accent transition-colors flex items-center justify-center"
            onClick={toggleCollapse}
            aria-label="Expand sidebar"
            title="Expand"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {sidebarId === 'left' ? (
                <path d="M9 18l6-6-6-6" />
              ) : (
                <path d="M15 18l-6-6 6-6" />
              )}
            </svg>
          </button>
          <div className="dash-sidebar-sections-rail flex flex-col gap-2 flex-1 w-full" role="tablist" aria-label="Sections">
            {sections.map((section) => (
              <button
                key={section.number}
                type="button"
                className={`dash-sidebar-rail-btn w-full h-10 rounded-lg border border-border-dark bg-surface-2-dark font-semibold text-sm transition-colors ${
                  openSection === section.number
                    ? 'bg-accent text-accent-on border-accent'
                    : 'text-muted-dark hover:bg-accent/10 hover:border-accent hover:text-accent'
                }`}
                role="tab"
                aria-selected={openSection === section.number}
                aria-label={`Section ${section.number}: ${section.title}`}
                onClick={() => {
                  setCollapsed(false)
                  setOpenSection(section.number)
                  onCollapseChange?.(false)
                  onSectionChange?.(section.number)
                }}
                onKeyDown={(e) => handleKeyDown(e, section.number)}
                title={`${section.number}. ${section.title}`}
              >
                <span className="dash-sidebar-rail-num">{section.number}</span>
              </button>
            ))}
          </div>
          <div className="dash-sidebar-width-toggle mt-auto pt-3">
            <button
              type="button"
              className={`dash-sidebar-width-btn w-8 h-8 rounded-lg border border-border-dark bg-surface-2-dark text-muted-dark hover:bg-accent/10 hover:border-accent hover:text-accent transition-colors flex items-center justify-center ${
                width === WIDE_WIDTH ? 'text-accent' : ''
              }`}
              onClick={() => { const nw = width === WIDE_WIDTH ? NARROW_WIDTH : WIDE_WIDTH; setWidth(nw); onWidthChange?.(nw) }}
              aria-label={`Switch to ${width === WIDE_WIDTH ? 'narrow' : 'wide'} width`}
              title={width === WIDE_WIDTH ? 'Narrow (290px)' : 'Wide (380px)'}
            >
              {width === WIDE_WIDTH ? '◀' : '▶'}
            </button>
          </div>
        </div>
        <div
          ref={dragRef}
          className="dash-sidebar-resizer absolute top-0 right-[-3px] w-6 h-full cursor-col-resize z-10"
          onMouseDown={handleDragStart}
          aria-label="Resize sidebar"
          role="separator"
          tabIndex={0}
        />
      </aside>
    )
  }

  return (
    <aside
      className="dash-sidebar dash-sidebar-expanded flex flex-col bg-surface-dark border-r border-border-dark"
      data-sidebar={sidebarId}
      style={{ width: `${width}px`, minWidth: 0 }}
      role="navigation"
      aria-label={`${sidebarId === 'left' ? 'PROJECT GUIDE' : 'ATTENTION'} (expanded)`}
    >
      <div className="dash-sidebar-header flex items-center justify-between p-3 border-b border-border-dark bg-surface-2-dark flex-shrink-0">
        <h3 className="dash-sidebar-title text-xs font-semibold uppercase tracking-wider text-muted-dark">
          {sidebarId === 'left' ? 'PROJECT GUIDE' : 'ATTENTION'}
        </h3>
        <div className="dash-sidebar-header-actions flex gap-2">
          <button
            type="button"
            className="dash-sidebar-width-btn w-8 h-8 rounded-lg border border-border-dark bg-surface-2-dark text-muted-dark hover:bg-accent/10 hover:border-accent hover:text-accent transition-colors flex items-center justify-center"
            onClick={() => { const nw = width === WIDE_WIDTH ? NARROW_WIDTH : WIDE_WIDTH; setWidth(nw); onWidthChange?.(nw) }}
            aria-label={`Switch to ${width === WIDE_WIDTH ? 'narrow' : 'wide'} width`}
            title={width === WIDE_WIDTH ? 'Narrow (290px)' : 'Wide (380px)'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" />
              <path d="M16 3h3a2 2 0 0 0 2 2v14a2 2 0 0 0-2 2h-3" />
              <path d="M12 20v-2" />
              <path d="M12 14v-2" />
              <path d="M12 8V6" />
            </svg>
          </button>
          <button
            type="button"
            className="dash-sidebar-collapse-btn w-8 h-8 rounded-lg border border-border-dark bg-surface-2-dark text-muted-dark hover:bg-accent/10 hover:border-accent hover:text-accent transition-colors flex items-center justify-center"
            onClick={toggleCollapse}
            aria-label="Collapse sidebar"
            title="Collapse"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {sidebarId === 'left' ? (
                <path d="M15 18l-6-6 6-6" />
              ) : (
                <path d="M9 18l6-6-6-6" />
              )}
            </svg>
          </button>
        </div>
      </div>

      <div className="dash-sidebar-content flex-1 overflow-y-auto p-2" role="tabpanel">
        {sections.map((section) => (
          <AccordionSectionItem
            key={section.number}
            section={section}
            isOpen={openSection === section.number}
            onClick={() => handleSectionClick(section.number)}
            onKeyDown={(e) => handleKeyDown(e, section.number)}
          />
        ))}
      </div>

      <div
        ref={dragRef}
        className="dash-sidebar-resizer absolute top-0 right-[-3px] w-6 h-full cursor-col-resize z-10"
        onMouseDown={handleDragStart}
        aria-label="Resize sidebar"
        role="separator"
        tabIndex={0}
      />
    </aside>
  )
}

interface AccordionSectionItemProps {
  section: SidebarSection
  isOpen: boolean
  onClick: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

function AccordionSectionItem({
  section,
  isOpen,
  onClick,
  onKeyDown
}: AccordionSectionItemProps): React.ReactElement {
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(isOpen ? contentRef.current.scrollHeight : 0)
    }
  }, [isOpen])

  return (
    <div className={`dash-sidebar-section rounded-lg overflow-hidden`}>
      <button
        type="button"
        className={`dash-sidebar-section-header w-full flex items-start gap-3 p-3 border border-border-dark rounded-lg bg-surface-2-dark cursor-pointer text-left transition-colors ${
          isOpen ? 'bg-accent/10 border-accent' : 'hover:bg-accent/5 hover:border-accent'
        }`}
        role="tab"
        aria-selected={isOpen}
        aria-expanded={isOpen}
        aria-controls={`sidebar-content-${section.number}`}
        id={`sidebar-header-${section.number}`}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <span className={`dash-sidebar-section-num w-5 h-5 flex items-center justify-center rounded text-xs font-bold flex-shrink-0 ${
          isOpen ? 'bg-accent text-accent-on' : 'bg-accent/20 text-accent'
        }`}>
          {section.number}
        </span>
        <div className="flex flex-col min-w-0 flex-1 gap-0.5">
          <span className="dash-sidebar-section-title text-sm font-semibold" style={{ color: 'var(--text)' }}>{section.title}</span>
          <span className="dash-sidebar-section-hint text-xs" style={{ color: 'var(--text-muted)' }}>
            {section.hint}
          </span>
        </div>
        <span className={`dash-sidebar-section-chevron w-5 h-5 flex items-center justify-center flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--text-muted)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      <div
        ref={contentRef}
        id={`sidebar-content-${section.number}`}
        role="tabpanel"
        aria-labelledby={`sidebar-header-${section.number}`}
        className="dash-sidebar-section-content overflow-hidden transition-[max-height] duration-250"
        style={{ maxHeight: `${contentHeight}px` }}
        hidden={!isOpen}
      >
        <div className="dash-sidebar-section-inner pt-2 pb-1 px-1">
          {section.isEmpty ? (
            <p className="dash-sidebar-empty text-sm text-muted-dark italic py-2">
              {section.hint || 'Not found in chat'}
            </p>
          ) : (
            section.content
          )}
        </div>
      </div>
    </div>
  )
}