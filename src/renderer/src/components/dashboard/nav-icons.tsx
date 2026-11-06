import type React from 'react'

/** The 16px outline icon set used by the workspace sidebar. Names come from the
 * nav model, so the tree in `workspace-nav.ts` stays free of JSX. */

const SHAPES: Record<string, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5l2.4 5.6 5.6 2.4-5.6 2.4L12 19.5l-2.4-5.6L4 11.5l5.6-2.4z" />
      <path d="M18.5 16.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" />
    </>
  ),
  slack: (
    <>
      <rect x="9.5" y="3" width="3" height="7.5" rx="1.5" />
      <rect x="9.5" y="13.5" width="3" height="7.5" rx="1.5" />
      <rect x="13.5" y="9.5" width="7.5" height="3" rx="1.5" />
      <rect x="3" y="9.5" width="7.5" height="3" rx="1.5" />
    </>
  ),
  summary: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  chartBar: (
    <>
      <path d="M3 20h18" />
      <path d="M6.5 20v-6M12 20V7.5M17.5 20v-9" />
    </>
  ),
  chartLine: (
    <>
      <path d="M3 20h18" />
      <path d="M4 15.5l4.5-5 3.5 2.5 5-6.5" />
    </>
  ),
  chartDonut: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 4v4.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </>
  ),
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  robot: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4.5V8" />
      <path d="M12 3.2h.01" />
      <path d="M9 13h.01M15 13h.01" />
      <path d="M9.5 16.8h5" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13.5h4l1.5 2.5h5l1.5-2.5h4" />
      <path d="M4 13.5V6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7" />
      <path d="M4 13.5v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>
  ),
  plug: (
    <>
      <path d="M8.5 3.5v5M15.5 3.5v5" />
      <path d="M6 8.5h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6z" />
      <path d="M12 17.5v3" />
    </>
  ),
  users: (
    <>
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M3.5 20a6 6 0 0 1 12 0" />
      <path d="M16.5 5.4a3.2 3.2 0 0 1 0 5.2" />
      <path d="M17.5 20a6 6 0 0 0-2.2-4.6" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3.8 8l7.3 5.2a1.7 1.7 0 0 0 1.8 0L20.2 8" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 6l12 12" />
    </>
  ),
  shield: <path d="M12 3.5l7.5 2.8v5.4c0 4-3.1 6.9-7.5 8.8-4.4-1.9-7.5-4.8-7.5-8.8V6.3z" />,
  arrowRight: (
    <>
      <path d="M4 12h15" />
      <path d="M13.5 6.5l5.5 5.5-5.5 5.5" />
    </>
  ),
  listCheck: (
    <>
      <path d="M3.5 7.2l1.8 1.8L8.4 5.7" />
      <path d="M3.5 16.2l1.8 1.8 3.1-3.3" />
      <path d="M11.5 7.5h9M11.5 16.5h9" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 12h.01" />
    </>
  ),
  check: <path d="M4.5 12.8l4.8 4.9L19.5 7" />,
  flag: (
    <>
      <path d="M6 21V3.8" />
      <path d="M6 4h11.5l-2.2 4.3L17.5 13H6" />
    </>
  ),
  paperclip: (
    <>
      <path d="M15.8 8.4l-6.4 6.5a2.3 2.3 0 0 0 3.2 3.3l7.1-7.2a4.6 4.6 0 0 0-6.5-6.5L5 12.9a6.9 6.9 0 0 0 9.7 9.8" />
    </>
  ),
  mood: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.2 13.8a4.3 4.3 0 0 0 7.6 0" />
      <path d="M9.2 9.5h.01M14.8 9.5h.01" />
    </>
  ),
  history: (
    <>
      <path d="M20 12a8 8 0 1 1-3.1-6.3" />
      <path d="M20 4.5V9h-4.4" />
      <path d="M12 8.2V12l2.8 1.8" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6.5 3.5h11M6.5 20.5h11" />
      <path d="M7.5 3.5v3.2L12 12l4.5-5.3V3.5" />
      <path d="M7.5 20.5v-3.2L12 12l4.5 5.3v3.2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.2l8.3 14.6H3.7z" />
      <path d="M12 9.8v4" />
      <path d="M12 16.4h.01" />
    </>
  ),
  folder: (
    <path d="M21 19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2z" />
  ),
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />
}

/** Model icon keys (`chart-bar`, `list-check`, …) map onto the shapes above. */
function shapeKey(name: string): string {
  const parts = name.split(/[-_]/)
  return parts
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
}

export default function NavIcon({ name }: { name: string }): React.JSX.Element {
  const shape = SHAPES[shapeKey(name)] ?? SHAPES.summary
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shape}
    </svg>
  )
}
