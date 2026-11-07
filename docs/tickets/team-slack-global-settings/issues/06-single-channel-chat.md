# 06: Single-channel chat view with a working composer

**Parent:** docs/superpowers/specs/2026-10-25-team-slack-and-global-settings-design.md

**What to build:** Selecting a channel in the Projects section opens that channel's conversation alone in the centre
panel: messages oldest-to-newest, each with author name, timestamp, and the text wrapped readably, with the channel
name and workspace shown at the top. A composer at the bottom posts to that channel — into the client workspace's
Watched Channel or into a pinned team channel — and the posted message appears in the list without a reload. Long
history loads in pages instead of all at once, and a failed load or a rejected post reports why in the panel rather
than showing an empty conversation.

**Blocked by:** 05 — The Slack section serves both workspaces from the centre panel.

**Status:** ready-for-agent

- [ ] The centre panel shows exactly one channel's messages, oldest first, with author, time and wrapped text; no
      other channel's messages appear.
- [ ] Authors resolve to display names via the existing user list, falling back to the raw id when a name is
      unavailable, and never to a guessed name.
- [ ] Scrolling reaches older history in pages; the initial paint is the most recent messages.
- [ ] The composer sends to the selected channel, shows a pending state, and appends the posted message with its
      real timestamp once accepted.
- [ ] Posting is refused with a clear reason when the channel is not one the card may write to, and a failed send
      keeps the draft text so the user can retry.
- [ ] Switching channels while a send is in flight does not deliver a message into the wrong channel.
- [ ] Empty history renders as an explicit "no messages yet" state; a token or API failure renders its reason and a
      retry, never a fake empty list.
- [ ] Raw tokens stay in the main process; the window receives messages, names and masks only.
- [ ] Tests at the browsing-service seam cover history ordering and paging, author resolution, send success and the
      send failure paths, using a stubbed Slack API.
- [ ] `pnpm typecheck`, `pnpm vitest run` and `pnpm build` pass; one message is posted live from a client channel and
      from a team channel, and both are shown with screenshots.
