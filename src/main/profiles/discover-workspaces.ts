import type { DiscoveredWorkspace } from '../../shared/types'
import {
  parseSlackTeamDomain,
  parseTeamIdFromSlackClientUrl,
  slackClientUrlForTeam
} from '../../shared/slack-url'

/**
 * Prefer human workspace names — never leave bare T… ids as the display name when DOM has better.
 */
export const READ_SLACK_WORKSPACE_NAME_SCRIPT = `(() => {
  const bad = (t) =>
    !t ||
    /^T[A-Z0-9]+$/i.test(t) ||
    /^slack$/i.test(t) ||
    /^unknown$/i.test(t) ||
    /\\d+\\s+new\\s+items?/i.test(t) ||
    /^new\\s+item/i.test(t) ||
    /^\\(\\d+\\)/.test(t);
  const clean = (t) => (t || '').replace(/\\s+/g, ' ').trim();

  const selectors = [
    '[data-qa="team_menu_trigger"]',
    '[data-qa="team-menu-team-name"]',
    '.p-ia__sidebar_header__team_name',
    '.p-top_nav__workspace_name',
    '[data-qa="workspace_name"]',
    'button[data-qa="team_menu"]'
  ];
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (!el) continue;
    let t = clean(el.getAttribute('aria-label') || '');
    t = t.replace(/workspace menu|menu for|switch workspaces?/gi, '').trim();
    if (!bad(t)) return t;
    t = clean(el.textContent || '');
    if (!bad(t)) return t;
  }

  const title = clean(document.title || '').replace(/\\s*[|—–-]\\s*Slack\\s*$/i, '');
  const parts = title.split(/\\s*[|—–-]\\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (!bad(last) && !/\\(channel\\)|\\(direct message\\)/i.test(last)) return last;
  }
  if (!bad(title) && !/\\(channel\\)|\\(direct message\\)/i.test(title)) return title;
  return null;
})()`

/** Workspace name + current channel/DM title from the Slack client DOM / tab title. */
export const READ_SLACK_CONTEXT_SCRIPT = `(() => {
  const badWs = (t) =>
    !t ||
    /^T[A-Z0-9]+$/i.test(t) ||
    /^slack$/i.test(t) ||
    /^unknown$/i.test(t) ||
    /\\d+\\s+new\\s+items?/i.test(t) ||
    /^new\\s+item/i.test(t) ||
    /^\\(\\d+\\)/.test(t);
  const badCh = (t) =>
    !t ||
    /^[CDGT][A-Z0-9]{8,}$/i.test(t) ||
    /^(slack|home|dms|threads|later|activity|more)$/i.test(t);
  const clean = (t) => (t || '').replace(/\\s+/g, ' ').trim();

  const workspaceName = (() => {
    const selectors = [
      '[data-qa="team_menu_trigger"]',
      '[data-qa="team-menu-team-name"]',
      '.p-ia__sidebar_header__team_name',
      '.p-top_nav__workspace_name',
      '[data-qa="workspace_name"]',
      'button[data-qa="team_menu"]'
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (!el) continue;
      let t = clean(el.getAttribute('aria-label') || '');
      t = t.replace(/workspace menu|menu for|switch workspaces?/gi, '').trim();
      if (!badWs(t)) return t;
      t = clean(el.textContent || '');
      if (!badWs(t)) return t;
    }
    return null;
  })();

  const channelName = (() => {
    const selectors = [
      '[data-qa="channel_sidebar_name_button"]',
      '[data-qa="channel_name"]',
      '.p-view_header__channel_title',
      '.p-view_header__title',
      'h2[data-qa="channel-name"]',
      '[data-qa="dm_title"]'
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (!el) continue;
      let t = clean(el.getAttribute('aria-label') || el.textContent || '');
      t = t.replace(/^#\\s*/, '').replace(/\\s+channel$/i, '').trim();
      if (!badCh(t) && t.length < 80) return t;
    }
    const title = clean(document.title || '').replace(/^\\(\\d+\\)\\s*/, '');
    const parts = title.split(/\\s*[|—–-]\\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length) {
      const first = parts[0].replace(/^#\\s*/, '');
      if (!badCh(first) && !/slack/i.test(first)) return first;
    }
    return null;
  })();

  return { workspaceName, channelName };
})()`

