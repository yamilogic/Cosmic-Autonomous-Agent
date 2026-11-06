# Orbit — Complete Project Overview (End to End)

> Read this first. It explains what Orbit is, every feature it has today, how each piece
> works, and — most importantly — the exact flow from *typing an email* to the *Slack /
> Teams / WhatsApp options* appearing in the sidebar, including what "the same Chrome"
> actually means.
>
> Everything below is read from the current source tree (main process, renderer,
> preload, shared contracts, docs, ADRs). Nothing here is invented.

---

## 1. What Orbit is

Orbit (package name `slack-dashboard`) is an **Electron desktop app for multi-profile
messaging**: you keep one or more profiles, and each profile can run **Slack**,
**Microsoft Teams**, and **WhatsApp** side by side as real, signed-in sessions. Alongside
that, it ships a **local project dashboard** that reads the messages of the workspaces
you connect, turns them into per-project cards, and lets you read and reply to Slack
without leaving the app.

Two halves, one process:

- **Core app** — multi-profile browser shell: profile identity, per-app auth, workspace
  management, pinned/split panes, unread badges, tray, notifications, single instance.
- **Dashboard module** — a separate, read-mostly module inside the same app (ADR-0007)
  that polls connected Slack workspaces into a local delta store, derives project cards,
  KPIs, insights, a top digest, schedules, and a per-card workspace with chat, agent Q&A,
  and settings.

It is **local-only**. There is no cloud backend. All state lives in
`app.getPath('userData')` on the machine that runs the app.

### At a glance

| | |
|---|---|
| Stack | Electron 44 (`^44.2.0`), React, TypeScript, electron-vite, pnpm |
| Tests | vitest (`pnpm run test`), 162+ cases |
| Protocol | `slack-dashboard://` (macOS `open-url`, `second-instance` handoff) |
| Renderer state | Zustand + React hooks |
| Data | JSON files under the app user-data dir, written atomically (tmp + rename) |
| Secrets | Electron `safeStorage` (OS keychain/DPAPI); renderer only ever sees masks |
| Targets | macOS, Windows, Linux (AppImage / deb) |

---

## 2. Architecture: the three layers

```
src/main        Node process. Owns profiles, auth, windows, tray, notifications,
                Slack API polling, dashboard stores, AI calls, IPC handlers.
src/preload     The only bridge to the renderer (contextBridge, contextIsolation on).
                Exposes window.api.* — no raw ipcRenderer, no Node.
src/renderer    React UI. Never sees raw tokens; gets masked strings only.
src/shared      Types/contracts imported by both sides (ipc-contract.ts,
                dashboard-contract.ts, slack-url.ts, ...).
```

Rules that are enforced by structure:

- **Renderer isolation** (ADR-0005): the renderer can only call what preload exposes.
- **Structured data over scraping** (ADR-0004): Slack data comes from the Slack Web API,
  not DOM scraping, wherever possible. The web app is only used to establish the session.
- **Explicit first login** (ADR-0006): creating a profile does **not** silently log in —
  it moves the profile to "needs Google" and the user drives it.
- **One session partition per profile + app** (ADR-0001, as implemented):
  `persist:profile-<profileId>-<appId>`.
- **OAuth uses a short-lived window** (ADR-0003), never a permanent hidden window.

---

## 3. Profiles — the core mental model

A **profile** is an identity (an email) that owns independent sessions for each app.
The profile list and state live in `src/main/profiles/profile-store.ts`; the UI lives in
`src/renderer/src/components/ProfileSidebar.tsx`.

### 3.1 Profile identity

- `displayName` — the email you typed. It is only a label; it is not used to log in.
- `id` — stable internal id.
- `apps: Record<'slack'|'teams'|'whatsapp', AppSession>` — one session per app.

### 3.2 Profile state machine

```
needs-google-auth ──Continue with Google──▶ google-auth-running
        ▲                                        │
        │                                   success / cancel
        │                                        ▼
        └───────────────────────────────  google-ok
                                                 │
                              Slack/Teams/WhatsApp signed in
                                                 ▼
                                             ready
                                                 │  token revoked / re-auth needed
                                                 ▼
                                        needs-attention
```

