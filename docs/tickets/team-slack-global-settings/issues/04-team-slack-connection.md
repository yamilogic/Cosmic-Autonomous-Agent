# 04: Connect our team Slack and pin its channels

**Parent:** docs/superpowers/specs/2026-10-25-team-slack-and-global-settings-design.md

**What to build:** An **Our team Slack** section in Global Settings where the user connects their own workspace
once — either by picking a workspace an existing Google/Slack profile already reached, or by pasting an xoxp token —
and then pins the one, two or three channels that carry internal project discussion. The connection is stored
globally (name, team id, source, pinned channels, with the secret in the existing encrypted vault under a reserved
non-project owner), and the panel shows what is connected: workspace name, channel count, and a masked token when
the source is manual. Reconnecting replaces the old team record instead of accumulating duplicates.

**Blocked by:** 02 — Global Settings shell with the AI section inside.

**Status:** ready-for-agent

- [ ] The section lists every workspace the app can already reach (per-profile OAuth tokens plus manual-vault
      metadata), deduped by team id, and labels which one is currently set as the team workspace.
- [ ] Choosing one stores it as the team workspace; the card's own bound workspace is never overwritten and stays
      the client workspace.
- [ ] A pasted manual token is validated against the team before it is stored, is saved in the existing encrypted
      vault under a reserved team owner id, and only its mask leaves the main process.
- [ ] Pinning channels lists that workspace's channels, lets the user keep a chosen subset, shows the pinned count,
      and lets them re-pin without reconnecting.
- [ ] If the team workspace is the same team as a card's own workspace, the app records that and the card shows one
      workspace only (ticket 05 renders it; the data must not claim two).
- [ ] Clearing the connection removes the pinned channels and the vault entry with it.
- [ ] Tests at the browsing-service seam cover workspace dedupe and the pinned-set filtering with a stubbed Slack
      API; store tests cover save, replace, clear and mask-only views.
- [ ] `pnpm typecheck`, `pnpm vitest run` and `pnpm build` pass; connecting and pinning is done live in the Electron
      window and shown with screenshots.