export const READ_TEAMS_ORG_NAME_SCRIPT = `(() => {
  const generic = (t) =>
    !t ||
    /^(microsoft teams|teams|chat|calendar|activity|calls|teams org|organization|personal|home|you)$/i.test(
      t
    ) ||
    /^tenant-/i.test(t) ||
    /^teams-home$/i.test(t);
  const clean = (t) => (t || '').replace(/\\s+/g, ' ').trim();

  const tryText = (el) => {
    if (!el) return null;
    let t = clean(el.getAttribute('aria-label') || '');
    t = t
      .replace(/account manager|signed in as|view account|switch account/gi, '')
      .trim();
    if (!generic(t) && t.length < 80) return t;
    t = clean(el.textContent || '');
    if (!generic(t) && t.length < 80) return t;
    return null;
  };

  const selectors = [
    '[data-tid="organization-name"]',
    '[data-tid="appbar-tenant-name"]',
    '[data-tid="tenant-name"]',
    '[data-tid="simple-profile"]',
    '[data-tid="me-control-avatar-trigger"]',
    'button[aria-label*="Account manager"]',
    '[data-tid="title-text"]'
  ];
  for (const s of selectors) {
    const hit = tryText(document.querySelector(s));
    if (hit) return hit;
  }

  try {
    const html = document.documentElement.innerHTML.slice(0, 400000);
    const m =
      html.match(/"tenantDisplayName"\\s*:\\s*"([^"]{2,80})"/) ||
      html.match(/"organizationName"\\s*:\\s*"([^"]{2,80})"/) ||
      html.match(/"companyName"\\s*:\\s*"([^"]{2,80})"/) ||
      html.match(/"tenantName"\\s*:\\s*"([^"]{2,80})"/);
    if (m && !generic(m[1])) return clean(m[1]);
  } catch (_) {}

  const title = clean(document.title || '')
    .replace(/\\s*[|—–-]\\s*(Microsoft Teams|Teams)\\s*$/i, '')
    .trim();
  const parts = title.split(/\\s*[|—–]\\s*/).map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!generic(parts[i])) return parts[i];
  }
  return null;
})()`

/**
 * Runs inside the Slack embed to list workspaces this browser session can open.
 */
