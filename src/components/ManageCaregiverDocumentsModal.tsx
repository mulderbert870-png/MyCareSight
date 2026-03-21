'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/Modal'
import { createClient } from '@/lib/supabase/client'
import * as q from '@/lib/supabase/query'
import type { PatientDocument } from '@/lib/supabase/query/patients'
import { FileText, Upload, Download, Trash2, Loader2 } from 'lucide-react'
import { sanitizeDownloadFilename } from '@/lib/download-filename'

const BUCKET = 'staff-member-documents'
const LOG = '[CaregiverDocs]'

/** Set NEXT_PUBLIC_DEBUG_CAREGIVER_DOCS=true in .env.local to log in production builds while debugging. */
function caregiverDocsDebugEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'development' ||
    process.env.NEXT_PUBLIC_DEBUG_CAREGIVER_DOCS === 'true'
  )
}

function logCaregiverDocs(phase: string, data?: Record<string, unknown>): void {
  if (!caregiverDocsDebugEnabled()) return
  // if (data !== undefined) console.log(LOG, phase, data)
  // else console.log(LOG, phase)
}

function logCaregiverDocsError(
  phase: string,
  err: unknown,
  extra?: Record<string, unknown>
): void {
  if (!caregiverDocsDebugEnabled()) return
  // Log `err` as a separate argument so DevTools shows PostgrestError (code, details, hint, statusCode).
  console.error(LOG, phase, extra ?? {}, err)
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err && (err as { message: unknown }).message != null) {
    return String((err as { message: unknown }).message)
  }
  return 'Something went wrong'
}

