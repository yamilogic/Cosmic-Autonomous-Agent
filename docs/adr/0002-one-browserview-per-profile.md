# ADR 0002: One embedded web view per profile, kept alive

## Status

Accepted

## Context

Switching profiles by reloading Slack is slow and loses in-page state. Users need near-instant switches between accounts.

## Decision

Create one embedded web view per profile (`WebContentsView` — Electron's successor to the deprecated `BrowserView`), keep it alive in memory, and switch by attaching/detaching via `contentView.addChildView` / `removeChildView`. Never reload on switch.

## Consequences

- Memory grows with the number of open profiles.
- Bounds must be reapplied on window resize for the active view.
- Profile deletion must destroy the view's webContents to avoid leaks.
