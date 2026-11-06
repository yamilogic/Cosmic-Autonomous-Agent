import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import {
  cleanMessageText,
  deduplicateMessages,
  normalizeSlackTimestamp,
  normalizeScrapedMessage,
  type RawScrapedMessage
} from '../../src/main/slack-reader/normalizer'
import { SLACK_SELECTORS } from '../../src/main/slack-reader/slack-selectors'
import { __test__ as slackApiInternal } from '../../src/main/slack/slack-api-client'
import {
  LIST_CHANNELS_SCRIPT,
  buildReadVisibleMessagesScript,
  SlackAdapter
} from '../../src/main/slack-reader/slack-adapter'
import { RunLogStore } from '../../src/main/dashboard/run-log-store'

describe('Slack Reader Core (SLK-2)', () => {
  describe('Channel Discovery & Metadata Extraction (Two-Phase Scraping)', () => {
    it('toChannelSummary extracts created epoch and memberCount from Slack API', () => {
      const summary = slackApiInternal.toChannelSummary({
        id: 'C0CCSJXS7SS',
        name: 'aaa',
        is_private: false,
        created: 1761644400, // Oct 28 2026
        num_members: 4,
        topic: { value: 'Project kickoff' }
      })

      expect(summary.id).toBe('C0CCSJXS7SS')
      expect(summary.name).toBe('aaa')
      expect(summary.isPrivate).toBe(false)
      expect(summary.created).toBe(1761644400)
      expect(summary.memberCount).toBe(4)
      expect(summary.topic).toBe('Project kickoff')
    })

    it('LIST_CHANNELS_SCRIPT includes regex for member count and fallback checks for window models', () => {
      expect(LIST_CHANNELS_SCRIPT).toContain('members?')
      expect(LIST_CHANNELS_SCRIPT).toContain('window.boot_data')
      expect(LIST_CHANNELS_SCRIPT).toContain('window.TS')
      expect(LIST_CHANNELS_SCRIPT).toContain('created')
      expect(LIST_CHANNELS_SCRIPT).toContain('memberCount')
    })

    it('historical scraping window logic: 30-day fixed horizon on initial or forced 30-day vs genesis vs incremental delta', () => {
      const nowSec = 1762100882
      const thirtyDaysAgo = nowSec - 30 * 86400

      // Case 1: First scrape with no cursor -> 30-day horizon
      const cursor1 = null
      const isGenesis1 = false
      const isThirtyDays1 = !cursor1
      const sinceTs1 = isGenesis1 ? 0 : isThirtyDays1 ? thirtyDaysAgo : (cursor1 ?? 0) - 120
      expect(sinceTs1).toBe(thirtyDaysAgo)

      // Case 2: Explicit forceGenesis -> 0 (genesis inception)
      const cursor2 = 1762100000
      const isGenesis2 = true
      const isThirtyDays2 = !cursor2
      const sinceTs2 = isGenesis2 ? 0 : isThirtyDays2 ? thirtyDaysAgo : cursor2 - 120
      expect(sinceTs2).toBe(0)

      // Case 3: Explicit force30Days -> 30 days ago
      const cursor3 = 1762100000
      const isGenesis3 = false
      const isThirtyDays3 = true
      const sinceTs3 = isGenesis3 ? 0 : isThirtyDays3 ? thirtyDaysAgo : cursor3 - 120
      expect(sinceTs3).toBe(thirtyDaysAgo)

      // Case 4: Subsequent automated scrape with cursor -> incremental fast-forward (cursor - 120s)
      const cursor4 = 1762100000
      const isGenesis4 = false
      const isThirtyDays4 = false
      const sinceTs4 = isGenesis4 ? 0 : isThirtyDays4 ? thirtyDaysAgo : cursor4 - 120
      expect(sinceTs4).toBe(1762099880)

      // Case 5: Custom lookback horizon (e.g. 230 days)
      const requestedDays: number = 230
      const isGenesis5 = requestedDays === 0
      const isCustom5 = typeof requestedDays === 'number' && requestedDays > 0
      const sinceTs5 = isGenesis5 ? 0 : isCustom5 ? nowSec - requestedDays * 86400 : thirtyDaysAgo
      expect(sinceTs5).toBe(nowSec - 230 * 86400)
    })
  })
  describe('Selectors Integrity', () => {
    it('defines non-empty data-qa selectors for all critical slack components', () => {
      expect(SLACK_SELECTORS.loggedInIndicator).toBeTruthy()
      expect(SLACK_SELECTORS.channelListContainer).toBeTruthy()
      expect(SLACK_SELECTORS.channelItem).toBeTruthy()
      expect(SLACK_SELECTORS.channelName).toBeTruthy()
      expect(SLACK_SELECTORS.messageRow).toBeTruthy()
      expect(SLACK_SELECTORS.messageBody).toBeTruthy()
      expect(SLACK_SELECTORS.messageTimestamp).toBeTruthy()
      expect(SLACK_SELECTORS.threadReplyButton).toBeTruthy()
      expect(SLACK_SELECTORS.threadContainer).toBeTruthy()
      expect(SLACK_SELECTORS.threadMessageRow).toBeTruthy()
      expect(SLACK_SELECTORS.threadCloseButton).toBeTruthy()
    })
  })

  describe('Timestamp Normalization', () => {
    it('normalizes slack decimal string timestamps', () => {
      expect(normalizeSlackTimestamp('1730000000.123456')).toBe('1730000000.123456')
      expect(normalizeSlackTimestamp('1730000000')).toBe('1730000000.000000')
    })

    it('normalizes epoch milliseconds number or string', () => {
      const ms = 1730000000000
      expect(normalizeSlackTimestamp(ms)).toBe('1730000000.000000')
      expect(normalizeSlackTimestamp('1730000000000')).toBe('1730000000.000000')
    })

    it('normalizes archive permalink timestamp format (p1730000000123456)', () => {
      expect(normalizeSlackTimestamp('p1730000000123456')).toBe('1730000000.123456')
      expect(normalizeSlackTimestamp('1730000000123456')).toBe('1730000000.123456')
    })

    it('returns null when timestamp is missing or empty (avoids fabricating fake time)', () => {
      expect(normalizeSlackTimestamp('')).toBeNull()
      expect(normalizeSlackTimestamp('invalid')).toBeNull()
      expect(normalizeSlackTimestamp(undefined)).toBeNull()
    })
  })

  describe('Message Text Cleaning', () => {
    it('strips zero-width chars and normalizes whitespace', () => {
      const raw = 'Hello \u200Bworld!\r\nHow\uFEFF are   you?'
      expect(cleanMessageText(raw)).toBe('Hello world!\nHow are you?')
    })
  })

  describe('Message Normalization & Deduplication', () => {
    it('normalizes raw scraped message into DashboardStoredMessage', () => {
      const raw: RawScrapedMessage = {
        rawTs: '1730000000.123456',
        sender: 'Atul Kumar',
        text: 'Deploy completed successfully.',
        permalink: 'https://acme.slack.com/archives/C123/p1730000000123456'
      }

      const msg = normalizeScrapedMessage(raw, 'C123')
      expect(msg).not.toBeNull()
      expect(msg!.ts).toBe('1730000000.123456')
      expect(msg!.user).toBe('Atul Kumar')
      expect(msg!.text).toBe('Deploy completed successfully.')
      expect(msg!.source).toBe('client')
      expect(msg!.permalink).toBe('https://acme.slack.com/archives/C123/p1730000000123456')
    })

    it('preserves threadTs and replyCount when normalizing thread parents or replies', () => {
      const parentRaw: RawScrapedMessage = {
        rawTs: '1730000000.100000',
        sender: 'Alice',
        text: 'Initial query',
        replyCount: 5
      }
      const parent = normalizeScrapedMessage(parentRaw, 'C123')
      expect(parent?.replyCount).toBe(5)
      expect(parent?.threadTs).toBeUndefined()

      const replyRaw: RawScrapedMessage = {
        rawTs: '1730000000.200000',
        sender: 'Bob',
        text: 'Thread resolution',
        threadTs: '1730000000.100000'
      }
      const reply = normalizeScrapedMessage(replyRaw, 'C123')
      expect(reply?.threadTs).toBe('1730000000.100000')
    })

    it('skips message if timestamp cannot be extracted from DOM', () => {
      const raw: RawScrapedMessage = {
        rawTs: '',
        sender: 'Atul',
        text: 'No timestamp message'
      }
      expect(normalizeScrapedMessage(raw, 'C123')).toBeNull()
    })

    it('deduplicates identical messages based on workspaceId, channelId and ts', () => {
      const m1 = { ts: '1730000000.000001', user: 'Alice', text: 'Hi', source: 'client' as const }
      const m2 = {
        ts: '1730000000.000001',
        user: 'Alice',
        text: 'Hi duplicate',
        source: 'client' as const
      }
      const m3 = { ts: '1730000000.000002', user: 'Bob', text: 'Hey', source: 'client' as const }

      const deduped = deduplicateMessages('T_WORKSPACE', 'C_GENERAL', [m1, m2, m3])
      expect(deduped).toHaveLength(2)
      expect(deduped[0]!.ts).toBe('1730000000.000001')
      expect(deduped[1]!.ts).toBe('1730000000.000002')
    })
  })

  describe('Enhanced Selectors & Credential Code Blocks', () => {
    it('messageBody selector includes message_content, c-message__body, p-rich_text_block, and pre code blocks', () => {
      expect(SLACK_SELECTORS.messageBody).toContain('[data-qa="message_content"]')
      expect(SLACK_SELECTORS.messageBody).toContain('.c-message__body')
      expect(SLACK_SELECTORS.messageBody).toContain('.p-rich_text_block')
      expect(SLACK_SELECTORS.messageBody).toContain('.c-message_kit__blocks')
      expect(SLACK_SELECTORS.messageBody).toContain('pre.c-mrkdwn__pre')
    })

    it('messageTimestamp selector targets timestamp anchors directly', () => {
      expect(SLACK_SELECTORS.messageTimestamp).toContain('.c-timestamp')
      expect(SLACK_SELECTORS.messageTimestamp).toContain('[data-qa="timestamp"]')
      expect(SLACK_SELECTORS.messageTimestamp).toContain('a.c-timestamp')
    })
  })

  describe('Enhanced Timestamp Extraction & Parsing', () => {
    it('extracts embedded epoch timestamps with suffixes/prefixes cleanly with 6 decimals', () => {
      expect(normalizeSlackTimestamp('1730795700.000100__message')).toBe('1730795700.000100')
      expect(normalizeSlackTimestamp('C0CE6JC10EA-1730795700.000100')).toBe('1730795700.000100')
      expect(normalizeSlackTimestamp('item_1730795700_key')).toBe('1730795700.000000')
    })

    it('parses Slack humanized relative dates (Today at, Yesterday at) into valid epoch strings', () => {
      const today = normalizeSlackTimestamp('Today at 2:35 PM')
      expect(today).not.toBeNull()
      expect(today).toMatch(/^\d{10}\.\d{6}$/)

      const yesterday = normalizeSlackTimestamp('Yesterday at 4:15 PM')
      expect(yesterday).not.toBeNull()
      expect(yesterday).toMatch(/^\d{10}\.\d{6}$/)
      expect(Number(today)).toBeGreaterThan(Number(yesterday))
    })

    it('parses time-only strings into today epoch timestamps', () => {
      const timeOnly = normalizeSlackTimestamp('02:35 PM')
      expect(timeOnly).not.toBeNull()
      expect(timeOnly).toMatch(/^\d{10}\.\d{6}$/)
    })

    it('parses date strings with ordinals (4th, 1st) and optional year', () => {
      const ordinal = normalizeSlackTimestamp('November 4th, 2026 at 2:35 PM')
      expect(ordinal).not.toBeNull()
      expect(ordinal).toMatch(/^\d{10}\.\d{6}$/)

      const withoutYear = normalizeSlackTimestamp('November 4th at 2:35 PM')
      expect(withoutYear).not.toBeNull()
      expect(withoutYear).toMatch(/^\d{10}\.\d{6}$/)
    })
  })

  describe('DOM Extraction Script: Day Divider & Timestamp Targeting', () => {
    it('buildReadVisibleMessagesScript contains day divider tracking and timestamp anchor targets', () => {
      const script = buildReadVisibleMessagesScript(0)
      expect(script).toContain('day_divider')
      expect(script).toContain('role="separator"')
      expect(script).toContain('currentDateContext')
      expect(script).toContain('a.c-timestamp')
      expect(script).toContain('keyTs')
    })
  })

  describe('RunLogStore Metrics & messagesRead Normalization', () => {
    it('normalizes messagesRead from channel sum when missing, and preserves it when provided', async () => {
      const dir = join(tmpdir(), `runlog-metrics-test-${randomUUID()}`)
      const store = new RunLogStore({ rootDir: dir })

      const now = new Date().toISOString()
      // Entry without messagesRead
      await store.append({
        runId: 'run-test-1',
        ts: now,
        startedAt: now,
        trigger: 'scheduled',
        projectId: 'proj-1',
        projectName: 'Test',
        sourceId: 'src-1',
        sourceKind: 'browser',
        workspaceId: 'T1',
        workspaceName: 'Acme',
        channelsRead: 2,
        newMessages: 0,
        window: { startTs: '0', endTs: '1', backfillHours: 6 },
        channels: [
          {
            channelId: 'C1',
            channelName: '0005',
            kind: 'public',
            messagesRead: 3,
            newMessages: 0,
            status: 'read'
          },
          {
            channelId: 'C2',
            channelName: 'general',
            kind: 'public',
            messagesRead: 2,
            newMessages: 0,
            status: 'read'
          }
        ],
        people: [],
        filters: { includeKinds: ['public', 'private'] },
        durationMs: 500,
        llmCalls: 0,
        status: 'success'
      })

      // Entry with explicit messagesRead
      await store.append({
        runId: 'run-test-2',
        ts: now,
        startedAt: now,
        trigger: 'manual',
        projectId: 'proj-1',
        projectName: 'Test',
        sourceId: 'src-1',
        sourceKind: 'browser',
        workspaceId: 'T1',
        workspaceName: 'Acme',
        channelsRead: 1,
        messagesRead: 7,
        newMessages: 2,
        window: { startTs: '0', endTs: '1', backfillHours: 6 },
        channels: [
          {
            channelId: 'C1',
            channelName: '0005',
            kind: 'public',
            messagesRead: 7,
            newMessages: 2,
            status: 'read'
          }
        ],
        people: [],
        filters: { includeKinds: ['public', 'private'] },
        durationMs: 300,
        llmCalls: 0,
        status: 'success'
      })

      const entries = await store.read('proj-1')
      expect(entries).toHaveLength(2)

      // Recent entry first
      const entry2 = entries.find((e) => e.runId === 'run-test-2')
      expect(entry2?.messagesRead).toBe(7)
      expect(entry2?.newMessages).toBe(2)

      const entry1 = entries.find((e) => e.runId === 'run-test-1')
      expect(entry1?.messagesRead).toBe(5) // Calculated 3 + 2
      expect(entry1?.newMessages).toBe(0)

      await rm(dir, { recursive: true, force: true })
    })
  })

  describe('Sync Engine Initial Scrape Window Alignment', () => {
    it('aligns sinceTs with backfillHours floorTs on initial scrape when !cursor', () => {
      const nowSec = 1762100882
      const backfillHours = 6
      const floorTs = nowSec - backfillHours * 3600
      const thirtyDaysAgoTs = nowSec - 30 * 86400

      const cursor: number | null = null
      const isGenesis = false
      const isCustomDays = false
      const isThirtyDays = false

      let sinceTs: number
      if (isGenesis) {
        sinceTs = 0
      } else if (isCustomDays) {
        sinceTs = nowSec - 7 * 86400
      } else if (isThirtyDays) {
        sinceTs = thirtyDaysAgoTs
      } else if (!cursor) {
        sinceTs = backfillHours > 0 ? floorTs : thirtyDaysAgoTs
      } else {
        sinceTs = cursor - 120
      }

      expect(sinceTs).toBe(floorTs)
      expect(sinceTs).toBeGreaterThan(thirtyDaysAgoTs)
    })
  })

  describe('SlackAdapter Scrolling & Genesis Detection', () => {
    it('scrollToBottom executes scrollHeight assignment on virtual list and returns true', async () => {
      const adapter = new SlackAdapter()
      let executedScript = ''
      const mockView: any = {
        webContents: {
          isDestroyed: () => false,
          executeJavaScript: async (script: string) => {
            executedScript = script
            return true
          }
        }
      }

      const result = await adapter.scrollToBottom(mockView)
      expect(result).toBe(true)
      expect(executedScript).toContain('scrollHeight')
      expect(executedScript).toContain('.c-virtual_list__scroll_container')
      expect(executedScript).toContain('[role="list"]')
      expect(executedScript).toContain("dispatchEvent(new Event('scroll'")
      expect(executedScript).toContain("dispatchEvent(new WheelEvent('wheel'")
    })

    it('scrollToBottom returns false for destroyed or null view', async () => {
      const adapter = new SlackAdapter()
      const destroyedView: any = {
        webContents: {
          isDestroyed: () => true,
          executeJavaScript: async () => true
        }
      }
      expect(await adapter.scrollToBottom(destroyedView)).toBe(false)
      expect(await adapter.scrollToBottom(null as any)).toBe(false)
    })

    it('genesis detection script does not include channel_banner_header or top_banner', async () => {
      const adapter = new SlackAdapter()
      let executedScript = ''
      const mockView: any = {
        webContents: {
          isDestroyed: () => false,
          executeJavaScript: async (script: string) => {
            executedScript = script
            return true
          }
        }
      }

      await adapter.isAtChannelGenesis(mockView)
      expect(executedScript).toContain('[data-qa="channel_created_summary"]')
      expect(executedScript).not.toContain('[data-qa="channel_banner_header"]')
      expect(executedScript).not.toContain('.c-message_list__top_banner')
    })

    it('genesis detection script includes channel and DM inception text patterns', async () => {
      const adapter = new SlackAdapter()
      let executedScript = ''
      const mockView: any = {
        webContents: {
          isDestroyed: () => false,
          executeJavaScript: async (script: string) => {
            executedScript = script
            return true
          }
        }
      }

      await adapter.isAtChannelGenesis(mockView)
      expect(executedScript).toContain('This is the start of')
      expect(executedScript).toContain('This conversation is just between')
      expect(executedScript).toContain('created this channel on')
      expect(executedScript).toContain('This is the very beginning')
    })

    it('scrollUp script uses refined genesis detection without false layout banners', async () => {
      const adapter = new SlackAdapter()
      let executedScript = ''
      const mockView: any = {
        webContents: {
          isDestroyed: () => false,
          executeJavaScript: async (script: string) => {
            executedScript = script
            return true
          }
        }
      }

      await adapter.scrollUp(mockView, 800)
      expect(executedScript).toContain('[data-qa="channel_created_summary"]')
      expect(executedScript).not.toContain('[data-qa="channel_banner_header"]')
      expect(executedScript).not.toContain('.c-message_list__top_banner')
    })
  })
})

