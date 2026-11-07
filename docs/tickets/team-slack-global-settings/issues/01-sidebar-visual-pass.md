# 01: Sidebar v5 — dropdown sections built to the design reference

**Parent:** docs/superpowers/specs/2026-10-25-team-slack-and-global-settings-design.md

**What to build:** The expanded card's left sidebar is rebuilt to the approved reference mock
(`orbit_card_sidebar_redesign.html`): a 236px panel that collapses to a 56px icon rail with tooltips.
Dashboard sits at the top as the default landing. Below it four sections — **Xomni**, **Slack**,
**Project info**, **Visualizations** — are click-to-open dropdowns: Xomni holds Chat with project,
Talk to AgentWork and Schedules; Slack holds **Client Slack** and **Our Slack**; Project info holds three
collapsible sub-groups that **start closed** (Needs attention → Needs reply, Blockers, Risks, Next steps;
Project → Requirements, Scope and deliverables, Decisions, Commitments, Files and links, People and channels;
Signals → Client mood, Activity, History); Visualizations holds Progress, Time elapsed and Last 7 days, and
**no chart ever renders inside the sidebar** — a click shows it big in the centre panel. Settings stays pinned
in the footer.

The panel reads as designed, not assembled: the sidebar is one surface step *below* the centre with a single
1px divider between them, no borders on items and no rules between sections; the active row is a soft fill plus
a 3x14px accent marker on the left edge; rows are 32px (children 30px), radius 8px, body 13px, section labels
12px muted sentence case; icons are 16px outline, muted at rest and accent when active. The centre panel is
padded 40px/48px to a ~860px measure and opens with a small muted project-name label above a 22px sentence-case
heading. This replaces the v4.1 static-label layout by explicit request — section labels are now interactive,
and the Slack section is named **Slack** again because its two entries name the two workspaces.

Selecting **Our Slack** while no team workspace is connected shows a "Connect workspace" empty state that points
at Global Settings. Nothing is invented: no count, channel, mood or date appears that the existing card view does
not already carry, and the Zustand store, the dashboard contract types and the card head are not touched.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] The sidebar renders exactly Dashboard, the four dropdown sections with the item lists above, and Settings
      pinned last; the primary application sidebar is unchanged.
- [x] Clicking a section header or a sub-group header opens and closes its children, and the chevron rotates to
      -90deg while closed (transform only, with a reduced-motion fallback).
- [x] The three Project info sub-groups are closed on first open; section dropdowns are open on first open.
- [x] Exactly one row is active anywhere in the sidebar, and the active row carries the soft fill plus the
      3x14px left accent marker.
- [x] Rows whose data count is zero are dimmed; rows with data show a plain number in one right-aligned column —
      never a badge, pill or coloured chip.
- [x] Client Slack opens the card's own workspace messages (scrollable, reply); Our Slack with no team workspace
      shows the "Connect workspace" empty state instead of an invented list.
- [x] Visualizations rows render their chart only in the centre panel.
- [x] Schedules stays visibly inert with its reason on hover.
- [x] `Risks` stays reachable, because a card chip deep-links to it, so it renders in Needs attention even though
      the mock lists three items there.
- [x] Open/close state, the per-section remembered selection and the single active item persist per project under
      the existing storage key; state saved by the previous version still loads with its selection intact and with
      the new defaults applied.
- [x] The rail collapses to 56px showing Dashboard, Xomni, Slack, Project info, Visualizations and Settings as
      icons with tooltips and accessible names, each restoring its section's last selection; expanding restores
      the previous open/close state.
- [x] The sidebar stays drag-resizable (180–400px, 236px default, double-click reset) and auto-collapses on a
      narrow card.
- [x] Every colour and font comes from the existing `:root` token blocks; the sidebar/centre surface pair and the
      hover/selected fills are new named tokens, not literals.
- [x] `pnpm typecheck`, `pnpm vitest run` and `pnpm build` pass; the result is shown live in the Electron window
      with screenshots at expanded, collapsed, narrow-card and light-theme states.

## Evidence (2026-10-25)

- Measured live in the built Electron app over CDP: nav 236px expanded / 56px rail, sidebar
  `rgb(18,20,25)` against centre `rgb(25,28,35)` with a 1px `rgb(43,48,58)` divider, rows 32px,
  sub-items 30px, section labels 28px tall at 12px/600 sentence case, accent marker
  3x14px `rgb(169,155,255)` at `left:-10px`, centre `padding 40px 48px 48px` at `max-width 860px`,
  title 22px/500, eyebrow 12px.
- Screenshots: expanded, every section and sub-group open, rail collapsed, narrow card
  (container-driven auto-collapse at 720px while `collapsed` stays false), light theme,
  Client Slack with the real channel strip, and Our Slack on the "Connect workspace" empty state.
- Behaviour: one active row at a time; a closed section or sub-group that owns the active body
  carries the marker (`is-holding`) instead of losing it; toggling a section never changes the
  centre; the rail restores each section's last selection; counts are plain numbers with zero rows
  dimmed; a legacy v4 blob migrated to `rev:5` and re-persisted with its selection intact.
