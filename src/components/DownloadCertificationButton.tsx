'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'

interface DownloadCertificationButtonProps {
  documentUrl: string | null | undefined
  certificationName: string
  staffName: string
  disabled?: boolean
}

export default function DownloadCertificationButton({
  documentUrl,
  certificationName,
  staffName,
  disabled = false
}: DownloadCertificationButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false)

  const handleDownload = async () => {
    if (!documentUrl || disabled) return

    setIsDownloading(true)
    try {
      // Fetch the file
      const response = await fetch(documentUrl)
      if (!response.ok) {
        throw new Error('Failed to download file')
      }

      // Get the blob
      const blob = await response.blob()

      // Get file extension from URL or blob type
      const urlParts = documentUrl.split('.')
      const extension = urlParts.length > 1 ? urlParts[urlParts.length - 1].split('?')[0] : 'pdf'
      
      // Determine file type from blob or extension
      let mimeType = blob.type
      if (!mimeType || mimeType === 'application/octet-stream') {
        // Try to determine from extension
        const ext = extension.toLowerCase()
        if (ext === 'pdf') mimeType = 'application/pdf'
        else if (['jpg', 'jpeg'].includes(ext)) mimeType = 'image/jpeg'
        else if (ext === 'png') mimeType = 'image/png'
        else if (ext === 'gif') mimeType = 'image/gif'
        else if (ext === 'doc') mimeType = 'application/msword'
        else if (ext === 'docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }

      // Create a blob URL
      const blobUrl = window.URL.createObjectURL(blob)

      // Create a temporary anchor element and trigger download
      const a = document.createElement('a')
      a.href = blobUrl
      
      // Create a safe filename
      const safeStaffName = staffName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
      const safeCertName = certificationName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
      a.download = `${safeStaffName}_${safeCertName}.${extension}`

      document.body.appendChild(a)
      a.click()

      // Cleanup
      document.body.removeChild(a)
      window.URL.revokeObjectURL(blobUrl)
    } catch (error) {
      console.error('Error downloading file:', error)
      alert('Failed to download file. Please try again.')
    } finally {
      setIsDownloading(false)
    }
  }

  if (!documentUrl) {
    return (
      <button
        disabled
        className="px-3 py-1.5 text-sm text-gray-400 cursor-not-allowed flex items-center gap-1.5"
        title="No document available"
      >
        <Download className="w-4 h-4" />
        Download
      </button>
    )
  }

  return (
    <button
      onClick={handleDownload}
      disabled={isDownloading || disabled}
      className="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
      title="Download certification document"
    >
      {isDownloading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Downloading...
        </>
      ) : (
        <>
          <Download className="w-4 h-4" />
          Download
        </>
      )}
    </button>
  )
}
