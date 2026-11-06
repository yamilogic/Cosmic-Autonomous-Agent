# ADR 0003: OAuth in a short-lived window on the profile partition

## Status

Accepted

## Context

Connecting a Slack workspace needs a user OAuth flow. That flow should reuse Google/SSO cookies already present for the profile, and must not leave tokens accessible to the renderer.

## Decision

Run OAuth in a separate short-lived `BrowserWindow` that uses `persist:profile-<id>`. Capture the redirect, exchange the code in the main process, store the token with `safeStorage`, then close the window. The renderer only receives workspace metadata.

## Consequences

- SSO reuse works without scraping cookies.
- Always close the auth window in `finally`, including cancel/error paths.
- CSRF `state` must be verified on callback.
