import React from 'react'

interface StatusPillProps {
  channelName?: string
  scrollIndex?: number
  maxScroll?: number
  messageCount?: number
  text?: string
}

export const StatusPill: React.FC<StatusPillProps> = ({
  channelName,
  scrollIndex,
  maxScroll,
  messageCount,
  text
}) => {
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/90 border border-indigo-500/40 shadow-xl backdrop-blur-md text-xs text-slate-100">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
      </span>
      <span className="font-medium text-slate-200">
        {text || (channelName ? `Reading #${channelName}` : 'Automating…')}
      </span>
      {scrollIndex !== undefined && maxScroll !== undefined && (
        <span className="text-[10px] text-slate-400 border-l border-slate-700 pl-2">
          Scroll {scrollIndex}/{maxScroll}
        </span>
      )}
      {messageCount !== undefined && messageCount > 0 && (
        <span className="text-[10px] text-indigo-300 border-l border-slate-700 pl-2">
          {messageCount} read
        </span>
      )}
    </div>
  )
}