export const DISCOVER_WORKSPACES_SCRIPT = `(() => {
  const out = [];
  const seen = new Set();
  const badName = (t) =>
    !t ||
    /^T[A-Z0-9]+$/i.test(t) ||
    /^slack$/i.test(t) ||
    /^unknown$/i.test(t) ||
    /\\d+\\s+new\\s+items?/i.test(t) ||
    /^new\\s+item/i.test(t) ||
    /^\\(\\d+\\)/.test(t);
  const clean = (t) => (t || '').replace(/\\s+/g, ' ').trim();

  const readCurrentName = () => {
    const selectors = [
      '[data-qa="team_menu_trigger"]',
      '[data-qa="team-menu-team-name"]',
      '.p-ia__sidebar_header__team_name',
      '.p-top_nav__workspace_name',
      '[data-qa="workspace_name"]'
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (!el) continue;
      let t = clean(el.getAttribute('aria-label') || '');
      t = t.replace(/workspace menu|menu for|switch workspaces?/gi, '').trim();
      if (!badName(t)) return t;
      t = clean(el.textContent || '');
      if (!badName(t)) return t;
    }
    const title = clean(document.title || '').replace(/\\s*[|—–-]\\s*Slack\\s*$/i, '');
    const parts = title.split(/\\s*[|—–-]\\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && !badName(parts[parts.length - 1]) && !/\\(channel\\)|\\(direct message\\)/i.test(parts[parts.length - 1])) {
      return parts[parts.length - 1];
    }
    if (!badName(title) && !/\\(channel\\)|\\(direct message\\)/i.test(title)) return title;
    return null;
  };

  const push = (entry) => {
    const key = entry.teamId || entry.teamDomain || entry.openUrl;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };

  try {
    const teamMatch = location.href.match(/\\/client\\/(T[A-Z0-9]+)/i);
    if (teamMatch) {
      const teamId = teamMatch[1];
      push({
        teamId,
        teamName: readCurrentName() || teamId,
        openUrl: (function () {
          try {
            const path = location.pathname || '';
            const m = path.match(/^\\/client\\/T[A-Z0-9]+(?:\\/[CDG][A-Z0-9]+)?/i);
            return 'https://app.slack.com' + (m ? m[0] : '/client/' + teamId);
          } catch (_) {
            return 'https://app.slack.com/client/' + teamId;
          }
        })(),
        teamDomain: null
      });
    }
  } catch (_) {}

  // Workspace switcher tiles (when open / in DOM)
  const switcher = Array.from(
    document.querySelectorAll(
      '[data-qa="workspace-switcher"] [data-qa], [data-qa*="team_sidebar"] a, button[data-qa*="workspace"]'
    )
  );
  for (const el of switcher) {
    try {
      const href = el.getAttribute('href') || '';
      const teamMatch = href.match(/\\/client\\/(T[A-Z0-9]+)/i) || href.match(/(T[A-Z0-9]{8,})/i);
      const label = clean(el.getAttribute('aria-label') || el.textContent || '');
      if (teamMatch) {
        push({
          teamId: teamMatch[1],
          teamName: badName(label) ? teamMatch[1] : label,
          openUrl: 'https://app.slack.com/client/' + teamMatch[1],
          teamDomain: null
        });
      }
    } catch (_) {}
  }

  const anchors = Array.from(document.querySelectorAll('a[href*=".slack.com"]'));
  for (const a of anchors) {
    try {
      const u = new URL(a.href);
      const m = u.hostname.match(/^([a-z0-9-]+)\\.slack\\.com$/i);
      if (!m) continue;
      const domain = m[1].toLowerCase();
      if (domain === 'app' || domain === 'api' || domain === 'status' || domain === 'slackb') continue;
      const label = clean(a.textContent || '');
      push({
        teamId: null,
        teamName: badName(label) ? domain : label,
        openUrl: 'https://' + domain + '.slack.com',
        teamDomain: domain
      });
    } catch (_) {}
  }

  return out;
})()`

export function normalizeDiscoveredWorkspaces(raw: unknown): DiscoveredWorkspace[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const seen = new Set<string>()
  const out: DiscoveredWorkspace[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const rec = item as {
      teamId?: unknown
      teamName?: unknown
      openUrl?: unknown
      teamDomain?: unknown
    }
    const openUrl = typeof rec.openUrl === 'string' ? rec.openUrl.trim() : ''
    if (!openUrl) {
      continue
    }
    const teamIdFromUrl = parseTeamIdFromSlackClientUrl(openUrl)
    const teamId =
      typeof rec.teamId === 'string' && rec.teamId.trim() ? rec.teamId.trim() : teamIdFromUrl
    const teamDomain =
      (typeof rec.teamDomain === 'string' && rec.teamDomain.trim()) ||
      parseSlackTeamDomain(openUrl) ||
      undefined
    let teamName =
      (typeof rec.teamName === 'string' && rec.teamName.trim()) || teamDomain || teamId || openUrl
    // Don't prefer raw team id over domain when both exist
    if (teamId && teamName === teamId && teamDomain) {
      teamName = teamDomain
    }
    const key = teamId || teamDomain || openUrl
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push({
      teamId: teamId ?? null,
      teamName,
      openUrl: teamId ? slackClientUrlForTeam(teamId) : openUrl,
      ...(teamDomain ? { teamDomain } : {})
    })
  }

  return out
}

/** Microsoft personal / consumer directory tenants — not real work orgs. */
export const TEAMS_CONSUMER_TENANT_IDS = new Set([
  '9188040d-6c67-4c5b-b112-36a304b66dad', // MSA consumers
  'f8cdef6d-ff46-472a-aa7a-40f2d36c5c81' // Microsoft services
])

export function teamsTenantGuid(teamId: string): string {
  return teamId.replace(/^tenant-/i, '').toLowerCase()
}

