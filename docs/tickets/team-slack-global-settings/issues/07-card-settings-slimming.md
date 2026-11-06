# 07: Card settings shows only what is genuinely per-card

**Parent:** docs/superpowers/specs/2026-10-25-team-slack-and-global-settings-design.md

**What to build:** A card's settings screen shrinks to the things that actually differ per client — name, client,
Watched Channels, the card's own token when it uses one, and the date/completion overrides — and shows everything
that became global as inherited values with an override switch beside each. The add/edit Wizard stops asking for
anything Global Settings already answers, so creating a new card is name, workspace, channels, confirm. The card's
own AI/token sections remain reachable for the real exception cases, and clearing an override returns the card to
inheriting.

**Blocked by:** 03 — Global sync, completion/date and AI-prompt defaults; 04 — Connect our team Slack and pin its
channels.

**Status:** ready-for-agent

- [ ] Every group that Global Settings owns appears in the card as its resolved value with an "Inherited from Global
      Settings" marker, not as an empty field the user feels obliged to fill.
- [ ] Flipping a card's override switch lets it diverge, and flipping it back clears the stored override so the card
      inherits again on the next read.
- [ ] The card's settings screen no longer contains a duplicate place to set the model, key, cadence, prompt
      defaults, or the team workspace.
- [ ] Creating a card through the Wizard takes strictly fewer steps than today, and the removed steps are exactly the
      ones now answered globally; existing cards are unaffected.
- [ ] Editing an existing card still lets its name, client, Watched Channels, dates and completion be changed.
- [ ] Tests cover the override → clear → inherit round trip for at least one non-AI group, and that a card with no
      overrides resolves to the global record.
- [ ] `pnpm typecheck`, `pnpm vitest run` and `pnpm build` pass; one card is shown inheriting, overriding and
      reverting, live, with screenshots.
