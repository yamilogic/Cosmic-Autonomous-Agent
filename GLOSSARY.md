# GLOSSARY.md — shared language (dashboard feature)

| Term | Meaning |
|---|---|
| **Project** | A card unit on the dashboard. Named by the user for one client project. Contains one or more Watched Channels. Synonym in code: `DashboardProject`. |
| **Watched Channel** | A Slack channel / private group / group DM that belongs to a Project and is polled by the Sync Engine. |
| **Monitor** | The stored instruction "sync this profile+workspace+channel for this project". |
| **Delta Cursor** | The Slack `ts` of the newest stored message of a Watched Channel. A sync fetches only messages with `ts > cursor` (newer → greater). |
| **Delta Store** | Local JSON storage of all synced messages, one file per channel, under `<userData>/dashboard/`. Never leaves the machine. |
| **Sync Engine** | Main-process module that, on a 5-minute timer or an explicit request, polls every Monitor and appends new messages to the Delta Store. |
| **Manual Sync** | A user-triggered sync (card button / dashboard-wide button). Reuses the same engine on demand. |
| **Token Source** | Where a workspace token comes from: `oauth` (existing TokenStore, connected in-app) or `manual` (pasted xoxp token, stored in `.env_dashboard` / secrets panel). |
| **Snapshot** | The IPC payload the renderer draws cards from: projects, summaries, completion, mood, dates, last-updated. |
| **Completion** | 0–100 progress of a Project: manual value if set, else `autoCompletion` estimated from message activity/recency. Manual value wins when both exist. |
| **Mood Signal** | Local keyword/emoji heuristic over recent project messages → `good / neutral / tense`. No external AI calls in Phase 1. |
| **Extracted Dates** | Start/deadline dates found by date-pattern heuristics in messages. Manual project dates (if set) win over extracted. |
| **Secrets Panel** | Bottom-of-sidebar settings surface for adding manual tokens and creating/editing Projects (pick workspace + Watched Channels). |
| **Dashboard Mode** | Renderer view state where the embedded Slack view is hidden and the card list is shown. |
| **Wizard** | The 5-step add flow (Create Slack app → Install & get token → Choose channels → Confirm card → Finish). Opens as an overlay for a new Project and inline in Settings for an existing one. |
| **Wizard Edit Mode** | The wizard reopening prefilled for an existing project. |
| **Baseline Sync** | First sync after a token is added: pulls the most recent 200 messages per channel as initial history. |
| **Workspace Sidebar** | The nav tree inside one expanded card (not the application sidebar). One section per area, one centre body per row. State persists per project under `orbit.workspace.nav.<projectId>`. |
| **Xomni** | The sidebar section holding this card's AI conversations: *Chat with project* and *Talk to AgentWork*. `Schedules` sits under it as a visibly inert placeholder. |
| **Client Slack** | The Slack workspace a Project is bound to — its `teamId`/`teamName`, the source of the Project's Watched Channels. Readable and writable from the card. |
| **Our Slack** | The user's own team workspace, connected once for all Projects (global, not per-card). Until it is connected the row shows a *Connect workspace* empty state, never an invented list. |
| **Project info** | The sidebar section for everything the card has learned, nested in three sub-groups: *Needs attention*, *Project*, *Signals*. Sub-groups start closed. |
| **Visualizations** | The sidebar section whose rows (Progress, Time elapsed, Last 7 days) render their chart in the centre panel only — never inside the sidebar. |
| **Global Settings** | The dashboard's one settings modal, opened from the toolbar button beside *New project*. Holds the values shared by every Project — AI model and key first — each of which a card may override. Never called the "AI settings menu": the overflow-menu route is gone. |
| **Inheritance** | How a card resolves one of those values: project override (only when its *Use global settings* switch is off) → Global Settings → environment default. The card shows which source is in effect. |
| **Observability Hub** | The interactive live diagnostics and monitoring feed inside the Settings sidebar (`UnifiedSettingsModal.tsx`). |
| **Ephemeral Ring Buffer** | The in-memory collection of the most recent 2,000 log events in `src/main/logging.ts`. Automatically prunes entries older than the configured TTL. |
| **Log Retention (TTL)** | The duration after which live log events expire (default: 15 minutes, configurable to 5m, 15m, 30m, 1h, or Session). |
| **Log Sweeper** | The background interval task in `src/main/logging.ts` that purges stale log entries every 30 seconds. |
| **Token Redaction** | The security layer that automatically replaces sensitive secrets (tokens, API keys, passwords, cookies) with `[REDACTED]`. |
