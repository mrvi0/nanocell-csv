/**
 * @file app/core/DataValidator.ts
 * Unified tabular data, header, calendar date, and currency column validator with declarative rule registry.
 * ZERO browser/DOM imports.
 */

import { Dataframe, roundNumericString } from './Dataframe.js';

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

export interface CurrencyValidationResult {
  readonly changedCount: number;
  readonly formattedCount: number;
  readonly currencyCount: number;
  readonly insertedCol: boolean;
}

export interface ValidationRule {
  readonly id: string;
  readonly cmdId: string;
  readonly label: string;
  readonly cmdLabel: string;
  readonly description: string;
  readonly icon: string;
  readonly key?: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly mode?: 'column_select';
  readonly transform?: (val: string) => string;
}

const isNum = (s: string) => Number.isFinite(Number(s));

export const VALIDATION_RULES: readonly ValidationRule[] = [
  { id: 'headers', cmdId: 'validateHeaders', label: 'Headers & SQL Compliance', cmdLabel: 'Validate: Headers & SQL Compliance', description: 'Sanitize column headers for SQL identifier standards and duplicates', icon: 'validate_headers', key: 'H', ctrl: true, shift: true },
  { id: 'dates', cmdId: 'validateDates', label: 'Date Formats (YYYY-MM-DD)', cmdLabel: 'Validate: Date Formats (YYYY-MM-DD)', description: 'Standardize date formats across columns to YYYY-mm-dd', icon: 'date_checker' },
  { id: 'currency', cmdId: 'validateCurrency', label: 'Currency Column', cmdLabel: 'Validate: Currency Column', description: 'Extract currency symbols/ISO codes to a new column and format numbers', icon: 'decimal', mode: 'column_select' },
  { id: 'trim_whitespace', cmdId: 'validateWhitespace', label: 'Trim Whitespace', cmdLabel: 'Validate: Trim Whitespace', description: 'Remove leading and trailing whitespace from cell text', icon: 'trim', transform: val => val.trim() },
  { id: 'comma_decimals', cmdId: 'validateCommaDecimals', label: 'Decimal Comma -> Dot', cmdLabel: 'Validate: Decimal Comma -> Dot', description: 'Convert comma decimals (3,14) to dot notation in numeric fields', icon: 'decimal', transform: val => {
    if (val.includes(',') && !isNum(val)) {
      const candidate = val.replace(',', '.');
      if (isNum(candidate)) return candidate;
    }
    return val;
  } },
  { id: 'line_returns', cmdId: 'validateLineReturns', label: 'Line Returns -> Pipe', cmdLabel: 'Validate: Line Returns -> Pipe', description: 'Replace embedded newline line breaks with pipe character (|)', icon: 'replace', transform: val => (!isNum(val) && val.includes('\n')) ? val.replaceAll('\n', '|') : val },
  { id: 'double_quotes', cmdId: 'validateQuotes', label: 'Double Quotes -> Single', cmdLabel: 'Validate: Double Quotes -> Single', description: 'Replace double quotation marks (") with single quotes (\')', icon: 'replace', transform: val => (!isNum(val) && val.includes('"')) ? val.replaceAll('"', "'") : val },
  { id: 'text_commas', cmdId: 'validateTextCommas', label: 'Text Commas -> Dash', cmdLabel: 'Validate: Text Commas -> Dash', description: 'Replace commas inside text cells with hyphens (-)', icon: 'replace', transform: val => (!isNum(val) && val.includes(',')) ? val.replaceAll(',', '-') : val },
  { id: 'lowercase', cmdId: 'validateLowercase', label: 'Force Lowercase', cmdLabel: 'Validate: Force Lowercase', description: 'Convert all text cells to lowercase', icon: 'match_case', transform: val => !isNum(val) ? val.toLowerCase() : val },
];

// --- High-Performance Currency Token Registry & Compiled Matchers ---

