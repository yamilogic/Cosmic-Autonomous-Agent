# Single-Sidebar Expanded Workspace — Design (v2)

**Date:** 2026-10-25
**Status:** Approved — supersedes v1 (`2026-10-25-single-sidebar-workspace-design.md`)
**Scope:** Redesign the expanded project card into a spacious, low-line-count, two-column workspace: one left sidebar (Agent chat · Visualization · Summary, accordion, pinned footer) + one wide centre panel. Make Agent chat a real, grounded, project-scoped Q&A surface, and give the agent a propose→confirm→apply path to edit a small, fixed set of project fields.

**Build order (explicit checkpoints — do not skip ahead):**
1. **Phase 1 — Layout + sidebar + visual cleanup.** Ship and show before touching chat.
2. **Phase 2 — Agent chat** (grounded Q&A in the centre panel; inline "Ask agent" on Summary REMOVED).
3. **Phase 3 — Agent edit** (propose → confirm → apply, with Undo).

---

## 0. Standing constraints
- The **primary app sidebar is frozen** — untouched. This new sidebar lives *inside the project card*.
- Raw AI keys stay in the **main process**; the renderer gets masks + answer text only.
- No-guess rule: the agent answers only from provided context, otherwise returns exactly **`Chat mein ye nahi mila.`**
- Reuse the existing Zustand store, `dashboard-contract.ts` types, and the nav-state localStorage key **`orbit.workspace.nav`**. Never fabricate data.
- **No MCP this round.** Build a `ProjectTool` registry whose first tool is `updateProject`; MCP tools plug into the same registry later.
- UI verified in the **native Electron window over CDP 9222**, never a browser tab.

---

## 1. Layout (Phase 1)

Two columns under `CardHead`:

```
┌──────────────────────────────────────────────────────────────────────┐
│ CardHead (compact, see §4)                                             │
├───────────────┬──────────────────────────────────────────────────────┤
│ WS SIDEBAR    │            CENTRE PANEL  (max-width ~860px, centred)  │
│ 232px         │                                                        │
│  →56px rail   │   (one body chosen by sidebar selection)              │
│               │                                                        │
│ ▸ Agent chat  │                                                        │
│ ▸ Visualization                                                       │
│     Progress / Time elapsed / Last 7 days                             │
│ ▸ Summary     │                                                        │
│     Needs attention · Project · Signals                               │
│ ───────────── │                                                        │
│ [Slack Chat]  │                                                        │
│ [ Settings ]  │                                                        │
└───────────────┴──────────────────────────────────────────────────────┘
```

- Sidebar **232px** expanded, collapses to a **56px icon rail**. The old **right sidebar is removed entirely**; its 7 Project Details become Summary options in the left sidebar.
- Sidebar top entries, in order: **Agent chat** (primary — slightly highlighted), **Visualization**, **Summary**. Footer, pinned: **Slack Chat**, **Settings**.
- **Accordion:** exactly one of the three entries is expanded at a time.
- **Visualization** expands to sub-buttons `Progress · Time elapsed · Last 7 days`. **No chart renders in the sidebar.** Pressing a sub-button shows that chart **large in the centre panel**, with generous whitespace.
- **Summary** expands to three labelled groups of options:
  - **Needs attention** — Needs Reply, Blockers, Risks, Next Steps
  - **Project** — Requirements, Scope, Decisions, Commitments, Files, People
  - **Signals** — Mood, Activity, History
  - Zero-count options render **dimmed**; options with data show a **plain number** (no chip).
- **Default landing:** Summary group expanded, no option selected → the Summary overview in the centre.

### 1.1 Selection model (`useWorkspaceNav`)
Persisted per project under `orbit.workspace.nav.<projectId>`:
- `openGroup`: `'agent' | 'visual' | 'summary'`
- `selection`: `null` (Summary overview) | `'progress' | 'time' | 'week'` (visual; `null` here means stacked-all only when the user opens Visualization with nothing picked — but default centre is Summary) | one of the 13 Summary option keys | footer `'slack' | 'settings'`.
- `collapsed`: boolean (232 ↔ 56).

---

