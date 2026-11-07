> **Superseded (2026-10-25):** use `docs/superpowers/plans/2026-10-25-global-config-and-per-project-config.md`.
> That plan follows the newer model: per-project `ourSlackChannels` directly, no global curated channel set.

# Our Slack + client workspace onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure the team's own Slack workspace once in Global Settings, let every project choose only the team channels that matter to it, and let a new client project reuse an already-connected Slack workspace instead of pasting the same token again.

**Architecture:** Extend the existing global `TeamWorkspaceStore` with the facts the UI needs and keep one encrypted secret store. Add an optional per-project team-channel selection to `DashboardProject`; an explicit `undefined` means "inherit the global curated set", `[]` means "none", and any array is an explicit subset. Sync, chat and channel listing all resolve through one pure function so no project can read a team channel outside the global curated set. The wizard becomes a workspace picker + client channels + team channels + project details flow, reusing saved OAuth connectors and saved manual vault tokens.

**Tech Stack:** Electron, React, TypeScript, Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-team-slack-and-global-settings-design.md`

This plan **supersedes one decision** in that spec: team channels are no longer "pinned globally and added to every card verbatim". Global settings now curates the set that is *available*; each project selects the subset it reads. The workspace itself stays global — a project still never chooses a different team workspace.

---

## Context and current behaviour

The pieces already exist; this work connects them properly.

| Area | Today | Gap |
|---|---|---|
| Team connection | `src/main/dashboard/team-workspace-store.ts` stores one global workspace, its mask, and `channels`. | No `teamDomain` / `lastVerifiedAt`; channels mean "add to every card", so every project reads every pinned team channel. |
| Global settings | `TeamSlackSettings.tsx` connects by candidate or token and toggles pins, saving on every checkbox click. | Candidates come only from OAuth profiles; manual vault tokens are invisible. No search, no explicit save/discard, no test/reconnect, sparse error states. |
| Client onboarding | `DashboardWizard.tsx` always makes the user create a Slack app and paste a token, even when that workspace is already connected. | No workspace picker; no reuse of saved tokens; no team-channel step. |
| Project model | `DashboardProject` has one client workspace, monitored channels, dates, completion. | No place to store the project's selected team channels. |
| Sync | `sync-engine.ts` adds `teamWorkspace.channels` to **every** project snapshot. | All projects see the same internal channels, causing noise and cross-project leakage inside the dashboard. |
| Sidebar | `Our Slack` lists the global pinned set. | Must list the selected/effective set for the open project. |
| Project settings | Client channels can be edited. | No team-channel control. |

The old spec's "team channels are browsed, not synced" is already obsolete in the current tree — the sync engine does read them. This plan makes that read scoped per project.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Global settings curates** the team channels available to projects. **Each project selects** its subset. | Stops one client's internal channels appearing on another client's card. Answers "show only the channels that really matter". |
| D2 | New projects **inherit** the global curated set by default; a project can switch to an explicit subset (including none). | One connection, zero setup per card; still editable when a project needs fewer channels. |
| D3 | `undefined` = inherit, `[]` = none, non-empty array = subset. | Backward compatible with existing project records and keeps intent distinguishable from "none". |
| D4 | Client workspace picker lists **every reachable workspace once** (OAuth + manual vault), and **excludes the workspace already configured as Our Slack**. | Reuses both tokens instead of re-pasting; avoids a card whose client workspace is the same as the team workspace. |
| D5 | A workspace can own **many projects**; a project owns **exactly one** client workspace. "Client" and "Project" stay separate labels. | New client ≠ new token every time. Two projects for one client remain distinct cards. |
| D6 | Any local user who can open the app can edit Global Settings. No role gate. | The app is single-user desktop software; adding an admin system would be a different feature. Secrets stay masked and encrypted. |
| D7 | One encrypted secret path only: team token in `TeamWorkspaceStore`, client tokens in `MonitorStore`. No second vault. | Keeps the existing security boundary. |
| D8 | Global settings saves explicitly (Save / Discard), not on every toggle. | Pinning currently fires one IPC + file write per checkbox; a proper settings page should have one save boundary. |

### Open decision for the owner

D1 is the recommended model. The alternative is keeping one global set for every card (the current behaviour) and only improving the Global Settings UI. That would not fix "only the channels that matter for this project". **This plan assumes D1–D8.** If the owner wants the global-only model, Tasks 1, 3, 5 and 6 shrink substantially.

---

## Data model

### Contract additions

Modify `src/shared/dashboard-contract.ts`:

```ts
/** One workspace the app can reach, for either the client or team picker. */
export interface DashboardWorkspaceCandidate {
  profileId: string
  profileName: string
  teamId: string
  teamName: string
  teamDomain: string
  scopes: string[]
  /** How the app reaches it. */
  source: 'oauth' | 'manual'
  /** Present when source = 'manual'; a vault key, never a token. */
  manualTokenKey?: string
  /** True for the workspace currently stored as Our Slack. */
  isTeamWorkspace: boolean
}

/** Backwards-compatible alias so existing imports keep working. */
export type DashboardTeamWorkspaceCandidate = DashboardWorkspaceCandidate

export interface DashboardTeamWorkspace {
  connected: boolean
  profileId: string | null
  teamId: string | null
  teamName: string | null
  teamDomain: string | null
  source: DashboardTeamWorkspaceSource
  maskedToken: string | null
  /** The curated set available to projects. Not "on every card". */
  channels: DashboardMonitor[]
  updatedAt: string | null
  lastVerifiedAt: string | null
}

export interface DashboardTeamWorkspaceConnectPayload {
  source: 'oauth' | 'manual'
  profileId?: string
  teamId?: string
  /** Raw token, only when connecting a brand-new manual workspace. */
  token?: string
  /** Reuse an already-validated manual connector instead of re-pasting. */
  manualTokenKey?: string
}

export interface DashboardProject {
  // ...existing fields unchanged...
  /**
   * Team channels this project reads.
   * undefined = inherit Global Settings' curated set
   * []        = read none
   * array     = explicit subset, filtered against the curated set
   */
  teamChannels?: DashboardMonitor[]
}
```

`DashboardTeamWorkspaceChannelsPayload` stays the same; it now saves the curated set.

The stored team record also gains a non-secret `manualTokenKey?: string` so a reused saved connector does not require a second copy of the token. `TeamWorkspaceConnection` exposes it to main only.

### One resolution rule

Create `src/shared/dashboard-team-channels.ts`:

```ts
import type { DashboardMonitor } from './dashboard-contract'

/**
 * Effective team channels for one project.
 * A project can never read a channel outside the global curated set.
 */
export function resolveTeamChannels(
  selected: DashboardMonitor[] | undefined,
  curated: DashboardMonitor[]
): DashboardMonitor[] {
  if (selected === undefined) return curated
  const allowed = new Map(curated.map((channel) => [channel.channelId, channel]))
  const out: DashboardMonitor[] = []
  for (const channel of selected) {
    const match = allowed.get(channel.channelId)
    if (match) out.push(match)
  }
  return out
}