function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '0 B'
  if (bytes === 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${u[i]}`
}

interface ManageCaregiverDocumentsModalProps {
  isOpen: boolean
  onClose: () => void
  staffMemberId: string
  caregiverName: string
  initialDocuments: PatientDocument[] | null | undefined
}

export default function ManageCaregiverDocumentsModal({
  isOpen,
  onClose,
  staffMemberId,
  caregiverName,
  initialDocuments,
}: ManageCaregiverDocumentsModalProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [docs, setDocs] = useState<PatientDocument[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const raw = initialDocuments
    setDocs(Array.isArray(raw) ? [...raw] : [])
    setError(null)
  }, [isOpen, staffMemberId, initialDocuments])

  const safeClose = () => {
    if (isUploading || deletingId) return
    onClose()
  }

  /**
   * Use updateStaffMemberDocuments (update + select single). Plain .update() without .select()
   * returns error: null when RLS blocks the row — the UI looked successful but DB never changed.
   */
  const persist = async (next: PatientDocument[]) => {
    logCaregiverDocs('persist:start', {
      staffMemberId,
      documentCount: next.length,
      supabaseUrlHost: (() => {
        try {
          return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').host || '(unset)'
        } catch {
          return '(invalid NEXT_PUBLIC_SUPABASE_URL)'
        }
      })(),
    })
    const supabase = createClient()
    const { data, error: updateError } = await q.updateStaffMemberDocuments(supabase, staffMemberId, next)
    if (updateError) {
      const ue = updateError as {
        code?: string
        message?: string
        details?: string
        hint?: string
      }
      logCaregiverDocsError('persist:updateStaffMemberDocuments error', updateError, {
        code: ue.code,
        message: ue.message,
        details: ue.details,
        hint: ue.hint,
        staffMemberId,
      })
      const code = ue.code
      const msg = ue.message || 'Update failed'
      const rlsHint =
        code === 'PGRST116' || /0 rows|no rows|contains 0 rows/i.test(msg)
          ? ' Your user is not allowed to update this caregiver row (Row Level Security on staff_members), or the row id is wrong. Sign in as the client owner who manages this caregiver, or ask an admin to adjust RLS.'
          : ''
      throw new Error(msg + rlsHint)
    }
    if (!data) {
      logCaregiverDocsError('persist:no data returned', new Error('data is null'), { staffMemberId })
      throw new Error('Update returned no row — documents were not saved. Check staff_members RLS UPDATE policies.')
    }
    logCaregiverDocs('persist:ok', { staffMemberId, returnedId: data.id })
    setDocs(next)
    router.refresh()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list?.length) return
    // Snapshot File objects BEFORE clearing the input. Setting `value = ''` mutates/clears the same
    // FileList on the input in many browsers, so any async gap (e.g. getUser()) would see length 0.
    const filesArray = Array.from(list)
    e.target.value = ''
    setError(null)
    setIsUploading(true)
    const supabase = createClient()
    logCaregiverDocs('handleFileChange:start', {
      fileCount: filesArray.length,
      names: filesArray.map((f) => f.name),
      sizes: filesArray.map((f) => f.size),
      staffMemberId,
      caregiverName,
      existingDocCount: docs.length,
      bucket: BUCKET,
    })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      logCaregiverDocs('handleFileChange:no auth user', {})
      setError('You must be logged in.')
      setIsUploading(false)
      return
    }
    logCaregiverDocs('handleFileChange:auth ok', { userId: user.id, email: user.email })
    const uploadedPaths: string[] = []
    try {
      const newDocs: PatientDocument[] = [...docs]
      for (let i = 0; i < filesArray.length; i++) {
        const file = filesArray[i]
        const docId = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${staffMemberId}/${docId}_${safeName}`
        logCaregiverDocs('storage.upload:attempt', {
          bucket: BUCKET,
          path,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || '(empty)',
        })
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
          cacheControl: '3600',
          upsert: false,
        })
        if (upErr) {
          logCaregiverDocsError('storage.upload:failed', upErr, {
            bucket: BUCKET,
            path,
            statusCode: (upErr as { statusCode?: string }).statusCode,
          })
          if (uploadedPaths.length > 0) await supabase.storage.from(BUCKET).remove(uploadedPaths)
          const upMsg = getErrorMessage(upErr)
          const hint =
            upMsg.toLowerCase().includes('bucket') || upMsg.toLowerCase().includes('not found')
              ? ' Ensure the bucket id is exactly `staff-member-documents` (not a typo) and exists — run migration phast_two/018_add_documents_column_on_staff_members_table.sql on this Supabase project.'
              : ''
          throw new Error(`Upload failed: ${upMsg}${hint}`)
        }
        uploadedPaths.push(path)
        logCaregiverDocs('storage.upload:ok', { path, uploadedSoFar: uploadedPaths.length })
        const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)
        newDocs.push({
          id: docId,
          name: file.name,
          path,
          url: publicUrl,
          uploaded_at: new Date().toISOString(),
          size: file.size,
        })
      }
      try {
        logCaregiverDocs('handleFileChange:calling persist', {
          newDocCount: newDocs.length,
          uploadedPaths,
        })
        await persist(newDocs)
        logCaregiverDocs('handleFileChange:complete success', { newDocCount: newDocs.length })
      } catch (persistErr: unknown) {
        // Do NOT delete Storage objects here. Previously we removed files on any error, so when the
        // DB update failed (RLS, missing `documents` column, etc.) the bucket looked empty even
        // though upload had succeeded — very confusing. Orphans can be removed from Dashboard → Storage.
        logCaregiverDocsError('handleFileChange:persist threw (files left in Storage)', persistErr, {
          uploadedPaths,
          staffMemberId,
        })
        const p = getErrorMessage(persistErr)
        setError(
          `${p} Files were uploaded to the bucket "${BUCKET}" under folder "${staffMemberId}/" but were not saved on the caregiver record. Check Storage in the dashboard, confirm migration 018 is applied, and RLS allows UPDATE on staff_members for your role.`
        )
        return
      }
    } catch (err: unknown) {
      logCaregiverDocsError('handleFileChange:outer catch (upload or unexpected)', err, {
        uploadedPathsBeforeCleanup: uploadedPaths,
        willRemoveFromStorage: uploadedPaths.length > 0,
      })
      setError(getErrorMessage(err))
      if (uploadedPaths.length > 0) await supabase.storage.from(BUCKET).remove(uploadedPaths)
    } finally {
      setIsUploading(false)
    }
  }

  const handleDelete = async (doc: PatientDocument) => {
    if (!confirm(`Delete “${doc.name}”?`)) return
    setDeletingId(doc.id)
    setError(null)
    try {
      logCaregiverDocs('handleDelete:start', { docId: doc.id, path: doc.path, staffMemberId })
      const supabase = createClient()
      await supabase.storage.from(BUCKET).remove([doc.path])
      const next = docs.filter((d) => d.id !== doc.id)
      await persist(next)
      logCaregiverDocs('handleDelete:ok', { staffMemberId, remaining: next.length })
    } catch (err: unknown) {
      logCaregiverDocsError('handleDelete:failed', err, { docId: doc.id, path: doc.path })
      setError(getErrorMessage(err))
    } finally {
      setDeletingId(null)
    }
  }

  const handleDownload = async (doc: PatientDocument) => {
    if (!doc.url) return
    setDownloadingId(doc.id)
    setError(null)
    try {
      const res = await fetch(doc.url)
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = sanitizeDownloadFilename(doc.name)
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch {
      try {
        window.open(doc.url, '_blank', 'noopener,noreferrer')
      } catch {
        setError('Could not download this file.')
      }
    } finally {
      setDownloadingId(null)
    }
  }

  const count = docs.length

  return (
    <Modal
      isOpen={isOpen}
      onClose={safeClose}
      title={
        <span className="inline-flex items-center gap-2">
          <FileText className="w-6 h-6 text-blue-600 shrink-0" aria-hidden />
          <span>Documents — {caregiverName}</span>
        </span>
      }
      subtitle="Manage documents for this caregiver. Upload new documents or delete existing ones."
      size="lg"
    >
      <div className="space-y-6">

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}

        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-2">
            <Upload className="w-4 h-4 text-blue-600" aria-hidden />
            Upload New Documents
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
            onChange={handleFileChange}
            disabled={isUploading}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed overflow-x-hidden"
          >
            {isUploading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading…
              </span>
            ) : (
              <span>
                <span className="font-medium text-gray-900">Choose Files</span>
                <span className="text-gray-500"> — No file chosen</span>
              </span>
            )}
          </button>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Uploaded Documents</h4>
          {docs.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No documents uploaded yet.</p>
          ) : (
            <ul className="space-y-2 overflow-x-hidden">
              {docs.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-blue-50/80 border border-blue-100 px-3 py-2.5 min-w-0"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FileText className="w-5 h-5 text-amber-600 shrink-0" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate" title={doc.name}>
                        {doc.name}
                      </p>
                      <p className="text-xs text-gray-500">{formatFileSize(doc.size)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {doc.url ? (
                      <button
                        type="button"
                        onClick={() => handleDownload(doc)}
                        disabled={downloadingId === doc.id || !!deletingId}
                        className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                        aria-label={`Download ${doc.name}`}
                      >
                        {downloadingId === doc.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleDelete(doc)}
                      disabled={deletingId === doc.id || isUploading}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      aria-label={`Delete ${doc.name}`}
                    >
                      {deletingId === doc.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-gray-200">
          <p className="text-sm text-gray-500">
            {count} document{count === 1 ? '' : 's'} uploaded
          </p>
          <button
            type="button"
            onClick={safeClose}
            disabled={isUploading}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