## 2. Centre panel bodies (Phase 1 wiring, reused components)
`WorkspaceContent` maps `{openGroup, selection}` → body:
- Summary overview → existing `CentreContent` (restyled per §3, no logic change).
- Visualization single → `CentreVisuals` scoped to one chart; stacked-all → full `CentreVisuals`.
- Summary options → existing `DetailBody` (7 attention cards, from `rightSidebar`) and `GuideDetailBody` (6 guide sections, from `leftSidebar`), reused unchanged.
- Slack Chat → existing `SlackChatTab`.
- Settings → existing `ProjectSettingsTab`.
- Agent chat → `AgentChatPanel` (Phase 2).

---

## 3. Clean-look rules (Phase 1) — fewer lines, more air
- **Sidebar items have no borders.** Only the active item gets a light background + a small accent marker (a 2px bar or dot). Group/section labels are small, muted, uppercase.
- **No card-in-card** in the centre. Replace the 1px section dividers with **32–40px vertical spacing**. Centre content max-width **~860px**, horizontally centred, relaxed line-height.
- **One accent colour**; everything else neutral greys. **Chips only for status**; counts are plain numbers, never chips/badges.
- **Empty states** are a single muted line, not a box. "Dates not stated in chat" becomes a small inline **"Add dates"** link.
- Respect the Hallmark floor: tokens only (no new colours/fonts), focus-visible rings, no `transition: all`, animate `transform`/`opacity` only, `prefers-reduced-motion` fallback, `overflow-x: clip` on html/body.
- **Note:** this deliberately loosens the earlier "dense, hairline-dividers" dashboard taste for the expanded card, per explicit user direction.

---

## 4. Compact header (Phase 1)
Rework `CardHead`:
- **Line 1:** project name + the single status chip (On track / At risk / Blocked / Waiting on client).
- **Line 2 (muted):** `workspace · client · AI age · model`.
- **Needs my reply** and **Inactive 24h+** appear **only when true** (already conditional; keep, but ensure they never render as a dimmed strip).
- Actions: **Sync** stays primary/visible. **Collapse, Edit, Delete** move into the existing **"…" menu** (currently holds Settings + Delete). Add **Edit** (opens the project Edit modal) and **Settings**; keep Delete.

---

## 5. Agent chat (Phase 2)

### 5.1 Panel
- Full-height chat in the centre: messages scroll, composer **sticky at the bottom**.
- **Empty state:** 3–4 suggestion chips — `Kitna complete hua?`, `Kaun se blockers hain?`, `Client ne last kya bola?`, plus one more. Clicking one sends it as the question.
- **Inline entry from Summary:** [REMOVED] previously had an "Ask agent…" input at its bottom; cancelled and removed from the project card.

### 5.2 Contract (main)
- Channel **`DashboardAskAgent: 'dashboard:ask-agent'`**.
- `DashboardAskAgentPayload`: `{ projectId; question; history: Array<{ role:'user'|'assistant'; text:string }> }`.
- `DashboardAskAgentResult`: `{ ok:true, answer:string, toolCall?: ProjectToolCall }` or `{ ok:false, code:'no_key'|'provider'|'invalid_input', error:string }`.
- Types in `dashboard-contract.ts`; channel + signature in `ipc-contract.ts`; exposed as `window.api.dashboard.askAgent(payload)` in `preload`.

### 5.3 Grounding
- `DashboardAgentService` (`src/main/dashboard/agent-service.ts`), built in `index.ts` beside `DashboardChatService`, deps: `aiSettings.getProvider(projectId)`, `chatService.loadMessages`, `insightEngine.existingInsight(projectId)`.
- `buildAgentContext(insight, messages)` (pure, testable): present-only insight fields (situation, status+reason, recent change, next step, blockers, risks, requirements, decisions, commitments, scope+deliverables, mood+reason, activity, people, channels) then the newest **~40 displayable** messages (`[#channel] name: text`, oldest→newest). Character cap; on overflow drop oldest messages, keep insight intact.
- System prompt: answer only from context; else exactly `Chat mein ye nahi mila.` v1 is request/response (no streaming); `history` is replayed for follow-ups.

### 5.4 Errors
`no_key` → inline "Add an API key in Settings to use the agent." `provider`/timeout → "Agent didn't answer. Try again." Never a fabricated answer; the fallback string is only for the genuine not-in-context case.

---

## 6. Agent edit — propose → confirm → apply (Phase 3)

