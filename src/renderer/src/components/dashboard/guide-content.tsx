import type React from 'react'
import type { CardLeftSidebar, CardRightSidebar } from './card-view'
import {
  formatDate,
  formatDateTime,
  formatTimeAgo,
  type DetailKey,
  type GuideSectionNumber
} from './guide-model'

function emptyNote(text: string): React.ReactElement {
  return <p className="ws-empty">{text}</p>
}

export function GuideDetailBody({
  data,
  section
}: {
  data: CardLeftSidebar
  section: GuideSectionNumber
}): React.ReactElement {
  switch (section) {
    case 1:
      return (
        <div className="ws-detail-stack">
          <div className="ws-detail-block">
            <span className="ws-label">Project start</span>
            <p>
              {data.startTimeline.startDate
                ? formatDate(data.startTimeline.startDate)
                : 'Not stated in chat'}
              <span className="ws-meta"> ({data.startTimeline.dateBadge})</span>
            </p>
          </div>
          <div className="ws-detail-block">
            <span className="ws-label">Project due</span>
            <p>
              {data.startTimeline.endDate
                ? formatDate(data.startTimeline.endDate)
                : 'Not stated in chat'}
              <span className="ws-meta"> ({data.startTimeline.dateBadge})</span>
            </p>
          </div>
          {data.startTimeline.milestones.length > 0 ? (
            <div className="ws-detail-block">
              <span className="ws-label">Milestones</span>
              <ul className="ws-list">
                {data.startTimeline.milestones.map((m, i) => (
                  <li key={i} className="ws-list-row">
                    <span>{m.label}</span>
                    <span className="ws-meta">{formatDate(m.dateIso)}</span>
                    <span className={`ws-chip ${m.done ? 'is-success' : 'is-warn'}`}>
                      {m.done ? 'Done' : 'Open'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            emptyNote('No milestones found in chat')
          )}
        </div>
      )
    case 2:
      return data.requirements.length ? (
        <ul className="ws-list">
          {data.requirements.map((r, i) => (
            <li key={i} className="ws-card-item">
              <p>{r.text}</p>
              <div className="ws-meta-row">
                {r.sourceFile && <span className="ws-chip is-accent">{r.sourceFile}</span>}
                {r.who && <span className="ws-meta">by {r.who}</span>}
                {r.whenIso && <span className="ws-meta">{formatDateTime(r.whenIso)}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        emptyNote('No requirements found in chat')
      )
    case 3:
      return (
        <div className="ws-detail-stack">
          <div className="ws-detail-block">
            <span className="ws-label">In scope</span>
            {data.scopeDeliverables.inScope.length ? (
              <ul className="ws-list">
                {data.scopeDeliverables.inScope.map((item, i) => (
                  <li key={i} className="ws-card-item">
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              emptyNote('No in-scope items stated')
            )}
          </div>
          <div className="ws-detail-block">
            <span className="ws-label">Out of scope</span>
            {data.scopeDeliverables.outOfScope.length ? (
              <ul className="ws-list">
                {data.scopeDeliverables.outOfScope.map((item, i) => (
                  <li key={i} className="ws-card-item">
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              emptyNote('No out-of-scope items stated')
            )}
          </div>
          <div className="ws-detail-block">
            <span className="ws-label">Deliverables</span>
            {data.scopeDeliverables.deliverables.length ? (
              <ul className="ws-list">
                {data.scopeDeliverables.deliverables.map((d, i) => (
                  <li key={i} className="ws-list-row">
                    <span>{d.name}</span>
                    <span className="ws-chip is-accent">{d.status.replace('-', ' ')}</span>
                  </li>
                ))}
              </ul>
            ) : (
              emptyNote('No deliverables listed')
            )}
          </div>
        </div>
      )
    case 4:
      return data.decisions.length ? (
        <ul className="ws-list">
          {data.decisions.map((d, i) => (
            <li key={i} className="ws-card-item">
              <p>{d.what}</p>
              <div className="ws-meta-row">
                {d.who && <span className="ws-meta">by {d.who}</span>}
                {d.whenIso && <span className="ws-meta">{formatDateTime(d.whenIso)}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        emptyNote('No decisions explicitly agreed in chat')
      )
    case 5:
      return data.commitments.length ? (
        <ul className="ws-list">
          {data.commitments.map((c, i) => (
            <li key={i} className="ws-card-item">
              <p>{c.what}</p>
              <div className="ws-meta-row">
                {c.who && <span className="ws-meta">by {c.who}</span>}
                {c.dueIso && <span className="ws-meta">due {formatDate(c.dueIso)}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        emptyNote('No commitments made in chat')
      )
    case 6:
      return data.files.length ? (
        <ul className="ws-list">
          {data.files.map((f, i) => (
            <li key={i} className="ws-card-item">
              <div className="ws-list-row">
                <strong>{f.name}</strong>
                <span className="ws-chip">{f.type.toUpperCase()}</span>
              </div>
              <div className="ws-meta-row">
                {f.who && <span className="ws-meta">shared by {f.who}</span>}
                {f.whenIso && <span className="ws-meta">{formatDateTime(f.whenIso)}</span>}
                {f.url && (
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="ws-link">
                    Open
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        emptyNote('No files or links shared in this workspace')
      )
    case 7:
      return (
        <div className="ws-detail-stack">
          <div className="ws-detail-block">
            <span className="ws-label">People</span>
            {data.peopleChannels.people.length ? (
              <ul className="ws-list">
                {data.peopleChannels.people.map((p, i) => (
                  <li key={i} className="ws-list-row">
                    <span>{p.name}</span>
                    {p.role && <span className="ws-meta">{p.role}</span>}
                    <span className={`ws-chip ${p.side === 'client' ? 'is-danger' : 'is-success'}`}>
                      {p.side === 'client' ? 'Client' : 'Us'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              emptyNote('No people identified in chat')
            )}
          </div>
          <div className="ws-detail-block">
            <span className="ws-label">Channels</span>
            {data.peopleChannels.channels.length ? (
              <ul className="ws-list">
                {data.peopleChannels.channels.map((c, i) => (
                  <li key={i} className="ws-list-row">
                    <span>#{c.channelName}</span>
                    <span className="ws-meta">{c.messageCount} msgs</span>
                    {c.hasNew ? <span className="ws-chip is-success">new</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              emptyNote('No active channels')
            )}
          </div>
        </div>
      )
  }
}

export function DetailBody({
  data,
  detailKey
}: {
  data: CardRightSidebar
  detailKey: DetailKey
}): React.ReactElement {
  switch (detailKey) {
    case 'needs-reply':
      return (
        <div className="ws-detail-stack">
          {data.needsReplyOpenQuestions.needsReply ? (
            <p className="ws-banner is-danger">
              Needs my reply · {data.needsReplyOpenQuestions.urgency} urgency
            </p>
          ) : (
            <p className="ws-banner is-success">No reply needed from you</p>
          )}
          {data.needsReplyOpenQuestions.lastClientMessage && (
            <div className="ws-card-item">
              <span className="ws-label">Last client message</span>
              <p>“{data.needsReplyOpenQuestions.lastClientMessage.quote}”</p>
              <div className="ws-meta-row">
                <span className="ws-meta">
                  {data.needsReplyOpenQuestions.lastClientMessage.who}
                </span>
                <span className="ws-meta">
                  {formatDateTime(data.needsReplyOpenQuestions.lastClientMessage.whenIso)}
                </span>
              </div>
            </div>
          )}
          {data.needsReplyOpenQuestions.openQuestions.length ? (
            <ul className="ws-list">
              {data.needsReplyOpenQuestions.openQuestions.map((q, i) => (
                <li key={i} className="ws-card-item">
                  ? {q}
                </li>
              ))}
            </ul>
          ) : (
            emptyNote('No open questions')
          )}
        </div>
      )
    case 'blockers':
      return data.blockers.length ? (
        <ul className="ws-list">
          {data.blockers.map((b, i) => (
            <li key={i} className="ws-card-item">
              <p>{b.what}</p>
              <div className="ws-meta-row">
                {b.owner && <span className="ws-meta">owner: {b.owner}</span>}
                {b.sinceIso && <span className="ws-meta">since {formatDate(b.sinceIso)}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        emptyNote('No blockers — work can proceed')
      )
    case 'risks':
      return data.risks.length ? (
        <ul className="ws-list">
          {data.risks.map((r, i) => (
            <li key={i} className="ws-card-item">
              ⚠ {r}
            </li>
          ))}
        </ul>
      ) : (
        emptyNote('No risks identified in chat')
      )
    case 'next-steps':
      return data.nextSteps.length ? (
        <ul className="ws-list">
          {data.nextSteps.map((step, i) => (
            <li key={i} className="ws-card-item">
              → {step}
            </li>
          ))}
        </ul>
      ) : (
        emptyNote('No next steps defined yet')
      )
    case 'mood':
      return (
        <div className="ws-detail-stack">
          <p className="ws-chip is-accent">{data.moodSignals.mood}</p>
          <p>{data.moodSignals.moodReason || 'No mood signal detected'}</p>
          {data.moodSignals.moodQuote ? (
            <blockquote className="ws-quote">“{data.moodSignals.moodQuote}”</blockquote>
          ) : null}
        </div>
      )
    case 'activity':
      return (
        <div className="ws-detail-stack">
          <div className="ws-stat-grid">
            <div className="ws-stat">
              <span className="ws-label">24h</span>
              <strong>{data.activity.messages24h}</strong>
            </div>
            <div className="ws-stat">
              <span className="ws-label">7d</span>
              <strong>{data.activity.messages7d}</strong>
            </div>
            <div className="ws-stat">
              <span className="ws-label">Client</span>
              <strong>{formatTimeAgo(data.activity.lastClientMessage?.whenIso)}</strong>
            </div>
            <div className="ws-stat">
              <span className="ws-label">Me</span>
              <strong>{formatTimeAgo(data.activity.myLastReply?.whenIso)}</strong>
            </div>
          </div>
          {data.activity.lastClientMessage && (
            <div className="ws-card-item">
              <span className="ws-label">Last client message</span>
              <p>“{data.activity.lastClientMessage.quote}”</p>
            </div>
          )}
          {data.activity.myLastReply && (
            <div className="ws-card-item">
              <span className="ws-label">My last reply</span>
              <p>“{data.activity.myLastReply.quote}”</p>
            </div>
          )}
        </div>
      )
    case 'history':
      return data.history.length ? (
        <ul className="ws-list">
          {data.history.map((h, i) => (
            <li key={i} className="ws-card-item">
              <p>
                {h.from} → <strong>{h.to}</strong>
              </p>
              <div className="ws-meta-row">
                <span className="ws-meta">{formatDateTime(h.dateIso)}</span>
                <span className="ws-meta">+{h.msgCount} msgs</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        emptyNote('No status changes recorded yet')
      )
  }
}
