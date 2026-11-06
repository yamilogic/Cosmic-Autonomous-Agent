import type { WebContentsView } from 'electron'
import { SLACK_SELECTORS } from './slack-selectors'
import type { RawScrapedMessage } from './normalizer'

export type SlackSessionState = 'logged_in' | 'needs_login' | 'challenge' | 'unknown'

export interface ScrapedChannelItem {
  id: string
  name: string
  isPrivate: boolean
  isDm?: boolean
  hasUnread: boolean
  created?: number
  memberCount?: number
}

/**
 * Passive, read-only script evaluated in the page context to detect authentication/session state.
 */
export const DETECT_STATE_SCRIPT = `
(function() {
  const url = window.location.href;
  if (url.includes('/signin') || url.includes('/oauth')) {
    return 'needs_login';
  }
  if (document.querySelector('${SLACK_SELECTORS.challengeIndicator}')) {
    return 'challenge';
  }
  if (
    url.includes('/client/') ||
    url.includes('/messages/') ||
    document.querySelector('${SLACK_SELECTORS.loggedInIndicator}')
  ) {
    return 'logged_in';
  }
  return 'unknown';
})()
`

/**
 * Passive script to list channels and their unread status from the sidebar DOM.
 */
export const LIST_CHANNELS_SCRIPT = `
(function() {
  const channels = [];
  const seenIds = new Set();
  const items = document.querySelectorAll('${SLACK_SELECTORS.channelItem}');
  items.forEach((item) => {
    // Detect if this is a direct message container or user row
    const isUserItem =
      item.classList.contains('p-channel_sidebar__item--user') ||
      Boolean(item.querySelector('[data-qa-channel-sidebar-item="user"]')) ||
      Boolean(item.closest('[data-qa="channel_sidebar_section_users"]')) ||
      Boolean(item.closest('[data-qa="channel_sidebar_section_dms"]'));

    const nameEl = item.querySelector('${SLACK_SELECTORS.channelName}');
    const badgeEl = item.querySelector('${SLACK_SELECTORS.channelUnreadBadge}');
    const linkEl = item.querySelector('a[href]');
    const name = nameEl ? nameEl.textContent.trim() : (item.textContent || '').trim().split('\\n')[0].trim();
    if (!name) return;

    let id = '';
    // Priority 1: Official data-qa attribute on item or link (e.g. data-qa-channel-sidebar-channel-id="C0123...")
    const dataQaId =
      item.getAttribute('data-qa-channel-sidebar-channel-id') ||
      (linkEl ? linkEl.getAttribute('data-qa-channel-sidebar-channel-id') : '') ||
      item.getAttribute('data-channel-id') ||
      (linkEl ? linkEl.getAttribute('data-channel-id') : '');

    if (dataQaId) {
      id = dataQaId.trim();
    } else {
      // Priority 2: Standard Slack client URL structure (/messages/ID or /client/T.../ID)
      const href = linkEl ? linkEl.getAttribute('href') || '' : '';
      const match = href.match(/\\/messages\\/([^/?]+)/) || href.match(/\\/client\\/[^/]+\\/([^/?]+)/);
      if (match && match[1]) {
        id = match[1];
      } else {
        // Priority 3: data-item-key or role attributes
        const itemKey = item.getAttribute('data-item-key') || '';
        const keyMatch = itemKey.match(/([CGD][A-Z0-9]{8,12})/);
        if (keyMatch) {
          id = keyMatch[1];
        } else {
          id = name.toLowerCase().replace(/[^a-z0-9-_]/g, '');
        }
      }
    }

    if (!id || seenIds.has(id)) return;
    seenIds.add(id);

    const ariaLabel = item.getAttribute('aria-label') || '';
    const isPrivate =
      ariaLabel.toLowerCase().includes('private') ||
      name.startsWith('🔒') ||
      id.startsWith('G') ||
      Boolean(item.querySelector('[data-qa="channel_icon_private"]')) ||
      Boolean(item.querySelector('.c-icon--lock'));

    const isDm = isUserItem || id.startsWith('D') || ariaLabel.toLowerCase().includes('direct message');

    let memberCount = undefined;
    let created = undefined;
    const memberMatch = ariaLabel.match(/(\\d+)\\s+members?/i);
    if (memberMatch) {
      memberCount = parseInt(memberMatch[1], 10);
    }
    try {
      if (window.boot_data && window.boot_data.channels) {
        const found = window.boot_data.channels.find((c) => c.id === id);
        if (found) {
          if (found.num_members) memberCount = found.num_members;
          if (found.created) created = found.created;
        }
      } else if (window.TS && window.TS.model && window.TS.model.channels) {
        const found = window.TS.model.channels.get(id);
        if (found) {
          if (found.num_members) memberCount = found.num_members;
          if (found.created) created = found.created;
        }
      }
    } catch (_) {}

    channels.push({
      id,
      name,
      isPrivate,
      isDm,
      hasUnread: Boolean(badgeEl),
      created,
      memberCount
    });
  });
  return channels;
})()
`