const SYMBOL_ENTRIES: readonly [string, string][] = [
  ['CLP$', 'CLP'], ['COL$', 'COP'], ['Can$', 'CAD'], ['Mex$', 'MXN'], ['SFr.', 'CHF'],
  ['CA$', 'CAD'], ['AU$', 'AUD'], ['NZ$', 'NZD'], ['HK$', 'HKD'], ['NT$', 'TWD'],
  ['MX$', 'MXN'], ['US$', 'USD'], ['AR$', 'ARS'], ['CN¥', 'CNY'], ['JP¥', 'JPY'],
  ['Fr.', 'CHF'], ['Rs.', 'INR'], ['kr.', 'SEK'],
  ['C$', 'CAD'], ['A$', 'AUD'], ['S$', 'SGD'], ['R$', 'BRL'],
  ['zł', 'PLN'], ['Kč', 'CZK'],
  ['$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['￥', 'JPY'],
  ['₹', 'INR'], ['₩', 'KRW'], ['₽', 'RUB'], ['₺', 'TRY'], ['₪', 'ILS'],
  ['฿', 'THB'], ['₱', 'PHP'], ['₫', 'VND'], ['₴', 'UAH'], ['元', 'CNY'],
];

const ALPHA_ENTRIES: readonly [string, string][] = [
  ['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP'], ['JPY', 'JPY'], ['CHF', 'CHF'],
  ['CAD', 'CAD'], ['AUD', 'AUD'], ['CNY', 'CNY'], ['RMB', 'CNY'], ['HKD', 'HKD'],
  ['SGD', 'SGD'], ['NZD', 'NZD'], ['INR', 'INR'], ['KRW', 'KRW'], ['BRL', 'BRL'],
  ['MXN', 'MXN'], ['RUB', 'RUB'], ['TRY', 'TRY'], ['ZAR', 'ZAR'], ['SEK', 'SEK'],
  ['NOK', 'NOK'], ['DKK', 'DKK'], ['PLN', 'PLN'], ['THB', 'THB'], ['ILS', 'ILS'],
  ['AED', 'AED'], ['SAR', 'SAR'], ['TWD', 'TWD'], ['MYR', 'MYR'], ['IDR', 'IDR'],
  ['PHP', 'PHP'], ['VND', 'VND'], ['UAH', 'UAH'], ['CZK', 'CZK'], ['HUF', 'HUF'],
  ['CLP', 'CLP'], ['COP', 'COP'], ['ARS', 'ARS'],
  ['SFr', 'CHF'], ['Fr', 'CHF'], ['Rs', 'INR'], ['kr', 'SEK'],
  ['RM', 'MYR'], ['Rp', 'IDR'], ['Ft', 'HUF'],
];

const CURRENCY_LOOKUP = new Map<string, string>();
const STRICT_UPPER_ISO = new Set<string>();
for (const [tok, iso] of SYMBOL_ENTRIES) CURRENCY_LOOKUP.set(tok.toLowerCase(), iso);
for (const [tok, iso] of ALPHA_ENTRIES) {
  CURRENCY_LOOKUP.set(tok.toLowerCase(), iso);
  if (tok.length === 3 && tok === tok.toUpperCase()) STRICT_UPPER_ISO.add(tok);
}

const GENERIC_SYMBOLS = new Set(['$', '¥', '￥']);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SYMBOL_ALT = SYMBOL_ENTRIES.map(([k]) => escapeRe(k)).join('|');
const ALPHA_ALT = ALPHA_ENTRIES.map(([k]) => escapeRe(k)).join('|');

// Lookbehind-free anchored prefix/suffix regexes for V8 fast-path execution
const PREFIX_SYMBOL_RE = new RegExp(`^([+-]?\\s*)(${SYMBOL_ALT})\\s*`, 'i');
const PREFIX_ALPHA_RE = new RegExp(`^([+-]?\\s*)(${ALPHA_ALT})(?![a-zA-Z])\\s*`, 'i');
const SUFFIX_SYMBOL_RE = new RegExp(`\\s*(${SYMBOL_ALT})(\\s*[+-]?)$`, 'i');
const SUFFIX_ALPHA_RE = new RegExp(`(^|[^a-zA-Z])(${ALPHA_ALT})(\\s*[+-]?)$`, 'i');
const HEADER_BRACKET_RE = /^(.*?)\s*(?:\(\s*([^()]+?)\s*\)|\[\s*([^\[\]]+?)\s*\])$/;
const HAS_DIGIT_RE = /\d/;
const STRIP_CHARS_RE = /[\s'`\u2019\u2018]+/g;
const SWISS_DASH_RE = /[.,][-–—]+$/;
const US_THOUSANDS_DEC_RE = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})\.\d+$/;
const EU_THOUSANDS_DEC_RE = /^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/;
const US_THOUSANDS_INT_RE = /^[+-]?\d{1,3}(?:,\d{3})+$/;
const US_THOUSANDS_COMMA_DEC_RE = /^[+-]?\d{1,3}(?:,\d{3})+,\d{1,2}$/;
const EU_THOUSANDS_INT_RE = /^[+-]?\d{1,3}(?:\.\d{3})+$/;

