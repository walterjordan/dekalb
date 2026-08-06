// Program-day date handling. Attendance keys on "YYYY-MM-DD" in the TENANT's
// timezone, stored as a string, so a 7pm ET check-out never lands on tomorrow's
// UTC date. (See the pg/Prisma timestamp UTC-shift gotcha in jab-ops.)

export function todayInTz(timezone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function nowHHMM(timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

export function timeLabel(d: Date | null | undefined, timezone: string): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/** Minutes past "HH:MM" local right now; 0 if not yet past. */
export function minutesPast(hhmm: string, timezone: string): number {
  const now = nowHHMM(timezone);
  const [nh, nm] = now.split(':').map(Number);
  const [th, tm] = hhmm.split(':').map(Number);
  return Math.max(0, nh * 60 + nm - (th * 60 + tm));
}

/** End of the tenant's current program day as a Date (for "today only" expiry). */
export function endOfDayInTz(timezone: string): Date {
  const today = todayInTz(timezone);
  // 23:59 local expressed via the offset trick: parse local wall time.
  const probe = new Date(`${today}T23:59:00`);
  // Adjust: interpret the wall time in the tenant zone by comparing formatted output.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [h, m] = fmt.format(probe).split(':').map(Number);
  const driftMin = 23 * 60 + 59 - (h * 60 + m);
  return new Date(probe.getTime() + driftMin * 60_000);
}

/**
 * "Aug 5" in the school's own timezone.
 *
 * Use this instead of toISOString().slice(0,10) anywhere a date is shown next
 * to a local time. A UTC date beside an America/New_York time disagrees with
 * itself every evening: at 9:52 PM on the 5th, the ISO date already reads the
 * 6th. In an audit record that is meant to settle "when was my child collected",
 * that is not a cosmetic problem.
 */
export function dateLabel(d: Date | null | undefined, timezone: string): string {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { timeZone: timezone, month: 'short', day: 'numeric' });
}