/**
 * Passive script to read visible messages from the virtualized message list DOM.
 * Performs ZERO typing, ZERO sending, ZERO clicking.
 * `sinceTs` is an epoch-seconds floor (0 = no floor, so the caller can page
 * backwards through history instead of being pinned to the last hour).
 */
export function buildReadVisibleMessagesScript(sinceTs = 0): string {
  const floor = Number.isFinite(sinceTs) && sinceTs > 0 ? sinceTs : 0
  return `
(function() {
  const container = document.querySelector('${SLACK_SELECTORS.messageListContainer}') || document.body;
  const elements = container.querySelectorAll('${SLACK_SELECTORS.messageRow}, .c-message_list__day_divider, [data-qa="day_divider"], [role="separator"]');
  const results = [];
  let lastAuthor = null;
  let currentDateContext = '';
  const sinceTs = ${floor};

  elements.forEach((el) => {
    // Check if this is a day divider
    if (el.matches('.c-message_list__day_divider, [data-qa="day_divider"], [role="separator"]') || el.classList.contains('c-message_list__day_divider')) {
      const labelEl = el.querySelector('.c-message_list__day_divider__label__pill, [data-qa="day_divider_label"]') || el;
      const dateText = (labelEl.textContent || '').trim();
      if (dateText) {
        currentDateContext = dateText;
      }
      return;
    }

    const row = el;
    const senderEl = row.querySelector('${SLACK_SELECTORS.messageSender}');
    const tsEl = row.querySelector('${SLACK_SELECTORS.messageTimestamp}');
    const tsAnchor =
      (tsEl && tsEl.tagName === 'A' ? tsEl : null) ||
      (tsEl ? tsEl.closest('a') || tsEl.querySelector('a') : null) ||
      row.querySelector('a.c-timestamp, [data-qa="timestamp"] a, .c-timestamp__link');
    const bodyEl = row.querySelector('${SLACK_SELECTORS.messageBody}');

    // If an author header exists on this row, update lastAuthor
    if (senderEl) {
      const authorText = senderEl.textContent.trim();
      if (authorText) {
        lastAuthor = authorText;
      }
    }

    // Extract permalink if present specifically on timestamp anchor
    const permalink = tsAnchor ? (tsAnchor.getAttribute('href') || '') : '';

    // Extract exact timestamp from data-ts, data-item-key, archives permalink, or ts element
    let pTs = '';
    if (permalink && permalink.indexOf('/p') !== -1) {
      const pIdx = permalink.lastIndexOf('/p');
      const pDigits = permalink.slice(pIdx + 2).replace(/[^0-9]/g, '');
      if (pDigits.length >= 16) {
        pTs = pDigits.slice(0, 10) + '.' + pDigits.slice(10, 16);
      }
    }

    let keyTs = '';
    const itemKey = row.getAttribute('data-item-key') || (row.closest('.c-virtual_list__item') ? row.closest('.c-virtual_list__item').getAttribute('data-item-key') : '') || '';
    if (itemKey) {
      const match = itemKey.match(/(\\d{10}(?:\\.\\d+)?)/);
      if (match) {
        keyTs = match[1];
      }
    }

    let rawTs =
      (tsEl ? tsEl.getAttribute('data-ts') : '') ||
      (row.getAttribute('data-ts') || '') ||
      keyTs ||
      pTs ||
      (tsEl ? (tsEl.getAttribute('aria-label') || tsEl.getAttribute('title') || tsEl.getAttribute('datetime') || '') : '');

    if (!rawTs && tsEl) {
      const timeText = (tsEl.textContent || '').trim();
      if (timeText) {
        rawTs = currentDateContext && !timeText.includes(currentDateContext) ? (currentDateContext + ' at ' + timeText) : timeText;
      }
    } else if (rawTs && currentDateContext && /^\\d{1,2}:\\d{2}/.test(rawTs) && !rawTs.includes(currentDateContext)) {
      rawTs = currentDateContext + ' at ' + rawTs;
    }

    const sender = lastAuthor || 'Anonymous';

    // Extract attachments, files (e.g. Word .docx, pdfs, images)
    const attachmentEls = row.querySelectorAll(
      '[data-qa="file_container"], .c-file_container, .c-file__title, .p-file_title, [data-qa="file_title"], .c-message_attachment, a[href*="/files/"]'
    );
    const fileNames = [];
    attachmentEls.forEach((att) => {
      const titleEl = att.querySelector('.c-file__title, [data-qa="file_title"], .p-file_title') || att;
      const fName = (titleEl.textContent || titleEl.innerText || '').trim();
      if (fName && fileNames.indexOf(fName) === -1 && fName.indexOf(String.fromCharCode(10)) === -1 && fName.length < 200) {
        fileNames.push(fName);
      }
    });

    let text = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '').trim() : '';
    if (fileNames.length > 0) {
      const fileText = fileNames.map((fn) => '[Document: ' + fn + ']').join(' ');
      text = text ? text + ' ' + fileText : fileText;
    }

    // Extract thread replies count and threadTs if present
    const replyBtn = row.querySelector('${SLACK_SELECTORS.threadReplyButton}');
    let replyCount = undefined;
    if (replyBtn) {
      const match = (replyBtn.textContent || '').match(/(\\d+)\\s+repl/i);
      replyCount = match ? parseInt(match[1], 10) : 1;
    }

    let threadTs = undefined;
    if (permalink) {
      const threadMatch = permalink.match(/[?&]thread_ts=([0-9.]+)/);
      if (threadMatch) {
        threadTs = threadMatch[1];
      }
    }

    if (rawTs && text) {
      const parsedNum = parseFloat(rawTs);
      if (sinceTs > 0 && !isNaN(parsedNum) && parsedNum > 1000000000 && parsedNum < sinceTs) {
        return;
      }

      results.push({
        rawTs,
        sender,
        text,
        threadTs,
        replyCount,
        permalink: permalink || undefined
      });
    }
  });

  return results;
})()
`
}