- `pnpm vitest run` → 24 files / 209 tests passed (42 in `tests/unit/workspace-nav.test.ts`),
  `pnpm typecheck` clean, `pnpm build` clean.
- No new data paths were added for the sidebar; the Our Slack empty state and every count come
  from the existing card view. The team-workspace *connection* itself is ticket 04, so that row
  stays on its empty state until then.

## Review round (2026-10-25)

Two-axis review (Standards + Spec) over the diff. Fixed:

- **A deep-link reset the whole nav.** `navFromEntryProps` built from `DEFAULT_NAV`, so a compact
  chip or the gear wiped the saved width, un-collapsed the rail and reopened every section the user
  had closed. It now applies on top of the persisted state and opens only the section it lands in;
  verified live (width 310 kept, `openSections` `['xomni'] → ['xomni','info']`, one active row).
- **A saved state could disagree with itself.** `migrateNavState` trusted the stored `openGroup`
  next to a stored `selection`; when they disagreed no row was active and the centre showed the
  Dashboard body. A remembered row now always owns the centre.
- **Schedules' reason never appeared.** Chromium suppresses tooltips on a `disabled` button, so the
  row is `aria-disabled` instead (verified: `disabled` false, `aria-disabled` true, tooltip text
  present, 0.55 opacity, `not-allowed` cursor).
- **Project info reached from the rail with nothing picked showed the Dashboard body under a
  "Project info" heading.** It now says to pick a row.
- **The Our Slack empty state did not name where to connect**, and the rail fallback width said
  232px against a 236px default. Both corrected.
- **Type narrowing restored:** the deep-link entry is `WorkspaceEntryTab`, not `string`, so an
  unknown tab fails the typecheck instead of silently landing on the Dashboard.
- Dead code removed (`isSlackId`, the identity map in the guide-section branch).

Documented, per `docs/dashboard-ui.md`'s own rule that a card-design change updates it in the same
commit: §4 (sidebar layout, actions menu, the whole §4.4 nav reference, §4.5–4.7 wording), §5.3,
§7 (component map) and §8 rewritten for v3.0; `GLOSSARY.md` gains **Workspace Sidebar, Xomni,
Client Slack, Our Slack, Project info, Visualizations** and corrects **Wizard** to the 5 steps the
code actually runs.

Accepted as designed, not defects: the chat and Slack bodies are `is-bare` (no eyebrow/heading over
a full-height panel), the Schedules row stays a sidebar special case rather than a nav-model row
because it has no selection id to own, and the collapsed-rail CSS is written twice (once per
trigger) because a container query cannot share a rule block with the `.is-collapsed` class.

Out of ticket 01's scope, disclosed: the `⋯` menu change (Edit project, Collapse moved into the
menu) came from the earlier compact-header phase, and `dashboard-contract.ts` gained
`DashboardChatTokenStatus` in the separate Slack-token commit — the ticket's "not touched" line
holds for the sidebar work itself, which adds no store, contract or IPC path.

## Fixed-footprint round (2026-10-25)

Reported: opening **Settings** from the sidebar made the card grow, and **Client Slack** grew it
differently again — the same card occupied a different box per row, so the rows beside it jumped.

Measured first (1920×1052, one card, one project): shell height `821 → 904 → 932` and its top edge
moving `170 → 99` across Dashboard → Client Slack → Settings. Cause: `.ws-shell` was
`min-height: min(78vh, 920px); max-height: calc(100vh - 120px)`, so any body taller than 78vh pushed
the card outward instead of scrolling.

- `.ws-shell` now pins one footprint (`height: min(78vh, 920px)`) and clips at the border radius.
- Fixing that exposed a latent gap: the Slack body rendered **outside** the card by 29px, because
  the card had been growing to fit it. `SlackChatTab.tsx` emits `.ws-chat`, `.ws-chat-toolbar`,
  `.ws-chat-messages`, `.ws-chat-composer` and `.ws-chat-hint` — none of which had any CSS in
  `main.css` at all (only the unrelated `.ws-chat-scroll` existed). They now carry the same flex
  contract the Xomni body already used: pinned strip, `flex: 1; min-height: 0; overflow-y: auto`
  message list, pinned composer and hint, plus bubble/channel/time styling for the messages.

Verified live over every row (Dashboard, Chat with project, Talk to AgentWork, Client Slack, Our
Slack, Progress, Settings) at 1920×1052 and at 1280×600: `shellH` 821 / `shellTop` 170 constant,
zero elements painted past the card's inner edge, Settings scrolling internally
(`ws-content-scroll` +586, +1081 at the short viewport) and Client Slack scrolling internally
(`ws-chat-messages` +46, +456) with the composer 36px inside the bottom edge.
`/tmp/fit2-*.png` holds the per-row shots.

Gates: typecheck clean, 213/213 tests, `pnpm build` clean, sloplint on `main.css` back to the
pre-change baseline (73 FAIL / 214 REFLEX — the new rules' off-scale paddings were snapped to the
4px grid rather than waived). `docs/dashboard-ui.md` §4.4 gains the footprint rule and the Slack
body's flex contract in the same commit.
