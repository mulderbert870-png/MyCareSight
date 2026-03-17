'use client'

import Link from 'next/link'
import { ReactNode } from 'react'

interface ClientCardWrapperProps {
  clientId: string
  children: ReactNode
}

export default function ClientCardWrapper({ clientId, children }: ClientCardWrapperProps) {
  return (
    <Link
      href={`/pages/admin/clients/${clientId}`}
      prefetch={true}
      className="bg-white rounded-xl p-6 shadow-md border border-gray-100 relative block hover:shadow-lg transition-shadow"
    >
      {children}
    </Link>
  )
}
