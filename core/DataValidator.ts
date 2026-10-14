/**
 * @file core/DataValidator.ts
 * Unified tabular data, header, and calendar date validator with declarative cell transforms.
 * ZERO browser/DOM imports.
 */

import { Dataframe } from './Dataframe.js';

export interface ValidationProposal {
  readonly x: number;
  readonly y: number;
  readonly oldValue: string;
  readonly newValue: string;
  status?: 'pending' | 'accepted' | 'rejected';
}

export interface ValidationRunResult {
  readonly proposals: ValidationProposal[];
  readonly reason?: 'coexistence' | 'ambiguous' | 'no_dates';
}

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

  const p1 = parseInt(m[1], 10), p2 = parseInt(m[2], 10), year = parseInt(m[3], 10);
  if (p1 < 1 || p1 > 31 || p2 < 1 || p2 > 31 || year < 1 || (p1 > 12 && p2 > 12)) return null;
  if ((p1 > 12 && !isValidCalendarDate(year, p2, p1)) || (p2 > 12 && !isValidCalendarDate(year, p1, p2))) return null;
  return { p1, p2, year, raw };
}

export function parseYearFirstDate(rawVal: unknown): { year: number; month: number; day: number; raw: string } | null {
  if (rawVal === undefined || rawVal === null) return null;
  const raw = String(rawVal).trim();
  const m = raw.match(/^(\d{4})[^0-9a-zA-Z]+(\d{1,2})[^0-9a-zA-Z]+(\d{1,2})$/);
  if (!m) return null;

  const year = parseInt(m[1], 10), month = parseInt(m[2], 10), day = parseInt(m[3], 10);
  return isValidCalendarDate(year, month, day) ? { year, month, day, raw } : null;
}

const isNum = (s: string) => Number.isFinite(Number(s));

const CELL_TRANSFORMS: Record<string, (val: string) => string> = {
  trim_whitespace: val => val.trim(),
  comma_decimals: val => {
    if (val.includes(',') && !isNum(val)) {
      const candidate = val.replace(',', '.');
      if (isNum(candidate)) return candidate;
    }
    return val;
  },
  line_returns: val => (!isNum(val) && val.includes('\n')) ? val.replaceAll('\n', '|') : val,
  double_quotes: val => (!isNum(val) && val.includes('"')) ? val.replaceAll('"', "'") : val,
  text_commas: val => (!isNum(val) && val.includes(',')) ? val.replaceAll(',', '-') : val,
  lowercase: val => !isNum(val) ? val.toLowerCase() : val
};

const fmtIsoDate = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export class DataValidator {
  static runRule(dataframe: Dataframe, ruleId: string): ValidationRunResult {
    if (ruleId === 'headers') return { proposals: this.validateHeaders(dataframe) };
    if (ruleId === 'dates') return this.validateDates(dataframe);
    const transform = CELL_TRANSFORMS[ruleId];
    return { proposals: transform ? this.scanCells(dataframe, transform) : [] };
  }

  static scanCells(dataframe: Dataframe, transform: (val: string) => string): ValidationProposal[] {
    const proposals: ValidationProposal[] = [];
    const rows = dataframe.data;
    const height = Math.min(dataframe.height, rows.length);
    const width = dataframe.width;

    for (let y = 0; y < height; y++) {
      const row = rows[y];
      if (!row) continue;
      const rowLen = Math.min(width, row.length);
      for (let x = 0; x < rowLen; x++) {
        const raw = row[x];
        if (!raw) continue;
        const oldValue = String(raw);
        const newValue = transform(oldValue);
        if (newValue !== oldValue) {
          proposals.push({ x, y, oldValue, newValue, status: 'pending' });
        }
      }
    }
    return proposals;
  }

  static validateHeaders(dataframe: Dataframe): ValidationProposal[] {
    const proposals: ValidationProposal[] = [];
    const seen = new Set<string>();

    for (let x = 0; x < dataframe.width; x++) {
      const oldValue = dataframe.get(x, 0);
      const base = (oldValue || `col_${x + 1}`).toLowerCase().replace(/[^a-z0-9]/g, '_');
      let candidate = base;
      let suffix = 1;
      while (seen.has(candidate)) candidate = `${base}_c${x + suffix++}`;
      seen.add(candidate);
      if (candidate !== oldValue) {
        proposals.push({ x, y: 0, oldValue, newValue: candidate, status: 'pending' });
      }
    }
    return proposals;
  }

  static validateDates(dataframe: Dataframe): ValidationRunResult {
    const yfList: { x: number; y: number; year: number; month: number; day: number; raw: string }[] = [];
    const ylList: { x: number; y: number; p1: number; p2: number; year: number; raw: string }[] = [];
    let dayFirst = 0, monthFirst = 0;

    const rows = dataframe.data;
    const height = Math.min(dataframe.height, rows.length);
    const width = dataframe.width;

    for (let y = 0; y < height; y++) {
      const row = rows[y];
      if (!row) continue;
      const rowLen = Math.min(width, row.length);
      for (let x = 0; x < rowLen; x++) {
        const val = row[x];
        if (!val) continue;
        const yf = parseYearFirstDate(val);
        if (yf) {
          yfList.push({ x, y, ...yf });
          continue;
        }
        const yl = parseDateCandidate(val);
        if (yl) {
          if (yl.p1 > 12) dayFirst++;
          else if (yl.p2 > 12) monthFirst++;
          ylList.push({ x, y, ...yl });
        }
      }
    }

    if (yfList.length === 0 && ylList.length === 0) {
      return { proposals: [], reason: 'no_dates' };
    }

    const proposals: ValidationProposal[] = [];
    for (const c of yfList) {
      const newValue = fmtIsoDate(c.year, c.month, c.day);
      if (c.raw !== newValue) proposals.push({ x: c.x, y: c.y, oldValue: c.raw, newValue, status: 'pending' });
    }

    let reason: 'coexistence' | 'ambiguous' | undefined;
    if (ylList.length > 0) {
      if (dayFirst > 0 && monthFirst > 0) {
        reason = 'coexistence';
      } else if (dayFirst === 0 && monthFirst === 0) {
        reason = 'ambiguous';
      } else {
        const isDayFirst = dayFirst > 0;
        for (const c of ylList) {
          const newValue = fmtIsoDate(c.year, isDayFirst ? c.p2 : c.p1, isDayFirst ? c.p1 : c.p2);
          if (c.raw !== newValue) proposals.push({ x: c.x, y: c.y, oldValue: c.raw, newValue, status: 'pending' });
        }
      }
    }

    return { proposals, reason };
  }
}
