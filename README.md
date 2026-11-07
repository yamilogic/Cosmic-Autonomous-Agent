# Orbit

**Orbit** is a multi-profile desktop app (Electron) for **Slack**, **Microsoft Teams**, and **WhatsApp**. Each profile has its own isolated browser session, so accounts do not mix.

| | |
| --- | --- |
| Product name | **Orbit** |
| Bundle id | `com.orbit.app` |
| Repo / data folder | `slack-dashboard` |
| Who sets it up | **Admin only** (credentials in `.env`, no database) |

---

## Contents

1. [What you get](#1-what-you-get)
2. [Requirements](#2-requirements)
3. [Admin credentials](#3-admin-credentials)
4. [Set up from source (admin)](#4-set-up-from-source-admin)
5. [First login and daily use](#5-first-login-and-daily-use)
6. [Optional: Slack OAuth](#6-optional-slack-oauth)
7. [Build installers](#7-build-installers)
8. [Share a build with another machine](#8-share-a-build-with-another-machine)
9. [Data on disk](#9-data-on-disk)
10. [Notifications (macOS)](#10-notifications-macos)
11. [Production Apple signing (optional)](#11-production-apple-signing-optional)
12. [Scripts reference](#12-scripts-reference)
13. [Project layout](#13-project-layout)
14. [Troubleshooting](#14-troubleshooting)
15. [Install as a desktop app](#15-install-as-a-desktop-app) ← last: how to put Orbit on a machine
16. [License / fonts](#16-license--fonts)

---

## 1. What you get

- Multiple profiles (e.g. personal / work)
- Isolated Slack / Teams / WhatsApp sessions per profile
- Google sign-in via a real Chrome window (cookie import into the embed)
- Admin login gate (from `.env`)
- Tray icon, Dock badge, toasts / alerts
- Packaged apps for **macOS**, **Windows**, and **Linux**

---

## 2. Requirements

| Need | Details |
| --- | --- |
| Node.js | **20+** (LTS) and **npm** — for develop / build from source |
| Google Chrome (macOS) | `/Applications/Google Chrome.app` for Google docking |
| Build machine | Same OS/arch as the target (Mac for `.app`/DMG, Linux for deb/AppImage, Windows for setup.exe) |

---

## 3. Admin credentials

Orbit has **no database**. Only the admin unlocks the app using values from `.env`.

| Field | Env key | Default |
| --- | --- | --- |
| Username | `ADMIN_USERNAME` | `admin` |
| Password | `ADMIN_PASSWORD` | `changeme` |

Optional: `ADMIN_EMAIL` instead of `ADMIN_USERNAME`.

**Change the password before any real deployment.** Anyone with these values can open Orbit and manage all profiles.

Changing `ADMIN_USERNAME` or `ADMIN_PASSWORD` later clears “Remember me” — sign in again with the new values.

---

## 4. Set up from source (admin)

Do this on the machine that will **develop** or **build** Orbit.

### 4.1 Clone and install

```bash
git clone <your-repo-url> slack-dashboard
cd slack-dashboard
npm install
```

### 4.2 Create `.env`

```bash
cp .env.example .env
```

Edit `.env` (never commit it):

```env
# Required — admin gate
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme

# Optional alias:
# ADMIN_EMAIL=admin@example.com

# Optional — Slack API Connect
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=
SLACK_REDIRECT_URI=https://localhost/slack/oauth/callback

# Optional — auto-update feed
# UPDATE_FEED_URL=
```

**Where `.env` is loaded**

| Mode | Location |
| --- | --- |
| Development | Project root `.env` |
| Packaged app | `userData/.env`, then app `Resources/.env` (copied at build if present) |

### 4.3 Run in development

```bash
npm run dev
```

If needed:

```bash
env -u ELECTRON_RUN_AS_NODE npm run dev
```

### 4.4 Quality checks

```bash
npm run ci
# or: npm run lint && npm run typecheck && npm test
```

---

## 5. First login and daily use

1. Launch Orbit (`npm run dev` or an installed build — see [§15](#15-install-as-a-desktop-app))
2. Sign in as **admin** (`admin` / `changeme` by default)
3. Keep **Remember me until I sign out** on
4. Create a **profile**
5. Complete Google sign-in when prompted (Chrome window)
6. Open **Slack** / **Teams** / **WhatsApp** under that profile
7. Use the sidebar to switch profiles, apps, workspaces / organizations
8. **Settings**: theme, notifications, idle lock, export/import, **Sign out admin**

### 5.1 Fresh start default look and initial experience

When launching the application for the first time or starting with a fresh installation:
- **Default view**: Starts directly in **Basic** view (`sidebarLook: 'basic'`).
- **Look switcher hidden**: The 4 look buttons (`[Basic] [Minimal] [Cosmic] [Ancient]`) are hidden by default (`showLookSwitcher: false`) to ensure a clean, modern layout. Users can re-enable the switcher anytime via **Settings ➔ Sidebar & Navigation**.
- **Google email onboarding**: The Google email input field (`name@gmail.com`) and **Continue with Google** button are displayed by default (`showGoogleEmailInputInSidebar: true`) directly beneath the header for instant profile onboarding.
- **Projects & cards**: The `PROJECTS (0) + New` section is clearly displayed to create and manage project cards.
- **Minimal sidebar footer**: Only the permanent **`⚙️ Settings`** button is displayed at the bottom of the sidebar (all optional buttons remain hidden by default).
- **Recent workspaces**: The `RECENT` strip remains hidden until a workspace is actively opened.

Only the admin gate unlocks the app. Google / Slack sessions inside profiles are separate.

**Single instance:** opening Orbit again focuses the existing window (one tray, one data folder).

Deep link:

```text
slack-dashboard://<profileId>?app=slack&team=<teamId>
```

---

## 6. Build installers

Have `.env` ready on the build machine if you want `ADMIN_*` baked into **Resources**.

### macOS — Apple Silicon

```bash
npm run build:mac:arm
```

Outputs under `dist/`:

- `mac-arm64/Orbit.app`
- `Orbit-1.0.0-arm64-mac.zip`
- `slack-dashboard-1.0.0-arm64.dmg`

### macOS — Intel

```bash
npm run build:mac:intel
```

### macOS — host architecture

```bash
npm run build:mac
```

Builds are **ad-hoc signed** for local use. Notarized distribution needs Apple Developer ID ([§11](#11-production-apple-signing-optional)).

### Linux

```bash
npm run build:linux:ubuntu
```

Produces AppImage + `.deb` in `dist/`.

### Windows

```bash
npm run build:win
```

Run this on Windows (or Windows CI).

After building, install on a machine using [§15 Install as a desktop app](#15-install-as-a-desktop-app).

---

## 7. Share a build with another machine

1. Build for **their** OS/arch (`build:mac:arm`, `build:mac:intel`, or `build:linux:ubuntu`)
2. Send the zip / DMG / AppImage / deb — **not** `node_modules`
3. Provide admin access:
   - **Option A:** Build with `.env` present so credentials are in **Resources**, or
   - **Option B:** Send a `.env` to place in `userData` (paths in [§15.4](#154-if-login-says-admin-not-configured))
4. Tell them the login, e.g. username `admin` and the password you set
5. On Mac: Chrome must be installed for Google docking
6. They follow [§15](#15-install-as-a-desktop-app) to install and open Orbit

---

## 8. Data on disk

All local state lives under Electron `userData` (folder name `slack-dashboard`):

| Platform | Folder |
| --- | --- |
| macOS | `~/Library/Application Support/slack-dashboard/` |
| Windows | `%APPDATA%\slack-dashboard\` |
| Linux | `~/.config/slack-dashboard/` |

| File / folder | Contents |
| --- | --- |
| `admin-session.json` | Remembered admin (hash only) |
| `.env` | Optional packaged credentials |
| `profiles.json` | Profiles, mute, pins, workspace metadata |
| `app-settings.json` | Theme, notifications, etc. |
| `secure/tokens.json` | Slack OAuth tokens (if used) |
| `Partitions/…` | Embed cookies / storage |
| `chrome-login-profiles/…` | Isolated Chrome dirs for Google import |

Message history stays on Slack / Teams / WhatsApp servers. Deleting this folder (or **Remove all profiles**) clears local Orbit data.

---

## 9. Notifications (macOS)

- In **System Settings → Notifications**, enable **Orbit** (ignore old **Electron** entries)
- While Orbit is focused, macOS often hides system banners — you still get toasts / Dock badge; Orbit may show a floating banner if OS delivery fails
- Reliable Notification Center banners usually need a **Developer ID** signed + notarized build

---

## 10. Production Apple signing (optional)

For notarized Mac distribution:

1. Apple Developer Program → **Developer ID Application** certificate
2. Configure electron-builder / notarize (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `mac.identity`)
3. Run `npm run build:mac` on a signing-capable Mac

Local / ad-hoc builds do **not** require this.

---

## 11. Scripts reference

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development app + HMR |
| `npm run build` | Compile main / preload / renderer |
| `npm run build:mac:arm` | Apple Silicon package + ad-hoc sign |
| `npm run build:mac:intel` | Intel Mac package + ad-hoc sign |
| `npm run build:mac` | macOS package for host arch |
| `npm run build:linux:ubuntu` | AppImage + deb |
| `npm run build:win` | Windows installer |
| `npm run codesign:mac` | Re-sign `dist/**/Orbit.app` |
| `npm run ci` | lint + typecheck + tests |

---

## 12. Project layout

```text
src/main/       Electron main (profiles, Chrome auth, IPC, tray)
src/preload/    Context bridge
src/renderer/   React UI
src/shared/     Types, brand, IPC contract
resources/      App / tray / dock icons
build/          electron-builder icons, afterPack
scripts/        Mac identity patch, codesign, icon helpers
tests/          Vitest unit tests
docs/adr/       Architecture decision records
```

---

## 13. Troubleshooting

| Problem | Fix |
| --- | --- |
| “Admin not configured” | Add `ADMIN_USERNAME` + `ADMIN_PASSWORD` to project `.env` (dev) or `userData` / Resources (packaged), restart |
| Forgot admin password | Edit `ADMIN_PASSWORD` in `.env`, restart, sign in again |
| Gatekeeper blocks `.app` | `xattr -cr /Applications/Orbit.app` then right-click → Open |
| Notifications show Electron only | Install latest Orbit; enable **Orbit** in System Settings |
| No banners | Allow Orbit; hide app (`⌘H`); use **Send test notification** |
| Chrome auth fails | Chrome at `/Applications/Google Chrome.app`; allow Automation if asked |
| Two trays / corrupt profiles | Quit extra Orbit processes; only one instance |
| Mac build won’t open on Ubuntu | Send a Linux build instead |

---

## 14. Install as a desktop app

**Last step:** put the packaged Orbit build on a Mac / Windows / Linux machine and open it like a normal app.  
(Build first with [§7](#7-build-installers), or use a file someone shared via [§8](#8-share-a-build-with-another-machine).)

You do **not** need `npm run dev` for daily use after this.

### 15.1 macOS

1. Open the **`.dmg`**, or unzip **`Orbit-*-mac.zip`**
2. Drag **Orbit.app** into **Applications** (and/or Desktop)
3. If macOS blocks it: **right-click → Open → Open**
4. If still blocked:

```bash
xattr -cr "/Applications/Orbit.app"
open "/Applications/Orbit.app"
```

**Install from your own `dist/` build (Apple Silicon example):**

```bash
pkill -f "Orbit.app" 2>/dev/null
rm -rf "/Applications/Orbit.app"
cp -R dist/mac-arm64/Orbit.app "/Applications/Orbit.app"
xattr -cr "/Applications/Orbit.app"
open "/Applications/Orbit.app"
```

Optional Desktop copy:

```bash
rm -rf "$HOME/Desktop/Orbit.app"
cp -R dist/mac-arm64/Orbit.app "$HOME/Desktop/Orbit.app"
```

5. Sign in with admin credentials (default `admin` / `changeme` unless changed)
6. Keep **Remember me until I sign out** checked

| Your Mac | Use this build |
| --- | --- |
| Apple Silicon (M1–M4) | `*-arm64*` / `mac-arm64/Orbit.app` |
| Intel | Intel / `x64` build from `npm run build:mac:intel` |

Check: Apple menu → **About This Mac**.

### 15.2 Linux (Ubuntu / Debian)

```bash
# .deb (recommended)
sudo apt install ./slack-dashboard_*_amd64.deb

# or AppImage
chmod +x slack-dashboard-*.AppImage
./slack-dashboard-*.AppImage
```

Then sign in with admin credentials. A Mac `.app` will **not** run on Linux.

### 15.3 Windows

1. Run the **`*-setup.exe`** installer from `dist/`
2. Open **Orbit** from Start / Desktop
3. Sign in with admin credentials

### 15.4 If login says “Admin not configured”

Create a `.env` in the data folder and restart Orbit:

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/slack-dashboard/.env` |
| Windows | `%APPDATA%\slack-dashboard\.env` |
| Linux | `~/.config/slack-dashboard/.env` |

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme
```

---

## 16. License / fonts

UI may load **Satoshi** from [Fontshare](https://www.fontshare.com/fonts/satoshi) (ITF Free Font License); offline it falls back to system sans. Embedded Slack / Teams / WhatsApp keep their own fonts.