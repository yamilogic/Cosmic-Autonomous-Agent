# Dashboard page + Schedules + Flow — plan

Date: 2026-10-25 · Branch: `beta` · Status: Phase A and Phase B implemented, tested and
committed. Phase C (Flow) still waits on the agent core (prompt registry + RAG).

This plan covers the new prompt. Order confirmed by the owner: sidebar (already done) → **Phase A**, **Phase B** → Agent core → **Phase C (Flow)**.

Current tree note: the earlier Phase 1 work (global team workspace, `source` tags, sync
hardening) is committed as `feat(dashboard): read our team workspace alongside each card's
client workspace`. Phase A is committed as `feat(dashboard): add the glanceable Dashboard page
inside the expanded card`.

## Fixed decisions (owner)

1. No fake client-happiness score. Mood is a chip + one-line reason + real quote. Trend only
   from ≥3 runs; otherwise "not enough signals".
2. Every LLM prompt = locked block (grounding, no fabrication, injection defence, schema) +
   editable instructions. Locked block and schema are read-only in the UI and prepended in main.
3. The 5-min cron runs only while Orbit is open. Catch-up sync on app start; Schedules shows
   "last ran". No background daemon.
4. Opening a card always selects **Dashboard**. Only section open/close state persists.

## Hard boundaries

- The **compact card is frozen**: no markup, CSS, spacing or layout changes to `ProjectCard`,
  `CompactCard`, `CardHead` or the Recent strip. They keep reading the same state.
- The **expanded workspace centre** is replaced by the new Dashboard page (this is what the
  owner asked for). Confirmation needed because it supersedes the earlier "card visuals frozen"
  instruction — see Q1.
- Counts, ages, pace, response times, 14-day bars: deterministic main-process code. LLM only
  for status, summary, next step, mood, extraction, progress estimate.
- No fabricated value anywhere: missing data → muted "Not enough data yet", never `0`.

## What data exists today (honest map)

| Widget | Data today | Verdict |
|---|---|---|
| Freshness / next sync | `snapshot.lastUpdatedAt`, progress events; no next-run field | last-run yes, next-run needs B |
| Progress ring | `project.manualCompletion`, `insight.progress` | available; label manual/estimate |
| Status + since | `insight.status`; `history/*.json` has `previousStatus` + `atIso` | available |
| Waiting-on-you count | `insight.clientAsk.openQuestions` (strings only) | count yes; exact age + message jump need evidence (agent core) |
| Client mood + reason + quote | `insight.mood/moodReason/moodQuote` | available |
| Mood trend | `history` entries each store full insight | available, ≥3 entries |
| Our response time (median) | raw messages in delta store, now `source`-tagged; client `selfUserId` known | available for client workspace; team owner id not stored → team excluded |
| Last client contact | raw client messages | available |
| Hero (situation / just changed / next step) | `insight.situationLine/recentLine/nextStep` | available |
| 14-day bars client vs ours | raw messages have `ts` + `source`; snapshot only has per-channel totals | needs new main-process metrics |
| Pace | dates + progress (renderer computes today) | move to main, same thresholds |
| Attention list + source chip + jump | blockers/risks/questions lack evidence refs | text yes; chip/jump only when evidence arrives (agent core) |
| New since last visit | `history` diffs; no `lastViewedAt` store | needs viewed store + diff |
| Requirements 3 + deliverables bar | `insight.requirements/deliverables` | available |
| Schedules | one global 300s timer, no per-project config, no run log, no catch-up | needs B |
| Flow nodes | tokens/workspace (yes), embeddings (not built), prompts (hardcoded, one call), per-step runs (no) | C comes after agent core |

**Ordering conflict:** source chips, "jump to message", oldest-question age and per-item
evidence cannot be complete before the agent core exists. Phase A will render those only when
evidence is present and otherwise show a muted "age unknown"/no chip. Nothing is invented.

## Contract additions

### Phase A

```ts
export interface DashboardActivityDay { date: string; client: number; ours: number; isToday: boolean }
export interface DashboardResponseStats { medianSeconds: number | null; pairs: number; windowDays: number }
export interface DashboardAttentionItem {
  kind: 'question' | 'blocker' | 'risk' | 'needs-reply'
  text: string
  atIso?: string
  source?: DashboardSource
  channelId?: string
  ts?: string
  permalink?: string
}
export interface DashboardMetrics {
  daily: DashboardActivityDay[]                 // last 14 days
  messages24h: { client: number; ours: number }
  lastClientContactAt: string | null
  ourResponse: DashboardResponseStats           // median over 14 days, null when pairs < 3
  waiting: { count: number; oldestIso: string | null; items: DashboardAttentionItem[] }
  statusSince: string | null
  moodTrend: Array<{ atIso: string; mood: InsightMood }>   // only when >= 3
  newSince: {
    lastViewedAt: string | null
    counts: { requirements: number; decisions: number; commitments: number; files: number; statusChanges: number; questions: number }
    items: DashboardAttentionItem[]
  }
}
// DashboardProjectSnapshot gains:
metrics?: DashboardMetrics
```

