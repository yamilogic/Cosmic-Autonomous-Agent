/**
 * Samples Slack workspace theme — prefers real sidebar tokens, rejects white/near-white
 * (main pane bg is often white and was leaking into our chrome).
 */
export const SAMPLE_SLACK_THEME_SCRIPT = `(() => {
  const toHex = (raw) => {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s || s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return null;
    if (/^#([0-9a-f]{6})$/i.test(s)) return s.toLowerCase();
    if (/^#([0-9a-f]{3})$/i.test(s)) {
      return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    const m = s.match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/i);
    if (!m) return null;
    return (
      '#' +
      [m[1], m[2], m[3]]
        .map((n) => Number(n).toString(16).padStart(2, '0'))
        .join('')
    ).toLowerCase();
  };

  const lum = (hex) => {
    if (!hex || hex.length < 7) return 0;
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  // Skip white / near-white (and pure black noise) — not usable for our chrome tint.
  const usable = (hex, { maxLum = 0.78, minLum = 0.04 } = {}) => {
    if (!hex) return null;
    const L = lum(hex);
    if (L > maxLum || L < minLum) return null;
    return hex;
  };

  const pickUsable = (maxLum, ...vals) => {
    for (const v of vals) {
      const h = usable(toHex(v), { maxLum });
      if (h) return h;
    }
    return null;
  };

  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const sidebarEl = document.querySelector(
    '.p-ia__sidebar, .p-workspace__sidebar, [data-qa="team_sidebar"], .p-tab_rail'
  );
  const side = sidebarEl ? getComputedStyle(sidebarEl) : null;

  // Do NOT use body/html background — Slack's content pane is often white.
  const sidebar = pickUsable(
    0.72,
    cs.getPropertyValue('--dt-color-themebase'),
    cs.getPropertyValue('--dt-color-theme-base'),
    cs.getPropertyValue('--p-color-sidebar-bg'),
    cs.getPropertyValue('--dt_color-themebase'),
    side && side.backgroundColor
  );

  const accent = pickUsable(
    0.65,
    cs.getPropertyValue('--dt-color-presence-active'),
    cs.getPropertyValue('--p-color-button-primary-bg'),
    cs.getPropertyValue('--dt-color-secondary-button-bg'),
    cs.getPropertyValue('--sk_highlight'),
    sidebar
  );

  const attr = (
    root.getAttribute('data-js-theme') ||
    root.getAttribute('data-theme') ||
    root.dataset.theme ||
    ''
  ).toLowerCase();
  const scheme = String(cs.colorScheme || '').toLowerCase();

  let mode = 'dark';
  if (attr.includes('light') || (scheme.includes('light') && !scheme.includes('dark'))) {
    mode = 'light';
  } else if (attr.includes('dark') || scheme.includes('dark')) {
    mode = 'dark';
  } else if (sidebar) {
    mode = lum(sidebar) > 0.45 ? 'light' : 'dark';
  }

  // Safe defaults — never white.
  const fallbackSidebar = mode === 'light' ? '#ebe6ef' : '#1a1820';
  const fallbackAccent = mode === 'light' ? '#4a154b' : '#9b87b0';

  return {
    accent: accent || fallbackAccent,
    sidebar: sidebar || fallbackSidebar,
    mode
  };
})()`

export const DEFAULT_DASHBOARD_THEME = {
  accent: '#2bac76',
  sidebar: '#141a24',
  appId: 'default' as const
}