/** True when the project follows the global set rather than its own subset. */
export function inheritsTeamChannels(selected: DashboardMonitor[] | undefined): boolean {
  return selected === undefined
}
```

Why this shape:
- Old project records have no `teamChannels` → they keep reading the curated set, exactly today's behaviour.
- Removing a channel from Global Settings removes it from every project that inherited it and from explicit subsets too.
- The UI can distinguish "inherit" from "custom empty".

### Persistence and migration

- `TeamWorkspaceStore` record gains `teamDomain` and `lastVerifiedAt`; both optional on read for old files.
- `TeamWorkspaceStore.connect` replaces the whole record, as it already does. Reconnecting keeps no old channels.
- No project-file migration is required. Absence of `teamChannels` means inherit.
- The global file's existing `channels` array becomes the curated set automatically.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/shared/dashboard-contract.ts` | modify | Candidate, team workspace, connect payload, project team channels. |
| `src/shared/dashboard-team-channels.ts` | create | Pure inheritance/subset resolution. |
| `src/main/dashboard/workspace-candidates.ts` | create | Build one deduped candidate list from OAuth profiles + manual vault. Testable without Electron. |
| `src/main/dashboard/team-workspace-store.ts` | modify | Persist domain/verified time; public view. |
| `src/main/dashboard/sync-engine.ts` | modify | Resolve each project's team channels before syncing/reading. |
| `src/main/dashboard/chat-service.ts` | modify | Refuse Our Slack chat for a channel not selected by that project. |
| `src/main/ipc/dashboard.ipc.ts` | modify | Candidate connect, project-scoped listChannels, snapshot broadcast after team changes. |
| `src/main/index.ts` | modify | Wire candidate builder; pass manual vault deps. |
| `src/preload/index.ts` | modify | No new names unless a test-connection API is added; keep types. |
| `src/renderer/src/components/dashboard/TeamSlackSettings.tsx` | rewrite | Proper Global Settings section: connection card, candidates, token, searchable curation, save/discard. |
| `src/renderer/src/components/dashboard/GlobalSettingsPanel.tsx` | modify | Warn before closing with unsaved team-channel changes. |
| `src/renderer/src/components/dashboard/team-channel-picker.ts` | create | Pure filter/toggle/diff helpers for the picker. |
| `src/renderer/src/components/dashboard/DashboardWizard.tsx` | rewrite step flow | Workspace picker, client channels, team channels, project details. |
| `src/renderer/src/hooks/dashboard-wizard-core.ts` | modify | Pure workspace options, project validation, default team selection. |
| `src/renderer/src/components/dashboard/ProjectSettingsTab.tsx` | modify | Team-channel inherit/custom section. |
| `src/renderer/src/hooks/useSlackChannels.ts` | modify | Our Slack listing keyed by project + selection. |
| `src/renderer/src/components/dashboard/ExpandedWorkspace.tsx` | modify | Show effective team channels for the open project. |
| `src/renderer/src/assets/main.css` | modify | Settings and wizard styles using existing tokens only. |
| `docs/dashboard-ui.md`, `GLOSSARY.md` | modify | Document the new rules. |
| `tests/unit/dashboard-team-channels.test.ts` | create | Resolver. |
| `tests/unit/dashboard-workspace-candidates.test.ts` | create | Candidate dedupe. |
| `tests/unit/dashboard-team-workspace-store.test.ts` | modify | Domain/verified persistence. |
| `tests/unit/dashboard-two-source-sync.test.ts` | modify | Per-project isolation. |
| `tests/unit/dashboard-chat-service.test.ts` | modify | Channel authorization. |
| `tests/unit/dashboard-wizard-core.test.ts` | modify | Wizard helpers. |
| `tests/unit/dashboard-team-channel-picker.test.ts` | create | Picker helpers. |

---

### Task 1: Contract + effective-channel resolver

**Files:**
- Modify: `src/shared/dashboard-contract.ts`
- Create: `src/shared/dashboard-team-channels.ts`
- Test: `tests/unit/dashboard-team-channels.test.ts`

**Interfaces:**
- Produces: `resolveTeamChannels(selected, curated): DashboardMonitor[]`
- Produces: `inheritsTeamChannels(selected): boolean`
- Produces: `DashboardProject.teamChannels?: DashboardMonitor[]`
- Produces: `DashboardWorkspaceCandidate`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  inheritsTeamChannels,
  resolveTeamChannels
} from '../../src/shared/dashboard-team-channels'
import type { DashboardMonitor } from '../../src/shared/dashboard-contract'

const curated: DashboardMonitor[] = [
  { channelId: 'C1', channelName: 'acme' },
  { channelId: 'C2', channelName: 'internal' }
]

