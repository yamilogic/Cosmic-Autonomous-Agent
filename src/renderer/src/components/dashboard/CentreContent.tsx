import type React from 'react'
import type { CardCentre } from './card-view'

interface CentreContentProps {
  centre: CardCentre
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const today = new Date()
    const sameDay = d.toDateString() === today.toDateString()
    return sameDay
      ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export default function CentreContent({ centre }: CentreContentProps): React.ReactElement {
  return (
    <div className="centre-stack">
      <section className="centre-section">
        <h4 className="centre-label">Summary</h4>
        {centre.situationLine && (
          <p className="centre-situation" data-testid="dash-situation">
            {centre.situationLine}
          </p>
        )}
        {centre.recentLine && (
          <p className="centre-recent" data-testid="dash-recent-line">
            <span className="centre-recent-key">Just changed</span>
            {centre.recentLine}
          </p>
        )}
        {centre.nextStep && (
          <div className="centre-next" data-testid="dash-next-step">
            <span className="centre-next-label">Next step</span>
            <p className="centre-next-text">{centre.nextStep}</p>
          </div>
        )}
      </section>

      {centre.highlights.length > 0 && (
        <section className="centre-section">
          <h4 className="centre-label">Highlights</h4>
          <ul className="centre-highlights">
            {centre.highlights.slice(0, 3).map((h, i) => {
              const meta = [h.who, h.whenIso ? formatTime(h.whenIso) : null].filter(Boolean).join(', ')
              return (
                <li key={i} className="centre-highlight">
                  <span className="centre-highlight-what">{h.what}</span>
                  {meta ? <span className="centre-highlight-meta">{meta}</span> : null}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="centre-section">
        <div className="centre-section-head">
          <h4 className="centre-label">Last client message</h4>
          {centre.needsReply && (
            <span className="centre-reply">
              <span className="centre-flag">Needs my reply</span>
              <span className="centre-urgency">{centre.urgency} urgency</span>
            </span>
          )}
        </div>
        {centre.lastClientMessage ? (
          <>
            <p className="centre-quote">“{centre.lastClientMessage.quote}”</p>
            <p className="centre-meta">
              {centre.lastClientMessage.who}, {formatTime(centre.lastClientMessage.whenIso)}
            </p>
            {centre.openQuestions.length > 0 && (
              <ul className="centre-questions">
                {centre.openQuestions.slice(0, 3).map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="centre-empty">No client message yet</p>
        )}
      </section>
    </div>
  )
}
