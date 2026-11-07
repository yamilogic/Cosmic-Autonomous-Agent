# Team Slack + Global Settings — design spec

Date: 2026-10-25 · Branch: `beta` · Status: approved, ticket 01 shipped
Supersedes nothing; extends `2026-10-25-single-sidebar-workspace-design.md`. That document's v4.1 layout (static
section labels, dropdown only inside Project Info) was **replaced by v5** on explicit request: every section is now
an interactive dropdown, and the Projects section is named **Slack** again because its two rows name the two
workspaces. Vocabulary follows `GLOSSARY.md` (Project, Watched Channel, Monitor, Sync Engine, Token Source,
Snapshot, Wizard).

## Problem Statement

Every Project card is bound to exactly one Slack workspace — the client's. But the user's own team workspace
(where their team talks, and where 1–3 project channels live) is a second, equally important source, and there is
no way to see it from a card. On top of that, the same few things have to be typed into every card: the NVIDIA NIM
model and API key, the sync expectations, the completion and date rules. The user re-does identical setup per card.

The sidebar that now carries all of this was rebuilt to the v5 reference (Dashboard / Xomni / Slack / Project info /
Visualizations, each an interactive dropdown, Settings pinned in the footer). The structure is right; what is still
missing is content: the **Slack** section's **Our Slack** row has no workspace to read, because a team workspace can
only ever be the client's, and the row's centre view dumps every Watched Channel into one mixed feed instead of
letting the user work one channel at a time.

## Solution

