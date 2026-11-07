# Global Config + per-project config — implementation plan

**Status:** proposed, awaiting approval. No code changed.
**Branch:** `beta` only. `main` untouched.
**Supersedes:** `docs/superpowers/plans/2026-10-25-our-slack-and-workspace-onboarding.md` (that plan proposed a *global curated* Our Slack channel set; this model uses **per-project** `ourSlackChannels`).

## Goal

One app-level config for **Our Slack** and **NVIDIA**. Each project keeps only its required client workspace token + channels. AI and Our Slack can be overridden per project, field by field. Every consumer (insight, chat, sync, future agent/embeddings) reads effective values from one `resolveSettings(projectId)` helper.

## What exists today (verified)

| Concern | Current code | Consequence |
|---|---|---|
| Global Our Slack | `src/main/dashboard/team-workspace-store.ts` — one workspace, encrypted token, global `channels` | Token/workspace reusable, but channels are global, not per project. No `status`/`lastVerifiedAt`. |
| Global NVIDIA | `src/main/dashboard/ai-settings-store.ts` + `ai-settings.ts` | Global key/model + per-project key/model with a **single** `useGlobal` switch. No embedding model, no per-field source. |
| Client token | `MonitorStore` manual vault key (`project.manualTokenKey`) or OAuth `TokenStore` | Already encrypted; no separate `client` object needed. |
| Project | `DashboardProject` in `src/shared/dashboard-contract.ts` | Has `teamId`, `teamName`, `monitors`, `manualTokenKey`. Needs `ourSlackChannels` + Our Slack override fields. |
| Validation | `SlackPoller.authTest()`; `listChannels()` already follows `next_cursor` | No required-scope enforcement, no `x-oauth-scopes` capture, no bot-in-channel status. |
| UI | `GlobalSettingsPanel.tsx` (Our Slack + AI), `DashboardWizard.tsx`, `ProjectSettingsTab.tsx` | UI exists but no global "config" model, no per-field override display, no Our Slack mapping. |

## Conflicts with earlier decisions (flag first)

1. **Previous plan** assumed a global curated Our Slack channel set + per-project subset. Your new model says global Our Slack is only `{token, workspace, status}`; `ourSlackChannels[]` belongs to each project. This plan follows your new model and marks the previous plan superseded.
2. **Old team-slack spec** said "choosing a different team workspace per card is out of scope". Your model adds `overrides.ourSlackToken` per project. New instruction wins; the override is explicit and visible.
3. **Bot token (`xoxb`) vs current OAuth/user token (`xoxp`)**. Current app mostly reads user tokens. New wizard will use a Slack **bot token** and bot-channel membership semantics (`not_in_channel`). Existing OAuth projects keep working as legacy client tokens; no silent conversion.
4. **AI `useGlobal` single switch** conflicts with per-field override. We will replace it with field-level overrides and migrate old records.
5. **Compact card frozen** from the earlier dashboard work. The "Global setup pending" banner will render in the Dashboard header/expanded card and Settings, not inside the compact card, unless you explicitly want the compact card changed.
6. **Embeddings/agent core not built yet.** `embeddingModel` will be stored and resolved now; the "reindex" confirmation will warn, but actual re-embedding starts when the agent core lands. No fake reindex progress.

## Data model (logical)

Main-process-only types; renderer gets masks/status only.

```ts
// Global, one app-level logical config. Backed by existing encrypted stores.
interface GlobalConfig {
  ourSlack: {
    tokenMask: string | null
    workspaceName: string | null
    teamId: string | null
    status: 'connected' | 'needs-reconnect' | 'not-configured'
    lastVerifiedAt: string | null
  }
  nvidia: {
    apiKeyMask: string | null
    chatModel: string
    embeddingModel: string
    status: 'ok' | 'invalid' | 'not-configured'
    lastVerifiedAt: string | null
  }
}

// Per project (DashboardProject additions)
interface DashboardProject {
  // existing client fields stay as the client config:
  // profileId / teamId / teamName / tokenSource / manualTokenKey / monitors
  ourSlackChannels?: DashboardMonitor[]       // empty/undefined = no Our Slack read
  ourSlackTokenKey?: string                   // vault key for a per-project Our Slack token
  ourSlackTeamId?: string
  ourSlackTeamName?: string
}

// Per-project AI overrides live in ai-settings.json, not duplicated in DashboardProject.
interface StoredProjectAiSettings {
  apiKeyEnc?: string
  apiKeyPlain?: string
  chatModel?: string
  embeddingModel?: string
  // legacy useGlobal is migrated away
}
```

`client.botToken` in the UI maps to `manualTokenKey` + encrypted vault. We do not add a second token field to the project record.

## One resolver

Create `src/main/dashboard/config-service.ts`:

