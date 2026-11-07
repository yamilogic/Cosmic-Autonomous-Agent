# ADR-0007: Dashboard module (isolated folder, additive integration)

Decision: build the dashboard feature in a new isolated area, reusing existing
primitives without modifying them.

## Context
The app (v1.0-baseline) already provides: multi-profile sessions, Slack OAuth +
TokenStore (`src/main/slack/token-store.ts`), Slack Web API client
(`slack-api-client.ts`), typed IPC contract, sandboxed renderer. The user wants:
background polling of new messages, local history storage, per-project summary
cards (completion %, client mood, dates, last-updated), 5-min auto sync +
manual sync, manual token entry, local-only data.

## Decision
- New main-process module `src/main/dashboard/` (delta store, summary engine,
  sync engine, monitor config, manual token source). No edits to existing
  `src/main/slack/` modules; new fetcher calls Slack API directly rather than
  altering existing client signatures.
- New shared contract additions in `src/shared/ipc-contract.ts` (additive
  `dashboard:*` channels) and dashboard types in `src/shared/dashboard-contract.ts`.
- New renderer folder `src/renderer/src/components/dashboard/` + zustand store
  slice. Integration = 3 additive seams: preload bridge, IPC registration in
  `main/index.ts`, view switch in `App.tsx`.
- Data: JSON files under `<userData>/dashboard/` (delta messages, monitor
  config, manual tokens). Local only. No cloud, no external AI.
- Scope-aware degradation: workspaces whose tokens lack `users:read` still sync
  messages; author names fall back to IDs; mood uses text/emoji only.
- Manual token storage: `safeStorage`-encrypted if OS encryption is available,
  else plain-JSON fallback kept chmod 600 (documented limitation).

Consequences
- v1 behavior untouched; dashboard failures never block existing flows.
- Rollback = `git revert` the v2 commit; stored dashboard data is separate.
