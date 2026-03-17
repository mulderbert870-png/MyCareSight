'use client'

import { ReactNode } from 'react'

interface ClickableButtonWrapperProps {
  children: ReactNode
}

export default function ClickableButtonWrapper({ children }: ClickableButtonWrapperProps) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}
