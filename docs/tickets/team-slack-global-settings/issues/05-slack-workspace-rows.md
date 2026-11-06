# 05: The Slack section serves both workspaces from the centre panel

**Parent:** docs/superpowers/specs/2026-10-25-team-slack-and-global-settings-design.md

**What to build:** The **Slack** section keeps exactly the two rows ticket 01 shipped — **Client Slack** and
**Our Slack** — and both now carry real content. Selecting a row moves the centre panel to that workspace: a channel
strip across the top lists the workspace's channels (all of them for the client's own workspace, the pinned ones only
for the team workspace), and the message list below it belongs to the channel picked in that strip. This is the point
where the mixed "all channels" feed is retired: one channel at a time, never a merged stream.

The sidebar deliberately does **not** grow a third level. Channels are centre-panel content, not nav rows, so the
panel stays two interactive levels deep (section → row), the rail keeps its six icons, and the Slack section's
remembered selection is the workspace row. The last channel chosen inside each workspace persists per card next to
that nav state.

**Blocked by:** 01 — Sidebar v5 to the design reference (done); 04 — Connect our team Slack and pin its channels.

**Status:** ready-for-agent

- [ ] Client Slack lists every channel of the workspace the card's Watched Channels belong to, named as Slack names
      them, with a real count and no invented channel.
- [ ] Our Slack lists only the channels pinned in Global Settings, and an empty or failed pin list shows an explicit
      state with a retry rather than a list that looks like "no channels".
- [ ] A workspace with no usable token shows its own state and a path to connect, never an empty feed.
- [ ] Choosing a channel changes only the message list; the sidebar's active row stays on that workspace and no nav
      level is added.
- [ ] Switching between Client Slack and Our Slack keeps each workspace's channel choice, so returning to a
      workspace restores where the user was.
- [ ] The mixed all-channels feed is gone from this view, and nothing else that used it regressed.
- [ ] Nav-model and channel-list tests cover: per-workspace channel memory, pinned-only filtering for the team
      workspace, the same-team case rendering one workspace honestly, and migration from the state shape that
      shipped today.
- [ ] `pnpm typecheck`, `pnpm vitest run` and `pnpm build` pass; both rows are exercised live with a real channel
      selected in each, with screenshots at expanded, collapsed and narrow widths.
