# Slack Reader Skill Runbook

## 1. Overview
The **Slack Reader** is a passive, read-only automation engine designed to extract visible and historical message data from authenticated Slack workspaces without synthetic user actions, bot tokens, or intrusive script injection.

---

## 2. Execution Pipeline (`runSlackRead`)

```
1. Preflight
   ├── Check global kill switch
   ├── Check card pause status
   └── Verify session state: logged_in vs challenge / needs_login

2. Pick View
   ├── Check if workspace embed view is currently open and visible
   └── If visible & user idle (>30s) -> Use visible session view (adds border + control strip)
   └── Otherwise -> Use dedicated isolated reader view (same session partition)

3. Self-Check (Health check)
   ├── Validate DOM selectors: sidebar, message list, timestamps, senders
   └── If failed -> set status 'adapter_broken', pause, emit alert

4. Channel List & Filtering
   ├── Read channel list from sidebar DOM
   └── Filter to mapped channels only (+ unread only if enabled)

5. Channel Extraction (Loop per mapped channel)
   ├── Open deep link: /client/{workspaceId}/{channelId}
   ├── Wait for virtualized DOM settle (~2.5s)
   ├── Read visible messages
   ├── (Optional) Scroll history up to maxScrollScreens limit
   ├── Normalize & dedupe against local database
   └── Stream live events to control strip and run log store

6. User Interruption Handling
   └── If user inputs keystroke or moves cursor -> Transition to Amber ('waiting_for_user'), pause reader until idle

7. Run Finished
   └── Emit run_finished event, update Project snapshot and trigger insight engine if new messages > 0
```

---

## 3. Strict Safety Invariants (Never Violated)
- **Zero Synthetic Actions during Scraping**: No automated typing, clicking, sending, reacting, or editing.
- **Zero Credential Extraction**: Never extracts internal Slack tokens (`xoxc-*`), authentication cookies, or local storage.
- **Non-Invasive Visuals**: Border and control strips are Orbit app-level layers (`pointer-events: none`). No scripts or CSS are injected into Slack DOM.

