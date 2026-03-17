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
        y: barRect.top - containerRect.top
      })
    }
  }

  const handleMouseLeave = () => {
    setHoveredState(null)
  }

  if (Object.entries(stateCounts).length === 0) {
    return (
      <div className="h-48 md:h-64 flex items-center justify-center">
        <div className="text-gray-500">No data available</div>
      </div>
    )
  }

  const maxCount = Math.max(...Object.values(stateCounts))

  return (
    <div ref={containerRef} className="h-48 md:h-64 flex items-end justify-center gap-2 md:gap-4 overflow-x-auto pb-2 relative">
      {Object.entries(stateCounts).map(([state, count]) => {
        const height = (count / maxCount) * 100
        return (
          <div key={state} className="flex flex-col items-center gap-2">
            <div
              className="relative w-12 bg-blue-500 rounded-t cursor-pointer hover:bg-blue-600 transition-colors"
              style={{ height: `${height}%`, minHeight: '20px' }}
              onMouseEnter={(e) => handleMouseEnter(state, e)}
              onMouseLeave={handleMouseLeave}
            >
              <span className="absolute -top-6 left-1/2 transform -translate-x-1/2 text-sm font-semibold text-gray-900">
                {count}
              </span>
            </div>
            <span className="text-sm font-medium text-gray-700">{state}</span>
          </div>
        )
      })}
      
      {/* Tooltip */}
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
          {/* Tooltip arrow */}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  )
}
