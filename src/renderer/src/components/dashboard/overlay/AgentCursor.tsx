import React from 'react'

interface AgentCursorProps {
  x: number
  y: number
  visible: boolean
}

export const AgentCursor: React.FC<AgentCursorProps> = ({ x, y, visible }) => {
  if (!visible) return null

  return (
    <div
      className="absolute pointer-events-none transition-all duration-300 ease-out z-50 flex items-center gap-1.5"
      style={{
        transform: `translate3d(${x}px, ${y}px, 0)`,
        left: 0,
        top: 0
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="filter drop-shadow-[0_2px_8px_rgba(99,102,241,0.8)]"
      >
        <path
          d="M4.5 3L11.5 21L14.5 13.5L22 10.5L4.5 3Z"
          fill="#6366F1"
          stroke="#FFFFFF"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <div className="bg-indigo-600/95 border border-indigo-400 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded shadow-lg backdrop-blur-sm whitespace-nowrap">
        Cosmic Reader
      </div>
    </div>
  )
}

