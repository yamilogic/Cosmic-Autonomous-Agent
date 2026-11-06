import type React from 'react'

interface ProjectPinButtonProps {
  pinned: boolean
  projectName: string
  onToggle: () => void
  className?: string
}

/** One pin control shared by compact and expanded headers. The expanded card
 *  is otherwise untouched. */
export default function ProjectPinButton({
  pinned,
  projectName,
  onToggle,
  className
}: ProjectPinButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      className={`proj-pin${pinned ? ' is-pinned' : ''}${className ? ` ${className}` : ''}`}
      aria-label={pinned ? `Unpin ${projectName}` : `Pin ${projectName}`}
      aria-pressed={pinned}
      title={pinned ? 'Unpin' : 'Pin'}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill={pinned ? 'currentColor' : 'none'}
        aria-hidden
      >
        <path
          d="M15.5 3.5 20.5 8.5 17.5 9.5 13.5 13.5 13.5 18.5 5.5 10.5 10.5 10.5 14.5 6.5 15.5 3.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M5 19 9.5 14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  )
}
