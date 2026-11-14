# Platform Controller Page & Audit Logs Guide

## 1. Overview & Purpose

The **Platform Control Modal** (`PlatformControlModal.tsx`) serves as the administrative cockpit for every connected platform account in Cosmic (**Slack**, **Microsoft Teams**, and **WhatsApp Web**).

Accessible via the `⚙️ Control` button in the `PlatformThinBar` or the `Grant Write Permission` action in chat cards, the Control Modal gives operators complete sovereignty over:
1. **Channel Discovery & Access Grants**: Explicitly whitelisting channels for ingestion, agent write, and autonomous auto-reply.
2. **Scheduling & Trigger Timing**: Configuring automated background polling intervals.
3. **Engine Mode Switching**: Selecting between the ⚡ **Direct API Engine** (~150ms Zero-DOM) and the 🌐 **Browser DOM Engine**.
4. **Scraping Audit & Ingestion Logs**: Real-time inspection of scrape runs, per-channel message counts, latency metrics, and captured message snippets.
5. **Session Partition Sandbox**: Direct verification of the Electron session partition ID.

---

## 2. Modal Layout & Navigation

```
+-------------------------------------------------------------------------------------------------------+
| 👥 Teams Control · Personal                           [▶ Scrape Now] [✕ Close]                        |
|    Channel & chat discovery · Rapid ingestion scheduling · Detailed scraping logs                    |
+-------------------------------------------------------------------------------------------------------+
| CONTROL OPTIONS          | Teams Scraping & Sync Audit Logs                                           |
|                          | Detailed history of automated and manual sync executions for Teams.       |
| 📋 Channels & Chats (1)  |                                                                            |
| ⏱️ Schedules & Trigger    | Scrape run history (36) [All statuses ▼] [All triggers ▼] [⟳ Refresh] [■ Stop]|
| 🕸️ Scrape Logs           | [All Runs (36)]  [⚡ Direct API Runs (35)]  [🌐 Browser Scraper Runs (1)]     |
|                          |----------------------------------------------------------------------------|
| ACTIVE INGESTION ENGINE  | Run run-mwffrpet-xj0xg                                                     |
| (●) ⚡ Direct API Engine | Window: 6h · Channels: 1 · Read: 16 · New: 0 · Duration: 0.4s · Engine: ⚡  |
|     ~120ms rapid sync    |----------------------------------------------------------------------------|
| ( ) 🌐 Browser DOM Engine| CHANNELS (1)          | PEOPLE (1)        | MESSAGES · #unknown knp        |
|     Headless View        | 💬 unknown knp        | unknown knp · 16  | 1794581083.000000              |
|                          |    16 read · DM · read|                   | "19b anime name"               |
| SESSION PARTITION        |                       |                   |                                |
| persist:profile-...      |                       |                   |                                |
+-------------------------------------------------------------------------------------------------------+
```

---

## 3. Detailed Tab Walkthrough

### 3.1 Tab 1: Channels & Chats
- **Channel Discovery Grid**:
  - Surfaces all discovered channels, private groups, and DMs.
  - Displays channel metadata: name, public/private icon, kind (`channel`, `dm`, `group`), member count, and recent message count.
- **Granular Permission Toggles**:
  - **Enable / Listen Checkbox**: Toggles `enabled`. When disabled, the engine skips this channel during background sync.
  - **Agent Write Toggle**: Toggles `agentWrite`. Authorizes Cosmic to dispatch manual messages, slash command posts, and AI answers to this destination.
  - **Auto-Reply Toggle**: Toggles `autoReply`. Activates the autonomous incoming message response loop for this channel.
- **Bulk Actions**:
  - `Select All / Deselect All`: Quickly enable or disable listening across entire workspaces.
  - `Authorize All Write`: Fast-tracks write permissions across active channels.

### 3.2 Tab 2: Schedules & Trigger
- **Automated Polling Interval**:
  - Configures background cron frequency:
    - `0.33m (20 seconds)`: Rapid high-urgency polling.
    - `1m (60 seconds)`: Active sprint monitoring.
    - `5m (Default)`: Standard enterprise sync cadence.
    - `15m / 30m / 1h`: Low-traffic channels.
    - `24h`: Daily archival snapshots.
- **Background Sync Master Switch**:
  - Enable or pause scheduled background synchronization across the account without disabling individual channels.
- **Immediate Ingestion Trigger**:
  - Clicking the `▶ Scrape Now` button in the top right triggers an immediate out-of-band sync run, bypassing scheduled wait times.

### 3.3 Tab 3: Scrape Logs & Audit Trail
- **Scrape Run History List**:
  - Displays every historical sync execution with status chips (`Success`, `Partial`, `Failed`).
  - Identifies trigger source: `manual` (operator initiated) vs `scheduled` (timer initiated).
  - Displays engine badge: `⚡ Direct API` vs `🌐 Browser DOM`.
  - Shows execution duration (e.g. `0.4s`), channels polled count, and new messages captured (`+2`).
- **Filter Bar**:
  - Status filter: `All statuses`, `Success only`, `Failed only`.
  - Trigger filter: `All triggers`, `Scheduled only`, `Manual only`.
  - Engine tabs: `All Runs`, `⚡ Direct API Runs`, `🌐 Browser Scraper Runs`.
- **Selected Run Deep-Dive**:
  - **Window & Metrics Card**: Displays lookback window (e.g. `6h`), total channels polled, total messages read, new message deltas, duration, and active engine.
  - **Channels Column**: Lists every channel touched during the run with its individual read status (`16 read`, `0 read`, `skipped`).
  - **People Column**: Aggregates all active users who sent messages in the ingested window.
  - **Message Preview Pane**: Renders exact message snippets, sender names, and microsecond timestamps captured during the run.

---

## 4. Active Ingestion Engine Switching

Located directly in the left navigation panel:

1. **⚡ Direct API Engine (~120ms rapid sync)**:
   - High-throughput, Zero-DOM extraction.
   - Utilizes session tokens (Slack), IndexedDB replychain records (Teams), or internal store objects (WhatsApp).
   - Minimal CPU/GPU footprint; ideal for background polling every 20–60 seconds.
2. **🌐 Browser DOM Engine (Headless WebContentsView)**:
   - Real-DOM traversal and headless DOM rendering.
   - Navigates virtualized chat containers and parses rendered HTML elements.
   - Recommended if an enterprise SSO configuration restricts direct storage querying or during live debugging.

---

## 5. Embedded Navigation & Thin Bar Controls

Whenever a platform account is viewed in Cosmic, the `PlatformThinBar` (`PlatformThinBar.tsx`) sits atop the viewport:

- **Platform Badge & Subtitle**: Shows connection state (e.g. `Microsoft Teams · ashutoshknp12@gmail.com · Connected`).
- **Monitored Channel Count Badge**: Displays the count of active channels being synced (e.g. `1 Dash`).
- **`⚙️ Control` Button**: Opens the Platform Control Modal directly to configure channels or review audit logs.
- **`🔄 Re-authenticate` Button**: Triggers the profile login flow if session cookies expire or multi-factor authentication challenges appear.
- **`🌐 Live Embed` Button**: Found in the `AgentChatPanel` header, toggles between the autonomous agent chat workspace and the interactive live web view.
