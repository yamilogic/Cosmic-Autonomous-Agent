# Expanded Dashboard redesign — approved plan

Scope: only the expanded card's **Dashboard** tab. Every other tab keeps
`.ws-content-inner { max-width: 860px }` (`src/renderer/src/assets/main.css:3933`).
Approved 2026-10-25 with the deltas recorded at the bottom of this file.

**Placement decision (approved):** the setup checklist lives once, in the right
rail. The centre's empty Activity / Time and pace / Mood trend panels collapse
with no placeholder.

## Layout decision

- `.dash-page` becomes the query container (`container-type: inline-size`), so
  breakpoints measure the real content width (card width minus the in-tab nav).
  - **>= 1180px**: 12-col grid, KPI `repeat(6, 1fr)`, main 8 / rail 4, gap 20.
  - **760–1179px**: KPI `repeat(3, 1fr)`, main full width, rail below in a 2-col flow.
  - **< 760px**: one column everywhere.
- `.dash-inner`: `max-width: 1480px`, padding `28px 32px 40px`, gap 20. Column
  flex/grid flow only — no horizontal scroll.
- Card chrome: drop borders, use one surface tint + 12–14px radius, one accent;
  the warning tile gets a 3px left inset accent, not a full yellow border.
- Empty panels are not rendered. The only deliberate one-line empty state is the
  attention widget ("Nothing waiting" / "Not enough info yet").
- The fixed card height + internal `.dash-scroll` stay (`.ws-shell` already has
  `container-type: inline-size`, `src/renderer/src/assets/main.css:3058-3064`).

## Data map — where every widget gets its numbers

| Widget | Data source | Status |
|---|---|---|
| Progress / Status / Mood / Response / Last contact | `snapshot.metrics` (`src/main/dashboard/metrics.ts`, built in `sync-engine.ts:471-503`) + `snapshot.insight` (existing fields only) + `snapshot.project` | existing |
| Waiting count + oldest | `snapshot.metrics.waiting` — see waiting semantics below | fix |
| Activity 14d bars | `snapshot.metrics.daily` / `messages24h` | existing |
| Time & pace | `view.centre.visuals.timeElapsed` (`card-view.ts:231-279`) | existing |
| Mood trend | `snapshot.metrics.moodTrend` (>= 3 runs only) | existing |
| New since last visit | `snapshot.metrics.newSince` (lastViewedAt from `views.json`) | existing |
| Client asks / deliverables | `snapshot.insight.requirements` / `.deliverables` (LLM fields, no new LLM calls) | existing |
| Setup checklist | `project.monitors`, `project.ourSlackChannels`, `project.startDate/endDate`, `snapshot.syncState`, `getProjectChatStatus().hasKey` | existing |
| Ball in court | **new** activity IPC: client-workspace rows only; last client vs last self reply | new |
| Latest messages | **new** activity IPC: merged client + mapped our-Slack rows, newest 6, noise filtered | new |
| Top participants / channels (14d) | **new** activity IPC: counts from stored deltas, names from `users.list` | new |
| Ask agent (REMOVED) | Feature cancelled; removed from project card top bar | removed |

The activity IPC reuses `DashboardChatService` because it is the only place
that already resolves Slack display names (`workspaceContext`, 5-minute cache,
`src/main/dashboard/chat-service.ts:184-219`). Its "ours" side uses
`project.ourSlackChannels` (not the whole global team list), so unrelated team
chatter never leaks into a project. If `users.list` fails or `users:read` is
missing, the real Slack user id is shown — never a guessed name.

## New selectors / functions

- `src/main/dashboard/activity-summary.ts` (pure, no I/O):
  - `buildProjectActivity({ rows, now })` → recent 6, participants top 3 (14d),
    channels top 3 (14d), ball-in-court.
  - Ball in court: no client message → `null`; last client newer than last self
    reply (or no reply) → `you`; otherwise `client`. Only client-workspace rows.
- `DashboardChatService.projectActivity(projectId)` — reads deltas, resolves
  names, maps to rows, calls the selector.
