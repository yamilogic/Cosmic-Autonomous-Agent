import React from 'react'

interface MessageHighlightProps {
  bounds: { x: number; y: number; width: number; height: number } | null
  visible: boolean
}

export const MessageHighlight: React.FC<MessageHighlightProps> = ({ bounds, visible }) => {
  if (!visible || !bounds) return null

  return (
    <div
      className="absolute pointer-events-none transition-all duration-300 ease-out z-40 rounded border border-indigo-400/80 bg-indigo-500/10 shadow-[0_0_15px_rgba(99,102,241,0.35)]"
      style={{
        left: `${bounds.x}px`,
        top: `${bounds.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`
      }}
    />
  )
}

