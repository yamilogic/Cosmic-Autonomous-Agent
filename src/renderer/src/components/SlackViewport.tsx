import { useEffect, useRef, useState } from 'react'
import { boundsEqual, createRafThrottle } from '../lib/perf'
import { ScrapeNavbar, type NavbarState, type ScrapeSnippet } from './dashboard/overlay/ScrapeNavbar'
import { useDashboardStore } from '../hooks/useDashboard'

interface SlackViewportProps {
  hasActiveProfile: boolean
  onBoundsChange: (bounds: { x: number; y: number; width: number; height: number }) => void
}

export function SlackViewport({
  hasActiveProfile,
  onBoundsChange
}: SlackViewportProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const last = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const [scrapeState, setScrapeState] = useState<NavbarState>('idle')
  const [workspaceName, setWorkspaceName] = useState<string>('AgentWork')
  const [channelName, setChannelName] = useState<string | undefined>()
  const [progressText, setProgressText] = useState<string | undefined>()
  const [statusText, setStatusText] = useState<string | undefined>()
  const [snippets, setSnippets] = useState<ScrapeSnippet[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const openDashboard = useDashboardStore((s) => s.openDashboard)

  useEffect(() => {
    // Listen to real-time scrape events for the slim ScrapeNavbar
    if (!window.api?.dashboard?.onScrapeEvent) {
      return
    }
    const unsubscribe = window.api.dashboard.onScrapeEvent((event: any) => {
      if (event.type === 'navigate' || event.type === 'status' || event.type === 'read') {
        setScrapeState('reading')
        if (event.channelName) setChannelName(event.channelName)
        if (event.scrollIndex && event.maxScroll) {
          setProgressText(`${event.scrollIndex}/${event.maxScroll}${event.messageCount ? ` · ${event.messageCount} msgs` : ''}`)
        } else if (event.text) {
          setStatusText(event.text)
        }
        if (event.workspaceName) setWorkspaceName(event.workspaceName)
        if (event.snippet) {
          setSnippets((prev) => [
            ...prev,
            {
              sender: event.sender || 'Anonymous',
              snippet: event.snippet,
              channelName: event.channelName,
              ts: event.timestamp || new Date().toISOString()
            }
          ])
        }
      } else if (event.type === 'waiting_for_user') {
        setScrapeState('waiting_for_user')
        setStatusText('Waiting for you (user active)')
      } else if (event.type === 'paused') {
        setScrapeState('paused')
        setStatusText('Paused')
      } else if (event.type === 'challenge' || event.type === 'adapter_broken' || event.type === 'error') {
        setScrapeState('challenge')
        setStatusText(event.text || 'Action required')
      } else if (event.type === 'run_finished') {
        setScrapeState('finished')
        setStatusText('Finished')
        setTimeout(() => {
          setScrapeState('idle')
          setStatusText(undefined)
          setProgressText(undefined)
        }, 5000)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }

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
    const observer = new ResizeObserver(report)
    observer.observe(el)
    window.addEventListener('resize', report)

    return () => {
      publish.cancel()
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [onBoundsChange, scrapeState, collapsed])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden' }}>
      <ScrapeNavbar
        state={scrapeState}
        workspaceName={workspaceName}
        channelName={channelName}
        progressText={progressText}
        statusText={statusText}
        snippets={snippets}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        onPause={() => setScrapeState('paused')}
        onResume={() => setScrapeState('reading')}
        onStop={() => {
          setScrapeState('idle')
          setStatusText(undefined)
        }}
        onBackToDashboard={openDashboard}
      />
      <div className="slack-viewport" ref={ref} data-testid="slack-viewport" style={{ flex: 1, position: 'relative', width: '100%' }}>
        {!hasActiveProfile ? (
          <div className="viewport-placeholder">
            <h1>Embed</h1>
            <p>Select Slack, Teams, or WhatsApp under a profile.</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
