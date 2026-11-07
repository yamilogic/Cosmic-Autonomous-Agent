import { modKey } from './shortcut-label'

/** Only a visible→hidden transition explains how to bring the sidebar back. */
export function sidebarToastFor(
  previousCollapsed: boolean,
  nextCollapsed: boolean,
  modifier = modKey()
): string | null {
  if (previousCollapsed || !nextCollapsed) return null
  return `Sidebar hidden — press ${modifier}B or use the left panel button to show it again.`
}