export function isTeamsPersonalTenantId(teamId: string | null | undefined): boolean {
  if (!teamId?.trim()) {
    return false
  }
  if (teamId === 'teams-home') {
    return true
  }
  return TEAMS_CONSUMER_TENANT_IDS.has(teamsTenantGuid(teamId))
}

/** Map consumer tenants → teams-home so personal accounts are a single row. */
export function canonicalizeTeamsWorkspaceId(teamId: string): string {
  if (isTeamsPersonalTenantId(teamId)) {
    return 'teams-home'
  }
  return teamId
}

/**
 * Runs inside the Teams embed to list real tenants/orgs.
 * Personal accounts (no work org) → exactly one "Personal" (teams-home) entry.
 */
export const DISCOVER_TEAMS_WORKSPACES_SCRIPT = `(() => {
  const out = [];
  const seen = new Set();
  const CONSUMER = new Set([
    '9188040d-6c67-4c5b-b112-36a304b66dad',
    'f8cdef6d-ff46-472a-aa7a-40f2d36c5c81'
  ]);
  const generic = (t) =>
    !t ||
    /^(microsoft teams|teams|chat|calendar|activity|calls|teams org|organization|personal)$/i.test(
      t
    ) ||
    /^tenant-/i.test(t);
  const clean = (t) => (t || '').replace(/\\s+/g, ' ').trim();
  const shortTenant = (id) => {
    const raw = String(id || '').replace(/^tenant-/i, '');
    return raw.length > 8 ? raw.slice(0, 8) : raw;
  };
  const guidOf = (id) => String(id || '').replace(/^tenant-/i, '').toLowerCase();
  const isPersonalId = (id) => !id || id === 'teams-home' || CONSUMER.has(guidOf(id));

  const readOrgName = () => {
    const selectors = [
      '[data-tid="organization-name"]',
      '[data-tid="appbar-tenant-name"]',
      '[data-tid="tenant-name"]',
      '[data-tid="simple-profile"]',
      'button[aria-label*="Account manager"]'
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (!el) continue;
      let t = clean(el.getAttribute('aria-label') || el.textContent || '');
      t = t.replace(/account manager|signed in as|view account/gi, '').trim();
      if (!generic(t) && t.length < 80) return t;
    }
    try {
      const html = document.documentElement.innerHTML.slice(0, 400000);
      const m =
        html.match(/"tenantDisplayName"\\s*:\\s*"([^"]{2,80})"/) ||
        html.match(/"organizationName"\\s*:\\s*"([^"]{2,80})"/) ||
        html.match(/"companyName"\\s*:\\s*"([^"]{2,80})"/);
      if (m && !generic(m[1])) return clean(m[1]);
    } catch (_) {}
    const title = clean(document.title || '')
      .replace(/\\s*[|—–-]\\s*(Microsoft Teams|Teams)\\s*$/i, '')
      .trim();
    const parts = title.split(/\\s*[|—–]\\s*/).map((p) => p.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (!generic(parts[i])) return parts[i];
    }
    return null;
  };

  const push = (entry) => {
    let id = entry.teamId;
    if (isPersonalId(id)) {
      id = 'teams-home';
      entry = {
        ...entry,
        teamId: 'teams-home',
        teamName: 'Personal',
        openUrl: /teams\\.live\\.com/i.test(location.href)
          ? 'https://teams.live.com/v2/'
          : 'https://teams.microsoft.com/v2/'
      };
    }
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(entry);
  };

  const tenantFromUrl = (href) => {
    try {
      const u = new URL(href);
      const raw =
        u.searchParams.get('tenantId') ||
        u.searchParams.get('tenant') ||
        u.searchParams.get('login_hint_tenant');
      if (raw && /^[0-9a-f-]{8,}$/i.test(raw)) {
        return 'tenant-' + raw.toLowerCase();
      }
      const m = href.match(/[?&#]tenantId=([0-9a-f-]{8,})/i);
      if (m) return 'tenant-' + m[1].toLowerCase();
    } catch (_) {}
    return null;
  };

  const labelFor = (id, preferred) => {
    if (isPersonalId(id)) return 'Personal';
    if (preferred && !generic(preferred)) return preferred;
    return 'Org ' + shortTenant(id);
  };

  try {
    const href = location.href;
    if (!/teams\\.(microsoft|live)\\.com/i.test(href) || /login\\.microsoftonline\\.com/i.test(href)) {
      return out;
    }
    if (/\\/authv2\\b/i.test(href) || /\\/logout/i.test(href)) {
      return out;
    }

    const orgName = readOrgName();
    const isLivePersonal = /teams\\.live\\.com/i.test(href);
    const currentTenant = tenantFromUrl(href);
    const sessionIsPersonal = isLivePersonal || isPersonalId(currentTenant);

    // Personal MSA: never harvest random tenantId links — they open the same home.
    if (sessionIsPersonal) {
      push({
        teamId: 'teams-home',
        teamName: 'Personal',
        openUrl: isLivePersonal ? 'https://teams.live.com/v2/' : 'https://teams.microsoft.com/v2/',
        teamDomain: null
      });
      return out;
    }

    const anchors = Array.from(
      document.querySelectorAll('a[href*="tenantId="], a[href*="tenant="]')
    );
    for (const a of anchors) {
      try {
        const id = tenantFromUrl(a.href);
        if (!id || isPersonalId(id)) continue;
        const label = clean(a.textContent || '');
        push({
          teamId: id,
          teamName: labelFor(id, !generic(label) ? label : orgName),
          openUrl: a.href.split('#')[0],
          teamDomain: null
        });
      } catch (_) {}
    }

    if (currentTenant && !isPersonalId(currentTenant)) {
      push({
        teamId: currentTenant,
        teamName: labelFor(currentTenant, orgName),
        openUrl: href.split('#')[0] || 'https://teams.microsoft.com/v2/',
        teamDomain: null
      });
    }

    if (out.length === 0) {
      push({
        teamId: 'teams-home',
        teamName: 'Personal',
        openUrl: 'https://teams.microsoft.com/v2/',
        teamDomain: null
      });
    }
  } catch (_) {}

  return out;
})()`

