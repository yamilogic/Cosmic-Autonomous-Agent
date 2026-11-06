import type React from 'react'
import { Fragment, useRef, useMemo, useState, useEffect } from 'react'
import type { DashboardProject } from '../../../../shared/dashboard-contract'
import type { AppSettings } from '../../../../shared/ipc-contract'
import type { CardView } from './card-view'
import NavIcon from './nav-icons'
import { AppIcon } from '../AppIcon'
import { getBaseLayoutItems, type BaseAppLayoutKey } from '../../../../shared/base-app-presets'
import { detailMeta } from './guide-model'
import { useSidebarLayout } from './use-sidebar-layout'
import { useProfileStore } from '../../hooks/useProfiles'
import { useDashboardStore } from '../../hooks/useDashboard'
import {
  INFO_GROUPS,
  NAV_CONNECTORS,
  NAV_SECTIONS,
  NAV_WIDTH_DEFAULT,
  NAV_WIDTH_MAX,
  NAV_WIDTH_MIN,
  channelSelectionId,
  clampNavWidth,
  connectorOfSelection,
  detailKeyOf,
  guideSectionOf,
  isDetailId,
  isGuideId,
  railSectionSelection,
  sectionOfSelection,
  type ConnectorChannelLists,
  type ConnectorKey,
  type InfoGroupKey,
  type NavRow,
  type OpenGroup,
  type SectionKey,
  type SelectionId,
  type WorkspaceNavState
} from './workspace-nav'

interface WorkspaceSidebarProps {
  projectId?: string
  sources?: DashboardProject['sources']
  view: CardView
  nav: WorkspaceNavState
  channels: ConnectorChannelLists
  onOpenGroup: (group: OpenGroup) => void
  onSelect: (selection: SelectionId) => void
  onToggleSection: (key: SectionKey) => void
  onToggleInfoGroup: (key: InfoGroupKey) => void
  onToggleConnector: (key: ConnectorKey) => void
  onToggleCollapse: () => void
  onResize: (width: number) => void
  onOpenAdd?: () => void
  sidebarLook?: 'minimal' | 'ancient' | 'new-cosmic' | 'basic'
  baseAppLayout?: BaseAppLayoutKey
}

/** Real counts only — a row with nothing in it is dimmed, never given a badge. */
function rowCount(view: CardView, id: SelectionId): number | undefined {
  if (isDetailId(id)) return detailMeta(view.rightSidebar, detailKeyOf(id)).count
  if (!isGuideId(id)) return undefined
  const l = view.leftSidebar
  switch (guideSectionOf(id)) {
    case 2:
      return l.requirements.length
    case 3:
      return (
        l.scopeDeliverables.inScope.length +
        l.scopeDeliverables.outOfScope.length +
        l.scopeDeliverables.deliverables.length
      )
    case 4:
      return l.decisions.length
    case 5:
      return l.commitments.length
    case 6:
      return l.files.length
    case 7:
      return l.peopleChannels.people.length
    default:
      return undefined
  }
}

