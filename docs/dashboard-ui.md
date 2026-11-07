# Orbit Dashboard — Complete UI Reference

> **Scope:** Everything the Dashboard page renders — the page shell, the focus line, the dense project row, and the full (expanded) workspace — with the exact labels, data sources, and behaviours from the code.
>
> **Code map:** `src/renderer/src/components/dashboard/` (renderer) · `src/main/dashboard/` (main process) · `src/shared/dashboard-contract.ts` (types)

---

## 1. What the Dashboard is

The Dashboard is a **local intelligence view over Slack client projects**. Each project = one workspace + a set of watched channels. The app polls Slack every 300 s (5 min), stores messages locally, and an insight engine (NVIDIA NIM, with a local heuristic fallback) distils them into a project card.

- **One card = one workspace/project.** Two workspaces are never merged on a card; the workspace name is always visible.
- **Everything is local.** Messages live in JSON under `<userData>/dashboard/`; the only network calls are Slack polling and the optional AI insight call.
- **One writable surface: Slack Chat.** The dashboard itself is read-only except for the **Slack Chat** tab, which posts replies with `chat.postMessage` (needs the `chat:write` scope) to a watched channel. No other tab or card action writes to Slack.

### How you open it

Left sidebar → **Dashboard** row (▦ glyph) → expands inline → **Slack** item (`#` glyph) → dashboard opens full-width in place of the Slack embed.

| Element | Behaviour |
|---|---|
| Dashboard row | Toggles the inline dropdown (`dashRailExpanded` in the Zustand store) |
| Slack item | Calls `openDashboard('slack')`; row gets `is-active` styling |
| Close | Navigate to a profile/app in the sidebar, or use the app's normal view switch |

The sidebar state survives re-renders because expansion lives in the store, not component state.

---

## 2. Dashboard page anatomy (top → bottom)

