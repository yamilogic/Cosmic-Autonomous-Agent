import React, { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DashboardProjectChatErrorCode,
  DashboardProjectChatMessage,
  DashboardProjectChatSourceRef,
  DashboardProjectChatStatus
} from '../../../../shared/dashboard-contract'
import ChatMarkdown from './ChatMarkdown'
import type { XomniModeKey } from './workspace-nav'

interface AgentChatPanelProps {
  projectName: string
  projectId: string
  mode: XomniModeKey
  /** Optional question handed to the project chat on mount. */
  initialQuestion?: string | null
  onConsumeInitial?: () => void
  onOpenSettings?: () => void
  onOpenControl?: (sourceId?: string) => void
  onOpenSource?: (ref: DashboardProjectChatSourceRef) => void
}

type RetryMode = 'append' | 'retry' | 'none'

interface ChatFailure {
  message: string
  retryable: boolean
  mode: RetryMode
  question: string
}

function parseActionCard(content: string): {
  cleanContent: string
  card: { type: string; ok: boolean; data?: any } | null
  rawAction?: { action: string; [key: string]: any } | null
} {
  let card: { type: string; ok: boolean; data?: any } | null = null
  let rawAction: { action: string; [key: string]: any } | null = null

  // 1. Match <!-- ACTION_CARD: ... --> or <!-- ACTIONCARD: ... -->
  const cardMatch = content.match(/<!--\s*ACTION_?CARD:\s*([\s\S]*?)\s*-->/i)
  if (cardMatch) {
    try {
      card = JSON.parse(cardMatch[1])
    } catch {
      card = null
    }
  }

  // Strip all ACTION_CARD comments
  let cleanContent = content.replace(/<!--\s*ACTION_?CARD:\s*[\s\S]*?\s*-->/gi, '').trim()

  // 2. Detect raw action JSON: {"action": "send_slack", ...} or ```action ... ``` or ```json {"action": ...}
  const actionJsonMatch =
    cleanContent.match(/```(?:action|json)?\s*(\{\s*"action"[\s\S]*?\})\s*```/i) ||
    cleanContent.match(/(\{\s*"action"\s*:\s*"[^"]+"[\s\S]*?\})/)

  if (actionJsonMatch) {
    try {
      rawAction = JSON.parse(actionJsonMatch[1])
      // Remove raw JSON from clean content so it does not clutter the bubble
      cleanContent = cleanContent.replace(actionJsonMatch[0], '').trim()
    } catch {
      rawAction = null
    }
  }

  return { cleanContent, card, rawAction }
}

function ActionCard({
  card,
  onOpenControl
}: {
  card: { type: string; ok: boolean; data?: any }
  onOpenControl?: () => void
}): React.ReactElement | null {
  if (card.type === 'permission_denied') {
    const lockedNames = card.data?.lockedChannels
      ? card.data.lockedChannels.map((c: any) => `#${c.name}`).join(', ')
      : `#${card.data?.channelName}`

    return (
      <div
        style={{
          marginTop: 10,
          padding: '12px 14px',
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.35)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#fcd34d', fontWeight: 600, fontSize: 13 }}>
          <span>⚠️</span>
          <span>Agent Write Permission Required</span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Channel/contact <strong style={{ color: 'var(--text)' }}>{lockedNames}</strong> is not authorized for autonomous posting.
        </p>
        {onOpenControl ? (
          <button
            type="button"
            onClick={onOpenControl}
            style={{
              alignSelf: 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(245, 158, 11, 0.2)',
              border: '1px solid rgba(245, 158, 11, 0.5)',
              color: '#fbbf24',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <span>⚙️</span>
            <span>Grant Write Permission in Workspace Control</span>
          </button>
        ) : null}
      </div>
    )
  }

  if (card.type === 'slack_dispatch') {
    const deliveredList: Array<{ id: string; name: string; ts?: string }> =
      card.data?.delivered && Array.isArray(card.data.delivered) && card.data.delivered.length > 0
        ? card.data.delivered
        : card.data?.channelName
          ? [{ id: card.data.channelId, name: card.data.channelName, ts: card.data.ts }]
          : []
    const lockedList: Array<{ id: string; name: string }> =
      card.data?.locked && Array.isArray(card.data.locked) ? card.data.locked : []

    return (
      <div
        style={{
          marginTop: 10,
          padding: '10px 14px',
          background: 'rgba(34, 197, 94, 0.08)',
          border: '1px solid rgba(34, 197, 94, 0.25)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#4ade80', fontWeight: 600, fontSize: 12 }}>
            <span>⚡</span>
            <span>Slack Message Dispatched</span>
            <span
              style={{
                fontSize: 10,
                background: 'rgba(34, 197, 94, 0.2)',
                color: '#86efac',
                padding: '1px 6px',
                borderRadius: 4,
                fontWeight: 600
              }}
            >
              Direct API (~150ms)
            </span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{card.data?.time}</span>
        </div>

        {deliveredList.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {deliveredList.map((item) => (
              <span
                key={item.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  background: 'rgba(59, 130, 246, 0.2)',
                  color: '#93c5fd',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontWeight: 600
                }}
              >
                <span>#{item.name}</span>
                {item.ts && <span style={{ opacity: 0.6, fontSize: 9 }}>ts:{item.ts.slice(-6)}</span>}
              </span>
            ))}
          </div>
        )}

        <div style={{ fontSize: 12, color: 'var(--text)', background: 'rgba(0,0,0,0.2)', padding: '6px 10px', borderRadius: 4 }}>
          <span>"{card.data?.text}"</span>
        </div>

        {lockedList.length > 0 && onOpenControl && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 4,
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              fontSize: 11
            }}
          >
            <span style={{ color: '#fbbf24' }}>
              ⚠️ Write locked for {lockedList.map((c) => `#${c.name}`).join(', ')}
            </span>
            <button
              type="button"
              onClick={onOpenControl}
              style={{
                background: 'rgba(245, 158, 11, 0.2)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                color: '#fcd34d',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              ⚙️ Unlock in Control
            </button>
          </div>
        )}
      </div>
    )
  }

  if (card.type === 'scrape_trigger') {
    return (
      <div
        style={{
          marginTop: 10,
          padding: '10px 14px',
          background: 'rgba(139, 92, 246, 0.08)',
          border: '1px solid rgba(139, 92, 246, 0.25)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12
        }}
      >
        <span style={{ fontSize: 16 }}>🕷️</span>
        <div>
          <strong style={{ color: '#c4b5fd' }}>Scrape &amp; Delta Sync Complete: </strong>
          <span style={{ color: 'var(--text)' }}>
            Captured {card.data?.newMessagesCount ?? 0} new message(s) across monitored channels.
          </span>
        </div>
      </div>
    )
  }

  if (card.type === 'schedule_set') {
    const mins = card.data?.intervalMinutes ?? 15
    const label = mins < 1 ? `${Math.round(mins * 60)}s` : `${mins}m`
    return (
      <div
        style={{
          marginTop: 10,
          padding: '10px 14px',
          background: 'rgba(6, 182, 212, 0.08)',
          border: '1px solid rgba(6, 182, 212, 0.25)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12
        }}
      >
        <span style={{ fontSize: 16 }}>⏱️</span>
        <div>
          <strong style={{ color: '#67e8f9' }}>Automated Scrape Schedule: </strong>
          <span style={{ color: 'var(--text)' }}>
            {card.data?.enabled ? `Active · Polling every ${label}` : 'Paused'}
          </span>
        </div>
      </div>
    )
  }

  return null
}

const SUGGESTIONS = [
  'What changed this week?',
  'What is the client waiting on?',
  'Any blockers or risks?',
  'Summarise the latest decisions.'
]

const MAX_COMPOSER_HEIGHT = 120

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function timeLabel(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function sourceLabel(source: DashboardProjectChatSourceRef['source']): string {
  return source === 'ours' ? 'Our Slack' : 'Client Slack'
}

function modelSourceLabel(source: DashboardProjectChatStatus['modelSource']): string {
  if (source === 'project') return 'Custom'
  if (source === 'global') return 'Global'
  return 'Default'
}

function retryableCode(code: DashboardProjectChatErrorCode): boolean {
  return (
    code === 'RATE_LIMITED' || code === 'NETWORK' || code === 'INTERNAL' || code === 'CANCELLED'
  )
}

function dropOptimisticUser(
  messages: DashboardProjectChatMessage[],
  text: string
): DashboardProjectChatMessage[] {
  const last = messages.at(-1)
  return last && last.role === 'user' && last.content === text ? messages.slice(0, -1) : messages
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const copied = document.execCommand('copy')
      document.body.removeChild(area)
      return copied
    } catch {
      return false
    }
  }
}

export default function AgentChatPanel({
  projectName,
  projectId,
  mode,
  initialQuestion,
  onConsumeInitial,
  onOpenSettings,
  onOpenControl,
  onOpenSource
}: AgentChatPanelProps): React.ReactElement {
  const [messages, setMessages] = useState<DashboardProjectChatMessage[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [status, setStatus] = useState<DashboardProjectChatStatus | null>(null)
  const [draft, setDraft] = useState<string>(() => initialQuestion ?? '')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [stopping, setStopping] = useState(false)
  const [failure, setFailure] = useState<ChatFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [showJump, setShowJump] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const runIdRef = useRef<string | null>(null)
  const completedRef = useRef<Set<string>>(new Set())
  const pendingInitialRef = useRef<string | null>(null)
  const lastQuestionRef = useRef('')
  const stickRef = useRef(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)

  const keyMissing = status !== null && !status.hasKey

  const scrollToBottom = useCallback((smooth: boolean): void => {
    const element = scrollRef.current
    if (!element) return
    const behavior = smooth && !prefersReducedMotion() ? 'smooth' : 'auto'
    try {
      element.scrollTo({ top: element.scrollHeight, behavior })
    } catch {
      element.scrollTop = element.scrollHeight
    }
  }, [])

  const handleScroll = useCallback((): void => {
    const element = scrollRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    const nearBottom = distance < 48
    stickRef.current = nearBottom
    setShowJump(!nearBottom)
  }, [])

  const jumpToLatest = useCallback((): void => {
    stickRef.current = true
    setShowJump(false)
    scrollToBottom(true)
  }, [scrollToBottom])

  // The model chip and the key banner both land on the card's AI section.
  const openModelSettings = useCallback((): void => {
    try {
      window.history.replaceState(null, '', '#project-ai-settings')
    } catch {
      /* file:// history is best-effort */
    }
    onOpenSettings?.()
  }, [onOpenSettings])

  // ---- history + status -------------------------------------------------
  useEffect(() => {
    let cancelled = false
    void window.api.dashboard
      .getProjectChatHistory(projectId)
      .then((result) => {
        if (cancelled) return
        setMessages(result.messages)
        stickRef.current = true
        requestAnimationFrame(() => scrollToBottom(false))
      })
      .catch(() => {
        if (!cancelled) {
          setFailure({
            message: 'Could not load this conversation. Try again in a moment.',
            retryable: false,
            mode: 'none',
            question: ''
          })
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, scrollToBottom])

  const refreshStatus = useCallback((): void => {
    void window.api.dashboard
      .getProjectChatStatus(projectId)
      .then((next) => setStatus(next))
      .catch(() => undefined)
  }, [projectId])

  useEffect(() => {
    refreshStatus()
    return window.api.dashboard.onConfigChanged(() => refreshStatus())
  }, [refreshStatus])

  // ---- stream subscriptions --------------------------------------------
  const onChunk = useCallback(
    (event: { projectId: string; runId: string; chunk: string }): void => {
      if (event.projectId !== projectId) return
      if (runIdRef.current && event.runId !== runIdRef.current) return
      if (completedRef.current.has(event.runId)) return
      setStreamText((previous) => previous + event.chunk)
    },
    [projectId]
  )

  const onDone = useCallback(
    (event: {
      projectId: string
      runId: string
      content: string
      sources: DashboardProjectChatSourceRef[]
      stopped: boolean
    }): void => {
      if (event.projectId !== projectId) return
      if (runIdRef.current && event.runId !== runIdRef.current) return
      completedRef.current.add(event.runId)
      runIdRef.current = null
      setStreaming(false)
      setStopping(false)
      setStreamText('')
      setFailure(null)
      if (event.content.trim()) {
        setMessages((previous) => [
          ...previous,
          {
            role: 'assistant',
            content: event.content,
            atIso: new Date().toISOString(),
            sources: event.sources,
            ...(event.stopped ? { stopped: true } : {})
          }
        ])
      } else if (event.stopped) {
        setNotice('Stopped before an answer was written.')
      }
    },
    [projectId]
  )

  const onError = useCallback(
    (event: {
      projectId: string
      runId: string
      code: DashboardProjectChatErrorCode
      error: string
      retryable: boolean
    }): void => {
      if (event.projectId !== projectId) return
      if (runIdRef.current && event.runId !== runIdRef.current) return
      completedRef.current.add(event.runId)
      runIdRef.current = null
      setStreaming(false)
      setStopping(false)
      setStreamText('')
      setFailure({
        message: event.error,
        retryable: event.retryable,
        mode: 'retry',
        question: lastQuestionRef.current
      })
      if (event.code === 'AI_KEY_MISSING') refreshStatus()
    },
    [projectId, refreshStatus]
  )

  useEffect(() => {
    const api = window.api.dashboard
    const offs = [
      api.onProjectChatChunk(onChunk),
      api.onProjectChatDone(onDone),
      api.onProjectChatError(onError)
    ]
    return () => offs.forEach((off) => off())
  }, [onChunk, onDone, onError])

  // ---- scrolling --------------------------------------------------------
  useEffect(() => {
    if (!stickRef.current) return
    scrollToBottom(!streaming)
  }, [messages, streamText, streaming, scrollToBottom])

  useEffect(() => {
    const element = composerRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT)}px`
  }, [draft])

  useEffect(() => {
    if (!initialQuestion) return
    pendingInitialRef.current = initialQuestion
    onConsumeInitial?.()
    requestAnimationFrame(() => {
      composerRef.current?.focus()
      composerRef.current?.select()
    })
  }, [initialQuestion, onConsumeInitial])

  // ---- sending ----------------------------------------------------------
  const send = useCallback(
    async (textOverride?: string): Promise<void> => {
      const text = (textOverride ?? draft).trim()
      if (!text || streaming || keyMissing) return
      lastQuestionRef.current = text
      setDraft('')
      setFailure(null)
      setNotice(null)
      setStreamText('')
      setStopping(false)
      setStreaming(true)
      stickRef.current = true
      setMessages((previous) => [
        ...previous,
        { role: 'user', content: text, atIso: new Date().toISOString() }
      ])
      try {
        const result = await window.api.dashboard.projectChat({ projectId, message: text })
        if (!result.ok) {
          setStreaming(false)
          setMessages((previous) => dropOptimisticUser(previous, text))
          setFailure({
            message: result.error,
            retryable: retryableCode(result.code),
            mode: 'append',
            question: text
          })
          if (result.code === 'AI_KEY_MISSING') refreshStatus()
          return
        }
        if (completedRef.current.has(result.runId)) {
          runIdRef.current = null
          setStreaming(false)
          return
        }
        runIdRef.current = result.runId
      } catch (err) {
        setStreaming(false)
        setMessages((previous) => dropOptimisticUser(previous, text))
        setFailure({
          message: err instanceof Error ? err.message : 'Chat failed. Try again in a moment.',
          retryable: true,
          mode: 'append',
          question: text
        })
      }
    },
    [draft, streaming, keyMissing, projectId, refreshStatus]
  )

  // A question handed over from the Dashboard sends once the key state is known.
  // Without a key it stays in the composer so the reader can add one first.
  useEffect(() => {
    const question = pendingInitialRef.current
    if (!question || status === null) return
    pendingInitialRef.current = null
    if (!status.hasKey) return
    void send(question)
  }, [status, send])

  const stop = useCallback(async (): Promise<void> => {
    if (!streaming) return
    setStopping(true)
    try {
      const result = await window.api.dashboard.cancelProjectChat({
        projectId,
        runId: runIdRef.current ?? undefined
      })
      if (!result.ok) {
        // The run had already finished; the done event may have been missed.
        setStopping(false)
        setStreaming(false)
        setStreamText('')
        void window.api.dashboard.getProjectChatHistory(projectId).then((history) => {
          setMessages(history.messages)
        })
      }
    } catch {
      setStopping(false)
    }
  }, [streaming, projectId])

  const retry = useCallback(async (): Promise<void> => {
    if (!failure || !failure.retryable || failure.mode === 'none' || streaming) return
    const { question, mode: retryMode } = failure
    lastQuestionRef.current = question
    setFailure(null)
    setNotice(null)
    setStreamText('')
    setStopping(false)
    setStreaming(true)
    stickRef.current = true
    if (retryMode === 'append') {
      setMessages((previous) => [
        ...previous,
        { role: 'user', content: question, atIso: new Date().toISOString() }
      ])
    }
    try {
      const result = await window.api.dashboard.projectChat({
        projectId,
        message: question,
        retry: retryMode === 'retry'
      })
      if (!result.ok) {
        setStreaming(false)
        if (retryMode === 'append')
          setMessages((previous) => dropOptimisticUser(previous, question))
        setFailure({
          message: result.error,
          retryable: retryableCode(result.code),
          mode: 'append',
          question
        })
        return
      }
      if (completedRef.current.has(result.runId)) {
        runIdRef.current = null
        setStreaming(false)
        return
      }
      runIdRef.current = result.runId
    } catch (err) {
      setStreaming(false)
      setFailure({
        message: err instanceof Error ? err.message : 'Chat failed. Try again in a moment.',
        retryable: true,
        mode: 'append',
        question
      })
    }
  }, [failure, streaming, projectId])

  const clearChat = useCallback(async (): Promise<void> => {
    if (streaming) return
    setConfirmClear(false)
    try {
      await window.api.dashboard.clearProjectChat(projectId)
      setMessages([])
      setFailure(null)
      setNotice(null)
      setStreamText('')
      stickRef.current = true
    } catch {
      setFailure({
        message: 'Could not clear this conversation. Try again in a moment.',
        retryable: true,
        mode: 'none',
        question: ''
      })
    }
  }, [streaming, projectId])

  const applySuggestion = useCallback(
    (text: string): void => {
      if (keyMissing) {
        onOpenSettings?.()
        return
      }
      setDraft(text)
      requestAnimationFrame(() => composerRef.current?.focus())
    },
    [keyMissing, onOpenSettings]
  )

  const copyMessage = useCallback(async (key: string, text: string): Promise<void> => {
    const ok = await copyText(text)
    if (!ok) return
    setCopiedKey(key)
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1400)
  }, [])

  const handleComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key !== 'Enter' || event.shiftKey) return
      if (composingRef.current || event.nativeEvent.isComposing) return
      event.preventDefault()
      void send()
    },
    [send]
  )

  if (mode === 'agentwork') {
    return (
      <div className="ws-agent-empty">
        <p className="ws-agent-empty-title">AgentWork is not connected yet</p>
        <p className="ws-agent-empty-hint">Add the AgentWork MCP server in Settings.</p>
      </div>
    )
  }

  const liveMessage = failure
    ? 'Chat error'
    : streaming
      ? streamText
        ? 'Answer streaming'
        : 'Thinking'
      : stopping
        ? 'Stopping'
        : ''

  const canSend = !streaming && !keyMissing && draft.trim().length > 0

  return (
    <section className="chat-panel" aria-label={`Chat with ${projectName}`}>
      <header className="chat-head">
        <div className="chat-head-main">
          <h3 className="chat-head-title">Chat with project</h3>
          <span className="chat-head-sub">Autonomous project agent · Answers questions, reads channels, posts to authorized Slack channels &amp; triggers scrapes</span>
        </div>
        <div className="chat-head-actions">
          {status ? (
            status.hasKey ? (
              <button
                type="button"
                className="chat-model-chip"
                data-testid="chat-model-chip"
                data-model-source={status.modelSource}
                aria-label={`Model ${status.model}, ${modelSourceLabel(status.modelSource)}. Open AI settings.`}
                title={`Model: ${status.model} (${modelSourceLabel(status.modelSource)}). Key: ${status.keySource}. Open AI settings.`}
                onClick={openModelSettings}
              >
                <span className="chat-model-name">{status.model}</span>
                <span className={`chat-model-source is-${status.modelSource}`}>
                  {modelSourceLabel(status.modelSource)}
                </span>
              </button>
            ) : (
              <button
                type="button"
                className="chat-model-chip is-missing"
                onClick={openModelSettings}
              >
                No AI key
              </button>
            )
          ) : null}
          {messages.length > 0 && !confirmClear ? (
            <button
              type="button"
              className="chat-clear"
              onClick={() => setConfirmClear(true)}
              disabled={streaming}
            >
              Clear chat
            </button>
          ) : null}
          {confirmClear ? (
            <span className="chat-confirm" role="alert">
              Clear chat?
              <button type="button" className="chat-confirm-yes" onClick={() => void clearChat()}>
                Clear
              </button>
              <button
                type="button"
                className="chat-confirm-no"
                onClick={() => setConfirmClear(false)}
              >
                Cancel
              </button>
            </span>
          ) : null}
        </div>
      </header>

      {keyMissing ? (
        <div className="chat-key" role="status">
          <span>No AI key is set for this project. Answers are paused.</span>
          <button type="button" onClick={openModelSettings}>
            Open AI settings
          </button>
        </div>
      ) : null}

      <div className="chat-body">
        <div
          className="chat-log"
          ref={scrollRef}
          onScroll={handleScroll}
          role="log"
          aria-label="Conversation"
        >
          {loadingHistory ? <p className="chat-muted">Loading conversation…</p> : null}

          {!loadingHistory && messages.length === 0 && !streaming ? (
            <div className="chat-empty">
              <p className="chat-empty-title">Ask about {projectName}</p>
              <p className="chat-empty-hint">
                {keyMissing
                  ? 'Add an AI key in Settings, then ask what the client needs, what changed, or what is blocked.'
                  : 'I answer from this project’s Slack history and the state this card has already derived. Nothing is posted to Slack.'}
              </p>
              <div className="chat-suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    type="button"
                    className="chat-suggestion"
                    key={suggestion}
                    onClick={() => applySuggestion(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message, index) => {
            const key = `${index}-${message.atIso}`
            return (
              <div
                className={`chat-msg is-${message.role}${message.stopped ? ' is-stopped' : ''}`}
                key={key}
              >
                <div className="chat-msg-meta">
                  <span>{message.role === 'user' ? 'You' : 'Cosmic'}</span>
                  <span>{timeLabel(message.atIso)}</span>
                  {message.stopped ? <span>stopped</span> : null}
                </div>
                <div className="chat-bubble">
                  {message.role === 'assistant' ? (
                    (() => {
                      const { cleanContent, card, rawAction } = parseActionCard(message.content)
                      return (
                        <>
                          {rawAction ? (
                            <details
                              style={{
                                margin: '0 0 8px',
                                padding: '4px 8px',
                                borderRadius: 6,
                                background: 'rgba(255, 255, 255, 0.04)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                fontSize: 11,
                                color: '#94a3b8'
                              }}
                            >
                              <summary
                                style={{
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                  color: '#a5b4fc',
                                  outline: 'none',
                                  userSelect: 'none'
                                }}
                              >
                                ⚡ Action: {rawAction.action || 'dispatched'} (expand details)
                              </summary>
                              <pre
                                style={{
                                  margin: '6px 0 2px',
                                  fontSize: 10,
                                  overflowX: 'auto',
                                  color: '#cbd5e1'
                                }}
                              >
                                {JSON.stringify(rawAction, null, 2)}
                              </pre>
                            </details>
                          ) : null}
                          {cleanContent ? <ChatMarkdown text={cleanContent} /> : null}
                          {card ? <ActionCard card={card} onOpenControl={onOpenControl} /> : null}
                        </>
                      )
                    })()
                  ) : (
                    message.content
                  )}
                </div>
                {message.role === 'assistant' ? (
                  <div className="chat-msg-actions">
                    <button
                      type="button"
                      className="chat-copy"
                      onClick={() => void copyMessage(key, message.content)}
                    >
                      {copiedKey === key ? 'Copied' : 'Copy'}
                    </button>
                    {message.sources && message.sources.length > 0 ? (
                      <div className="chat-sources" aria-label="Sources">
                        {message.sources.map((source) => (
                          <button
                            type="button"
                            className="chat-source"
                            key={`${source.source}:${source.channelId}:${source.ts}`}
                            title={`${sourceLabel(source.source)} · ${source.ts}`}
                            onClick={() => onOpenSource?.(source)}
                            disabled={!onOpenSource}
                          >
                            #{source.channelName}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}

          {streaming ? (
            <div className="chat-msg is-assistant" aria-live="off">
              <div className="chat-msg-meta">
                <span>Cosmic</span>
              </div>
              <div className="chat-bubble">
                {streamText ? (
                  (() => {
                    const { cleanContent, card, rawAction } = parseActionCard(streamText)
                    return (
                      <>
                        {rawAction ? (
                          <details
                            style={{
                              margin: '0 0 8px',
                              padding: '4px 8px',
                              borderRadius: 6,
                              background: 'rgba(255, 255, 255, 0.04)',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                              fontSize: 11,
                              color: '#94a3b8'
                            }}
                          >
                            <summary
                              style={{
                                cursor: 'pointer',
                                fontWeight: 600,
                                color: '#a5b4fc',
                                outline: 'none',
                                userSelect: 'none'
                              }}
                            >
                              ⚡ Action: {rawAction.action || 'dispatched'} (expand details)
                            </summary>
                            <pre
                              style={{
                                margin: '6px 0 2px',
                                fontSize: 10,
                                overflowX: 'auto',
                                color: '#cbd5e1'
                              }}
                            >
                              {JSON.stringify(rawAction, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                        {cleanContent ? <ChatMarkdown text={cleanContent} /> : null}
                        {card ? <ActionCard card={card} onOpenControl={onOpenControl} /> : null}
                      </>
                    )
                  })()
                ) : (
                  <span className="chat-thinking" aria-label="Thinking">
                    <span className="chat-dot" />
                    <span className="chat-dot" />
                    <span className="chat-dot" />
                  </span>
                )}
              </div>
            </div>
          ) : null}

          {notice ? <p className="chat-notice">{notice}</p> : null}
        </div>

        {showJump ? (
          <button type="button" className="chat-jump" onClick={jumpToLatest}>
            Jump to latest
          </button>
        ) : null}
      </div>

      {failure ? (
        <div className="chat-error" role="alert">
          <span>{failure.message}</span>
          {failure.retryable && failure.mode !== 'none' && !streaming ? (
            <button type="button" onClick={() => void retry()}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <textarea
          ref={composerRef}
          value={draft}
          rows={1}
          aria-label="Ask about this project"
          placeholder={keyMissing ? 'Add an AI key to start chatting' : 'Ask about this project…'}
          disabled={streaming || keyMissing}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
        />
        {streaming ? (
          <button
            type="button"
            className="chat-send is-stop"
            onClick={() => void stop()}
            disabled={stopping}
          >
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        ) : (
          <button type="submit" className="chat-send" disabled={!canSend}>
            Send
          </button>
        )}
      </form>
      <p className="chat-hint">
        Enter sends, Shift+Enter adds a line. Cosmic can execute Slack dispatches, read channels, and trigger scrapes on command.
      </p>
      <p className="chat-visually-hidden" role="status" aria-live="polite">
        {liveMessage}
      </p>
    </section>
  )
}
