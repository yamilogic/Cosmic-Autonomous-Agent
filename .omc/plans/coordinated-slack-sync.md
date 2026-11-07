# Coordinated Slack sync — plan (2026-10-26)

Scope agreed before writing: **sync/fetch layer + its tests only. No UI change of any kind**
(no new button, label, page or style). `DashboardStoredMessage` and the delta-store on-disk
schema do not change. Tokens come from `ConfigService.resolveSettings()`; a token is never
logged (only the masked `slackTokenKey`). Baseline for this work: `pnpm typecheck` clean ·
`pnpm vitest run` **59 files / 462 tests** green · `pnpm run build` ok.

## 1. What one cycle costs today (measured, file:line)

Per project the engine builds a **fresh** `SlackPoller` (`sync-engine.ts:361`, default `:128`),
so anything the poller memoises dies with the project.

| Method | Who calls it | Calls per cycle today | Duplicated across projects? |
|---|---|---|---|
| `conversations.history` | `fetchHistory` (`slack-poller.ts:236`) ← `syncWorkspace` (`sync-engine.ts:195`) | `U` = unique `(tokenKey, channelId, cursor)` — already deduped per cycle by the audit `CycleHistoryCache` (`sync-engine.ts:58,232-247,470`); naive cost `Σ c_i` | no (fixed in audit A9) |
| `conversations.replies` | `fetchReplies` (`slack-poller.ts:291`) ← inside `fetchHistory` (`:267`), every parent with `replyCount>0` | `Σ` over unique history fetches, up to 10 parents × 3 pages = **≤120** for 4 channels | no (rides the cached fetch) but **unconditional** — re-pulls threads every cycle |
| `auth.test` | `teamUrl` (`slack-poller.ts:318`) ← `fetchHistory` (`:228`) | **once per project** (`~N`), plus once per project that also reads Our Slack | **yes** — the per-poller memo (`slack-poller.ts:210,315-326`) is defeated by the new-poller-per-project |
| `users.list` | `usersList` (`slack-poller.ts:374`) ← `insight-engine.ts:153`, wired `index.ts:369` | up to once per project whose insight is due | **yes** — no cache at all |
| `conversations.list` | `listChannels` (`slack-api-client.ts:86`) | 0 in the cycle; every `list-channels` IPC (`dashboard.ipc.ts:168`) hits Slack again | **yes**, across repeated IPC opens |
| `chat.postMessage` | chat send | 0 in the cycle | n/a |

Concurrency: `syncAll` is a **sequential `for…of` with await** (`sync-engine.ts:471-474`), so
exactly one call is ever in flight and the 2-per-token gate (`slack-throttle.ts:9,63`) never
queues — it only binds through `reportSlackRateLimit` (`slack-poller.ts:153`). Scheduled cycles
are serialised (one-shot re-arm `scheduler.ts:162-172` + `running` guard `:62,178`), but the
**manual Sync IPC (`dashboard.ipc.ts:204-214`) has no guard and no freshness window** — a click
can overlap a running cycle and re-fetch everything.

Worked example (10 projects, 4 unique `(workspace, channel)` pairs, threads present):
`history 4 · replies ≤120 · auth.test 10 · users.list ≤10 · list 0`.
Naive per-project (no cycle memo): `history 10`.

Two facts that shrink the work:
- The **shared store already exists**: delta files are keyed
  `<rootDir>/channels/<profileId>/<teamId>/<channelId>.json` (`delta-store.ts:56-58`) and two
  cards on one channel already read and write the same file (`audit-sync-cycle-memo.test.ts:36`).
  So "one shared store, each card filters by its own `selectedChannels`" needs **no schema
  change** — the per-card filter is `collectMessages` → `messagesSince` (`sync-engine.ts:637`).
- The union of selected channels per workspace is already computed as a grouping
  (`sync-engine.ts:288-294`); there is just no job list built from it.

## 2. Decisions I took (override any of them)

1. **Tokens via `ConfigService.resolveSettings(projectId)`** (`config-service.ts:84`) as the
   sync path asks, replacing `sync-engine.ts`'s own `tokenFor()` (`:165-171`) +
   `TeamWorkspaceReader.getConnection()` (`:275`). `resolveSettings` already resolves exactly
   what the cycle needs — `client.{token,teamId,channels}` and `ourSlack.{token,teamId,channels}`
   (`:16-32`) — with per-project override falling back to global (`:86-106`). This is the one
   place I *remove* code rather than add it.
2. **Never merge tokens.** A job key is `(tokenKey, teamId, channelId)` where `tokenKey` is the
   existing `sha256(token).slice(0,16)` (`slack-throttle.ts:58`). Two projects on one
   `teamId` with different tokens get two jobs, and their histories never share a fetch. The
   delta file is keyed `profileId/teamId/channelId`, so sharing across different tokens would
   corrupt provenance — that is why the token is in the key.
