/**
 * @file core/Csv.ts
 * Streaming RFC 4180 CSV parser, delimiter auto-detector, and multi-format serializer
 * (CSV, TSV, JSON, Markdown) with selective quoting, strict mode, and fixed-width padding.
 * ZERO browser/DOM imports.
 */

import { CellValue, normalizeCellValue } from './Dataframe.js';

export interface CsvDialect {
  readonly delimiter: string;
  readonly quoteChar: string;
  readonly escapeChar: string;
  readonly lineTerminator: '\r\n' | '\n' | '\r';
  readonly hasHeaders: boolean;
  readonly isStrict: boolean;
  readonly fixedWidth?: number;
  readonly trimUnquotedWhitespace?: boolean;
  readonly quoteAlways?: boolean;
  readonly commentChar?: string;
}

export const DEFAULT_CSV_DIALECT: CsvDialect = {
  delimiter: ',',
  quoteChar: '"',
  escapeChar: '"',
  lineTerminator: '\r\n',
  hasHeaders: false,
  isStrict: false,
  fixedWidth: 0,
  trimUnquotedWhitespace: false,
  quoteAlways: false,
  commentChar: ''
};

export class SeparatorDetector {
  private static readonly CANDIDATES = [',', '\t', ';', '|'];
  private static readonly SAMPLE_LIMIT = 2000;

  static detect(sample: string, candidates: readonly string[] = SeparatorDetector.CANDIDATES): string {
    if (!sample || typeof sample !== 'string' || sample.length === 0) return ',';
    const text = sample.length > SeparatorDetector.SAMPLE_LIMIT
      ? sample.substring(0, SeparatorDetector.SAMPLE_LIMIT)
      : sample;

    const counts = new Array<number>(candidates.length).fill(0);
    let inQuotes = false;
    const len = text.length;

    for (let i = 0; i < len; i++) {
      const char = text[i];
      if (char === '"') {
        if (inQuotes && i + 1 < len && text[i + 1] === '"') i++;
        else inQuotes = !inQuotes;
      } else if (!inQuotes) {
        for (let j = 0; j < candidates.length; j++) {
          if (char === candidates[j]) {
            counts[j]++;
            break;
          }
        }
      }
    }

    let maxCount = 0;
    let dominantIndex = 0;
    for (let j = 0; j < counts.length; j++) {
      if (counts[j] > maxCount) {
        maxCount = counts[j];
        dominantIndex = j;
      }
    }
    return maxCount > 0 ? candidates[dominantIndex] : ',';
  }
}

export class CsvParser {
  private dialect: CsvDialect;
  private buffer = '';
  private textDecoder: TextDecoder | null = null;

  constructor(dialect?: Partial<CsvDialect>) {
    this.dialect = { ...DEFAULT_CSV_DIALECT, ...dialect };
    if (this.dialect.delimiter === 'TAB') {
      this.dialect = { ...this.dialect, delimiter: '\t' };
    }
  }

  reset(): void {
    this.buffer = '';
    this.textDecoder = null;
  }