```ts
export interface ResolvedSettings {
  client: {
    token: string | null
    workspaceName: string | null
    teamId: string
    channels: DashboardMonitor[]
    source: 'project' | 'none'
  }
  ourSlack: {
    token: string | null
    workspaceName: string | null
    teamId: string | null
    channels: DashboardMonitor[]
    source: 'global' | 'project' | 'none'
  }
  ai: {
    apiKey: string | null
    chatModel: string
    embeddingModel: string
    sources: {
      apiKey: 'project' | 'global' | 'none'
      chatModel: 'project' | 'global' | 'none'
      embeddingModel: 'project' | 'global' | 'none'
    }
  }
}

async resolveSettings(projectId?: string): Promise<ResolvedSettings>
async publicGlobalConfig(): Promise<GlobalConfig>
async publicProjectConfig(projectId: string): Promise<ProjectConfigView> // masks + sources
```

Rules:
- Each AI field resolves independently: project override → global → none. A project can override only `chatModel` and keep the global key.
- Our Slack: project override (token + workspace) → global → none. `ourSlackChannels` are filtered to channels visible to the effective token; removed/inaccessible channels are reported, not silently dropped.
- Client: project token is required; no global client fallback.
- No runtime reads of `process.env.NVIDIA_NIM_*`. Env may seed global config once during migration; after that, `resolveSettings` is the only reader.
- `insight-engine.ts`, `chat-service.ts`, sync, and future agent/embedding code receive the resolver, not separate keys.

## Physical storage / migration

- Keep the existing encrypted stores: `TeamWorkspaceStore` for global Our Slack, `AiSettingsStore` for global + project AI, `MonitorStore` for client/Our Slack vault keys. Add a `ConfigService` facade. One logical config, no duplicate secret path.
- Replace `AiSettingsStore.useGlobal` with field presence. Migration:
  - `useGlobal !== false` → no overrides.
  - `useGlobal === false` → copy non-null `model`/`apiKey` into per-field overrides.
  - `model` → `chatModel`; `embeddingModel` stays null until set.
- Old global team workspace becomes global Our Slack. Its old global `channels` are **not** copied into projects (your rule: old `ourSlackChannels` empty). Already-stored messages remain on disk; they are simply not shown until the project maps channels.
- Old projects keep their client token/channels unchanged. OAuth projects stay OAuth.
- Migration writes a backup copy of `monitors.json`, `ai-settings.json`, `team-workspace.json` to `backup/pre-config-v1/`, uses a marker file, and is idempotent. Nothing is deleted.
- If encryption is unavailable: production save fails with a clear error. Plaintext fallback remains test/dev-only (existing behavior is too permissive).

## IPC (additive, then old AI APIs retired)

`src/shared/ipc-contract.ts` + `src/preload/index.ts`:

- `dashboard:config-get` → masked `GlobalConfig`
- `dashboard:config-save-our-slack` → token; validate before save
- `dashboard:config-test-our-slack`
- `dashboard:config-disconnect-our-slack`
- `dashboard:config-save-nvidia` → `{ apiKey?, chatModel?, embeddingModel? }`
- `dashboard:config-test-nvidia`
- `dashboard:config-summary` → project counts using global vs override
- `dashboard:project-config-get` → `ProjectConfigView`
- `dashboard:project-config-save` → client token/channels, `ourSlackChannels`, overrides, optional Our Slack token
- `dashboard:project-config-reset-field` → reset one AI field / Our Slack to global
- `dashboard:slack-channels-page` → paginated channel list for pickers (`cursor`, `refresh`)
- `dashboard:config-changed` event → renderer refreshes immediately

## UI files

| File | Change |
|---|---|
| `DashboardView.tsx` | Header button becomes a gear **Settings**; opens Global Config. Add "Global setup pending" banner when config is absent. |
| `GlobalSettingsPanel.tsx` | Rewrite into Global Config with three sections: Our Slack, NVIDIA, usage. Replace `TeamSlackSettings` + `AiSettingsForm` in this surface. |
| `GlobalConfigOurSlack.tsx` | New: password/show-hide, Connect, connected card (workspace, mask, status, last checked), Disconnect/Replace, expandable how-to, bot invite note. |
| `GlobalConfigNvidia.tsx` | New: key, chat model dropdown, embedding model dropdown, Test connection, status. |
| `DashboardWizard.tsx` | 4 steps: client token → client channels → Our Slack channels (optional) → review. No AI step. |
| `ProjectSettingsTab.tsx` | Sections: client workspace, Our Slack channels, dates/details, Advanced overrides, effective summary, danger zone. |
| `AiSettingsForm.tsx` | Replaced by field-level override controls inside Project Settings; delete after migration. |
| `OurSlackChannelPicker.tsx` | New shared searchable multi-select with refresh + pagination; used by wizard and card settings. |
| `CardHead.tsx` | Small `custom` chip when the project has any override. |
| `src/renderer/src/assets/main.css` | Styles using existing tokens; no new palette/fonts. |

## Phase 1 — Global Config