- Renderer helpers in `dashboard-format.ts` (pure): `progressDisplay`,
  `oldestWaitingLabel`, `latestRequirementsByRecency`, `dailyTotals`,
  `sourceSelectionId`, `initials`.
- `shortcut-label.ts` (pure): platform-aware `mod` label (`⌘` on Mac, `Ctrl`
  elsewhere) for the toast, sidebar titles and the shortcut help.

## Files

Shared / main:

- `src/shared/dashboard-contract.ts` — activity types + `getProjectActivity` bridge type.
- `src/main/dashboard/activity-summary.ts` (new).
- `src/main/dashboard/chat-service.ts` — `projectActivity()`.
- `src/main/ipc/dashboard.ipc.ts` — new handler (inside the existing `chatService` block).
- `src/shared/ipc-contract.ts`, `src/preload/index.ts` — new channel + bridge.
- `src/main/dashboard/metrics.ts` — waiting semantics (approved):
  - `count` = `needs-reply` + open client questions, **deduped**.
    Dedupe key: `kind` is ignored for the pair only; the key is
    `normalize(text)` where `normalize` = trim, collapse whitespace, lowercase,
    strip trailing `?.!`. The needs-reply item's text is `lastClientMessage.quote`
    when present, so a question that is also "needs reply" appears once (the
    `needs-reply` row wins and the duplicate `question` row is dropped).
  - `blockers` and `risks` do **not** add to `count`; they are exposed as a
    separate `also` sub-line (`1 blocker · 2 risks`).
  - `oldestIso` = oldest real timestamp among attention items
    (`needs-reply.whenIso`, `blocker.sinceIso`); items without a timestamp are
    ignored, so an all-untimed list yields null.
  - `items` still contains all kinds (needs-reply, question, blocker, risk),
    capped at 5.
  - Required test: one question that is both needs-reply and an open question
    yields `count === 1`.
- `electron.vite.config.ts` — dev-only `import.meta.env.ORBIT_DEMO_DATA` define.

Renderer:

- `src/renderer/src/components/dashboard/DashboardPage.tsx` — rewrite orchestrator.
- `dashboard-kpis.tsx`, `dashboard-centre.tsx`, `dashboard-rail.tsx`,
  `SetupChecklist.tsx`, `useProjectActivity.ts`, `dashboard-format.ts` (new).
- `src/renderer/src/components/dashboard/card-view.ts` + `CompactCard.tsx` — A5 progress null.
- `src/renderer/src/components/dashboard/demo-data.ts` (new, dev-only) +
  `src/renderer/src/hooks/useDashboard.ts` (demo snapshot override) +
  "Demo data" watermark in the dashboard header.
- `AgentChatPanel.tsx` + `ExpandedWorkspace.tsx` + `WorkspaceContent.tsx` —
  Ask-agent question auto-sends once status is loaded and a key exists.
- `App.tsx`, `ProfileSidebar.tsx` — toast state + platform labels.
- `src/renderer/src/assets/main.css` — layout, surface cards, breakpoints.

Tests:

- `tests/unit/dashboard-activity-summary.test.ts` (new).
- `tests/unit/dashboard-metrics.test.ts`, `dashboard-chat-service.test.ts`,
  `dashboard-card-view.test.ts`, `dashboard-card.test.ts` (update/extend).
- `tests/unit/shortcut-label.test.ts` (new).
- `tests/ui/dashboard-page.test.tsx` (new), `agent-chat-panel.test.tsx` (auto-send).

## Phases (one feature commit + one ledger commit each)

**Phase 0 — A5 close-out + waiting semantics + toast (three separate commits)**
- 0a Compact card: `CardSummary.progress` becomes `number | null` (manual
  completion wins, else insight with non-empty `progressEvidence`, else null).
  `CompactCard` shows `—` + "Progress not stated in chat".
- 0b Waiting semantics as specified in the data-map section, with the duplicate
  test.
- 0c Toast: first measure root cause (`getBoundingClientRect()` vs
  `innerHeight`, and which state transitions fire it), report it, then fix:
  show only on expanded→collapsed, clear on expand, auto-dismiss after 6s,
  platform-correct modifier in all hardcoded `⌘B`/shortcut labels. A test proves
  the toast fires only on visible→hidden.
