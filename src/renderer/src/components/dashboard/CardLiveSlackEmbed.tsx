import { useEffect, useRef, useState } from 'react'

interface CardLiveSlackEmbedProps {
  projectId?: string
  profileId: string
  teamId?: string
  appId?: 'slack' | 'teams' | 'whatsapp'
  hidden?: boolean
}

interface ScrapeEventState {
  channelName?: string
  scrollIndex?: number
  maxScroll?: number
  messageCount?: number
  status?: 'reading' | 'idle' | 'finished'
}

/**
 * Embeds a real, interactive Slack desktop WebContentsView directly
 * inside the project card container. Uses ResizeObserver to automatically
 * sync pixel-exact bounding box with Electron main process on every resize/movement.
 */
export default function CardLiveSlackEmbed({
  projectId,
  profileId,
  teamId,
  appId = 'slack',
  hidden = false
}: CardLiveSlackEmbedProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const embedRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [lineVisible, setLineVisible] = useState(true)
  const [scrapeEvent, setScrapeEvent] = useState<ScrapeEventState>({ status: 'idle' })

  // Listen to global settings for showScrapeProgressLine toggle
  useEffect(() => {
    void window.api?.app?.getSettings?.().then((settings) => {
      if (typeof settings?.showScrapeProgressLine === 'boolean') {
        setLineVisible(settings.showScrapeProgressLine)
      }
    })
    const unsub = window.api?.app?.onSettingsChanged?.((settings) => {
      if (typeof settings?.showScrapeProgressLine === 'boolean') {
        setLineVisible(settings.showScrapeProgressLine)
      }
    })
    return () => {
      unsub?.()
    }
  }, [])

  // Listen for live scrape events
  useEffect(() => {
    if (!window.api?.dashboard?.onScrapeEvent) return undefined
    const unsubscribe = window.api.dashboard.onScrapeEvent((event: any) => {
      if (event?.type === 'navigate' || event?.type === 'status' || event?.type === 'read') {
        setScrapeEvent({
          status: 'reading',
          channelName: event.channelName,
          scrollIndex: event.scrollIndex,
          maxScroll: event.maxScroll,
          messageCount: event.messageCount
        })
      } else if (event?.type === 'run_finished') {
        setScrapeEvent({ status: 'finished' })
        setTimeout(() => setScrapeEvent({ status: 'idle' }), 3000)
      }
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (hidden) {
      void window.api.profiles.clearCardSlackEmbed()
      void window.api.profiles.setEmbedVisible(false)
      return undefined
    }

    const el = embedRef.current ?? containerRef.current
    if (!el) return

    let cancelled = false
    let animFrameId: number | null = null
    const lastBoundsRef = { current: null as { x: number; y: number; width: number; height: number } | null }

    const sendBounds = () => {
      if (cancelled) return
      const targetEl = embedRef.current ?? containerRef.current
      if (!targetEl) return
      const rect = targetEl.getBoundingClientRect()
      if (rect.width >= 20 && rect.height >= 20) {
        const bounds = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
        const last = lastBoundsRef.current
        if (
          !last ||
          last.x !== bounds.x ||
          last.y !== bounds.y ||
          last.width !== bounds.width ||
          last.height !== bounds.height
        ) {
          lastBoundsRef.current = bounds
          void window.api.profiles.updateCardSlackEmbedBounds(bounds)
        }
      }
    }

    const startTrackingLoop = (durationMs = 450) => {
      const startTime = performance.now()
      const step = (now: number) => {
        if (cancelled) return
        sendBounds()
        if (now - startTime < durationMs) {
          animFrameId = requestAnimationFrame(step)
        }
      }
      if (animFrameId) cancelAnimationFrame(animFrameId)
      animFrameId = requestAnimationFrame(step)
    }

    // Initial mount and activation
    const rect = el.getBoundingClientRect()
    const initialBounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
    lastBoundsRef.current = initialBounds

    void window.api.profiles
      .activateCardSlackEmbed({
        projectId,
        profileId,
        teamId: teamId ?? '',
        appId,
        bounds: initialBounds
      })
      .then(() => {
        if (!cancelled) {
          setLoading(false)
          startTrackingLoop(400)
        }
      })
      .catch((err) => {
        console.error('Failed to activate CardLiveSlackEmbed', err)
      })

    const ro = new ResizeObserver(() => {
      sendBounds()
    })
    ro.observe(el)
    if (document.body) {
      ro.observe(document.body)
    }

    const onResizeOrLayout = () => startTrackingLoop(400)
    const onTransitionEnd = () => startTrackingLoop(150)

    window.addEventListener('resize', onResizeOrLayout)
    window.addEventListener('scroll', sendBounds, true)
    window.addEventListener('layout-bounds-change', onResizeOrLayout)
    document.addEventListener('transitionrun', onResizeOrLayout)
    document.addEventListener('transitionstart', onResizeOrLayout)
    document.addEventListener('transitionend', onTransitionEnd)
    document.addEventListener('animationstart', onResizeOrLayout)
    document.addEventListener('animationend', onTransitionEnd)

    const unsubSettings = window.api?.app?.onSettingsChanged?.(() => {
      startTrackingLoop(450)
    })

    return () => {
      cancelled = true
      if (animFrameId) cancelAnimationFrame(animFrameId)
      ro.disconnect()
      unsubSettings?.()
      window.removeEventListener('resize', onResizeOrLayout)
      window.removeEventListener('scroll', sendBounds, true)
      window.removeEventListener('layout-bounds-change', onResizeOrLayout)
      document.removeEventListener('transitionrun', onResizeOrLayout)
      document.removeEventListener('transitionstart', onResizeOrLayout)
      document.removeEventListener('transitionend', onTransitionEnd)
      document.removeEventListener('animationstart', onResizeOrLayout)
      document.removeEventListener('animationend', onTransitionEnd)
      void window.api.profiles.clearCardSlackEmbed()
    }
  }, [projectId, profileId, teamId, appId, hidden])

  const isScrapingActive = appId === 'slack' && scrapeEvent.status === 'reading' && lineVisible

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        flex: '1 1 0%',
        position: 'relative',
        background: 'var(--bg-page)',
        borderRadius: 0,
        overflow: 'hidden',
        display: hidden ? 'none' : 'flex',
        flexDirection: 'column',
        visibility: hidden ? 'hidden' : 'visible'
      }}
    >
      {isScrapingActive && (
        <div
          data-testid="in-card-scrape-bar"
          style={{
            height: 24,
            minHeight: 24,
            maxHeight: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 12px',
            background: 'linear-gradient(90deg, #1e1026 0%, #15181c 100%)',
            borderBottom: '1px solid rgba(74, 222, 128, 0.25)',
            fontSize: 11,
            color: '#e2e8f0',
            width: '100%',
            boxSizing: 'border-box',
            flexShrink: 0,
            zIndex: 10
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 6px #22c55e',
                flexShrink: 0
              }}
            />
            <span style={{ fontWeight: 600, color: '#4ade80' }}>
              {scrapeEvent.channelName ? `#${scrapeEvent.channelName}` : 'Scraping channels...'}
            </span>
            <span style={{ color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {scrapeEvent.scrollIndex && scrapeEvent.maxScroll
                ? ` · scroll ${scrapeEvent.scrollIndex}/${scrapeEvent.maxScroll}`
                : ''}
              {scrapeEvent.messageCount !== undefined
                ? ` · ${scrapeEvent.messageCount} msgs found`
                : ''}
            </span>
          </div>
          <span style={{ fontSize: 10, color: '#64748b', flexShrink: 0, marginLeft: 8 }}>
            Scraping public, private & DMs (1h)
          </span>
        </div>
      )}

      <div
        ref={embedRef}
        style={{
          width: '100%',
          flex: '1 1 0%',
          height: '100%',
          minHeight: 0,
          position: 'relative',
          background: 'var(--bg-page)',
          overflow: 'hidden'
        }}
      >
        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              color: '#94a3b8',
              fontSize: 13,
              background: 'var(--bg-page)'
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                border: '2px solid rgba(255,255,255,0.2)',
                borderTopColor: '#6366f1',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }}
            />
            <span>
              {appId === 'teams'
                ? 'Connecting Microsoft Teams...'
                : appId === 'whatsapp'
                  ? 'Loading WhatsApp Web...'
                  : 'Connecting Live Slack...'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