export interface CurrencyExtractResult {
  readonly iso3: string | null;
  readonly remaining: string;
  readonly isHeaderAnnotation?: boolean;
}

export function extractCurrency(rawVal: unknown): CurrencyExtractResult {
  if (rawVal == null) return { iso3: null, remaining: '' };
  let s = String(rawVal).trim();
  if (!s) return { iso3: null, remaining: '' };

  const c0 = s.charCodeAt(0);
  const cLast = s.charCodeAt(s.length - 1);

  // Fast O(1) ASCII digit boundary guard: if both first and last chars are '0'..'9', no prefix/suffix currency exists
  if (c0 >= 48 && c0 <= 57 && cLast >= 48 && cLast <= 57) {
    return { iso3: null, remaining: s };
  }

  // Check for header-style trailing bracketed currency e.g. "Price (USD)" or "Amount [$]"
  if ((cLast === 41 || cLast === 93) && c0 !== 40 && c0 !== 91 && !HAS_DIGIT_RE.test(s)) {
    const hm = s.match(HEADER_BRACKET_RE);
    if (hm) {
      const inner = (hm[2] || hm[3] || '').trim();
      const iso = CURRENCY_LOOKUP.get(inner.toLowerCase());
      if (iso && (!/^[a-zA-Z]+$/.test(inner) || STRICT_UPPER_ISO.has(inner.toUpperCase()))) {
        return { iso3: iso, remaining: hm[1].trim(), isHeaderAnnotation: true };
      }
    }
  }

  const hasDigits = HAS_DIGIT_RE.test(s);

  // Unwrap accounting negative parentheses e.g. "($1,234.56)" or "(100 CHF)" when digits are present
  if (hasDigits) {
    if (c0 === 40 && cLast === 41) {
      s = '-' + s.slice(1, -1).trim();
    } else if ((c0 === 45 || c0 === 43) && s.slice(1).trimStart().startsWith('(') && cLast === 41) {
      const inner = s.slice(1).trimStart().slice(1, -1).trim();
      s = (c0 === 45 ? '-' : '+') + inner;
    }
  }

  let iso3: string | null = null;
  let matchedGeneric = false;

  const recordToken = (rawTok: string) => {
    const lower = rawTok.toLowerCase();
    const mapped = CURRENCY_LOOKUP.get(lower);
    if (!mapped) return;
    const isGeneric = GENERIC_SYMBOLS.has(rawTok);
    if (!iso3 || (matchedGeneric && !isGeneric)) {
      iso3 = mapped;
      matchedGeneric = isGeneric;
    }
  };

  // 1. Prefix extraction (up to 2 passes to handle combined "CAD $50" or "USD $100")
  if (!(c0 >= 48 && c0 <= 57)) {
    for (let pass = 0; pass < 2 && s.length > 0; pass++) {
      const symMatch = s.match(PREFIX_SYMBOL_RE);
      if (symMatch) {
        recordToken(symMatch[2]);
        s = (symMatch[1] ? symMatch[1].trim() : '') + s.slice(symMatch[0].length);
        s = s.trim();
        continue;
      }
      const alphaMatch = s.match(PREFIX_ALPHA_RE);
      if (alphaMatch) {
        const tok = alphaMatch[2];
        if (hasDigits || STRICT_UPPER_ISO.has(tok) && s === tok) {
          recordToken(tok);
          s = (alphaMatch[1] ? alphaMatch[1].trim() : '') + s.slice(alphaMatch[0].length);
          s = s.trim();
          continue;
        }
      }
      break;
    }
  }

  // 2. Suffix extraction (up to 2 passes to handle "100 € EUR" or "$100 USD")
  if (s.length > 0) {
    const endCh = s.charCodeAt(s.length - 1);
    if (!(endCh >= 48 && endCh <= 57)) {
      for (let pass = 0; pass < 2 && s.length > 0; pass++) {
        const symMatch = s.match(SUFFIX_SYMBOL_RE);
        if (symMatch) {
          recordToken(symMatch[1]);
          const trailSign = symMatch[2] ? symMatch[2].trim() : '';
          s = s.slice(0, s.length - symMatch[0].length).trim() + trailSign;
          continue;
        }
        const alphaMatch = s.match(SUFFIX_ALPHA_RE);
        if (alphaMatch) {
          const tok = alphaMatch[2];
          if (hasDigits || (STRICT_UPPER_ISO.has(tok) && s === tok)) {
            recordToken(tok);
            const prefixChar = alphaMatch[1] || '';
            const trailSign = alphaMatch[3] ? alphaMatch[3].trim() : '';
            const cutStart = s.length - alphaMatch[0].length + prefixChar.length;
            s = s.slice(0, cutStart).trim() + trailSign;
            continue;
          }
        }
        break;
      }
    }
  }

  return { iso3, remaining: s };
}

