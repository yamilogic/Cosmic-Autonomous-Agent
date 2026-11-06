# Per-project RAG agent — design + phased plan

**Status:** approved 2026-10-25. Phase 1 in progress. Decisions D1–D12 accepted as
recommended (D2 unverified: BM25 fallback is mandatory until embedding access is proven).

**Goal:** one grounded, evidence-gated agent per dashboard card. It reads both Slack
workspaces, maintains a single `ProjectState`, and lets the user chat with the card.

**Branch rule:** work lands on `beta` only. `main` (`9c46eba`) is an ancestor of `beta`
and is never modified, merged into, or pushed during this work.

**Hard constraint — card visuals are frozen.** The owner approved the card look as-is.
No change to markup, CSS, spacing, typography, colour, class names or layout in
`CompactCard`, `ProjectCard`, `CardHead`, `ExpandedWorkspace`, `CentreContent`,
`CentreVisuals`, `WorkspaceContent`, `WorkspaceSidebar` or `main.css` unless the owner
explicitly asks for that specific visual change. Phase 5 may only change *where the data
comes from*; rendering must be byte-identical for the same values. The sidebar is the one
surface open to improvement, and still without restyling the card.

**Assumption to confirm:** "the dashboard page" means the existing dashboard surfaces on
`beta` — `DashboardView` (overview), `CompactCard`, `ExpandedWorkspace` and its nav.
Phase 5 rewires those. If you meant adding the dashboard entry to the app shell, say so —
`DashboardRail` already does that.

---

## 1. What the codebase actually has today

Verified by reading the source, not the docs.

| Area | Reality |
|---|---|
| Sources | **One** Slack workspace per project (`project.profileId` + `teamId`, or `manualTokenKey`). There is no "our workspace" in main. The renderer's client/team nav is cosmetic; ticket 04 is still `ready-for-agent`. |
| Sync | Per channel, `oldest = stored cursor`, `limit: 200`, **`hasMore` ignored**, **no thread replies**, dedupe by `ts` per channel file. |
| 429 | Unlimited recursive retry (`slack-poller.ts:81-84`); `Retry-After` respected, no attempt cap. |
| Tokens | Main-process only (`TokenStore` + `safeStorage`). Renderer sees masks. Good. |
| Storage | JSON files under `<userData>/dashboard/`: `monitors.json`, `ai-settings.json`, `digest.json`, `channels/<profile>/<team>/<channel>.json`, `history/<projectId>.json`. Append-only, atomic temp+rename. |
| Insight | `NimProvider.chatJson` + hand-written merge/validation in `insights.ts`. `newCount >= 3` or 30-min heartbeat. Stores `ProjectInsight` + 200 history entries. Quotes are checked against supplied text; **no message refs/ts/permalink retained**. |
| Deterministic numbers | Split. `summary-engine.ts` (main) does dates, mood, completion, pace. **`card-view.ts` (renderer) does 7-day bars, days used/left, 24h/7d counts, inactive, score.** That violates "every surface reads ProjectState". |
| Validation | **No zod, no JSON-schema lib.** Hand-rolled guards. |
| Vectors | **None.** No embedding call, no vector store, no chunker. `NimProvider` has no `/embeddings`. |
| Chat | `AgentChatPanel` is a placeholder. `DashboardChatService` is Slack chat (read/post), not LLM. No agent IPC. |
| Permalinks | `DashboardStoredMessage.permalink` exists but the poller never fills it. |
| Freshness | Main broadcasts `snapshot-changed` / `sync-progress`; **no renderer subscribes**. Dashboard polls every 60 s. |

---

## 2. Decisions I need from you