export const READ_VISIBLE_MESSAGES_SCRIPT = buildReadVisibleMessagesScript(0)

const CHANNEL_GENESIS_SELECTORS = '[data-qa="channel_created_summary"]'

export class SlackAdapter {
  async detectState(view: WebContentsView): Promise<SlackSessionState> {
    if (!view || view.webContents?.isDestroyed()) return 'unknown'
    try {
      const state = (await view.webContents.executeJavaScript(
        DETECT_STATE_SCRIPT,
        true
      )) as SlackSessionState
      return state ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  async listChannels(view: WebContentsView): Promise<ScrapedChannelItem[]> {
    if (!view || view.webContents?.isDestroyed()) return []
    try {
      const channels = (await view.webContents.executeJavaScript(
        LIST_CHANNELS_SCRIPT,
        true
      )) as ScrapedChannelItem[]
      return Array.isArray(channels) ? channels : []
    } catch {
      return []
    }
  }

  async readVisibleMessages(
    view: WebContentsView,
    options: { sinceTs?: number } = {}
  ): Promise<RawScrapedMessage[]> {
    if (!view || view.webContents?.isDestroyed()) return []
    try {
      const script = buildReadVisibleMessagesScript(options.sinceTs ?? 0)
      const messages = (await view.webContents.executeJavaScript(
        script,
        true
      )) as RawScrapedMessage[]
      return Array.isArray(messages) ? messages : []
    } catch {
      return []
    }
  }

  /** Scroll the message list to the bottom (newest messages) without clicking or synthetic input events. */
  async scrollToBottom(view: WebContentsView): Promise<boolean> {
    if (!view || view.webContents?.isDestroyed()) return false
    try {
      return Boolean(
        await view.webContents.executeJavaScript(
          `(function() {
            const list = document.querySelector('.c-virtual_list__scroll_container') ||
                         document.querySelector('[data-qa="slack_kit_list"]') ||
                         document.querySelector('.c-scrollbar__hider') ||
                         document.querySelector('[role="list"]') ||
                         document.querySelector('.p-workspace__primary_view');
            if (!list) return false;
            // Scroll immediately
            list.scrollTop = list.scrollHeight;
            if (typeof list.scrollTo === 'function') {
              try { list.scrollTo({ top: list.scrollHeight, behavior: 'instant' }); } catch(e) {}
            }
            try { list.dispatchEvent(new Event('scroll', { bubbles: true })); } catch(e) {}
            try { list.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true })); } catch(e) {}
            // Schedule a second scroll after a rAF to handle Chromium background throttling
            if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(function() {
                list.scrollTop = list.scrollHeight;
                try { list.scrollTo({ top: list.scrollHeight, behavior: 'instant' }); } catch(e) {}
                try { list.dispatchEvent(new Event('scroll', { bubbles: true })); } catch(e) {}
              });
            }
            return true;
          })()`,
          true
        )
      )
    } catch {
      return false
    }
  }

  /** Scroll the message list up (older history) without clicking or synthetic input events. */
  async scrollUp(view: WebContentsView, pixels = 800): Promise<boolean> {
    if (!view || view.webContents?.isDestroyed()) return false
    try {
      return Boolean(
        await view.webContents.executeJavaScript(
          `(function() {
            const list = document.querySelector('.c-virtual_list__scroll_container') ||
                         document.querySelector('[data-qa="slack_kit_list"]') ||
                         document.querySelector('.c-scrollbar__hider');
            if (!list) return false;

            const isAtGenesis = Boolean(
              document.querySelector('${CHANNEL_GENESIS_SELECTORS}') ||
              Array.from(document.querySelectorAll('.c-virtual_list__item')).some(el =>
                /created this channel on|This is the start of|This is the very beginning|This conversation is just between/i.test(el.textContent || el.innerText || '')
              )
            );

            const before = list.scrollTop;
            list.scrollTop = Math.max(0, before - ${Math.max(100, pixels)});
            try { list.dispatchEvent(new Event('scroll', { bubbles: true })); } catch(e) {}
            return list.scrollTop < before || !isAtGenesis;
          })()`,
          true
        )
      )
    } catch {
      return false
    }
  }

  /** Detect if Slack is actively loading older messages (spinner / skeleton). */
  async isPagingMessages(view: WebContentsView): Promise<boolean> {
    if (!view || view.webContents?.isDestroyed()) return false
    try {
      return Boolean(
        await view.webContents.executeJavaScript(
          `(function() {
            return Boolean(
              document.querySelector('.c-message_list__loading_spinner, [data-qa="loading_spinner"], .c-loading_indicator')
            );
          })()`,
          true
        )
      )
    } catch {
      return false
    }
  }

  /** Detect if the DOM is currently showing the start/genesis of the channel. */
  async isAtChannelGenesis(view: WebContentsView): Promise<boolean> {
    if (!view || view.webContents?.isDestroyed()) return false
    try {
      return Boolean(
        await view.webContents.executeJavaScript(
          `(function() {
            return Boolean(
              document.querySelector('${CHANNEL_GENESIS_SELECTORS}') ||
              Array.from(document.querySelectorAll('.c-virtual_list__item')).some(el =>
                /created this channel on|This is the start of|This is the very beginning|This conversation is just between/i.test(el.textContent || el.innerText || '')
              )
            );
          })()`,
          true
        )
      )
    } catch {
      return false
    }
  }

  /**
   * Expands the thread drawer (flexpane) for a parent message, reads all reply messages,
   * and closes the flexpane to restore view state.
   */
  async expandAndReadThread(view: WebContentsView, parentTs: string): Promise<RawScrapedMessage[]> {
    if (!view || view.webContents?.isDestroyed()) return []

    // 1. Click the thread trigger on the parent message
    const opened = Boolean(
      await view.webContents
        .executeJavaScript(
          `(function() {
          const targetTs = ${JSON.stringify(parentTs)};
          const rows = document.querySelectorAll('${SLACK_SELECTORS.messageRow}');
          for (const row of rows) {
            const tsEl = row.querySelector('${SLACK_SELECTORS.messageTimestamp}');
            const rawTs = (tsEl ? tsEl.getAttribute('data-ts') : '') || (row.getAttribute('data-item-key') || '') || (row.getAttribute('data-ts') || '');
            if (rawTs && (rawTs.startsWith(targetTs) || targetTs.startsWith(rawTs))) {
              const btn = row.querySelector('${SLACK_SELECTORS.threadReplyButton}') || row;
              if (btn) {
                btn.click();
                return true;
              }
            }
          }
          return false;
        })()`,
          true
        )
        .catch(() => false)
    )

    if (!opened) return []

    // 2. Wait up to 3s for flexpane to mount
    let paneMounted = false
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 500))
      paneMounted = Boolean(
        await view.webContents
          .executeJavaScript(
            `(function() {
            const pane = document.querySelector('${SLACK_SELECTORS.threadContainer}');
            if (!pane) return false;
            const rows = pane.querySelectorAll('${SLACK_SELECTORS.threadMessageRow}');
            return rows.length > 0;
          })()`,
            true
          )
          .catch(() => false)
      )
      if (paneMounted) break
    }

