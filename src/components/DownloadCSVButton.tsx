'use client'

import { Download } from 'lucide-react'

interface DownloadCSVButtonProps {
  data: Record<string, any>[]
  filename: string
  className?: string
  children?: React.ReactNode
}

export default function DownloadCSVButton({ 
  data, 
  filename, 
  className = '',
  children 
}: DownloadCSVButtonProps) {
  const handleDownload = () => {
    if (!data || data.length === 0) {
      alert('No data to download')
      return
    }

    // Get headers from first object
    const headers = Object.keys(data[0])
    
    // Create CSV content
    const csvContent = [
      // Headers
      headers.join(','),
      // Rows
      ...data.map(row => 
        headers.map(header => {
          const value = row[header] || ''
          // Escape quotes and wrap in quotes if contains comma, newline, or quote
          if (typeof value === 'string' && (value.includes(',') || value.includes('\n') || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`
          }
          return value
        }).join(',')
      )
    ].join('\n')

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    
    link.setAttribute('href', url)
    link.setAttribute('download', `${filename}-${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    URL.revokeObjectURL(url)
  }

  return (
    <button
      onClick={handleDownload}
      className={className}
    >
      {children || (
        <>
          <Download className="w-4 h-4" />
          Download CSV
        </>
      )}
    </button>
  )
}
