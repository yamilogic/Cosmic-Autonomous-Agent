#!/bin/bash
# Debug script for Orbit Dashboard blank screen issue
# Run this to diagnose the issue

set -e

cd /home/creator/Desktop/Orbit-Dashboards

echo "=========================================="
echo "Orbit Dashboard Debug Script"
echo "=========================================="
echo ""

echo "1. Checking build..."
pnpm run build 2>&1 | tail -5
echo ""

echo "2. Checking for TypeScript errors..."
pnpm run typecheck 2>&1
echo ""

echo "3. Running tests..."
pnpm test 2>&1 | tail -10
echo ""

echo "4. Checking built files..."
ls -la out/renderer/assets/
echo ""

echo "5. Checking CSS for key dashboard classes..."
for cls in "page-head" "section-head" "digest" "empty-state" "segmented" "btn-primary" "btn-secondary" "btn-ghost" "auto-sync" "count"; do
  count=$(grep -c "\.$cls" out/renderer/assets/index-*.css)
  echo "  .$cls: $count occurrences"
done
echo ""

echo "6. Checking JS bundle for dashboard API calls..."
grep -c "dashboard:get-snapshot\|DashboardGetSnapshot\|getSnapshot" out/renderer/assets/index-*.js
echo ""

echo "7. Checking preload script..."
grep -c "dashboard" out/preload/index.js
echo ""

echo "8. Checking main process IPC registration..."
grep -c "DashboardGetSnapshot" out/main/index.js
echo ""

echo "=========================================="
echo "Manual verification steps:"
echo "=========================================="
echo "1. Run: pnpm run dev"
echo "2. Login as admin (admin/changeme)"
echo "3. Create a profile with Google sign-in"
echo "4. Sign in to Slack under that profile"
echo "5. Click 'Dashboard' in sidebar (expands to show 'Slack')"
echo "6. Click 'Slack' to open dashboard"
echo "7. Open DevTools (Ctrl+Shift+I) and check Console for errors"
echo ""
echo "Expected behavior:"
echo "- Dashboard header with 'Client projects — Slack'"
echo "- Auto-sync status, 'Sync all' button, '+ Set up new project' button"
echo "- Digest bar (if data exists)"
echo "- Recent strip (if data exists)"
echo "- 'Workspaces' section with count badge"
echo "- Toolbar: 'Collapse all', 'Expand all', segmented control (Compact/Expanded/Mixed)"
echo "- Empty state if no projects: 'No project cards yet' with CTA button"
echo ""
echo "If blank screen:"
echo "- Check Console for errors (red text)"
echo "- Check Network tab for failed IPC calls"
echo "- Verify 'dashboardOpen' state in React DevTools (Zustand store)"
echo "- Verify 'snapshot' state in React DevTools"
echo "=========================================="