3. **Single-flight lives in one place.** `CycleHistoryCache` (`sync-engine.ts:58`) is promoted
   into the coordinator and stays cycle-scoped; `auth.test`/`users.list`/`conversations.list`
   get cross-cycle caches with explicit TTLs (they are stable facts about a token, not new data).
4. **Freshness window**: a manual card Sync inside the window is served from the shared store
   with **zero Slack calls**; outside it, the card joins a coordinated cycle rather than
   starting a private fetch. Window default **20 s**, one named constant, no literals.
5. **No new timer.** The scheduler keeps its single re-arm (`scheduler.ts:162-172`); a cycle =
   `coordinator.runCycle()` once. Per-project pause is a **schedule-store map**
   (`slackSync.pausedProjectIds`), not a field on `DashboardProject`, so card data stays card data.
6. **Replies are conditional**: `conversations.replies` runs only when a parent's `replyCount`
   or latest-reply changed since the stored row (`delta-store.ts:102-106` already dedupes by ts,
   `:121` already carries the cursor). This is the largest call reduction and the highest-risk
   change, so it is its own phase and it is reversible by one tunable.
7. **Observability record is stored, never surfaced**: a JSON line appended to
   `<rootDir>/sync-cycles.jsonl` (masked token key, project count, unique channels, calls by
   method, naive-equivalent count, skips, errors, duration). No UI reads it in this change.
8. **Carry-over**: unfinished jobs are re-queued into the next cycle with their attempt count, so
   a token that rate-limited cannot starve a channel forever. Jobs are per key, not per project,
   so one dead token never blocks another workspace's jobs.
9. **Priority**: recency-based round-robin — a channel whose last successful fetch is oldest
   goes first, ties broken by the number of consumers watching it.
10. **Error attribution** as briefed: channel-level (`not_in_channel`, `missing_scope`,
    `channel_not_found`) marks that key and reports onto its consumer projects without failing
    the rest; token-level (`invalid_auth`, `token_revoked`, `account_inactive`, `not_authed`)
    pauses that token's queue and reuses the audit `isSlackAuthFailure` → `setStatus` path
    (`sync-engine.ts:229-249`) so reconnect behaviour is not reinvented; `429` holds only that
    token's queue via `reportSlackRateLimit` (`slack-throttle.ts`).

## 3. Files

New:
- `src/main/dashboard/sync-coordinator.ts` — job list, single-flight, per-token queues, priority,
  carry-over, error attribution, cycle record. No Slack SDK knowledge: it drives an injected
  `SlackFetcher` port so the tests can count calls exactly.
- `src/main/dashboard/slack-metadata-cache.ts` — cross-cycle TTL caches for `auth.test`
  (per tokenKey), `conversations.list` (per tokenKey, default 5 min), `users.list`
  (per tokenKey, default 15 min), fed to both the cycle and the `list-channels` IPC.
- `src/main/dashboard/sync-tunables.ts` — every number the coordinator uses, as named constants
  with `ORBIT_*` env overrides following the `ORBIT_PROGRESS_JUMP_THRESHOLD` pattern
  (`insights.ts:497`): page size (replacing the hardcoded `limit: 200` at
  `sync-engine.ts:200` / `slack-poller.ts:238`), max in-flight per token, freshness window,
  metadata TTLs, backfill window (30 days) and cap (200), jitter band, replies budget.
- `tests/unit/coordinator-*.test.ts` + `tests/unit/coordinator-exact-call-counts.test.ts`.

Changed:
- `src/main/dashboard/sync-engine.ts` — `syncAll` builds the coordinated cycle; `syncProject`
  consumes cycle results instead of fetching; token resolution switches to `ConfigService`.
- `src/main/dashboard/slack-poller.ts` — `auth.test` and thread expansion go through the metadata
  cache / conditional-replies rule.
- `src/main/ipc/dashboard.ipc.ts` — `list-channels` reads the metadata cache first; manual Sync
  consults the freshness window; no new channel.
- `src/main/dashboard/schedule-store.ts` + `src/shared/dashboard-contract.ts` — per-project pause
  map and the cycle-record type.
- `src/main/index.ts` — wire the coordinator, the shared fetcher, and inject the cache into the IPC.

Contract additions (all additive, all optional so old snapshots still parse):
```ts
// dashboard-contract.ts
ScheduleSettings.slackSync?: { enabled: boolean; intervalMinutes: number; pausedProjectIds?: string[] }

interface DashboardSyncCycleRecord {
  atIso: string
  tokenKeys: string[]                     // masked, never a token
  projectCount: number
  uniqueChannels: number
  callsByMethod: Record<string, number>
  naiveEquivalent: Record<string, number> // what per-project fetching would have cost
  skipped: { unselected: number; fresh: number; alreadyFetched: number; carriedOver: number }
  errors: { kind: 'channel' | 'token' | 'rate-limit'; key: string; slackError: string }[]
  durationMs: number
}
```
`DashboardChannelDelta` / `DashboardStoredMessage` / delta file layout: **unchanged**.