- Each item is its own feature commit + ledger commit, with the phase gates.

**Phase 1 — layout shell**
- `.dash-inner` width/padding, container queries, `.dash-columns` / `.dash-main` /
  `.dash-rail`, borderless surface cards, slim freshness bar. No data changes.

**Phase 2 — top: freshness + KPIs**
- Freshness bar + `Sync now` (needs `onSync` passed down); [REMOVED: Ask agent + suggestion chips cancelled].
- Six KPI tiles with 32px/500 values, 12px sentence-case labels, no fake zeros;
  "Oldest: 16d" / "Age unknown"; "Needs 3+ replies to measure"; waiting metric fix.

**Phase 3 — centre**
- Hero + deterministic Ball-in-court chip (tooltip states the rule).
- Activity 14d (~160px chart area) with legend + 14d totals; hidden when empty.
- Latest messages (newest 6, initials avatar, name, age, #channel, source chip,
  text, click → `requestMessageJump` + source-aware navigation; "View all").
- Time & pace and Mood trend side by side only when their data exists; otherwise
  they are not rendered.

**Phase 4 — rail**
- Attention max 5 at top, type/age/source + jump, `N open`; empty line only when
  metrics are available, otherwise "Not enough info yet". Sub-line reports
  blockers/risks separately (`1 blocker · 2 risks`).
- New since last visit: count chips + max 6 items, hidden when nothing new.
- Setup checklist (5 rows: client sync, client channels, our Slack channels,
  dates, AI key), per-row action, `n of 5`, hidden when complete.
- Client asks: latest 3 requirements by recency, total, deliverables bar when present.
- People & channels: top 3 participants + top 3 active channels (14d), hidden when empty.

**Phase 5 — tests + demo + visual proof**
- Unit + jsdom tests listed above; all-empty render has no widget boxes and no crash.
- Demo fixture (`ORBIT_DEMO_DATA=sparse|rich`) is **renderer-only**: it never
  writes to the delta store, project store, disk, or Slack sync; it only replaces
  the in-memory view model and shows a "Demo data" watermark.
- Six screenshots at 1100/1500/1900 × sparse/rich in `.omc/screenshots/`.
- Live Electron via CDP: no horizontal overflow, correct truncation, internal
  scroll, toast rect inside the viewport.
- Proof a normal production build contains no demo data: grep the fixture
  sentinel in `out/renderer` and show zero matches.

## Verification every phase

- `npm run typecheck` (node + web) exit 0.
- `npm test` — full suite, no regressions.
- `npm run build` exit 0.
- ESLint on every changed/new file: 0 errors.
- `.omc/status.md`: file:line or test name + commit hash.

## Approved deltas (2026-10-25)

1. Setup checklist: right rail only; centre empty panels collapse silently.
2. Waiting count dedupe + blockers/risks as a sub-line only (see data map).
3. Ask agent: [REMOVED] cancelled from project card; chat entry remains accessible via the Xomni tab in the rail.
4. Demo data is a renderer-only in-memory fixture; never persists anywhere;
   "Demo data" watermark; production-bundle grep proof.
5. `dashboard:project-activity` IPC: validate `projectId` against the monitor
   store; read only the last 14 days with a per-channel cap; cache for ~60s or
   invalidate from delta-store mtime; our-Slack rows restricted to
   `project.ourSlackChannels`.
6. Toast root cause measured and reported before the fix; test proves the toast
   fires only on visible→hidden.
7. Phase 0 ships as three separate commits (0a compact card, 0b waiting, 0c toast).

## Non-goals / known gaps

- No new LLM calls, no invented metrics, no sample numbers in a normal production build.
- No new direct token or AI-settings reads in the renderer; only `hasKey` from the
  existing status IPC is displayed.
- `CentreVisuals` (Visualizations tab) still uses the time-based `snapshot.completion`
  fallback; that tab is outside this task and is flagged, not silently changed.
