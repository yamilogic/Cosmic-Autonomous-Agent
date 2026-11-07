# Dashboard sidebar + Connect channel UX — implementation plan

**Status:** proposed, awaiting approval. No UI code changed.
**Branch:** `beta` only. `main` untouched.
**Runs before:** Phase 2 (new-project wizard) and Phase 3 (card settings) of
`2026-10-25-global-config-and-per-project-config.md`. This plan does not replace those phases; it only fixes the navigation, channel picker, and render-precedence issues visible in the screenshots.
**Does not touch:** compact cards, Recent strip, card height, Dashboard metrics, sync engine, tokens, IPC contracts.

---

## Goal

Make the three screenshots read correctly:

1. **A full-screen auth/sign-in surface must not show the project workspace sidebar.**
   The sidebar and its buttons belong to the Dashboard, not to a Chrome sign-in pane or the embedded app view.
2. **The card's channel section becomes one clear place to connect a source.**
   Rename `Channels` → `Connect channel`; list **Our Slack first**, then **Client Slack**, then future connectors.
3. **There is only one channel picker.**
   Channels are chosen from the sidebar dropdown. The Slack panel does not repeat the same dropdown in its toolbar.
4. **The main dashboard rail says `Project`, not `Projects`/`Slack`.**
   The row under Dashboard opens the project dashboard.

---

## What the screenshots map to

| Screenshot | What is visible | Code cause | Planned fix |
|---|---|---|---|
| Image 1 — sign-in with sidebar/buttons | Main app rail + expanded-card workspace rail + Google/Slack sign-in pane | `App.tsx` can render `AuthChromePane` and `DashboardView` at the same time (`browserAuthBusy` + `dashboardOpen`); selecting a profile app does not close Dashboard | Auth pane and Dashboard become mutually exclusive; selecting an app closes Dashboard |
| Image 2 — Channel list | `Channels` section; `Our channels` / `Client channels` dropdowns; a second channel dropdown inside the Slack panel | `workspace-nav.ts` labels/order; `SlackChatTab.tsx` toolbar `<select>` | Rename section and connectors; Our Slack first; remove panel toolbar dropdown; source-correct channel lists |
| Image 3 — main sidebar | Dashboard row + nested project row | `DashboardRail.tsx` nested label is `Projects` | Nested label becomes `Project` |

> **One naming decision is explicit below.** If you meant the real `Slack` app entry in the profile tree (not the row under Dashboard), it is a one-line follow-up and does not change this plan's structure. See “Naming decisions”.

---

## Naming decisions

| Surface | Current | New | Why |
|---|---|---|---|
| Card section | `Channels` | **`Connect channel`** | Your exact wording; it describes the action, not a folder of channels. |
| Our workspace connector | `Our channels` | **`Our Slack`** | Matches your wording and the two-Slack model. |
| Client connector | `Client channels` | **`Client Slack`** | Matches your wording; distinguishes the client workspace from Our Slack. |
| Main Dashboard dropdown row | `Projects` | **`Project`** | Singular, and it opens the project dashboard. |
| Profile app entry `Slack` | `Slack` | **unchanged by default** | That surface genuinely opens the Slack browser app. If you also want the profile app renamed to `Project`, it is a small sidebar-only label override; say so and I will add it. |

**Connector order:** Our Slack → Client Slack → Upwork → Microsoft Teams → WhatsApp → Google Chat → Discord. Google Chat and Discord stay at the bottom so nothing is lost; if you want only the five named sources visible, they can be deleted from `NAV_CONNECTORS` in the same pass. WhatsApp is added as a visible, not-yet-wired future connector.

---

## Current code map (verified)