IPC: `dashboard:mark-viewed` `{ projectId, atIso? }` → writes `views.json`.
No schema migration; older snapshots simply lack `metrics`.

### Phase B

```ts
export type DashboardJobKind = 'sync' | 'agent' | 'daily-reground'
export interface DashboardSchedule {
  projectId: string
  sync: { enabled: boolean; intervalSeconds: number; lastRunAt: string | null; nextRunAt: string | null }
  agent: { enabled: boolean; lastRunAt: string | null }
  dailyReground: { enabled: boolean; lastRunAt: string | null }
}
export interface DashboardRunLogEntry {
  id: string; projectId: string; job: DashboardJobKind
  startedAt: string; finishedAt: string | null; durationMs: number | null
  ok: boolean; error?: string; newMessages: number
  sources?: { client: 'ok' | 'error' | 'skipped'; ours: 'ok' | 'error' | 'skipped' }
  agentTriggered?: boolean; fieldsChanged?: string[]; tokens?: { input: number; output: number }
}
export interface DashboardSchedulesView { schedule: DashboardSchedule; runs: DashboardRunLogEntry[] }
```

IPC: `dashboard:schedules-get`, `dashboard:schedule-update`, `dashboard:schedule-run-now`
(sync only until agent core; agent button disabled with an honest note), all per project.

### Phase C (outline — detailed after agent core)

`DashboardPromptId = 'summary_status' | 'extraction' | 'client_mood' | 'progress_estimate' | 'chat_system'`;
`DashboardPromptView/SavePayload/TestResult`, `DashboardFlowNode`. Prompt output schema is
locked and travels with the locked block; only `instructions` is stored.

## Files

### Phase A
Create:
- `src/main/dashboard/metrics.ts` — pure functions: 14-day split bars, median response, last
  client contact, status-since, mood trend, history diff for "new since", pagination/limits.
- `src/main/dashboard/viewed-store.ts` — atomic `views.json` (`{ [projectId]: iso }`).
- `src/renderer/src/components/dashboard/DashboardPage.tsx` (+ small local components in the
  same file or `dashboard-page/`): freshness, KPI strip, hero, 3 visuals, attention, new-since,
  client ask.
- `tests/unit/dashboard-metrics.test.ts`, `tests/unit/dashboard-viewed-store.test.ts`.