    if (!paneMounted) {
      await this.closeThreadPane(view)
      return []
    }

    // 3. Extract messages from the flexpane thread container
    const rawReplies = (await view.webContents
      .executeJavaScript(
        `(function() {
        const pane = document.querySelector('${SLACK_SELECTORS.threadContainer}');
        if (!pane) return [];
        const rows = pane.querySelectorAll('${SLACK_SELECTORS.threadMessageRow}');
        const results = [];
        let lastAuthor = null;
        const parentTs = ${JSON.stringify(parentTs)};

        rows.forEach((row) => {
          const senderEl = row.querySelector('${SLACK_SELECTORS.messageSender}');
          const tsEl = row.querySelector('${SLACK_SELECTORS.messageTimestamp}');
          const bodyEl = row.querySelector('${SLACK_SELECTORS.messageBody}');
          const permalinkEl = row.querySelector('a[href*="/archives/"]');
          const permalink = permalinkEl ? permalinkEl.getAttribute('href') : '';

          if (senderEl) {
            const authorText = senderEl.textContent.trim();
            if (authorText) lastAuthor = authorText;
          }

          let pTs = '';
          if (permalink && permalink.indexOf('/p') !== -1) {
            const pIdx = permalink.lastIndexOf('/p');
            const pDigits = permalink.slice(pIdx + 2).replace(/[^0-9]/g, '');
            if (pDigits.length >= 16) {
              pTs = pDigits.slice(0, 10) + '.' + pDigits.slice(10, 16);
            }
          }

          const rawTs =
            (tsEl ? tsEl.getAttribute('data-ts') : '') ||
            (row.getAttribute('data-item-key') && row.getAttribute('data-item-key').length >= 10 ? row.getAttribute('data-item-key') : '') ||
            (row.getAttribute('data-ts') || '') ||
            pTs ||
            (tsEl ? (tsEl.getAttribute('datetime') || tsEl.textContent.trim()) : '');

          // Skip parent message in flexpane
          if (rawTs === parentTs) return;

          const sender = lastAuthor || 'Anonymous';

          const attachmentEls = row.querySelectorAll(
            '[data-qa="file_container"], .c-file_container, .c-file__title, .p-file_title, [data-qa="file_title"], .c-message_attachment, a[href*="/files/"]'
          );
          const fileNames = [];
          attachmentEls.forEach((att) => {
            const titleEl = att.querySelector('.c-file__title, [data-qa="file_title"], .p-file_title') || att;
            const fName = (titleEl.textContent || titleEl.innerText || '').trim();
            if (fName && fileNames.indexOf(fName) === -1 && fName.indexOf(String.fromCharCode(10)) === -1 && fName.length < 200) {
              fileNames.push(fName);
            }
          });

          let text = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '').trim() : '';
          if (fileNames.length > 0) {
            const fileText = fileNames.map((fn) => '[Document: ' + fn + ']').join(' ');
            text = text ? text + ' ' + fileText : fileText;
          }

          if (rawTs && text) {
            results.push({
              rawTs,
              sender,
              text,
              threadTs: parentTs,
              permalink: permalink || undefined
            });
          }
        });
        return results;
      })()`,
        true
      )
      .catch(() => [])) as RawScrapedMessage[]

