import { DateTime } from 'luxon';
import type { CallWindow } from '@/db/schema';

/** Countries with exactly one civil timezone, so the zone can be inferred safely from the country alone. */
export const SINGLE_TZ_COUNTRIES: Record<string, string> = {
  IN: 'Asia/Kolkata',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  AE: 'Asia/Dubai',
  SA: 'Asia/Riyadh',
  QA: 'Asia/Qatar',
  KW: 'Asia/Kuwait',
  OM: 'Asia/Muscat',
  BH: 'Asia/Bahrain',
  SG: 'Asia/Singapore',
  MY: 'Asia/Kuala_Lumpur',
  TH: 'Asia/Bangkok',
  VN: 'Asia/Ho_Chi_Minh',
  PH: 'Asia/Manila',
  PK: 'Asia/Karachi',
  BD: 'Asia/Dhaka',
  LK: 'Asia/Colombo',
  NP: 'Asia/Kathmandu',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
  CN: 'Asia/Shanghai',
  DE: 'Europe/Berlin',
  FR: 'Europe/Paris',
  IT: 'Europe/Rome',
  NL: 'Europe/Amsterdam',
  ES: 'Europe/Madrid',
  TR: 'Europe/Istanbul',
  ZA: 'Africa/Johannesburg',
  NG: 'Africa/Lagos',
  KE: 'Africa/Nairobi',
  EG: 'Africa/Cairo',
};

export function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  return DateTime.local().setZone(tz).isValid;
}

/** customer zone → single-zone country default → explicit campaign fallback → null (unknown; callers must fail closed). */
export function resolveTimezone(opts: {
  customerTimezone?: string | null;
  country?: string | null;
  campaignFallback?: string | null;
}): string | null {
  if (isValidTimezone(opts.customerTimezone)) return opts.customerTimezone;
  const byCountry = opts.country ? SINGLE_TZ_COUNTRIES[opts.country.toUpperCase()] : undefined;
  if (byCountry) return byCountry;
  if (isValidTimezone(opts.campaignFallback)) return opts.campaignFallback;
  return null;
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export type CountryWindow = { start: string; end: string; weekdays: number[] };

/** Effective windows = campaign windows clipped to the legal envelope of the country policy. */
export function intersectWindows(campaignWindows: CallWindow[], policy: CountryWindow | null): CallWindow[] {
  if (!policy) return campaignWindows;
  const out: CallWindow[] = [];
  for (const w of campaignWindows) {
    const days = w.days.filter((d) => policy.weekdays.includes(d));
    const start = Math.max(toMinutes(w.start), toMinutes(policy.start));
    const end = Math.min(toMinutes(w.end), toMinutes(policy.end));
    if (days.length && start < end) {
      const f = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
      out.push({ days, start: f(start), end: f(end) });
    }
  }
  return out;
}

export function isWithinWindows(now: Date, tz: string, windows: CallWindow[]): boolean {
  const local = DateTime.fromJSDate(now, { zone: tz });
  const minutes = local.hour * 60 + local.minute;
  return windows.some((w) => w.days.includes(local.weekday) && minutes >= toMinutes(w.start) && minutes < toMinutes(w.end));
}

/** Next instant (UTC Date) at which any window opens, looking up to 8 days ahead. Null if windows are empty. */
export function nextWindowOpen(now: Date, tz: string, windows: CallWindow[]): Date | null {
  if (!windows.length) return null;
  const local = DateTime.fromJSDate(now, { zone: tz });
  let best: DateTime | null = null;
  for (let offset = 0; offset <= 8; offset++) {
    const day = local.startOf('day').plus({ days: offset });
    for (const w of windows) {
      if (!w.days.includes(day.weekday)) continue;
      const [h, m] = w.start.split(':').map(Number);
      const start = day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
      if (start > local && (!best || start < best)) best = start;
    }
    if (best) break;
  }
  return best ? best.toUTC().toJSDate() : null;
}

/** Start of "today" in a given zone, as a UTC Date — used for per-day campaign limits. */
export function startOfDayInZone(now: Date, tz: string): Date {
  return DateTime.fromJSDate(now, { zone: tz }).startOf('day').toUTC().toJSDate();
}
