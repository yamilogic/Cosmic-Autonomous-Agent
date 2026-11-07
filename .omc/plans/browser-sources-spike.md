# Browser Sources Phase 0 Spike Findings

## Tested Date: 2026-10-26T12:50:52.846Z
Electron Version: 44.9.1
Chromium Version: 152.0.7977.167

## Platform Results Table

| Platform | URL Tested | Result | Session Persistence | Notes |
|---|---|---|---|---|
| **Slack Web** | `https://slack.com/signin` | **Supported** | Verified (`persist:bs-spike-slack`) | Loads signin without Electron header blocks. Stock Chrome UA avoids unsupported browser screen. |
| **Microsoft Teams Web** | `https://teams.microsoft.com/v2/` | **Supported** | Verified (`persist:bs-spike-teams`) | Redirects to MS login / v2 endpoint cleanly. No classic retirement block when `/v2/` is targeted. |
| **WhatsApp Web** | `https://web.whatsapp.com/` | **Supported (Read-only)** | Verified (`persist:bs-spike-whatsapp`) | Loads web container. Hard-limit policy: Strictly read-only to avoid phone number ban risks. |
| **Custom Link (Upwork)** | `https://www.upwork.com` | **Supported (View-only)** | Verified (`persist:bs-spike-custom`) | Loads embedded view cleanly in right pane without tab strip or URL chrome. |

## SSO & Popup Findings
1. **Google SSO**: Google blocks embedded WebViews if "Electron" appears in the User-Agent. Using stock Chrome / Brave UA ensures Google login pages permit sign-in without the "This browser or app may not be secure" error.
2. **Microsoft SSO**: Popups redirected in-place or opened via controlled auth windows work with MSAL `teams.microsoft.com/v2/authv2`.
3. **External Navigation**: Links pointing outside target domains will be caught by `setWindowOpenHandler` and dispatched to the user's default OS browser.

## Recommendations for Phase 1
- Proceed to **Phase 1: Embedded Views Shell**.
- Use partition naming pattern: `persist:bs-${platformId}`.
- Maintain strict domain allowlists in `setWindowOpenHandler`.
