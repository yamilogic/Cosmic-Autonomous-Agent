import { useEffect, useRef } from 'react'
import { boundsEqual, createRafThrottle } from '../lib/perf'

export type AuthChromePhase = 'google' | 'slack' | 'teams' | 'viewing-slack' | 'viewing-teams'

interface AuthChromePaneProps {
  phase: AuthChromePhase
  onBoundsChange: (bounds: { x: number; y: number; width: number; height: number }) => void
  onCancel: () => void
}

/**
 * Right-column dock plane — matches Slack Native DockPlaneView.
 * Chrome sits over this full pane; Cancel/Close only (cookie poll auto-confirms auth).
 */
export function AuthChromePane({
  phase,
  onBoundsChange,
  onCancel
}: AuthChromePaneProps): React.JSX.Element {
  const dockRef = useRef<HTMLDivElement>(null)
  const last = useRef<{ x: number; y: number; width: number; height: number } | null>(null)

  useEffect(() => {
    const el = dockRef.current
    if (!el) return

    const publish = createRafThrottle(
      (bounds: { x: number; y: number; width: number; height: number }) => {
        if (boundsEqual(last.current, bounds)) return
        last.current = bounds
        onBoundsChange(bounds)
      }
    )

    const report = (): void => {
      const rect = el.getBoundingClientRect()
      publish({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
    }

    report()
    // Report again after layout settles (maximize / first paint).
    const t1 = window.setTimeout(report, 50)
    const t2 = window.setTimeout(report, 200)
    const observer = new ResizeObserver(report)
    observer.observe(el)
    window.addEventListener('resize', report)
    return () => {
      publish.cancel()
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [onBoundsChange])

  const viewing = phase === 'viewing-slack' || phase === 'viewing-teams'
  const title =
    phase === 'google'
      ? 'Google sign-in'
      : phase === 'slack'
        ? 'Slack sign-in'
        : phase === 'teams'
          ? 'Teams sign-in'
          : phase === 'viewing-teams'
            ? 'Teams (Chrome)'
            : 'Slack (Chrome)'

  const hint =
    phase === 'google'
      ? 'Google Chrome overlays this right pane (same size) for password + 2SV. It closes when Google is done.'
      : phase === 'slack'
        ? 'Same Chrome profile overlays this pane for Slack sign-in — then Slack embeds here.'
        : phase === 'teams'
          ? 'Sign in with Microsoft in the Chrome overlay on this pane.'
          : 'Loading…'

  return (
    <div className="dock-plane" data-testid="slack-viewport" ref={dockRef} data-auth-chrome-pane>
      <div className="dock-plane-inner">
        <div className="dock-plane-spinner" aria-hidden />
        <h2 className="dock-plane-title">{title}</h2>
        <p className="dock-plane-hint">{hint}</p>
        <button type="button" className="btn secondary" onClick={onCancel}>
          {viewing ? 'Close' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}