```
┌──────────────────────────────────────────────────────────────┐
│ Client projects        [Compact|Expanded|Mixed] [⋯] [Global settings] [New project] │
│ 1 project · Synced 4m ago · Every 5 min                      │
├──────────────────────────────────────────────────────────────┤
│ Across workspaces  Reply to AgentWork client confirming …    │
├──────────────────────────────────────────────────────────────┤
│ project row (compact) — expands in place into the workspace  │
│ … more rows …                                                │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 Header (`dash-head`)

One header owns the page: title, a quiet status sub-line, view mode, the actions menu and the primary action.

| Control | Label | Behaviour |
|---|---|---|
| Title | `Client projects` | Static |
| Status sub-line | `1 project · Synced 4m ago · Every 5 min` | Project count, freshness of the newest sync (`just now` / `Xm ago` / `Xh ago` / `Xd ago`), poll interval from `snapshot.syncIntervalSeconds`. While syncing the middle item reads `Syncing 2/5` |
| View mode | `Compact / Expanded / Mixed` | Sets `viewMode`; persisted to `localStorage['orbit.view']`. `Compact` clears `expandedIds`, `Expanded` fills it |
| ⋯ menu | **Sync all now**, **Collapse all**, **Expand all** | Sync all calls `syncNow()` with no id; Collapse/Expand all rewrite `expandedIds` |
| Secondary | `Global settings` | Opens the Global settings panel (`GlobalSettingsPanel.tsx`) — the one way in to the values that apply to every card. Its first section is the AI model and key |
| Primary | `New project` | Opens the 5-step DashboardWizard |

### 2.2 Focus line (`dash-focus`)

- Rendered only when `snapshot.digest` exists.
- Label `Across workspaces` + `digest.topPriority` — the single most urgent thing **across all workspaces** (≤20 words). This is the only place workspaces are combined.
- Built by the digest engine (`src/main/dashboard/digest.ts`), source `ai` or `local`.

### 2.3 Project list (`dash-list`)

- One `ProjectCard` per snapshot, each wrapped in its own `ErrorBoundary` (a broken card cannot take down the page).
- Rows stack vertically at full width with a 6 px gap and a hairline between rows; every row expands **in place** into the full workspace (no modal, no second page).
- **Empty state** (`empty-state`): shown when there are zero projects — a `+` mark, the 5-step setup in one sentence (create Slack app → token → channels → card → live sync) and a `New project` button.

**View-mode semantics**

| Mode | What renders |
|---|---|
| **Compact** | Every card is the dense project row; `expandedIds` cleared |
| **Expanded** | Every card is the full workspace card |
| **Mixed** (default) | Per-card state: a card is expanded if its id is in `expandedIds` |

### 2.4 Page-level states

| State | What you see |
|---|---|
| Loading (no snapshot yet) | Centred spinner + `Loading dashboard…` |
| Load error | `Failed to load dashboard` + message + `Retry` |
| Render error (boundary) | `Dashboard Error` + message + `Retry` (clears error and reloads) |
| Auto-refresh | `loadSnapshot()` every 60 s while the page is open |

### 2.5 Wizard overlay

When `wizardOpenFor` is set, `<DashboardWizard />` renders over the page. It is the same wizard used by `New project` and by each card's Settings body (edit mode, prefilled).

---

## 3. Recent feed (backend only)

**v2.8:** the horizontal Recent strip was removed from the page — the focus line already surfaces the single most urgent item, and the project rows carry per-project state. The ranked feed is still built in the main process and served over `dashboard:get-recent`, so a future surface can consume it without rework.

**Purpose of the feed:** the newest *important* changes across all workspaces, one item per project, ranked by importance — not by time.

### 3.1 Feed item shape

| Field | Source | Notes |
|---|---|---|
| `teamName` | workspace | Always present — hard rule: workspace never hidden |
| `status` | insight / heuristic | `on-track` · `at-risk` · `blocked` · `waiting-on-client` |
| `projectName` | project record | Bold in any future UI |
| `oneLine` | insight `recentLine`, else newest non-noise message | ≤110 chars |
| `needsReply` | insight | True when a reply is owed |
| `delta` | status history | Status change, e.g. `at-risk → on-track` |
| `ts` | newest message | Rendered as `now` / `14m` / `3h` / `14d` |
| `channelName` | newest message | The channel it came from |

### 3.2 How items are built & ranked

`src/main/dashboard/recent-feed.ts` — pure local data, no LLM/Slack call per item:

1. For each project, take the **newest non-noise message** from its own workspace/channel buckets.
2. Text = insight `recentLine` if present, else the cleaned newest message.
3. Classify the text: `blocker` → `client-question` / `client-message` → `decision` → `delivery` → `chatter` (keyword regexes).
4. Score by importance:

```
score = (needsReply ? 35 : 0)
      + (urgency === 'high' ? 15 : 0)
      + statusWeight   (blocked 30 · at-risk 24 · waiting-on-client 20 · on-track 8)
      + 20 × e^(−hoursSince / 12)      ← recency decay
      + min(15, newMessages)           ← last-sync activity
      − (hoursSince ≥ 48 ? 10 : 0)     ← staleness penalty
```

5. Sort by score desc, then newest first as tie-breaker.

So a workspace **waiting on the client outranks a busy but healthy one**, and a blocked project outranks everything except a direct reply request.

---

## 4. The full (expanded) card

Rendered when the card is expanded (mode `expanded`, or `mixed` + id in `expandedIds`). Root element: `article.ws-shell`, `data-expanded="true"`.

```
Agentwork  [Waiting on client] [Needs my reply]   AgentWork  Agentwork-Application
AI 7h ago  private/nvidia/nemotron-3.5-super-120b-a12b                     [Sync] [⋯]   ← CardHead
┌────────────────────┬──────────────────────────────────────────────────┐
│ Dashboard      ▸   │  Agentwork                    ← muted eyebrow     │
│ Xomni          ▾   │  Risks                        ← 22px heading      │
│  Chat with project │                                                   │
│  Talk to AgentWork │  Things called out in chat that could go wrong.   │
│  Schedules (inert) │  <the body this row owns>                         │
│ Slack          ▾   │                                                   │
│  Client Slack    2 │                                                   │
│  Our Slack         │                                                   │
│ Project info   ▾   │                                                   │
│  Needs attention ▾ │                                                   │
│  Project       ▸   │                                                   │
│  Signals       ▸   │                                                   │
│ Visualizations ▾   │                                                   │
│ Settings     (pin) │                                                   │
└────────────────────┴──────────────────────────────────────────────────┘
   sidebar (nav)              centre panel (content)
