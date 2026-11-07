# Dashboard Redesign Plan

## Header
- Left title "Client projects" + muted meta line.
- Right: segmented view mode (Compact/Expanded/Mixed), Sync all, Settings, New project.
- Remove "..." menu; collapse/expand all gone.
- Sync all shows "Syncing 2/5", disabled; single muted error line; Paused hint if schedule paused.

## Sections
- Recent: horizontal strip top ~6, mini-cards, scroll-snap, edge fade; click scrolls+flashes card.
- Pinned: only if >=1 pinned; manual order; pinnedOrder persisted in main store.
- Projects: unpinned; filter chips All/Urgent/Inactive with counts; sort by importance; filter in localStorage.

## Pin & reorder
- Pin toggle in card headers.
- Pinned drag reorder via HTML5 DnD (no lib), keyboard Alt+Up/Down, move up/down menu.
- Persist pinnedOrder; clean deleted/unknown.

## Compact card ~1.5x, dense but clean.
## Expanded card: Sync primary, pin toggle; nav persistence only section/sidebar/collapsed.
## Schedules: per-project pause/run now; contract per-project pause.
## Cleanup: lint errors (26), GPU disable env, Playwright smoke, chrome-cookie-probe import.

## Look: one accent, fewer borders, consistent tokens, empty states muted line.