### 6.1 Editable fields (closed set — nothing else)
`startDate`, `endDate`, `completion` (manual %), `name` (project), `clientName`. **Never** Slack messages, AI insight, status, or files.

### 6.2 Tool registry
- `ProjectTool` registry (`src/main/dashboard/project-tools.ts`). First tool **`updateProject`** with args `{ field, value }`. MCP tools register into this same map later (no MCP now).
- The agent may emit a structured `toolCall` (`updateProject { field, value }`) alongside its answer.

### 6.3 Flow
1. Agent proposes → response carries `toolCall`.
2. Chat renders a **"Proposed change"** row: `field · old → new` with **Apply** / **Dismiss**.
3. **Validation before showing:** date fields parse to `YYYY-MM-DD`; `completion` is an integer 0–100; name/clientName non-empty and length-capped. Invalid → return an error to the agent (it re-answers), do not show an Apply row.
4. **Apply** uses the **same `upsertProject` path the Edit modal uses** (no new write channel). On success, show **Undo** for **30 s**; Undo re-applies the previous value via the same path.
5. **Dismiss** drops the proposal, no write.

---

## 7. Components
- **`WorkspaceSidebar.tsx`** — nav rail (3 accordion entries + pinned footer + collapse toggle). No content. Props: nav state + `onToggleGroup`/`onSelectItem`/`onToggleCollapse`.
- **`WorkspaceContent.tsx`** — pure `{openGroup, selection}` → body map (unit-tested).
- **`useWorkspaceNav.ts`** — persisted `{ openGroup, selection, collapsed }` under `orbit.workspace.nav.<projectId>` (localStorage, guarded, mirrors `useSidebarCollapse`).
- **`AgentChatPanel.tsx`** (Phase 2) — thread + sticky composer + suggestion chips + proposed-change rows (Phase 3).
- **`ExpandedWorkspace.tsx`** — becomes the shell: `CardHead` → `.ws-shell-body` (sidebar + centre). Delete the `ws-tabs` strip and `WorkspaceTab`/`TabDef` machinery; translate `initialTab`/`initialGuideSection`/`initialDetailKey` into nav state on mount (pure mapper, tested).
- **`agent-service.ts`**, **`project-tools.ts`** (main, Phases 2–3).
- **Reused unchanged:** `CentreContent`, `CentreVisuals`, `SlackChatTab`, `ProjectSettingsTab`, `guide-content`, `guide-model`. `useSidebarCollapse`'s left/right is retired for this layout (single `collapsed` now).

---

## 8. Testing
- **Unit (Vitest):** `useWorkspaceNav` (accordion single-open, persistence, collapse, selection round-trip); `WorkspaceContent` map (each `{group,selection}` → expected body; visual single vs stacked); entry-prop mapper; `buildAgentContext` (present-only fields, 40-cap, ordering, insight kept on truncation); no-guess fallback byte-exact; `DashboardAgentService` (`no_key`, `provider`, happy path passes context+history); `updateProject` validation (dates, 0–100, name) and propose/apply/undo via a fake `upsertProject`.
- **UI proof (Electron over CDP 9222):** build + typecheck + full suite green (162 baseline; lint-red pre-existing, reported not masked). Expand a card and screenshot each phase: sidebar open/collapsed, Visualization single + stacked, Summary groups with dimmed zero-counts, compact header + "…" menu, Agent chat empty-with-chips + a grounded answer + the fallback, and a proposed-change → Apply → Undo. Confirm no horizontal overflow wide/narrow and the **primary app sidebar file is byte-identical**.

---

## 9. Out of scope
- Streaming chat responses.
- MCP transport/tool exposure (registry only, `updateProject` first).
- Editing anything outside the §6.1 closed field set.
- The standalone Slack channel rail (public channels + private groups, resizable) — separate follow-on; `SlackChatTab` preserved.
- Any change to the frozen primary app sidebar or main-process secret handling.

## 10. Success criteria
1. Every expanded card is **sidebar + wide centre**, roomy, few lines, no card-in-card, no right rail.
2. Agent chat answers project questions grounded in insight + messages, exact fallback otherwise.
3. Agent can propose edits to the 5 allowed fields only; apply goes through `upsertProject`; Undo works for 30 s.
4. Sidebar collapse + selection persist per project across reloads.
5. Consistent clean look across cards at wide/narrow; primary app sidebar untouched; build + typecheck + tests green.