  parseChunk(chunk: string | Uint8Array, isLastChunk: boolean): string[][] {
    let textChunk = '';
    if (chunk instanceof Uint8Array || ArrayBuffer.isView(chunk)) {
      this.textDecoder ??= new TextDecoder('utf-8', { fatal: false });
      textChunk = this.textDecoder.decode(chunk, { stream: !isLastChunk });
    } else if (typeof chunk === 'string') {
      textChunk = chunk;
    }

    let textToProcess = this.buffer + textChunk;
    if (this.buffer === '' && textToProcess.charCodeAt(0) === 0xFEFF) {
      textToProcess = textToProcess.slice(1);
    }
    const len = textToProcess.length;
    const sep = this.dialect.delimiter;
    const quote = this.dialect.quoteChar;
    const isBackslashEscape = (this.dialect.escapeChar ?? '"') === '\\';
    const commentChar = this.dialect.commentChar ?? '';
    const trimUnquoted = this.dialect.trimUnquotedWhitespace ?? false;

    let parsedRows: string[][] = [];
    let i = 0;
    let inQuotes = false;
    let cellWasQuoted = false;
    let quoteClosed = false;
    let currentCell = '';
    let currentRow: string[] = [];
    let lastSafeIndex = 0;
    let segmentStart = 0;

    const unescapeChar = (ch: string) =>
      ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 't' ? '\t' : ch;

    while (i < len) {
      const c = textToProcess[i];

      if (commentChar && !inQuotes && currentRow.length === 0 && currentCell === '') {
        let checkIdx = i;
        while (checkIdx < len && (textToProcess[checkIdx] === ' ' || textToProcess[checkIdx] === '\t')) checkIdx++;
        if (checkIdx < len && textToProcess.startsWith(commentChar, checkIdx)) {
          i = checkIdx;
          while (i < len && textToProcess[i] !== '\n' && textToProcess[i] !== '\r') i++;
          if (i < len) {
            i += (textToProcess[i] === '\r' && i + 1 < len && textToProcess[i + 1] === '\n') ? 2 : 1;
            lastSafeIndex = segmentStart = i;
          } else {
            if (!isLastChunk) break;
            lastSafeIndex = segmentStart = i;
          }
          continue;
        }
      }

      if (inQuotes) {
        if (isBackslashEscape && c === '\\') {
          if (i + 1 < len) {
            if (i > segmentStart) currentCell += textToProcess.slice(segmentStart, i);
            currentCell += unescapeChar(textToProcess[i + 1]);
            segmentStart = i += 2;
          } else if (isLastChunk) {
            i++;
          } else {
            break;
          }
        } else if (c === quote) {
          if (i > segmentStart) currentCell += textToProcess.slice(segmentStart, i);
          if (i + 1 < len) {
            if (textToProcess[i + 1] === quote) {
              currentCell += quote;
              segmentStart = i += 2;
            } else {
              inQuotes = false;
              cellWasQuoted = quoteClosed = true;
              segmentStart = ++i;
            }
          } else if (isLastChunk) {
            inQuotes = false;
            cellWasQuoted = quoteClosed = true;
            segmentStart = ++i;
          } else {
            break;
          }
        } else {
          i++;
        }
      } else {
        if (isBackslashEscape && c === '\\') {
          if (i + 1 < len) {
            const next = textToProcess[i + 1];
            if (next === sep || next === quote || next === '\\' || next === 'n' || next === 'r' || next === 't') {
              if (i > segmentStart) currentCell += textToProcess.slice(segmentStart, i);
              currentCell += unescapeChar(next);
              segmentStart = i += 2;
            } else {
              i++;
            }
          } else if (isLastChunk) {
            i++;
          } else {
            break;
          }
        } else if (c === quote) {
          if (i > segmentStart) currentCell += textToProcess.slice(segmentStart, i);
          if (trimUnquoted && currentCell.trim() === '') currentCell = '';
          inQuotes = cellWasQuoted = true;
          quoteClosed = false;
          segmentStart = ++i;
        } else if (quoteClosed && trimUnquoted && (c === ' ' || c === '\t')) {
          segmentStart = ++i;
        } else if (c === sep) {
          if (i > segmentStart) currentCell += textToProcess.slice(segmentStart, i);
          currentRow.push((!cellWasQuoted && trimUnquoted) ? currentCell.trim() : currentCell);
          currentCell = '';
          cellWasQuoted = quoteClosed = false;
          segmentStart = ++i;
        } else if (c === '\n' || c === '\r') {
          if (c === '\r' && i + 1 >= len && !isLastChunk) break;
          if (i > segmentStart) currentCell += textToProcess.slice(segmentStart, i);
          if (currentCell.endsWith('\r')) currentCell = currentCell.slice(0, -1);
          currentRow.push((!cellWasQuoted && trimUnquoted) ? currentCell.trim() : currentCell);
          currentCell = '';
          cellWasQuoted = quoteClosed = false;
          parsedRows.push(currentRow);
          currentRow = [];
          i += (c === '\r' && i + 1 < len && textToProcess[i + 1] === '\n') ? 2 : 1;
          lastSafeIndex = segmentStart = i;
        } else {
          i++;
        }
      }
    }

    if (i > segmentStart) currentCell += textToProcess.slice(segmentStart, i);

    if (!isLastChunk) {
      if (lastSafeIndex > 0) {
        this.buffer = textToProcess.slice(lastSafeIndex);
      } else {
        this.buffer = textToProcess;
        parsedRows = [];
      }
    } else {
      if (cellWasQuoted || currentCell.length > 0 || currentRow.length > 0) {
        if (currentCell.endsWith('\r')) currentCell = currentCell.slice(0, -1);
        currentRow.push((!cellWasQuoted && trimUnquoted) ? currentCell.trim() : currentCell);
        parsedRows.push(currentRow);
      }
      this.reset();
    }

    return parsedRows;
  }

  parse(input: string | Uint8Array, dialect?: Partial<CsvDialect>): string[][] {
    if (dialect) {
      const delimiter = dialect.delimiter === 'TAB' ? '\t' : (dialect.delimiter ?? this.dialect.delimiter);
      this.dialect = { ...this.dialect, ...dialect, delimiter };
    }
    this.reset();
    return this.parseChunk(input, true);
  }
}

