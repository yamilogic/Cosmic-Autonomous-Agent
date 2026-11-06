import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DashboardChatMessage, DashboardSource } from '../../../../shared/dashboard-contract'
import { scrollToMessage, takeMessageJump } from './jump-to-message'

interface SlackChatTabProps {
  projectId: string
  /** Which workspace to read and post into (defaults to the card's own). */
  source?: DashboardSource
  /** A channel picked from the sidebar's dropdown. The panel shows that one
   * channel only; with nothing picked it shows every channel in the source. */
  lockedChannel?: { id: string; name: string } | null
}

const PAGE_SIZE = 50

function messageKey(message: DashboardChatMessage): string {
  return `${message.channelId}:${message.ts}`
}

function formatChatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return iso
  }
}

/**
 * Slack Chat tab — locally stored messages from this project's watched channels,
 * plus replies posted through the main process (`dashboard:send-message`).
 * This is the only writable surface in the dashboard.
 */
export default function SlackChatTab({
  projectId,
  source = 'client',
  lockedChannel
}: SlackChatTabProps): React.ReactElement {
  const [messages, setMessages] = useState<DashboardChatMessage[]>([])
  const [nextBeforeTs, setNextBeforeTs] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scopeError, setScopeError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickBottomRef = useRef(true)

  const selectedChannel = useMemo(
    () => (lockedChannel ? { channelId: lockedChannel.id, channelName: lockedChannel.name } : null),
    [lockedChannel]
  )
  const activeChannelId = lockedChannel?.id

  useEffect(() => {
    let cancelled = false
    stickBottomRef.current = true
    window.api.dashboard
      .getMessages({ projectId, source, channelId: activeChannelId ?? undefined, limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return
        // A source chip may have handed us a message to reveal. Only suppress
        // the bottom pin when that message is actually in this page.
        const jumpTs = takeMessageJump(projectId, source, activeChannelId)
        const canJump =
          Boolean(jumpTs) &&
          page.messages.some(
            (message) => message.channelId === activeChannelId && message.ts === jumpTs
          )
        if (canJump) stickBottomRef.current = false
        setMessages(page.messages)
        setNextBeforeTs(page.nextBeforeTs)
        setHasMore(page.hasMore)
        if (canJump && jumpTs) {
          window.requestAnimationFrame(() =>
            window.requestAnimationFrame(() => {
              scrollToMessage(scrollRef.current, jumpTs)
            })
          )
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load messages.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, source, activeChannelId])

  // Auto-scroll to the newest message after the first page / a send.
  useEffect(() => {
    if (!stickBottomRef.current) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    stickBottomRef.current = false
  }, [messages, loading])

  const loadOlder = (): void => {
    const el = scrollRef.current
    if (!el || loadingOlder || !hasMore || !nextBeforeTs) return
    const previousHeight = el.scrollHeight
    const previousTop = el.scrollTop
    setLoadingOlder(true)
    window.api.dashboard
      .getMessages({
        projectId,
        source,
        channelId: activeChannelId ?? undefined,
        beforeTs: nextBeforeTs,
        limit: PAGE_SIZE
      })
      .then((page) => {
        setMessages((prev) => {
          const seen = new Set(prev.map(messageKey))
          const older = page.messages.filter((message) => !seen.has(messageKey(message)))
          return [...older, ...prev]
        })
        setNextBeforeTs(page.nextBeforeTs)
        setHasMore(page.hasMore)
        window.requestAnimationFrame(() => {
          const node = scrollRef.current
          if (node) node.scrollTop = node.scrollHeight - previousHeight + previousTop
        })
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not load older messages.')
      })
      .finally(() => setLoadingOlder(false))
  }

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (el && el.scrollTop <= 48) loadOlder()
  }

  const send = async (): Promise<void> => {
    const text = draft.trim()
    const channel = selectedChannel
    if (!text || !channel || sending) return

    const temp: DashboardChatMessage = {
      ts: `temp-${Date.now()}`,
      channelId: channel.channelId,
      channelName: channel.channelName,
      userId: 'me',
      userName: 'You',
      source,
      text,
      atIso: new Date().toISOString(),
      isMine: true,
      pending: true
    }

    stickBottomRef.current = true
    setDraft('')
    setSending(true)
    setError(null)
    setScopeError(null)
    setMessages((prev) => [...prev, temp])

    try {
      const result = await window.api.dashboard.sendMessage({
        projectId,
        source,
        channelId: channel.channelId,
        text
      })
      if (!result.ok || !result.message) {
        setMessages((prev) =>
          prev.map((message) =>
            message.ts === temp.ts ? { ...message, pending: false, failed: true } : message
          )
        )
        if (result.code === 'missing_scope') {
          setScopeError(result.error ?? 'This Slack token cannot post messages.')
        } else {
          setError(result.error ?? 'Could not send the message.')
        }
        return
      }
      const sent = result.message
      setMessages((prev) => prev.map((message) => (message.ts === temp.ts ? sent : message)))
    } catch (err: unknown) {
      setMessages((prev) =>
        prev.map((message) =>
          message.ts === temp.ts ? { ...message, pending: false, failed: true } : message
        )
      )
      setError(err instanceof Error ? err.message : 'Could not send the message.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="ws-chat">
      <div className="ws-chat-toolbar">
        <span className="ws-chat-channel-name">
          {lockedChannel
            ? `#${lockedChannel.name}`
            : source === 'ours'
              ? 'All Our Slack channels'
              : 'All Client Slack channels'}
        </span>
        <span className="ws-chat-count">
          {messages.length} message{messages.length === 1 ? '' : 's'}
        </span>
      </div>

      {scopeError ? (
        <div className="ws-chat-scope" role="alert">
          <strong>Missing Slack permission</strong>
          <p>{scopeError}</p>
        </div>
      ) : null}

      <div
        className="ws-chat-messages"
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label="Stored Slack messages"
      >
        {loadingOlder ? <p className="ws-chat-loading">Loading older messages…</p> : null}
        {loading && messages.length === 0 ? (
          <p className="ws-chat-loading">Loading messages…</p>
        ) : null}
        {!loading && messages.length === 0 ? (
          <p className="ws-empty">
            No stored messages yet — sync this project to pull Slack history.
          </p>
        ) : null}
        {messages.map((message) => (
          <div
            key={messageKey(message)}
            data-ts={message.ts}
            data-channel-id={message.channelId}
            tabIndex={-1}
            className={`ws-chat-msg${message.isMine ? ' is-mine' : ''}${message.failed ? ' is-failed' : ''}`}
          >
            <div className="ws-chat-msg-head">
              <strong>{message.userName}</strong>
              <span className="ws-chat-msg-time">{formatChatTime(message.atIso)}</span>
              <span className="ws-chat-channel">#{message.channelName}</span>
              {message.pending ? <span className="ws-chat-pending">sending…</span> : null}
              {message.failed ? <span className="ws-chat-failed">failed</span> : null}
            </div>
            <p className="ws-chat-msg-text">{message.text}</p>
          </div>
        ))}
      </div>

      {error ? (
        <p className="ws-chat-error" role="alert">
          {error}
        </p>
      ) : null}

      <form
        className="ws-chat-composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            selectedChannel ? `Reply in #${selectedChannel.channelName}` : 'Pick a channel to reply'
          }
          aria-label="Reply message"
          disabled={!selectedChannel || sending}
        />
        <button type="submit" disabled={!selectedChannel || !draft.trim() || sending}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
      <p className="ws-chat-hint">
        Replies post to Slack as this workspace&apos;s token (needs the chat:write scope).
      </p>
    </div>
  )
}
