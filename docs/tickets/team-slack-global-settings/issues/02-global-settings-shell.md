# 02: Global Settings shell with the AI section inside

**Parent:** docs/superpowers/specs/2026-10-25-team-slack-and-global-settings-design.md

**What to build:** A **Global Settings** button sits beside **New project** in the dashboard toolbar and opens one
panel whose first section is the AI settings that today hide behind the toolbar's overflow menu. The user sets the
provider, the NVIDIA NIM model and the API key once, saves, and every card that has no override resolves through
them; a card that does override still wins, and the effective source (project / global / environment) is visible in
both places. The overflow-menu route to AI settings is gone, so there is exactly one way in.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] The button is in the toolbar action group next to **New project**, uses the existing button styling, and opens
      the panel from anywhere on the dashboard.
- [x] The panel's AI section edits the same global record the old menu item did — no new copy of the values, and
      nothing stored in the window.
- [x] The API key field shows the stored mask, accepts a new value, and never sends the raw key to the renderer;
      length and provider validation reject bad input with a readable message.
- [x] The model list still loads from the configured key, and an unconfigured key produces the existing
      "no key configured" state rather than a silent empty list.
- [x] A card's AI section shows "Inherited from Global Settings" when it has no override, and its existing override
      switch keeps working unchanged.
- [x] Service-level tests at the global settings seam cover: inheritance order per field, override wins, mask-only
      public view, and validation limits.
- [x] `pnpm typecheck`, `pnpm vitest run` and `pnpm build` pass; the panel is opened and saved live in the Electron
      window and shown with a screenshot.

## Evidence (2026-10-25)

- **One way in.** `dash-head-actions` now reads `Compact · Expanded · Mixed · ⋯ · Global settings · New project`
  (the unused `.btn-secondary` skin, so no new CSS), and the `⋯` menu is down to `Sync all now · Collapse all ·
  Expand all` — measured live, `AiSettingsPanel.tsx` deleted, `GlobalSettingsPanel.tsx` is the only dashboard-level
  settings modal.
- **Same record, no copy.** The panel's AI section mounts the existing `AiSettingsForm` with no `projectId`, so it
  reads and writes `ai-settings.json`'s `global` entry through the same three IPC channels. A save round-trip in the
  live app left the stored record byte-identical (`{provider:'nvidia-nim', model:null, hasKey:false}` before and
  after) and reported `Saved`.
- **Fixed while wiring it: the global form was reading the wrong scope.** It seeded `model` from
  `view.project?.model`, which is always null at global scope, so opening Global settings and pressing Save wrote
  `model: null` and wiped a stored global model. It now seeds from the scope it is editing. Proven by round-trip:
  store `nvidia/nemotron-3.5-super-vl-120b-a12b` globally → the panel's Model select reopens with that value
  (option present, `value` matches) → restore to `null`, which is the state the user's config is actually in.
- **Source indicator on the card.** With the override switch off (the default), the card's AI section renders
  `Inheriting from Global settings nvidia/… · environment key ••••cUJM`, and `No override nvidia/… (environment
  default) · …` when Global settings holds nothing — the wording follows the resolved source instead of claiming
  inheritance that is not there. Its three fields measure `disabled: [true, true, true]` while inheriting, and the
  existing toggle is untouched.
- **Validation** already lived in `AiSettingsService.save` (provider, 512-char key, 200-char model) and is now
  covered by four new tests in `tests/unit/ai-settings.test.ts`: the global seam writes only the global record,
  rejects an unsupported provider, rejects over-long key/model and accepts the 512 boundary, and answers with masks
  only. `vitest run` → 24 files / **213** tests (was 209), typecheck and build clean.
- **Label case.** Promoting this form to the app's primary settings surface put its tracked-capital field labels
  (`Provider`, `Model`, `API key` and the box head, all rendered as caps) next to sentence-case everything else, so
  the uppercase transform and the tracking are gone and the head reads `Effective now` — measured
  `text-transform: none` at 12px/600 on all four.
- Screenshots: `v7-01` panel open, `v7-02` after the live save, `v7-03` the trimmed `⋯` menu, `v7-04` the card on
  the environment-default line, `v7-05` the panel reloading a stored global model, `v7-06` the card inheriting it,
  `v7-07`/`v7-08` both surfaces after the label pass.
- Docs updated in the same commit: `docs/dashboard-ui.md` (§2 header table + ASCII, §4.4.1's card AI row and the
  Global-settings paragraph, §7 component map, §8 surface list) and `GLOSSARY.md` (**Global Settings**, **Inheritance**).
- Not in this ticket: the remaining sections (sync, dates, prompt defaults in ticket 03; the team Slack connection
  in ticket 04) and the card-settings slimming in ticket 07.
