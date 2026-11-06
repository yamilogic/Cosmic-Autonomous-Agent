import type React from 'react'
import { memo, useMemo, useState } from 'react'
import type { DashboardProjectSnapshot } from '../../../../shared/dashboard-contract'
import { useDashboardStore } from '../../hooks/useDashboard'
import { useProfileStore } from '../../hooks/useProfiles'
import { buildCardView, buildCardSummary } from './card-view'
import { sameProjectForCard } from './project-card-compare'
import CompactCard from './CompactCard'
import ExpandedWorkspace from './ExpandedWorkspace'
import { RunLogsModal } from './RunLogsModal'
import type { WorkspaceEntryTab } from './workspace-nav'
import type { DetailKey } from './guide-model'

interface ProjectCardProps {
  snapshot: DashboardProjectSnapshot
  index: number
  expanded: boolean
  onToggle: () => void
  onDelete: (projectId: string) => void
  onOpenSettings: (projectId: string) => void
  onExpandSection?: (section: number) => void
  initialTab?: WorkspaceEntryTab
  tabNonce?: number
  initialGuideSection?: number
  initialDetailKey?: DetailKey
  pinned?: boolean
  onTogglePin?: () => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  onMoveUp?: () => void
  onMoveDown?: () => void
  /** Memo guard: pin order changes must refresh the action closures. */
  pinOrderKey?: string
  /** Memo guard: view-mode changes must refresh the toggle closure. */
  pageMode?: 'compact' | 'expanded' | 'mixed'
}

function ProjectCardInner({
  snapshot,
  index,
  expanded,
  onToggle,
  onDelete,
  onOpenSettings,
  onExpandSection,
  initialTab,
  tabNonce,
  initialGuideSection,
  initialDetailKey,
  pinned = false,
  onTogglePin,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown
}: ProjectCardProps): React.ReactElement {
  const project = snapshot.project
  const syncNow = useDashboardStore((s) => s.syncNow)
  const syncSource = useDashboardStore((s) => s.syncSource)
  const openWizard = useDashboardStore((s) => s.openWizard)
  const syncingIds = useDashboardStore((s) => s.syncingProjectIds)
  const syncing = syncingIds.includes(project.id)
  const [scraping, setScraping] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)

  const handleScrape = async (): Promise<void> => {
    setScraping(true)
    try {
      await syncSource({ projectId: project.id })
    } finally {
      setScraping(false)
    }
  }

  const view = useMemo(() => buildCardView(snapshot, index), [snapshot, index])
  const summary = useMemo(() => buildCardSummary(snapshot, index), [snapshot, index])
  const profiles = useProfileStore((s) => s.profiles)
  const profileName = useMemo(() => {
    const p = profiles.find((prof) => prof.id === project.profileId)
    return p?.customName || p?.displayName || null
  }, [profiles, project.profileId])

  if (!expanded) {
    return (
      <>
        <CompactCard
          summary={summary}
          profileName={profileName}
          onToggle={onToggle}
          onExpandSection={onExpandSection}
          onSync={(id) => void syncNow(id)}
          onScrape={() => void handleScrape()}
          scraping={scraping}
          onSettings={() => onOpenSettings(project.id)}
          onRemove={() => onDelete(project.id)}
          syncing={syncing}
          pinned={pinned}
          onTogglePin={onTogglePin}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
        />
        <RunLogsModal
          open={logsOpen}
          projectId={project.id}
          projectName={project.name}
          onClose={() => setLogsOpen(false)}
        />
      </>
    )
  }

  return (
    <>
      <ExpandedWorkspace
        key={`${project.id}:${initialTab ?? ''}:${tabNonce ?? 0}:${initialGuideSection ?? ''}:${initialDetailKey ?? ''}`}
        view={view}
        summary={summary}
        project={project}
        snapshot={snapshot}
        profileName={profileName}
        syncing={syncing}
        onSync={() => void syncNow(project.id)}
        onScrape={() => void handleScrape()}
        scraping={scraping}
        onLogs={() => setLogsOpen(true)}
        onSettings={() => onOpenSettings(project.id)}
        onEdit={() => openWizard(project.id)}
        onRemove={() => onDelete(project.id)}
        onToggle={onToggle}
        pinned={pinned}
        onTogglePin={onTogglePin}
        initialTab={initialTab}
        initialGuideSection={initialGuideSection}
        initialDetailKey={initialDetailKey}
      />
      <RunLogsModal
        open={logsOpen}
        projectId={project.id}
        projectName={project.name}
        onClose={() => setLogsOpen(false)}
      />
    </>
  )
}

export default memo(ProjectCardInner, (prev, next) => {
  return (
    prev.snapshot.project.id === next.snapshot.project.id &&
    sameProjectForCard(prev.snapshot.project, next.snapshot.project) &&
    prev.snapshot.lastUpdatedAt === next.snapshot.lastUpdatedAt &&
    prev.snapshot.insightUpdatedAt === next.snapshot.insightUpdatedAt &&
    prev.snapshot.syncState === next.snapshot.syncState &&
    prev.snapshot.ourWorkspaceError === next.snapshot.ourWorkspaceError &&
    prev.snapshot.metrics === next.snapshot.metrics &&
    prev.expanded === next.expanded &&
    prev.pinned === next.pinned &&
    prev.pinOrderKey === next.pinOrderKey &&
    prev.pageMode === next.pageMode &&
    prev.canMoveUp === next.canMoveUp &&
    prev.canMoveDown === next.canMoveDown &&
    prev.index === next.index &&
    prev.initialTab === next.initialTab &&
    prev.tabNonce === next.tabNonce &&
    prev.initialGuideSection === next.initialGuideSection &&
    prev.initialDetailKey === next.initialDetailKey
  )
})
