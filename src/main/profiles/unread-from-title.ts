/**
 * Parse unread counts from browser tab titles (best-effort).
 * Slack uses a leading "(N)"; do not treat "(Channel)" as unread.
 */
export function parseUnreadFromTitle(title: string, appId: string): number {
  const t = title.trim()
  if (!t) return 0

  // Slack titles often contain "(Channel)" — only a leading (N) / [N] is unread.
  const leading = t.match(/^[[(](\d{1,4})[)\]]/)
  if (leading) {
    return Math.min(9999, Number(leading[1]) || 0)
  }

  if (appId === 'whatsapp') {
    const end = t.match(/[[(](\d{1,4})[)\]]\s*$/)
    if (end) {
      return Math.min(9999, Number(end[1]) || 0)
    }
  }

  if (appId === 'teams') {
    const teams = t.match(/(\d{1,4})\s+new/i)
    if (teams) {
      return Math.min(9999, Number(teams[1]) || 0)
    }
  }

  if (/^[•●*]\s/.test(t)) {
    return 1
  }

  return 0
}

/** Channel/DM mention pills only — ignore Activity, Later, and the workspace avatar badge. */
export const READ_PAGE_UNREAD_SCRIPT = `(() => {
  try {
    let best = 0;
    const bump = (n) => {
      const v = Number(n);
      if (Number.isFinite(v) && v > best) best = v;
    };

    const addFrom = (root) => {
      if (!root) return;
      const badges = root.querySelectorAll(
        '.p-channel_sidebar__badge, .c-mention_badge, [data-qa="mention_badge"]'
      );
      for (const el of badges) {
        if (el.closest('[data-qa="workspace-switcher"], [data-qa="user-button"], [data-qa="top-nav"], .p-ia__nav, [data-qa="app-space-tab-activity"], [data-qa="activity"]')) {
          continue;
        }
        const raw = (el.textContent || '').trim();
        if (raw === '99+') {
          bump(99);
          continue;
        }
        if (!/^\\d{1,4}$/.test(raw)) continue;
        bump(Number(raw));
      }
    };

    const sidebar = document.querySelector('[data-qa="channel-sidebar"], .p-channel_sidebar');
    if (!sidebar) return -1;
    addFrom(sidebar);
    addFrom(document.querySelector('[data-qa="inbox-list"], [data-qa="dm-list"]'));
    return Math.min(9999, Math.max(0, best));
  } catch (e) {
    return -1;
  }
})()`

export function unreadKey(profileId: string, appId: string): string {
  return `${profileId}:${appId}`
}

export function splitUnreadKey(key: string): { profileId: string; appId: string } | null {
  const sep = key.lastIndexOf(':')
  if (sep <= 0) return null
  const profileId = key.slice(0, sep)
  const appId = key.slice(sep + 1)
  if (!profileId || !appId) return null
  return { profileId, appId }
}

export function formatUnreadBadge(n: number): string {
  if (n <= 0) return ''
  if (n > 99) return '99+'
  return String(n)
}

export function sumUnread(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + (b > 0 ? b : 0), 0)
}