```

One nav and one content area. The old 10-tab bar and the three-pane Summary are gone: every former tab is now a row in the sidebar, and a row's body renders full measure in the centre.

### 4.1 No breadcrumb

The card expands in place in the project list, so the row itself supplies context; the old `Workspaces › <project>` line was removed.

### 4.2 Status flags in the header

Only the states that are actually true render, as compact chips beside the project name:

| Chip | Rendered when | Tone |
|---|---|---|
| `On track` / `At risk` / `Blocked` / `Waiting on client` | current `summary.status` | green / amber / red / amber |
| `Needs my reply` | `summary.needsReply` | red |
| `Inactive 24h+` | `summary.inactive` | grey |

There is no row of always-visible, dimmed pills: a state that does not apply is absent, not greyed out.

### 4.3 CardHead — identity and actions

Expanded cards use `CardHead.tsx`. Two halves:

**Left — identity & state**

| Element | Content |
|---|---|
| Project name | 17 px, weight 650, break-word + tooltip |
| Status flags | The chips above, immediately after the name |
| Workspace | `teamName`, faint 12 px text |
| Client | `clientName`, only when it differs from the workspace |
| AI badge | e.g. `AI 7h ago  private/nvidia/nemotron-3.5-super-120b-a12b`, or `no insight yet`; wraps below the identity line on narrow cards |

**Right — actions**

| Button | Label | Action |
|---|---|---|
| Sync | `Sync` (or `Syncing…`, disabled) | `syncNow(projectId)` |
| Menu | `⋯` | **Edit project** (opens the wizard prefilled) · **Project settings** (selects the Settings row) · **Collapse** (collapses in place, scrolls the row to the top, flashes it) · **Delete project** (red) |

Collapse lives in the menu, not in the header row: the header carries identity and the one action that matters (Sync).

### 4.4 The workspace sidebar (v5)

`WorkspaceSidebar.tsx` draws the tree from `NAV_SECTIONS` in `workspace-nav.ts` — that model is the single source for the rows, their labels, copy, icons and validity, and it is unit-tested without React or a DOM.

| Part | Rows | Behaviour |
|---|---|---|
| **Dashboard** (top) | — | The default landing: the flat Summary stack (`CentreContent`). |
| **Xomni** | Chat with project · Talk to AgentWork · Schedules | The first two open the chat panel (`AgentChatPanel`) in bare mode. **Schedules is inert** — `aria-disabled` with its reason as the tooltip (`aria-disabled`, not `disabled`, because a disabled button swallows its own tooltip). |
| **Slack** | Client Slack · Our Slack | Client Slack opens the card's own workspace messages (`SlackChatTab`: channel strip, auto-scroll to newest, older pages on scroll-up, sender/time/`#channel` chip). Its composer posts through `dashboard:send-message` → `chat.postMessage`, updates optimistically and shows errors inline — **the app's only writable Slack surface**. Our Slack opens the "Connect workspace" empty state until a team workspace exists (ticket 04) — never an invented list. |
| **Project info** | three sub-groups, **closed on first open**: Needs attention (Needs reply, Blockers, Risks, Next steps) · Project (Requirements, Scope and deliverables, Decisions, Commitments, Files and links, People and channels) · Signals (Client mood, Activity, History) | Each row opens its body: `d:` → a `guide-content` detail body, `g:` → a guide-section body. Risks stays a row because a compact chip deep-links to it. |
| **Visualizations** | Progress · Time elapsed · Last 7 days | The chart renders **only** in the centre (`CentreVisuals only={key}`, bigger donut/taller bars), never in the sidebar. |
| **Settings** (pinned footer) | — | The per-card Settings body (§4.4.1). |

Interaction rules:

- Section headers and sub-group headers open and close on click; the chevron rotates to −90deg while closed (transform only, with a `prefers-reduced-motion` fallback). Toggling a section never changes the centre.
- Exactly one row is active panel-wide: soft fill plus the 3x14px accent marker on the left edge. A closed section or sub-group that owns the active body carries the marker itself (`is-holding`), so the active body always has a visible home.
- Rows show a plain number in one right-aligned column when their real count is non-zero, and dim (`is-empty`) at zero. No badges, pills or chips.
- State persists per project under `orbit.workspace.nav.<projectId>` (`rev: 5`): open sections, open sub-groups, the single active row, and one remembered row per section for the rail. Blobs saved by v3/v4/v4.1 load through `migrateNavState()` — older shapes get all sections open and their saved sub-groups carried over, a remembered row always wins the centre, and invalid rows drop to `null`.
- Geometry: 236px default, drag-resizable 180–400px (double-click the divider resets, Arrow keys nudge by 12px, 32px with Shift), collapsible to a 56px icon rail via the `«` button. The rail shows Dashboard, Xomni, Slack, Project info, Visualizations and Settings as icons with tooltips and accessible names, each restoring its section's remembered row; a card narrower than 720px auto-collapses through a container query without touching the saved state.
- A deep-link (compact chip → Risks, gear → Settings) applies on top of the persisted state, so it moves the selection and never resets the width, the rail or the sections the user closed.
- Footprint: the expanded card is one fixed box (`height: min(78vh, 920px)`) for **every** row. A body longer than the box scrolls inside it (`.ws-content-scroll`, `.ws-chat-messages`, the nav list) and never resizes the card or shifts the rows beside it.