| # | Decision | Recommended | Why |
|---|---|---|---|
| D1 | **"Our workspace" is not built.** Ticket 04 (global team Slack connection) is `ready-for-agent`. Build it inside this work? | Yes — as **Phase 1a**, before the agent touches two sources. One connected source still works if the user never connects ours. | Otherwise Phase 1's "both sources" and the sidebar's "Our channels" are a lie. |
| D2 | **Embedding model default** | `nvidia/llama-3.2-nv-embedqa-1b-v2` (long context, fits 800-token chunks), fallback `nvidia/nv-embedqa-e5-v5`; both configurable, discovered via `/models`. | I cannot verify your key's access without calling it. |
| D3 | **Vector store** | JSON per project + brute-force cosine (embeddings as base64 `Float32`), BM25 in memory. Upgrade path noted at >20k chunks. | No native module, no new DB, matches existing JSON/atomic-write pattern. 1.5k chunks × 2k dims ≈ 12 MB per project, ~3 ms/query. |
| D4 | **Structured output** | Add `zod` (pure JS, no native build) and define the agent schema once, shared with tools. | Hand-rolled guards already caused inconsistency (e.g. partial insight → `progress: undefined`). |
| D5 | **Tool protocol** | JSON-action loop: model replies `{tool, args}` or `{final}`; we validate with zod. Not native `tools`/function-calling. | `NimProvider` is custom and NIM tool-calling support varies by model. Same semantics, one retry, portable. |
| D6 | **Fate of `InsightEngine`** | Agent replaces its LLM role; heuristic snapshot stays as the no-key/failed-run fallback. Keep `InsightEngine` behind a flag for one release, then delete. | Two LLM writers to the same fields would fight. |
| D7 | **Pin granularity for lists** | Field-level pin for scalars; item-level suppression list (`resolvedBlockers`, hashed item text) for lists. | "Ye blocker resolved hai" needs item-level, not field-level. |
| D8 | **Streaming transport** | `webContents.send('dashboard:agent-chat-delta')` keyed by `requestId`, plus a normal `invoke` for the final result. | IPC `invoke` cannot stream. |
| D9 | **Undo after Apply** | Held in main (30 s, in-memory), reusing `monitorStore.upsertProject`. | Renderer state is reloadable; the undo window must not vanish or be bypassable. |
| D10 | **Fallback string** | Keep the already-spec'd `Chat mein ye nahi mila.` | It is the exact string in `2026-10-25-single-sidebar-workspace-design.md:17`. |
| D11 | **Daily full re-ground default** | Off by default; toggle in settings. | Cost, and the spec calls it optional. |
| D12 | **State versions** | New `state-versions/<projectId>.json`, 20 entries. Keep the old `history/<projectId>.json` read-only for migration, then stop writing it. | Avoids growing the hot state file. |

---

## 3. Conflicts to flag (not silently changed)

1. **`2026-10-25-single-sidebar-workspace-design.md`** specifies a smaller agent:
   non-streaming `DashboardAskAgent`, grounding = insight + last 40 messages,
   `updateProject {field,value}` as the only write. This plan **supersedes** it with RAG,
   streaming, tool registry and evidence. Needs your explicit OK.
2. **`2026-10-25-xomni-workspace-design.md`** makes "Talk to AgentWork" an MCP proxy.
   This plan implements **no MCP transport**; that row stays disabled/placeholder.
   The `ProjectTool` registry is shaped so MCP can ride on it later.
3. **ADR-0007** says "no cloud, no external AI". Already superseded by v2.2 NIM; this
   work continues that, and stores embeddings locally only.
4. **Renderer-derived metrics** (D-level: `card-view.ts:240-330,584,597`) contradict
   "no surface computes data". Phase 5 moves them into main's `ProjectState.metrics`.
   `tests/unit/dashboard-card-view.test.ts` must move with them.
5. **`ProjectCard` memo** (`ProjectCard.tsx:80-110`) does not compare `insight`/
   `insightUpdatedAt`/`syncState`, so insight-only updates can render stale. Fixed in Phase 5.

---

## 4. Target data model (additive to `dashboard-contract.ts`)

### 4.1 Sources

```ts
export type DashboardSource = 'client' | 'ours'

export interface DashboardWorkspace {
  source: DashboardSource
  profileId: string
  teamId: string
  teamName?: string
  /** auth.test `url` — lets main build permalinks without extra API calls. */
  teamUrl?: string
  tokenSource: DashboardTokenSource
  manualTokenKey?: string
  monitors: DashboardMonitor[]
}
```

`DashboardProject` gains `clientWorkspace?: DashboardWorkspace` and
`ourWorkspace?: DashboardWorkspace`. The legacy `profileId`/`teamId`/`monitors` stay until
Phase 5, derived on read, then marked deprecated (not deleted, to keep old snapshots valid).

`DashboardStoredMessage` gains `source: DashboardSource`, `threadTs?: string`,
`replyCount?: number`; `permalink` starts being populated.

### 4.2 ProjectState (the single read model)

