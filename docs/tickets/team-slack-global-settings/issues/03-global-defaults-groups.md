# 03: Global sync, completion/date and AI-prompt defaults

**Parent:** docs/superpowers/specs/2026-10-25-team-slack-and-global-settings-design.md

**What to build:** Three more sections appear in Global Settings — **Sync & refresh**, **Completion &
dates**, and **AI prompt defaults** — so the settings that are identical for every client stop being per-card work.
The sync cadence the scheduler already reads from persisted config (and the stale-data threshold that today is fixed
behaviour) become global values the Sync Engine and the card labels read; the completion and date rules and the
wording the insight/digest prompts use get global defaults. Each group follows the inheritance shape the AI section
already established: cards resolve global first, carry an explicit override switch, and show which source is in
effect.

**Blocked by:** 02 — Global Settings shell with the AI section inside.

**Status:** ready-for-agent

- [ ] Changing the global sync cadence changes how often the Sync Engine polls every Monitor, without restarting the
      app, and the dashboard's "Synced …/Every …" line reflects the new value.
- [ ] A manual sync still forces a poll regardless of the cadence.
- [ ] Completion and date rules set globally apply to cards with no override; a card's own manual dates or
      completion still win over the global rule, exactly as they win over extraction today.
- [ ] AI prompt defaults (persona wording, digest tone, completion guidance) reach the insight and digest
      generation for cards without an override.
- [ ] Every group has a per-card override switch with a visible source indicator, and turning it off restores
      inheritance immediately.
- [ ] The per-card settings screen no longer forces the user to re-enter any value that is now global.
- [ ] Service tests cover the resolution order for each new group (global → override → fallback) and the mask-free
      payloads stay mask-free.
- [ ] `pnpm typecheck`, `pnpm vitest run` and `pnpm build` pass; one card is shown inheriting and then overriding,
      live, with screenshots.
