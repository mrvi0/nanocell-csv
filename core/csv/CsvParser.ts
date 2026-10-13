/**
 * @file core/csv/CsvParser.ts
 * Streaming RFC 4180 CSV parser.
 * Supports strings and Uint8Array binary buffers, quoted multiline records, and CRLF / LF / CR.
 * ZERO browser/DOM imports.
 */

import { SeparatorDetector } from './SeparatorDetector.js';

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

  detectSeparator(sample: string): string {
    const sep = SeparatorDetector.detect(sample);
    this.dialect = { ...this.dialect, delimiter: sep };
    return sep;
  }

  setDelimiter(delimiter: string): void {
    this.dialect = { ...this.dialect, delimiter: delimiter === 'TAB' ? '\t' : delimiter };
  }

  getDelimiter(): string {
    return this.dialect.delimiter;
  }

  reset(): void {
    this.buffer = '';
    this.textDecoder = null;
  }

  parseChunk(chunk: string | Uint8Array, isLastChunk: boolean): string[][] {
    let textChunk = '';
    if (chunk instanceof Uint8Array || ArrayBuffer.isView(chunk)) {
      if (!this.textDecoder) {
        this.textDecoder = new TextDecoder('utf-8', { fatal: false });
      }
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
    const escapeChar = this.dialect.escapeChar ?? '"';
    const isBackslashEscape = escapeChar === '\\';
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
        while (checkIdx < len && (textToProcess[checkIdx] === ' ' || textToProcess[checkIdx] === '\t')) {
          checkIdx++;
        }
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

  parseAll(input: string | Uint8Array, dialect?: Partial<CsvDialect>): string[][] {
    if (dialect) {
      const delimiter = dialect.delimiter === 'TAB' ? '\t' : (dialect.delimiter ?? this.dialect.delimiter);
      this.dialect = { ...this.dialect, ...dialect, delimiter };
    }
    this.reset();
    return this.parseChunk(input, true);
  }

  parse(content: string, dialect?: Partial<CsvDialect>): string[][] {
    return this.parseAll(content, dialect);
  }
}