export function isGenericTeamsName(name: string | null | undefined): boolean {
  if (!name?.trim()) {
    return true
  }
  return /^(microsoft teams|teams|teams org|organization|personal|org [0-9a-f-]+|teams-home)$/i.test(
    name.trim()
  )
}

export function normalizeTeamsDiscoveredWorkspaces(raw: unknown): DiscoveredWorkspace[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const seen = new Set<string>()
  const out: DiscoveredWorkspace[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const rec = item as {
      teamId?: unknown
      teamName?: unknown
      openUrl?: unknown
    }
    const openUrl = typeof rec.openUrl === 'string' ? rec.openUrl.trim() : ''
    if (!openUrl) {
      continue
    }
    let teamId = typeof rec.teamId === 'string' && rec.teamId.trim() ? rec.teamId.trim() : null
    if (teamId && /^teams-[a-z0-9]+$/i.test(teamId) && teamId !== 'teams-home') {
      teamId = null
    }
    if (!teamId) {
      continue
    }
    teamId = canonicalizeTeamsWorkspaceId(teamId)
    let teamName = (typeof rec.teamName === 'string' && rec.teamName.trim()) || ''
    if (teamId === 'teams-home') {
      teamName = 'Personal'
    } else if (!teamName || isGenericTeamsName(teamName) || teamName === teamId) {
      const short = teamId.replace(/^tenant-/i, '').slice(0, 8)
      teamName = `Org ${short}`
    }
    if (seen.has(teamId)) {
      continue
    }
    seen.add(teamId)
    out.push({
      teamId,
      teamName,
      openUrl: teamId === 'teams-home' ? 'https://teams.microsoft.com/v2/' : openUrl
    })
  }

  // Personal-only sessions must never keep a parallel tenant row.
  if (out.length > 1 && out.every((e) => e.teamId === 'teams-home')) {
    return [out[0]!]
  }
  const orgs = out.filter((e) => e.teamId !== 'teams-home')
  const home = out.find((e) => e.teamId === 'teams-home')
  if (orgs.length === 0 && home) {
    return [home]
  }
  if (orgs.length > 0) {
    return orgs
  }
  return out
}
