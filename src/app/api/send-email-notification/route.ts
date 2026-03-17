import { NextRequest, NextResponse } from 'next/server'
import { sendDocumentUploadNotification } from '@/lib/email'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const {
      expertEmail,
      expertName,
      ownerName,
      applicationName,
      documentName,
      applicationId
    } = body

    // Validate required fields
    if (!expertEmail || !applicationName || !documentName || !applicationId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const result = await sendDocumentUploadNotification({
      expertEmail,
      expertName,
      ownerName,
      applicationName,
      documentName,
      applicationId
    })

    if (result.success) {
      return NextResponse.json({ success: true })
    } else {
      // Check if it's a testing mode restriction (403 error)
      const isTestingMode = result.error?.isTestingMode || 
                           (result.error?.statusCode === 403 && 
                            result.error?.message?.includes('testing emails'))
      
      // Return 200 with warning for testing mode (don't treat as error)
      // This allows document upload to succeed even if email fails
      if (isTestingMode) {
        console.warn('Email notification skipped: Resend API is in testing mode')
        return NextResponse.json({ 
          success: false, 
          warning: 'Email notification not sent - Resend API is in testing mode. Please verify a domain at resend.com/domains to enable email notifications.',
          details: result.error 
        }, { status: 200 }) // Return 200 so client doesn't treat it as an error
      }
      
      return NextResponse.json(
        { error: 'Failed to send email', details: result.error },
        { status: 500 }
      )
    }
  } catch (error: any) {
    console.error('Error in email notification API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
