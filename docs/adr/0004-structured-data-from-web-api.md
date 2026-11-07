# ADR 0004: Structured data from Slack Web API only

## Status

Accepted

## Context

The embedded Slack UI is useful for humans, but scraping its DOM for channels/messages is brittle and against Slack's intended integration path.

## Decision

All structured data (channel lists, history, team info) comes from the Slack Web API via a typed main-process client. The BrowserView is UX-only.

## Consequences

- Requires a registered Slack app and user-token OAuth scopes.
- DOM CSS injection (e.g. hiding DMs) is cosmetic only and never a data source.
- Rate limiting and pagination live in one API client module.