Change:
- `src/shared/dashboard-contract.ts` — metrics types + `snapshot.metrics`.
- `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `src/main/ipc/dashboard.ipc.ts` — mark-viewed.
- `src/main/dashboard/sync-engine.ts` — compute metrics in `buildSnapshot()` with a cache keyed
  by `projectId + lastUpdatedAt + insightUpdatedAt + totalMessageCount`; never on every poll.
- `src/renderer/src/components/dashboard/WorkspaceContent.tsx` — dash branch renders `DashboardPage`
  instead of `CentreContent`. `CentreContent.tsx` stays only if still used elsewhere; otherwise removed.
- `src/renderer/src/hooks/useDashboard.ts` — subscribe to `dashboard:snapshot-changed` and
  `dashboard:sync-progress` (preload already needs typed listeners); no 60s dependency.
- `src/renderer/src/hooks/useWorkspaceNav.ts` + `workspace-nav.ts` — open on Dashboard always;
  persist only section open/close + collapsed/width; new storage key `orbit.workspace.nav.v2`,
  dropping the stored selection once.
- `src/renderer/src/assets/main.css` — dashboard-page styles only. Fixed card height
  `clamp(640px, 100vh - 120px, 860px)`; header/sidebar fixed; centre scrolls with a thin scrollbar;
  max content width 960px; 24–32px spacing; count-up 400ms, disabled under
  `prefers-reduced-motion`.

### Phase B
Create:
- `src/main/dashboard/schedule-store.ts` — per-project config + last 20 run entries, atomic JSON
  `<dashboardRoot>/schedules.json`; seeds interval from existing `syncIntervalSeconds` (300s).
- `src/renderer/src/components/dashboard/SchedulesPage.tsx`.

Change:
- `src/main/dashboard/scheduler.ts` — replace one global timer with a 30s tick that selects due,
  enabled projects; clamp interval to 60–3600s; catch-up once on `start()` when
  `lastRunAt/snapshot.lastUpdatedAt` is older than the project's interval; record every run;
  one project failing never stops others.
- `src/main/index.ts` — wire schedule store into scheduler + IPC.
- `src/main/ipc/dashboard.ipc.ts`, contract, preload — schedules get/update/run-now.
- `src/renderer/src/components/dashboard/workspace-nav.ts` — Xomni rows become Chat with project,
  Talk to AgentWork, **Flow**, **Schedules**; `XomniModeKey` gains `flow | schedules`.
- `src/renderer/src/components/dashboard/WorkspaceContent.tsx` — new branches.
- `main.css` — schedules page only.

### Phase C
Create `src/main/dashboard/prompts/defaults.ts`, `prompt-store.ts`, `prompt-service.ts`,
`src/renderer/src/components/dashboard/FlowPage.tsx` + prompt drawer, tests.
Change `insights.ts`/agent to read the registry; no prompt text outside `defaults.ts`.
**Recommendation:** build the backend registry during the agent-core phase (not C), so the agent
never hardcodes prompts and C adds only the UI. See Q3.

## Storage / migration

- `views.json`: created on first mark; missing → `lastViewedAt: null` → "First visit" muted line.
- `schedules.json`: created on first read; absent → default 300s enabled for every existing project;
  no project-file migration.
- `history/*.json` stays read-only as the mood/status timeline until the agent's
  `state-versions/` store lands; Phase A reads whichever exists.
- Nav storage: bump to `orbit.workspace.nav.v2` and keep only sections/collapse/width; the old
  key is ignored, so no stale selection comes back.
- No change to `monitor-store.json` shape.

## Conflicts to resolve (do not silently choose)

1. **Frozen card vs new Dashboard page** — earlier instruction said the card look is perfect and
   must not change; this prompt asks for a redesigned expanded Dashboard. Plan assumes: compact
   card frozen, expanded centre replaced.
2. **One insight call vs P1–P4 nodes** — today `insights.ts` asks one model call for status,
   extraction, mood and progress with one schema. Flow wants four prompts and independent test
   runs. Recommended: four calls per run (P4 skipped when manual completion exists), each with
   its own locked block + schema. Cost: up to 4x calls per new-message run. Alternative: keep one
   call and let Flow show four read-only sections — cheaper but test-run/prompt editing per node
   would be cosmetic only.
3. **Registry before agent core** — the agent prompt says "agent reads only the prompt registry",
   but Flow/registry is C and agent core is before C. Recommended: registry backend in agent core,
   Flow UI in C.
4. **Evidence-dependent widgets** — source chips, message jump, exact question age need agent-core
   evidence refs. Phase A renders them conditionally; no placeholder ages.
5. **Response time for "our" workspace** — only the client workspace has `selfUserId`. Phase A
   computes response median from the client workspace; team-workspace replies are counted as
   activity but not as response pairs until a team owner id is stored.

## Tests

Phase A (unit): median with <3 pairs → null; pair selection across messages; 14-day split counts
by source; pace thresholds; status-since from history; mood trend hidden (<3); new-since diff
against `lastViewedAt`; empty state returns nulls, never 0; nav opens Dashboard with a stale
persisted selection.

Phase B (unit): interval clamp 60–3600s; paused project never runs; catch-up fires once when
stale; next-run arithmetic; run history capped at 20; a thrown project does not stop the tick;
run-now records duration/ok/error.

Phase C (unit): required-variable validation blocks save; version append/reset/diff; default
version changed → notice but no overwrite; locked block always present in the final prompt;
2 schema failures → default fallback + warning; test run performs no writes.

Manual checklist: Dashboard selected on open; fixed height + inner scroll; empty states; Schedules
shows 5-min sync + Run now; app restart catch-up; Flow key masks; prompt save/test/reset; no
fabricated numbers anywhere.

## Questions before coding

- **Q1** Expanded-only redesign OK (compact card untouched)?
- **Q2** Four model calls (P1–P4) with per-node test runs, or one call with four read-only prompt
  sections? (Recommend four.)
- **Q3** Build prompt registry in agent core, Flow UI in Phase C? (Recommend yes.)
- **Q4** Accept Phase A showing waiting count + "age unknown" and no message jump until agent core
  supplies evidence?
- **Q5** Commit the existing Phase 1 work first, or keep building on the uncommitted tree?