    // 4. Close the flexpane
    await this.closeThreadPane(view)

    return rawReplies ?? []
  }

  /** Closes the thread drawer/flexpane if open. */
  async closeThreadPane(view: WebContentsView): Promise<boolean> {
    if (!view || view.webContents?.isDestroyed()) return false
    try {
      return Boolean(
        await view.webContents.executeJavaScript(
          `(function() {
            const btn = document.querySelector('${SLACK_SELECTORS.threadCloseButton}');
            if (btn) {
              btn.click();
              return true;
            }
            return false;
          })()`,
          true
        )
      )
    } catch {
      return false
    }
  }

  async postMessageViaDom(view: WebContentsView, text: string): Promise<boolean> {
    if (!view || view.webContents?.isDestroyed()) return false
    const script = `
(function() {
  const editor = document.querySelector('${SLACK_SELECTORS.composerEditor}');
  if (!editor) return false;
  editor.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, ${JSON.stringify(text)});
  editor.dispatchEvent(new Event('input', { bubbles: true }));

  setTimeout(() => {
    const sendBtn = document.querySelector('${SLACK_SELECTORS.composerSendButton}');
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
    } else {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
  }, 300);
  return true;
})()
`
    try {
      return Boolean(await view.webContents.executeJavaScript(script, true))
    } catch {
      return false
    }
  }
}
