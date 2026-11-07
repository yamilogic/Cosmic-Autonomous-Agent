# ADR-0008: Ephemeral Observability & Granular Logging Engine

Decision: Implement a deep, memory-bounded ephemeral logging system with automatic 15-minute TTL expiration, strict token redaction, and an interactive real-time Logs Hub in Settings.

## Context
As Orbit Dashboards scaled to v2.0 with multi-profile session partitions, background Slack polling, and custom links, diagnosing runtime issues, IPC failures, and auth flows required end-to-end visibility.
However, storing permanent logs unbounded creates two risks:
1. Memory bloat and disk saturation over long runtimes.
2. Accumulation of sensitive session metadata and credential leakage.

The user required:
- Granular logging across all UI navigation, IPC calls, sync engine ticks, and error events.
- Automatic log expiration ("logs disappear after some min", default 15 minutes).
- Complete token and credential masking (`[REDACTED]`).
- Live log inspection directly from the Settings sidebar.

## Decision
- **In-Memory Ring Buffer with Ephemeral Sweeper**:
  - `src/main/logging.ts` maintains a ring buffer capped at 2,000 entries.
  - Ephemeral time-to-live (TTL) defaults to 15 minutes (`retentionMs = 900,000`).
  - An internal background sweeper runs every 30 seconds to prune stale records.
- **Deep Module IPC Bridge**:
  - `src/main/ipc/logs.ipc.ts` handles queries, retention changes, manual clears, and exports.
  - Broadcasts new entries in real time to all open windows via `LogsOnEntry`.
- **Preload & Renderer Integration**:
  - `src/preload/index.ts` exposes `window.api.logs` with safe, typed query and subscription methods.
  - `src/renderer/src/components/dashboard/LogsObservabilityTab.tsx` provides an interactive monitoring feed inside `UnifiedSettingsModal.tsx`.
- **Strict Security Redaction**:
  - Pre-write string and object scanners replace `xox*`, `nvapi-*`, Bearer headers, and password keys with `[REDACTED]`.

## Consequences
- High-resolution, zero-friction debugging for errors and user flows without memory leaks.
- Live entries automatically purge after 15 minutes, preserving user privacy.
- Complete auditability and clean one-click log exports for external reporting.