1. **The Slack section gets its second row filled.** The section keeps exactly two rows — **Client Slack** (the
   Project's own bound workspace) and **Our Slack** (configured once, globally). A row selects a *workspace*, never a
   channel, so the sidebar stays at two interactive levels; the workspace's channel strip lives in the centre panel,
   where the client row already puts it. The client workspace lists all of its channels, the team workspace lists
   only the channels pinned in Global Settings, and selecting a channel shows that channel's chat, formatted, with a
   working composer. With no team workspace connected, **Our Slack** shows a "Connect workspace" empty state that
   points at Global Settings instead of inventing a list.
2. **A Global Settings panel** opens from a button beside **New project** on the dashboard. It holds everything that
   is common to all cards: our team Slack connection + pinned channels, the AI provider/model/API key, the sync and
   refresh defaults, and the completion/date and AI-prompt defaults. Cards inherit from it and override only what is
   genuinely per-card.
3. **The v5 visual pass** (ticket 01, shipped): the sidebar sits one surface step below the centre behind a single
   1px divider, rows are 32px (children 30px) on one icon/label/count grid with no borders, the active row is a soft
   fill plus a 3x14px accent marker, section labels are 12px muted sentence case, and the centre opens with a small
   muted project-name label above a 22px heading at a ~860px measure.

## User Stories

1. As a freelancer, I want my own team's Slack visible inside every project card, so that I can read what my team
   said about the client without leaving the card.
2. As a freelancer, I want to connect my team's Slack exactly once, so that every card already knows where internal
   discussion happens.
3. As a freelancer, I want to pin only the 1–3 team channels that matter, so that the card does not fill with
   unrelated internal noise.
4. As a freelancer, I want the client's workspace and my team's workspace to be two clearly labelled buttons, so
   that I never confuse who said what.
5. As a freelancer, I want to click a channel and see only that channel's messages, so that a conversation reads
   top-to-bottom instead of as a merged feed.
6. As a freelancer, I want to reply from that channel view, so that answering does not need the embedded Slack app.
7. As a freelancer, I want my team's channel list to appear automatically once the token is connected, so that I do
   not maintain it by hand.
8. As a user with one workspace only, I want **Our Slack** to say "Connect workspace" instead of a channel list, so
   that the UI never invents a fake "our team" feed.
9. As a user, I want a "Global Settings" button next to "New project", so that shared setup lives in one obvious
   place.
10. As a user, I want to set the NVIDIA NIM model and API key once there, so that new cards work without any AI
    setup.
11. As a user, I want a card to show that its AI settings are inherited, with an explicit override switch, so that I
    can trust the default and still deviate when a client needs another model.
12. As a user, I want the sync cadence and refresh defaults set globally, so that every card polls the way I want
    without per-card configuration.
13. As a user, I want the completion and date rules and the AI prompt defaults set globally, so that digests and
    insights read the same across cards.
14. As a user, I want the per-card settings tab to keep only what is truly per-card (name, client, watched channels,
    date/completion overrides), so that the card screens stay short.
15. As a user, I want the sidebar's section names, buttons, counts and chevrons aligned on one grid, so that the
    panel looks made rather than generated.
16. As a user, I want hover, active, focus and disabled states to be visibly different on every sidebar control, so
    that I can navigate by keyboard and know what is clickable.
17. As a user, I want the "Schedules" placeholder to look inert, so that I do not click a button that does nothing.
18. As a user, I want the sidebar to stay minimisable and width-adjustable through all of this, so that a narrow
    window still gives me the full centre panel.
19. As a user, I want my sidebar selection and open/closed state remembered per card, so that reopening a card
    returns me to where I was.
20. As a security-conscious user, I want raw tokens and API keys to stay in the main process and only masked values
    to reach the window, so that adding these surfaces does not widen the secret exposure.
21. As a developer, I want the workspace/channel browsing rules to be pure and unit-tested, so that the list and
    selection behaviour is verified without launching Electron.
22. As a developer, I want each step to be demoable on its own, so that I can ship and show one ticket at a time.

## Implementation Decisions

**Two workspaces, one rule unchanged.** The card keeps its single bound workspace (its `teamId` / `teamName`
stamp, the one-card-one-workspace guard in the monitor store). That workspace is labelled **Client Slack**. The
**Our Slack** workspace is a new global record. If a card's `teamId` equals the team `teamId`, the team row shows
that it is the same workspace rather than presenting it as a second source.

**Global settings store grows, no second secret path.** The global settings store that already holds AI settings
(provider, model, safeStorage-encrypted key) gains a `team` section: token source (`oauth` | `manual`), team id,
team name, a reference into the existing encrypted token vault, and `pinnedChannels[]` of `{channelId, channelName}`.
Manual team tokens reuse the existing vault mechanism with a reserved owner id instead of a Project id, so there is
still exactly one encrypted secret store. Renderer payloads carry masks and names only.

**One new main-process browsing module.** A single module owns "browse Slack" and grows one IPC per ticket rather
than a separate horizontal service ticket:
- `workspaces` — every connected workspace across OAuth token store (per profile) and the manual vault, deduped by
  team id, each with `teamId`, `teamName`, `source`, `hasToken`.
- `channels` — paginated `conversations.list` for one workspace; when that workspace is the team one, the result is
  filtered to the pinned set.
- `history` — `conversations.history` for one channel, newest-last, with a `users.list` name cache for authors.
- `send` — `chat.postMessage` into one channel; the client workspace keeps Watched Channels authoritative for
  posting, and the team workspace may post to any pinned channel.
Existing per-profile/per-channel IPCs stay as they are; the new ones are additive.

**Nav model: v5, two interactive levels, and they stay two.** Every section header and every Project Info sub-group
opens and closes on click (chevron rotates −90deg closed); a section or sub-group that owns the active body but is
closed carries the accent marker itself, so the sidebar never looks selection-less. Selection vocabulary is
`v:` visual, `d:` detail, `g:` guide section, `m:` Xomni mode and `s:` slack source (`client` | `team`), with one
active row across the whole panel and a remembered selection per section for the collapsed rail. The team workspace
adds **no** nav level: channel picking happens in the centre panel's channel strip, and the new `s:team` row is
persisted by the same per-project key with the migration path the model already uses, so older blobs keep loading.

**Global Settings panel.** One modal, opened from a new toolbar button beside **New project**. Sections: Our team
Slack (connect + pin channels), AI (moved out of the overflow menu's "AI settings" item), Sync & refresh,
Completion & dates, AI prompt defaults. Saving any of them writes the global record; cards resolve
project-override → global → environment defaults, exactly the order the AI settings already use, and the same
`useGlobal`-style switch is reused for the other groups.

**Per-card slimming.** The card's settings tab keeps Project name, client, Watched Channels, date and completion
overrides, and its own token section only when the card genuinely uses a different token. Everything that became
global renders as "Inherited from Global Settings" with the override switch beside it.

**Sidebar geometry is settled (ticket 01).** 236px default, drag-resizable 180–400px with double-click reset,
collapsible to a 56px icon rail that also takes over automatically below a 720px card via a container query. The rail
shows six icons — Dashboard, Xomni, Slack, Project info, Visualizations, Settings — each with a tooltip and an
accessible name, each restoring its section's last selection. Colours and fonts come only from the `:root` token
blocks; the sidebar/centre surface pair and the hover/selected fills are named tokens. Later tickets add rows and
centre bodies inside this geometry and do not restyle it.

**Team channels are browsed, not synced, in this round.** The Sync Engine keeps polling Watched Channels only;
reading and posting to team channels does not feed insight, digest or mood.

## Testing Decisions

- **Good test = behaviour, not wiring.** Pure functions and services with injected fakes; nothing asserts on React
  internals or CSS.
- **Seam 1 — the nav model** (already the pure, DOM-free module behind the sidebar): workspace expansion,
  channel selection, per-workspace memory, and the persisted-state migration. Prior art: the existing nav model
  test file.
- **Seam 2 — the global settings service** with a fake store: inheritance order, per-field override, mask-only
  public view, validation limits. Prior art: the existing AI settings service test.
- **Seam 3 — the Slack browsing service** with a fake `fetch`: workspace dedupe by team id, pinned-channel
  filtering, history ordering, send error paths. Prior art: the chat-service and OAuth-flow tests, which already
  stub network at the same boundary.
- **UI is verified live**, not in a DOM test framework: the Electron window driven over CDP with real mouse events,
  measured geometry, and screenshots — the convention used for every sidebar phase so far.
- Gates per ticket: typecheck, the single test file, then the full suite and a build once at the end of the round.

## Out of Scope

- Direct messages and group DMs of any workspace.
- Choosing a different team workspace per card, or more than one team workspace.
- Syncing, digesting or scoring team channels (browsing and posting only).
- Slack Teams/WhatsApp sources, AgentWork MCP bridging, and Schedules — the disabled placeholder stays.
- Any change to the primary application sidebar, and any third nav level inside the card.
- Migrating the existing per-card wizard flow to a different shape; it keeps working.

## Further Notes

- Shipped and buildable on: the v5 sidebar (dropdown sections, grouped Project Info that starts closed, per-project
  persistence with a three-generation migration, the 56px rail, the surface-step styling). Design reference:
  `orbit_card_sidebar_redesign.html` at the repo root.
- Tickets: `docs/tickets/team-slack-global-settings/issues/`, numbered in dependency order.
- The tracker for the Matt Pocock skills is not configured in this repo yet (`docs/agents/issue-tracker.md` is
  absent); tickets are therefore local files, one per ticket, with blocking edges written as text.
