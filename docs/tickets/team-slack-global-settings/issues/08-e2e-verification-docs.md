# 08: End-to-end round verification and docs

**Parent:** docs/superpowers/specs/2026-10-25-team-slack-and-global-settings-design.md

**What to build:** The whole round is proven working together in the real Electron window and the written record
matches what shipped: both workspaces in a card's Projects section, a channel opened and answered from each, Global
Settings holding every shared value with cards inheriting and overriding, the sidebar looking right at expanded,
collapsed and narrow widths, and no secret reaching the window. `GLOSSARY.md` gains the new terms (team workspace,
pinned channel, Global Settings, role tag) and the spec is marked shipped, so the next phase starts from accurate
language instead of guesses.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07.

**Status:** ready-for-agent

- [ ] A scripted live pass drives the real window with real mouse events and records measured geometry: connect team
      Slack → pin channels → open a card → expand both workspaces → select a channel in each → post a message in each
      → collapse the rail and repeat through the Projects icon.
- [ ] Restarting the app restores the expanded workspaces and the last channel per card from persisted state.
- [ ] A secret audit confirms the window receives masks and names only: no raw token or API key appears in any
      renderer payload, stored nav state, or screenshot.
- [ ] `pnpm typecheck` clean, `pnpm vitest run` fully green, `pnpm build` succeeding, with any pre-existing lint
      failures reported separately rather than mixed into this round's result.
- [ ] `GLOSSARY.md` defines the new vocabulary, and the spec file records what actually shipped against what was
      planned, including anything deliberately dropped.
- [ ] Screenshots of every state above are captured and shown before the next phase starts.