export function parseCurrencyNumber(rawText: string): string | null {
  if (!rawText) return null;
  let s = rawText.replace(STRIP_CHARS_RE, '');
  const len = s.length;
  if (len === 0) return null;

  // Handle accounting parentheses if currency was outside e.g. "(45,00) €" -> "(45,00)"
  const c0 = s.charCodeAt(0);
  const cLast = s.charCodeAt(len - 1);
  if (c0 === 40 && cLast === 41 && len > 2) {
    s = '-' + s.slice(1, -1);
  } else if ((c0 === 45 || c0 === 43) && s.charCodeAt(1) === 40 && cLast === 41 && len > 3) {
    s = s[0] + s.slice(2, -1);
  }

  // Check for Swiss dash cents (.- / ,- / .– / .—) vs trailing minus sign (123.45-)
  const endCode = s.charCodeAt(s.length - 1);
  if (endCode === 45 || endCode === 43 || endCode === 8211 || endCode === 8212) {
    const prevCode = s.length > 1 ? s.charCodeAt(s.length - 2) : 0;
    if (prevCode === 46 || prevCode === 44 || endCode === 8211 || endCode === 8212) {
      s = s.replace(SWISS_DASH_RE, '.00');
    } else if ((endCode === 45 || endCode === 43) && s.length > 1) {
      const firstCode = s.charCodeAt(0);
      if (firstCode !== 45 && firstCode !== 43) {
        s = (endCode === 45 ? '-' : '+') + s.slice(0, -1);
      }
    }
  }

  // Disambiguate comma and dot separators
  const firstComma = s.indexOf(',');
  const firstDot = s.indexOf('.');

  if (firstComma !== -1 && firstDot !== -1) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastDot > lastComma) {
      if (firstDot === lastDot && US_THOUSANDS_DEC_RE.test(s)) {
        s = s.replaceAll(',', '');
      } else {
        return null;
      }
    } else {
      if (firstComma === lastComma && EU_THOUSANDS_DEC_RE.test(s)) {
        s = s.replaceAll('.', '').replace(',', '.');
      } else {
        return null;
      }
    }
  } else if (firstComma !== -1) {
    const lastComma = s.lastIndexOf(',');
    if (firstComma === lastComma) {
      const afterLen = s.length - lastComma - 1;
      if (afterLen === 1 || afterLen === 2) {
        s = s.replace(',', '.');
      } else if (afterLen === 3 && US_THOUSANDS_INT_RE.test(s)) {
        s = s.replace(',', '');
      } else {
        return null;
      }
    } else if (US_THOUSANDS_INT_RE.test(s)) {
      s = s.replaceAll(',', '');
    } else if (US_THOUSANDS_COMMA_DEC_RE.test(s)) {
      s = s.slice(0, lastComma).replaceAll(',', '') + '.' + s.slice(lastComma + 1);
    } else {
      return null;
    }
  } else if (firstDot !== -1) {
    if (firstDot !== s.lastIndexOf('.')) {
      if (EU_THOUSANDS_INT_RE.test(s)) {
        s = s.replaceAll('.', '');
      } else {
        return null;
      }
    }
  }

  if (s.length === 0) return null;

  // Guard against hex/binary/octal literals (0x, 0b, 0o)
  if (s.length > 2) {
    const leadZero = s.charCodeAt(0) === 48 ? 1 : ((s.charCodeAt(0) === 45 || s.charCodeAt(0) === 43) && s.charCodeAt(1) === 48 ? 2 : 0);
    if (leadZero > 0) {
      const p = s.charCodeAt(leadZero) | 32;
      if (p === 120 || p === 98 || p === 111) return null; // 'x', 'b', 'o'
    }
  }

  const num = Number(s);
  if (!Number.isFinite(num)) return null;

  const sign = num < 0 ? -1 : 1;
  const scaled = Math.abs(num) * 100;
  const rounded = (sign * Math.round(scaled + Number.EPSILON * scaled)) / 100;
  return (rounded || 0).toFixed(2);
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1) return false;
  const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export function parseDateCandidate(rawVal: unknown): { p1: number; p2: number; year: number; raw: string } | null {
  if (rawVal == null) return null;
  const raw = String(rawVal).trim();
  const m = raw.match(/^(\d{1,2})[^0-9a-zA-Z]+(\d{1,2})[^0-9a-zA-Z]+(\d{4})$/);
  if (!m) return null;

  const p1 = parseInt(m[1], 10), p2 = parseInt(m[2], 10), year = parseInt(m[3], 10);
  if (p1 < 1 || p1 > 31 || p2 < 1 || p2 > 31 || year < 1 || (p1 > 12 && p2 > 12)) return null;
  if ((p1 > 12 && !isValidCalendarDate(year, p2, p1)) || (p2 > 12 && !isValidCalendarDate(year, p1, p2))) return null;
  return { p1, p2, year, raw };
}

