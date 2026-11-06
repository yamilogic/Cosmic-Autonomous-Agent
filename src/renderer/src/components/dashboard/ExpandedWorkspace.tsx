import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DashboardProject,
  DashboardProjectSnapshot,
  DashboardTeamWorkspace
} from '../../../../shared/dashboard-contract'
import type { CardSummary, CardView } from './card-view'
import CardHead, { type CardHeadFlag } from './CardHead'
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav'
import { useSlackChannels } from '../../hooks/useSlackChannels'
import { useDashboardStore } from '../../hooks/useDashboard'
import WorkspaceSidebar from './WorkspaceSidebar'
import WorkspaceContent from './WorkspaceContent'
import { CardAddModal } from './CardAddModal'
import ScrapedHistoryAuditDrawer from './ScrapedHistoryAuditDrawer'
import { buildConnectorChannelLists, type NavEntry, type WorkspaceEntryTab } from './workspace-nav'
import type { DetailKey } from './guide-model'
import type { BaseAppLayoutKey } from '../../../../shared/base-app-presets'

interface ExpandedWorkspaceProps {
  view: CardView
  summary: CardSummary
  project: DashboardProject
  snapshot: DashboardProjectSnapshot
  profileName?: string | null
  syncing: boolean
  onSync: () => void
  onScrape?: () => void
  scraping?: boolean
  onLogs?: () => void
  onSettings: () => void
  onEdit: () => void
  onRemove: () => void
  onToggle: () => void
  pinned?: boolean
  onTogglePin?: () => void
  /** Force a starting view (card-header gear opens Settings). */
  initialTab?: WorkspaceEntryTab
  /** Force a starting guide section (compact chip deep-link). */
  initialGuideSection?: number
  /** Force a starting detail (compact chip deep-link). */
  initialDetailKey?: DetailKey
  baseAppLayout?: BaseAppLayoutKey
}

const STATUS_FLAGS: Record<string, CardHeadFlag> = {
  'on-track': { label: 'On track', tone: 'success' },
  'at-risk': { label: 'At risk', tone: 'warn' },
  blocked: { label: 'Blocked', tone: 'danger' },
  'waiting-on-client': { label: 'Waiting on client', tone: 'warn' }
}

