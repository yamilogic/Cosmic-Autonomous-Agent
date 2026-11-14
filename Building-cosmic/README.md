# Cosmic — Autonomous Agent Workstation & Multi-Platform Client

**Cosmic** is a high-performance desktop workstation (Electron 44 + React 19) unifying communication, monitoring, and autonomous AI assistance across **Slack**, **Microsoft Teams**, and **WhatsApp Web**.

Every platform account operates under an isolated session partition (`persist:profile-<id>-<platform>`), ensuring enterprise credentials, cookies, and local message caches never leak across workspaces.

---

## Key Features & Capabilities

- **⚡ Dual Ingestion Engines**:
  - **Direct API Engine (~150ms Zero-DOM)**: Rapid message extraction without DOM overhead (Slack Web API, Teams IndexedDB `replychain`, WhatsApp `Store.Msg`).
  - **Browser DOM Engine**: Headless WebContentsView fallback with channel navigation and DOM traversal.
- **🤖 Autonomous AI Agent & RAG Grounding**:
  - Automatically loads the **15 most recent messages** from the conversation to ground generated replies.
  - Multi-persona dispatch (6 Personas: *Professional*, *Friendly & Warm*, *Direct & Concise*, *Empathetic*, *Technical & Detailed*, *Executive Summary*).
  - Autonomous 6-Tier Auto-Reply policies (*No Auto-Reply*, *Reply to All*, *Smart Needs-Reply*, *Task Only*, *Mention & DM Only*, *Draft Approval Mode*).
- **🎛️ Universal Platform Control Modal**:
  - Granular per-channel permission triad (`enabled`, `agentWrite`, `autoReply`).
  - Configurable polling intervals (20s / 0.33m up to 24h).
  - Live scrape run audit history with message previews and engine badges.
- **💬 Interactive Slash Commands & Composer Autocomplete**:
  - `/send @account #channel : <text>`: Verbatim direct dispatch.
  - `/ai-ans @account #channel [persona] : <query>`: Contextual AI response.
  - `/scrape`: Immediate background sync.
  - `/help` & `/help-slack`: Interactive cheatsheets.
  - Autocomplete for `@accounts` and `#channels`.
- **🛡️ Strict Session Isolation**:
  - Per-profile session partitioning (`persist:profile-<id>-<platform>`).
  - Offscreen view retention at `(-10000, -10000)` preserving native Chromium IME input and focus.
  - Token and credential redaction across all logs and IPC channels.

---

## Documentation Index

The following authoritative specifications and manuals live in [`docs/`](docs/):

1. 📖 [COSMIC_SYSTEM_SPECIFICATION.md](docs/COSMIC_SYSTEM_SPECIFICATION.md): Complete architecture, dual-engine scraping, RAG pipeline, message normalization, and slash commands.
2. 🛡️ [PERMISSIONS_AND_HIERARCHY.md](docs/PERMISSIONS_AND_HIERARCHY.md): Account hierarchy, permission flags (`enabled`, `agentWrite`, `autoReply`), 6 auto-reply policies, 6 personas, and controller suites.
3. 🎛️ [CONTROLLER_PAGE_GUIDE.md](docs/CONTROLLER_PAGE_GUIDE.md): Interactive manual for the Platform Control Modal, channel discovery, scheduling, audit logs, and engine switching.
4. 🏛️ [FINAL_COSMIC_DUAL_REPO_STABILIZATION_POLICY.md](FINAL_COSMIC_DUAL_REPO_STABILIZATION_POLICY.md): Dual-repo stabilization policy, zero-bloat invariants, and pre-push verification gates.
5. 📚 [GLOSSARY.md](GLOSSARY.md): Shared domain vocabulary and entity definitions.

---

## Quickstart & CLI Commands

Commands can be executed from the **repository root** or from inside **`Building-cosmic/`**:

```bash
# 1. Start Cosmic Desktop Application
npm run start:cosmic
# Or via launcher wrapper:
./launch-cosmic.sh

# 2. Run in Development Mode
npm run dev

# 3. Full TypeScript Typecheck
npm run typecheck

# 4. Run Verification Suite & Stabilization Boundary Check
npm run verify:boundary

# 5. Run Unit & Multiplatform Test Suite
npm test

# 6. Build Unpacked Application Binary
npm run build:unpack
```

---

## Project Directory Layout

```
Building-cosmic/
├── docs/                                          # Authoritative system specifications
│   ├── ARCHITECTURE.md                            # High-level architecture & boundaries
│   ├── CONTROLLER_PAGE_GUIDE.md                   # Platform Control Modal & audit logs guide
│   ├── COSMIC_SYSTEM_SPECIFICATION.md             # End-to-end system specification
│   └── PERMISSIONS_AND_HIERARCHY.md               # Permissions, 6 policies, 6 personas
├── GLOSSARY.md                                    # Domain vocabulary & shared definitions
├── FINAL_COSMIC_DUAL_REPO_STABILIZATION_POLICY.md # Dual-repo boundary & zero-bloat policy
├── package.json                                   # Application dependencies and scripts
├── electron-builder.yml                           # Electron packaging configuration
├── electron.vite.config.ts                        # Electron Vite build pipeline
├── launch-cosmic.sh                               # Linux standalone runtime launcher
├── scripts/
│   ├── verify-cosmic-boundary.mjs                 # Boundary enforcement & bloat checker
│   └── patch-electron-mac-identity.mjs            # macOS identity patcher
├── src/
│   ├── main/                                      # Electron Main Process (Node.js)
│   │   ├── dashboard/                             # SyncEngine, DeltaStore, ChatService, Actions
│   │   ├── platforms/                             # Modular suites (Slack, Teams, WhatsApp)
│   │   ├── profiles/                              # BrowserViewManager, Session Partitions
│   │   └── teams-reader/, whatsapp-reader/        # Specialized platform view drivers
│   ├── preload/                                   # Context-isolated IPC context bridge
│   ├── renderer/                                  # React 19 UI (AgentChatPanel, Modals, Views)
│   └── shared/                                    # Universal platform contracts & DTOs
└── tests/                                         # Comprehensive Vitest test suite
```

---

## Dual-Repo Synchronization Protocol

Cosmic is maintained across three synchronized GitHub remotes:
- **`origin`**: Primary development upstream (`yamilogic/Cosmic-Autonomous-Agent`).
- **`agentcoders`**: AgentWork feature branch upstream (`ashutosh1975272/Cosmic-AgentCoders`).
- **`final-cosmic`**: Clean, zero-bloat production release (`yamilogic/Final-Cosmic-Application`).

Before pushing any commit, ensure all 4 stabilization gates pass:
```bash
npm run typecheck
npm test
npm run verify:boundary
npm run build:unpack
```
