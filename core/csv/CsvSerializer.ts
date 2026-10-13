/**
 * @file core/csv/CsvSerializer.ts
 * RFC 4180 compliant CSV serializer with selective quoting, strict mode validation,
 * and configurable fixed-width padding.
 * ZERO browser/DOM imports.
 */

import { CellValue, normalizeCellValue } from '../model/Dataframe.js';
import { CsvDialect, DEFAULT_CSV_DIALECT } from './CsvParser.js';

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
      let key = normalizeCellValue(h).trim() || `col_${colIdx + 1}`;
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