1. `ConfigService` + contract types + `resolveSettings` with tests.
2. Extend `TeamWorkspaceStore` with `status`, `lastVerifiedAt`, `workspaceName`; validate bot token + required scopes before save.
3. Extend `AiSettingsStore` with `chatModel`, `embeddingModel`, `status`, `lastVerifiedAt`; per-field overrides in a separate migration step.
4. New Global Config panel with the three sections; gear in the header; empty/first-run states.
5. Global save broadcasts config change; providers/channel cache invalidated; non-overridden cards update immediately.
6. "Global setup pending" banner in Dashboard/expanded card, with link.

**Acceptance:** connect a bot token, see workspace + masked token + status; test NVIDIA key; model dropdowns load; global change updates a non-overridden card; disconnect does not blank the card.

## Phase 2 — New Project Wizard

1. Step 1: client bot token; `auth.test` + scopes + `team.info`; auto workspace name/ID. Exact missing-scope list, no save on failure.
2. Step 2: client channels; searchable multi-select; public + private channels where the bot is a member; exclude DMs/group DMs; minimum 1.
3. Step 3: only when global Our Slack is connected. Searchable, paginated, refreshable channel picker; optional; note that the agent will read all messages in selected channels. If missing, show a link to Global Config and allow finish.
4. Step 4: review; project name pre-filled from workspace, editable; client name optional; create.
5. No AI fields in the wizard; muted "Using global model: …" only.
6. Existing OAuth project edit still works; new projects use the bot-token path.

**Acceptance:** a new project is creatable with only client token + channels; global model is used; Our Slack step appears only when connected; wizard completes when Our Slack is missing.

## Phase 3 — Card Settings + overrides

1. Client workspace section: masked token, workspace, channels edit, status.
2. Our Slack channels: mapped channel list with remove; same picker; channel availability/refresh.
3. Dates/details: existing start/end, completion, project name, client name.
4. Advanced (collapsed):
   - AI override toggle per field: key, chat model, embedding model; show `Using global: …` / `Overridden`; `Reset to global`.
   - Our Slack override toggle: use global vs separate token; validate; channel list from the override workspace.
5. Effective config summary: client, Our Slack source, chat model + source, embedding model + source.
6. Danger zone: delete project (existing).
7. Embedding model change → confirmation that re-embedding will be required; actual reindex is a future agent-core hook (no fake progress).
8. Card header `custom` chip when any override exists.

**Acceptance:** partial override works (model only, key stays global); reset returns to global; global changes skip overridden fields; masks only.

## Phase 4 — Our Slack mapping + sync

1. Sync per project: client channels with client token; mapped `ourSlackChannels` with effective Our Slack token (global or per-project override). `source: 'client' | 'ours'` already exists in stored messages.
2. Shared fetch cache per `(tokenFingerprint, channelId)`: one fetch per channel per run, even when many projects map it. Each project still reads its own subset from the shared delta store; indexes stay isolated.
3. Per-token FIFO queue + rate limiter; honor `Retry-After`; stagger projects sharing a token.
4. Source health on the snapshot: `ok | needs-reconnect | not-in-channel | skipped | error`, with a message. One source failing leaves the other running and the card on its previous data.
5. `not_in_channel` → "Invite the bot to #channel". Invalid/revoked token → "Needs reconnect".
6. Channel list cache per token; refresh invalidates; `listChannels` keeps following `next_cursor`.
7. Wire `resolveSettings` into chat, sync, insight provider and future embeddings/agent. No direct key/token reads.

**Acceptance:** two projects mapping the same Our Slack channel fetch once; each sees only its mapped channels; revoked client token keeps Our Slack data and shows a client status; bot not invited shows the exact invite message; 429s retry instead of failing.

## Tests

- `config-service.test.ts`: global only, partial override, full override, global missing, per-field sources, masks only.
- `config-migration.test.ts`: backup created, idempotent, `useGlobal` → field overrides, model → chatModel, old channels not copied.
- `our-slack-channel-picker.test.ts`: filter, select/deselect, pagination cursor, refresh.
- `slack-token-validation.test.ts`: exact missing scopes, bot workspace detection, revoked token, no secret in output/log.
- `shared-channel-fetch.test.ts`: concurrent dedupe, separate tokens not shared.
- `sync-source-status.test.ts`: `not_in_channel`, revoked token, one-source failure.
- Update existing AI/sync/chat tests for the new resolver shape.

## Manual checklist

- [ ] New project with only client token + channels; global chat model is used.
- [ ] Our Slack dropdown shows channels; search/refresh/pagination work; DMs absent.
- [ ] Global key changed → non-overridden cards update; overridden card unchanged.
- [ ] Model-only override keeps global key; reset restores global.
- [ ] Revoked token → card keeps old data and shows "Needs reconnect".
- [ ] Bot not in channel → "Invite the bot to #channel".
- [ ] Same Our Slack channel mapped to two projects → one fetch, two isolated indexes.
- [ ] No raw token/key in renderer, logs, or IPC payloads.

## Out of scope

- Agent core, embeddings implementation, Flow page, Schedules.
- Teams/WhatsApp sources.
- More than one global Our Slack.
- A full admin/role system for Global Config.

## Approval gate

Phase 1 starts only after approval of this plan. I will stop after each phase with typecheck/test/build results and the manual evidence for that phase.
