#!/usr/bin/env bash
set -euo pipefail

# Resolves directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ICON_PATH="${PROJECT_ROOT}/build/icons/256x256.png"
DESKTOP_DIR="${HOME}/.local/share/applications"
DESKTOP_FILE="${DESKTOP_DIR}/cosmic.desktop"

mkdir -p "${DESKTOP_DIR}"

# 1. Install hicolor theme icons so GNOME/Ubuntu desktop environment caches the logo
HICOLOR_DIR="${HOME}/.local/share/icons/hicolor"
SIZES=("16x16" "24x24" "32x32" "48x48" "64x64" "128x128" "256x256" "512x512" "1024x1024")
for s in "${SIZES[@]}"; do
  if [ -f "${PROJECT_ROOT}/build/icons/${s}.png" ]; then
    mkdir -p "${HICOLOR_DIR}/${s}/apps"
    cp "${PROJECT_ROOT}/build/icons/${s}.png" "${HICOLOR_DIR}/${s}/apps/cosmic.png"
    cp "${PROJECT_ROOT}/build/icons/${s}.png" "${HICOLOR_DIR}/${s}/apps/Cosmic.png"
    cp "${PROJECT_ROOT}/build/icons/${s}.png" "${HICOLOR_DIR}/${s}/apps/slack-dashboard.png"
  fi
done

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "${HICOLOR_DIR}" 2>/dev/null || true
fi

# Find AppImage if built, or fallback to dev launch script
APPIMAGE_PATH="$(find "${PROJECT_ROOT}/dist" -name "Cosmic-*.AppImage" 2>/dev/null | sort -V | tail -n 1 || true)"

if [[ -n "${APPIMAGE_PATH}" && -f "${APPIMAGE_PATH}" ]]; then
  EXEC_CMD="${APPIMAGE_PATH} --no-sandbox"
  echo "Linking desktop launcher to built AppImage: ${APPIMAGE_PATH}"
else
  EXEC_CMD="${PROJECT_ROOT}/launch-cosmic.sh"
  echo "AppImage not found in dist/. Linking desktop launcher to development runner: ${EXEC_CMD}"
fi

cat <<EOF > "${DESKTOP_FILE}"
[Desktop Entry]
Name=Cosmic
Comment=Multi-profile Slack and Automation Dashboard
Exec=${EXEC_CMD} %U
Icon=cosmic
Terminal=false
Type=Application
Categories=Utility;Network;Chat;
StartupWMClass=Cosmic
MimeType=x-scheme-handler/cosmic;x-scheme-handler/slack-dashboard;
EOF

# Also create Cosmic.desktop alias for case-sensitive window managers
cp "${DESKTOP_FILE}" "${DESKTOP_DIR}/Cosmic.desktop"
cp "${DESKTOP_FILE}" "${DESKTOP_DIR}/slack-dashboard.desktop"

chmod +x "${DESKTOP_FILE}"
if [[ -n "${APPIMAGE_PATH}" && -f "${APPIMAGE_PATH}" ]]; then
  chmod +x "${APPIMAGE_PATH}"
fi

# Update desktop database
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${DESKTOP_DIR}" || true
fi

echo "✅ Cosmic desktop launcher installed successfully at: ${DESKTOP_FILE}"
echo "You can now find and launch 'Cosmic' from your Ubuntu Applications / Dock!"

