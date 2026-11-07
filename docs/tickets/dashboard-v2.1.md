# Dashboard v2.1 — Add-flow wizard + cleaner shell (spec + tickets)

Locked answers (grill session, all-yes): Q1 multi-token re-adds make independent
cards; Q2 no channels pre-checked; Q3 no avatars; Q4 hide embed while wizard
open; Q5 per-channel new counts in card footer; Q6 dates stay in the ✎ modal;
Q7 masked saved token + Replace-token overwrite.

## T1 — Wizard store (`useDashboardWizard`)
State machine: step 1↔2↔3 with gates (can't pass step1 without validated token,
step3 without selection if confirming). Holds: vaultKeyDraft, tokenDraft,
validation (team/user/counts/scopeWarnings), prefills (project=team name,
client=user name), channelSelection, editTargetProject. Pure transitions tested.

## T2 — Step 1 (Connect workspace)
Vault key + masked token + [Validate & Add] via `dashboard:validate-manual-token`;
on valid: save (addManualToken), show team/user/counts + missing-scope warning;
masked display `xoxp-1197…2813`; [Replace token] overwrites same key.

## T3 — Steps 2+3
Step 2: channel checkboxes from `dashboard:list-channels` (manual source),
counter, none pre-checked. Step 3: prefilled editable names + chips.
[Add] → `upsert-project` → `syncNow(project.id)` → close wizard.

## T4 — Wizard shell + entries
Numbered steps, back/next, embed hidden while open (showEmbed guard),
entries: dashboard header "＋ Set up new project" + empty state; ⚙ re-opens
wizard in edit mode prefilled from snapshot.

## T5 — Shell cleanup
Delete `app-topbar`; floating ⚙ top-right (tooltip Settings ⌘,). No sidebar
changes. Reclaimed vertical space flows to content.

## T6 — Card polish
Header: project · workspace(client chip) · channels count; colored mood pill;
last-updated chip; per-channel new counts in footer. Progress bar unchanged.

## T7 — QA + ship
typecheck both configs, eslint, vitest all green, restart, user validates card
vs Testing Workspace 1, commit v2.1.0.