| File | Current behaviour |
|---|---|
| `src/renderer/src/components/dashboard/workspace-nav.ts` | Section label `Channels`; connectors `team`, `client`, `upwork`, `teams`, `googlechat`, `discord`; labels `Our channels` / `Client channels`; `NAV_REV = 6`. |
| `src/renderer/src/components/dashboard/WorkspaceSidebar.tsx` | Renders connector dropdowns; also renders a second, disabled `Schedules` row under Xomni even though `NAV_SECTIONS.xomni` already contains Schedules. |
| `src/renderer/src/components/dashboard/WorkspaceContent.tsx` | `GROUP_META.slack.title = 'Channels'`; passes `identity.channels` (client channels) to `SlackChatTab` even when source is `ours`. |
| `src/renderer/src/components/dashboard/SlackChatTab.tsx` | Own channel `<select>` in the toolbar. It duplicates the sidebar picker and is populated from the wrong source for Our Slack. |
| `src/renderer/src/components/dashboard/ExpandedWorkspace.tsx` | Team dropdown entries come from the global `teamWorkspace.channels`; `project.ourSlackChannels` is ignored. |
| `src/renderer/src/components/dashboard/DashboardRail.tsx` | Nested row label is `Projects`; calls `openDashboard('slack')`. |
| `src/renderer/src/App.tsx` | `handleSidebarSelectApp` does not close Dashboard; `dashboardOpen` and `browserAuthBusy` can both render. |
| `tests/unit/workspace-nav.test.ts` | Asserts section label `Channels`, row labels `All channels`, connector order indirectly through row ids. |

---

## Phase 1 — Navigation labels, order, and duplicate removal

### 1.1 Update the nav model

**File:** `src/renderer/src/components/dashboard/workspace-nav.ts`

- Add `'whatsapp'` to `ConnectorKey`.
- Keep `SlackSourceKey` as `'client' | 'team'`.
- Change the Slack section label:

```ts
{
  key: 'slack',
  label: 'Connect channel',
  icon: 'inbox',
  rows: [ /* unchanged */ ]
}
```

- Reorder and rename `NAV_CONNECTORS`:

```ts
export const NAV_CONNECTORS: NavConnector[] = [
  { key: 'team',     label: 'Our Slack',       icon: 'users',  wired: true,  allId: 's:team',   note: 'Our own Slack workspace…' },
  { key: 'client',   label: 'Client Slack',    icon: 'slack',  wired: true,  allId: 's:client', note: 'This project’s client Slack workspace…' },
  { key: 'upwork',   label: 'Upwork',          icon: 'plug',   wired: false, allId: null,       note: 'Upwork is not connected yet.' },
  { key: 'teams',    label: 'Microsoft Teams', icon: 'plug',   wired: false, allId: null,       note: 'Microsoft Teams is not connected yet.' },
  { key: 'whatsapp', label: 'WhatsApp',        icon: 'plug',   wired: false, allId: null,       note: 'WhatsApp is not connected yet. Slack ships first.' },
  { key: 'googlechat', label: 'Google Chat',   icon: 'plug',   wired: false, allId: null,       note: 'Google Chat is not connected yet.' },
  { key: 'discord',  label: 'Discord',         icon: 'plug',   wired: false, allId: null,       note: 'Discord is not connected yet.' }
]
```

- Update `NAV_SECTIONS` Slack row descriptions to say “Our Slack” and “Client Slack”, not “team workspace” / “client workspace”, where the copy mentions the connector.
- Do **not** bump `NAV_REV`. Labels and order do not change the persisted shape, and `validConnectors` already ignores unknown keys.
- `railSectionSelection(nav, 'slack')` keeps returning `s:client`; the collapsed rail still lands on the client workspace.

### 1.2 Remove the duplicate Schedules row

**File:** `src/renderer/src/components/dashboard/WorkspaceSidebar.tsx`

Delete the extra block at the end of the Xomni section:

```tsx
{section.key === 'xomni' && sectionOpen && (
  <Row icon="clock" label="Schedules" ... disabled ... />
)}
```

`NAV_SECTIONS.xomni.rows` already contains the real Schedules row, so this block is the duplicate visible in the screenshots.

### 1.3 Update body headings

**File:** `src/renderer/src/components/dashboard/WorkspaceContent.tsx`

