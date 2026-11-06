/**
 * FULL END-TO-END AUTOMATION TEST SUITE
 * ======================================
 * Tests every layer of the Slack browser-session automation pipeline:
 *
 *  Layer 1 — Selectors integrity (slack-selectors.ts)
 *  Layer 2 — DOM scripts are syntactically valid JS (slack-adapter.ts)
 *  Layer 3 — Normalizer: timestamps, text cleaning, dedup (normalizer.ts)
 *  Layer 4 — Adapter: detectState / listChannels / readVisibleMessages (mocked WebContentsView)
 *  Layer 5 — SlackReaderView: borrow-vs-create, navigation, state gate
 *  Layer 6 — SlackReaderToolkit: selfCheck result shape, scrollHistory no-throw
 *  Layer 7 — SlackPoller: pagination, thread expansion, rate-limit detection
 *  Layer 8 — RunLogStore: append → read roundtrip, corrupt line tolerance
 *  Layer 9 — DashboardSyncEngine.syncProjectSource: scrape → log → button reset
 *  Layer 10 — DashboardSyncEngine.syncProjectSource: error path still logs + emits run_finished
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

// ─── shared test fixtures ────────────────────────────────────────────────────

function makeMockView(overrides: Partial<{
  destroyed: boolean
  url: string
  jsResult: unknown
}> = {}) {
  const url = overrides.url ?? 'https://app.slack.com/client/T123/C123'
  const destroyed = overrides.destroyed ?? false
  const jsResult = overrides.jsResult ?? null

  return {
    webContents: {
      isDestroyed: () => destroyed,
      getURL: () => url,
      loadURL: vi.fn().mockResolvedValue(undefined),
      executeJavaScript: vi.fn().mockResolvedValue(jsResult),
      setBackgroundThrottling: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      close: vi.fn()
    },
    setBounds: vi.fn()
  }
}

// ─── LAYER 1: Selectors Integrity ────────────────────────────────────────────

import { SLACK_SELECTORS } from '../../src/main/slack-reader/slack-selectors'

describe('[L1] Selectors — all critical selectors are non-empty strings', () => {
  const requiredKeys: (keyof typeof SLACK_SELECTORS)[] = [
    'loggedInIndicator',
    'challengeIndicator',
    'channelListContainer',
    'channelItem',
    'channelName',
    'channelUnreadBadge',
    'messageListContainer',
    'messageRow',
    'messageSender',
    'messageTimestamp',
    'messageBody',
    'composerEditor',
    'composerSendButton'
  ]

  for (const key of requiredKeys) {
    it(`SLACK_SELECTORS.${key} is a non-empty string`, () => {
      const val = SLACK_SELECTORS[key]
      expect(typeof val).toBe('string')
      expect(val.length).toBeGreaterThan(0)
    })
  }

  it('loggedInIndicator includes data-qa workspace_navigation', () => {
    expect(SLACK_SELECTORS.loggedInIndicator).toContain('workspace_navigation')
  })

  it('challengeIndicator covers 2FA input', () => {
    expect(SLACK_SELECTORS.challengeIndicator).toContain('two_factor_auth_input')
  })

  it('messageRow covers data-qa message_container and virtual list item', () => {
    expect(SLACK_SELECTORS.messageRow).toContain('message_container')
    expect(SLACK_SELECTORS.messageRow).toContain('c-virtual_list__item')
  })

  it('composerEditor is restricted to contenteditable="true" for safety', () => {
    expect(SLACK_SELECTORS.composerEditor).toContain('contenteditable="true"')
  })
})

// ─── LAYER 2: DOM Scripts are valid JS ───────────────────────────────────────

import {
  DETECT_STATE_SCRIPT,
  LIST_CHANNELS_SCRIPT,
  READ_VISIBLE_MESSAGES_SCRIPT
} from '../../src/main/slack-reader/slack-adapter'

describe('[L2] DOM scripts — syntactically valid, no obvious injection vectors', () => {
  it('DETECT_STATE_SCRIPT is parseable JavaScript', () => {
    expect(() => new Function(DETECT_STATE_SCRIPT)).not.toThrow()
  })

  it('LIST_CHANNELS_SCRIPT is parseable JavaScript', () => {
    expect(() => new Function(LIST_CHANNELS_SCRIPT)).not.toThrow()
  })

  it('READ_VISIBLE_MESSAGES_SCRIPT is parseable JavaScript', () => {
    expect(() => new Function(READ_VISIBLE_MESSAGES_SCRIPT)).not.toThrow()
  })

  it('DETECT_STATE_SCRIPT returns string states only (no eval/exec)', () => {
    expect(DETECT_STATE_SCRIPT).not.toContain('eval(')
    expect(DETECT_STATE_SCRIPT).not.toContain('Function(')
    expect(DETECT_STATE_SCRIPT).toContain('logged_in')
    expect(DETECT_STATE_SCRIPT).toContain('needs_login')
    expect(DETECT_STATE_SCRIPT).toContain('challenge')
  })

  it('READ_VISIBLE_MESSAGES_SCRIPT does not type or send anything', () => {
    // Must NOT contain any mutation APIs
    expect(READ_VISIBLE_MESSAGES_SCRIPT).not.toContain('execCommand')
    expect(READ_VISIBLE_MESSAGES_SCRIPT).not.toContain('.click(')
    expect(READ_VISIBLE_MESSAGES_SCRIPT).not.toContain('.focus(')
    expect(READ_VISIBLE_MESSAGES_SCRIPT).not.toContain('dispatchEvent')
  })
})

// ─── LAYER 3: Normalizer ─────────────────────────────────────────────────────

import {
  normalizeSlackTimestamp,
  cleanMessageText,
  normalizeScrapedMessage,
  deduplicateMessages,
  type RawScrapedMessage
} from '../../src/main/slack-reader/normalizer'

describe('[L3] Normalizer', () => {
  describe('normalizeSlackTimestamp', () => {
    it('accepts full decimal Slack ts', () => {
      expect(normalizeSlackTimestamp('1730000000.123456')).toBe('1730000000.123456')
    })
    it('pads integer epoch', () => {
      expect(normalizeSlackTimestamp('1730000000')).toBe('1730000000.000000')
    })
    it('converts epoch ms number', () => {
      expect(normalizeSlackTimestamp(1730000000000)).toBe('1730000000.000000')
    })
    it('converts epoch ms string', () => {
      expect(normalizeSlackTimestamp('1730000000000')).toBe('1730000000.000000')
    })
    it('returns null for empty string', () => {
      expect(normalizeSlackTimestamp('')).toBeNull()
    })
    it('returns null for garbage', () => {
      expect(normalizeSlackTimestamp('today')).toBeNull()
    })
    it('returns null for undefined', () => {
      expect(normalizeSlackTimestamp(undefined)).toBeNull()
    })
    it('parses ISO date string', () => {
      const ts = normalizeSlackTimestamp('2024-10-29T00:00:00.000Z')
      expect(ts).not.toBeNull()
      expect(ts!).toMatch(/^\d{10}\.\d{6}$/)
    })
  })

  describe('cleanMessageText', () => {
    it('strips zero-width space', () => {
      expect(cleanMessageText('hello\u200Bworld')).toBe('hello world')
    })
    it('removes BOM', () => {
      expect(cleanMessageText('\uFEFFhello')).toBe('hello')
    })
    it('normalises CRLF to LF', () => {
      expect(cleanMessageText('a\r\nb')).toBe('a\nb')
    })
    it('collapses multiple spaces', () => {
      expect(cleanMessageText('a   b')).toBe('a b')
    })
    it('returns empty string for undefined', () => {
      expect(cleanMessageText(undefined)).toBe('')
    })
  })

  describe('normalizeScrapedMessage', () => {
    it('produces a valid DashboardStoredMessage for a fully formed raw message', () => {
      const raw: RawScrapedMessage = {
        rawTs: '1730000000.111111',
        sender: 'Priya',
        text: 'Staging deploy done.',
        permalink: 'https://example.slack.com/archives/C1/p1730000000111111'
      }
      const msg = normalizeScrapedMessage(raw, 'C1')
      expect(msg).not.toBeNull()
      expect(msg!.ts).toBe('1730000000.111111')
      expect(msg!.user).toBe('Priya')
      expect(msg!.text).toBe('Staging deploy done.')
      expect(msg!.source).toBe('client')
      expect(msg!.permalink).toBe('https://example.slack.com/archives/C1/p1730000000111111')
    })

    it('returns null when rawTs is missing (timestamp-must-exist rule)', () => {
      const raw: RawScrapedMessage = { rawTs: '', sender: 'Bob', text: 'hi' }
      expect(normalizeScrapedMessage(raw, 'C1')).toBeNull()
    })

    it('falls back to Anonymous when sender is missing', () => {
      const raw: RawScrapedMessage = { rawTs: '1730000000.000001', text: 'message' }
      const msg = normalizeScrapedMessage(raw, 'C1')
      expect(msg!.user).toBe('Anonymous')
    })

    it('preserves threadTs when present', () => {
      const raw: RawScrapedMessage = {
        rawTs: '1730000001.000000',
        threadTs: '1730000000.000000',
        sender: 'Ana',
        text: 'reply'
      }
      const msg = normalizeScrapedMessage(raw, 'C1')
      expect(msg!.threadTs).toBe('1730000000.000000')
    })

    it('preserves replyCount when > 0', () => {
      const raw: RawScrapedMessage = {
        rawTs: '1730000000.000002',
        sender: 'Sam',
        text: 'thread parent',
        replyCount: 3
      }
      const msg = normalizeScrapedMessage(raw, 'C1')
      expect(msg!.replyCount).toBe(3)
    })
  })

  describe('deduplicateMessages', () => {
    it('removes duplicates by (workspaceId, channelId, ts)', () => {
      const m1 = { ts: '1730000000.000001', user: 'A', text: 'first', source: 'client' as const }
      const m2 = { ts: '1730000000.000001', user: 'A', text: 'dup', source: 'client' as const }
      const m3 = { ts: '1730000000.000002', user: 'B', text: 'second', source: 'client' as const }
      const out = deduplicateMessages('T1', 'C1', [m1, m2, m3])
      expect(out).toHaveLength(2)
      expect(out[0]!.ts).toBe('1730000000.000001')
      expect(out[1]!.ts).toBe('1730000000.000002')
    })

    it('returns messages in ascending timestamp order', () => {
      const msgs = [
        { ts: '1730000003.000000', user: 'X', text: 'c', source: 'client' as const },
        { ts: '1730000001.000000', user: 'X', text: 'a', source: 'client' as const },
        { ts: '1730000002.000000', user: 'X', text: 'b', source: 'client' as const }
      ]
      const out = deduplicateMessages('T1', 'C1', msgs)
      expect(out.map((m) => m.ts)).toEqual([
        '1730000001.000000',
        '1730000002.000000',
        '1730000003.000000'
      ])
    })

    it('treats same ts in different channels as distinct messages', () => {
      const m = { ts: '1730000000.000001', user: 'A', text: 'msg', source: 'client' as const }
      const outC1 = deduplicateMessages('T1', 'C1', [m])
      const outC2 = deduplicateMessages('T1', 'C2', [m])
      expect(outC1).toHaveLength(1)
      expect(outC2).toHaveLength(1)
    })
  })
})

// ─── LAYER 4: SlackAdapter (mocked WebContentsView) ──────────────────────────

import { SlackAdapter } from '../../src/main/slack-reader/slack-adapter'

describe('[L4] SlackAdapter — mocked executeJavaScript', () => {
  let adapter: SlackAdapter

  beforeEach(() => {
    adapter = new SlackAdapter()
  })

  it('detectState returns logged_in when JS resolves with "logged_in"', async () => {
    const view = makeMockView({ jsResult: 'logged_in' })
    const state = await adapter.detectState(view as any)
    expect(state).toBe('logged_in')
  })

  it('detectState returns needs_login when JS resolves with "needs_login"', async () => {
    const view = makeMockView({ jsResult: 'needs_login' })
    const state = await adapter.detectState(view as any)
    expect(state).toBe('needs_login')
  })

  it('detectState returns challenge when JS resolves with "challenge"', async () => {
    const view = makeMockView({ jsResult: 'challenge' })
    const state = await adapter.detectState(view as any)
    expect(state).toBe('challenge')
  })

  it('detectState returns unknown when JS throws', async () => {
    const view = makeMockView()
    view.webContents.executeJavaScript = vi.fn().mockRejectedValue(new Error('renderer crash'))
    const state = await adapter.detectState(view as any)
    expect(state).toBe('unknown')
  })

  it('detectState returns unknown when view is destroyed', async () => {
    const view = makeMockView({ destroyed: true })
    const state = await adapter.detectState(view as any)
    expect(state).toBe('unknown')
  })

  it('listChannels returns array from JS', async () => {
    const channels = [
      { id: 'C001', name: 'general', isPrivate: false, hasUnread: true },
      { id: 'C002', name: 'engineering', isPrivate: false, hasUnread: false }
    ]
    const view = makeMockView({ jsResult: channels })
    const result = await adapter.listChannels(view as any)
    expect(result).toEqual(channels)
  })

  it('listChannels returns [] when view is destroyed', async () => {
    const view = makeMockView({ destroyed: true })
    const result = await adapter.listChannels(view as any)
    expect(result).toEqual([])
  })

  it('listChannels returns [] when JS throws', async () => {
    const view = makeMockView()
    view.webContents.executeJavaScript = vi.fn().mockRejectedValue(new Error('context error'))
    const result = await adapter.listChannels(view as any)
    expect(result).toEqual([])
  })

  it('readVisibleMessages returns normalized raw messages', async () => {
    const rawMsgs = [
      { rawTs: '1730000000.111111', sender: 'Alice', text: 'Deploy complete.' },
      { rawTs: '1730000001.000000', sender: 'Bob', text: 'LGTM.' }
    ]
    const view = makeMockView({ jsResult: rawMsgs })
    const result = await adapter.readVisibleMessages(view as any)
    expect(result).toHaveLength(2)
    expect(result[0]!.sender).toBe('Alice')
    expect(result[1]!.text).toBe('LGTM.')
  })

  it('readVisibleMessages returns [] for destroyed view', async () => {
    const view = makeMockView({ destroyed: true })
    const result = await adapter.readVisibleMessages(view as any)
    expect(result).toEqual([])
  })

  it('postMessageViaDom returns false for destroyed view', async () => {
    const view = makeMockView({ destroyed: true })
    const result = await adapter.postMessageViaDom(view as any, 'hello')
    expect(result).toBe(false)
  })

  it('postMessageViaDom returns boolean from JS', async () => {
    const view = makeMockView({ jsResult: true })
    const result = await adapter.postMessageViaDom(view as any, 'hello')
    expect(result).toBe(true)
  })

  it('postMessageViaDom returns false when JS throws', async () => {
    const view = makeMockView()
    view.webContents.executeJavaScript = vi.fn().mockRejectedValue(new Error('focus error'))
    const result = await adapter.postMessageViaDom(view as any, 'hello')
    expect(result).toBe(false)
  })
})

// ─── LAYER 5: SlackReaderView — borrow vs create, state-gate ─────────────────

import { SlackReaderView } from '../../src/main/slack-reader/slack-reader-view'

vi.mock('electron', () => ({
  WebContentsView: vi.fn().mockImplementation(() => makeMockView({ jsResult: 'logged_in' }))
}))

vi.mock('../../src/main/profiles/session-partition', () => ({
  partitionForProfile: (profileId: string, app: string) => `persist:${profileId}-${app}`,
  partitionForCard: (projectId: string, app: string) => `persist:card-${projectId}-${app}`
}))

vi.mock('../../src/main/logging', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

describe('[L5] SlackReaderView', () => {
  it('uses the existing view when one is provided (borrowed mode)', async () => {
    const existingView = makeMockView({ jsResult: 'logged_in' })
    const reader = new SlackReaderView({
      profileId: 'p1',
      workspaceId: 'T123',
      existingView: existingView as any
    })
    // Should borrow — not create a new WebContentsView
    const { WebContentsView } = await import('electron')
    const callsBefore = vi.mocked(WebContentsView).mock.calls.length
    await reader.initialize()
    expect(vi.mocked(WebContentsView).mock.calls.length).toBe(callsBefore) // no new constructor call
  })

  it('readChannelMessages returns [] when session state is not logged_in', async () => {
    const view = makeMockView({ jsResult: 'needs_login' })
    const reader = new SlackReaderView({
      profileId: 'p2',
      workspaceId: 'T456',
      existingView: view as any
    })
    const msgs = await reader.readChannelMessages('C789')
    expect(msgs).toEqual([])
  })

  it('readChannelMessages returns messages when logged in', async () => {
    const rawMsgs = [
      { rawTs: '1730000000.000001', sender: 'Priya', text: 'PR merged.' },
      { rawTs: '1730000000.000002', sender: 'Sam', text: 'Tests green.' }
    ]

    let callCount = 0
    const view = makeMockView()
    view.webContents.executeJavaScript = vi.fn().mockImplementation(() => {
      callCount++
      // First call → detectState, subsequent calls → readVisibleMessages or bounds
      if (callCount === 1) return Promise.resolve('logged_in')
      if (callCount === 2) return Promise.resolve(null) // bounds
      return Promise.resolve(rawMsgs)
    })

    const events: string[] = []
    const reader = new SlackReaderView({
      profileId: 'p3',
      workspaceId: 'T789',
      existingView: view as any,
      onEvent: (ev) => events.push(ev.type)
    })
    const msgs = await reader.readChannelMessages('C001')
    expect(msgs.length).toBeGreaterThan(0)
    expect(events).toContain('navigate')
    expect(events).toContain('status')
  })

  it('readChannelMessages on unnavigated view (about:blank) loads channel URL first', async () => {
    let url = 'about:blank'
    const view = makeMockView({ url })
    view.webContents.getURL = () => url
    view.webContents.loadURL = vi.fn().mockImplementation((newUrl: string) => {
      url = newUrl
      return Promise.resolve()
    })
    view.webContents.executeJavaScript = vi.fn().mockImplementation((code: string) => {
      if (code.includes('hasRows')) return Promise.resolve({ hasRows: true, hasComposer: true })
      if (url.includes('slack.com')) return Promise.resolve('logged_in')
      return Promise.resolve('unknown')
    })
    const reader = new SlackReaderView({
      profileId: 'p-blank',
      workspaceId: 'T123',
      existingView: view as any
    })
    await reader.readChannelMessages('C999')
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://app.slack.com/client/T123/C999')
  })

  it('readChannelMessages heals pending workspaceId and matches currentUrl containing channelId', async () => {
    let url = 'https://app.slack.com/client/TREAL123/C999'
    const view = makeMockView({ url })
    view.webContents.getURL = () => url
    view.webContents.loadURL = vi.fn().mockImplementation((newUrl: string) => {
      url = newUrl
      return Promise.resolve()
    })
    view.webContents.executeJavaScript = vi.fn().mockImplementation((code: string) => {
      if (code.includes('hasRows')) return Promise.resolve({ hasRows: true, hasComposer: true })
      if (url.includes('slack.com')) return Promise.resolve('logged_in')
      return Promise.resolve('unknown')
    })
    const reader = new SlackReaderView({
      profileId: 'p-heal',
      workspaceId: 'pending-proj-123',
      existingView: view as any
    })
    const msgs = await reader.readChannelMessages('C999')
    // Successfully extracted without failing target safety check
    expect(msgs).toBeDefined()
    // It should have resolved workspaceId from URL TREAL123 and not loaded URL because it already matches target C999
    expect(view.webContents.loadURL).not.toHaveBeenCalled()
  })

  it('destroy does not destroy a borrowed view', () => {
    const view = makeMockView({ jsResult: 'logged_in' })
    const reader = new SlackReaderView({
      profileId: 'p4',
      workspaceId: 'T1',
      existingView: view as any
    })
    reader.destroy()
    expect(view.webContents.close).not.toHaveBeenCalled()
  })

  it('postChannelMessage returns false when not logged in', async () => {
    const view = makeMockView({ jsResult: 'needs_login' })
    const reader = new SlackReaderView({
      profileId: 'p5',
      workspaceId: 'T1',
      existingView: view as any
    })
    const result = await reader.postChannelMessage('C1', 'hello')
    expect(result).toBe(false)
  })

  it('disables background throttling on borrowed and initialized views', async () => {
    const view = makeMockView({ jsResult: 'logged_in' })
    const reader = new SlackReaderView({
      profileId: 'p-throttle',
      workspaceId: 'T1',
      existingView: view as any
    })
    expect(view.webContents.setBackgroundThrottling).toHaveBeenCalledWith(false)
    await reader.initialize()
    expect(view.webContents.setBackgroundThrottling).toHaveBeenCalledWith(false)
  })

  it('readChannelMessages executes scrollToBottom before reading visible messages', async () => {
    const executedScripts: string[] = []
    const view = makeMockView({ url: 'https://app.slack.com/client/T1/C0CF72BSYKT' })
    view.webContents.executeJavaScript = vi.fn().mockImplementation((code: string) => {
      executedScripts.push(code)
      if (code.includes('hasRows')) return Promise.resolve({ hasRows: true, hasComposer: true })
      if (code.includes('scrollHeight')) return Promise.resolve(true)
      if (code.includes('c-message_kit__blocks') || code.includes('READ_VISIBLE_MESSAGES')) {
        return Promise.resolve([
          { rawTs: '1730000000.000001', sender: 'Alice', text: 'Newest bottom msg' }
        ])
      }
      return Promise.resolve('logged_in')
    })

    const reader = new SlackReaderView({
      profileId: 'p-scroll-bottom',
      workspaceId: 'T1',
      existingView: view as any
    })

    const msgs = await reader.readChannelMessages('C0CF72BSYKT')
    expect(msgs.length).toBe(1)
    const scrollBottomIndex = executedScripts.findIndex((s) => s.includes('scrollHeight'))
    const readMessagesIndex = executedScripts.findIndex(
      (s) => s.includes('c-message_kit__blocks') || s.includes('READ_VISIBLE_MESSAGES')
    )
    expect(scrollBottomIndex).toBeGreaterThan(-1)
    expect(readMessagesIndex).toBeGreaterThan(scrollBottomIndex)
  })

  it('readChannelWindow preserves messages when channelId is a slugified name', async () => {
    const view = makeMockView({ url: 'https://app.slack.com/client/T1/C0CF72BSYKT' })
    view.webContents.executeJavaScript = vi.fn().mockImplementation((code: string) => {
      if (code.includes('hasRows')) return Promise.resolve({ hasRows: true, hasComposer: true })
      if (code.includes('scrollHeight')) return Promise.resolve(true)
      if (code.includes('c-message_kit__blocks') || code.includes('READ_VISIBLE_MESSAGES')) {
        return Promise.resolve([
          {
            rawTs: '1730000000.000001',
            sender: 'Alice',
            text: 'General slug message',
            permalink: 'https://app.slack.com/client/T1/C0CF72BSYKT/p1730000000000001'
          }
        ])
      }
      return Promise.resolve('logged_in')
    })

    const reader = new SlackReaderView({
      profileId: 'p-slug',
      workspaceId: 'T1',
      existingView: view as any
    })

    // Passing 'general' (non-standard ID) should not drop messages with C0CF72BSYKT permalinks
    const result = await reader.readChannelWindow('general', { maxScrolls: 0 })
    expect(result.messages.length).toBe(1)
    expect(result.messages[0].text).toBe('General slug message')
  })
})

// ─── LAYER 6: SlackReaderToolkit ─────────────────────────────────────────────

import { SlackReaderToolkit } from '../../src/main/slack-reader/toolkit'

describe('[L6] SlackReaderToolkit', () => {
  let toolkit: SlackReaderToolkit

  beforeEach(() => {
    toolkit = new SlackReaderToolkit()
  })

  it('selfCheck: returns ok=true when sidebar PASS', async () => {
    const view = makeMockView({
      jsResult: { sidebar: 'PASS', messages: 'PASS', timestamps: 'PASS', senders: 'PASS' }
    })
    const result = await toolkit.selfCheck(view as any)
    expect(result.ok).toBe(true)
    expect(result.sidebar).toBe('PASS')
    expect(result.details).toContain('verified')
  })

  it('selfCheck: returns ok=false when sidebar FAIL', async () => {
    const view = makeMockView({
      jsResult: { sidebar: 'FAIL', messages: 'FAIL', timestamps: 'FAIL', senders: 'FAIL' }
    })
    const result = await toolkit.selfCheck(view as any)
    expect(result.ok).toBe(false)
  })

  it('selfCheck: returns ok=false when JS throws', async () => {
    const view = makeMockView()
    view.webContents.executeJavaScript = vi.fn().mockRejectedValue(new Error('context gone'))
    const result = await toolkit.selfCheck(view as any)
    expect(result.ok).toBe(false)
    expect(result.details).toContain('context gone')
  })

  it('scrollHistory does not throw when scroll container missing', async () => {
    const view = makeMockView({ jsResult: null })
    await expect(toolkit.scrollHistory(view as any)).resolves.toBeUndefined()
  })

  it('scrollHistory does not throw when JS throws', async () => {
    const view = makeMockView()
    view.webContents.executeJavaScript = vi.fn().mockRejectedValue(new Error('detached'))
    await expect(toolkit.scrollHistory(view as any)).resolves.toBeUndefined()
  })

  it('getSessionState delegates to adapter.detectState', async () => {
    const view = makeMockView({ jsResult: 'challenge' })
    const state = await toolkit.getSessionState(view as any)
    expect(state).toBe('challenge')
  })

  it('openChannel navigates when channel not already open', async () => {
    const view = makeMockView({ url: 'https://app.slack.com/client/T1/C_OTHER' })
    await toolkit.openChannel(view as any, 'T1', 'C_TARGET')
    expect(view.webContents.loadURL).toHaveBeenCalledWith(
      'https://app.slack.com/client/T1/C_TARGET'
    )
  })

  it('openChannel skips navigation when already on channel', async () => {
    const view = makeMockView({ url: 'https://app.slack.com/client/T1/C123' })
    await toolkit.openChannel(view as any, 'T1', 'C123')
    expect(view.webContents.loadURL).not.toHaveBeenCalled()
  })
})

// ─── LAYER 7: SlackPoller API layer ─────────────────────────────────────────

import {
  SlackPoller,
  isSlackAuthFailure,
  slackPermalink
} from '../../src/main/dashboard/slack-poller'

describe('[L7] SlackPoller', () => {
  it('isSlackAuthFailure: true for token_revoked', () => {
    const err = Object.assign(new Error('slack auth.test: token_revoked'), {
      slackError: 'token_revoked'
    })
    expect(isSlackAuthFailure(err)).toBe(true)
  })

  it('isSlackAuthFailure: true for invalid_auth', () => {
    const err = Object.assign(new Error('slack auth.test: invalid_auth'), {
      slackError: 'invalid_auth'
    })
    expect(isSlackAuthFailure(err)).toBe(true)
  })

  it('isSlackAuthFailure: false for network error (no slackError prop)', () => {
    expect(isSlackAuthFailure(new Error('ECONNREFUSED'))).toBe(false)
  })

  it('isSlackAuthFailure: false for non-error input', () => {
    expect(isSlackAuthFailure(null)).toBe(false)
    expect(isSlackAuthFailure('string error')).toBe(false)
  })

  it('slackPermalink: constructs correct archive URL', () => {
    const url = slackPermalink('https://acme.slack.com/', 'CABC', '1730000000.123456')
    expect(url).toBe('https://acme.slack.com/archives/CABC/p1730000000123456')
  })

  it('slackPermalink: returns undefined when teamUrl is null', () => {
    expect(slackPermalink(null, 'CABC', '1730000000.123456')).toBeUndefined()
  })

  it('slackPermalink: strips trailing slash from teamUrl (no double slash before /archives)', () => {
    const url = slackPermalink('https://acme.slack.com/', 'C1', '1730000000.000001')
    // The URL should not have a double-slash before /archives (protocol:// is fine)
    expect(url).not.toContain('//archives')
    expect(url).toContain('/archives/C1/')
  })

  it('fetchHistory: returns empty for fake base URL (offline guard)', async () => {
    const poller = new SlackPoller({ baseUrl: 'http://_FAKE.slack.com/' })
    const result = await poller.fetchHistory({ token: 'xoxb-fake', channelId: 'C1' })
    expect(result.messages).toEqual([])
    expect(result.hasMore).toBe(false)
  })

  it('postMessage: returns fake ts for fake base URL', async () => {
    const poller = new SlackPoller({ baseUrl: 'http://_FAKE.slack.com/' })
    const result = await poller.postMessage({ token: 'xoxb-fake', channelId: 'C1', text: 'hi' })
    expect(result.ts).toBeTruthy()
    expect(result.channelId).toBe('C1')
  })

  it('authTest: returns valid=true for fake base URL', async () => {
    const poller = new SlackPoller({ baseUrl: 'http://_FAKE.slack.com/' })
    const result = await poller.authTest('xoxb-fake')
    expect(result.valid).toBe(true)
    expect(result.teamId).toBe('FAKE_TEAM')
  })
})

// ─── LAYER 8: RunLogStore ────────────────────────────────────────────────────

import { RunLogStore, type RunLogEntry } from '../../src/main/dashboard/run-log-store'

describe('[L8] RunLogStore', () => {
  let tmpDir: string
  let store: RunLogStore

  beforeEach(() => {
    tmpDir = join(tmpdir(), `runlog-test-${randomUUID()}`)
    store = new RunLogStore({ rootDir: tmpDir })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  function makeEntry(overrides: Partial<RunLogEntry> = {}): RunLogEntry {
    const ts = new Date().toISOString()
    return {
      runId: `run-${randomUUID()}`,
      ts,
      startedAt: ts,
      trigger: 'manual',
      projectId: 'proj-1',
      projectName: 'Project 1',
      sourceId: 'src-1',
      sourceKind: 'browser',
      workspaceId: 'T123',
      workspaceName: 'Acme',
      channelsRead: 3,
      newMessages: 12,
      window: { startTs: '0', endTs: '1', backfillHours: 6 },
      channels: [],
      people: [],
      filters: { includeKinds: ['public', 'private'] },
      durationMs: 1234,
      llmCalls: 0,
      status: 'success',
      ...overrides
    }
  }

  it('round-trips a single run log entry correctly', async () => {
    const entry = makeEntry()
    await store.append(entry)
    const read = await store.read('proj-1')
    expect(read).toHaveLength(1)
    expect(read[0]!.runId).toBe(entry.runId)
    expect(read[0]!.channelsRead).toBe(3)
    expect(read[0]!.newMessages).toBe(12)
    expect(read[0]!.status).toBe('success')
  })

  it('returns entries in descending order (most recent first)', async () => {
    const e1 = makeEntry({ runId: 'run-001', ts: '2026-10-29T00:00:00Z' })
    const e2 = makeEntry({ runId: 'run-002', ts: '2026-10-29T01:00:00Z' })
    await store.append(e1)
    await store.append(e2)
    const entries = await store.read('proj-1')
    expect(entries[0]!.runId).toBe('run-002')
    expect(entries[1]!.runId).toBe('run-001')
  })

  it('stores snippets and errorCode', async () => {
    const entry = makeEntry({
      snippets: [{ channelId: 'C1', channelName: 'general', sender: 'Priya', ts: '1730000000.1', snippet: 'Deploy done.' }],
      errorCode: undefined,
      status: 'success'
    })
    await store.append(entry)
    const [read] = await store.read('proj-1')
    expect(read!.snippets).toHaveLength(1)
    expect(read!.snippets![0]!.snippet).toBe('Deploy done.')
  })

  it('read returns [] for non-existent project', async () => {
    const entries = await store.read('does-not-exist')
    expect(entries).toEqual([])
  })

  it('tolerates a corrupt JSONL line', async () => {
    const entry = makeEntry()
    await store.append(entry)
    // Manually corrupt the file by appending garbage
    const filePath = join(tmpDir, 'run-logs', 'proj-1.jsonl')
    const { appendFile } = await import('node:fs/promises')
    await appendFile(filePath, 'THIS IS NOT JSON\n', 'utf-8')
    const entries = await store.read('proj-1')
    // Valid entry should still be readable
    expect(entries.some((e) => e.runId === entry.runId)).toBe(true)
  })

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await store.append(makeEntry({ runId: `run-${i.toString().padStart(3, '0')}` }))
    }
    const limited = await store.read('proj-1', 3)
    expect(limited).toHaveLength(3)
  })

  it('appends successfully on the error path (adapter-broken)', async () => {
    const entry = makeEntry({ status: 'error', errorCode: 'network timeout' })
    await store.append(entry)
    const [read] = await store.read('proj-1')
    expect(read!.status).toBe('error')
    expect(read!.errorCode).toBe('network timeout')
  })
})

// ─── LAYER 9 & 10: DashboardSyncEngine.syncProjectSource ─────────────────────

import { DashboardSyncEngine, type DashboardSyncEngineDeps } from '../../src/main/dashboard/sync-engine'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

describe('[L9+L10] DashboardSyncEngine.syncProjectSource — E2E scrape pipeline', () => {
  let tmpDir: string
  let events: string[]

  beforeEach(() => {
    tmpDir = join(tmpdir(), `sync-e2e-${randomUUID()}`)
    events = []
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  function makeBrowserProject(overrides: Partial<DashboardProject> = {}): DashboardProject {
    return {
      id: 'proj-e2e',
      name: 'E2E Project',
      profileId: 'profile-1',
      teamId: 'T_CLIENT',
      monitors: [],
      sourcePreference: 'browser_only',
      sources: [
        {
          id: 'src-browser-1',
          kind: 'browser',
          enabled: true,
          profileId: 'profile-1',
          workspaceId: 'T_WORKSPACE',
          channelsReviewedAt: '2026-11-02T10:00:00.000Z',
          selectionMode: 'include',
          channels: [
            { id: 'C_GENERAL', name: 'general', enabled: true },
            { id: 'C_ENG', name: 'engineering', enabled: true }
          ]
        }
      ],
      ...overrides
    } as DashboardProject
  }

  function makeMinimalDeps(
    projectOverrides: Partial<DashboardProject> = {},
    readerMessages: Array<{ rawTs: string; sender: string; text: string }> = []
  ): DashboardSyncEngineDeps {
    const project = makeBrowserProject(projectOverrides)

    const deltaStore = {
      rootDir: tmpDir,
      appendMessages: vi.fn().mockResolvedValue({ added: readerMessages.length, cursor: '1730000000.000001', lastSyncAt: new Date().toISOString() }),
      readSnapshotMeta: vi.fn().mockResolvedValue(null)
    }

    const monitorStore = {
      listProjects: vi.fn().mockResolvedValue([project]),
      upsertProject: vi.fn().mockResolvedValue(undefined)
    }

    const oauthTokenProvider = {
      tryGet: vi.fn().mockResolvedValue(null)
    }

    return {
      monitorStore: monitorStore as any,
      deltaStore: deltaStore as any,
      oauthTokenProvider: oauthTokenProvider as any,
      log: vi.fn()
    }
  }

  it('[L9] happy path: scrapes 2 channels, logs run entry, emits run_finished', async () => {
    const rawMsgs = [
      { rawTs: '1730000000.000001', sender: 'Alice', text: 'Backend API merged.' },
      { rawTs: '1730000000.000002', sender: 'Bob', text: 'All tests green.' }
    ]

    // Stub SlackReaderView so we can control what readChannelMessages returns
    const { SlackReaderView: SRV } = await import('../../src/main/slack-reader/slack-reader-view')
    const readChannelMessagesMock = vi.fn().mockImplementation(async (_channelId: string) => {
      return rawMsgs.map((m) => ({
        ts: m.rawTs,
        user: m.sender,
        text: m.text,
        source: 'client' as const
      }))
    })
    vi.spyOn(SRV.prototype, 'readChannelMessages').mockImplementation(readChannelMessagesMock)
    vi.spyOn(SRV.prototype, 'destroy').mockImplementation(() => undefined)

    const deps = makeMinimalDeps({}, rawMsgs)
    const engine = new DashboardSyncEngine(deps)
    engine.setScrapeEventListener((ev) => events.push(ev.type))

    const result = await engine.syncProjectSource('proj-e2e')

    expect(result.status).toBe('success')
    expect(result.channelsRead).toBe(2) // 2 channels
    expect(events).toContain('run_finished') // button must always reset

    // Verify run log was written
    const logStore = new RunLogStore({ rootDir: tmpDir })
    const logs = await logStore.read('proj-e2e')
    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]!.sourceKind).toBe('browser')
    expect(logs[0]!.channelsRead).toBe(2)
    expect(logs[0]!.status).toBe('success')

    vi.restoreAllMocks()
  })

  it('[L10] error path: scrape throws → run_finished STILL emitted → log entry written with adapter-broken status', async () => {
    const { SlackReaderView: SRV } = await import('../../src/main/slack-reader/slack-reader-view')
    vi.spyOn(SRV.prototype, 'readChannelMessages').mockRejectedValue(new Error('renderer crashed'))
    vi.spyOn(SRV.prototype, 'destroy').mockImplementation(() => undefined)

    const deps = makeMinimalDeps()
    const engine = new DashboardSyncEngine(deps)
    engine.setScrapeEventListener((ev) => events.push(ev.type))

    void (await engine.syncProjectSource('proj-e2e'))

    // run_finished MUST be emitted (anti-stuck button guarantee)
    expect(events).toContain('run_finished')

    // Run log MUST be written even on error
    const logStore = new RunLogStore({ rootDir: tmpDir })
    const logs = await logStore.read('proj-e2e')
    expect(logs.length).toBeGreaterThan(0)
    expect(['error', 'partial']).toContain(logs[0]!.status)
    expect(logs[0]!.error ?? logs[0]!.errorCode ?? '').toContain('renderer crashed')

    vi.restoreAllMocks()
  })

  it('[L10] returns error when no browser sources exist on the project', async () => {
    const deps = makeMinimalDeps({ sources: [] })
    const engine = new DashboardSyncEngine(deps)
    const result = await engine.syncProjectSource('proj-e2e')
    expect(result.status).toBe('error')
    expect(result.error).toContain('No active browser sources')
  })

  it('[L10] returns error when project not found', async () => {
    const deps = makeMinimalDeps()
    ;(deps.monitorStore as any).listProjects = vi.fn().mockResolvedValue([])
    const engine = new DashboardSyncEngine(deps)
    const result = await engine.syncProjectSource('non-existent-id')
    expect(result.status).toBe('error')
    expect(result.error).toContain('Project not found')
  })

  it('[L9] run_finished event carries channel count and new message count', async () => {
    const { SlackReaderView: SRV } = await import('../../src/main/slack-reader/slack-reader-view')
    vi.spyOn(SRV.prototype, 'readChannelMessages').mockResolvedValue([
      { ts: '1730000000.000001', user: 'Sam', text: 'Deployment done.', source: 'client' }
    ])
    vi.spyOn(SRV.prototype, 'destroy').mockImplementation(() => undefined)

    const finishedEvents: string[] = []
    const deps = makeMinimalDeps()
    const engine = new DashboardSyncEngine(deps)
    engine.setScrapeEventListener((ev) => {
      if (ev.type === 'run_finished') {
        finishedEvents.push(ev.text ?? '')
      }
    })

    await engine.syncProjectSource('proj-e2e')

    expect(finishedEvents.length).toBeGreaterThan(0)
    expect(finishedEvents[0]).toContain('channels')

    vi.restoreAllMocks()
  })
})