The user-visible marks in the sidebar come from these states:

| Profile mark | Meaning |
|---|---|
| `needs Google` | No Google session yet — press **Continue with Google** |
| `signing in…` | Google/Slack auth in progress |
| `Slack ✓ / Teams ✓ / WhatsApp ✓` | That app's session is live |
| `Slack ✗` / `!` | Session missing, revoked, or needs attention |

### 3.3 App session states

Each app slot has its own status: `not-connected` → `starting` → `ready`, or
`error` / `needs-attention`. Pins, recents, unread and mute are tracked per
**profile + app + workspace**, not globally.

---

## 4. The flow you asked about: email → three app options

This is the heart of the app. Here is what actually happens, step by step.

### 4.1 You type the email

`AddProfileDialog` (opened from `ProfileSidebar`, behind the admin gate) takes an email
and a display name. Main creates the profile and moves it straight to
**`needs-google-auth`**. The sidebar then shows three app rows under the profile
(Slack, Microsoft Teams, WhatsApp) and a **Continue with Google** button.

The sidebar renders the apps from the app list — each row shows the app icon, a status
mark, and a pin control. The three options are simply the three supported apps
(`APP_IDS`); there is nothing else to configure before the first login.

### 4.2 Continue with Google → a real Chrome window

`ProfileStartGoogleAuth` → `runGoogleBrowserAuth` →
`src/main/profiles/chrome-browser-auth.ts` (`runGoogleChromeBrowserLogin`):

1. **A separate real Chrome process is launched**, docked exactly over the app's right
   pane (its rectangle is measured from the renderer and mirrored onto the screen;
   `chrome-system-login.ts` handles launch + reposition on move/resize, and it refuses
   to apply "crushed" mid-layout bounds).
2. It runs with its **own user-data directory**, derived from the Orbit profile id
   (`chromeProfileKey = profileId`). This is the "same Chrome" — one isolated Chrome
   profile per Orbit profile.
3. You sign in to Google in that Chrome window (the renderer shows
   `AuthChromePane` with the step list and a **"I've signed in — Continue"** button).
4. When you confirm, the cookies are **exported from that Chrome profile and imported
   into the Electron session partition** `persist:profile-<profileId>-slack`
   (`chrome-cookie-probe.ts` probes; `session-partition.ts` imports).
5. If the user cancels, the profile returns to `needs-google-auth` — nothing is saved.

Fallback: if Chrome cannot be used, the code can fall back to an embedded
`BrowserWindow` Google login (`embedded-browser-auth.ts`). Google may block that path;
the real-Chrome path is the reliable one.

### 4.3 Then Slack (the default first app)

With Google in place, the profile is `google-ok`. Clicking **Slack** starts
`runSlackBrowserAuth` (`slack-first-login-flow.ts`):

- It reuses the **same isolated Chrome user-data dir** for the profile — so Slack's
  "Sign in with Google" sees the Google session you just made and does not ask for a
  password again.
- After Slack is signed in, the Slack session cookies are imported into
  `persist:profile-<profileId>-slack`.
- Slack is then shown as a **stay-open real Chrome window docked over the right pane**
  (`openChromeStayEmbed` in `chrome-browser-auth.ts`). Reason: Slack blocks non-Chrome
  embeds, so a `WebContentsView` cannot host the web client. The dock is kept aligned
  when the app moves/resizes, and the app is taken out of fullscreen so the dock shows.
- The Slack web client itself is the real app in a real Chrome — full Slack behaviour.

### 4.4 Teams

Clicking **Microsoft Teams** runs `teams-first-login-flow.ts`. Teams uses a Microsoft
account, so it is signed in **inside the app's embedded view** (`WebContentsView`) using
its own partition `persist:profile-<profileId>-teams`. Teams embeds normally; no Chrome
hand-off is needed.

### 4.5 WhatsApp

