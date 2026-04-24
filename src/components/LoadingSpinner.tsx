'use client'

import { Loader2 } from 'lucide-react'

interface LoadingSpinnerProps {
  fullScreen?: boolean
  size?: 'sm' | 'md' | 'lg'
  /** Tailwind z-index class for the full-screen overlay (default z-50). */
  overlayZClass?: string
}

export default function LoadingSpinner({
  fullScreen = true,
  size = 'md',
  overlayZClass = 'z-50',
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  }

  const spinner = (
    <div className="flex items-center justify-center">
      <Loader2 className={`${sizeClasses[size]} animate-spin text-blue-600`} />
    </div>
  )

  if (fullScreen) {
    return (
      <div
        className={`fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center ${overlayZClass}`}
      >
        {spinner}
      </div>
    )
  }

  return spinner
}