export default function ExpandedWorkspace({
  view,
  summary,
  project,
  snapshot,
  profileName,
  syncing,
  onSync,
  onScrape,
  scraping = false,
  onLogs,
  onSettings,
  onEdit,
  onRemove,
  onToggle,
  pinned = false,
  onTogglePin,
  initialTab,
  initialGuideSection,
  initialDetailKey,
  baseAppLayout
}: ExpandedWorkspaceProps): React.ReactElement {
  const { identity } = view

  const entry: NavEntry | null = useMemo(() => {
    if (!initialTab && !initialGuideSection && !initialDetailKey) return null
    return { initialTab, initialGuideSection, initialDetailKey }
  }, [initialTab, initialGuideSection, initialDetailKey])
  const {
    nav,
    openGroup,
    select,
    toggleSection,
    toggleInfoGroup,
    toggleConnector,
    toggleCollapse,
    resize
  } = useWorkspaceNav(summary.projectId, entry)
  const listing = useSlackChannels(project, 'client')
  const [teamWorkspace, setTeamWorkspace] = useState<DashboardTeamWorkspace | null>(null)
  const [teamLoading, setTeamLoading] = useState(true)
  const [cardAddOpen, setCardAddOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  // "New since your last visit" is measured from the moment the reader stops
  // looking at the Dashboard (leaving the dash panel or closing the card), not
  // from when they last clicked something elsewhere.
  const lastMark = useRef<Promise<unknown>>(Promise.resolve())
  const markViewed = useCallback((): void => {
    lastMark.current = window.api.dashboard
      .markViewed({ projectId: summary.projectId })
      .catch(() => undefined)
  }, [summary.projectId])
  const groupRef = useRef(nav.openGroup)
  const prevGroup = useRef(nav.openGroup)
  useEffect(() => {
    if (prevGroup.current === 'dash' && nav.openGroup !== 'dash') markViewed()
    prevGroup.current = nav.openGroup
    groupRef.current = nav.openGroup
  }, [nav.openGroup, markViewed])
  const handleToggle = useCallback((): void => {
    if (groupRef.current === 'dash') markViewed()
    onToggle()
  }, [markViewed, onToggle])

  // Recompute "new since your last visit" against the marker written when the
  // reader left the Dashboard, so coming back never shows a stale diff.
  const refreshSnapshot = useDashboardStore((s) => s.loadSnapshot)
  useEffect(() => {
    if (nav.openGroup !== 'dash') return
    void lastMark.current.then(() => refreshSnapshot()).catch(() => undefined)
  }, [nav.openGroup, refreshSnapshot])

  useEffect(() => {
    let cancelled = false
    window.api.dashboard
      .getTeamWorkspace()
      .then((workspace) => {
        if (cancelled) return
        setTeamWorkspace(workspace)
        setTeamLoading(false)
      })
      .catch(() => {
        if (!cancelled) setTeamLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const channelLists = useMemo(() => {
    // The project's mapped Our Slack channels win. The global list is only the
    // legacy fallback for projects created before ourSlackChannels existed.
    const projectTeamChannels = project.ourSlackChannels?.map((c) => ({
      id: c.channelId,
      name: c.channelName
    }))
    const teamListed = projectTeamChannels?.length
      ? projectTeamChannels
      : (teamWorkspace?.channels ?? []).map((c) => ({ id: c.channelId, name: c.channelName }))
    return buildConnectorChannelLists({
      clientLoading: listing.loading,
      clientError: listing.error,
      clientChannels: listing.channels,
      watchedChannels: identity.channels.map((c) => ({
        id: c.channelId,
        name: c.channelName
      })),
      teamLoading,
      teamChannels: teamListed,
      teamWatched: projectTeamChannels ?? [],
      teamConnected: Boolean(teamWorkspace?.connected || projectTeamChannels?.length)
    })
  }, [listing, teamLoading, teamWorkspace, identity.channels, project.ourSlackChannels])

  const statusFlag: CardHeadFlag | null = summary.status
    ? (STATUS_FLAGS[summary.status] ?? { label: summary.status, tone: 'muted' })
    : null

  const headFlags: CardHeadFlag[] = [
    ...(statusFlag ? [statusFlag] : []),
    ...(summary.needsReply ? [{ label: 'Needs my reply', tone: 'danger' as const }] : []),
    ...(summary.inactive ? [{ label: 'Inactive 24h+', tone: 'muted' as const }] : [])
  ]

  return (
    <article
      className="ws-shell"
      id={`dash-card-anchor-${summary.projectId}`}
      data-testid={`dash-card-${summary.index}`}
      data-expanded="true"
    >
      <CardHead
        name={identity.name}
        workspaceName={identity.teamName}
        clientName={identity.clientName}
        profileName={profileName}
        aiBadge={view.aiBadge}
        flags={headFlags}
        syncing={syncing}
        onSync={onSync}
        onScrape={onScrape}
        scraping={scraping}
        onLogs={onLogs}
        onHistory={() => setHistoryOpen(true)}
        onSettings={onSettings}
        onEdit={onEdit}
        onRemove={onRemove}
        onToggle={handleToggle}
        pinned={pinned}
        onTogglePin={onTogglePin}
      />

      <div
        className={`ws-body${nav.collapsed ? ' is-collapsed' : ''}`}
        style={{ '--ws-nav-w': `${nav.width}px` } as React.CSSProperties}
      >
        <WorkspaceSidebar
          projectId={project.id}
          sources={project.sources}
          view={view}
          nav={nav}
          baseAppLayout={baseAppLayout}
          channels={channelLists}
          onOpenGroup={openGroup}
          onSelect={select}
          onToggleSection={toggleSection}
          onToggleInfoGroup={toggleInfoGroup}
          onToggleConnector={toggleConnector}
          onToggleCollapse={toggleCollapse}
          onResize={resize}
          onOpenAdd={() => setCardAddOpen(true)}
        />
        <WorkspaceContent
          view={view}
          summary={summary}
          project={project}
          snapshot={snapshot}
          nav={nav}
          channels={channelLists}
          syncing={syncing}
          onSync={onSync}
          onOpenSettings={onSettings}
          onSelect={select}
        />
        <CardAddModal
          open={cardAddOpen}
          project={project}
          onClose={() => setCardAddOpen(false)}
        />
        <ScrapedHistoryAuditDrawer
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          projectId={project.id}
          projectName={project.name || project.teamName || 'Card'}
        />
      </div>
    </article>
  )
}