Clicking **WhatsApp** runs `whatsapp-login-flow.ts`. WhatsApp has no OAuth — the embed
shows the QR code in `persist:profile-<profileId>-whatsapp` and you scan it with your
phone. That session then lives in the Electron partition.

### 4.6 "Share the same Chrome" — exactly what is shared

This is the part people usually get wrong, so it is stated precisely:

| Session | Where it lives | How you log in | Shares Google Chrome? |
|---|---|---|---|
| Google | Real Chrome profile dir `chromeProfileKey = profileId` | Real Chrome window (docked) | — |
| Slack | Imported into `persist:profile-<id>-slack`; shown as a docked real Chrome window | "Sign in with Google" in the **same** Chrome profile dir | **Yes** — this is the shared Chrome |
| Teams | `persist:profile-<id>-teams` (Electron embed) | Microsoft login inside the embed | No (Microsoft identity) |
| WhatsApp | `persist:profile-<id>-whatsapp` (Electron embed) | QR scan inside the embed | No (phone QR) |

So: **Google and Slack share one isolated Chrome profile per Orbit profile** — that is
the "same Chrome" reuse. Teams and WhatsApp each have their own isolated Electron
session and use their own login method. Each app also gets its own Electron partition,
so cookies never leak between apps.

### 4.7 After all three are ready

The profile becomes `ready`. Each app slot shows `ready`; the sidebar lets you pin
workspaces to the top, open an app in a **split** pane, mute a profile, and see unread
badges. The dashboard's Slack polling can then use the Slack session (plus the OAuth bot
token where one is configured) to build project cards.

---

## 5. Sidebar / workspace management

`ProfileSidebar` + `main/profiles` give you the day-to-day controls:

- **Pins** — pin a workspace row to the top (`pins-store.ts`, persisted).
- **Recents** — recently used workspace rows.
- **Unread badges** — derived from the embed window titles (`unread-from-title.ts`) and
  counted per profile/app/workspace.
- **Mute** — silence a profile's unread dot and tray noise.
- **Split view** — open an app in a second pane (`onOpenInSplit`).
- **Shortcuts** — per-app keyboard shortcuts with platform-aware labels
  (`lib/shortcut-label.ts`).
- **Workspace discovery** — `discover-workspaces.ts` finds the workspaces available to a
  signed-in app.
- **Theme sampling** — `theme-sample.ts` reads the app's accent so the dashboard can
  match it.
- **Context menu / pin controls** on each row; admin-only actions are gated.

---

## 6. The Dashboard module (ADR-0007)

The dashboard is a **separate module inside the same app**. Its rule: it is **read-mostly**
and **local-first**. It does not run its own server; the app's main process owns all data.

### 6.1 Data pipeline

```
Slack session / OAuth token
        │  Slack Web API
        ▼
   slack-poller ──▶ delta-store (channels/<profileId>/<teamId>/<channelId>.json)
        │
        ├─▶ recent-feed        (latest activity per project)
        ├─▶ activity-summary / metrics
        ├─▶ insight-engine     (status, blockers, risks, progress, mood)
        ├─▶ history-store      (runs over time)
        ├─▶ digest             (one-line top digest, digest.json)
        └─▶ summary-engine / heuristic-insight
        │
        ▼
   snapshot per project (dashboard-contract.ts)
```

- `delta-store` keeps a **JSON file per channel** — this is the local message store the
  dashboard reads and the Slack Chat tab paginates through.
- `slack-scopes.ts` / `slack-throttle.ts` handle OAuth scopes and rate limiting.
- `monitor-store` (`monitors.json`) holds project records and manual tokens.
- `viewed-store` (`views.json`) and `sidebar-state.ts` remember what you have already
  seen (for "new since your last visit" and sidebar collapse state).

### 6.2 Digest

`digest.ts` — one line across all connected workspaces, cached in `digest.json`. Uses the
AI provider when a key is available, otherwise a local line; a cached digest younger than
the max age is reused so a cycle never stalls.

### 6.3 Schedules