export function parseYearFirstDate(rawVal: unknown): { year: number; month: number; day: number; raw: string } | null {
  if (rawVal == null) return null;
  const raw = String(rawVal).trim();
  const m = raw.match(/^(\d{4})[^0-9a-zA-Z]+(\d{1,2})[^0-9a-zA-Z]+(\d{1,2})$/);
  if (!m) return null;

  const year = parseInt(m[1], 10), month = parseInt(m[2], 10), day = parseInt(m[3], 10);
  return isValidCalendarDate(year, month, day) ? { year, month, day, raw } : null;
}

const fmtIsoDate = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export class DataValidator {
  static runRule(dataframe: Dataframe, ruleId: string): ValidationRunResult {
    if (ruleId === 'headers') return { proposals: this.validateHeaders(dataframe) };
    if (ruleId === 'dates') return this.validateDates(dataframe);
    const rule = VALIDATION_RULES.find(r => r.id === ruleId);
    return { proposals: rule?.transform ? this.scanCells(dataframe, rule.transform) : [] };
  }

  static validateCurrencyColumn(dataframe: Dataframe, colIndex: number): CurrencyValidationResult {
    if (dataframe.lock || colIndex < 0 || colIndex >= dataframe.width || dataframe.height === 0) {
      return { changedCount: 0, formattedCount: 0, currencyCount: 0, insertedCol: false };
    }

    const rows = dataframe.data;
    const height = dataframe.height;
    const swapCol = new Array<string>(height);
    const isoCol = new Array<string>(height);

    let changedCount = 0;
    let formattedCount = 0;
    let currencyCount = 0;
    let row0IsDataCurrency = false;

    for (let y = 0; y < height; y++) {
      const raw = rows[y]?.[colIndex] ?? '';
      if (!raw) {
        swapCol[y] = '';
        isoCol[y] = '';
        continue;
      }

      const { iso3, remaining, isHeaderAnnotation } = extractCurrency(raw);
      const formattedNum = parseCurrencyNumber(remaining);

      if (formattedNum !== null) {
        swapCol[y] = formattedNum;
        formattedCount++;
        if (iso3) {
          isoCol[y] = iso3;
          currencyCount++;
          if (y === 0) row0IsDataCurrency = true;
        } else {
          isoCol[y] = '';
        }
      } else if (iso3) {
        swapCol[y] = remaining;
        if (y === 0 && isHeaderAnnotation) {
          isoCol[y] = '';
          currencyCount++;
        } else {
          isoCol[y] = iso3;
          currencyCount++;
          if (y === 0 && !remaining) row0IsDataCurrency = true;
        }
      } else {
        swapCol[y] = raw;
        isoCol[y] = '';
      }

      if (swapCol[y] !== raw) changedCount++;
    }

    const insertedCol = currencyCount > 0;
    if (!insertedCol && changedCount === 0) {
      return { changedCount: 0, formattedCount: 0, currencyCount: 0, insertedCol: false };
    }

    if (insertedCol && !row0IsDataCurrency && !isoCol[0]) {
      const headerBase = swapCol[0].trim();
      isoCol[0] = headerBase ? `${headerBase}_currency` : 'currency';
    }

    // In-place swap undo/redo: stores a single swapCol array (50% less RAM) and splices isoCol in the same pass
    let applied = false;
    const toggle = () => {
      const insertNow = !applied;
      applied = insertNow;
      for (let y = 0; y < height; y++) {
        const row = rows[y];
        const tmp = row[colIndex];
        row[colIndex] = swapCol[y];
        swapCol[y] = tmp;
        if (insertedCol) {
          if (insertNow) row.splice(colIndex + 1, 0, isoCol[y]);
          else row.splice(colIndex + 1, 1);
        }
      }
    };

    dataframe.record(toggle, toggle);
    return { changedCount, formattedCount, currencyCount, insertedCol };
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
        if (newValue !== oldValue) proposals.push({ x, y, oldValue, newValue, status: 'pending' });
      }
    }
    return proposals;
  }

  static validateHeaders(dataframe: Dataframe): ValidationProposal[] {
    const proposals: ValidationProposal[] = [];
    const seen = new Set<string>();

    for (let x = 0; x < dataframe.width; x++) {
      const oldValue = dataframe.get(x, 0);
      const base = (oldValue || `col_${colIndexLabel(x)}`).toLowerCase().replace(/[^a-z0-9]/g, '_');
      let candidate = base;
      let suffix = 1;
      while (seen.has(candidate)) candidate = `${base}_c${x + suffix++}`;
      seen.add(candidate);
      if (candidate !== oldValue) proposals.push({ x, y: 0, oldValue, newValue: candidate, status: 'pending' });
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

    if (yfList.length === 0 && ylList.length === 0) return { proposals: [], reason: 'no_dates' };

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

function colIndexLabel(x: number): number {
  return x + 1;
}
