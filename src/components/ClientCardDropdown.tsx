'use client'

import { useState, useRef, useEffect } from 'react'
import { Eye, MessageSquare, UserCog, FileText, Edit } from 'lucide-react'

interface ClientCardDropdownProps {
  clientId: string
  onViewDetails?: () => void
  onOpenMessages?: () => void
  onChangeExpert?: () => void
  onViewApplications?: () => void
  onEditClient?: () => void
}

export default function ClientCardDropdown({
  clientId,
  onViewDetails,
  onOpenMessages,
  onChangeExpert,
  onViewApplications,
  onEditClient,
}: ClientCardDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const menuItems = [
    {
      label: 'View Details',
      icon: Eye,
      onClick: () => {
        onViewDetails?.()
        setIsOpen(false)
      },
    },
    {
      label: 'Open Messages',
      icon: MessageSquare,
      onClick: () => {
        onOpenMessages?.()
        setIsOpen(false)
      },
    },
    {
      label: 'Change Expert',
      icon: UserCog,
      onClick: () => {
        onChangeExpert?.()
        setIsOpen(false)
      },
    },
    {
      label: 'View Applications',
      icon: FileText,
      onClick: () => {
        onViewApplications?.()
        setIsOpen(false)
      },
    },
    {
      label: 'Edit Client Info',
      icon: Edit,
      onClick: () => {
        onEditClient?.()
        setIsOpen(false)
      },
    },
  ]

  return (
    <div className="relative" ref={dropdownRef}>
      {isOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
      )}
      {isOpen && (
        <div className="absolute right-0 top-8 z-50 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
          {menuItems.map((item, index) => {
            const Icon = item.icon
            return (
              <button
                key={index}
                onClick={(e) => {
                  e.stopPropagation()
                  item.onClick()
                }}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition-colors"
              >
                <Icon className="w-4 h-4 text-gray-600" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