`scheduler.ts` + `schedule-store.ts` (`schedules.json`) run three kinds while the app is
open — **nothing runs after the app quits**:

| Kind | What it does |
|---|---|
| `slack-sync` | Re-reads the client workspace and pinned team channels, refreshes each card |
| `agent-analysis` | Re-runs insight/agent analysis |
| `daily-recheck` | Daily re-check pass over the cards |

Each has an interval, pause/resume, "run now", and a run log (last runs, per-source
ok/failed, next-run countdown). `SchedulesPage` is the UI; the dashboard header shows the
same freshness line and countdown.

---

## 7. Per-card workspace (`ExpandedWorkspace`)

Opening a project card brings up the per-project workspace. It is built around a nav
model (`workspace-nav.ts`) with a left rail, a content area, and a right rail. The current
groups (top to bottom) are:

1. **Xomni** — the project agent chat (`AgentChatPanel`), with a Schedules sub-view.
2. **Connect channel** — Slack Chat (`SlackChatTab`), split into *Our Slack* and *Client
   Slack*; "All channels" plus one row per watched channel.
3. **Project info** — guide tabs: requirements, scope & deliverables, decisions,
   commitments, files & links, people & channels.
4. **Visualizations** — charts from the project's own numbers.
5. **Dashboard** — the project overview page.
6. **Settings** — project AI settings + project config (`ProjectSettingsTab`).

### 7.1 Dashboard page

`DashboardPage.tsx` renders, for the selected project:

- **Freshness line** — "Updated X ago / Syncing now / sync needs attention", next-run
  countdown, and a **Sync** button.
- **Ask agent** box — [REMOVED] previously a question field plus suggestion chips; cancelled and removed from the project card.
- **KPI tiles** — Progress (ring + %), Status, Waiting on you (count-up), Client mood,
  Our response time, Last client contact.
