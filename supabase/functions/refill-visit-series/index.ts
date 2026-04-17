/**
 * Self-contained single file — required for Supabase Dashboard deploy (often only `index.ts` is uploaded).
 * Weekly recurrence only (days_of_week). All calendar math uses **UTC date** (YYYY-MM-DD via ISO UTC).
 *
 * Production refill (rolling “3 weeks” + week-4 extension):
 * - “Today” = current UTC calendar date.
 * - Refill only if the series has “started”: first weekly occurrence on/after repeat_start is on or before today (UTC).
 * - Test mode behavior: no max-coverage threshold gate; eligible series can refill every run.
 * - On each run, for each series: if **today’s UTC weekday** is in days_of_week, insert **at most one** visit on
 *   **todayUTC + 21 days** (same weekday → “that weekday in week 4” vs the current week). Example: Mon/Tue/Wed series,
 *   run on a Monday → adds the Monday that is 21 days ahead. No insert on days not in days_of_week.
 * - Respects repeat_end; idempotent upsert on (visit_series_id, visit_date).
 * - Same-patient overlap: if another scheduled_visit for the same patient_id on week4VisitDate has a
 *   time window that overlaps the template (same rule as coordinator UI: start/end in minutes UTC time),
 *   skip insert (for manual review). Rows with status completed or missed do not block.
 * Paginates visit_series (no 1000-row cap).
 * Secrets: CRON_SECRET (Bearer), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Schedule (Supabase pg_cron / Dashboard uses UTC):
 * - Target: every day at 23:00 UTC (11:00 PM UTC) → cron `0 23 * * *`.
 * - Update your `cron.schedule` (or Dashboard schedule) to match; the function does not choose its own run time.
 *
 * pg_cron + pg_net: `net.http_post` defaults to timeout_milliseconds=2000 (2s). This job often runs longer.
 * If the client times out first, logs show Shutdown reason "EarlyDrop" while work may still be in progress.
 * Pass a larger timeout (ms), e.g. 300000 (5 min), within platform limits:
 *   net.http_post(url:=..., headers:=..., body:=..., timeout_milliseconds:=300000)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0'

// ---------------------------------------------------------------------------
// UTC calendar dates (YYYY-MM-DD)
// ---------------------------------------------------------------------------

function formatYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m, d }
}

/** Current calendar date in UTC (matches scheduled_visits.visit_date storage as date). */
function todayUtcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function addCalendarDays(ymd: string, days: number): string {
  const { y, m, d } = parseYmd(ymd)
  const cur = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  cur.setUTCDate(cur.getUTCDate() + days)
  return formatYmd(cur.getUTCFullYear(), cur.getUTCMonth() + 1, cur.getUTCDate())
}

function ymdUtcWeekday(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()
}

/** Rolling reference window [today, today+20] UTC (21 days) — used in API response only. */
function getRollingWindowUtc(now?: Date): { windowStart: string; horizonEnd: string } {
  const windowStart = todayUtcDate(now ?? new Date())
  const horizonEnd = addCalendarDays(windowStart, 20)
  return { windowStart, horizonEnd }
}

// ---------------------------------------------------------------------------
// Recurrence (src/lib/recurrence-dates.ts)
// ---------------------------------------------------------------------------
/** First calendar date >= startYmd whose weekday is in daysOfWeek (UTC noon date math). */
function firstWeeklyOccurrenceOnOrAfter(startYmd: string, daysOfWeek: number[]): string | null {
  const set = new Set(daysOfWeek.map((n) => Math.min(6, Math.max(0, Math.floor(n)))))
  if (set.size === 0) return null
  let cur = startYmd
  for (let i = 0; i < 800; i++) {
    const [y, m, d] = cur.split('-').map(Number)
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
    if (set.has(dt.getUTCDay())) return cur
    cur = addCalendarDays(cur, 1)
  }
  return null
}

function hasSeriesFixedEnd(repeatEnd: string | null | undefined): repeatEnd is string {
  return repeatEnd != null && String(repeatEnd).trim() !== ''
}

