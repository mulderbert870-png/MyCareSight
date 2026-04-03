'use client'

import { useMemo, useState, useTransition } from 'react'
import { Pencil } from 'lucide-react'
import type { TimeBillingRow, TimeBillingStatus } from '@/lib/time-billing-dashboard'
import { approveTimeBillingRowAction, voidTimeBillingRowAction } from '@/app/actions/time-billing'

type Props = {
  rows: TimeBillingRow[]
  loadError?: string
}

function money(n: number): string {
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Pending-tab estimate when hours are edited (hourly assumption; matches common contract). */
function estLineAmount(hours: number, rate: number): number {
  if (!Number.isFinite(hours) || !Number.isFinite(rate)) return 0
  return round2(hours * rate)
}

function toLabel(status: TimeBillingStatus): string {
  if (status === 'approved') return 'Approved'
  if (status === 'voided') return 'Voided'
  return 'Pending'
}

/** Short label for approved/voided table so the column stays narrow. */
function noteCellLabel(note: string | null | undefined): string {
  if (note == null || String(note).trim() === '') return '-'
  const s = String(note)
  if (s.length <= 10) return s
  return `${s.slice(0, 10)}…`
}

export default function TimeBillingContent({ rows, loadError }: Props) {
  const [activeTab, setActiveTab] = useState<TimeBillingStatus>('pending')
  const [pendingEdits, setPendingEdits] = useState<
    Record<string, { hours: string; note: string; serviceType: 'non_skilled' | 'skilled' }>
  >({})
  const [hoursEditingId, setHoursEditingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const counts = useMemo(
    () => ({
      pending: rows.filter((r) => r.status === 'pending').length,
      approved: rows.filter((r) => r.status === 'approved').length,
      voided: rows.filter((r) => r.status === 'voided').length,
    }),
    [rows]
  )

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => r.status === activeTab)
      .filter((r) =>
        q
          ? `${r.clientName} ${r.caregiverName} ${r.date} ${r.timeLabel} ${r.note ?? ''}`
              .toLowerCase()
              .includes(q)
          : true
      )
  }, [rows, activeTab, query])

  const summary = useMemo(() => {
    const approved = rows.filter((r) => r.status === 'approved')
    const pending = rows.filter((r) => r.status === 'pending')
    return {
      awaitingApproval: pending.length,
      approvedHours: approved.reduce((sum, r) => sum + (r.hours || 0), 0),
      totalPayroll: approved.reduce((sum, r) => sum + (r.payAmount || 0), 0),
      totalBilling: approved.reduce((sum, r) => sum + (r.billAmount || 0), 0),
    }
  }, [rows])

  const getEdit = (row: TimeBillingRow) =>
    pendingEdits[row.id] ?? {
      hours: String(row.hours ?? 0),
      note: row.note ?? '',
      serviceType: row.serviceType,
    }

  const pendingPayload = (row: TimeBillingRow) => {
    const edit = getEdit(row)
    return {
      scheduledVisitId: row.scheduledVisitId,
      hours: Number(edit.hours),
      note: edit.note,
      serviceType: edit.serviceType,
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-semibold text-gray-900">Hours Approval</h1>
        <p className="text-sm text-gray-600 mt-1">
          Review completed visits, confirm hours and service type, then approve for payroll.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="text-2xl font-bold">{summary.awaitingApproval}</div>
          <div className="text-xs text-gray-500">Awaiting Approval</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-2xl font-bold">{summary.approvedHours.toFixed(1)} hrs</div>
          <div className="text-xs text-gray-500">Approved Hours</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-2xl font-bold">{money(summary.totalPayroll)}</div>
          <div className="text-xs text-gray-500">Total Payroll</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-2xl font-bold">{money(summary.totalBilling)}</div>
          <div className="text-xs text-gray-500">Total Billing</div>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="border-b px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-4 text-sm">
            {(['pending', 'approved', 'voided'] as TimeBillingStatus[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`pb-2 border-b-2 ${activeTab === tab ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-600'}`}
                onClick={() => setActiveTab(tab)}
              >
                {toLabel(tab)} ({counts[tab]})
              </button>
            ))}
          </div>
          <input
            className="w-full sm:w-64 rounded-md border px-3 py-1.5 text-sm"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {(loadError || error) && <div className="px-4 py-2 text-sm text-red-600">{loadError || error}</div>}

        <div className="overflow-x-auto">
          <table className="min-w-[1200px] w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                {activeTab !== 'voided' ? <th className="text-left px-3 py-2">Client</th> : null}
                <th className="text-left px-3 py-2">Caregiver</th>
                <th className="text-left px-3 py-2">Time</th>
                <th className="text-left px-3 py-2">Hours</th>
                <th className="text-left px-3 py-2">Service Type</th>
                <th className="text-left px-3 py-2">Pay Rate</th>
                <th className="text-left px-3 py-2">Pay Amt</th>
                <th className="text-left px-3 py-2">Bill Rate</th>
                <th className="text-left px-3 py-2">Bill Amt</th>
                <th className="text-left px-3 py-2">Note * if edited</th>
                <th className="text-left px-3 py-2">{activeTab === 'pending' ? 'Actions' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => {
                const edit = getEdit(row)
                const hoursNum = Number(edit.hours)
                const displayPay =
                  activeTab === 'pending' && Number.isFinite(hoursNum)
                    ? estLineAmount(hoursNum, row.payRate)
                    : row.payAmount
                const displayBill =
                  activeTab === 'pending' && Number.isFinite(hoursNum)
                    ? estLineAmount(hoursNum, row.billRate)
                    : row.billAmount

                return (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2">{row.date}</td>
                    {activeTab !== 'voided' ? <td className="px-3 py-2">{row.clientName}</td> : null}
                    <td className="px-3 py-2">{row.caregiverName}</td>
                    <td className="px-3 py-2">{row.timeLabel}</td>
                    <td className="px-3 py-2 group">
                      {activeTab === 'pending' ? (
                        hoursEditingId === row.id ? (
                          <input
                            autoFocus
                            value={edit.hours}
                            onChange={(e) =>
                              setPendingEdits((prev) => ({ ...prev, [row.id]: { ...edit, hours: e.target.value } }))
                            }
                            onBlur={() => setHoursEditingId(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === 'Escape') setHoursEditingId(null)
                            }}
                            className="w-20 rounded border border-blue-300 px-2 py-1"
                            inputMode="decimal"
                          />
                        ) : (
                          <div className="flex items-center gap-1.5 min-h-[36px]">
                            <span className="tabular-nums">
                              {Number.isFinite(Number(edit.hours)) ? Number(edit.hours).toFixed(2) : edit.hours}
                            </span>
                            <button
                              type="button"
                              className="inline-flex p-1 rounded text-gray-400 opacity-0 group-hover:opacity-100 hover:text-blue-600 hover:bg-blue-50 transition-opacity"
                              aria-label="Edit hours"
                              onClick={() => setHoursEditingId(row.id)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )
                      ) : (
                        row.hours.toFixed(2)
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {activeTab === 'pending' ? (
                        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-100/80 p-0.5 gap-0.5">
                          <button
                            type="button"
                            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                              edit.serviceType === 'non_skilled'
                                ? 'bg-amber-400 text-amber-950 shadow-sm ring-1 ring-amber-500/40'
                                : 'text-gray-500 hover:bg-amber-100/60 hover:text-amber-900'
                            }`}
                            onClick={() =>
                              setPendingEdits((prev) => ({
                                ...prev,
                                [row.id]: { ...edit, serviceType: 'non_skilled' },
                              }))
                            }
                          >
                            Non-skilled
                          </button>
                          <button
                            type="button"
                            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                              edit.serviceType === 'skilled'
                                ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-700/30'
                                : 'text-gray-500 hover:bg-blue-50 hover:text-blue-700'
                            }`}
                            onClick={() =>
                              setPendingEdits((prev) => ({
                                ...prev,
                                [row.id]: { ...edit, serviceType: 'skilled' },
                              }))
                            }
                          >
                            Skilled
                          </button>
                        </div>
                      ) : (
                        <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                          {row.serviceType === 'skilled' ? 'Skilled' : 'Non-skilled'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{money(row.payRate)}/hr</td>
                    <td className="px-3 py-2 text-emerald-600 font-medium">{money(displayPay)}</td>
                    <td className="px-3 py-2">{money(row.billRate)}/hr</td>
                    <td className="px-3 py-2 text-fuchsia-600 font-medium">{money(displayBill)}</td>
                    <td className="px-3 py-2">
                      {activeTab === 'pending' ? (
                        <input
                          value={edit.note}
                          onChange={(e) =>
                            setPendingEdits((prev) => ({ ...prev, [row.id]: { ...edit, note: e.target.value } }))
                          }
                          className="w-full min-w-[10rem] max-w-[14rem] rounded border border-gray-200 px-2 py-1.5 text-sm"
                          placeholder="Optional note..."
                        />
                      ) : (
                        <span className="inline-block" title={row.note ?? undefined}>
                          {noteCellLabel(row.note)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {activeTab === 'pending' ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isPending}
                            className="rounded-full bg-emerald-600 text-white px-3 py-1 text-xs font-semibold disabled:opacity-60"
                            onClick={() => {
                              setError(null)
                              startTransition(async () => {
                                const res = await approveTimeBillingRowAction(pendingPayload(row))
                                if (res && 'error' in res && res.error) setError(res.error)
                              })
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            className="rounded-full border px-3 py-1 text-xs font-semibold text-gray-700 disabled:opacity-60"
                            onClick={() => {
                              setError(null)
                              startTransition(async () => {
                                const res = await voidTimeBillingRowAction(pendingPayload(row))
                                if (res && 'error' in res && res.error) setError(res.error)
                              })
                            }}
                          >
                            Void
                          </button>
                        </div>
                      ) : (
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                            row.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-gray-200 text-gray-600'
                          }`}
                        >
                          {toLabel(row.status)}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {list.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-gray-500" colSpan={12}>
                    No records found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
