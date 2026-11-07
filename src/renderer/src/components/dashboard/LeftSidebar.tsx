import type React from 'react'
import { useMemo } from 'react'
import AccordionSidebar, { SidebarSection } from './AccordionSection'
import type { CardLeftSidebar } from './card-view'

interface LeftSidebarProps {
  data: CardLeftSidebar
  projectId: string
  onSectionChange?: (section: number | null) => void
  onWidthChange?: (width: number) => void
  onCollapseChange?: (collapsed: boolean) => void
}

function formatDate(iso?: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function getStatusClass(status: string): string {
  switch (status) {
    case 'done': return 'bg-green-500/15 text-green-400 border-green-500/30'
    case 'in-progress': return 'bg-purple-500/15 text-purple-400 border-purple-500/30'
    case 'pending': return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
    case 'not-started': return 'bg-gray-500/15 text-gray-400 border-gray-500/30'
    default: return 'bg-gray-500/15 text-gray-400 border-gray-500/30'
  }
}

function getFileTypeIcon(type: string): string {
  switch (type) {
    case 'pdf': return '📄'
    case 'docx': return '📝'
    case 'link': return '🔗'
    case 'image': return '🖼️'
    default: return '📎'
  }
}

function getFileTypeLabel(type: string): string {
  return type.toUpperCase()
}

function getMilestoneStatusLabel(done: boolean): string {
  return done ? 'Done' : 'Open'
}

function getMilestoneStatusClass(done: boolean): string {
  return done
    ? 'bg-green-500/15 text-green-400 border-green-500/30'
    : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
}

export default function LeftSidebar({
  data,
  projectId,
  onSectionChange,
  onWidthChange,
  onCollapseChange
}: LeftSidebarProps): React.ReactElement {
  const sections = useMemo<SidebarSection[]>(() => [
    {
      number: 1,
      title: 'Start & Timeline',
      hint: data.startTimeline.startDate || data.startTimeline.endDate
        ? `${formatDate(data.startTimeline.startDate)} → ${formatDate(data.startTimeline.endDate)} (${data.startTimeline.dateBadge})`
        : 'Dates not stated in chat',
      content: (
        <div className="space-y-4">
          <div className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-dark block">Project Start</span>
            <span className="text-sm text-text-dark">
              {data.startTimeline.startDate ? formatDate(data.startTimeline.startDate) : '—'}
              <span className="text-xs text-muted-dark italic ml-1"> ({data.startTimeline.dateBadge})</span>
            </span>
          </div>
          <div className="space-y-1 pt-2 border-t border-border-dark/50">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-dark block">Due Date</span>
            <span className="text-sm text-text-dark">
              {data.startTimeline.endDate ? formatDate(data.startTimeline.endDate) : '—'}
              <span className="text-xs text-muted-dark italic ml-1"> ({data.startTimeline.dateBadge})</span>
            </span>
          </div>
          {data.startTimeline.milestones.length > 0 ? (
            <div className="pt-2 border-t border-border-dark/50 space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-dark block">Milestones</span>
              <ul className="space-y-2">
                {data.startTimeline.milestones.map((m, i) => (
                  <li key={i} className="flex items-center gap-3 p-2 bg-surface-2-dark border border-border-dark rounded-lg">
                    <span className="flex-1 text-sm font-medium text-text-dark">{m.label}</span>
                    <span className="text-xs text-muted-dark whitespace-nowrap">{formatDate(m.dateIso)}</span>
                    <span className={`dash-chip px-2 py-0.5 rounded-full text-xs font-medium border ${getMilestoneStatusClass(m.done)}`}>
                      {getMilestoneStatusLabel(m.done)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-dark italic pt-2 border-t border-border-dark/50">No milestones found in chat</p>
          )}
        </div>
      ),
      isEmpty: !data.startTimeline.startDate && !data.startTimeline.endDate && data.startTimeline.milestones.length === 0
    },
    {
      number: 2,
      title: 'Client Requirements',
      hint: data.requirements.length > 0
        ? `${data.requirements.length} requirement${data.requirements.length !== 1 ? 's' : ''}`
        : 'No requirements found in chat',
      content: (
        <div className="space-y-3">
          {data.requirements.length > 0 ? (
            <ul className="space-y-3">
              {data.requirements.map((r, i) => (
                <li key={i} className="p-3 bg-surface-2-dark border border-border-dark rounded-lg space-y-2">
                  <p className="text-sm text-text-dark leading-relaxed">{r.text}</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {r.sourceFile && (
                      <span className="dash-chip px-2 py-0.5 rounded-full text-xs font-medium border bg-purple-500/15 text-purple-400 border-purple-500/30">
                        📄 {r.sourceFile}
                      </span>
                    )}
                    {r.who && (
                      <span className="text-muted-dark">by {r.who}</span>
                    )}
                    {r.whenIso && (
                      <span className="text-muted-dark">{formatDateTime(r.whenIso)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-dark italic">No client requirements explicitly stated in chat or files</p>
          )}
        </div>
      ),
      isEmpty: data.requirements.length === 0
    },
    {
      number: 3,
      title: 'Scope & Deliverables',
      hint: data.scopeDeliverables.inScope.length + data.scopeDeliverables.outOfScope.length + data.scopeDeliverables.deliverables.length > 0
        ? `${data.scopeDeliverables.inScope.length} in • ${data.scopeDeliverables.outOfScope.length} out • ${data.scopeDeliverables.deliverables.length} deliverable${data.scopeDeliverables.deliverables.length !== 1 ? 's' : ''}`
        : 'Scope not discussed in chat',
      content: (
        <div className="space-y-4">
          {data.scopeDeliverables.inScope.length > 0 ? (
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-dark block">In Scope</span>
              <ul className="space-y-1">
                {data.scopeDeliverables.inScope.map((item, i) => (
                  <li key={i} className="px-3 py-2 bg-surface-2-dark border border-border-dark rounded text-sm text-text-dark">{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-dark italic">No in-scope items stated</p>
          )}
          {data.scopeDeliverables.outOfScope.length > 0 ? (
            <div className="pt-2 border-t border-border-dark/50 space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-dark block">Out of Scope</span>
              <ul className="space-y-1">
                {data.scopeDeliverables.outOfScope.map((item, i) => (
                  <li key={i} className="px-3 py-2 bg-surface-2-dark border border-border-dark rounded text-sm text-text-dark">{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-dark italic pt-2 border-t border-border-dark/50">No out-of-scope items stated</p>
          )}
          {data.scopeDeliverables.deliverables.length > 0 ? (
            <div className="pt-2 border-t border-border-dark/50 space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-dark block">Deliverables</span>
              <ul className="space-y-2">
                {data.scopeDeliverables.deliverables.map((d, i) => (
                  <li key={i} className="flex items-center justify-between p-2 bg-surface-2-dark border border-border-dark rounded">
                    <span className="text-sm text-text-dark truncate">{d.name}</span>
                    <span className={`dash-chip px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusClass(d.status)}`}>
                      {d.status.replace('-', ' ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-dark italic pt-2 border-t border-border-dark/50">No deliverables listed</p>
          )}
        </div>
      ),
      isEmpty: data.scopeDeliverables.inScope.length === 0 &&
               data.scopeDeliverables.outOfScope.length === 0 &&
               data.scopeDeliverables.deliverables.length === 0
    },
    {
      number: 4,
      title: 'Decisions',
      hint: data.decisions.length > 0
        ? `${data.decisions.length} decision${data.decisions.length !== 1 ? 's' : ''}`
        : 'No decisions recorded in chat',
      content: (
        <div className="space-y-3">
          {data.decisions.length > 0 ? (
            <ul className="space-y-3">
              {data.decisions.map((d, i) => (
                <li key={i} className="p-3 bg-surface-2-dark border border-border-dark rounded-lg space-y-1">
                  <p className="text-sm text-text-dark">{d.what}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-dark">
                    {d.who && <span>by {d.who}</span>}
                    {d.whenIso && <span>{formatDateTime(d.whenIso)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-dark italic">No decisions explicitly agreed in chat</p>
          )}
        </div>
      ),
      isEmpty: data.decisions.length === 0
    },
    {
      number: 5,
      title: 'Commitments',
      hint: data.commitments.length > 0
        ? `${data.commitments.length} commitment${data.commitments.length !== 1 ? 's' : ''}`
        : 'No commitments found in chat',
      content: (
        <div className="space-y-3">
          {data.commitments.length > 0 ? (
            <ul className="space-y-3">
              {data.commitments.map((c, i) => (
                <li key={i} className="p-3 bg-surface-2-dark border border-border-dark rounded-lg space-y-1">
                  <p className="text-sm text-text-dark">{c.what}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-dark">
                    {c.who && <span>by {c.who}</span>}
                    {c.dueIso && <span>due {formatDate(c.dueIso)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-dark italic">No commitments made in chat</p>
          )}
        </div>
      ),
      isEmpty: data.commitments.length === 0
    },
    {
      number: 6,
      title: 'Files & Links',
      hint: data.files.length > 0
        ? `${data.files.length} file${data.files.length !== 1 ? 's' : ''}`
        : 'No files shared in this workspace',
      content: (
        <div className="space-y-3">
          {data.files.length > 0 ? (
            <ul className="space-y-3">
              {data.files.map((f, i) => (
                <li key={i} className="p-3 bg-surface-2-dark border border-border-dark rounded-lg space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{getFileTypeIcon(f.type)}</span>
                    <span className="flex-1 font-medium text-sm text-text-dark truncate">{f.name}</span>
                    <span className="px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider text-muted-dark bg-surface-dark border border-border-dark">
                      {getFileTypeLabel(f.type)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-dark">
                    {f.who && <span>shared by {f.who}</span>}
                    {f.whenIso && <span>{formatDateTime(f.whenIso)}</span>}
                    {f.url && (
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline font-medium">
                        Open
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-dark italic">No files or links shared in this workspace</p>
          )}
        </div>
      ),
      isEmpty: data.files.length === 0
    },
    {
      number: 7,
      title: 'People & Channels',
      hint: data.peopleChannels.people.length + data.peopleChannels.channels.length > 0
        ? `${data.peopleChannels.people.length} people • ${data.peopleChannels.channels.length} active channel${data.peopleChannels.channels.length !== 1 ? 's' : ''}${data.peopleChannels.quietChannelCount > 0 ? ` • +${data.peopleChannels.quietChannelCount} quiet` : ''}`
        : 'No people or channels found',
      content: (
        <div className="space-y-4">
          {data.peopleChannels.people.length > 0 ? (
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-dark block">People</span>
              <ul className="space-y-2">
                {data.peopleChannels.people.map((p, i) => (
                  <li key={i} className="flex items-center gap-3 p-2 bg-surface-2-dark border border-border-dark rounded">
                    <span className="text-xl w-6 text-center">{p.side === 'client' ? '👤' : '👥'}</span>
                    <span className="flex-1 font-medium text-sm text-text-dark truncate">{p.name}</span>
                    {p.role && <span className="text-xs text-muted-dark">{p.role}</span>}
                    <span className={`dash-chip px-2 py-0.5 rounded-full text-xs font-medium border ${
                      p.side === 'client'
                        ? 'bg-red-500/15 text-red-400 border-red-500/30'
                        : 'bg-green-500/15 text-green-400 border-green-500/30'
                    }`}>
                      {p.side === 'client' ? 'Client' : 'Us'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-dark italic">No people identified in chat</p>
          )}

          <div className="pt-2 border-t border-border-dark/50 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-dark">Channels</span>
              {data.peopleChannels.quietChannelCount > 0 && (
                <span className="text-xs text-muted-dark">(+{data.peopleChannels.quietChannelCount} quiet)</span>
              )}
            </div>
            {data.peopleChannels.channels.length > 0 ? (
              <ul className="space-y-1">
                {data.peopleChannels.channels.map((c, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-2 bg-surface-2-dark border border-border-dark rounded">
                    <span className="text-sm font-medium text-text-dark">#{c.channelName}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-dark">{c.messageCount} msgs</span>
                      {c.hasNew && (
                        <span className="dash-chip px-2 py-0.5 rounded-full text-xs font-medium border bg-green-500/15 text-green-400 border-green-500/30">
                          +{c.hasNew}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-dark italic">No active channels</p>
            )}
            {data.peopleChannels.quietChannelCount > 0 && (
              <p className="text-xs text-muted-dark italic">+{data.peopleChannels.quietChannelCount} quiet channels (no messages)</p>
            )}
          </div>
        </div>
      ),
      isEmpty: data.peopleChannels.people.length === 0 && data.peopleChannels.channels.length === 0
    }
  ], [data])

  return (
    <AccordionSidebar
      sections={sections}
      sidebarId="left"
      projectId={projectId}
      onSectionChange={onSectionChange}
      onWidthChange={onWidthChange}
      onCollapseChange={onCollapseChange}
    />
  )
}