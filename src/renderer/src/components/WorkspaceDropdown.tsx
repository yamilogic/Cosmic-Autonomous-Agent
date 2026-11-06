import type { PinnedWorkspace } from '../../../shared/types'

interface WorkspaceDropdownProps {
  pinnedWorkspaces: PinnedWorkspace[]
  selectedTeamId: string | null
  disabled?: boolean
  onSelect: (teamId: string) => void
}

export function WorkspaceDropdown({
  pinnedWorkspaces,
  selectedTeamId,
  disabled,
  onSelect
}: WorkspaceDropdownProps): React.JSX.Element {
  if (pinnedWorkspaces.length === 0) {
    return <span className="workspace-dropdown-empty">No pinned — sync & pin below</span>
  }

  const selected =
    selectedTeamId && pinnedWorkspaces.some((w) => w.teamId === selectedTeamId)
      ? selectedTeamId
      : ''

  return (
    <select
      className="workspace-dropdown"
      value={selected}
      disabled={disabled}
      aria-label="Pinned workspaces"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation()
        const teamId = e.target.value
        if (teamId) {
          onSelect(teamId)
        }
      }}
    >
      <option value="" disabled>
        Open workspace…
      </option>
      {pinnedWorkspaces.map((ws) => (
        <option key={ws.teamId} value={ws.teamId}>
          {ws.teamName}
        </option>
      ))}
    </select>
  )
}