export class CsvSerializer {
  private dialect: CsvDialect;

  constructor(dialect?: Partial<CsvDialect>) {
    this.dialect = { ...DEFAULT_CSV_DIALECT, ...dialect };
    if (this.dialect.delimiter === 'TAB') {
      this.dialect = { ...this.dialect, delimiter: '\t' };
    }
  }

  serialize(matrix: readonly (readonly CellValue[])[], dialect?: Partial<CsvDialect>): string {
    const opts = dialect ? { ...this.dialect, ...dialect } : this.dialect;
    const sep = opts.delimiter === 'TAB' ? '\t' : opts.delimiter;
    const fw = opts.fixedWidth ?? 0;
    const spaces = fw > 0 ? ' '.repeat(fw) : '';
    const isStrict = opts.isStrict;
    const lineTerm = opts.lineTerminator ?? '\r\n';
    const escapeChar = opts.escapeChar ?? '"';

    return matrix.map(row => {
      const outputRow = row.map(val => {
        let cellStr = normalizeCellValue(val);
        let requiresQuote = opts.quoteAlways ?? false;

        if (escapeChar === '\\') {
          if (cellStr.includes('\\')) cellStr = cellStr.replaceAll('\\', '\\\\');
          if (cellStr.includes('"')) {
            requiresQuote = true;
            cellStr = cellStr.replaceAll('"', '\\"');
          }
        } else if (cellStr.includes('"')) {
          requiresQuote = true;
          cellStr = cellStr.replaceAll('"', '""');
        }

        if (!requiresQuote && (cellStr.includes(sep) || cellStr.includes('\n') || cellStr.includes('\r'))) {
          requiresQuote = true;
        }
        if (requiresQuote && isStrict) {
          throw new Error('Strict csv format not respected: save aborted');
        }
        if (requiresQuote) cellStr = `"${cellStr}"`;
        if (fw > cellStr.length) cellStr = (spaces + cellStr).slice(-fw);
        return cellStr;
      });
      return outputRow.join(sep);
    }).join(lineTerm);
  }

  serializeJson(matrix: readonly (readonly CellValue[])[], options?: { hasHeader?: boolean; pretty?: boolean }): string {
    if (!matrix || matrix.length === 0) return options?.pretty !== false ? '[]\n' : '[]';
    const hasHeader = options?.hasHeader ?? (matrix.length > 1);
    const indent = options?.pretty !== false ? 2 : undefined;

    if (!hasHeader || matrix.length <= 1) {
      return JSON.stringify(matrix.map(row => row.map(normalizeCellValue)), null, indent);
    }

    const seenHeaders = new Map<string, number>();
    const headers = matrix[0].map((h, colIdx) => {
      const key = normalizeCellValue(h).trim() || `col_${colIdx + 1}`;
      const count = seenHeaders.get(key) ?? 0;
      seenHeaders.set(key, count + 1);
      return count > 0 ? `${key}_${count + 1}` : key;
    });

    const records = matrix.slice(1).map(row => {
      const record: Record<string, string> = {};
      for (let c = 0; c < headers.length; c++) {
        record[headers[c]] = normalizeCellValue(row[c]);
      }
      return record;
    });

    return JSON.stringify(records, null, indent);
  }

  serializeMarkdown(matrix: readonly (readonly CellValue[])[], options?: { hasHeader?: boolean }): string {
    if (!matrix || matrix.length === 0 || matrix[0].length === 0) return '';
    const hasHeader = options?.hasHeader ?? true;
    const colCount = Math.max(0, ...matrix.map(r => r.length));
    if (colCount === 0) return '';

    const formatCell = (val: CellValue) =>
      normalizeCellValue(val).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

    const headerRow = hasHeader ? matrix[0] : null;
    const headerCells = Array.from({ length: colCount }, (_, c) => {
      const raw = headerRow ? normalizeCellValue(headerRow[c]).trim() : '';
      return ` ${raw ? formatCell(headerRow![c]) : `col_${c + 1}`} `;
    });

    const lines = [
      `|${headerCells.join('|')}|`,
      `|${new Array(colCount).fill(' --- ').join('|')}|`
    ];

    for (let r = headerRow ? 1 : 0; r < matrix.length; r++) {
      const row = matrix[r];
      const cells = Array.from({ length: colCount }, (_, c) => ` ${formatCell(row[c])} `);
      lines.push(`|${cells.join('|')}|`);
    }
    return lines.join('\n');
  }

  serializeTsv(matrix: readonly (readonly CellValue[])[]): string {
    return this.serialize(matrix, { delimiter: '\t' });
  }
}
