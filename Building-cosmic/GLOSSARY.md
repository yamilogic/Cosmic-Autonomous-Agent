# Cosmic Domain Glossary & Terminology

This document serves as the canonical domain vocabulary for Cosmic, aligning engineering terms across the codebase, UI labels, and specifications (following `/domain-modeling` and `/ask-matt`).

| Term | Category | Meaning |
|---|---|---|
| **Cosmic Workstation** | Core | The desktop application workspace running on Electron 44 and React 19. |
| **Platform Suite** | Architecture | A dedicated, modular platform adapter (`SlackPlatformSuite`, `TeamsPlatformSuite`, `WhatsAppPlatformSuite`) implementing `IPlatformBackendAdapter`. |
| **Platform Registry** | Architecture | Singleton `PlatformBackendRegistry` (`src/main/platforms/registry.ts`) mapping platform IDs (`'slack'`, `'teams'`, `'whatsapp'`) to their respective suites. |
| **Direct API Engine** | Ingestion | Ultra-low latency (~150ms), Zero-DOM background ingestion mode. Uses session cookies (Slack), client IndexedDB `replychain` records (Teams), or internal store objects (WhatsApp). |
| **Browser DOM Engine** | Ingestion | Headless WebContentsView fallback ingestion mode. Interacts directly with rendered DOM nodes, channel list selectors, and virtualized message rows. |
| **Delta Store** | Storage | Persistent JSON storage for synced messages under `~/.config/slack-dashboard/dashboard/chat/`. Operates locally with Zero-Cloud transmission. |
| **Delta Cursor** | Ingestion | High-water mark timestamp (`ts`) for a channel. The sync engine queries only messages newer than this cursor. |
| **Permission Triad** | Security | The three independent channel-level permission gates: `enabled` (listen/read), `agentWrite` (manual & AI dispatch), and `autoReply` (autonomous AI response). |
| **Auto-Reply Policy** | AI / Automation | The 6-tier heuristic rule governing when incoming messages trigger autonomous AI replies (`none`, `all`, `smart`, `task`, `mention_dm`, `draft`). |
| **AI Persona** | AI / Automation | The 6 conversational prompt tones applied during response generation: `Professional`, `Friendly & Warm`, `Direct & Concise`, `Empathetic`, `Technical & Detailed`, `Executive Summary`. |
| **RAG Grounding** | AI / Ingestion | Retrieval-Augmented Generation context window: automatically injects the **15 most recent messages** from the conversation into the prompt before generating answers. |
| **Platform Thin Bar** | UI Component | Top navigation header (`PlatformThinBar.tsx`) in embedded views featuring account title, status badge, channel counter, `⚙️ Control`, `🔄 Re-authenticate`, and view toggles. |
| **Platform Control Modal** | UI Component | Administrative modal (`PlatformControlModal.tsx`) providing channel selection, write/auto-reply authorization, polling intervals, engine selection, and live scrape logs. |
| **Scrape Run History** | Observability | Audit log recording every manual and scheduled sync execution, displaying latency, channel counts, trigger source, and captured message snippets. |
| **Offscreen View Retention** | Architecture | Keeping inactive `WebContentsView` instances attached to `mainWindow.contentView` at `(-10000, -10000)` so Chromium input events, IME, and scripts remain active. |
| **Session Partition** | Security | Strict Electron session sandbox (`persist:profile-<id>-<platform>` or `persist:card-<id>-<platform>`), guaranteeing zero credential or cookie leakage across accounts. |
| **Global Workspace** | Scoping | Enterprise or team account shared across all client projects (e.g. internal company Slack). |
| **Client Workspace** | Scoping | Project-specific account isolated to a particular client or customer engagement. |
| **Monitored Channel** | Scoping | An individual public channel, private group, or 1-on-1 direct message configured for active synchronization. |
| **Slash Command Engine** | Interaction | Interactive command parser supporting `/send`, `/ai-ans`, `/scrape`, `/help`, and dynamic `@`/`#` autocompletion. |
| **Token Redaction** | Security | Automatic sanitization layer replacing sensitive secrets (`xox*`, `nvapi-*`, passwords, session cookies) with `[REDACTED]`. |
| **Dual-Repo Stabilization Policy** | Governance | The boundary policy (`FINAL_COSMIC_DUAL_REPO_STABILIZATION_POLICY.md`) enforcing zero bloat, modular suites, and pre-push verification gates. |
