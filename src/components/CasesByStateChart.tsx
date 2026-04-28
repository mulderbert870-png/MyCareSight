'use client'

import { useState, useRef } from 'react'

interface CasesByStateChartProps {
  stateCounts: Record<string, number>
}

export default function CasesByStateChart({ stateCounts }: CasesByStateChartProps) {
  const [hoveredState, setHoveredState] = useState<string | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseEnter = (state: string, event: React.MouseEvent<HTMLDivElement>) => {
    setHoveredState(state)
    if (containerRef.current) {
      const barRect = event.currentTarget.getBoundingClientRect()
      const containerRect = containerRef.current.getBoundingClientRect()
      setTooltipPosition({
        x: barRect.left + barRect.width / 2 - containerRect.left,
        y: barRect.top - containerRect.top,
      })
    }
  }

  const handleMouseLeave = () => {
    setHoveredState(null)
  }

  const entries = Object.entries(stateCounts).filter(([, count]) => count > 0)

  if (entries.length === 0) {
    return (
      <div className="h-48 md:h-64 flex items-center justify-center">
        <div className="text-gray-500">No data available</div>
      </div>
    )
  }

  const maxCount = Math.max(...entries.map(([, c]) => c))

  return (
    <div
      ref={containerRef}
      className="h-48 md:h-64 flex gap-2 md:gap-4 overflow-x-auto pb-2 relative items-stretch"
    >
      {entries.map(([state, count]) => {
        const ratio = maxCount > 0 ? count / maxCount : 0
        return (
          <div key={state} className="flex flex-col items-center min-w-[3rem] flex-1 h-full min-h-0">
            <div className="flex-1 w-full min-h-0 flex flex-col justify-end items-stretch">
              <div
                className="relative w-full max-w-[3rem] mx-auto bg-blue-500 rounded-t cursor-pointer hover:bg-blue-600 transition-colors shrink-0"
                style={{
                  height: `${ratio * 100}%`,
                  minHeight: ratio > 0 ? 4 : 0,
                }}
                onMouseEnter={(e) => handleMouseEnter(state, e)}
                onMouseLeave={handleMouseLeave}
              >
                {/* Count at top *inside* the bar so it is never clipped when the bar is full height */}
                <span className="pointer-events-none absolute left-1/2 top-1 z-10 -translate-x-1/2 text-xs font-bold leading-none text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]">
                  {count}
                </span>
              </div>
            </div>
            <span className="text-sm font-medium text-gray-700 mt-2 shrink-0 text-center truncate w-full">
              {state}
            </span>
          </div>
        )
      })}

      {hoveredState && (
        <div
          className="absolute z-50 bg-gray-900 text-white text-sm px-3 py-2 rounded-lg shadow-lg pointer-events-none"
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y - 10}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="font-semibold text-center">{hoveredState}</div>
          <div className="text-center text-xs mt-1">count: {stateCounts[hoveredState]}</div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  )
}
