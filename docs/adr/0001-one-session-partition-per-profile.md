# ADR 0001: One session partition per profile

## Status

Accepted

## Context

Multiple people (profiles) need to use Slack inside one desktop app. Google/SSO and Slack cookies must never cross between profiles.

## Decision

Every profile uses a dedicated Chromium session partition named `persist:profile-<id>`. The default session is never used for Slack BrowserViews or OAuth windows.

## Consequences

- Cookies, localStorage, and cache are isolated per profile.
- Profile deletion must clear that partition via `session.fromPartition(...).clearStorageData()`.
- OAuth must open on the same partition so existing SSO cookies apply.
