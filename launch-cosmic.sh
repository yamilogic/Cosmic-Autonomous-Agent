#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Ensure Electron runs the GUI window, not a node REPL
unset ELECTRON_RUN_AS_NODE
export ELECTRON_OZONE_PLATFORM_HINT=x11

# 1. Prefer unpacked binary if built
if [ -x "dist/linux-unpacked/Cosmic" ]; then
  echo "Launching Cosmic from dist/linux-unpacked/Cosmic..."
  exec ./dist/linux-unpacked/Cosmic --no-sandbox --disable-dev-shm-usage --disable-gpu --disable-gpu-compositing --ozone-platform=x11 "$@"
fi

# 2. Check if dist AppImage exists
APPIMAGE="$(find dist -name "Cosmic-*.AppImage" 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$APPIMAGE" ] && [ -f "$APPIMAGE" ]; then
  echo "Launching built Cosmic AppImage: $APPIMAGE"
  chmod +x "$APPIMAGE"
  exec "$APPIMAGE" --no-sandbox "$@"
fi

# 3. Otherwise, build and run directly via electron dist
echo "Building and launching Cosmic in development mode..."
pnpm run build || npm run build
exec ./node_modules/.pnpm/electron@*/node_modules/electron/dist/electron out/main/index.js --no-sandbox --disable-dev-shm-usage --disable-gpu --disable-gpu-compositing --ozone-platform=x11 "$@"