```ts
slack: {
  title: 'Connect channel',
  desc: 'Messages from Our Slack and the client’s Slack workspace.'
}
```

`panelMeta()` already builds `All of <connector label>`, so after 1.1 it reads `All of Our Slack` and `All of Client Slack` with no extra code.

### 1.4 Update the main sidebar row

**File:** `src/renderer/src/components/dashboard/DashboardRail.tsx`

Change the nested row label from `Projects` to `Project`. Keep `openDashboard('slack')` and the existing test id so the rail behaviour does not change.

### 1.5 Tests

**File:** `tests/unit/workspace-nav.test.ts`

- Section labels become `['Xomni', 'Connect channel', 'Project info', 'Visualizations']`.
- Add an explicit connector-order assertion:

```ts
expect(NAV_CONNECTORS.map((c) => c.key)).toEqual([
  'team', 'client', 'upwork', 'teams', 'whatsapp', 'googlechat', 'discord'
])
expect(NAV_CONNECTORS.map((c) => c.label)).toEqual([
  'Our Slack', 'Client Slack', 'Upwork', 'Microsoft Teams', 'WhatsApp', 'Google Chat', 'Discord'
])
```

- Keep `s:client` / `s:team` assertions; selection ids do not change.

**Acceptance:** card sidebar reads `Connect channel`; Our Slack is first; Client Slack second; WhatsApp is present; only one Schedules row; main rail nested row reads `Project`.

---

## Phase 2 — One channel picker, correct channels for each source

### 2.1 Use the project's Our Slack channels when present

**File:** `src/renderer/src/components/dashboard/ExpandedWorkspace.tsx`

Today the team dropdown always uses the global `teamWorkspace.channels`. Change the merge to:

```ts
const teamListed = project.ourSlackChannels?.length
  ? project.ourSlackChannels
  : (teamWorkspace?.channels ?? [])
const teamWatched = project.ourSlackChannels ?? []
```

Then pass:

```ts
teamChannels: teamListed.map((c) => ({ id: c.channelId, name: c.channelName })),
teamConnected: Boolean(teamWorkspace?.connected || project.ourSlackChannels?.length),
watchedChannels: identity.channels.map(...), // client watched only
```

Extend `buildConnectorChannelLists` so the team list also accepts a `teamWatched` argument and tags those rows `synced`. The global list remains the fallback for legacy projects that have no `ourSlackChannels` (Phase 4 removes that fallback when sync is rewired).

### 2.2 Remove the duplicate picker from the Slack panel

**File:** `src/renderer/src/components/dashboard/SlackChatTab.tsx`

- Remove the `channels` prop.
- Remove `channelId` state and `changeChannel`.
- `selectedChannel` becomes `lockedChannel` only.
- Toolbar shows a static label, never a `<select>`:

```tsx
<span className="ws-chat-channel-name">
  {lockedChannel
    ? `#${lockedChannel.name}`
    : source === 'ours'
      ? 'All Our Slack channels'
      : 'All Client Slack channels'}
