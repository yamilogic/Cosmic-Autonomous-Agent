# ADR 0006: Explicit first-login — Google then Slack in one session

## Status

Accepted

## Context

Admins need each profile’s embedded Slack UI to open already authenticated. That requires both Google identity cookies and Slack session cookies in the **same** Chromium partition. Signing into Slack alone (or only loading `app.slack.com`) made the intended “Google first, then Slack via Google SSO” path unclear.

## Decision

After `ProfileCreate`, open one `BrowserWindow` on `partitionForProfile(id)` / `profileSessionWebPreferences(id)` and run **two sequential steps** in that **same** window:

1. **Google account sign-in** — load Google sign-in; on success (e.g. `myaccount.google.com`), advance to `signing-in-slack`.
2. **Slack via Google OAuth (same window)** — load Slack’s get-started / sign-in page, auto-activate **Continue with Google**, which navigates to Slack’s Google OAuth consent on `accounts.google.com` **inside the same BrowserWindow** (no separate partition). After approval, Slack lands on `/client/T…` → set `signed-in` and close.

`setWindowOpenHandler` forces SSO/OAuth navigations into this window. The embedded `WebContentsView` uses the identical partition — one continuous session.

This is **not** Slack Web API OAuth (`oauth-flow.ts` / Connect).

## Consequences

- Status: `not-signed-in` → `signing-in-google` → `signing-in-slack` → `signed-in` (cancel → `not-signed-in`).
- Retry via “Sign in” when `not-signed-in`.
- See `docs/qa/first-login-continuous-session.md`.
