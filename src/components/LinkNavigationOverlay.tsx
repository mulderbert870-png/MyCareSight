'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLinkStatus } from 'next/link'
import LoadingSpinner from '@/components/LoadingSpinner'

/**
 * Must render as a descendant of next/link. Uses Next.js link navigation status
 * so the overlay stays until this link's client navigation (including RSC) finishes.
 */
export default function LinkNavigationOverlay() {
  const { pending } = useLinkStatus()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || !pending) return null

  return createPortal(
    <div aria-busy="true" aria-live="polite">
      <LoadingSpinner overlayZClass="z-[200]" />
    </div>,
    document.body
  )
}