```ts
export interface EvidenceRef {
  source: DashboardSource
  channelId: string
  channelName: string
  ts: string
  permalink: string
  quote: string            // verbatim, ≤ 200 chars
}

export interface ProjectState {
  projectId: string
  rev: number
  updatedAt: string

  /** Deterministic only — never written by the LLM. */
  metrics: ProjectMetrics

  /** LLM judgement, every item evidence-gated. */
  derived: DerivedFields
  /** fieldKey → the messages that justify the scalar value */
  fieldEvidence: Partial<Record<DerivedFieldKey, EvidenceRef[]>>

  /** User-owned; only the existing upsert path changes these. */
  user: UserOwnedFields

  overrides: StateOverrides
  proposals: ProposedChange[]
  lastRun: AgentRunSummary | null
  sync: {
    lastSyncedAt: string | null
    state: DashboardSyncState
    error: string | null
    sources: Record<DashboardSource, { lastSyncedAt: string | null; error: string | null }>
  }
}

export interface ProjectMetrics {
  totalMessages: number
  newMessages: number
  messages24h: number
  messages7d: number
  sevenDayBars: Array<{ dateIso: string; count: number; isToday: boolean }>
  perChannel: DashboardChannelDelta[]
  lastActivityAt: string | null
  lastClientAt: string | null
  myLastReplyAt: string | null
  daysUsed: number | null
  daysLeft: number | null
  totalDays: number | null
  timePercent: number | null
  pace: 'ahead' | 'on-track' | 'behind' | 'stale'
  inactive: boolean
  needsReply: boolean
  urgency: InsightUrgency
  sourceCounts: Record<DashboardSource, number>
}
```

`derived` reuses the existing `ProjectInsight` field names (no new vocabulary), plus
`evidence?: EvidenceRef[]` on `InsightHighlight`, `InsightBlocker`, `InsightCommitment`,
`InsightDecision`, `InsightRequirement`, `InsightDeliverable`, `InsightFile`, `InsightPerson`.

```ts
export interface UserOwnedFields {
  name: string
  clientName: string
  startDate?: string
  endDate?: string
  manualCompletion?: number
}

export type DerivedFieldKey =
  | 'summary' | 'status' | 'progressEstimate' | 'nextStep' | 'recentLine'
  | 'highlights' | 'openQuestions' | 'blockers' | 'risks' | 'requirements'
  | 'scope' | 'deliverables' | 'decisions' | 'commitments' | 'files'
  | 'people' | 'clientMood'

export interface StateOverrides {
  pinnedFields: Partial<Record<DerivedFieldKey, { value: unknown; pinnedAt: string }>>
  /** itemHash → why it was suppressed (e.g. "resolved by me") */
  suppressedItems: Partial<Record<DerivedFieldKey, Record<string, string>>>
}

export type UserFieldKey = 'name' | 'clientName' | 'startDate' | 'endDate' | 'manualCompletion'

export interface ProposedChange {
  id: string
  field: UserFieldKey
  from: unknown
  to: unknown
  reason: string
  evidence: EvidenceRef[]
  createdAt: string
  status: 'pending' | 'applied' | 'dismissed'
  appliedAt?: string
}

export interface AgentRunSummary {
  id: string
  trigger: 'sync' | 'manual' | 'daily' | 'chat-command'
  startedAt: string
  finishedAt: string | null
  newMessages: number
  status: 'running' | 'ok' | 'error' | 'cancelled' | 'skipped'
  error?: string
  model?: string
  tokens?: { input: number; output: number }
  toolCalls: Array<{ name: string; ok: boolean; at: string }>
  changedFields: DerivedFieldKey[]
}
```

`DashboardProjectSnapshot` becomes `{ project, state: ProjectState, digest }`. The old flat
fields stay temporarily as projections of `state` so the migration is incremental.

### 4.3 RAG

```ts
export interface RagChunk {
  id: string                 // source:channel:tsFrom-tsTo
  source: DashboardSource
  channelId: string
  channelName: string
  tsFrom: string
  tsTo: string
  messageTs: string[]
  users: string[]
  text: string               // rendered with author + time, ≤ 800 tokens
  permalinks: string[]
  embedding?: string         // base64 Float32
  embeddingModel?: string
}

export interface RagIndex {
  rev: 1
  projectId: string
  embeddingModel: string
  dim: number
  indexedThrough: Record<string, string>   // `${source}:${channelId}` → ts
  chunks: RagChunk[]
}
```

Chunker: thread-first (one thread = one chunk, split if > 20 msgs), else time-window of
10–20 messages / ≤ 800 tokens with 2-message overlap. Deterministic `chunkMessages()`.