## 4. Phases (each: test first, then code, then gates, one commit)

**Phase 1 — coordinator core + exact call counts.** Job list from
`resolveSettings(projectId)` per project, union of selected channels per
`(tokenKey, teamId)`, single-flight per key, consumers per key, unselected channels never
queued. `syncAll` runs the cycle; projects read from it.
Tests (`coordinator-call-counts`): the briefed 3-card case — card A `#dev #design`, card B
`#dev #ops`, card C `#dev` ⇒ exactly **3** `conversations.history` calls (`#dev`, `#design`,
`#ops`), naive **5**, and the naive shape asserted by a second run with the coordinator disabled.
Plus: per-card isolation (card C sees only `#dev` messages in its snapshot), a channel with two
consumers appended once, different tokens on the same `teamId` never share a fetch.

**Phase 2 — token-level isolation and priority.** One queue per tokenKey, bounded in flight from
tunables, stagger + jitter, recency round-robin, carry-over.
Tests: a rate-limited Our-Slack token leaves client-workspace jobs running; a client token
failure does not stop another client workspace; 3 queued keys with cap 2 peak at 2; a job that
did not run in cycle N runs first in N+1 (no starvation).

**Phase 3 — metadata caches.** `auth.test` once per token per cycle (and reused across cycles
while valid), `conversations.list` TTL 5 min, `users.list` TTL 15 min, all feeding
`list-channels`.
Tests: 10 projects on one token ⇒ **1** `auth.test`; opening `list-channels` twice within TTL
⇒ 1 Slack call; after TTL expiry ⇒ 2; a token that fails `auth.test` does not poison another.

**Phase 4 — conditional replies.** `conversations.replies` only for parents whose `replyCount` or
latest reply changed versus the stored row.
Tests: unchanged threads ⇒ 0 reply calls on the second cycle; a bumped `reply_count` ⇒ exactly 1;
a brand-new parent ⇒ 1; the stored rows for the thread keep their shape.

**Phase 5 — one global cycle, freshness window, per-project pause.** Scheduler keeps its own
timer; manual Sync uses the window; paused projects excluded from the union and from
insight work.
Tests: two manual Syncs 5 s apart ⇒ the second makes 0 Slack calls and still returns the
snapshot; a Sync after the window ⇒ ≥1 call; a paused project is not fetched even when another
card shares its channel; pausing does not stop the cycle for the others; no second timer is
created (asserted on the injected scheduler).

**Phase 6 — backfill + error attribution + cycle record.** A newly selected key backfills 30 days
/ 200 messages, skipped when another card already fetched that key.
Tests: a newly added `#ops` backfills once while a second card selecting the same `#ops` triggers
no extra fetch; `not_in_channel` marks that key and leaves other keys' deltas intact;
`invalid_auth` sets `needs-reconnect` and stops that token only; 429 holds only that token;
the cycle record counts match the fetcher's real calls and contain no token substring.

Gates per phase: `pnpm typecheck` · `pnpm vitest run` (462 baseline never goes red) ·
`npx eslint <changed files>` = 0 errors · `pnpm run build` at the end of Phase 6. No push.

## 5. Before → after (10 projects, 4 unique `(workspace, channel)` pairs)

| Method | naive per-project | today | after Phase 1 | after 3+4+5 |
|---|---|---|---|---|
| conversations.history | 10 | 4 | 4 | 4 |
| conversations.replies | ≤300 | ≤120 | ≤120 | ~only-changed |
| auth.test | 10 | 10 | 10 | **1 per token** |
| users.list | ≤10 | ≤10 | ≤10 | **1 per token / 15 min** |
| conversations.list (IPC) | 0 | per open | per open | **1 / 5 min** |
| cycles per interval | — | timer + every manual click | timer | **timer, manual served fresh** |

## 6. Open questions before I start
1. **In-flight per token**: the audit shipped 2 (`slack-throttle.ts:9`); this brief says 3–4.
   I will move it to a tunable default and keep **2** unless you say 3 or 4.
2. **Per-project pause** needs a contract addition (`pausedProjectIds` in schedule settings) with
   **no UI to set it** — you asked for no UI change, so until a control exists it is only settable
   through the existing schedule IPC. Acceptable, or should I defer pause to the ticket that owns
   that control?
3. Phase 4 (conditional replies) can under-pull a thread Slack edited without bumping
   `reply_count`. Take the call savings and accept that blind spot, or leave replies as they are?
