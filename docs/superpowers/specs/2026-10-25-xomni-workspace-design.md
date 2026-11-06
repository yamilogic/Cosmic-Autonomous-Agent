# Xomni Workspace — Design (v3)

**Date:** 2026-10-25
**Status:** Approved in chat — supersedes the sidebar sections of v2 (`2026-10-25-single-sidebar-workspace-design.md`). Layout, clean-look rules, compact header, and the resizable/collapsible rail from v2 stay in force.
**Scope:** Rename and re-order the in-card sidebar around the Xomni assistant, regroup Project Info into collapsible sections, keep Slack Chat as a first-class entry with a channel rail, and stage the AgentWork bridge behind Xomni's mode switch.

## 0. Standing constraints (unchanged)
- Primary app sidebar frozen. Raw tokens/keys live in the main process (`safeStorage`); renderer gets masks only. No-guess fallback is exactly `Chat mein ye nahi mila.` UI proof via CDP 9222 in the native window.

## 1. Sidebar (top → bottom)
```
▸ Dashboard        project overview (situation · next step · highlights)
▸ Xomni Chat       mode dropdown: Chat with project | Talk to AgentWork (greyed until D)
                   + Schedules button (Phase E)
▸ Project Info     4 collapsible groups, closed by default:
                   Needs attention (4) · Project (6) · Signals (3) · Visualizations (3)
▸ Slack Chat       channel rail + read/send per channel (Phase C)
──────────────────
  Settings         pinned footer — only entry there
```
- **No standalone AgentWork entry.** AgentWork lives behind Xomni's "Talk to AgentWork" mode (MCP bridge, Phase D).
- Dashboard = what the Summary landing page shows today (`CentreContent`).
- Project Info = today's Summary options + Visualization charts, grouped. Group headers toggle their items; multiple groups may be open at once. Selections still drive the centre panel.
- Accordion/toggle rules from v2 carry over: one openGroup at a time; re-clicking the open group compresses its sub-list (`subOpen`).

## 2. Nav model changes
- `OpenGroup: 'dash' | 'xomni' | 'info' | 'slack' | 'settings'`.
- Selection ids unchanged (`v:` | `d:` | `g:`), all owned by `info`.
- New persisted field `openInfoGroups: string[]` (subset of `attention|project|signals|visual`).
- **Migration** on read: `summary→info`, `visual→info` (selection kept), `agent→xomni`. Old keys never crash; unknown → defaults.
- Deep-link entry props (`initialTab` etc.) map to the new groups.

## 3. Centre bodies
`dash`→`CentreContent` · `xomni`→`AgentChatPanel` · `info`→`CentreVisuals`/`DetailBody`/`GuideDetailBody` (by selection; `null`→overview) · `slack`→`SlackChatTab` · `settings`→`ProjectSettingsTab`.

## 4. Xomni chat (Phase B, unchanged from v2 §5)
`DashboardAskAgent` IPC; grounding = insight + last ~40 displayable messages; suggestion chips; sticky composer; exact fallback. Phase 3 (v2 §6) propose→confirm→apply edits rides on top.

## 5. Settings — Slack token section (Phase A)
Show masked bot token + **real scopes via `auth.test`** (new main IPC). Read scopes OK → reading works; missing `chat:write` → send disabled with the exact steps to add the scope. Never show the raw token in the renderer.

## 6. Slack channel rail (Phase C)
All public channels + private groups (no DMs) in a collapsible, drag-resizable rail inside the Slack view; messages with person name + timestamp; send via existing `DashboardSendMessage` (`chat.postMessage`).

## 7. AgentWork MCP bridge (Phase D)
Main-process MCP client (SSE / streamable HTTP; server URL + auth supplied by the user, encrypted at rest). "Talk to AgentWork" proxies the question to the agent's chat tool and renders the answer verbatim. New dependency only after explicit approval. Tool-confirmation rules per the MCP roadmap (Stage 2 spec) apply when tools beyond chat are exposed.

## 8. Schedules (Phase E, read-only)
Sync cadence ("Every N min · synced Xm ago") + project end dates + next-step due dates in one small panel, shared by the Xomni button and anywhere else needed. No new engine; reads existing store + scheduler config.

## 9. Build order (each phase ships + is shown before the next)
A. Shell rename & regroup (UI only + Settings token section)
B. Xomni project chat (v2 §5–6)
C. Slack channel rail
D. AgentWork MCP bridge
E. Schedules panel

## 10. Testing
Unit: nav model (new groups, migration from old keys, info-group toggles, subOpen rules), centre map, token-scope parsing (chat:write present/absent). UI: CDP screenshots per phase; primary app sidebar byte-identical; build + typecheck + suite green (176 baseline).
