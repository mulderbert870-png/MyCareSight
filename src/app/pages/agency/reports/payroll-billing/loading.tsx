export default function PayrollBillingReportLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-4 w-40 rounded bg-gray-200" />
      <div className="h-10 w-2/3 max-w-md rounded bg-gray-200" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="h-28 rounded-xl bg-gray-200" />
        <div className="h-28 rounded-xl bg-gray-200" />
        <div className="h-28 rounded-xl bg-gray-200" />
      </div>
      <div className="h-24 rounded-xl bg-gray-200" />
      <div className="h-96 rounded-xl bg-gray-200" />
    </div>
  )
}