Look: the sidebar is one surface step below the centre (`--nav-bg` / `--content-bg`) behind a single 1px divider, no borders on rows; 32px rows (children 30px), 8px radius, 13px body, 12px muted sentence-case section labels; 16px outline icons (`nav-icons.tsx`), muted at rest, accent when active. The centre is padded 40px/48px to a ~860px measure and opens with the project name as a small muted eyebrow above a 22px sentence-case heading. Chat and Slack bodies are `is-bare` — they fill the panel and skip that header. The Slack body is a flex column: the channel strip, composer and hint stay pinned, and the message list takes the remaining height and scrolls on its own.

#### 4.4.1 Settings (the sidebar's pinned row)

The card-header **⋯ → Project settings** (or the compact row's `⋯`, or the Settings row) selects this body. It has four sections:

| Section | Controls | Behaviour |
|---|---|---|
| **AI settings** | Provider (`NVIDIA NIM`), Model dropdown (loaded from `dashboard:list-ai-models`), API key (password field with **Show/Hide**), **Use global settings** | Stored per project. With the toggle on the project key/model are ignored, the fields go inert, and a line under the toggle names what is inherited (`Inheriting from Global settings — Using global: <model> · global key ••••abcd`). The **Effective now** box shows the same resolution. Field labels and that box head are sentence case, like every other label in the app. Only the mask ever reaches the renderer; keys are encrypted with `safeStorage` in the main process. |
| **Workspace & channels** | Summary line + **Edit workspace & channels** | Mounts the 5-step `DashboardWizard` inline (starts at channel selection, preserves OAuth connectors). Saving triggers a sync. |
| **Slack token & permissions** | Read-only status line: connection, workspace name, masked token, granted scopes, and whether `chat:write` is present | `dashboard:chat-token-status` → `DashboardChatService.chatTokenStatus()`. The raw token never leaves the main process; the renderer gets the mask. When Slack reports no scopes for the token type, the panel says sending is decided by the token instead of guessing. |
| **Schedule & completion** | Start date, End date, Completion % (0–100) | Writes through `upsertProject`; manual values win over dates/percentages extracted from chat. |

**Global settings** is the toolbar button beside **New project** (`GlobalSettingsPanel.tsx`) and the only route to the dashboard-level values — the `⋯` menu's old **AI settings** item is gone. Its first section, **AI model and key**, edits the same form without a project scope: its key/model are the fallback for every project. Resolution order per field is **project override (unless `useGlobal`) → dashboard global → environment defaults**; the insight engine and project chat both obtain providers through `AiSettingsService.resolveSettings(projectId)`. With no key anywhere, AI features stay off and the card keeps its heuristic insight. Tickets 03 and 04 add the remaining groups (sync, dates, prompt defaults, the team Slack connection) as sections of this one panel.

### 4.5 Visualizations (the sidebar's chart rows)

The Dashboard body (`CentreContent`) is the project's flat summary stack: situation, just changed, next step / highlights / last client message, separated by hairline dividers. The charts that used to sit in a left pane are now three sidebar rows, each rendering alone in the centre at a larger scale:

| Row | Contents | Source |
|---|---|---|
| Progress | Donut `0–100%`, 180px when opened alone, percentage in the middle | `summary.progress` |
| Time elapsed | Start → due with a pace verdict (behind / on pace / ahead); `Dates not stated in chat` + **Add dates** when missing; work-done vs time-used bars | `effectiveDates`, `paceLabel`, `daysUsed/daysTotal` |
| Last 7 days | One bar per day at 160px tall, today in accent, tooltip with the count | `week[]` |

No chart renders inside the sidebar itself.

**Guide section bodies (the `g:` rows):**

| # | Body contents |
|---|---|
| 1 | Project start (date + badge: `from chat` / `manual` / `not stated in chat`), Project due, Milestones list (label · date · Done/Open chip) |
| 2 | Requirement cards: text, source file chip, `by <who>`, timestamp |
| 3 | Three blocks: **In scope**, **Out of scope**, **Deliverables** (name + status chip: done / in progress / pending / not started) |
| 4 | Decision cards: what, `by <who>`, when |
| 5 | Commitment cards: what, `by <who>`, `due <date>` |
| 6 | File cards: name, type chip (PDF/DOCX/LINK/IMAGE/OTHER), `shared by`, date, **Open** link |
| 7 | **People** (name · role · Client/Us chip) and **Channels** (#name · message count · `new` chip) |

Each `g:` row renders its section body in the centre; the sidebar row carries the plain count. Section 1 (dates and milestones) is shown inside the Time elapsed and Dashboard bodies rather than as its own row.

### 4.6 Project info bodies (the `d:` rows)

Seven detail bodies, each opened by its sidebar row with the count in the right column. The sidebar groups them under Needs attention / Project / Signals; the grouping changes nothing about the bodies.

| Card | Count | Summary line | Body |
|---|---|---|---|
| **Needs Reply & Open Questions** (danger) | needsReply (0/1) + open questions | First open question, else last client quote, else `No reply needed` | Banner `Needs my reply · <urgency> urgency` or `No reply needed from you`; last client message with who/time; every open question |
| **Blockers** (info) | #blockers | First blocker text, else `None` | Each blocker: what, `owner:`, `since <date>`; empty → `No blockers — work can proceed` |
| **Risks** (warn) | #risks | First risk, else `None` | Each risk prefixed `⚠`; empty → `No risks identified in chat` |
| **Next Steps** (success) | #nextSteps | First next step | Each step prefixed `→`; empty → `No next steps defined yet` |
| **Client Mood & Signals** (accent) | 1 if a mood quote exists | Mood reason or `<mood> mood` | Mood chip (good/neutral/tense), reason, verbatim client quote |
| **Activity** (info) | 1 if any message in 24 h | `24h N · 7d N · client <age>` | 2×2 stats (24h, 7d, Client age, Me age) + last client message + my last reply |
| **History** (muted) | #history entries | `from → to` of latest | Each entry: `from → to`, timestamp, `+N msgs`; empty → `No status changes recorded yet` |

### 4.7 Schedule & completion (Settings body)

Moved out of the old ✎ modal. Open the card-header **⋯ → Project settings** (or the sidebar's **Settings** row) → **Schedule & completion**.

| Field | Meaning |
|---|---|
| Start date | Blank = use dates found in chat |
| End date / deadline | Project deadline |
| Completion % | 0–100, overrides the activity estimate (blank = auto) |

**Save schedule** calls `upsertProject` with the merged project. The card updates immediately (the snapshot re-derives `effectiveDates` and `completion` from the fresh project record).

---

## 5. The minimised (compact) row

Rendered when the card is collapsed (`compact` mode, or `mixed` + id not in `expandedIds`). It is one dense row rather than a card, so many projects scan in a few seconds.

```
▎ Agentwork  AgentWork  Agentwork-Application  Waiting on client          Needs reply  ▁▁▁▁ 0%  15d  ⋯  ›
▎ Client initiated contact and asked to start; no work has begun yet.
▎ [1 question]
```

A 3 px left bar carries the status colour (`is-on-track` green · `is-at-risk` amber · `is-blocked` red · `is-waiting-on-client` amber).

### 5.1 Row anatomy

| Area | Contents | Source |
|---|---|---|
| Head | Project name (650), workspace, client (only when different), status label | `name`, `workspaceName`, `clientName`, `status` |
| Situation | One line, ellipsis; `No summary yet` fallback | `situationLine` |
| Chips | `N question(s)` · `N blocker(s)` · `N risk(s)` — only when non-zero | `counts` |
| Side | `Needs reply` flag when owed · progress meter + `%` · client-message age | `needsReply`, `progress`, `paceLabel`, `lastClientAt` |
| Actions | `⋯` menu: **Sync now**, **Project settings**, **Delete project** | — |
| Chevron | Opens the full workspace in place | — |

The whole row body is one button (aria-label `Open <name>`); the chips, menu and chevron sit outside it so each keeps its own hit target.

### 5.2 Chips open the matching detail

| Chip | Opens |
|---|---|
| `N question(s)` | Needs Reply detail (101) |
| `N blocker(s)` | Blockers detail (102) |
| `N risk(s)` | Risks detail (103) |

Each chip expands the row and lands on that detail card; there is no second toggle at the bottom of the row.

### 5.3 Compact vs expanded — quick diff

| Aspect | Compact row | Expanded |
|---|---|---|
| Header | inline identity + status label, no actions until `⋯` | CardHead (Sync, `⋯`) + status chips + AI badge |
| Status | text label beside the identity, coloured left bar | chips beside the project name |
| Body | one situation line + state chips | sidebar nav + one centre body per row |
| Chat | none | Client Slack (writable) · Xomni chat |
| Project guide | none (chips jump into a detail) | guide rows 2–7 under Project info |
| Details | progress meter, pace tooltip, client age | detail rows with plain counts |
| Edit/Delete | `⋯` → Project settings / Delete | Settings row / `⋯` → Edit project · Delete |
| Purpose | scan many projects fast | work one project in depth |

---

## 6. How every value is computed

`buildCardSummary()` and `buildCardView()` in `card-view.ts` are pure and testable; the LLM insight wins, the heuristic fallback guarantees a card is never blank.

| Value | Rule |
|---|---|
| **Status** | `insight.status` (on-track / at-risk / blocked / waiting-on-client); `null` with no insight |
| **Situation line** | `insight.situationLine`, else first non-empty line of `snapshot.summary` |
| **Just changed** | `insight.recentLine` |
| **Next step** | `insight.nextStep` |
| **Progress** | `insight.progress` if present, else `snapshot.completion` (manual completion already wins upstream) |
| **Dates** | Insight dates if stated, else project manual dates (`manual` badge), else `not stated in chat` |
| **Days used / total** | From start/end dates; `ceil` day maths in UTC |
| **Pace** | Compare progress % against elapsed-time %: behind / on-pace / ahead, with a label |
| **7-day bars** | Per-day message counts from `perChannel` (last 7 days, today flagged) |
| **Needs reply** | `insight.clientAsk.needsReply` |
| **Urgency** | `insight.clientAsk.urgency` (low / normal / high) |
| **Inactive 24h+** | No last client message AND last sync older than 24 h |
| **Row chips** | `openQuestions`, `blockers`, `risks` lengths (files and requirements are sidebar rows) |
| **AI badge** | `AI <age> <model>` (or `heuristic …`, or `no insight yet`); the badge's dot-separated parts render as separate spans, never as a middle-dot string |
| **Synced label** | `synced <age>` from `lastUpdatedAt` |
| **Score** | Same importance formula as the Recent feed (used for ordering/debug) |

**Data flow:** Slack Web API → delta store (JSON per channel) → summary/insight engine → snapshot → IPC `dashboard:get-snapshot` → Zustand `useDashboard` → cards. Sync runs on the 300 s scheduler or on demand (`Sync` / `Sync all`).

---

## 7. Component map

| File | Responsibility |
|---|---|
| `DashboardView.tsx` | Page shell: one header (title, sub-line, view mode, actions menu, Global settings, New project), focus line, project list, empty/loading/error states, wizard host, Global settings panel |
| `DashboardRail.tsx` | Sidebar entry (Dashboard → Slack) |
| `ProjectCard.tsx` | Per-project switch between compact/expanded, deep-link entry props, memoised |
| `CardHead.tsx` | Expanded header: identity, true-state chips, Sync, `⋯` (Edit project · Project settings · Collapse · Delete), AI badge |
| `CompactCard.tsx` | Dense project row: identity, situation, state chips, meter, age, `⋯` |
| `ExpandedWorkspace.tsx` | Full workspace shell: CardHead + `WorkspaceSidebar` + `WorkspaceContent` in a `--ws-nav-w minmax(0,1fr)` grid |
| `WorkspaceSidebar.tsx` | The nav tree drawn from `NAV_SECTIONS`: dropdown sections, Project info sub-groups, counts, rail icons, drag resizer |
| `WorkspaceContent.tsx` | The centre: selection → body map, eyebrow/heading/desc chrome, bare bodies for chat and Slack |
| `workspace-nav.ts` | Pure nav model: sections and rows, selection ids, persistence shape, migration, toggles, deep-link merge, rail defaults |
| `useWorkspaceNav.ts` | Per-project nav state hook: reads/migrates `orbit.workspace.nav.<projectId>`, writes it back, exposes the actions |
| `nav-icons.tsx` | The 16px outline icon set used by the sidebar and the rail |
| `AgentChatPanel.tsx` | Xomni body: project chat / AgentWork mode shell and its empty state |
| `ProjectSettingsTab.tsx` | Settings body: AI form, inline workspace wizard, Slack token status, schedule/completion |
| `AiSettingsForm.tsx` | Shared AI settings form (project scope and global scope), including the inheritance line a project shows while it has no override |
| `GlobalSettingsPanel.tsx` | The dashboard's one settings modal: sections that apply to every card, AI model and key first |
| `guide-model.ts` | Guide sections, detail cards, hints, completion, chat-thread builder, date formatters |
| `guide-content.tsx` | Bodies for the 7 guide sections and 7 detail cards |
| `CentreContent.tsx` | Dashboard body: one flat stack (Summary, Highlights, Last client message) separated by hairline dividers |
| `CentreVisuals.tsx` | Progress / Time elapsed / Last 7 days; `only={key}` renders one chart large for its sidebar row |
| `card-view.ts` | Pure view-model: `buildCardView`, `buildCardSummary`, all derived values |
| `DashboardWizard.tsx` | 5-step add-project overlay, or inline channel editor in Settings |
| `ErrorBoundary.tsx` | Per-card and page-level crash isolation |
| `src/main/dashboard/recent-feed.ts` | Builds + ranks the Recent feed |
| `src/main/dashboard/digest.ts` | Cross-workspace digest line |
| `src/main/dashboard/ai-settings-store.ts` | Encrypted per-project/global AI settings persistence (`ai-settings.json`) |
| `src/main/dashboard/ai-settings.ts` | `AiSettingsService`: `resolveSettings`, provider cache, masked public views, model list |
| `src/shared/dashboard-contract.ts` | Types for everything above |

---

## 8. Worked example (screenshot: Agentwork)

| Surface | What it shows |
|---|---|
| Header | `Client projects`, sub-line `1 project · Synced 4m ago · Every 5 min`, `Compact / Expanded / Mixed`, `⋯`, `Global settings`, `New project` |
| Focus line | `Across workspaces` — `Reply to AgentWork client confirming start and request project details` |
| Project row | Agentwork · AgentWork · Agentwork-Application · Waiting on client · situation line · `1 question` · `Needs reply` · 0% · 15d |
| Expanded header | `Agentwork` + `Waiting on client` + `Needs my reply` chips · AgentWork · Agentwork-Application · `AI 7h ago  private/nvidia/nemotron-3.5-super-120b-a12b` · Sync · `⋯` |
| Sidebar | Dashboard · Xomni (Chat with project, Talk to AgentWork, Schedules) · Slack (Client Slack 2, Our Slack) · Project info (Needs attention: Needs reply 2 · Blockers 0 · Risks 0 · Next steps 1; Project: Requirements 1 · …; Signals: …) · Visualizations (Progress, Time elapsed, Last 7 days) · Settings |
| Dashboard body | `0%` progress, `Time elapsed — Dates not stated in chat`, 7-day activity, then the flat stack: Situation, Just changed, Next step (`Reply to the client confirming we can start and ask for project details`), Highlights, Last client message |
| Detail rows | Needs reply 2 (`can we start here ?`), Blockers 0, Risks 0, Next steps 1, Client mood, Activity, History |

This matches the code paths above: one project → one row, sidebar counts from `view.leftSidebar`/`view.rightSidebar`, guide ticks driven by `guideComplete()`, detail counts from `detailMeta()`, situation/next-step text from the insight with the heuristic fallback.

---

*Originally generated from the source at `f369e5d`. Updated for v2.6 (10-tab workspace, writable Slack Chat), v2.8 (single dashboard header, dense project rows, in-place expansion, true-state chips instead of the status/filter strip, Recent strip removed, focus line renamed `Across workspaces`), v2.9 (flat Summary centre with hairline dividers, short tab labels, icon-only Settings tab) and **v3.0 — the single-sidebar workspace** (the 10-tab bar and the three-pane Summary are replaced by one nav tree plus one centre body: dropdown sections, Project info sub-groups, a 236px/56px resizable rail, per-project nav persistence at `rev: 5`, chart rows rendered only in the centre, Collapse moved into the card menu with **Edit project** beside it, and a read-only Slack token status section in Settings). If the card design changes, update this file in the same commit.*
