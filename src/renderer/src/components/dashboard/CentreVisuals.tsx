import type React from 'react'
import type { CardCentreVisuals } from './card-view'
import type { VisualKey } from './workspace-nav'

interface CentreVisualsProps {
  visuals: CardCentreVisuals
  /** Render a single chart large; omit to render the full stacked set. */
  only?: VisualKey
}

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export default function CentreVisuals({ visuals, only }: CentreVisualsProps): React.ReactElement {
  const { progressPercent, timeElapsed, sevenDayBars } = visuals

  const maxBarCount = Math.max(...sevenDayBars.map(b => b.count), 1)
  const donutSize = only === 'progress' ? 180 : 120
  const strokeWidth = 8
  const radius = (donutSize - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - progressPercent / 100)

  const showProgress = !only || only === 'progress'
  const showTime = !only || only === 'time'
  const showWeek = !only || only === 'week'

  return (
    <div className={`dash-centre-visuals${only ? ' is-single' : ''} space-y-4 p-4`}>
      {/* Row 1: Progress Donut + Time Elapsed */}
      {(showProgress || showTime) && (
      <div className="dash-at-a-glance">
        {/* Progress Donut */}
        {showProgress && (
        <div className="dash-panel dash-visuals-panel dash-donut-panel flex items-center justify-center">
          <div className="dash-donut-wrapper relative" style={{ width: donutSize, height: donutSize }}>
            <svg width={donutSize} height={donutSize} className="dash-donut-svg" role="img" aria-label={`Progress ${progressPercent}%`} style={{ transform: 'rotate(-90deg)' }}>
              <circle
                className="dash-donut-bg"
                cx={donutSize / 2}
                cy={donutSize / 2}
                r={radius}
                strokeWidth={strokeWidth}
                fill="none"
                stroke="currentColor"
                style={{ opacity: 0.15 }}
              />
              <circle
                className="dash-donut-progress"
                cx={donutSize / 2}
                cy={donutSize / 2}
                r={radius}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                fill="none"
                strokeLinecap="round"
                style={{ 
                  stroke: 'var(--accent)',
                  transformOrigin: 'center',
                  transition: 'stroke-dashoffset 0.6s ease'
                }}
              />
            </svg>
            <div className="dash-donut-center absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="dash-donut-percent text-3xl font-bold text-text-dark leading-none">{progressPercent}%</span>
              <span className="dash-donut-label text-xs text-muted-dark mt-1">Progress</span>
            </div>
          </div>
        </div>
        )}

        {/* Time Elapsed Bars */}
        {showTime && (
        <div className="dash-panel dash-visuals-panel dash-time-panel">
          <div className="dash-visuals-panel-title text-xs font-semibold text-muted-dark mb-3">Time elapsed</div>
          {timeElapsed.hasDates ? (
            <>
              <div className="dash-time-bars space-y-3">
                <div className="dash-time-bar-row flex items-center gap-3">
                  <div className="dash-time-bar-track flex-1 h-3.5 bg-border-dark rounded-full overflow-hidden relative">
                    <div
                      className="dash-time-bar-fill dash-time-bar-work h-full rounded-full"
                      style={{ 
                        width: `${Math.min(100, timeElapsed.progressPercent ?? 0)}%`,
                        background: 'var(--accent)'
                      }}
                    />
                  </div>
                  <span className="dash-time-bar-label w-20 text-xs text-muted-dark text-right">Work done</span>
                </div>
                <div className="dash-time-bar-row flex items-center gap-3">
                  <div className="dash-time-bar-track flex-1 h-3.5 bg-border-dark rounded-full overflow-hidden relative">
                    <div
                      className="dash-time-bar-fill dash-time-bar-time h-full rounded-full"
                      style={{ 
                        width: `${timeElapsed.totalDays && timeElapsed.daysUsed
                          ? Math.min(100, (timeElapsed.daysUsed / timeElapsed.totalDays) * 100)
                          : 0}%`,
                        background: 'var(--text-faint)'
                      }}
                    />
                  </div>
                  <span className="dash-time-bar-label w-20 text-xs text-muted-dark text-right">Time used</span>
                </div>
              </div>
              <div className="dash-time-meta flex justify-between mt-2 text-xs text-muted-dark">
                <span className="dash-time-date">{formatDateShort(timeElapsed.startDate!)}</span>
                <span className="dash-time-date">{formatDateShort(timeElapsed.endDate!)}</span>
              </div>
              <div className="dash-time-summary mt-2 text-sm font-medium text-text-dark">
                {timeElapsed.daysUsed} of {timeElapsed.totalDays} days used, {timeElapsed.daysLeft} days left
              </div>
              <div className={`dash-pace-verdict mt-2 px-3 py-2 rounded-lg text-xs font-semibold text-center ${
                timeElapsed.pace === 'behind'
                  ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                  : timeElapsed.pace === 'ahead'
                    ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                    : 'bg-gray-500/15 text-gray-400 border border-gray-500/30'
              }`}>
                {timeElapsed.paceLabel}
              </div>
            </>
          ) : (
            <div className="dash-time-no-dates flex flex-col items-center justify-center gap-3 p-4 text-center text-muted-dark">
              <p>Dates not stated in chat</p>
              <button type="button" className="px-3 py-1.5 text-sm font-semibold border border-accent rounded-lg bg-transparent text-accent hover:bg-accent/10 transition-colors cursor-pointer">
                Add dates
              </button>
            </div>
          )}
        </div>
        )}
      </div>
      )}

      {/* Row 2: Last 7 Days Activity Bars */}
      {showWeek && (
      <div className="dash-visuals-row dash-visuals-row-bottom">
        <div className="dash-panel dash-visuals-panel dash-activity-panel">
          <div className="dash-visuals-panel-title text-xs font-semibold text-muted-dark mb-3">Last 7 days</div>
          <div className="dash-activity-bars flex items-end gap-2 px-1" style={{ height: only === 'week' ? "160px" : "70px" }} role="img" aria-label="Messages per day for the last 7 days">
            {sevenDayBars.map((bar, i) => {
              const scale = only === 'week' ? 120 : 34
              const barHeight = `${Math.round((bar.count / Math.max(maxBarCount, 1)) * scale) + 3}px`
              const barColor = bar.isToday ? 'var(--accent)' : 'var(--text-muted)'
              return (
                <div
                  key={i}
                  className={`dash-activity-bar flex-1 flex flex-col-reverse items-center gap-1.5 ${bar.isToday ? 'is-today' : ''}`}
                  style={{ '--bar-height': barHeight } as React.CSSProperties}
                  title={`${formatDateShort(bar.date)}: ${bar.count} messages`}
                >
                  <div className="dash-activity-bar-fill w-full rounded-t" style={{ height: barHeight, background: bar.isToday ? 'var(--accent)' : 'var(--text-faint)' } as React.CSSProperties} />
                  <span className="dash-activity-bar-date text-xs text-muted-dark">
                    {bar.isToday ? 'T' : new Date(bar.date).toLocaleDateString(undefined, { weekday: 'narrow' })}
                  </span>
                  {bar.count > 0 && <span className="dash-activity-bar-count text-xs font-semibold" style={{ color: barColor } as React.CSSProperties}>{bar.count}</span>}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      )}
    </div>
  )
}