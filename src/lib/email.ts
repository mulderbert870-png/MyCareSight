/**
 * Email service using Resend
 * Sends email notifications when documents are uploaded
 */

// Note: RESEND_API_KEY should be set in .env.local as a server-side environment variable
// For now, using the provided API key as fallback
const RESEND_API_KEY = process.env.RESEND_API_KEY || ''

interface SendDocumentUploadNotificationParams {
  expertEmail: string
  expertName?: string
  ownerName?: string
  applicationName: string
  documentName: string
  applicationId: string
}

export async function sendDocumentUploadNotification({
  expertEmail,
  expertName,
  ownerName,
  applicationName,
  documentName,
  applicationId
}: SendDocumentUploadNotificationParams) {
  try {
    // Dynamic import to avoid issues if Resend is not installed
    const { Resend } = await import('resend')
    const resend = new Resend(RESEND_API_KEY)

    // Trim email to remove any whitespace/newline characters
    const trimmedEmail = expertEmail.trim()

    const applicationUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/pages/expert/applications/${applicationId}`

    const { data, error } = await resend.emails.send({
      // Use Resend's default domain until homesightsconsulting.com is verified
      from: 'Home Care Licensing <onboarding@resend.dev>',
      to: trimmedEmail,
      subject: `New Document Uploaded: ${documentName}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>New Document Uploaded</title>
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(to right, #2563eb, #4f46e5); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 24px;">New Document Uploaded</h1>
            </div>
            
            <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
              <p style="font-size: 16px; margin-bottom: 20px;">
                Hello ${expertName || 'Expert'},
              </p>
              
              <p style="font-size: 16px; margin-bottom: 20px;">
                ${ownerName ? `${ownerName} has` : 'A client has'} uploaded a new document for the application:
              </p>
              
              <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #2563eb; margin: 20px 0;">
                <p style="margin: 0; font-size: 18px; font-weight: bold; color: #1f2937;">
                  ${applicationName}
                </p>
                <p style="margin: 10px 0 0 0; font-size: 14px; color: #6b7280;">
                  Document: <strong>${documentName}</strong>
                </p>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${applicationUrl}" 
                   style="display: inline-block; background: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
                  View Application
                </a>
              </div>
              
              <p style="font-size: 14px; color: #6b7280; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
                This is an automated notification from Home Care Licensing Platform.
              </p>
            </div>
          </body>
        </html>
      `,
      text: `
New Document Uploaded

Hello ${expertName || 'Expert'},

${ownerName ? `${ownerName} has` : 'A client has'} uploaded a new document for the application: ${applicationName}

Document: ${documentName}

View the application: ${applicationUrl}

This is an automated notification from Home Care Licensing Platform.
      `.trim()
    })

    if (error) {
      console.error('Resend API error:', error)
      
      // Check if it's a testing mode restriction
      if (error.message?.includes('You can only send testing emails')) {
        console.warn('Resend API is in testing mode. Domain verification required to send to other recipients.')
        return { 
          success: false, 
          error: {
            ...error,
            isTestingMode: true,
            message: 'Email sending is restricted to testing mode. Please verify a domain at resend.com/domains to send emails to other recipients.'
          }
        }
      }
      
      throw error
    }

    return { success: true, data }
  } catch (error: any) {
    console.error('Error sending email notification:', error)
    // Don't throw error - email failure shouldn't break document upload
    return { success: false, error }
  }
}