</span>
<span className="ws-chat-count">…</span>
```

- The composer stays disabled until a channel is picked in the sidebar. Its existing placeholder already says “Pick a channel to reply”.
- Remove the now-unused `ws-chat-filter` / `ws-chat-select` CSS rules from `main.css`.

### 2.3 Resolve the open channel from the correct source

**File:** `src/renderer/src/components/dashboard/WorkspaceContent.tsx`

- Stop passing `identity.channels` to `SlackChatTab`.
- Keep `lockedChannel` lookup source-specific (it already chooses `channels.team` vs `channels.client` from `connectorOfSelection(sel)`). This ensures clicking a channel under **Our Slack** opens the Our Slack channel, not a client channel with the same id/name.
- The `source` prop stays `'ours' | 'client'`, so messages still come from the right store.

### 2.4 Tests

**File:** `tests/unit/workspace-nav.test.ts`

Add coverage for `buildConnectorChannelLists`:

- Team entries merge listed + watched channels.
- A watched team channel the token cannot list still appears and is marked `synced`.
- Client and team lists do not bleed into each other.
- Entries are sorted by name.

**Acceptance:** clicking Client Slack expands one list in the sidebar; choosing a channel opens that channel; the panel has no second channel dropdown; Our Slack shows Our Slack channels, not client channels; “All …” views show messages from the correct source.

---

## Phase 3 — Auth pane and Dashboard must not co-render

### 3.1 Close Dashboard when a profile app is selected

**File:** `src/renderer/src/App.tsx`

- Read `closeDashboard` from `useDashboardStore`.
- At the start of `handleSidebarSelectApp`, call `closeDashboard()` before any auth/embed flow. This makes clicking Slack/Teams/WhatsApp leave the Dashboard instead of layering a sign-in pane over it.
- Add `closeDashboard` to the callback dependency list.
- Guard the Dashboard render:

```tsx
const showDashboard = dashboardOpen && !browserAuthBusy
...
{showDashboard ? <DashboardView /> : showEmbed ? ... : null}
```

- Keep the auth pane as the only surface while `browserAuthBusy` is true.
- Do not change the card's own expanded state; when the user returns to Dashboard, the card reopens on Dashboard as designed.

### 3.2 Visual check

- No `DashboardView` subtree may be mounted while `AuthChromePane` is visible.
- The workspace sidebar (`Dashboard / Xomni / Connect channel / Project info / Visualizations / Settings`) must not appear beside a Google/Slack sign-in pane.
- Returning to Dashboard restores the project list and the card defaults to Dashboard.

**Acceptance:** image 1 can no longer happen; clicking the Slack app while Dashboard is open opens the app/auth surface without the card sidebar.

---

## Verification

Run after all three phases:

```bash
npm test -- --run
npm run typecheck
npm run build
npx eslint src/renderer/src/App.tsx \
  src/renderer/src/components/dashboard/workspace-nav.ts \
  src/renderer/src/components/dashboard/WorkspaceSidebar.tsx \
  src/renderer/src/components/dashboard/WorkspaceContent.tsx \
  src/renderer/src/components/dashboard/ExpandedWorkspace.tsx \
  src/renderer/src/components/dashboard/SlackChatTab.tsx \
  src/renderer/src/components/dashboard/DashboardRail.tsx \
  tests/unit/workspace-nav.test.ts
```

Expected: all tests pass, typecheck clean, production build clean, zero ESLint errors on touched files.

### Manual checklist

- [ ] Main rail: Dashboard expands and the nested row reads **Project**; clicking it opens the Dashboard.
- [ ] Card sidebar section reads **Connect channel**, not **Channels**.
- [ ] Connector order is **Our Slack → Client Slack → Upwork → Microsoft Teams → WhatsApp → …**.
- [ ] Clicking **Our Slack** expands Our Slack channels; clicking **Client Slack** expands client channels.
- [ ] Only one channel picker exists (sidebar). The Slack panel toolbar shows a label and count, not a `<select>`.
- [ ] Choosing a client channel opens it and enables the composer.
- [ ] Choosing an Our Slack channel opens it and enables the composer.
- [ ] “All Our Slack channels” shows only Our Slack messages; “All Client Slack channels” shows only client messages.
- [ ] Xomni has one Schedules row.
- [ ] Clicking a profile app while Dashboard is open does not show the card sidebar beside a sign-in pane.
- [ ] Compact cards, Recent strip, card height, and Dashboard metrics are unchanged.

---

## Out of scope

- New-project wizard (config Phase 2).
- Card settings / per-field overrides (config Phase 3).
- Per-project Our Slack sync, shared fetch cache, rate limiting, and source-health status (config Phase 4).
- Adding real Upwork / Teams / WhatsApp integrations.
- Renaming the real Slack browser app in the profile tree (see Naming decisions; optional one-line follow-up).
- Any data model, IPC, token, secret, or sync engine change.

---

## Approval gate

I will start Phase 1 only after approval of this plan, then stop after each phase with test/typecheck/build results and the manual evidence above.
