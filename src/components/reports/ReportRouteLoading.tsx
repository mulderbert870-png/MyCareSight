import LoadingSpinner from '@/components/LoadingSpinner'

/** Shared loading UI for agency report routes (staff certifications, roster, expiring, payroll & billing). */
export default function ReportRouteLoading() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <LoadingSpinner fullScreen={false} size="lg" />
    </div>
  )
}
