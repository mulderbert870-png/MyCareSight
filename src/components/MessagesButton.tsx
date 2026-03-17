'use client'

import { useRouter } from 'next/navigation'
import { MessageSquare } from 'lucide-react'

interface MessagesButtonProps {
  clientId?: string
  unreadCount?: number
}

export default function MessagesButton({ clientId, unreadCount = 0 }: MessagesButtonProps) {
  const router = useRouter()
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const href = clientId ? `/pages/admin/messages?client=${clientId}` : '/pages/admin/messages'
    router.push(href)
  }
  
  const buttonContent = (
    <>
      <MessageSquare className="w-4 h-4" />
      <span>Messages</span>
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-semibold">
          {unreadCount}
        </span>
      )}
    </>
  )

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium ${unreadCount > 0 ? 'relative' : ''}`}
    >
      {buttonContent}
    </button>
  )
}
