'use client'

import Link from 'next/link'
import { ReactNode } from 'react'

interface ClientCardProps {
  clientId: string
  children: ReactNode
}

export default function ClientCard({ clientId, children }: ClientCardProps) {
  return (
    <Link
      href={`/pages/admin/clients/${clientId}`}
      className="bg-white rounded-xl p-6 shadow-md border border-gray-100 relative block hover:shadow-lg transition-shadow"
    >
      {children}
    </Link>
  )
}
