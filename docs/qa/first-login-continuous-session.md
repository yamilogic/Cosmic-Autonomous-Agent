# Manual QA: Google then Slack in one continuous session

## Goal

Adding a profile must complete **two steps in one Electron window / one partition**:

1. Sign in with **Google** (Google OAuth / account)
2. Still in that same window & `persist:profile-<id>` session, sign in to **Slack using Google SSO**
3. Then the embedded Slack view opens **already logged in** (no second prompt)

## Checklist

1. Quit Slack Dashboard completely.
2. `cd slack-dashboard && npm run dev`
3. **Add** profile named e.g. `Atul` (not an email address).
4. Popup title: **Step 1 of 2 — Sign in with Google** → complete Google login until My Account (or similar) loads.
5. Popup switches to **Step 2 of 2 — Sign in to Slack with Google** and loads `app.slack.com/client`.
6. Click Slack’s **Sign in with Google** (same Google account cookies — should not ask for password again if SSO works).
7. When workspace client loads (`/client/T…`), popup closes; badge shows **Signed in**.
8. Click the profile → embedded Slack shows the client **without** login screens.
9. **Fail** if embedded view asks for Google/Slack login again → partition mismatch bug.

## Automated guard

`tests/unit/shared-session-partition.test.ts` + profile session status transition tests.
