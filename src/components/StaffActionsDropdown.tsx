'use client'

import { useState, useRef, useEffect } from 'react'
import { MoreVertical, Eye, Edit, FileText } from 'lucide-react'

interface StaffActionsDropdownProps {
  staffId: string
  onViewDetails: () => void
  onEdit: () => void
  onManageLicenses: () => void
}

export default function StaffActionsDropdown({
  onViewDetails,
  onEdit,
  onManageLicenses,
}: StaffActionsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, right: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      // Calculate position when dropdown opens
      updateDropdownPosition()
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  useEffect(() => {
    // Update position on scroll or resize
    const handleUpdatePosition = () => {
      if (isOpen) {
        updateDropdownPosition()
      }
    }

    window.addEventListener('scroll', handleUpdatePosition, true)
    window.addEventListener('resize', handleUpdatePosition)

    return () => {
      window.removeEventListener('scroll', handleUpdatePosition, true)
      window.removeEventListener('resize', handleUpdatePosition)
    }
  }, [isOpen])

  const updateDropdownPosition = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + 8, // 8px = mt-2 equivalent (fixed is relative to viewport)
        right: window.innerWidth - rect.right,
      })
    }
  }

  const handleToggle = () => {
    if (!isOpen) {
      updateDropdownPosition()
    }
    setIsOpen(!isOpen)
  }

  const handleAction = (action: () => void) => {
    action()
    setIsOpen(false)
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="p-2 hover:bg-gray-100 rounded-lg transition-colors relative"
        aria-label="More options"
      >
        <MoreVertical className="w-5 h-5 text-gray-400" />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="fixed w-56 bg-white rounded-xl shadow-lg border border-gray-200 z-[9999] py-2"
          style={{
            top: `${dropdownPosition.top}px`,
            right: `${dropdownPosition.right}px`,
          }}
        >
          <button
            onClick={() => handleAction(onViewDetails)}
            className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center gap-3 transition-colors"
          >
            <Eye className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">View details</span>
          </button>
          <button
            onClick={() => handleAction(onEdit)}
            className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center gap-3 transition-colors"
          >
            <Edit className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Edit information</span>
          </button>
          <button
            onClick={() => handleAction(onManageLicenses)}
            className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center gap-3 transition-colors"
          >
            <FileText className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Manage Licenses</span>
          </button>
        </div>
      )}
    </>
  )
}