function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      className={`ws-nav-chevron${open ? ' is-open' : ''}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  )
}

interface RowProps {
  label: string
  active: boolean
  onClick: () => void
  icon?: string
  count?: number
  disabled?: boolean
  title?: string
  railOnly?: boolean
  /** Dashboard and Settings live in both the rail and the expanded panel. */
  fixed?: boolean
  leaf?: boolean
  /** A short real-state word after the label — 'synced', never a count. */
  tag?: string
}

/** One selectable line: a top-level row with an icon, or a leaf under a
 * Project info sub-group (no icon, indented). */
function Row({
  label,
  active,
  onClick,
  icon,
  count,
  disabled,
  title,
  railOnly,
  fixed,
  leaf,
  tag
}: RowProps): React.JSX.Element {
  const cls = [
    leaf ? 'ws-nav-subitem' : 'ws-nav-item',
    active ? ' is-active' : '',
    count === 0 ? ' is-empty' : '',
    railOnly ? ' ws-nav-railonly' : '',
    fixed ? ' ws-nav-fixed' : ''
  ].join('')
  return (
    <button
      type="button"
      className={cls}
      aria-disabled={disabled || undefined}
      title={title ?? label}
      aria-label={label}
      aria-current={active ? 'true' : undefined}
      onClick={disabled ? undefined : onClick}
    >
      {icon && (
        <span className="ws-nav-icon">
          <NavIcon name={icon} />
        </span>
      )}
      <span className="ws-nav-label">{label}</span>
      {tag && <span className="ws-nav-tag">{tag}</span>}
      {typeof count === 'number' && <span className="ws-nav-count">{count}</span>}
    </button>
  )
}

export default function WorkspaceSidebar({
  projectId = '',
  sources = [],
  view,
  nav,
  channels,
  onOpenGroup,
  onSelect,
  onToggleSection,
  onToggleInfoGroup,
  onToggleConnector,
  onToggleCollapse,
  onResize,
  onOpenAdd,
  sidebarLook: propSidebarLook,
  baseAppLayout: propBaseAppLayout
}: WorkspaceSidebarProps): React.ReactElement {
  const collapsed = nav.collapsed
  const asideRef = useRef<HTMLElement>(null)
  const { layout } = useSidebarLayout(projectId)
  const profiles = useProfileStore((s) => s.profiles)
  const [appLook, setAppLook] = useState<'minimal' | 'ancient' | 'new-cosmic' | 'basic'>('ancient')
  const [baseAppLayout, setBaseAppLayout] = useState<BaseAppLayoutKey>(propBaseAppLayout ?? 'standard')
  const [cardSlackAuth, setCardSlackAuth] = useState<boolean>(false)
  const [scrapingWorkspaceId, setScrapingWorkspaceId] = useState<string | null>(null)
  const snapshot = useDashboardStore((s) => s.snapshot)
  const syncSource = useDashboardStore((s) => s.syncSource)
  const upsertProject = useDashboardStore((s) => s.upsertProject)

  const handleScrapeWorkspace = async (
    targetProfileId: string,
    teamId: string,
    teamName: string,
    role: 'client' | 'ours'
  ) => {
    if (!projectId || scrapingWorkspaceId) return
    setScrapingWorkspaceId(teamId)
    try {
      const currentProject = snapshot?.projects?.find((p) => p.project.id === projectId)?.project
      let targetSourceId: string | undefined

      // Check if this workspace already exists in project sources
      const existingSources = (currentProject?.sources ?? sources ?? []) as DashboardProject['sources']
      const foundSource = existingSources?.find(
        (s) => s.workspaceId === teamId && (s.profileId === targetProfileId || !s.profileId)
      )

      if (foundSource) {
        targetSourceId = foundSource.id
      } else if (currentProject) {
        // Auto-attach workspace to project sources
        targetSourceId = `src-browser-${Date.now().toString(36)}`
        const now = new Date().toISOString()
        const newSource = {
          id: targetSourceId,
          kind: 'browser' as const,
          platform: 'slack',
          profileId: targetProfileId,
          workspaceId: teamId,
          workspaceName: teamName,
          channels: [],
          role,
          backfillDays: 7 as const,
          enabled: true,
          status: 'connected' as const,
          selectionMode: 'include' as const,
          createdAt: now,
          updatedAt: now
        }
        await upsertProject({
          ...currentProject,
          sources: [...(existingSources ?? []), newSource]
        })
      }

      // A newly attached source has no reviewed channel selection. Do not
      // scrape it from here; the card's Settings → Sources picker owns that.
      if (!foundSource || !foundSource.channelsReviewedAt) return
      await syncSource({ projectId, sourceId: targetSourceId })
    } catch (err) {
      console.error('Failed to scrape workspace:', err)
    } finally {
      setScrapingWorkspaceId(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    if (!projectId) return
    window.api?.dashboard?.checkCardAuth?.({ projectId, appId: 'slack' })
      .then((isAuth) => {
        if (!cancelled) setCardSlackAuth(Boolean(isAuth))
      })
      .catch(() => {
        if (!cancelled) setCardSlackAuth(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    if (propBaseAppLayout) {
      setBaseAppLayout(propBaseAppLayout)
    }
  }, [propBaseAppLayout])

  useEffect(() => {
    void window.api?.app?.getSettings?.().then((s) => {
      if (s?.sidebarLook) setAppLook(s.sidebarLook)
      if (s?.baseAppLayout) setBaseAppLayout(s.baseAppLayout)
    })
    const unsub = window.api?.app?.onSettingsChanged?.((s) => {
      if (s?.sidebarLook) setAppLook(s.sidebarLook)
      if (s?.baseAppLayout) setBaseAppLayout(s.baseAppLayout)
    })
    const handleCustom = (e: Event): void => {
      const s = (e as CustomEvent<AppSettings>).detail
      if (s?.sidebarLook) setAppLook(s.sidebarLook)
      if (s?.baseAppLayout) setBaseAppLayout(s.baseAppLayout)
    }
    window.addEventListener('orbit:settings-changed', handleCustom)
    return () => {
      unsub?.()
      window.removeEventListener('orbit:settings-changed', handleCustom)
    }
  }, [])

  const baseItems = useMemo(() => getBaseLayoutItems(baseAppLayout), [baseAppLayout])

  const isMinimal =
    layout.mode === 'minimal' ||
    propSidebarLook === 'minimal' ||
    propSidebarLook === 'basic' ||
    appLook === 'minimal' ||
    appLook === 'basic'
  const isAddHidden = layout.custom.hideAddButton ?? true
  const [globalAccountsOpen, setGlobalAccountsOpen] = useState(true)

  // Collect all globally available workspaces and links grouped across profiles
  const globalProfileGroups = useMemo(() => {
    const activeItems = layout.custom.activeGlobalItems
    const allowedLinks = layout.custom.allowedGlobalLinks

    return profiles.map((p) => {
      const pName = p.customName || p.displayName
      const rawSlackWorkspaces = p.apps?.slack?.availableWorkspaces ?? []
      const rawCustomLinks = p.customLinks ?? []

      // Filter Slack workspaces: must be active (if activeGlobalItems is defined) and allowed (if allowedGlobalLinks is defined)
      const slackWorkspaces = rawSlackWorkspaces.filter((w) => {
        const key = `ws:${p.id}:${w.teamId}`
        if (activeItems !== undefined && !activeItems.includes(key)) return false
        if (allowedLinks !== undefined && !allowedLinks.includes(key)) return false
        return true
      })

      // Filter custom links: must be active and allowed
      const customLinks = rawCustomLinks.filter((l) => {
        if (activeItems !== undefined && !activeItems.includes(l.id)) return false
        if (allowedLinks !== undefined && !allowedLinks.includes(l.id)) return false
        return true
      })

      return {
        profileId: p.id,
        profileName: pName,
        slackWorkspaces,
        customLinks,
        hasItems: slackWorkspaces.length > 0 || customLinks.length > 0
      }
    }).filter((g) => g.hasItems)
  }, [profiles, layout.custom.activeGlobalItems, layout.custom.allowedGlobalLinks])

  const totalGlobalItemsCount = useMemo(() => {
    return globalProfileGroups.reduce(
      (sum, g) => sum + g.slackWorkspaces.length + g.customLinks.length,
      0
    )
  }, [globalProfileGroups])

  const activeSections = useMemo(() => {
    const scheduled = (sources ?? []).some(
      (source) =>
        source.kind === 'browser' && source.enabled !== false && source.scheduleEnabled === true
    )
    const keep = (sections: typeof NAV_SECTIONS): typeof NAV_SECTIONS =>
      sections.map((section) => ({
        ...section,
        rows: section.rows.filter((row) => row.id !== 'm:schedules' || scheduled)
      }))

    if (isMinimal) {
      return keep(NAV_SECTIONS.filter((s) => s.key === 'slack'))
    }
    if (layout.mode === 'full') {
      return keep(NAV_SECTIONS)
    }
    // custom layout mode
    const hidden = new Set(layout.custom.hiddenSections)
    const order = layout.custom.sectionOrder
    const visible = NAV_SECTIONS.filter((s) => !hidden.has(s.key))
    if (!order || order.length === 0) return keep(visible)
    return keep(
      [...visible].sort((a, b) => {
        const idxA = order.indexOf(a.key)
        const idxB = order.indexOf(b.key)
        if (idxA === -1 && idxB === -1) return 0
        if (idxA === -1) return 1
        if (idxB === -1) return -1
        return idxA - idxB
      })
    )
  }, [isMinimal, layout, sources])

  const rowActive = (row: NavRow): boolean =>
    nav.openGroup === sectionOfSelection(row.id) && nav.selection === row.id

  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const handle = event.currentTarget
    const body = asideRef.current?.closest('.ws-body') as HTMLElement | null
    const startX = event.clientX
    const startW = nav.width
    let latest = startW
    handle.classList.add('is-dragging')
    document.body.classList.add('is-resizing-nav')
    handle.setPointerCapture(event.pointerId)

    const onMove = (ev: PointerEvent): void => {
      latest = clampNavWidth(startW + (ev.clientX - startX))
      body?.style.setProperty('--ws-nav-w', `${latest}px`)
    }
    const onUp = (ev: PointerEvent): void => {
      handle.releasePointerCapture(ev.pointerId)
      handle.classList.remove('is-dragging')
      document.body.classList.remove('is-resizing-nav')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      onResize(latest)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const onResizeKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 32 : 12
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onResize(clampNavWidth(nav.width - step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onResize(clampNavWidth(nav.width + step))
    }
  }

  return (
    <aside
      ref={asideRef}
      className={`ws-nav${collapsed ? ' is-collapsed' : ''}`}
      aria-label="Workspace navigation"
    >
      <div className="ws-nav-collapse">
        <button
          type="button"
          className="ws-nav-collapse-btn"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span aria-hidden>{collapsed ? '»' : '«'}</span>
        </button>
      </div>

      <nav className="ws-nav-list">
        <Row
          fixed
          icon="dashboard"
          label="Dashboard"
          title="Dashboard"
          active={nav.openGroup === 'dash'}
          onClick={() => onOpenGroup('dash')}
        />

        {activeSections.map((section) => {
          const sectionOpen = nav.openSections.includes(section.key)
          const rail = railSectionSelection(nav, section.key)
          // A closed section that owns what the centre shows keeps the accent
          // marker, so the active body always has a visible home.
          const holding = !sectionOpen && nav.openGroup === section.key
          return (
            <Fragment key={section.key}>
              {/* Collapsed rail: the whole section is one icon that restores
                  its last picked row. Hidden while expanded. */}
              <Row
                railOnly
                icon={section.icon}
                label={section.label}
                title={section.label}
                active={nav.openGroup === section.key}
                onClick={() => {
                  if (rail) onSelect(rail)
                  else onOpenGroup(section.key)
                }}
              />

              <button
                type="button"
                className={`ws-nav-section${sectionOpen ? ' is-open' : ''}${holding ? ' is-holding' : ''}`}
                aria-expanded={sectionOpen}
                onClick={() => onToggleSection(section.key)}
              >
                <span className="ws-nav-label">{section.label}</span>
                <Chevron open={sectionOpen} />
              </button>

              {sectionOpen &&
                (section.key === 'info' ? (
                  INFO_GROUPS.map((group) => {
                    const groupOpen = nav.openInfoGroups.includes(group.key)
                    const groupRows = section.rows.filter((row) => row.group === group.key)
                    const groupHolding = !groupOpen && groupRows.some((row) => rowActive(row))
                    return (
                      <div key={group.key} className="ws-nav-group">
                        <button
                          type="button"
                          className={`ws-nav-groupbtn${groupOpen ? ' is-open' : ''}${
                            groupHolding ? ' is-holding' : ''
                          }`}
                          aria-expanded={groupOpen}
                          onClick={() => onToggleInfoGroup(group.key)}
                        >
                          <span className="ws-nav-icon">
                            <NavIcon name={group.icon} />
                          </span>
                          <span className="ws-nav-label">{group.label}</span>
                          <Chevron open={groupOpen} />
                        </button>
                        {groupOpen &&
                          groupRows.map((row) => (
                            <Row
                              key={row.id}
                              leaf
                              label={row.label}
                              count={rowCount(view, row.id)}
                              active={rowActive(row)}
                              onClick={() => onSelect(row.id)}
                            />
                          ))}
                      </div>
                    )
                  })
                ) : section.key === 'slack' ? (
                  <>
                    {/* SECTION 1: GLOBAL ACCOUNTS */}
                    {!isMinimal && !layout.custom.hiddenItems?.['slack']?.includes('global_accounts') && (
                    <div className="ws-nav-group" style={{ marginBottom: 4 }}>
                      <button
                        type="button"
                        className={`ws-nav-groupbtn ws-nav-connector${globalAccountsOpen ? ' is-open' : ''}`}
                        aria-expanded={globalAccountsOpen}
                        title="Workspaces and links available across all profiles"
                        onClick={() => setGlobalAccountsOpen((prev) => !prev)}
                      >
                        <span className="ws-nav-icon">
                          <NavIcon name="globe" />
                        </span>
                        <span className="ws-nav-label" style={{ fontWeight: 600 }}>Global Accounts</span>
                        {totalGlobalItemsCount > 0 && (
                          <span className="ws-nav-count">{totalGlobalItemsCount}</span>
                        )}
                        <Chevron open={globalAccountsOpen} />
                      </button>
                      {globalAccountsOpen && (
                        <>
                          {globalProfileGroups.length === 0 ? (
                            <p className="ws-nav-note">No global accounts or workspaces configured.</p>
                          ) : (
                            globalProfileGroups.map((group) => (
                              <div key={group.profileId} style={{ marginBottom: 4 }}>
                                <div
                                  style={{
                                    fontSize: 10.5,
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.04em',
                                    color: 'var(--text-faint, #64748b)',
                                    padding: '4px 12px 2px 24px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6
                                  }}
                                >
                                  <span>👤 {group.profileName}</span>
                                </div>
                                {group.slackWorkspaces.map((gw) => {
                                  const selId = `w:${group.profileId}:${gw.teamId}` as SelectionId
                                  const isSelected = nav.selection === selId
                                  const isThisScraping = scrapingWorkspaceId === gw.teamId
                                  return (
                                    <div
                                      key={`${group.profileId}:${gw.teamId}`}
                                      className={`ws-nav-subitem${isSelected ? ' is-active' : ''}`}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '4px 8px 4px 28px',
                                        width: '100%',
                                        gap: 6
                                      }}
                                    >
                                      <button
                                        type="button"
                                        title={`View ${gw.teamName} (${group.profileName}) inside this card`}
                                        onClick={() => onSelect(selId)}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 6,
                                          background: 'none',
                                          border: 'none',
                                          padding: 0,
                                          cursor: 'pointer',
                                          minWidth: 0,
                                          flex: 1,
                                          textAlign: 'left',
                                          color: 'inherit'
                                        }}
                                      >
                                        <span
                                          className="ws-nav-label"
                                          style={{
                                            fontSize: 12,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                          }}
                                        >
                                          🏢 {gw.teamName}
                                        </span>
                                      </button>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                        <button
                                          type="button"
                                          className="scrape-btn"
                                          title={`Scrape messages from ${gw.teamName}`}
                                          disabled={Boolean(scrapingWorkspaceId)}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            void handleScrapeWorkspace(
                                              group.profileId,
                                              gw.teamId,
                                              gw.teamName,
                                              'client'
                                            )
                                          }}
                                          style={{
                                            background: isThisScraping ? 'rgba(168, 85, 247, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                                            border: '1px solid rgba(255, 255, 255, 0.15)',
                                            borderRadius: 4,
                                            color: '#e2e8f0',
                                            cursor: scrapingWorkspaceId ? 'not-allowed' : 'pointer',
                                            fontSize: 10,
                                            padding: '2px 6px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 3,
                                            lineHeight: 1
                                          }}
                                        >
                                          {isThisScraping ? '⏳ Scraping…' : '🕷 Scrape'}
                                        </button>
                                        <span className="ws-nav-tag" style={{ fontSize: 10, opacity: 0.7 }}>
                                          Slack
                                        </span>
                                      </div>
                                    </div>
                                  )
                                })}
                                {group.customLinks.map((link) => {
                                  const isActive = nav.selection === `c:link:${link.id}` || nav.selection === `c:custom:${link.id}`
                                  return (
                                    <button
                                      key={link.id}
                                      type="button"
                                      className={`ws-nav-subitem${isActive ? ' is-active' : ''}`}
                                      title={`Open ${link.name}: ${link.url}`}
                                      onClick={() => {
                                        onSelect(`c:link:${link.id}` as SelectionId)
                                      }}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '4px 12px 4px 28px',
                                        width: '100%',
                                        textAlign: 'left'
                                      }}
                                    >
                                      <span className="ws-nav-label" style={{ fontSize: 12 }}>
                                        🔗 {link.name}
                                      </span>
                                      <span className="ws-nav-tag" style={{ fontSize: 10, opacity: 0.7 }}>
                                        Link
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                            ))
                          )}
                        </>
                      )}
                    </div>
                    )}

                    {/* SECTION 2 & 3: MY ACCOUNTS & CLIENT ACCOUNTS (Platforms like Discord, Upwork, Teams appear inside these if added) */}
                    {NAV_CONNECTORS.filter((c) => {
                      if (isMinimal) {
                        return c.key === 'team'
                      }
                      // Only show top-level My Accounts ('team') and Client Accounts ('client')
                      if (c.key !== 'team' && c.key !== 'client') return false
                      const hiddenSub = layout.custom.hiddenItems?.['slack'] ?? []
                      if (c.key === 'team' && hiddenSub.includes('our_slack')) return false
                      if (c.key === 'client' && hiddenSub.includes('client_slack')) return false
                      return true
                    }).map((connector) => {
                    const list = channels[connector.key]
                    const entries = list?.entries ?? []
                    const open = nav.openConnectors.includes(connector.key)
                    const holding =
                      !open && connectorOfSelection(nav.selection) === connector.key

                    // Custom attached platform accounts for this role
                    const roleKey = connector.key === 'client' ? 'client' : 'ours'
                    const extraSources = sources.filter((s: any) => s.role === roleKey && s.platform && s.platform !== 'slack')
                    const isMyAccounts = connector.key === 'team'
                    const count = isMyAccounts
                      ? baseItems.length + extraSources.length
                      : entries.length + extraSources.length

                    return (
                      <div key={connector.key} className="ws-nav-group">
                        <button
                          type="button"
                          className={`ws-nav-groupbtn ws-nav-connector${open ? ' is-open' : ''}${
                            holding ? ' is-holding' : ''
                          }`}
                          aria-expanded={open}
                          title={connector.note}
                          onClick={() => onToggleConnector(connector.key)}
                        >
                          <span className="ws-nav-icon">
                            <NavIcon name={connector.icon} />
                          </span>
                          <span className="ws-nav-label">{connector.label}</span>
                          {(count > 0 || isMinimal) && (
                            <span className="ws-nav-count">
                              {count}
                            </span>
                          )}
                          <Chevron open={open} />
                        </button>
                        {open && (
                          <>
                            {isMyAccounts ? (
                              <>
                                {baseItems.map((item) => {
                                  const isActive =
                                    item.type === 'app'
                                      ? item.appId === 'slack'
                                        ? nav.selection === 's:team' || (nav.selection && nav.selection.startsWith('c:team'))
                                        : nav.selection?.startsWith(`c:${item.appId}`)
                                      : nav.selection === `c:preset:${item.id}`

                                  const handleClick = () => {
                                    if (item.type === 'app') {
                                      if (item.appId === 'slack') onSelect('s:team')
                                      else if (item.appId === 'teams') onSelect('c:teams:main')
                                      else if (item.appId === 'whatsapp') onSelect('c:whatsapp:main')
                                    } else {
                                      onSelect(`c:preset:${item.id}` as SelectionId)
                                    }
                                  }

                                  return (
                                    <button
                                      key={item.id}
                                      type="button"
                                      className={`ws-nav-subitem${isActive ? ' is-active' : ''}`}
                                      title={item.name}
                                      onClick={handleClick}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '4px 12px 4px 28px',
                                        width: '100%',
                                        textAlign: 'left'
                                      }}
                                    >
                                      <span className="ws-nav-label" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                                        {item.type === 'app' && item.appId ? (
                                          <AppIcon appId={item.appId} size={13} />
                                        ) : (
                                          <span style={{ fontSize: 13, flexShrink: 0 }}>{item.icon || '🌐'}</span>
                                        )}
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                          {item.name}
                                        </span>
                                      </span>
                                      <span className="ws-nav-tag" style={{ fontSize: 10, opacity: 0.7, flexShrink: 0 }}>
                                        {item.id === 'slack' && entries.length > 0
                                          ? `${entries.length} ch`
                                          : item.id === 'slack'
                                            ? (cardSlackAuth ? 'Active' : 'Ready')
                                            : item.type === 'app'
                                              ? 'Active'
                                              : 'Web'}
                                      </span>
                                    </button>
                                  )
                                })}
                                {extraSources.map((src: any) => {
                                  const isSlackSource = src.platform === 'slack' || (!src.url && !src.platform)
                                  const isThisScraping = scrapingWorkspaceId === src.workspaceId
                                  return (
                                    <div
                                      key={src.id}
                                      className="ws-nav-subitem"
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '4px 8px 4px 28px',
                                        width: '100%',
                                        gap: 6
                                      }}
                                    >
                                      <button
                                        type="button"
                                        title={src.url ? `${src.workspaceName} (${src.url})` : `${src.workspaceName} (${src.platform})`}
                                        onClick={() => onSelect(`c:ours:${src.id}` as SelectionId)}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 6,
                                          background: 'none',
                                          border: 'none',
                                          padding: 0,
                                          cursor: 'pointer',
                                          minWidth: 0,
                                          flex: 1,
                                          textAlign: 'left',
                                          color: 'inherit'
                                        }}
                                      >
                                        <span style={{ fontSize: 13, flexShrink: 0 }}>{src.url ? '🌐' : '🔌'}</span>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                                          {src.workspaceName}
                                        </span>
                                      </button>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                        {isSlackSource && src.workspaceId && (
                                          <button
                                            type="button"
                                            className="scrape-btn"
                                            title={`Scrape messages from ${src.workspaceName}`}
                                            disabled={Boolean(scrapingWorkspaceId)}
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              void handleScrapeWorkspace(
                                                src.profileId || '',
                                                src.workspaceId,
                                                src.workspaceName,
                                                'ours'
                                              )
                                            }}
                                            style={{
                                              background: isThisScraping ? 'rgba(168, 85, 247, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                                              border: '1px solid rgba(255, 255, 255, 0.15)',
                                              borderRadius: 4,
                                              color: '#e2e8f0',
                                              cursor: scrapingWorkspaceId ? 'not-allowed' : 'pointer',
                                              fontSize: 10,
                                              padding: '2px 6px',
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: 3,
                                              lineHeight: 1
                                            }}
                                          >
                                            {isThisScraping ? '⏳ Scraping…' : '🕷 Scrape'}
                                          </button>
                                        )}
                                        <span className="ws-nav-tag" style={{ fontSize: 10, opacity: 0.7, textTransform: 'capitalize', flexShrink: 0 }}>
                                          {src.url ? 'link ↗' : src.platform}
                                        </span>
                                      </div>
                                    </div>
                                  )
                                })}
                              </>
                            ) : (
                              <>
                                {list?.loading && <p className="ws-nav-note">Loading channels…</p>}
                                {list?.error && (
                                  <p className="ws-nav-note is-error" style={{ fontSize: '11px', lineHeight: 1.4 }}>
                                    {list.error.includes('token_revoked')
                                      ? 'Client token revoked. Please reconnect token or use Browser Session.'
                                      : list.error}
                                  </p>
                                )}
                                {!list?.loading && !list?.error && entries.length === 0 && extraSources.length === 0 && (
                                  <p className="ws-nav-note">{connector.note}</p>
                                )}
                                {entries.map((channel) => (
                                  <Row
                                    key={channel.id}
                                    leaf
                                    label={`#${channel.name}`}
                                    tag={channel.watched ? 'synced' : undefined}
                                    title={channel.name}
                                    active={
                                      nav.selection === channelSelectionId(connector.key, channel.id)
                                    }
                                    onClick={() =>
                                      onSelect(channelSelectionId(connector.key, channel.id))
                                    }
                                  />
                                ))}
                                {extraSources.map((src: any) => {
                                  const isSlackSource = src.platform === 'slack' || (!src.url && !src.platform)
                                  const isThisScraping = scrapingWorkspaceId === src.workspaceId
                                  return (
                                    <div
                                      key={src.id}
                                      className="ws-nav-subitem"
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '4px 8px 4px 28px',
                                        width: '100%',
                                        gap: 6
                                      }}
                                    >
                                      <button
                                        type="button"
                                        title={src.url ? `${src.workspaceName} (${src.url})` : `${src.workspaceName} (${src.platform})`}
                                        onClick={() => onSelect(`c:client:${src.id}` as SelectionId)}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 6,
                                          background: 'none',
                                          border: 'none',
                                          padding: 0,
                                          cursor: 'pointer',
                                          minWidth: 0,
                                          flex: 1,
                                          textAlign: 'left',
                                          color: 'inherit'
                                        }}
                                      >
                                        <span style={{ fontSize: 13, flexShrink: 0 }}>{src.url ? '🌐' : '🔌'}</span>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                                          {src.workspaceName}
                                        </span>
                                      </button>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                        {isSlackSource && src.workspaceId && (
                                          <button
                                            type="button"
                                            className="scrape-btn"
                                            title={`Scrape messages from ${src.workspaceName}`}
                                            disabled={Boolean(scrapingWorkspaceId)}
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              void handleScrapeWorkspace(
                                                src.profileId || '',
                                                src.workspaceId,
                                                src.workspaceName,
                                                'client'
                                              )
                                            }}
                                            style={{
                                              background: isThisScraping ? 'rgba(168, 85, 247, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                                              border: '1px solid rgba(255, 255, 255, 0.15)',
                                              borderRadius: 4,
                                              color: '#e2e8f0',
                                              cursor: scrapingWorkspaceId ? 'not-allowed' : 'pointer',
                                              fontSize: 10,
                                              padding: '2px 6px',
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: 3,
                                              lineHeight: 1
                                            }}
                                          >
                                            {isThisScraping ? '⏳ Scraping…' : '🕷 Scrape'}
                                          </button>
                                        )}
                                        <span className="ws-nav-tag" style={{ fontSize: 10, opacity: 0.7, textTransform: 'capitalize', flexShrink: 0 }}>
                                          {src.url ? 'link ↗' : src.platform}
                                        </span>
                                      </div>
                                    </div>
                                  )
                                })}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                  </>
                ) : (
                  section.rows.map((row) => (
                    <Row
                      key={row.id}
                      icon={row.icon}
                      label={row.label}
                      title={row.desc}
                      active={rowActive(row)}
                      count={rowCount(view, row.id)}
                      onClick={() => onSelect(row.id)}
                    />
                  ))
                ))}

            </Fragment>
          )
        })}
      </nav>

      <div
        className="ws-nav-footer"
        style={{
          display: collapsed ? 'flex' : 'grid',
          flexDirection: collapsed ? 'column' : undefined,
          gridTemplateColumns: !collapsed ? (onOpenAdd && !isAddHidden ? '1fr 1fr' : '1fr') : undefined,
          gap: 6,
          padding: collapsed ? '8px 6px' : '8px 10px',
          alignItems: 'center',
          width: '100%',
          boxSizing: 'border-box'
        }}
      >
        {onOpenAdd && !isAddHidden && (
          <button
            type="button"
            className="ws-nav-item ws-nav-add-btn"
            onClick={onOpenAdd}
            title="Add platform, workspace, or link to this card"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              background: 'color-mix(in srgb, var(--accent) 18%, rgba(255, 255, 255, 0.05))',
              border: '1px solid color-mix(in srgb, var(--accent) 55%, transparent)',
              borderRadius: 7,
              padding: collapsed ? 0 : '0 8px',
              width: '100%',
              height: 34,
              fontSize: '12px',
              fontWeight: 650,
              color: '#fff',
              cursor: 'pointer',
              boxShadow: '0 2px 5px rgba(0, 0, 0, 0.2)',
              transition: 'all 0.15s ease',
              minWidth: 0,
              overflow: 'hidden'
            }}
          >
            <span style={{ fontSize: '13px', flexShrink: 0 }}>➕</span>
            {!collapsed && (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                + Add
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          className={`ws-nav-item ws-nav-fixed${nav.openGroup === 'settings' ? ' is-active' : ''}`}
          onClick={() => onOpenGroup('settings')}
          title="Project Card Settings"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            background: nav.openGroup === 'settings' ? 'color-mix(in srgb, var(--accent) 25%, transparent)' : 'rgba(255, 255, 255, 0.04)',
            border: nav.openGroup === 'settings' ? '1px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 7,
            padding: collapsed ? 0 : '0 8px',
            width: '100%',
            height: 34,
            fontSize: '12px',
            fontWeight: 600,
            color: nav.openGroup === 'settings' ? '#fff' : 'var(--text-faint, #94a3b8)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            minWidth: 0,
            overflow: 'hidden'
          }}
        >
          <span className="ws-nav-glyph" style={{ display: 'inline-flex' }}>
            <NavIcon name="settings" />
          </span>
          {!collapsed && (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Settings
            </span>
          )}
        </button>
      </div>

      {!collapsed && (
        <div
          className="ws-nav-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={nav.width}
          aria-valuemin={NAV_WIDTH_MIN}
          aria-valuemax={NAV_WIDTH_MAX}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={startResize}
          onKeyDown={onResizeKey}
          onDoubleClick={() => onResize(NAV_WIDTH_DEFAULT)}
        />
      )}
    </aside>
  )
}