Retrieval: `score = 0.6·cosine + 0.3·bm25Norm + 0.1·recency`, top 12 chunks, **plus the
last 30 messages always**. Every query carries `projectId`; the store refuses a chunk whose
`projectId` differs.

Degradation: if embeddings are unavailable (no access/rate limit), retrieval runs
BM25 + recency only and Settings shows a muted warning. It never silently returns nothing.

### 4.4 Settings additions

`AiSettingsPublic` / `EffectiveAiSettings` gain `embeddingModel` + `embeddingSource`
(resolution order unchanged: project → global → env). `DashboardAiSettingsSavePayload`
gains `embeddingModel?: string | null`. Keys stay `safeStorage`-encrypted, mask-only in the
renderer. Agent knobs live in a new `agent` block: `enabled`, `dailyReground`,
`tokenBudget`, `maxChunks`, `debounceMs`.

---

## 5. Storage layout

```
<userData>/dashboard/
  monitors.json                    (additive clientWorkspace/ourWorkspace)
  ai-settings.json                 (additive embeddingModel)
  digest.json
  channels/...                     (additive source/threadTs/permalink)
  state/<projectId>.json           NEW  ProjectState (hot file)
  state-versions/<projectId>.json  NEW  last 20 derived snapshots
  rag/<projectId>.json             NEW  RagIndex
  runs/<projectId>.json            NEW  last 200 AgentRunSummary
  agent-chat/<projectId>.json      NEW  last 200 chat turns
  team-workspace.json              NEW  ticket 04 global connection (secret in vault)
  history/<projectId>.json         legacy, read-only after migration
```

All writes keep the existing atomic temp+rename + serialize-queue pattern.

---

## 6. Migration

`state-migration.ts`, run lazily on first read per project, idempotent, never deletes:

1. `ProjectState.rev = 1` built from the last `DashboardProjectSnapshot` + newest
   `history/<projectId>.json` entry. Every migrated field is marked
   `migrated: true` internally so Phase 5 can label it "from previous sync".
2. Missing `source` on stored messages → `'client'` (correct: existing cards only ever
   synced their own workspace). No channel file is rewritten until the next append.
3. `clientWorkspace` derived from legacy `profileId`/`teamId`/`tokenSource`/`monitors`;
   `ourWorkspace` = `null` unless `team-workspace.json` exists.
4. No embeddings at first: the index is built lazily in bounded batches (64 chunks) by the
   scheduler; the card stays usable (BM25 + recent) meanwhile.
5. `insight-history` keeps working read-only; new versions go to `state-versions`.
6. Rollback: new files are additive; deleting them restores current behavior. No migration
   touches `monitors.json` destructively.

---

## 7. Phased plan

Each phase ends with: what exists, tests run, what's left — then I stop for your OK.
Bite-sized, TDD-level task breakdown is written at the start of each phase (writing-plans),
against this design.

### Phase 1 — Data layer (two sources, correct sync)

**1a — our team workspace** (only if D1 = yes)

- New `src/main/dashboard/team-workspace-store.ts` (global record + vault under reserved
  owner), `resolveWorkspaceToken()` shared by sync/chat/agent.
- Contract: `DashboardTeamWorkspace`, IPC `dashboard:team-workspace-get/set/clear`,
  `dashboard:team-workspace-channels`.
- UI: "Our team Slack" section in `GlobalSettingsPanel` + channel pinning.
- Tests: dedupe by team id, reconnect replaces, reconnect with same team as a card's own
  workspace records one workspace only, clear removes vault entry.

**1b — sync correctness**

- `slack-poller.ts`: paginate `hasMore` with `latest` (cap 10 pages/sync), fetch
  `conversations.replies` for new/updated threads, populate `permalink` (from
  `teamUrl` + channel + ts), cap 429 retries at 5 with `Retry-After`.
- `sync-engine.ts`: sync both workspaces, write `source` on every message, per-source
  cursors, per-source errors that never wipe the other, `Promise.allSettled` per project.
- `delta-store.ts`: additive fields, dedupe on `(profileId, teamId, channelId, ts)`,
  `messagesForProject(state)` reader filtered by source.
- `chat-service.ts` + `DashboardChatMessage`: carry `source`; sidebar filters by it.
- Tests: pagination across >200, thread dedupe, 429 cap, one-source failure keeps data,
  killed-sync leaves json intact, source filter exactness.

**Exit:** existing cards still render; new data carries source; all current tests green.

### Phase 2 — RAG index

