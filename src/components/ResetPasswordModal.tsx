'use client'

import { useState } from 'react'
import Modal from './Modal'
import { User, Mail, KeyRound } from 'lucide-react'
import SetPasswordModal from './SetPasswordModal'

interface ResetPasswordModalProps {
  isOpen: boolean
  onClose: () => void
  userName: string
  userEmail: string
  userId: string
}

export default function ResetPasswordModal({
  isOpen,
  onClose,
  userName,
  userEmail,
  userId
}: ResetPasswordModalProps) {
  const [setPasswordModalOpen, setSetPasswordModalOpen] = useState(false)

  const handleSendResetLink = () => {
    setSetPasswordModalOpen(true)
  }

  const handleClose = () => {
    setSetPasswordModalOpen(false)
    onClose()
  }

  const handleSetPasswordClose = () => {
    setSetPasswordModalOpen(false)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Reset Password" size="md">
      <div className="space-y-6">
        <p className="text-sm text-gray-600">
          Send a password reset link to this user&apos;s email address.
        </p>

        {/* User Information */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <User className="w-5 h-5 text-gray-400" />
            <span className="text-sm text-gray-900">{userName}</span>
          </div>
          <div className="flex items-center gap-3">
            <Mail className="w-5 h-5 text-gray-400" />
            <span className="text-sm text-gray-900">{userEmail}</span>
          </div>
        </div>

        {/* Explanation */}
        <p className="text-sm text-gray-600">
          Click &quot;Send Reset Link&quot; to set a new password for this user. The password will be updated and sent to the user&apos;s email address.
        </p>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSendResetLink}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-2"
          >
            <KeyRound className="w-4 h-4" />
            Change Password
          </button>
        </div>
      </div>

      {/* Set Password Modal */}
      <SetPasswordModal
        isOpen={setPasswordModalOpen}
        onClose={handleSetPasswordClose}
        userName={userName}
        userEmail={userEmail}
        userId={userId}
      />
    </Modal>
  )
}
