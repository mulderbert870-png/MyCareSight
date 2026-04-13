/**
 * Self-contained single file — required for Supabase Dashboard deploy (often only `index.ts` is uploaded).
 * Keep recurrence + horizon logic aligned with `src/lib/recurrence-dates.ts` and `src/lib/pct-week-horizon.ts`.
 *
 * Daily Edge Function: materialize scheduled_visits for active visit_series in the 21-day Pacific window.
 * Idempotent: upsert + ignoreDuplicates on (visit_series_id, visit_date); paginates visit_series (no 1000-row cap).
 * Secrets: CRON_SECRET (Bearer), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0'

// ---------------------------------------------------------------------------
// Pacific horizon (src/lib/pct-week-horizon.ts)
// ---------------------------------------------------------------------------
const PACIFIC_TZ = 'America/Los_Angeles'

function formatYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m, d }
}

function todayPacificDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function addCalendarDays(ymd: string, days: number): string {
  const { y, m, d } = parseYmd(ymd)
  const cur = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  cur.setUTCDate(cur.getUTCDate() + days)
  return formatYmd(cur.getUTCFullYear(), cur.getUTCMonth() + 1, cur.getUTCDate())
}

function getThreeWeekRollingWindowPacific(now?: Date): { windowStart: string; horizonEnd: string } {
  const windowStart = todayPacificDate(now ?? new Date())
  const horizonEnd = addCalendarDays(windowStart, 20)
  return { windowStart, horizonEnd }
}

// ---------------------------------------------------------------------------
// Recurrence (src/lib/recurrence-dates.ts)
// ---------------------------------------------------------------------------
function toYmdFromUtcDate(d: Date): string {
  return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

function datesBetween(startStr: string, endStr: string): string[] {
  const out: string[] = []
  const [sy, sm, sd] = startStr.split('-').map(Number)
  const [ey, em, ed] = endStr.split('-').map(Number)
  const cur = new Date(Date.UTC(sy, sm - 1, sd, 12, 0, 0))
  const end = new Date(Date.UTC(ey, em - 1, ed, 12, 0, 0))
  while (cur <= end && out.length < 10000) {
    out.push(toYmdFromUtcDate(cur))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

function datesWeeklyBetween(startStr: string, endStr: string, daysOfWeek: number[]): string[] {
  const set = new Set(daysOfWeek.map((n) => Math.min(6, Math.max(0, Math.floor(n)))))
  return datesBetween(startStr, endStr).filter((dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
    return set.has(dt.getUTCDay())
  })
}

function getOrdinalWeekdayInMonth(
  year: number,
  month: number,
  ordinal: 1 | 2 | 3 | 4 | 5,
  weekday: number
): string | null {
  const wd = Math.min(6, Math.max(0, weekday))
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const sameWeekdayDates: number[] = []
  for (let date = 1; date <= lastDay; date++) {
    if (new Date(Date.UTC(year, month, date, 12, 0, 0)).getUTCDay() === wd) {
      sameWeekdayDates.push(date)
    }
  }
  if (sameWeekdayDates.length === 0) return null
  const index = ordinal === 5 ? sameWeekdayDates.length - 1 : Math.min(ordinal - 1, sameWeekdayDates.length - 1)
  const day = sameWeekdayDates[index]
  return formatYmd(year, month + 1, day)
}

function getAllWeekdayDatesInMonth(year: number, month: number, weekday: number): string[] {
  const wd = Math.min(6, Math.max(0, weekday))
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const out: string[] = []
  for (let date = 1; date <= lastDay; date++) {
    if (new Date(Date.UTC(year, month, date, 12, 0, 0)).getUTCDay() === wd) {
      out.push(formatYmd(year, month + 1, date))
    }
  }
  return out
}

function datesMonthlyBetween(
  startStr: string,
  endStr: string,
  ordinal: number,
  weekday: number
): string[] {
  const out: string[] = []
  const [sy, sm, sd] = startStr.split('-').map(Number)
  const [ey, em, ed] = endStr.split('-').map(Number)
  const start = new Date(Date.UTC(sy, sm - 1, sd, 12, 0, 0))
  const end = new Date(Date.UTC(ey, em - 1, ed, 12, 0, 0))
  let y = start.getUTCFullYear()
  let m = start.getUTCMonth()
  const wd = Math.min(6, Math.max(0, weekday))
  while (out.length < 500) {
    if (ordinal === 0) {
      for (const dateStr of getAllWeekdayDatesInMonth(y, m, wd)) {
        const d = new Date(dateStr + 'T12:00:00Z')
        if (d >= start && d <= end) out.push(dateStr)
      }
    } else {
      const ord = Math.min(5, Math.max(1, ordinal)) as 1 | 2 | 3 | 4 | 5
      const dateStr = getOrdinalWeekdayInMonth(y, m, ord, wd)
      if (dateStr) {
        const d = new Date(dateStr + 'T12:00:00Z')
        if (d >= start && d <= end) out.push(dateStr)
      }
    }
    m += 1
    if (m > 11) {
      m = 0
      y += 1
    }
    if (y > end.getUTCFullYear() || (y === end.getUTCFullYear() && m > end.getUTCMonth())) break
  }
  return out
}

function datesMonthlyBetweenFromRules(
  startStr: string,
  endStr: string,
  rules: { ordinal: number; weekday: number }[]
): string[] {
  const set = new Set<string>()
  for (const r of rules) {
    const ord = r.ordinal
    const wd = Math.min(6, Math.max(0, r.weekday))
    for (const d of datesMonthlyBetween(startStr, endStr, ord, wd)) set.add(d)
  }
  return Array.from(set).sort()
}

type ExpandSeriesOccurrencesParams = {
  repeat_frequency: string | null
  repeat_start: string
  repeat_end: string | null
  days_of_week: number[] | null
  repeat_monthly_rules: { ordinal: number; weekday: number }[] | null
  rangeStart: string
  rangeEnd: string
}

type ExpandSeriesOccurrencesMode = 'initial' | 'refill'

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

/** Keep aligned with src/lib/recurrence-dates.ts */
function expandSeriesOccurrences(
  p: ExpandSeriesOccurrencesParams,
  mode: ExpandSeriesOccurrencesMode = 'initial'
): string[] {
  const horizonStart = normalizeYmd(p.rangeStart) ?? p.rangeStart
  const horizonEnd = normalizeYmd(p.rangeEnd) ?? p.rangeEnd
  const repeatStartNorm = normalizeYmd(p.repeat_start) ?? p.repeat_start
  const repeatEndNorm = normalizeYmd(p.repeat_end)
  const fixedEnd = hasSeriesFixedEnd(repeatEndNorm) ? repeatEndNorm : null

  const capStart = repeatStartNorm > horizonStart ? repeatStartNorm : horizonStart

  let capEnd: string
  if (mode === 'refill') {
    capEnd = fixedEnd != null ? (fixedEnd < horizonEnd ? fixedEnd : horizonEnd) : horizonEnd
  } else {
    capEnd = fixedEnd != null ? fixedEnd : horizonEnd
  }

  if (capStart > capEnd) return []

  const freq = (p.repeat_frequency ?? '').trim().toLowerCase()
  switch (freq) {
    case 'daily':
      return datesBetween(capStart, capEnd)
    case 'weekly': {
      const days = p.days_of_week?.length ? p.days_of_week : []
      if (days.length === 0) return []
      return datesWeeklyBetween(capStart, capEnd, days)
    }
    case 'monthly': {
      const rules = p.repeat_monthly_rules?.filter(
        (r) => r.ordinal != null && r.weekday != null
      ) as { ordinal: number; weekday: number }[]
      if (!rules?.length) return []
      return datesMonthlyBetweenFromRules(capStart, capEnd, rules)
    }
    default:
      return []
  }
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

function parseMonthlyRules(raw: unknown): { ordinal: number; weekday: number }[] | null {
  if (raw == null || !Array.isArray(raw)) return null
  const out: { ordinal: number; weekday: number }[] = []
  for (const item of raw) {
    if (item && typeof item === 'object' && 'ordinal' in item && 'weekday' in item) {
      const o = (item as { ordinal: unknown }).ordinal
      const w = (item as { weekday: unknown }).weekday
      if (typeof o === 'number' && typeof w === 'number') out.push({ ordinal: o, weekday: w })
    }
  }
  return out.length ? out : null
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
  const { windowStart, horizonEnd } = getThreeWeekRollingWindowPacific()
  const startedAt = Date.now()

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

  let seriesProcessed = 0
  let visitsInserted = 0
  const errors: string[] = []

  for (const series of rows) {
    const rf = (series.repeat_frequency ?? '').trim().toLowerCase()
    if (!rf) continue
    if (rf !== 'daily' && rf !== 'weekly' && rf !== 'monthly') {
      errors.push(`series ${series.id}: unsupported repeat_frequency "${series.repeat_frequency}"; skip`)
      continue
    }

    if (rf === 'weekly' && (!series.days_of_week || series.days_of_week.length === 0)) {
      errors.push(`series ${series.id}: weekly recurrence has no days_of_week; skip`)
      continue
    }

    let monthly: { ordinal: number; weekday: number }[] | null = null
    if (rf === 'monthly') {
      monthly = parseMonthlyRules(series.repeat_monthly_rules)
      if (!monthly?.length) {
        errors.push(`series ${series.id}: monthly recurrence has no valid repeat_monthly_rules; skip`)
        continue
      }
    }
    const targetDates = expandSeriesOccurrences(
      {
        repeat_frequency: rf,
        repeat_start: series.repeat_start,
        repeat_end: series.repeat_end,
        days_of_week: series.days_of_week,
        repeat_monthly_rules: monthly,
        rangeStart: windowStart,
        rangeEnd: horizonEnd,
      },
      'refill'
    )

    if (targetDates.length === 0) continue

    const { data: tplInWin, error: twErr } = await supabase
      .from('scheduled_visits')
      .select(TEMPLATE_VISIT_SELECT)
      .eq('visit_series_id', series.id)
      .gte('visit_date', windowStart)
      .lte('visit_date', horizonEnd)
      .order('visit_date', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (twErr) {
      errors.push(`series ${series.id}: template(in-window) ${twErr.message}`)
      continue
    }

    let template = tplInWin as TemplateVisit | null
    if (!template) {
      const { data: tplFirst, error: tfErr } = await supabase
        .from('scheduled_visits')
        .select(TEMPLATE_VISIT_SELECT)
        .eq('visit_series_id', series.id)
        .order('visit_date', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (tfErr) {
        errors.push(`series ${series.id}: template(fallback) ${tfErr.message}`)
        continue
      }
      template = tplFirst as TemplateVisit | null
    }

    if (!template) {
      errors.push(`series ${series.id}: no template visit; skip`)
      continue
    }

    const t = template

    const { data: existingRows, error: exErr } = await supabase
      .from('scheduled_visits')
      .select('visit_date')
      .eq('visit_series_id', series.id)
      .gte('visit_date', windowStart)
      .lte('visit_date', horizonEnd)

    if (exErr) {
      errors.push(`series ${series.id}: existing ${exErr.message}`)
      continue
    }

    const existing = new Set((existingRows ?? []).map((r: { visit_date: string }) => r.visit_date))
    const missing = targetDates.filter((d) => !existing.has(d))
    if (missing.length === 0) {
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

    const CHUNK = 40
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK)
      const insertRows = chunk.map((visit_date) => ({
        agency_id: series.agency_id,
        visit_series_id: series.id,
        patient_id: series.patient_id,
        caregiver_member_id: series.primary_caregiver_member_id ?? t.caregiver_member_id,
        contract_id: series.contract_id,
        service_type: series.service_type,
        visit_date,
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
      }))

      const { data: inserted, error: insErr } = await supabase
        .from('scheduled_visits')
        .upsert(insertRows, {
          onConflict: 'visit_series_id,visit_date',
          ignoreDuplicates: true,
        })
        .select('id')

      if (insErr) {
        errors.push(`series ${series.id} upsert: ${insErr.message}`)
        break
      }

      const newIds = (inserted ?? []).map((r: { id: string }) => r.id)
      visitsInserted += newIds.length

      if (taskCodes.length > 0 && newIds.length > 0) {
        const taskInserts = newIds.flatMap((visitId: string) =>
          taskCodes.map((code, idx) => ({
            agency_id: series.agency_id,
            scheduled_visit_id: visitId,
            task_id: null,
            legacy_task_code: code,
            sort_order: idx,
          }))
        )
        const { error: taskInsErr } = await supabase.from('scheduled_visit_tasks').insert(taskInserts)
        if (taskInsErr) {
          errors.push(`series ${series.id} tasks: ${taskInsErr.message}`)
        }
      }
    }

    seriesProcessed++
  }

  return new Response(
    JSON.stringify({
      ok: true,
      window: { windowStart, horizonEnd },
      seriesTotal: rows.length,
      seriesProcessed,
      visitsInserted,
      durationMs: Date.now() - startedAt,
      errors: errors.length ? errors : undefined,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