- `rag/chunker.ts` (pure), `rag/bm25.ts` (pure), `rag/retrieve.ts` (pure ranking + recency),
  `rag/embeddings.ts` (NIM `/embeddings`, `input_type: passage|query`, batch 64, retry),
  `rag-store.ts` (per-project JSON, atomic, memoized matrix).
- `NimProvider.embeddings()` + `listEmbeddingModels()`.
- Settings: embedding model + effective-source line; "Reindex now" action when the model
  changes (clears embeddings, keeps text/chunks).
- Incremental: only chunks with `ts > indexedThrough` are embedded; index revision bumped.
- Tests: chunk boundaries/overlap/thread-first, ranking order, project isolation (a query
  can never return another project's chunk), incremental embed count = new chunks only,
  model-change invalidates vectors, degraded mode = BM25+recency.

**Exit:** retrieval works from a fixture, no LLM involved yet.

### Phase 3 — Agent core

- `agent/schema.ts` (zod): `AgentAction`, `DerivedPatch`, evidence required per item.
- `agent/project-tools.ts`: registry `ProjectTool { name, description, schema, run }`.
  Reads: `search_messages`, `get_recent_messages`, `get_project_state`, `get_user_fields`.
  Writes (auto-apply): the full `set_*` list from your brief + `add_history_entry`.
  User-owned: `propose_update` only.
  `projectId` is injected by the host (`ToolContext`), never accepted from the model.
- `agent/agent-service.ts`: queue (one run/project, `AbortController`), debounce, triggers
  (sync-with-new-messages, manual, daily re-ground, chat command), token budget, ≤200 new
  messages then summarise older, 1 retry on invalid output, keep previous state on failure,
  write `AgentRunSummary` + audit log.
- `agent/evidence.ts`: drops any item whose `EvidenceRef.ts` is not in that project's
  stored messages for that source/channel; scalar without evidence is not written.
- `agent/overrides.ts`: pinned fields win; suppressed items excluded; agent cannot unpin.
- `agent/proposals.ts`: `propose_update` → pending; apply via `monitorStore.upsertProject`
  (same path as the Edit modal); 30 s main-side undo.
- `metrics.ts`: move 7-day bars, 24h/7d, days used/left, inactive, needsReply-time,
  score out of `card-view.ts` into deterministic main functions.
- `digest.ts` + `recent-feed.ts` read `ProjectState` only (no raw message mixing).
- `insight-engine.ts`: behind `agent.enabled`; no key/failed run → heuristic state, card
  never blank.
- Tests: the five eval cases from your brief (no-data fallback, prompt injection in a
  client message changes nothing, cross-project leak impossible, zero new messages = zero
  LLM calls, manual dates never overwritten), plus evidence-drop, retry-once, pin-wins,
  queue-and-cancel, token budget.

**Exit:** agent updates `ProjectState` from fixtures with no UI work.

### Phase 4 — Agent chat

- `agent-chat-service.ts`: RAG-grounded answer, streaming deltas, source chips with
  permalinks, exact fallback `Chat mein ye nahi mila.`, commands (refresh, regenerate
  summary, pin/unpin, propose), local history + clear, 3–4 suggestion chips.
- IPC: `dashboard:agent-chat-send` (invoke → final), `dashboard:agent-chat-delta` (event),
  `dashboard:agent-chat-history`, `dashboard:agent-chat-clear`, `dashboard:agent-run`,
  `dashboard:agent-cancel`, `dashboard:agent-runs`, `dashboard:agent-proposal-apply`,
  `dashboard:agent-proposal-dismiss`, `dashboard:agent-proposal-undo`,
  `dashboard:agent-pin`, `dashboard:agent-unpin`.
- Renderer: replace the `AgentChatPanel` shell (history, composer, chips, streaming,
  clear, proposal cards with Apply/Dismiss/Undo countdown).
- Security: the agent has no network/file/shell tools; every tool call is audited.
- Tests: streaming frame assembly, fallback exactness, chip → correct permalink,
  clear, proposal apply/undo expiry, "abhi refresh karo" triggers a run.

**Exit:** chatting with a card works end-to-end on fixtures.

### Phase 5 — UI reads only ProjectState

- `card-view.ts` becomes a pure projector: every number comes from `state.metrics` /
  `state.derived`; only formatting stays. Delete the duplicated math.
- `DashboardProjectSnapshot` flat fields become getters over `state`; after this phase the
  renderer imports `state` everywhere (compact card, expanded card, sidebar counts,
  visualizations, Recent strip, Digest, overview).
- Freshness: "Updated 2m ago", "Agent updating…" (subscribe to the existing
  `snapshot-changed`/`sync-progress` broadcasts, which are already emitted but unused),
  muted error line on failure while the card keeps its last good state.
- Evidence UI: items with evidence get a hover/click popover → message + both-slack-source
  jump.
- Settings: Agent activity log (runs, new messages, changed fields, tool calls, tokens,
  errors); embedding model + "Using global: …" effective lines.
- Fix `ProjectCard` memo comparison.
- Tests: snapshot with `state` only renders every surface; no renderer arithmetic remains
  (unit-test the projector with a fully numeric state); freshness/error states.

**Exit:** no surface computes data; card never blank.

### Phase 6 — Hardening

Fixture project built from real AgentWork-style messages (redacted), perf check (1.5k
chunks query < 50 ms; sync of 10 projects under the 300 s interval), docs
(`docs/dashboard-agent.md`), and a live Electron pass with screenshots.

---

## 8. New/modified files

| File | P | Action |
|---|---|---|
| `src/shared/dashboard-contract.ts` | 1–4 | add sources, ProjectState, evidence, proposals, agent IPC types, embedding settings |
| `src/shared/ipc-contract.ts`, `src/preload/index.ts` | 1–4 | new channels + bridge methods |
| `src/main/dashboard/slack-poller.ts` | 1 | pagination, threads, permalink, 429 cap |
| `src/main/dashboard/sync-engine.ts` | 1 | two sources, per-source isolation |
| `src/main/dashboard/delta-store.ts` | 1 | source/thread fields, project-filtered reads |
| `src/main/dashboard/team-workspace-store.ts` | 1a | **new** |
| `src/main/dashboard/chat-service.ts` | 1 | carry `source` |
| `src/main/dashboard/rag/*` (5 files), `rag-store.ts` | 2 | **new** |
| `src/main/dashboard/ai-provider.ts` | 2 | embeddings |
| `src/main/dashboard/ai-settings*.ts` | 2 | embedding model resolution |
| `src/main/dashboard/agent/*` (6 files) | 3–4 | **new** |
| `src/main/dashboard/project-state-store.ts`, `state-versions-store.ts`, `state-migration.ts`, `metrics.ts`, `agent-run-store.ts`, `agent-chat-store.ts` | 3 | **new** |
| `src/main/dashboard/insight-engine.ts`, `digest.ts`, `recent-feed.ts` | 3 | read/write ProjectState |
| `src/main/ipc/dashboard.ipc.ts`, `src/main/index.ts` | 1–4 | wiring |
| `src/renderer/.../card-view.ts` | 3, 5 | math out, projector in |
| `src/renderer/.../AgentChatPanel.tsx` | 4 | real chat |
| `src/renderer/.../ProjectSettingsTab.tsx`, `GlobalSettingsPanel.tsx`, `AiSettingsForm.tsx` | 1a, 4, 5 | team Slack, activity, embedding |
| `src/renderer/.../ProjectCard.tsx`, `DashboardView.tsx`, `CompactCard.tsx`, `ExpandedWorkspace.tsx`, `WorkspaceContent.tsx`, `WorkspaceSidebar.tsx`, `CentreContent.tsx`, `CentreVisuals.tsx`, `guide-model.ts` | 5 | state-only |
| `src/renderer/src/hooks/useDashboard.ts` | 5 | subscribe to broadcasts |

---

## 9. Security invariants (enforced in code, each has a test)

1. Message text is data: tool results are wrapped and labelled untrusted; the system prompt
   forbids following instructions found inside them.
2. `projectId` is injected by the host; no tool schema contains it.
3. RAG and delta reads always take `projectId`; a mismatched chunk is an error, not a filter.
4. Agent tools = the registry only. No `fetch`, no `fs`, no shell.
5. Every tool call, run, and proposal is audited with `projectId`.
6. Keys never cross IPC; only masks and effective-source labels.

---

## 10. Open questions

1. D1–D12 above.
2. Does your NIM key have embedding access? (One `curl /v1/models` answers it. I will not
   read `.env`.)
3. Should the agent run **instead of** the current insight refresh immediately, or run in
   shadow mode for one sync window and only then become the writer? (Shadow = safer, one
   extra phase of delay.)
4. Card "score" (importance) is renderer-only today. Keep it, or drop it when state moves
   to main? Your brief does not mention it.
