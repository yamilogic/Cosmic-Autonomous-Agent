# T1 — Shared dashboard contract
Add `src/shared/dashboard-contract.ts` (types: DashboardProject, MonitorConfig,
ProjectSnapshot, SyncProgress) and add additive `dashboard:*` channels +
`dashboard` namespace in `ipc-contract.ts`/`IpcApi`.
Blocked-by: none.

# T2 — Delta store (`src/main/dashboard/delta-store.ts`)
JSON files under `<userData>/dashboard/channels/<profileId>/<teamId>/<channelId>.json`.
Append new messages deduped by `ts`; maintain `cursor` (newest ts), `lastSyncAt`.
BLOCKING edges: depends on T-nil (pure). Blocks engine + summary tests.

# T3 — Summary engine (`src/main/dashboard/summary-engine.ts`)
Pure: recent-message summary, mood heuristics, date extraction, completion
estimate (manual win + activity-based fallback), `updatedAt`.
BLOCKING edges: depends on T2 types only. Blocks card rendering.

# T4 — Monitor config + manual token source (`src/main/dashboard/monitor-store.ts`)
monitor config file `<userData>/dashboard/monitors.json`; `.env_dashboard`
manual tokens parsed with dotenv → candidates list; sync into monitor config.
BLOCKING edges: none. Blocks engine + secrets panel.

# T5 — Sync engine + scheduler (`src/main/dashboard/sync-engine.ts`, `scheduler.ts`)
For each monitor: fetch history with `oldest` cursor, append to delta store,
evaluate summary per project, cache snapshot. Interval 300s (configurable),
manual `syncProject` / `syncAll`, progress events. Slack polling client lives
in `src/main/dashboard/slack-poller.ts` (existing client untouched).
BLOCKING edges: depends on T2, T4. Blocks IPC + UI.

# T6 — IPC + preload bridge
`src/main/ipc/dashboard.ipc.ts` (registerDashboardIpc deps-injected), renderer
via `window.api.dashboard` (getSnapshot, snapshot-changed events, sync commands,
project CRUD, manual tokens add). Register in `main/index.ts` (+2 lines).
BLOCKING edges: depends on T5. Blocks renderer UI.

# T7 — Renderer dashboard + sidebar
`components/dashboard/`: DashboardRail (sidebar Dashboard→Slack dropdown),
DashboardView (card grid), ProjectCard (summary, last updated, progress bar,
mood badge, dates + Edit modal, Sync button with visual progress), SecretsPanel
(bottom-of-sidebar button; create/edit projects, paste manual tokens).
Zustand store `hooks/useDashboard.ts`. Seam integration in App.tsx.
BLOCKING edges: depends on T6.
