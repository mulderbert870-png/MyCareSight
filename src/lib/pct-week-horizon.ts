/**
 * Rolling schedule horizon in US Pacific (PST/PDT): **21 consecutive calendar days**
 * starting **today** in Pacific (inclusive): today through today + 20 days.
 *
 * Edge copy is inlined in `supabase/functions/refill-visit-series/index.ts` (single-file deploy).
 */
export const PACIFIC_TZ = 'America/Los_Angeles'

/** Today's calendar date in Pacific, as YYYY-MM-DD. */
export function todayPacificDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m, d }
}

function formatYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function addCalendarDays(ymd: string, days: number): string {
  const { y, m, d } = parseYmd(ymd)
  const cur = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  cur.setUTCDate(cur.getUTCDate() + days)
  return formatYmd(cur.getUTCFullYear(), cur.getUTCMonth() + 1, cur.getUTCDate())
}

/**
 * Inclusive materialization range: Pacific **today** through **today + 20 days** (21 days total).
 */
export function getThreeWeekRollingWindowPacific(now?: Date): {
  windowStart: string
  horizonEnd: string
} {
  const windowStart = todayPacificDate(now ?? new Date())
  const horizonEnd = addCalendarDays(windowStart, 20)
  return { windowStart, horizonEnd }
}
