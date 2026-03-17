'use client'

import { useState } from 'react'

interface CasesByStatusChartProps {
  totalCases: number
  statusCounts: {
    in_progress: number
    under_review: number
    approved: number
    rejected: number
  }
}

export default function CasesByStatusChart({ totalCases, statusCounts }: CasesByStatusChartProps) {
  const [hoveredStatus, setHoveredStatus] = useState<string | null>(null)

  const circumference = 2 * Math.PI * 40 // r = 40
  const inProgressLength = (statusCounts.in_progress / totalCases) * circumference
  const approvedLength = (statusCounts.approved / totalCases) * circumference
  const underReviewLength = (statusCounts.under_review / totalCases) * circumference
  const rejectedLength = (statusCounts.rejected / totalCases) * circumference
  
  const totalFilledLength = inProgressLength + approvedLength + underReviewLength + rejectedLength
  const notStartedLength = circumference - totalFilledLength
  const notStartedCount = totalCases - (statusCounts.in_progress + statusCounts.approved + statusCounts.under_review + statusCounts.rejected)

  const inProgressOffset = 0
  const approvedOffset = -inProgressLength
  const underReviewOffset = -(inProgressLength + approvedLength)
  const rejectedOffset = -(inProgressLength + approvedLength + underReviewLength)
  const notStartedOffset = -totalFilledLength

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'in_progress':
        return 'In Progress'
      case 'under_review':
        return 'Under Review'
      case 'approved':
        return 'Approved'
      case 'rejected':
        return 'Rejected'
      case 'not_started':
        return 'Not Started'
      default:
        return status
    }
  }

  return (
    <>
      <div className="flex items-center justify-center h-48 md:h-64 relative">
        <div className="relative w-48 h-48">
          <svg viewBox="0 0 100 100" className="transform -rotate-90">
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="20"
            />
            {totalCases > 0 && (
              <>
                {/* In Progress segment */}
                {statusCounts.in_progress > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="20"
                    strokeDasharray={`${inProgressLength} ${circumference}`}
                    strokeDashoffset={inProgressOffset}
                    onMouseEnter={() => setHoveredStatus('in_progress')}
                    onMouseLeave={() => setHoveredStatus(null)}
                    className="cursor-pointer"
                  />
                )}
                {/* Approved segment */}
                {statusCounts.approved > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="20"
                    strokeDasharray={`${approvedLength} ${circumference}`}
                    strokeDashoffset={approvedOffset}
                    onMouseEnter={() => setHoveredStatus('approved')}
                    onMouseLeave={() => setHoveredStatus(null)}
                    className="cursor-pointer"
                  />
                )}
                {/* Under Review segment */}
                {statusCounts.under_review > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="20"
                    strokeDasharray={`${underReviewLength} ${circumference}`}
                    strokeDashoffset={underReviewOffset}
                    onMouseEnter={() => setHoveredStatus('under_review')}
                    onMouseLeave={() => setHoveredStatus(null)}
                    className="cursor-pointer"
                  />
                )}
                {/* Rejected segment */}
                {statusCounts.rejected > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="20"
                    strokeDasharray={`${rejectedLength} ${circumference}`}
                    strokeDashoffset={rejectedOffset}
                    onMouseEnter={() => setHoveredStatus('rejected')}
                    onMouseLeave={() => setHoveredStatus(null)}
                    className="cursor-pointer"
                  />
                )}
                {/* Not Started segment (empty part) */}
                {notStartedCount > 0 && notStartedLength > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="#e5e7eb"
                    strokeWidth="20"
                    strokeDasharray={`${notStartedLength} ${circumference}`}
                    strokeDashoffset={notStartedOffset}
                    onMouseEnter={() => setHoveredStatus('not_started')}
                    onMouseLeave={() => setHoveredStatus(null)}
                    className="cursor-pointer"
                  />
                )}
              </>
            )}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-xl font-bold text-gray-900">{totalCases}</div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
          </div>
        </div>
        
        {/* Tooltip */}
        {hoveredStatus && (
          <div
            className="absolute z-50 bg-gray-900 text-white text-sm px-3 py-2 rounded-lg shadow-lg pointer-events-none whitespace-nowrap"
            style={{
              left: '50%',
              top: '20%',
              transform: 'translate(-50%, -100%)',
            }}
          >
            {hoveredStatus === 'not_started' 
              ? `Not Started: ${notStartedCount}`
              : `${getStatusLabel(hoveredStatus)}: ${statusCounts[hoveredStatus as keyof typeof statusCounts]}`
            }
            {/* Tooltip arrow */}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
          </div>
        )}
      </div>
      
      {/* Legend */}
      <div className="grid grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 mt-4">
      {/* <div className="flex flex-col gap-2 justify-between items-center"> */}
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-500 rounded flex-shrink-0"></div>
          <span className="text-sm text-gray-600">In Progress ({statusCounts.in_progress})</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-500 rounded flex-shrink-0"></div>
          <span className="text-sm text-gray-600">Approved ({statusCounts.approved})</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-yellow-500 rounded flex-shrink-0"></div>
          <span className="text-sm text-gray-600">Under Review ({statusCounts.under_review})</span>
        </div>
        {statusCounts.rejected > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 rounded flex-shrink-0"></div>
            <span className="text-sm text-gray-600">Rejected ({statusCounts.rejected})</span>
          </div>
        )}
        {notStartedCount > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-300 rounded flex-shrink-0"></div>
            <span className="text-sm text-gray-600">Not Started ({notStartedCount})</span>
          </div>
        )}
      </div>
    </>
  )
}
