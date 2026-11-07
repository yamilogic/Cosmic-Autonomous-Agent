# ADR 0005: Renderer has zero access to Node, tokens, or filesystem

## Status

Accepted

## Context

Tokens and session data are high-value secrets. Giving the renderer Node access or raw `ipcRenderer` invites accidental leakage via XSS or careless logging.

## Decision

Every BrowserWindow/BrowserView uses `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. The renderer talks only through a typed `contextBridge` API. Tokens never cross that boundary; they stay in main-process `safeStorage`-backed storage.

## Consequences

- All privileged work lives in `src/main/`.
- IPC contracts are shared types; no ad-hoc channel strings in UI code.
- Logging must redact token-like values.