describe('resolveTeamChannels', () => {
  it('inherits the curated set when the project has no selection', () => {
    expect(resolveTeamChannels(undefined, curated)).toEqual(curated)
    expect(inheritsTeamChannels(undefined)).toBe(true)
  })

  it('returns none for an explicit empty selection', () => {
    expect(resolveTeamChannels([], curated)).toEqual([])
    expect(inheritsTeamChannels([])).toBe(false)
  })

  it('keeps only selected channels that are still curated', () => {
    expect(
      resolveTeamChannels(
        [
          { channelId: 'C2', channelName: 'old-name' },
          { channelId: 'C_REMOVED', channelName: 'gone' }
        ],
        curated
      )
    ).toEqual([{ channelId: 'C2', channelName: 'internal' }])
  })

  it('does not mutate the curated array', () => {
    const before = [...curated]
    resolveTeamChannels([{ channelId: 'C1', channelName: 'x' }], curated)
    expect(curated).toEqual(before)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/dashboard-team-channels.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the contract fields and resolver**

Add the contract additions above, then create `src/shared/dashboard-team-channels.ts` with the implementation shown in “One resolution rule”.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/unit/dashboard-team-channels.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/dashboard-contract.ts src/shared/dashboard-team-channels.ts tests/unit/dashboard-team-channels.test.ts
git commit -m "feat(dashboard): add per-project team channel resolution"
```

---

### Task 2: Workspace candidates + team store facts

**Files:**
- Create: `src/main/dashboard/workspace-candidates.ts`
- Modify: `src/main/dashboard/team-workspace-store.ts`
- Modify: `src/main/ipc/dashboard.ipc.ts`
- Modify: `src/main/index.ts`
- Test: `tests/unit/dashboard-workspace-candidates.test.ts`
- Test: `tests/unit/dashboard-team-workspace-store.test.ts`

**Interfaces:**
- Consumes: `DashboardWorkspaceCandidate`, `DashboardTeamWorkspaceConnectPayload`
- Produces: `listWorkspaceCandidates(deps): Promise<DashboardWorkspaceCandidate[]>`
- Produces: `TeamWorkspaceStore.readPublic()` with `teamDomain` / `lastVerifiedAt`
- Produces: `TeamWorkspaceStore.markVerified(now?)`

- [ ] **Step 1: Write the failing candidate test**

`src/main/dashboard/workspace-candidates.ts` must be testable with plain fakes:

```ts
import { describe, expect, it } from 'vitest'
import { listWorkspaceCandidates } from '../../src/main/dashboard/workspace-candidates'

describe('listWorkspaceCandidates', () => {
  it('merges OAuth and manual workspaces, deduped by team id', async () => {
    const candidates = await listWorkspaceCandidates({
      listProfiles: async () => [
        { id: 'pf1', name: 'Work profile' },
        { id: 'pf2', name: 'Personal profile' }
      ],
      listOauthWorkspaces: async (profileId) =>
        profileId === 'pf1'
          ? [
              {
                teamId: 'T1',
                teamName: 'Acme',
                teamDomain: 'acme',
                scopes: ['channels:read']
              }
            ]
          : [],
      listManualTokens: async () => [
        { key: 'DASH_TOKEN_ACME', teamId: 'T1', teamName: 'Acme', userId: 'U1' },
        { key: 'DASH_TOKEN_BETA', teamId: 'T2', teamName: 'Beta', userId: 'U2' }
      ],
      isTeamWorkspace: async (teamId) => teamId === 'T1',
      profileLabel: (profile) => profile.name
    })

    expect(candidates.map((c) => c.teamId).sort()).toEqual(['T1', 'T2'])
    const acme = candidates.find((c) => c.teamId === 'T1')!
    expect(acme.isTeamWorkspace).toBe(true)
    expect(acme.source).toBe('oauth')
    const beta = candidates.find((c) => c.teamId === 'T2')!
    expect(beta.source).toBe('manual')
    expect(beta.manualTokenKey).toBe('DASH_TOKEN_BETA')
  })

  it('never exposes a token', async () => {
    const candidates = await listWorkspaceCandidates({
      listProfiles: async () => [{ id: 'pf1', name: 'Work profile' }],
      listOauthWorkspaces: async () => [
        { teamId: 'T1', teamName: 'Acme', teamDomain: 'acme', scopes: [] }
      ],
      listManualTokens: async () => [
        { key: 'DASH_TOKEN_BETA', teamId: 'T2', teamName: 'Beta', userId: 'U2' }
      ],
      isTeamWorkspace: async () => false,
      profileLabel: (p) => p.name
    })
    expect(JSON.stringify(candidates)).not.toContain('xox')
    expect(candidates[1].manualTokenKey).toBe('DASH_TOKEN_BETA')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/unit/dashboard-workspace-candidates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the candidate builder**

```ts
import type { DashboardWorkspaceCandidate } from '../../shared/dashboard-contract'

export interface WorkspaceCandidateDeps {
  listProfiles(): Promise<Array<{ id: string; name: string }>>
  listOauthWorkspaces(profileId: string): Promise<
    Array<{ teamId: string; teamName: string; teamDomain: string; scopes: string[] }>
  >
  listManualTokens(): Promise<
    Array<{ key: string; teamId: string; teamName: string; userId?: string }>
  >
  isTeamWorkspace(teamId: string): Promise<boolean>
  profileLabel(profile: { id: string; name: string }): string
}

export async function listWorkspaceCandidates(
  deps: WorkspaceCandidateDeps
): Promise<DashboardWorkspaceCandidate[]> {
  const byTeam = new Map<string, DashboardWorkspaceCandidate>()
  for (const profile of await deps.listProfiles()) {
    for (const workspace of await deps.listOauthWorkspaces(profile.id)) {
      if (!workspace.teamId || byTeam.has(workspace.teamId)) continue
      byTeam.set(workspace.teamId, {
        profileId: profile.id,
        profileName: deps.profileLabel(profile),
        teamId: workspace.teamId,
        teamName: workspace.teamName,
        teamDomain: workspace.teamDomain,
        scopes: workspace.scopes,
        source: 'oauth',
        isTeamWorkspace: await deps.isTeamWorkspace(workspace.teamId)
      })
    }
  }
  for (const token of await deps.listManualTokens()) {
    if (!token.teamId || byTeam.has(token.teamId)) continue
    byTeam.set(token.teamId, {
      profileId: `manual:${token.key}`,
      profileName: 'Saved connector',
      teamId: token.teamId,
      teamName: token.teamName,
      teamDomain: '',
      scopes: [],
      source: 'manual',
      manualTokenKey: token.key,
      isTeamWorkspace: await deps.isTeamWorkspace(token.teamId)
    })
  }
  return [...byTeam.values()]
}
```

Then in `src/main/index.ts` replace the inline `listTeamWorkspaceCandidates` body with a call to this builder, using:
- `profileStore.list()`
- `tokenStore.listWorkspaces(profile.id)`
- `monitorStore.listManualTokenMeta()`
- `teamWorkspaceStore.readPublic()`

- [ ] **Step 4: Extend the team store and its test**

Add to the stored record:

```ts
teamDomain: string | null
lastVerifiedAt: string | null
/** Present when this connection reuses a saved manual vault token. Main only. */
manualTokenKey?: string
```

Add `teamDomain` and `lastVerifiedAt` to the public record; keep `manualTokenKey` out of `readPublic()` and expose it only on `TeamWorkspaceConnection`. `connect()` accepts optional `teamDomain`, `lastVerifiedAt` and `manualTokenKey`; `readPublic()` defaults the public fields to `null` for old files. Add:

```ts
async markVerified(now = new Date().toISOString()): Promise<DashboardTeamWorkspace> {
  await this.mutate((current) =>
    current.workspace
      ? {
          workspace: {
            ...current.workspace,
            lastVerifiedAt: now,
            updatedAt: now
          }
        }
      : current
  )
  return this.readPublic()
}
```

Test additions:

```ts
it('stores the workspace domain and last verification time', async () => {
  const { store } = await makeStore()
  await store.connect({
    payload: { source: 'manual', token: 'xoxp-secret-abcd' },
    profileId: 'manual:T_TEAM',
    teamId: 'T_TEAM',
    teamName: 'Our Team',
    teamDomain: 'our-team',
    token: 'xoxp-secret-abcd',
    lastVerifiedAt: '2026-10-25T10:00:00.000Z'
  })
  const view = await store.readPublic()
  expect(view.teamDomain).toBe('our-team')
  expect(view.lastVerifiedAt).toBe('2026-10-25T10:00:00.000Z')

  const verified = await store.markVerified('2026-10-25T11:00:00.000Z')
  expect(verified.lastVerifiedAt).toBe('2026-10-25T11:00:00.000Z')
})
```

- [ ] **Step 5: Wire connect-by-saved-connector and connect-by-candidate**

In `dashboard.ipc.ts`:

```ts
if (payload.source === 'manual') {
  token = payload.manualTokenKey
    ? await deps.monitorStore.getManualToken(payload.manualTokenKey)
    : (payload.token?.trim() ?? null)
  if (!token) throw new Error('Paste a Slack token or pick a saved connector.')
} else {
  // unchanged: profileId + teamId → oauthTokenProvider
}
```

After `authTest`, pass `teamDomain` and `lastVerifiedAt` to `store.connect`. For a saved manual connector, store `profileId: manual:${payload.manualTokenKey}`, set `manualTokenKey`, and store only the mask. Do **not** copy the token into the team record when it already lives in the vault.

Then update the `teamWorkspaceReader` in `src/main/index.ts` so reuse resolves the vault key:

```ts
const teamWorkspaceReader = {
  getConnection: async () => {
    const connection = await teamWorkspaceStore.getConnection()
    if (!connection) return null
    const token =
      connection.token ??
      (connection.manualTokenKey
        ? await dashboardMonitorStore.getManualToken(connection.manualTokenKey)
        : null) ??
      (await tokenStore.tryGet(connection.profileId, connection.teamId))
    return {
      profileId: connection.profileId,
      teamId: connection.teamId,
      token,
      channels: connection.channels
    }
  }
}
```

Set `lastVerifiedAt` from `new Date().toISOString()` on every successful connect and test.

Add the explicit test handler used by `Check connection`:

```ts
// src/shared/ipc-contract.ts
DashboardTeamWorkspaceTest: 'dashboard:team-workspace-test'

// dashboard.ipc.ts
handleInvoke(IpcChannels.DashboardTeamWorkspaceTest, async () => {
  const connection = await store.getConnection()
  if (!connection) throw new Error('Connect Our Slack first.')
  const token =
    connection.token ??
    (connection.manualTokenKey
      ? await deps.monitorStore.getManualToken(connection.manualTokenKey)
      : null) ??
    (await deps.oauthTokenProvider.tryGet(connection.profileId, connection.teamId))
  if (!token) throw new Error('No usable token for Our Slack. Reconnect it.')
  const check = await new SlackPoller().authTest(token)
  if (!check.valid) throw new Error(check.error ?? 'Slack rejected this token')
  const next = await store.markVerified()
  deps.window?.webContents.send(IpcChannels.DashboardTeamWorkspaceChanged, next)
  return next
})
```

Preload gains `testTeamWorkspace: () => ipcRenderer.invoke(IpcChannels.DashboardTeamWorkspaceTest)` and its type in `src/shared/ipc-contract.ts`.

- [ ] **Step 6: Broadcast and sync after team settings change**

`DashboardTeamWorkspaceChannels`, connect and clear handlers must call `broadcastSnapshot()` after the store write, so cards that inherit the curated set refresh immediately.

Add one event so open cards update without a reopen:

```ts
// src/shared/ipc-contract.ts
DashboardTeamWorkspaceChanged: 'dashboard:team-workspace-changed'
```

Emit `teamWorkspaceStore.readPublic()` on that event after connect/save/clear. Add to the preload dashboard API:

```ts
onTeamWorkspaceChanged: (callback: (workspace: DashboardTeamWorkspace) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, workspace: DashboardTeamWorkspace): void =>
    callback(workspace)
  ipcRenderer.on(IpcChannels.DashboardTeamWorkspaceChanged, listener)
  return () => ipcRenderer.removeListener(IpcChannels.DashboardTeamWorkspaceChanged, listener)
}
```

`ExpandedWorkspace` subscribes in Task 6 instead of fetching only once.

After a curated-channel save, kick one background sync so a newly added channel does not wait for the next schedule:

```ts
void deps.engine
  .syncAll()
  .catch((err) => console.warn('[dashboard] post-team-settings sync failed', err))
return broadcastSnapshot()
```

Do not block the Save button on `syncAll`; progress events already drive the cards.

- [ ] **Step 7: Run tests and typecheck**

Run:
```bash
npm test -- tests/unit/dashboard-workspace-candidates.test.ts tests/unit/dashboard-team-workspace-store.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/dashboard/workspace-candidates.ts src/main/dashboard/team-workspace-store.ts src/main/ipc/dashboard.ipc.ts src/main/index.ts tests/unit/dashboard-workspace-candidates.test.ts tests/unit/dashboard-team-workspace-store.test.ts
git commit -m "feat(dashboard): list every reachable Slack workspace for pickers"
```

---

### Task 3: Scope team sync and chat per project

**Files:**
- Modify: `src/main/dashboard/sync-engine.ts`
- Modify: `src/main/dashboard/chat-service.ts`
- Modify: `src/main/ipc/dashboard.ipc.ts`
- Test: `tests/unit/dashboard-two-source-sync.test.ts`
- Test: `tests/unit/dashboard-chat-service.test.ts`

**Interfaces:**
- Consumes: `resolveTeamChannels`
- Produces: every `DashboardProjectSnapshot` only contains that project's effective team channels.

- [ ] **Step 1: Write the failing isolation test**

Add to `tests/unit/dashboard-two-source-sync.test.ts`:

```ts
it('reads only the team channels the project selected', async () => {
  const { monitors, delta } = await setup()
  const team = {
    getConnection: async () => ({
      profileId: 'pf_team',
      teamId: 'T_TEAM',
      token: 'xoxp-team',
      channels: [
        { channelId: 'C_TEAM', channelName: 'team-project' },
        { channelId: 'C_OTHER', channelName: 'team-other' }
      ]
    })
  }
  await monitors.upsertProject({
    project: fakeProject({
      id: 'proj_two',
      teamChannels: [{ channelId: 'C_OTHER', channelName: 'team-other' }]
    })
  })

  const first = await engineWith(monitors, delta, team).syncProject('proj_x')
  expect(first?.perChannel.map((c) => c.channelId)).toContain('C_TEAM')
  expect(first?.perChannel.map((c) => c.channelId)).not.toContain('C_OTHER')

  const second = await engineWith(monitors, delta, team).syncProject('proj_two')
  expect(second?.perChannel.map((c) => c.channelId)).toContain('C_OTHER')
  expect(second?.perChannel.map((c) => c.channelId)).not.toContain('C_TEAM')
})

it('lets a project opt out of team channels entirely', async () => {
  const { monitors, delta } = await setup()
  await monitors.upsertProject({
    project: fakeProject({ id: 'proj_none', teamChannels: [] })
  })
  const snapshot = await engineWith(monitors, delta, teamReader()).syncProject('proj_none')
  expect(snapshot?.perChannel.every((c) => c.source === 'client')).toBe(true)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/unit/dashboard-two-source-sync.test.ts`
Expected: FAIL — both projects currently receive every team channel.

- [ ] **Step 3: Resolve channels inside the sync engine**

Change `storedWorkspaces(project)` and `syncProject` so the team branch uses:

```ts
const effective = resolveTeamChannels(project.teamChannels, connection.channels)
if (effective.length > 0) {
  workspaces.push({
    source: 'ours',
    profileId: connection.profileId,
    teamId: connection.teamId,
    monitors: effective
  })
}
```

Use the same resolved value in the network sync block that currently passes `connection.channels`. Do this in **one private helper**, so stored reads and network fetch cannot drift:

```ts
private teamMonitors(
  project: DashboardProject,
  connection: { teamId: string; channels: DashboardMonitor[] } | null
): DashboardMonitor[] {
  if (!connection) return []
  // A card whose client workspace is also Our Slack reads that workspace once.
  if (connection.teamId === project.teamId) return []
  return resolveTeamChannels(project.teamChannels, connection.channels)
}
```

`collectMessages()` and `storedDeltas()` already call `storedWorkspaces(project)`, so they inherit the fix. Add a test:

```ts
it('does not read the same workspace twice when Our Slack equals the client workspace', async () => {
  const { monitors, delta } = await setup()
  const same = {
    getConnection: async () => ({
      profileId: 'pf_client',
      teamId: 'T_CLIENT',
      token: 'xoxp-client',
      channels: [{ channelId: 'C_CLIENT', channelName: 'client-dev' }]
    })
  }
  const snapshot = await engineWith(monitors, delta, same).syncProject('proj_x')
  expect(snapshot?.perChannel.filter((c) => c.channelId === 'C_CLIENT')).toHaveLength(1)
})
```

- [ ] **Step 4: Scope `listChannels` and chat authorization**

`DashboardListChannelsPayload` gains `projectId?: string`. In `dashboard.ipc.ts`, for `source: 'ours'`:

```ts
const connection = await deps.teamWorkspace?.getConnection()
if (!connection) return []
if (payload.projectId) {
  const projects = await deps.monitorStore.listProjects()
  const project = projects.find((p) => p.id === payload.projectId)
  if (!project) return []
  return resolveTeamChannels(project.teamChannels, connection.channels).map((c) => ({
    id: c.channelId,
    name: c.channelName
  }))
}
return listChannels(token) // Global Settings: every visible channel
```

In `chat-service.ts`, when `source === 'ours'`, load the project and reject a channel that is not in `resolveTeamChannels(project.teamChannels, connection.channels)`:

```ts
const allowed = resolveTeamChannels(project.teamChannels, connection.channels)
if (!allowed.some((c) => c.channelId === query.channelId)) {
  throw new Error('This channel is not enabled for this project in Global Settings.')
}
```

Apply the same check to `sendMessage`.

- [ ] **Step 5: Add the chat rejection test**

```ts
it('refuses Our Slack chat for a channel the project did not select', async () => {
  // existing fixture + a channel C_TEAM keeps working
  await expect(
    service.loadMessages({
      projectId: 'proj_x',
      source: 'ours',
      channelId: 'C_NOT_SELECTED',
      limit: 20
    })
  ).rejects.toThrow(/not enabled/i)
})
```

- [ ] **Step 6: Run tests**

Run:
```bash
npm test -- tests/unit/dashboard-two-source-sync.test.ts tests/unit/dashboard-chat-service.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/dashboard/sync-engine.ts src/main/dashboard/chat-service.ts src/main/ipc/dashboard.ipc.ts tests/unit/dashboard-two-source-sync.test.ts tests/unit/dashboard-chat-service.test.ts
git commit -m "feat(dashboard): scope team channels to each project"
```

---

### Task 4: Proper Global Settings → Our team Slack

**Files:**
- Rewrite: `src/renderer/src/components/dashboard/TeamSlackSettings.tsx`
- Create: `src/renderer/src/components/dashboard/team-channel-picker.ts`
- Modify: `src/renderer/src/components/dashboard/GlobalSettingsPanel.tsx`
- Modify: `src/renderer/src/assets/main.css`
- Test: `tests/unit/dashboard-team-channel-picker.test.ts`

**Interfaces:**
- Consumes: `getTeamWorkspace`, `listTeamWorkspaceCandidates`, `connectTeamWorkspace`, `setTeamWorkspaceChannels`, `clearTeamWorkspace`, `listChannels({ source: 'ours' })`
- Produces: curated team channels used by every project.

**Page behaviour (exact):**

1. **Connection card**
   - Connected: `Our Slack` heading, workspace name, `teamDomain` as `team.slack.com`, source label (`Connected account` / `Pasted token`), masked token, `Connected <relative>` and `Last checked <relative>`.
   - Actions: `Check connection`, `Reconnect`, `Disconnect` (confirm step in-place, not `window.confirm`).
   - Disconnected: two mutually exclusive choices — **Use an existing workspace** (dropdown of candidates, each `Team · Profile · source`; the current team workspace marked `· Our Slack`) and **Paste a token** (password field). One `Connect`.
2. **Channel curation**
   - Heading: `Channels projects can read`.
   - Explanation: "Projects choose from this list. Adding a channel here does not put it on every card."
   - Search input, `Select all` / `Clear`, count `N selected`.
   - Each row: `#name`, private/archived badge when the API reports it, checkbox.
   - `Save changes` enabled only when the selection differs; `Discard` restores the last saved set. A navigation/close attempt with unsaved changes asks in-place; no silent loss.
   - Empty: "This token cannot see any channels." Error: red inline message + `Retry`.
3. **No fabricated values**
   - While loading: skeleton/`Loading channels…`, never an empty list.
   - Disconnected: no channel list at all, only connect choices.
   - If the token is dead: show the Slack error and `Reconnect`; do not claim connected.

- [ ] **Step 1: Write the picker helper test**

```ts
import { describe, expect, it } from 'vitest'
import {
  diffChannelIds,
  matchesChannelQuery,
  toggleChannelId
} from '../../src/renderer/src/components/dashboard/team-channel-picker'

describe('team-channel-picker', () => {
  it('filters by name without case sensitivity', () => {
    expect(matchesChannelQuery('acme-website', 'ACME')).toBe(true)
    expect(matchesChannelQuery('acme-website', 'beta')).toBe(false)
  })

  it('toggles one id and keeps order', () => {
    expect(toggleChannelId(['a', 'b'], 'b')).toEqual(['a'])
    expect(toggleChannelId(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('diffs saved and draft selections in both directions', () => {
    expect(diffChannelIds(['a', 'b'], ['b', 'c'])).toEqual({
      added: ['c'],
      removed: ['a'],
      dirty: true
    })
    expect(diffChannelIds(['a'], ['a']).dirty).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/unit/dashboard-team-channel-picker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure helpers and the component**

`team-channel-picker.ts`:

```ts
export function matchesChannelQuery(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.trim().toLowerCase())
}

export function toggleChannelId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

export function diffChannelIds(
  saved: string[],
  draft: string[]
): { added: string[]; removed: string[]; dirty: boolean } {
  const savedSet = new Set(saved)
  const draftSet = new Set(draft)
  const added = draft.filter((id) => !savedSet.has(id))
  const removed = saved.filter((id) => !draftSet.has(id))
  return { added, removed, dirty: added.length > 0 || removed.length > 0 }
}
```

Component structure:
- `TeamSlackSettings` owns `workspace`, `candidates`, `available`, `savedIds`, `draftIds`, `query`, `busy`, `error`, `notice`, `confirmDisconnect`.
- Load `getTeamWorkspace()` and `listTeamWorkspaceCandidates()` on mount.
- Load `listChannels({ source: 'ours' })` only when connected, into `available`. Keep saved channel rows that are no longer visible as `unavailable` rows, so the user sees why a saved pin disappeared.
- Connect handlers:
  - OAuth candidate → `connectTeamWorkspace({ source:'oauth', profileId, teamId })`
  - manual candidate → `connectTeamWorkspace({ source:'manual', manualTokenKey })`
  - pasted token → `connectTeamWorkspace({ source:'manual', token })`
- Save handler sends `draftIds.map(id => availableById.get(id) ?? savedById.get(id))`, filters undefined, then sets both saved and draft from the response.
- Disconnect clears the draft too.

Use existing `ai-settings-*` styles plus new classes prefixed `team-slack-`. Add only tokens already defined in `:root`; no new colours/fonts.

To protect unsaved edits on close, `GlobalSettingsPanel` holds `teamDirty` and an in-place confirm bar:

```tsx
const [teamDirty, setTeamDirty] = useState(false)
const [confirmClose, setConfirmClose] = useState(false)

const requestClose = (): void => {
  if (teamDirty) setConfirmClose(true)
  else onClose()
}
```

`TeamSlackSettings` accepts `onDirtyChange?: (dirty: boolean) => void` and calls it whenever `diffChannelIds(savedIds, draftIds).dirty` changes. The confirm bar offers `Keep editing` and `Discard and close`; neither uses `window.confirm`.

```css
.team-slack-status {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-row);
  background: var(--surface);
  padding: 12px;
}
.team-slack-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.team-slack-search {
  width: 100%;
  margin: 8px 0;
}
.team-slack-channel-list {
  max-height: 320px;
  overflow-y: auto;
  scrollbar-width: thin;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-row);
}
.team-slack-channel-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-soft);
}
.team-slack-badge {
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 11px;
  padding: 2px 8px;
}
.team-slack-savebar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 0;
  background: var(--bg-panel);
  border-top: 1px solid var(--border-soft);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:
```bash
npm test -- tests/unit/dashboard-team-channel-picker.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 5: Live check**

Run `npm run dev`, open `Global settings`, and confirm:
- two saved connectors appear once each (OAuth + manual);
- the team workspace is marked;
- channel search, select all/clear, save and discard work;
- closing with unsaved changes warns;
- token is never visible.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/dashboard/TeamSlackSettings.tsx src/renderer/src/components/dashboard/team-channel-picker.ts src/renderer/src/assets/main.css tests/unit/dashboard-team-channel-picker.test.ts
git commit -m "feat(dashboard): make Our Slack settings a proper curated channel page"
```

---

### Task 5: New project wizard — reuse workspaces, pick team channels

**Files:**
- Modify: `src/renderer/src/components/dashboard/DashboardWizard.tsx`
- Modify: `src/renderer/src/hooks/dashboard-wizard-core.ts`
- Test: `tests/unit/dashboard-wizard-core.test.ts`

**Interfaces:**
- Consumes: `DashboardWorkspaceCandidate`, `DashboardTeamWorkspace`, `resolveTeamChannels`
- Produces: `buildClientWorkspaceOptions`, `validateProjectDraft`, `defaultTeamSelection`
- Produces: `DashboardProject.teamChannels` on create/edit.

**New 5-step flow:**

| Step | Label | Content |
|---|---|---|
| 1 | Workspace | Dropdown of reachable client workspaces, excluding `isTeamWorkspace`; each row `Team · profile · source`. `Connect a new workspace` expands the existing manifest + token guide. Selecting a candidate skips the token guide. |
| 2 | Client channels | Channels for the chosen client workspace. Existing behaviour, but the header says which workspace and whether it was reused. |
| 3 | Our channels | Global curated team channels. Radio: **Use the global set (N)** (default) or **Choose channels for this project** with checkboxes. If no team workspace: muted “Our Slack is not connected — this project will read only its client workspace.” and `Open Global settings`. |
| 4 | Project | Project name + client name. Prefilled from workspace/client. Inline validation. |
| 5 | Finish | Card created; first sync runs; summary of both sources. |

Editing an existing project starts at step 2, loads its current client workspace, and step 3 shows `Inherit` when `project.teamChannels === undefined`.

- [ ] **Step 1: Write the failing helper tests**

Add to `tests/unit/dashboard-wizard-core.test.ts`:

```ts
import {
  buildClientWorkspaceOptions,
  defaultTeamSelection,
  validateProjectDraft
} from '../../src/renderer/src/hooks/dashboard-wizard-core'

const candidate = (overrides = {}) => ({
  profileId: 'pf1',
  profileName: 'Work',
  teamId: 'T1',
  teamName: 'Acme',
  teamDomain: 'acme',
  scopes: [],
  source: 'oauth' as const,
  isTeamWorkspace: false,
  ...overrides
})

describe('wizard workspace helpers', () => {
  it('keeps one option per workspace and excludes Our Slack', () => {
    const options = buildClientWorkspaceOptions([
      candidate(),
      candidate({ profileId: 'pf2' }),
      candidate({ teamId: 'T_TEAM', isTeamWorkspace: true })
    ])
    expect(options).toHaveLength(1)
    expect(options[0].teamId).toBe('T1')
  })

  it('defaults a new project to the global set', () => {
    expect(defaultTeamSelection(undefined)).toBe('inherit')
    expect(defaultTeamSelection([])).toBe('custom')
    expect(defaultTeamSelection([{ channelId: 'C1', channelName: 'a' }])).toBe('custom')
  })

  it('blocks empty project and client names', () => {
    expect(
      validateProjectDraft({ name: '', clientName: 'Acme', teamId: 'T1', existing: [] })
    ).toEqual({ error: 'Project name is required.', warning: null })
    expect(
      validateProjectDraft({ name: 'Website', clientName: '', teamId: 'T1', existing: [] })
    ).toEqual({ error: 'Client name is required.', warning: null })
  })

  it('warns, but does not block, a duplicate name in another workspace', () => {
    const result = validateProjectDraft({
      name: 'Website',
      clientName: 'Acme',
      teamId: 'T2',
      existing: [{ id: 'p1', name: 'Website', teamId: 'T1' }]
    })
    expect(result.error).toBeNull()
    expect(result.warning).toMatch(/separate card/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/unit/dashboard-wizard-core.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement the helpers**

```ts
export type TeamSelectionMode = 'inherit' | 'custom'

export function buildClientWorkspaceOptions(
  candidates: DashboardWorkspaceCandidate[]
): DashboardWorkspaceCandidate[] {
  const byTeam = new Map<string, DashboardWorkspaceCandidate>()
  for (const candidate of candidates) {
    if (candidate.isTeamWorkspace) continue
    if (!byTeam.has(candidate.teamId)) byTeam.set(candidate.teamId, candidate)
  }
  return [...byTeam.values()]
}

export function defaultTeamSelection(
  selected: DashboardMonitor[] | undefined
): TeamSelectionMode {
  return selected === undefined ? 'inherit' : 'custom'
}

export interface ProjectDraftValidation {
  error: string | null
  warning: string | null
}

export function validateProjectDraft(input: {
  name: string
  clientName: string
  teamId: string
  existing: Array<{ id: string; name: string; teamId: string }>
  editingId?: string
}): ProjectDraftValidation {
  if (!input.name.trim()) return { error: 'Project name is required.', warning: null }
  if (!input.clientName.trim()) return { error: 'Client name is required.', warning: null }
  if (!input.teamId) return { error: 'Choose a client workspace first.', warning: null }
  const lower = input.name.trim().toLowerCase()
  const conflict = input.existing.find(
    (p) => p.id !== input.editingId && p.teamId === input.teamId && p.name.trim().toLowerCase() === lower
  )
  if (conflict) {
    return { error: 'This workspace already uses that project name. Pick a different name.', warning: null }
  }
  const elsewhere = input.existing.find(
    (p) => p.id !== input.editingId && p.teamId !== input.teamId && p.name.trim().toLowerCase() === lower
  )
  return {
    error: null,
    warning: elsewhere
      ? 'Another workspace already uses that project name — it will still be a separate card.'
      : null
  }
}
```

Only `error` disables the primary button. Render `warning` in muted text.

- [ ] **Step 4: Rewrite the wizard state and handlers**

Key changes to `DashboardWizard.tsx`:

- Load candidates once:
```ts
const [candidates, setCandidates] = useState<DashboardWorkspaceCandidate[]>([])
useEffect(() => {
  let alive = true
  window.api.dashboard.listTeamWorkspaceCandidates().then((list) => {
    if (alive) setCandidates(list)
  })
  return () => { alive = false }
}, [])
```

- Add `selectedWorkspace: DashboardWorkspaceCandidate | null`, `workspaceMode: 'existing' | 'new'`, `teamWorkspace`, `teamMode`, and `selectedTeamChannels`.
- For an existing project, seed `selectedWorkspace` from `target.project` so editing does not require re-picking:
```ts
const targetWorkspace: DashboardWorkspaceCandidate | null = target
  ? {
      profileId: target.project.profileId,
      profileName: 'Current workspace',
      teamId: target.project.teamId,
      teamName: target.project.teamName ?? target.project.teamId,
      teamDomain: '',
      scopes: [],
      source: target.project.tokenSource,
      manualTokenKey: target.project.manualTokenKey,
      isTeamWorkspace: false
    }
  : null
```
- Fetch `getTeamWorkspace()` once and keep it in `teamWorkspace`; step 3 uses its curated `channels`.
- When an existing candidate is selected:
```ts
setSavedKey(candidate.manualTokenKey ?? '')
setResult({
  valid: true,
  teamId: candidate.teamId,
  teamName: candidate.teamName,
  scopes: candidate.scopes
})
setProjectName((current) => current || candidate.teamName)
```
- `channelQuery` must use the candidate:
```ts
if (candidate.source === 'manual') {
  return { tokenSource: 'manual', manualTokenKey: candidate.manualTokenKey! }
}
return { tokenSource: 'oauth', profileId: candidate.profileId, teamId: candidate.teamId }
```
- `createCard` must persist the chosen source, not assume manual:
```ts
const workspace = selectedWorkspace
const noTeamWorkspace = teamWorkspace?.connected !== true
const isNew = !target
const project = {
  ...(target?.project ?? {}),
  id,
  name: projectName.trim(),
  clientName: clientName.trim(),
  profileId: workspace?.profileId ?? `manual:${savedKey}`,
  teamId: workspace?.teamId ?? result?.teamId ?? target?.project.teamId,
  teamName: workspace?.teamName ?? result?.teamName ?? target?.project.teamName,
  tokenSource: workspace?.source ?? 'manual',
  manualTokenKey:
    workspace?.source === 'manual'
      ? workspace.manualTokenKey
      : workspace
        ? undefined
        : savedKey,
  appId: 'slack',
  selfUserId: result?.userId ?? target?.project.selfUserId,
  monitors,
  teamChannels:
    isNew && noTeamWorkspace
      ? []
      : teamMode === 'inherit'
        ? undefined
        : selectedTeamChannels
}
```
- Never write `teamChannels: undefined` for a **new** project when no team workspace is connected; write `[]` so it does not silently start reading later. Editing an existing project leaves its value alone until the user changes the mode.
- Client workspace picker excludes the team workspace via `buildClientWorkspaceOptions`.
- Step 3 defaults to `defaultTeamSelection(target?.project.teamChannels)`. For new projects with a team workspace, `inherit`; for no team workspace, `custom` with `[]`.
- For an existing project, if the user changes nothing, preserve `target.project.teamChannels` rather than rewriting it.

- [ ] **Step 5: Run tests and typecheck**

Run:
```bash
npm test -- tests/unit/dashboard-wizard-core.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Live check**

- Create a project by picking an existing OAuth workspace → no token paste, channels load.
- Create a project by picking a saved manual connector → no token paste, channels load.
- Step 3 default is the global set; switch to custom, uncheck one, create.
- The new card's Our Slack lists only the selected team channel.
- A project with no team workspace opens with the “not connected” state and still creates.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/dashboard/DashboardWizard.tsx src/renderer/src/hooks/dashboard-wizard-core.ts tests/unit/dashboard-wizard-core.test.ts
git commit -m "feat(dashboard): reuse connected workspaces and pick team channels in the wizard"
```

---

### Task 6: Project settings + sidebar show the project's channels

**Files:**
- Modify: `src/renderer/src/components/dashboard/ProjectSettingsTab.tsx`
- Modify: `src/renderer/src/hooks/useSlackChannels.ts`
- Modify: `src/renderer/src/components/dashboard/ExpandedWorkspace.tsx`
- Test: `tests/unit/workspace-nav.test.ts` (add a focused case if the nav helper gates the team row)

**Interfaces:**
- Consumes: `DashboardProject.teamChannels`, `resolveTeamChannels`, `listChannels({ source:'ours', projectId })`
- Produces: project settings control and a project-scoped Our Slack list.

- [ ] **Step 1: Add the project-settings control**

In `ProjectSettingsTab.tsx`, add a section after client channels:

```
Our Slack channels
[ ] Use the global set (N channels)
[ ] Choose channels for this project
```

- If `project.teamChannels === undefined`, select “Use the global set”.
- If it is an array, select “Choose” and check its members.
- Global set list comes from `getTeamWorkspace()`; when disconnected show a muted row + `Open Global settings` (use the existing `onOpenSettings` callback if present; otherwise add one).
- Saving writes `teamChannels: undefined` or the checked array through `upsertProject`.
- Channels removed from Global Settings appear as disabled `#name — removed from Global Settings`; saving drops them.
- Do not display a count as 0 when the team workspace is not connected; show “Our Slack not connected”.

- [ ] **Step 2: Scope the hook**

`useSlackChannels.ts`:
```ts
const teamSelectionKey =
  source === 'ours'
    ? `${project?.id ?? 'none'}:${(project?.teamChannels ?? []).map((c) => c.channelId).join(',')}`
    : ''
const key = source === 'ours' ? `ours:${teamSelectionKey}` : (project?.id ?? null)
```
Pass `projectId` in the IPC payload:
```ts
.listChannels({ source, projectId: project?.id, tokenSource, profileId, teamId, manualTokenKey })
```
For `source === 'ours'` with no project, return empty rather than the global list (Global Settings uses its own call).

- [ ] **Step 3: Show the effective list in the workspace**

In `ExpandedWorkspace.tsx`, replace the one-shot `getTeamWorkspace()` with an initial fetch plus `onTeamWorkspaceChanged` subscription:

```ts
useEffect(() => {
  let alive = true
  void window.api.dashboard.getTeamWorkspace().then((workspace) => {
    if (alive) setTeamWorkspace(workspace)
  })
  const unsubscribe = window.api.dashboard.onTeamWorkspaceChanged((workspace) => {
    setTeamWorkspace(workspace)
  })
  return () => {
    alive = false
    unsubscribe()
  }
}, [])
```

Then derive:
```ts
const sameWorkspace = teamWorkspace?.connected === true && teamWorkspace.teamId === project.teamId
const teamChannels = useMemo(
  () => resolveTeamChannels(project.teamChannels, teamWorkspace?.channels ?? []),
  [project.teamChannels, teamWorkspace]
)
```
Use that for `buildConnectorChannelLists` instead of `teamWorkspace.channels`.
The channel names should come from the resolved curated objects, never from stale project copies.

When `sameWorkspace` is true, the card must show **one** workspace, per the original spec: pass `teamConnected: false` and `teamChannels: []` to `buildConnectorChannelLists`, so the Our Slack row is not duplicated; the client row already holds those channels. In Project Settings, show “Our Slack is the same workspace as this card — channels appear once.” and hide the team-channel inherit/custom control.

- [ ] **Step 4: Add a nav test if the row depends on a count**

If `buildConnectorChannelLists` is pure in `workspace-nav.ts`, add:
```ts
it('shows only the effective team channels for a project', () => {
  const lists = buildConnectorChannelLists({
    clientLoading: false,
    clientError: null,
    clientChannels: [],
    teamLoading: false,
    teamChannels: [{ id: 'C1', name: 'acme' }],
    teamConnected: true,
    watchedChannels: []
  })
  expect(lists.ours.map((c) => c.id)).toEqual(['C1'])
})
```
Use the actual helper signature; do not invent a second one.

- [ ] **Step 5: Run tests and typecheck**

Run:
```bash
npm test -- tests/unit/workspace-nav.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Live check**

- Project A and Project B select different team channels; their Our Slack rows differ.
- Global settings removes a channel; both cards update after the broadcast.
- A card with `teamChannels: []` shows “No team channels selected” rather than the global list.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/dashboard/ProjectSettingsTab.tsx src/renderer/src/hooks/useSlackChannels.ts src/renderer/src/components/dashboard/ExpandedWorkspace.tsx tests/unit/workspace-nav.test.ts
git commit -m "feat(dashboard): show each project its own team channel scope"
```

---

### Task 7: Documentation and end-to-end verification

**Files:**
- Modify: `docs/dashboard-ui.md`
- Modify: `GLOSSARY.md`
- Modify: `docs/superpowers/specs/2026-10-25-team-slack-and-global-settings-design.md` (mark the superseded decision)
- Modify: `docs/superpowers/plans/2026-10-25-our-slack-and-workspace-onboarding.md` (status)

- [ ] **Step 1: Update the glossary**

Add or revise:

| Term | Meaning |
|---|---|
| **Our Slack** | The one team workspace configured in Global Settings. Its curated channels are the pool every project may read from. |
| **Curated team channel** | A channel added to Our Slack in Global Settings. Projects can select it; adding it does not put it on every card. |
| **Project team channels** | The subset of curated team channels one project reads. Inherited from the global set by default; can be a custom subset or none. |
| **Client workspace** | The one Slack workspace a project is bound to. Never the same as Our Slack in the client picker. |

- [ ] **Step 2: Update `docs/dashboard-ui.md`**

- Global Settings → Our team Slack: connection card, candidate/token choice, searchable curation, save/discard, test connection.
- Wizard: 5-step flow and workspace reuse.
- Project settings: inherit/custom team channels.
- Sidebar: Our Slack lists the project's effective channels.
- Remove the claim that globally pinned channels are added to every card.

- [ ] **Step 3: Mark the spec decision superseded**

In the design spec's “Implementation Decisions” and “Out of Scope”, note that per-project channel selection now exists; per-project **workspace** selection remains out of scope.

- [ ] **Step 4: Run the full gates**

```bash
npm run typecheck
npm test
npm run build
```
Expected: typecheck clean, all tests pass, build clean. Record the exact counts.

- [ ] **Step 5: Manual acceptance checklist**

Run the app with two saved Slack connectors (one team, one client) and verify:

- [ ] Global settings lists both connectors once, marks the team one, and never shows a raw token.
- [ ] Connecting with a saved manual connector does not ask for the token again.
- [ ] Channel curation search, select all, clear, save, discard, and unsaved-close warning all work.
- [ ] Add a project: choose the existing client workspace, no token paste; channels load.
- [ ] Step 3 defaults to the global team set; a custom subset creates a card that lists only those channels.
- [ ] Two projects can select different team channels; neither sees the other's.
- [ ] A project with our Slack disconnected still creates and shows only its client workspace.
- [ ] Project settings can switch between inherit and custom; the sidebar updates immediately.
- [ ] Removing a curated channel in Global Settings removes it from inheriting projects.
- [ ] Refresh/relaunch: selections and curated set persist.
- [ ] No fabricated counts: disconnected states say “not connected”, not `0`.

- [ ] **Step 6: Commit**

```bash
git add docs/dashboard-ui.md GLOSSARY.md docs/superpowers/specs/2026-10-25-team-slack-and-global-settings-design.md docs/superpowers/plans/2026-10-25-our-slack-and-workspace-onboarding.md
git commit -m "docs(dashboard): document curated team channels and workspace reuse"
```

---

## Review Focus

These are the failure modes the plan's tests must pin, most likely first:

1. **Project A reads Project B's team channel.** The resolver plus engine tests in Task 3 are the gate; if `collectMessages` and `syncProject` do not share one resolved list, stored data leaks across cards.
2. **Unchecking a curated channel still leaves it on cards.** Explicit subsets are filtered against the curated set; Task 1's removed-channel case and Task 3's isolation case cover the two paths.
3. **A project inherits a channel set that changed without notice.** Inherit is `undefined`; after Global Settings saves, the IPC must broadcast a snapshot. Task 2 Step 6 pins this.
4. **The same token is pasted twice / a second secret copy is created.** Candidate reuse must read the existing vault key and store only a mask; Task 2 Steps 3 and 5 pin this.
5. **The team workspace appears as a client workspace.** `buildClientWorkspaceOptions` filters `isTeamWorkspace`; Task 5 pins this.

## Out of scope

- Choosing a different **team workspace** per project (only channel subsets are per project).
- More than one team workspace.
- An admin/role system for Global Settings.
- DMs/group DMs, Teams/WhatsApp sources, or agent-core work.
- Changing the compact card or the Recent strip.
- Automatic channel discovery for a project without the user selecting them.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-25-our-slack-and-workspace-onboarding.md`.

Before implementation, confirm the one open decision: **should each project choose its own subset of Our Slack channels (this plan), or should one global set stay on every card (current behaviour)?** If per-project is right, the plan is ready to execute in task order.