- **Where it stands** — situation line, "just changed", "next step", and the
  **ball-in-court** chip (rule: client newest message in 14 days = your court; otherwise
  client's court).
- **Activity** — 14-day stacked bars (client vs ours) with totals.
- **Time and pace** + **Mood trend** — pace track and a mood sparkline across runs.
- **Latest messages** — recent client + our Slack messages with avatar initials, age,
  `#channel` and source chip; clicking jumps to the channel and highlights the message.
- **Rail blocks** — Needs your attention, New since your last visit, Finish setup
  checklist, Client ask (requirements + deliverable status), People and channels.

### 7.2 Slack Chat tab

`SlackChatTab.tsx` — the one writable surface in the dashboard.

- Reads the local delta store: sender name, time, text, `#channel` chip.
- **Channel filter** dropdown: All channels + each watched channel.
- **Pagination**: newest first, auto-scroll to the bottom; scrolling up loads older
  pages (backward `beforeTs` + limit, capped at 200, default 50).
- **Composer** posts to the selected channel through
  `dashboard:send-message` → `chat-service.ts` → Slack `chat.postMessage`.
- Sends are **optimistic** (a "sending…" bubble), replaced on success or marked failed
  with an inline error.
- **Scopes**: checks `chat:write` (from stored OAuth link scopes, or `auth.test` for a
  manual token). Missing scope → a clear inline warning instead of a generic failure.
  Runtime `missing_scope`, `channel_not_found`, `not_in_channel`, `invalid_auth` and
  `token_revoked` are each mapped to actionable messages.
- A successful send is appended to the local delta store so it survives reloads and is
  deduped by the next sync.
- Per the dashboard rule, this tab is the **only** place the dashboard writes; the doc
  (`docs/dashboard-ui.md`) and the code comment both say so.

### 7.3 Xomni agent chat

`AgentChatPanel` + `project-chat-service.ts` + `chat-retrieval.ts`:

- Answers questions about the project from the **local message store** (retrieval over
  the delta store, not a generic web answer).
- Streams the reply token-by-token; history is per project in
  `<dashboardRoot>/chat/<projectId>.json` (last 200 messages).
- Each answer carries **source refs** (workspace, channel, ts). Clicking a ref opens the
  Slack Chat tab at that channel and scrolls/flashes the message.
- Errors are mapped to friendly codes (`AUTH_INVALID`, `RATE_LIMITED`, `NETWORK`,
  `INTERNAL`, `PROJECT_NOT_FOUND`) with retry hints.
- Uses the effective AI settings (global or project override).

### 7.4 Project info tabs

Requirements, scope & deliverables, decisions, commitments, files & links, people &
channels — the existing guide bodies (`guide-content.tsx`), full width, with their empty
states ("No requirements found in chat", etc.). Cards carry text, source file chip, "by
<who>" and a timestamp where the data exists.

### 7.5 Settings tab

`ProjectSettingsTab` → `AiSettingsForm` (see §8). It shows which source is effective
(project override / global config / built-in default / none), lets you save a provider,
chat model, embedding model and key, test the connection, and clear the project override.
The dashboard-level global settings live in `GlobalSettingsPanel` / `SettingsPanel`.

---

## 8. AI configuration (global + project override)

`ai-settings.ts` + `ai-settings-store.ts` — one dashboard-level record plus a per-project
override, stored in `<dashboardRoot>/ai-settings.json`.

- **Provider** — NVIDIA NIM (`nvidia-nim`) and OpenAI-compatible endpoints
  (`ai-provider.ts`).
- **Key handling** — encrypted with Electron `safeStorage`; the renderer only ever sees a
  mask (`••••abcd`). A key written while the OS vault was unavailable is sealed on the
  next start (`migrateLegacyPlaintext`).
- **Models** — `listModels()` returns chat and embedding models (embedding models are
  filtered by name), with a manual override if you type one.
- **Test connection** — verifies the key, records `ok` / `invalid` / `not-configured` and
  a `lastVerifiedAt`.
- **Precedence** — project override wins when set; otherwise global; otherwise built-in
  default; otherwise AI stays off with a clear hint.
- `config-service.ts` resolves the effective settings for sync/chat/insight/embeddings:
  client workspace (project), our Slack (global or project override), AI (global or
  project override).

---

## 9. Data on disk

All under the app user-data dir. Dashboard files:

| File | Contents |
|---|---|
| `monitors.json` | project records, pinned channels, manual tokens |
| `team-workspace.json` | the one connected "our team" workspace + pinned channels |
| `ai-settings.json` | global + per-project AI settings (keys encrypted) |
| `schedules.json` | schedule settings + run log |
| `digest.json` | cached top digest |
| `views.json` | viewed-state for "new since last visit" |
| `history/` | insight run history |
| `chat/<projectId>.json` | agent chat history per project |
| `channels/<profileId>/<teamId>/<channelId>.json` | the local message delta store |

Profile/session data (cookies, partitions) lives in Electron's own session storage under
`persist:profile-<id>-<appId>`. Pins and recents are persisted in their own stores.

---

## 10. Security & privacy

- **Per-app partitions** — Slack/Teams/WhatsApp never share cookies with each other.
- **safeStorage** — API keys and manual tokens are encrypted at rest; the renderer gets
  masks only.
- **Renderer isolation** — preload-only bridge; no Node in the renderer; CSP is set.
- **No cloud** — all message data is local; the only outbound calls are to the Slack Web
  API and the AI provider you configure.
- **Admin gate** — profile creation and admin actions are behind the admin login
  (`AdminLoginOverlay`, `SettingsPanel`); the app can be locked (`LockOverlay`).
- **Session rules** — OAuth windows are short-lived (ADR-0003); first login is explicit
  (ADR-0006); a cancelled login leaves no session behind.

---

## 11. Shell features

- **Single instance** — `requestSingleInstanceLock`; a second launch hands the URL to the
  running app (`second-instance`).
- **Deep links** — protocol `slack-dashboard` (`open-url` on macOS, argv handoff elsewhere).
- **Tray** — `tray.ts`: show/hide, per-app open, quit.
- **Notifications** — `desktop-notify.ts` surfaces new messages; mute suppresses them.
- **Window** — right pane hosts the app embed/dock; the left sidebar holds profiles; the
  dashboard opens in its own view (`DashboardView`).

---

## 12. Running, building, verifying

```bash
pnpm install
pnpm run dev                 # electron-vite dev (patches mac identity)
pnpm run build               # typecheck + electron-vite build
pnpm run test                # vitest run
pnpm run typecheck           # node + web tsc
pnpm run lint                # eslint
pnpm run build:mac           # packaged app + codesign
pnpm run build:linux:ubuntu  # AppImage + deb
```

`debug-dashboard.sh` boots the built app headless-friendly for dashboard work (X11 flags
in the script). `scripts/patch-electron-mac-identity.mjs` handles the macOS bundle id.

---

## 13. End-to-end walkthroughs

### 13.1 First profile, first login

1. App opens → admin login overlay → enter admin password.
2. Sidebar → **Add profile** → type email + name → create.
3. Profile appears as **needs Google** → click **Continue with Google**.
4. A real Chrome window docks over the right pane → sign in to Google → click
   **"I've signed in — Continue"**.
5. Google cookies are imported into the Slack partition; profile is **google-ok**.
6. Click **Slack** → same Chrome profile opens Slack's Google SSO → signed in → Slack
   cookies imported → Slack runs as a docked real Chrome window. ✓
7. Click **Teams** → Microsoft login inside the embed → Teams ✓.
8. Click **WhatsApp** → scan QR inside the embed → WhatsApp ✓.
9. Profile is **ready**; pin workspaces, mute, use split view.

### 13.2 Reply from the dashboard

1. Open a project card → **Connect channel** → pick a channel (or All channels).
2. Read the paginated local messages; scroll up for older ones.
3. Type a reply → send → optimistic bubble → posted to Slack via `chat.postMessage`.
4. If the token lacks `chat:write`, you get an inline warning instead of a silent failure.

### 13.3 Build a project card

1. Dashboard settings → connect the client workspace and pin its channels; set dates.
2. Connect the global "our team" workspace and pin our channels.
3. Add an AI key (global or per project) → **Test connection**.
4. Sync → the card fills with KPIs, insights, latest messages and digest.
5. Ask the agent a question → streamed answer with source refs → click a ref to jump to
   the original message.

### 13.4 Schedules

Open **Xomni → Schedules** (or the freshness line) → set the Slack-sync interval, pause or
run now, watch the run log. Everything runs while the app is open; nothing runs after
quit.

---

## 14. Known limits / not-yet-real

- **WhatsApp**: the dashboard reads nothing from WhatsApp; the WhatsApp embed is for
  using WhatsApp normally. No dashboard replies for WhatsApp.
- **Teams**: same — the embed is the app; the dashboard's chat/reply surface is Slack-only.
- **Slack embed is real Chrome**, not an embedded view (Slack blocks non-Chrome embeds).
  If Chrome is unavailable, the auth/embed path degrades to the embedded fallback.
- **Schedules only run while the app is open.**
- **No background daemon / no server** — all state is local; closing the app stops polling.
- **Dashboard writes are limited to the Slack Chat tab**; everything else is read-only.
- The repo's lint still reports a small set of pre-existing errors in untouched files;
  `pnpm run typecheck` / `build` / `test` are the gates that matter.

---

## 15. File map (where to look)

```
src/main/
  index.ts                    app bootstrap, window, single instance, deep links, tray, scheduler wiring
  logging.ts                  structured logs
  tray.ts, desktop-notify.ts  tray + notifications
  profiles/
    profile-store.ts          profile identity + state machine
    session-partition.ts      partitionForProfile(profileId, appId)
    first-login-flow.ts       Google auth orchestration (embedded + Chrome)
    chrome-browser-auth.ts    real Chrome auth + docked stay embed
    chrome-system-login.ts    Chrome launch, cookie export/import, dock math
    chrome-cookie-probe.ts    probes Chrome profile for Google/Slack sessions
    chrome-embed-session.ts   cookie import into Electron partitions
    embedded-browser-auth.ts  embedded Google login fallback
    pane-auth.ts              per-app session bootstrap
    slack-first-login-flow.ts Teams/WhatsApp equivalents
    whatsapp-login-flow.ts
    teams-first-login-flow.ts
    discover-workspaces.ts    workspace discovery
    theme-sample.ts           accent theme sampling
    unread-from-title.ts      unread counts from window titles
    browser-view-manager.ts   embed view lifecycle
  dashboard/
    monitor-store.ts          projects + tokens (monitors.json)
    delta-store.ts            per-channel message store
    slack-poller.ts           Slack Web API polling
    sync-engine.ts            sync orchestration
    insight-engine.ts         insight/status/progress/mood
    heuristic-insight.ts      local fallback insight
    summary-engine.ts, activity-summary.ts, metrics.ts, insights.ts
    recent-feed.ts, history-store.ts, digest.ts
    scheduler.ts, schedule-store.ts, sidebar-state.ts, viewed-store.ts
    team-workspace-store.ts   the one global "our team" workspace
    config-service.ts         effective settings resolver
    config-migration.ts, workspace-migration.ts
    chat-service.ts           Slack Chat tab data + replies
    project-chat-service.ts   Xomni agent chat
    chat-retrieval.ts, chat-context.ts, chat-prompts.ts, chat-sources.ts
    ai-provider.ts            NVIDIA NIM / OpenAI-compatible provider
    ai-settings.ts, ai-settings-store.ts
src/renderer/src/
  App.tsx                     app shell, profile/login/dashboard routing
  components/
    AddProfileDialog.tsx, ProfileSidebar.tsx, AuthChromePane.tsx, WorkspaceDropdown.tsx
    AdminLoginOverlay.tsx, LockOverlay.tsx, SettingsPanel.tsx, SlackViewport.tsx
    CommandPalette.tsx, AppPicker.tsx, AppIcon.tsx
    dashboard/
      ExpandedWorkspace.tsx   per-card workspace shell
      WorkspaceSidebar.tsx, workspace-nav.ts, WorkspaceContent.tsx
      DashboardPage.tsx        project overview (KPIs, hero, activity, rail)
      SlackChatTab.tsx        local messages + composer
      AgentChatPanel.tsx      Xomni agent chat
      ProjectSettingsTab.tsx, AiSettingsForm.tsx, GlobalSettingsPanel.tsx, TeamSlackSettings.tsx
      SchedulesPage.tsx, RecentStrip.tsx, DashboardView.tsx, DashboardWizard.tsx
      card-view.ts, guide-content.tsx, guide-model.ts, jump-to-message.ts
  hooks/                      Zustand-backed hooks (dashboard, activity, sidebar)
  lib/                        dashboard-api, shortcut-label, unread-badge, ...
src/preload/index.ts          the bridge (window.api.*)
src/shared/                   contracts + types used by both sides
docs/                         ADRs, dashboard docs, tickets, plans
tests/unit/                   vitest unit tests
.agents/skills/               mirror of agent skills (see §16)
```

---

## 16. About the `.agents` folder

`.agents/skills/` is **not project code**. It is a mirror of agent workflow skills
(ask-matt, chief-of-staff, code-review, codebase-design, diagnosing-bugs, domain-modeling,
git-guardrails, grilling, handoff, implement, improve-codebase-architecture, pr, retro,
setup-*, tdd, teach, to-spec, to-tickets, triage, wayfinder, wizard, writing-*). They are
the playbooks agents use to work on this repo, not features of Orbit.

The ones applied while producing this overview and the recent dashboard work:
`electron-react-desktop` (Electron app rules), `code-review`, `diagnosing-bugs`,
`systematic-debugging`, `tdd` / `test-driven-development`, `implement`, `implement-spec`,
`to-spec`, `to-tickets`, `improve-codebase-architecture`, `codebase-design`.

---

*Generated from the source tree. When in doubt, read the file named in §15 — the source is
the single source of truth.*