/** Strip time from timestamptz strings (keep in sync with src/lib/recurrence-dates.ts). */
function normalizeYmd(s: string | null | undefined): string | null {
  if (s == null) return null
  const t = String(s).trim()
  if (!t) return null
  const d = t.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

/** Parse TIME column (HH:MM or HH:MM:SS) to minutes from midnight; null if unusable. */
function timeStringToMinutes(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  const head = s.length >= 5 ? s.slice(0, 5) : s
  const parts = head.split(':').map((x) => parseInt(x, 10))
  const h = parts[0]
  const m = parts[1]
  if (!Number.isFinite(h)) return null
  return h * 60 + (Number.isFinite(m) ? m : 0)
}

/** Same overlap rule as coordinator Add Visit (ClientDetailContent). */
function intervalsOverlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart
}

const NON_BLOCKING_OVERLAP_STATUSES = new Set(['completed', 'missed'])

type SameDayVisitRow = {
  id: string
  scheduled_start_time: string | null
  scheduled_end_time: string | null
  status: string | null
}

/** Returns conflicting visit id if any same-day visit blocks the candidate window. */
function findPatientTimeOverlap(
  sameDayVisits: SameDayVisitRow[],
  candidateStart: string | null,
  candidateEnd: string | null
): string | null {
  const cs = timeStringToMinutes(candidateStart)
  const ce = timeStringToMinutes(candidateEnd)
  if (cs == null || ce == null) return null
  if (ce <= cs) return null

  for (const v of sameDayVisits) {
    const st = (v.status ?? '').toLowerCase()
    if (NON_BLOCKING_OVERLAP_STATUSES.has(st)) continue
    const vs = timeStringToMinutes(v.scheduled_start_time)
    const ve = timeStringToMinutes(v.scheduled_end_time)
    if (vs == null || ve == null) continue
    if (ve <= vs) continue
    if (intervalsOverlapMinutes(cs, ce, vs, ve)) return v.id
  }
  return null
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
type VisitSeriesRow = {
  id: string
  agency_id: string
  patient_id: string
  primary_caregiver_member_id: string | null
  contract_id: string | null
  service_type: string
  series_name: string | null
  repeat_frequency: string | null
  days_of_week: number[] | null
  repeat_start: string
  repeat_end: string | null
  repeat_monthly_rules: unknown
  notes: string | null
  status: string
}

type TemplateVisit = {
  id: string
  caregiver_member_id: string | null
  scheduled_start_time: string | null
  scheduled_end_time: string | null
  description: string | null
  notes: string | null
  visit_type: string | null
}

const TEMPLATE_VISIT_SELECT =
  'id, caregiver_member_id, scheduled_start_time, scheduled_end_time, description, notes, visit_type'

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret?.length) {
    return new Response(JSON.stringify({ error: 'CRON_SECRET is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const auth = req.headers.get('Authorization')
  if (auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Missing Supabase env' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const { windowStart, horizonEnd } = getRollingWindowUtc()
  const startedAt = Date.now()
  console.log('[refill-visit-series] start', { windowStart, horizonEnd, tz: 'UTC' })

  /** PostgREST defaults to ~1000 rows; paginate so every active series is processed. */
  const SERIES_PAGE = 400
  const rows: VisitSeriesRow[] = []
  for (let from = 0; ; from += SERIES_PAGE) {
    const { data: page, error: seriesErr } = await supabase
      .from('visit_series')
      .select(
        'id, agency_id, patient_id, primary_caregiver_member_id, contract_id, service_type, series_name, repeat_frequency, days_of_week, repeat_start, repeat_end, repeat_monthly_rules, notes, status'
      )
      .eq('status', 'active')
      .order('id', { ascending: true })
      .range(from, from + SERIES_PAGE - 1)

    if (seriesErr) {
      return new Response(JSON.stringify({ error: seriesErr.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (!page?.length) break
    rows.push(...(page as VisitSeriesRow[]))
    if (page.length < SERIES_PAGE) break
  }

  console.log('[refill-visit-series] active series loaded', { count: rows.length })

  let seriesProcessed = 0
  let visitsInserted = 0
  let visitsSkippedPatientOverlap = 0
  const errors: string[] = []
  const skipStats: Record<string, number> = {}
  const countSkip = (reason: string) => {
    skipStats[reason] = (skipStats[reason] ?? 0) + 1
  }
  const todayDow = ymdUtcWeekday(windowStart)

  for (const series of rows) {
    const rf = (series.repeat_frequency ?? '').trim().toLowerCase()
    if (rf !== 'weekly') {
      countSkip('not_weekly')
      if (rf === 'daily' || rf === 'monthly') {
        errors.push(`series ${series.id}: refill supports weekly recurrence only; skip`)
      } else if (rf) {
        errors.push(`series ${series.id}: unsupported repeat_frequency "${series.repeat_frequency}"; skip`)
      }
      continue
    }

    if (!series.days_of_week || series.days_of_week.length === 0) {
      countSkip('missing_days_of_week')
      errors.push(`series ${series.id}: weekly recurrence has no days_of_week; skip`)
      continue
    }

    const repeatStartYmd = normalizeYmd(series.repeat_start)
    if (!repeatStartYmd) {
      countSkip('invalid_repeat_start')
      errors.push(`series ${series.id}: invalid repeat_start; skip`)
      continue
    }
    const firstScheduled = firstWeeklyOccurrenceOnOrAfter(repeatStartYmd, series.days_of_week)
    if (!firstScheduled || firstScheduled > windowStart) {
      countSkip('not_started_yet')
      console.log('[refill-visit-series] skip:not-started', {
        seriesId: series.id,
        repeatStartYmd,
        firstScheduled,
        windowStart,
      })
      continue
    }

    const daySet = new Set(series.days_of_week.map((n) => Math.min(6, Math.max(0, Math.floor(n)))))
    if (!daySet.has(todayDow)) {
      countSkip('weekday_not_today')
      console.log('[refill-visit-series] skip:weekday-not-today', {
        seriesId: series.id,
        windowStart,
        todayDow,
        daysOfWeek: [...daySet].sort((a, b) => a - b),
      })
      continue
    }

    const week4VisitDate = addCalendarDays(windowStart, 21)
    if (week4VisitDate < firstScheduled) {
      countSkip('candidate_before_first')
      console.log('[refill-visit-series] skip:candidate-before-first', {
        seriesId: series.id,
        week4VisitDate,
        firstScheduled,
      })
      continue
    }
    const repeatEndNorm = normalizeYmd(series.repeat_end)
    if (hasSeriesFixedEnd(repeatEndNorm) && week4VisitDate > repeatEndNorm!) {
      countSkip('candidate_after_repeat_end')
      console.log('[refill-visit-series] skip:after-repeat-end', {
        seriesId: series.id,
        week4VisitDate,
        repeatEnd: repeatEndNorm,
      })
      continue
    }

    const { data: tplFirst, error: tfErr } = await supabase
      .from('scheduled_visits')
      .select(TEMPLATE_VISIT_SELECT)
      .eq('visit_series_id', series.id)
      .order('visit_date', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (tfErr) {
      countSkip('template_query_error')
      errors.push(`series ${series.id}: template ${tfErr.message}`)
      continue
    }

    const template = tplFirst as TemplateVisit | null
    if (!template) {
      countSkip('missing_template')
      errors.push(`series ${series.id}: no template visit; skip`)
      continue
    }

    const t = template

    const { data: existingCandidate, error: exOneErr } = await supabase
      .from('scheduled_visits')
      .select('id')
      .eq('visit_series_id', series.id)
      .eq('visit_date', week4VisitDate)
      .maybeSingle()

    if (exOneErr) {
      countSkip('candidate_lookup_error')
      errors.push(`series ${series.id}: existing candidate ${exOneErr.message}`)
      continue
    }

    if (existingCandidate) {
      countSkip('already_exists')
      console.log('[refill-visit-series] skip:already-exists', {
        seriesId: series.id,
        visitDate: week4VisitDate,
      })
      seriesProcessed++
      continue
    }

    const { data: sameDayRows, error: sameDayErr } = await supabase
      .from('scheduled_visits')
      .select('id, scheduled_start_time, scheduled_end_time, status')
      .eq('agency_id', series.agency_id)
      .eq('patient_id', series.patient_id)
      .eq('visit_date', week4VisitDate)

    if (sameDayErr) {
      countSkip('patient_same_day_query_error')
      errors.push(`series ${series.id}: same-day overlap query ${sameDayErr.message}`)
      continue
    }

    const conflictId = findPatientTimeOverlap(
      (sameDayRows ?? []) as SameDayVisitRow[],
      t.scheduled_start_time,
      t.scheduled_end_time
    )
    if (conflictId) {
      countSkip('patient_time_overlap')
      visitsSkippedPatientOverlap++
      console.log('[refill-visit-series] skip:patient-time-overlap', {
        seriesId: series.id,
        patientId: series.patient_id,
        visitDate: week4VisitDate,
        conflictingVisitId: conflictId,
      })
      seriesProcessed++
      continue
    }

    const { data: taskRows } = await supabase
      .from('scheduled_visit_tasks')
      .select('legacy_task_code, sort_order')
      .eq('scheduled_visit_id', t.id)
      .order('sort_order', { ascending: true })

    const tasks = (taskRows ?? []) as { legacy_task_code: string | null; sort_order: number | null }[]
    const taskCodes = tasks.map((x) => (x.legacy_task_code ?? '').trim()).filter(Boolean)

    const insertRow = {
      agency_id: series.agency_id,
      visit_series_id: series.id,
      patient_id: series.patient_id,
      caregiver_member_id: series.primary_caregiver_member_id ?? t.caregiver_member_id,
      contract_id: series.contract_id,
      service_type: series.service_type,
      visit_date: week4VisitDate,
      scheduled_start_time: t.scheduled_start_time,
      scheduled_end_time: t.scheduled_end_time,
      description: t.description,
      notes: t.notes ?? series.notes,
      visit_type: t.visit_type ?? series.series_name,
      status: 'scheduled',
      is_recurring: true,
      repeat_frequency: series.repeat_frequency,
      days_of_week: series.days_of_week,
      repeat_start: series.repeat_start,
      repeat_end: series.repeat_end,
      repeat_monthly_rules: series.repeat_monthly_rules,
    }

    const { data: inserted, error: insErr } = await supabase
      .from('scheduled_visits')
      .upsert([insertRow], {
        onConflict: 'visit_series_id,visit_date',
        ignoreDuplicates: true,
      })
      .select('id')

    let insertedRows = inserted ?? []
    if (insErr) {
      const upsertErrMsg = String(insErr.message ?? '')
      if (upsertErrMsg.includes('no unique or exclusion constraint matching the ON CONFLICT specification')) {
        // Compatibility fallback for environments where the unique index migration has not been applied yet.
        const { data: insertedFallback, error: fallbackErr } = await supabase
          .from('scheduled_visits')
          .insert([insertRow])
          .select('id')
        if (fallbackErr) {
          countSkip('insert_error')
          errors.push(`series ${series.id} insert(fallback): ${fallbackErr.message}`)
          continue
        }
        insertedRows = insertedFallback ?? []
        console.log('[refill-visit-series] used-fallback-insert-no-unique-constraint', {
          seriesId: series.id,
          visitDate: week4VisitDate,
        })
      } else {
        countSkip('insert_error')
        errors.push(`series ${series.id} upsert: ${insErr.message}`)
        continue
      }
    }

    const newIds = insertedRows.map((r: { id: string }) => r.id)
    visitsInserted += newIds.length
    console.log('[refill-visit-series] inserted-week4-visit', {
      seriesId: series.id,
      visitDate: week4VisitDate,
      insertedVisitIds: newIds,
    })

    if (taskCodes.length > 0 && newIds.length > 0) {
      const visitId = newIds[0]
      const taskInserts = taskCodes.map((code, idx) => ({
        agency_id: series.agency_id,
        scheduled_visit_id: visitId,
        task_id: null,
        legacy_task_code: code,
        sort_order: idx,
      }))
      const { error: taskInsErr } = await supabase.from('scheduled_visit_tasks').insert(taskInserts)
      if (taskInsErr) {
        errors.push(`series ${series.id} tasks: ${taskInsErr.message}`)
      }
    }

    seriesProcessed++
  }

  const durationMs = Date.now() - startedAt
  const payload = {
    ok: true,
    window: { windowStart, horizonEnd },
    seriesTotal: rows.length,
    seriesProcessed,
    visitsInserted,
    visitsSkippedPatientOverlap,
    durationMs,
    errors: errors.length ? errors : undefined,
  }
  console.log('[refill-visit-series] done', {
    seriesTotal: rows.length,
    seriesProcessed,
    visitsInserted,
    visitsSkippedPatientOverlap,
    durationMs,
    errorCount: errors.length,
    skipStats,
  })
  if (errors.length) {
    console.log('[refill-visit-series] errors', errors)
  }

  return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } })
})
