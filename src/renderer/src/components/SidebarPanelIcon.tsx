/** Left-panel toggle — same idea as macOS IDE / VS Code sidebar control. */
export function SidebarPanelIcon({ collapsed }: { collapsed?: boolean }): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="sidebar-panel-icon"
    >
      <rect
        x="1.75"
        y="2.75"
        width="12.5"
        height="10.5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      {collapsed ? (
        <path d="M5.5 3v10" stroke="currentColor" strokeWidth="1.25" opacity="0.35" />
      ) : (
        <>
          <path d="M6.25 3v10" stroke="currentColor" strokeWidth="1.25" />
          <rect x="2.5" y="3.5" width="3.5" height="9" fill="currentColor" opacity="0.22" />
        </>
      )}
    </svg>
  )
}
