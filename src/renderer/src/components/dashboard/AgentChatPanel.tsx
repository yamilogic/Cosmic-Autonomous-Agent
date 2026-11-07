import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AutoReplyPersona,
  AutoReplyPolicy,
  DashboardProjectChatErrorCode,
  DashboardProjectChatPayload,
  DashboardProjectChatSourceRef,
  DashboardProjectChatStatus,
  ProjectSource
} from '../../../../shared/dashboard-contract'
import ChatMarkdown from './ChatMarkdown'
import SocialChannelSidebar from './SocialChannelSidebar'
import ComposerAutocompletePopover, { AutocompleteItem } from './ComposerAutocompletePopover'
import type { XomniModeKey } from './workspace-nav'

interface AgentChatPanelProps {
  projectName: string
  projectId: string
  mode: XomniModeKey | 'social'
  socialSource?: ProjectSource | null
  sources?: ProjectSource[]
  /** Optional question handed to the project chat on mount. */
  initialQuestion?: string | null
  onConsumeInitial?: () => void
  onOpenSettings?: () => void
  onOpenControl?: (sourceId?: string) => void
  onOpenLiveEmbed?: () => void
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

export function formatChannelDisplayName(
  channelOrName: string | { name: string; isDm?: boolean; kind?: string }
): { symbol: string; cleanName: string; fullName: string; isDm: boolean } {
  const rawName = typeof channelOrName === 'string' ? channelOrName : channelOrName.name
  const isDm =
    typeof channelOrName === 'string'
      ? rawName.startsWith('@') || rawName.toLowerCase().includes('you')
      : Boolean(
          channelOrName.isDm ||
            channelOrName.kind === 'dm' ||
            rawName.startsWith('@') ||
            rawName.toLowerCase().includes('you')
        )
  let cleanName = rawName
    .replace(/^[#@]+/, '')
    .replace(/\s*\(?you\)?$/i, '')
    .trim()
  if (!cleanName) cleanName = 'channel'
  const symbol = isDm ? '@' : '#'
  return {
    symbol,
    cleanName,
    fullName: `${symbol}${cleanName}`,
    isDm
  }
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

  if (card.type === 'help_cheatsheet') {
    return (
      <div
        style={{
          marginTop: 10,
          padding: '12px 16px',
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.3)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 10
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#818cf8', fontWeight: 700, fontSize: 13 }}>
          <span>💡</span>
          <span>Cosmic Command & Mentions Guide</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)', padding: '3px 8px', borderRadius: 4, color: '#cbd5e1' }}>
            Type <strong style={{ color: '#a855f7' }}>@</strong> for Accounts
          </span>
          <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)', padding: '3px 8px', borderRadius: 4, color: '#cbd5e1' }}>
            Type <strong style={{ color: '#3b82f6' }}>#</strong> for Channels/Contacts
          </span>
          <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)', padding: '3px 8px', borderRadius: 4, color: '#22c55e' }}>
            Type <strong style={{ color: '#22c55e' }}>/</strong> for Slash Commands
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

export interface DisplayChatMessage {
  id: string
  role: 'user' | 'assistant' | 'client'
  authorName: string
  atIso: string
  content: string
  isAutoReply?: boolean
  isMine?: boolean
  pending?: boolean
  failed?: boolean
  sources?: DashboardProjectChatSourceRef[]
  stopped?: boolean
}

function dropOptimisticUser(
  messages: DisplayChatMessage[],
  text: string
): DisplayChatMessage[] {
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

function isSlashCommandOrExplicitDispatch(text: string): boolean {
  const t = text.trim()
  return (
    /^\/(?:send|ai-ans|ai-answer|help|help-slack|scrape|status)\b/i.test(t) ||
    /(?:^|\s)@\S+.*?:/.test(t) ||
    /(?:^|\s)#\S+.*?:/.test(t)
  )
}

export default function AgentChatPanel({
  projectName,
  projectId,
  mode,
  socialSource,
  sources,
  initialQuestion,
  onConsumeInitial,
  onOpenSettings,
  onOpenControl,
  onOpenLiveEmbed,
  onOpenSource
}: AgentChatPanelProps): React.ReactElement {
  const [messages, setMessages] = useState<DisplayChatMessage[]>([])
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
  const [sendingReply, setSendingReply] = useState(false)

  // Autocomplete state
  const [autocompleteTrigger, setAutocompleteTrigger] = useState<'@' | '#' | '/' | null>(null)
  const [autocompleteQuery, setAutocompleteQuery] = useState<string>('')
  const [triggerPos, setTriggerPos] = useState<number>(-1)
  const justSelectedRef = useRef<boolean>(false)

  // Track active channel when in social mode
  const [activeChannelId, setActiveChannelId] = useState<string | null>(() => {
    if (mode === 'social' && socialSource?.channels && socialSource.channels.length > 0) {
      const firstEnabled = socialSource.channels.find((c) => c.enabled !== false)
      return firstEnabled ? firstEnabled.id : null
    }
    return null
  })

  // Synchronize active channel when switching sources or mode
  useEffect(() => {
    if (mode === 'social' && socialSource?.channels && socialSource.channels.length > 0) {
      const firstEnabled = socialSource.channels.find((c) => c.enabled !== false)
      setActiveChannelId(firstEnabled ? firstEnabled.id : null)
    } else {
      setActiveChannelId(null)
    }
  }, [mode, socialSource?.id])

  const activeChannel = useMemo(() => {
    if (!activeChannelId || !socialSource?.channels) return null
    return socialSource.channels.find((c) => c.id === activeChannelId) ?? null
  }, [activeChannelId, socialSource])

  const [masterPolicy, setMasterPolicy] = useState<AutoReplyPolicy>('mention_dm')
  const [masterPersona, setMasterPersona] = useState<AutoReplyPersona>('professional')

  const handleDraftChange = useCallback((text: string) => {
    setDraft(text)
    const textarea = composerRef.current
    if (!textarea) return

    const cursor = textarea.selectionStart ?? text.length
    const textBeforeCursor = text.slice(0, cursor)

    // Trigger is @, #, or / preceded by space or start of line
    const match = textBeforeCursor.match(/(?:^|\s)([@#/])([a-zA-Z0-9_-]*)$/)
    if (match) {
      setAutocompleteTrigger(match[1] as '@' | '#' | '/')
      setAutocompleteQuery(match[2] || '')
      setTriggerPos(cursor - (match[2]?.length || 0) - 1)
    } else {
      setAutocompleteTrigger(null)
      setAutocompleteQuery('')
      setTriggerPos(-1)
    }
  }, [])

  const handleSelectAutocomplete = useCallback(
    (item: AutocompleteItem) => {
      const textarea = composerRef.current
      if (!textarea || triggerPos < 0) return

      justSelectedRef.current = true
      setTimeout(() => {
        justSelectedRef.current = false
      }, 150)

      const before = draft.slice(0, triggerPos)
      const after = draft.slice(textarea.selectionStart ?? draft.length)
      const nextDraft = `${before}${item.insertText}${after}`
      setDraft(nextDraft)
      setAutocompleteTrigger(null)
      setAutocompleteQuery('')
      setTriggerPos(-1)

      setTimeout(() => {
        textarea.focus()
        const newCursorPos = before.length + item.insertText.length
        textarea.setSelectionRange(newCursorPos, newCursorPos)
      }, 10)
    },
    [draft, triggerPos]
  )

  const handleUpdatePolicy = useCallback(
    async (policy: AutoReplyPolicy) => {
      if (mode === 'project') {
        setMasterPolicy(policy)
        const srcList = sources || (socialSource ? [socialSource] : [])
        try {
          for (const src of srcList) {
            await window.api.dashboard.updateSource({
              projectId,
              sourceId: src.id,
              patch: {
                channels: (src.channels || []).map((c) => ({
                  ...c,
                  autoReplyPolicy: policy,
                  autoReply: policy !== 'disabled'
                }))
              }
            })
          }
          setNotice(`Auto-reply policy set to "${policy}"`)
          setTimeout(() => setNotice(null), 3000)
        } catch (err) {
          setNotice(err instanceof Error ? err.message : 'Failed to update policy')
        }
        return
      }

      if (!socialSource) return
      try {
        await window.api.dashboard.updateSource({
          projectId,
          sourceId: socialSource.id,
          patch: {
            channels: socialSource.channels.map((c) =>
              !activeChannel || c.id === activeChannel.id
                ? {
                    ...c,
                    autoReplyPolicy: policy,
                    autoReply: policy !== 'disabled'
                  }
                : c
            )
          }
        })
        setNotice(`Auto-reply policy set to "${policy}"`)
        setTimeout(() => setNotice(null), 3000)
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Failed to update policy')
      }
    },
    [mode, sources, socialSource, activeChannel, projectId]
  )

  const handleUpdatePersona = useCallback(
    async (persona: AutoReplyPersona) => {
      if (mode === 'project') {
        setMasterPersona(persona)
        const srcList = sources || (socialSource ? [socialSource] : [])
        try {
          for (const src of srcList) {
            await window.api.dashboard.updateSource({
              projectId,
              sourceId: src.id,
              patch: {
                channels: (src.channels || []).map((c) => ({
                  ...c,
                  autoReplyPersona: persona
                }))
              }
            })
          }
          setNotice(`AI persona set to "${persona}"`)
          setTimeout(() => setNotice(null), 3000)
        } catch (err) {
          setNotice(err instanceof Error ? err.message : 'Failed to update persona')
        }
        return
      }

      if (!socialSource) return
      try {
        await window.api.dashboard.updateSource({
          projectId,
          sourceId: socialSource.id,
          patch: {
            channels: socialSource.channels.map((c) =>
              !activeChannel || c.id === activeChannel.id
                ? { ...c, autoReplyPersona: persona }
                : c
            )
          }
        })
        setNotice(`AI persona set to "${persona}"`)
        setTimeout(() => setNotice(null), 3000)
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Failed to update persona')
      }
    },
    [mode, sources, socialSource, activeChannel, projectId]
  )

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

  // ---- unified channel & chat history loader ----------------------------
  const loadChannelAndChatHistory = useCallback(async (): Promise<void> => {
    const query = activeChannelId
      ? { projectId, channelId: activeChannelId, sourceId: socialSource?.id }
      : mode === 'social' && socialSource?.id
        ? { projectId, sourceId: socialSource.id }
        : projectId

    try {
      const chatHistoryPromise = window.api.dashboard.getProjectChatHistory(query)
      const channelMessagesPromise =
        activeChannelId && typeof window.api.dashboard?.getMessages === 'function'
          ? window.api.dashboard
              .getMessages({
                projectId,
                channelId: activeChannelId,
                source: 'client',
                limit: 80
              })
              .catch(() => ({ messages: [] }))
          : Promise.resolve({ messages: [] })

      const [chatResult, channelPage] = await Promise.all([
        chatHistoryPromise,
        channelMessagesPromise
      ])

      const unified: DisplayChatMessage[] = []

      // 1. Channel messages (scraped from Slack or posted by user/agent)
      for (const m of channelPage?.messages || []) {
        const text = m.text || ''
        const hasAutoReplyText = Boolean(
          text &&
            (text.includes('Thanks for reaching out') ||
              text.includes('Thanks for mentioning me') ||
              text.includes('I received your message') ||
              text.includes('reviewing this and will get back to you'))
        )
        const isMine = Boolean(
          m.isMine ||
            m.userId === 'me' ||
            m.userName === 'You' ||
            m.userName === 'Cosmic AI' ||
            hasAutoReplyText
        )

        if (isMine) {
          if (hasAutoReplyText || m.userName === 'Cosmic AI') {
            unified.push({
              id: `slack-${m.channelId}-${m.ts}`,
              role: 'assistant',
              authorName: 'Cosmic AI',
              atIso: m.atIso || new Date(Number(m.ts) * 1000).toISOString(),
              content: m.text,
              isAutoReply: true
            })
          } else {
            unified.push({
              id: `slack-${m.channelId}-${m.ts}`,
              role: 'user',
              authorName: 'You',
              atIso: m.atIso || new Date(Number(m.ts) * 1000).toISOString(),
              content: m.text,
              isMine: true,
              pending: m.pending,
              failed: m.failed
            })
          }
        } else {
          const rawAuthor =
            m.userName && m.userName !== 'me'
              ? m.userName
              : activeChannel
                ? activeChannel.name
                : 'Contact'
          const cleanAuthor =
            rawAuthor
              .replace(/^[#@]+/, '')
              .replace(/\s*\(?you\)?$/i, '')
              .trim() || 'Contact'
          unified.push({
            id: `slack-${m.channelId}-${m.ts}`,
            role: 'client',
            authorName: `@${cleanAuthor}`,
            atIso: m.atIso || new Date(Number(m.ts) * 1000).toISOString(),
            content: m.text
          })
        }
      }

      // 2. Project chat messages (human <-> agent dialogs, action cards)
      for (let i = 0; i < (chatResult?.messages || []).length; i++) {
        const c = chatResult.messages[i]
        const cTime = new Date(c.atIso).getTime()
        const isDup = unified.some(
          (u) =>
            u.content.trim() === c.content.trim() &&
            Math.abs(new Date(u.atIso).getTime() - cTime) < 5000
        )
        if (!isDup) {
          unified.push({
            id: `pchat-${i}-${c.atIso}`,
            role: c.role,
            authorName: c.role === 'user' ? 'You' : 'Cosmic',
            atIso: c.atIso,
            content: c.content,
            sources: c.sources,
            stopped: c.stopped
          })
        }
      }

      // 3. Sort chronologically
      unified.sort((a, b) => new Date(a.atIso).getTime() - new Date(b.atIso).getTime())

      setMessages(unified)
    } catch {
      // ignore
    }
  }, [projectId, activeChannelId, socialSource?.id, mode, activeChannel])

  const streamingRef = useRef(streaming)
  streamingRef.current = streaming

  useEffect(() => {
    let cancelled = false
    setLoadingHistory(true)
    loadChannelAndChatHistory()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })

    // Subscribe to snapshot sync changes to refresh real-time channel messages
    const offSnapshot =
      typeof window.api.dashboard?.onSnapshotChanged === 'function'
        ? window.api.dashboard.onSnapshotChanged(() => {
            if (!cancelled) void loadChannelAndChatHistory()
          })
        : () => {}

    // If scoped to a channel, poll every 5s for newly scraped messages
    let timer: NodeJS.Timeout | null = null
    if (activeChannelId) {
      timer = setInterval(() => {
        if (!cancelled && !streamingRef.current) void loadChannelAndChatHistory()
      }, 5000)
    }

    return () => {
      cancelled = true
      offSnapshot()
      if (timer) clearInterval(timer)
    }
  }, [loadChannelAndChatHistory, activeChannelId])

  const sendDirectSlackReply = useCallback(
    async (textOverride?: string): Promise<void> => {
      const text = (textOverride ?? draft).trim()
      if (!text || !activeChannelId || sendingReply) return

      const tempId = `temp-${Date.now()}`
      const tempMsg: DisplayChatMessage = {
        id: tempId,
        role: 'user',
        authorName: 'You',
        atIso: new Date().toISOString(),
        content: text,
        isMine: true,
        pending: true
      }

      setDraft('')
      setSendingReply(true)
      setFailure(null)
      setNotice(null)
      setMessages((prev) => [...prev, tempMsg])
      stickRef.current = true
      scrollToBottom(true)

      try {
        const res = await window.api.dashboard.sendMessage({
          projectId,
          channelId: activeChannelId,
          text
        })

        if (res.ok && res.message) {
          const sent = res.message
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId
                ? {
                    id: `slack-${sent.channelId}-${sent.ts}`,
                    role: 'user',
                    authorName: 'You',
                    atIso: sent.atIso,
                    content: sent.text,
                    isMine: true,
                    pending: false
                  }
                : m
            )
          )
        } else {
          setMessages((prev) =>
            prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m))
          )
          setNotice(res.error || 'Failed to send message to Slack.')
        }
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m))
        )
        setNotice(err instanceof Error ? err.message : 'Error sending message to Slack.')
      } finally {
        setSendingReply(false)
      }
    },
    [draft, activeChannelId, sendingReply, projectId, scrollToBottom]
  )

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
            id: `done-${Date.now()}`,
            role: 'assistant',
            authorName: 'Cosmic',
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
        {
          id: `user-${Date.now()}`,
          role: 'user',
          authorName: 'You',
          content: text,
          atIso: new Date().toISOString()
        }
      ])
      try {
        const payload: DashboardProjectChatPayload = {
          projectId,
          message: text,
          channelId: activeChannelId ?? undefined,
          sourceId: socialSource?.id
        }
        const result = await window.api.dashboard.projectChat(payload)
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
    [draft, streaming, keyMissing, projectId, activeChannelId, socialSource?.id, refreshStatus]
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
        runId: runIdRef.current ?? undefined,
        channelId: activeChannelId ?? undefined,
        sourceId: socialSource?.id
      })
      if (!result.ok) {
        // The run had already finished; the done event may have been missed.
        setStopping(false)
        setStreaming(false)
        setStreamText('')
        void loadChannelAndChatHistory()
      }
    } catch {
      setStopping(false)
    }
  }, [streaming, projectId, activeChannelId, socialSource?.id, loadChannelAndChatHistory])

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
        {
          id: `retry-${Date.now()}`,
          role: 'user',
          authorName: 'You',
          content: question,
          atIso: new Date().toISOString()
        }
      ])
    }
    try {
      const payload: DashboardProjectChatPayload = {
        projectId,
        message: question,
        channelId: activeChannelId ?? undefined,
        sourceId: socialSource?.id,
        retry: retryMode === 'retry'
      }
      const result = await window.api.dashboard.projectChat(payload)
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
  }, [failure, streaming, projectId, activeChannelId, socialSource?.id])

  const clearChat = useCallback(async (): Promise<void> => {
    if (streaming) return
    setConfirmClear(false)
    const query = activeChannelId
      ? { projectId, channelId: activeChannelId, sourceId: socialSource?.id }
      : mode === 'social' && socialSource?.id
        ? { projectId, sourceId: socialSource.id }
        : projectId
    try {
      await window.api.dashboard.clearProjectChat(query)
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
  }, [streaming, projectId, activeChannelId, socialSource?.id, mode, loadChannelAndChatHistory])

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

      // If autocomplete popover is open or an item was just inserted, do NOT send to chat
      if (autocompleteTrigger !== null || justSelectedRef.current) {
        event.preventDefault()
        return
      }

      event.preventDefault()
      if (activeChannel && !isSlashCommandOrExplicitDispatch(draft)) {
        void sendDirectSlackReply()
      } else {
        void send()
      }
    },
    [autocompleteTrigger, activeChannel, draft, sendDirectSlackReply, send]
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

  const canSend =
    !streaming &&
    !sendingReply &&
    draft.trim().length > 0 &&
    (activeChannel ? true : !keyMissing)

  const activeChanDisplay = activeChannel ? formatChannelDisplayName(activeChannel) : null

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
      {mode === 'social' && socialSource && (
        <SocialChannelSidebar
          source={socialSource}
          activeChannelId={activeChannelId}
          onSelectChannel={(chId) => setActiveChannelId(chId)}
        />
      )}
      <section className="chat-panel" style={{ flex: 1, minWidth: 0, height: '100%' }} aria-label={`Chat with ${projectName}`}>
        <header className="chat-head">
          <div className="chat-head-main">
            {mode === 'social' && socialSource ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h3 className="chat-head-title">
                    Chat with {(() => {
                      const rawWsName = socialSource.workspaceName?.trim()
                      return rawWsName && rawWsName.toLowerCase() !== 'agentwork'
                        ? rawWsName
                        : socialSource.platform === 'teams'
                          ? 'Microsoft Teams'
                          : socialSource.platform === 'whatsapp'
                            ? 'WhatsApp'
                            : 'Slack Workspace'
                    })()}
                    {activeChanDisplay ? ` · ${activeChanDisplay.fullName}` : ' · All Channels'}
                  </h3>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: 4,
                      background:
                        socialSource.platform === 'teams'
                          ? 'rgba(59, 130, 246, 0.2)'
                          : socialSource.platform === 'whatsapp'
                            ? 'rgba(34, 197, 94, 0.2)'
                            : 'rgba(168, 85, 247, 0.2)',
                      color:
                        socialSource.platform === 'teams'
                          ? '#93c5fd'
                          : socialSource.platform === 'whatsapp'
                            ? '#86efac'
                            : '#c084fc',
                      textTransform: 'uppercase'
                    }}
                  >
                    {socialSource.platform || 'slack'}
                  </span>
                  {activeChannel && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: 4,
                        background: activeChannel.agentWrite ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                        color: activeChannel.agentWrite ? '#4ade80' : '#94a3b8'
                      }}
                    >
                      {activeChannel.agentWrite ? 'WRITE ENABLED' : 'READ MONITORED'}
                    </span>
                  )}
                </div>
                <span className="chat-head-sub">
                  {activeChanDisplay
                    ? `Autonomous ${socialSource.platform ? socialSource.platform.toUpperCase() : 'Social'} Agent · Scoped to ${activeChanDisplay.fullName} messages and actions`
                    : `Autonomous ${socialSource.platform ? socialSource.platform.toUpperCase() : 'Social'} Agent · Scoped to ${socialSource.workspaceName || 'connected account'} channels and direct messages`}
                </span>
              </>
            ) : (
            <>
              <h3 className="chat-head-title">Chat with project</h3>
              <span className="chat-head-sub">
                CrewAI Master Supervisor · Cross-platform agent with direct dispatch to Slack, Teams &amp; WhatsApp
              </span>
              {sources && sources.length > 0 && (() => {
                const seenChips = new Set<string>()
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    {sources
                      .filter(
                        (s) =>
                          s.enabled !== false &&
                          s.role !== 'ours' &&
                          (s.platform === 'slack' ||
                            s.platform === 'teams' ||
                            s.platform === 'whatsapp' ||
                            s.kind === 'token' ||
                            (s.kind === 'browser' && !s.url?.includes('google')))
                      )
                      .filter((s) => {
                        const plat = (s.platform || 'slack').toLowerCase()
                        const key = s.workspaceId ? `${plat}:${s.workspaceId}` : s.id
                        if (seenChips.has(key)) return false
                        seenChips.add(key)
                        return true
                      })
                      .map((s) => {
                        const plat = (s.platform || 'slack').toLowerCase()
                        const rawName = s.workspaceName?.trim()
                        const chipName =
                          rawName && rawName.toLowerCase() !== 'agentwork'
                            ? rawName
                            : plat === 'teams'
                              ? 'Teams'
                              : plat === 'whatsapp'
                                ? 'WhatsApp'
                                : 'Slack Workspace'
                        return (
                          <span
                            key={s.id}
                            style={{
                              fontSize: 10,
                              fontWeight: 650,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background:
                                plat === 'slack'
                                  ? 'rgba(168, 85, 247, 0.15)'
                                  : plat === 'teams'
                                    ? 'rgba(59, 130, 246, 0.15)'
                                    : 'rgba(34, 197, 94, 0.15)',
                              color:
                                plat === 'slack'
                                  ? '#c084fc'
                                  : plat === 'teams'
                                    ? '#93c5fd'
                                    : '#86efac',
                              border:
                                plat === 'slack'
                                  ? '1px solid rgba(168, 85, 247, 0.3)'
                                  : plat === 'teams'
                                    ? '1px solid rgba(59, 130, 246, 0.3)'
                                    : '1px solid rgba(34, 197, 94, 0.3)'
                            }}
                          >
                            {plat === 'slack' ? '⚡ Slack' : plat === 'teams' ? '👥 Teams' : '📱 WhatsApp'}: {chipName}
                          </span>
                        )
                      })}
                  </div>
                )
              })()}
            </>
          )}
        </div>
        <div className="chat-head-actions">
          {mode === 'social' && onOpenLiveEmbed && (
            <button
              type="button"
              className="chat-action-btn"
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 6,
                padding: '4px 10px',
                color: '#cbd5e1',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5
              }}
              onClick={onOpenLiveEmbed}
              title="Open live web embed view for this account"
            >
              <span>🌐</span>
              <span>Live Embed</span>
            </button>
          )}
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
              <p className="chat-empty-title">
                {activeChanDisplay
                  ? `Conversation in ${activeChanDisplay.fullName}`
                  : `Ask about ${projectName}`}
              </p>
              <p className="chat-empty-hint">
                {activeChanDisplay
                  ? 'No stored messages for this channel yet. Type a message below to start the conversation!'
                  : keyMissing
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
            const key = message.id || `${index}-${message.atIso}`
            const isClient = message.role === 'client'
            const isAuto = Boolean(message.isAutoReply)
            const isUser = message.role === 'user'
            const initialLetter = isClient
              ? (message.authorName.replace(/^[#@]+/, '').charAt(0) || 'C').toUpperCase()
              : ''
            return (
              <div
                className={`chat-msg is-${message.role}${isAuto ? ' is-auto-reply' : ''}${message.stopped ? ' is-stopped' : ''}`}
                key={key}
              >
                <div className="chat-msg-meta">
                  {isClient ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="chat-msg-avatar client-avatar">
                        {initialLetter}
                      </span>
                      <span style={{ color: '#a5b4fc', fontWeight: 650 }}>
                        {message.authorName}
                      </span>
                    </div>
                  ) : isAuto ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="chat-msg-avatar ai-avatar">
                        ⚡
                      </span>
                      <span style={{ color: '#4ade80', fontWeight: 700 }}>
                        Cosmic AI
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          background: 'rgba(34, 197, 94, 0.2)',
                          color: '#86efac',
                          padding: '1px 6px',
                          borderRadius: 3,
                          fontWeight: 700
                        }}
                      >
                        AUTO-REPLY (~150ms)
                      </span>
                    </div>
                  ) : isUser ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="chat-msg-avatar user-avatar">
                        Y
                      </span>
                      <span style={{ color: '#c084fc', fontWeight: 650 }}>
                        You
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          background: 'rgba(168, 85, 247, 0.2)',
                          color: '#e9d5ff',
                          padding: '1px 6px',
                          borderRadius: 3,
                          fontWeight: 700
                        }}
                      >
                        DIRECT API
                      </span>
                    </div>
                  ) : (
                    <span>{message.authorName}</span>
                  )}
                  <span>{timeLabel(message.atIso)}</span>
                  {message.pending ? <span style={{ color: '#fbbf24', fontSize: 10 }}>sending…</span> : null}
                  {message.failed ? <span style={{ color: '#f87171', fontSize: 10 }}>failed</span> : null}
                  {message.stopped ? <span>stopped</span> : null}
                </div>
                <div className="chat-bubble">
                  {message.role === 'assistant' && !isAuto ? (
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
                {message.role === 'assistant' && !isAuto ? (
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

      {mode === 'project' || socialSource || activeChannel ? (
        <div
          className="chat-composer-mode-bar"
          style={{ justifyContent: 'flex-end', padding: '4px 10px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 650 }}>Auto-Reply:</span>
              <select
                aria-label="Auto-Reply Policy"
                value={
                  mode === 'project'
                    ? masterPolicy
                    : activeChannel?.autoReplyPolicy || (activeChannel?.autoReply ? 'mention_dm' : 'disabled')
                }
                onChange={(e) => void handleUpdatePolicy(e.target.value as AutoReplyPolicy)}
                style={{
                  background: 'rgba(255, 255, 255, 0.07)',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  borderRadius: 4,
                  color: '#cbd5e1',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 6px',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                <option value="disabled" style={{ background: '#0f172a', color: '#94a3b8' }}>🛑 No Auto-Reply</option>
                <option value="all" style={{ background: '#0f172a', color: '#4ade80' }}>⚡ Reply to All</option>
                <option value="needs_reply" style={{ background: '#0f172a', color: '#60a5fa' }}>🧠 Smart Needs-Reply</option>
                <option value="task_only" style={{ background: '#0f172a', color: '#f59e0b' }}>📋 Task &amp; Project Only</option>
                <option value="mention_dm" style={{ background: '#0f172a', color: '#c084fc' }}>👤 Mention &amp; DM Only</option>
                <option value="draft_only" style={{ background: '#0f172a', color: '#f43f5e' }}>📝 Draft Approval Mode</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 650 }}>Tone:</span>
              <select
                aria-label="AI Response Persona"
                value={
                  mode === 'project'
                    ? masterPersona
                    : activeChannel?.autoReplyPersona || 'professional'
                }
                onChange={(e) => void handleUpdatePersona(e.target.value as AutoReplyPersona)}
                style={{
                  background: 'rgba(255, 255, 255, 0.07)',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  borderRadius: 4,
                  color: '#cbd5e1',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 6px',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                <option value="professional" style={{ background: '#0f172a', color: '#e2e8f0' }}>👔 Professional</option>
                <option value="friendly" style={{ background: '#0f172a', color: '#86efac' }}>😊 Friendly &amp; Warm</option>
                <option value="concise" style={{ background: '#0f172a', color: '#93c5fd' }}>⚡ Direct &amp; Concise</option>
                <option value="empathetic" style={{ background: '#0f172a', color: '#fbcfe8' }}>🤝 Empathetic ("Good Person")</option>
                <option value="technical" style={{ background: '#0f172a', color: '#fde047' }}>🛠️ Technical &amp; Detailed</option>
                <option value="executive" style={{ background: '#0f172a', color: '#c084fc' }}>📊 Executive Summary</option>
              </select>
            </div>
          </div>
        </div>
      ) : null}

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault()
          if (activeChannel && !isSlashCommandOrExplicitDispatch(draft)) {
            void sendDirectSlackReply()
          } else {
            void send()
          }
        }}
      >
        <div style={{ position: 'relative', width: '100%', flex: 1, display: 'flex' }}>
          <ComposerAutocompletePopover
            trigger={autocompleteTrigger}
            query={autocompleteQuery}
            sources={sources || (socialSource ? [socialSource] : [])}
            channels={socialSource?.channels || (activeChannel ? [activeChannel] : [])}
            isScoped={mode === 'social'}
            onSelect={handleSelectAutocomplete}
            onClose={() => setAutocompleteTrigger(null)}
          />
          <textarea
            ref={composerRef}
            value={draft}
            rows={1}
            aria-label="Ask about this project"
            placeholder={
              activeChanDisplay
                ? `Message ${activeChanDisplay.fullName} directly on Slack (type @ for accounts, # for channels, / for commands)…`
                : keyMissing
                  ? 'Add an AI key to start chatting'
                  : 'Ask about this project (type @ for accounts, # for channels, / for commands)…'
            }
            disabled={streaming || sendingReply || (!activeChannel && keyMissing)}
            onChange={(event) => handleDraftChange(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            onCompositionStart={() => {
              composingRef.current = true
            }}
            onCompositionEnd={() => {
              composingRef.current = false
            }}
          />
        </div>
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
            {sendingReply ? 'Sending…' : 'Send'}
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
  </div>
  )
}
