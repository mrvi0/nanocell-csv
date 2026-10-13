/**
 * @file core/utils/date.ts
 * Pure calendar date validation and parsing utilities.
 * ZERO browser/DOM imports.
 */

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1) return false;
  const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export function parseDateCandidate(rawVal: unknown): { p1: number; p2: number; year: number; raw: string } | null {
  if (rawVal === undefined || rawVal === null) return null;
  const raw = String(rawVal).trim();
  const m = raw.match(/^(\d{1,2})[^0-9a-zA-Z]+(\d{1,2})[^0-9a-zA-Z]+(\d{4})$/);
  if (!m) return null;

  const p1 = parseInt(m[1], 10);
  const p2 = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (p1 < 1 || p1 > 31 || p2 < 1 || p2 > 31 || year < 1 || (p1 > 12 && p2 > 12)) return null;
  if ((p1 > 12 && !isValidCalendarDate(year, p2, p1)) || (p2 > 12 && !isValidCalendarDate(year, p1, p2))) return null;

  return { p1, p2, year, raw };
}

export function parseYearFirstDate(rawVal: unknown): { year: number; month: number; day: number; raw: string } | null {
  if (rawVal === undefined || rawVal === null) return null;
  const raw = String(rawVal).trim();
  const m = raw.match(/^(\d{4})[^0-9a-zA-Z]+(\d{1,2})[^0-9a-zA-Z]+(\d{1,2})$/);
  if (!m) return null;

  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  return isValidCalendarDate(year, month, day) ? { year, month, day, raw } : null;
}

export function isIsoDate(val: unknown): boolean {
  return typeof val === 'string' && val.length === 10 && /^\d{4}-[01]\d-[0123]\d$/.test(val);
}
