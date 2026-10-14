/**
 * @file core/Dataframe.ts
 * Authoritative 2D tabular data store directly managing string[][] cell memory.
 * Incorporates cell/range utilities, transactional closure history, search/replace,
 * sort/filter, and undo/redo stacks with zero browser/DOM dependencies.
 */

export interface CellCoordinate {
  readonly x: number;
  readonly y: number;
}

export type CellValue = string | number;

export interface CellRange {
  readonly xmin: number;
  readonly xmax: number;
  readonly ymin: number;
  readonly ymax: number;
}

export interface SortOptions {
  ascending?: boolean;
  hasHeader?: boolean;
  numbersFirst?: boolean;
}

export interface UndoEntry {
  apply(): void;
  revert(): void;
}

export interface CellChange {
  x: number;
  y: number;
  oldValue: string;
  newValue: string;
}

export interface SearchQuery {
  readonly term: string;
  readonly caseSensitive?: boolean;
  readonly useRegex?: boolean;
  readonly matchWholeCell?: boolean;
  readonly scopeRange?: CellRange;
}

export interface SearchMatch {
  readonly x: number;
  readonly y: number;
  readonly value: string;
}

export function isNumeric(val: unknown): boolean {
  if (typeof val === 'number') return Number.isFinite(val);
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  return trimmed !== '' && !Number.isNaN(Number(trimmed));
}

export function isUrl(val: unknown): boolean {
  if (typeof val !== 'string' || val.length < 8) return false;
  const lower = val.toLowerCase();
  return lower.startsWith('https://') || lower.startsWith('http://');
}

export function isIsoDate(val: unknown): boolean {
  return typeof val === 'string' && val.length === 10 && /^\d{4}-[01]\d-[0123]\d$/.test(val);
}

export function normalizeCellValue(val: unknown): string {
  return val === null || val === undefined ? '' : String(val);
}

export function roundNumericString(str: string, decimals = 2): string {
  if (typeof str !== 'string') return String(str ?? '');
  const trimmed = str.trim();
  if (!trimmed) return str;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return str;
  const factor = 10 ** decimals;
  const sign = num < 0 ? -1 : 1;
  const scaled = Math.abs(num) * factor;
  const rounded = (sign * Math.round(scaled + Number.EPSILON * scaled)) / factor;
  return (rounded || 0).toFixed(decimals);
}

export function orderRange(r: CellRange): CellRange {
  return {
    xmin: Math.min(r.xmin, r.xmax),
    xmax: Math.max(r.xmin, r.xmax),
    ymin: Math.min(r.ymin, r.ymax),
    ymax: Math.max(r.ymin, r.ymax)
  };
}

function padRow(row: string[], width: number): void {
  const curLen = row.length;
  if (curLen < width) {
    row.length = width;
    row.fill('', curLen);
  }
}

function expandSeries(v0: string, v1: string, count: number, hasV1: boolean): string[] {
  if (v0 !== '' && isNumeric(v0)) {
    const num0 = Number(v0);
    const isNum1 = hasV1 && v1 !== '' && isNumeric(v1);
    const step = isNum1 ? Number(v1) - num0 : 1;
    const dec0 = (v0.split('.')[1] || '').length;
    const decimals = isNum1 ? Math.max(dec0, (v1.split('.')[1] || '').length) : dec0;
    return Array.from({ length: count }, (_, k) => {
      const val = num0 + step * k;
      return decimals > 0 ? String(Number(val.toFixed(decimals))) : String(val);
    });
  }
  return new Array<string>(count).fill(v0);
}

function buildSearchRegex(query: SearchQuery): RegExp | null {
  if (!query.term) return null;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pattern = query.useRegex ? query.term : escape(query.term);
  if (query.matchWholeCell) pattern = `^(?:${pattern})$`;
  const flags = query.caseSensitive ? 'g' : 'gi';
  try {
    return new RegExp(pattern, flags);
  } catch {
    const safe = escape(query.term);
    return new RegExp(query.matchWholeCell ? `^(?:${safe})$` : safe, flags);
  }
}

export class Dataframe {
  protected _data: string[][];
  protected _isSaved = true;
  protected _isLocked = false;

  public undoStack: UndoEntry[] = [];
  public redoStack: UndoEntry[] = [];
  private _tx: UndoEntry[] | null = null;

  constructor(initialData?: CellValue[][]) {
    if (initialData && initialData.length > 0) {
      this._data = initialData.map(row => row.map(normalizeCellValue));
      this.square();
    } else if (Array.isArray(initialData) && initialData.length === 0) {
      this._data = [];
    } else {
      this._data = [['']];
    }
  }

  get width(): number { return this._data.length > 0 ? this._data[0].length : 0; }
  get height(): number { return this._data.length; }
  get isSaved(): boolean { return this._isSaved; }
  set isSaved(val: boolean) { this._isSaved = val; }
  get lock(): boolean { return this._isLocked; }
  set lock(val: boolean) { this._isLocked = val; }
  get data(): string[][] { return this._data; }

  get(x: number, y: number): string {
    if (y < 0 || x < 0 || y >= this.height || x >= this.width) return '';
    return normalizeCellValue(this._data[y]?.[x]);
  }

  record(apply: () => void, revert: () => void): void {
    if (this.lock) return;
    apply();
    this.markDirty();
    const entry: UndoEntry = {
      apply: () => { apply(); this.markDirty(); },
      revert: () => { revert(); this.markDirty(); }
    };
    if (this._tx) {
      this._tx.push(entry);
    } else {
      this.undoStack.push(entry);
      this.redoStack = [];
    }
  }

  runTransaction<T>(description: string, fn: () => T): T {
    const prev = this._tx;
    const cmds: UndoEntry[] = [];
    this._tx = cmds;
    try {
      const res = fn();
      this._tx = prev;
      if (cmds.length > 0) {
        if (prev) prev.push(...cmds);
        else {
          this.undoStack.push({
            apply: () => { for (let i = 0; i < cmds.length; i++) cmds[i].apply(); },
            revert: () => { for (let i = cmds.length - 1; i >= 0; i--) cmds[i].revert(); }
          });
          this.redoStack = [];
          this.markDirty();
        }
      }
      return res;
    } catch (err) {
      this._tx = prev;
      for (let i = cmds.length - 1; i >= 0; i--) cmds[i].revert();
      throw err;
    }
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    entry.revert();
    this.redoStack.push(entry);
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    entry.apply();
    this.undoStack.push(entry);
  }

  applyChanges(changes: CellChange[]): void {
    if (this.lock || changes.length === 0) return;
    this.record(
      () => {
        for (let i = 0; i < changes.length; i++) {
          const c = changes[i];
          this.ensureCapacity(c.x, c.y);
          this._data[c.y][c.x] = normalizeCellValue(c.newValue);
        }
      },
      () => {
        for (let i = changes.length - 1; i >= 0; i--) {
          const c = changes[i];
          this.ensureCapacity(c.x, c.y);
          this._data[c.y][c.x] = normalizeCellValue(c.oldValue);
        }
      }
    );
  }

  mutateRange(range: CellRange, fn: (val: string, x: number, y: number) => CellValue): void {
    if (this.lock) return;
    const { xmin, xmax, ymin, ymax } = orderRange(range);
    const changes: CellChange[] = [];
    for (let y = ymin; y <= ymax; y++) {
      for (let x = xmin; x <= xmax; x++) {
        const oldValue = this.get(x, y);
        const newValue = normalizeCellValue(fn(oldValue, x, y));
        if (oldValue !== newValue) changes.push({ x, y, oldValue, newValue });
      }
    }
    this.applyChanges(changes);
  }

  editRange(range: CellRange, value: CellValue): void {
    this.mutateRange(range, () => value);
  }

  pasteMatrix(startX: number, startY: number, matrix: CellValue[][]): void {
    if (this.lock || !matrix || matrix.length === 0) return;
    const changes: CellChange[] = [];
    for (let r = 0; r < matrix.length; r++) {
      const row = matrix[r];
      const y = startY + r;
      for (let c = 0; c < row.length; c++) {
        const x = startX + c;
        const newValue = normalizeCellValue(row[c]);
        const oldValue = this.get(x, y);
        if (oldValue !== newValue) changes.push({ x, y, oldValue, newValue });
      }
    }
    this.applyChanges(changes);
  }

  fillSeries(range: CellRange): void {
    if (this.lock) return;
    const { xmin, xmax, ymin, ymax } = orderRange(range);
    if (ymin === ymax) {
      const vals = expandSeries(this.get(xmin, ymin), this.get(xmin + 1, ymin), xmax - xmin + 1, xmin < xmax);
      this.mutateRange(range, (_, x) => vals[x - xmin]);
    } else {
      const cols = Array.from({ length: xmax - xmin + 1 }, (_, i) =>
        expandSeries(this.get(xmin + i, ymin), this.get(xmin + i, ymin + 1), ymax - ymin + 1, ymin < ymax)
      );
      this.mutateRange(range, (_, x, y) => cols[x - xmin][y - ymin]);
    }
  }

  roundRange(range: CellRange, integer = true): void {
    this.mutateRange(range, (val) =>
      (val !== '' && isNumeric(val))
        ? (integer ? String(Math.round(Number(val))) : roundNumericString(val, 2))
        : val
    );
  }

  insertRow(index: number, rowData?: CellValue[]): void {
    if (this.lock || index < 0 || index > this.height) return;
    const w = Math.max(1, this.width);
    const row = Array.from({ length: w }, (_, i) => (rowData && i < rowData.length) ? normalizeCellValue(rowData[i]) : '');
    this.record(
      () => { this._data.splice(index, 0, [...row]); },
      () => { if (this.height > 1 && index < this.height) this._data.splice(index, 1); }
    );
  }

  insertCol(index: number, colData?: CellValue[]): void {
    if (this.lock || index < 0 || index > this.width) return;
    const col = colData?.map(normalizeCellValue);
    this.record(
      () => {
        for (let y = 0; y < this.height; y++) this._data[y].splice(index, 0, col?.[y] ?? '');
      },
      () => {
        if (this.width > 1 && index < this.width) {
          for (let y = 0; y < this.height; y++) this._data[y].splice(index, 1);
        }
      }
    );
  }

  deleteRows(startIndex: number, count = 1): string[][] {
    if (this.lock || startIndex < 0 || startIndex >= this.height || count <= 0) return [];
    const actualCount = Math.min(count, this.height - startIndex);
    if (this.height - actualCount < 1) return [];
    const rowsData = this._data.slice(startIndex, startIndex + actualCount).map(r => [...r]);
    this.record(
      () => { this._data.splice(startIndex, rowsData.length); },
      () => { this._data.splice(startIndex, 0, ...rowsData.map(r => [...r])); }
    );
    return rowsData;
  }

  deleteCols(startIndex: number, count = 1): string[][] {
    if (this.lock || startIndex < 0 || startIndex >= this.width || count <= 0) return [];
    const actualCount = Math.min(count, this.width - startIndex);
    if (this.width - actualCount < 1) return [];
    const colsData = Array.from({ length: actualCount }, (_, c) => this._data.map(row => row[startIndex + c]));
    this.record(
      () => { for (let y = 0; y < this.height; y++) this._data[y].splice(startIndex, actualCount); },
      () => {
        for (let y = 0; y < this.height; y++) {
          this._data[y].splice(startIndex, 0, ...colsData.map(col => col[y] ?? ''));
        }
      }
    );
    return colsData;
  }

  private _resolveShift(start: number, count: number, limit: number, backward: boolean, onAppend: () => void): [number, number] | boolean {
    if (this.lock || count <= 0 || start < 0 || start + count > limit) return false;
    if (backward) return start > 0 ? [start - 1, start + count - 1] : false;
    if (start + count === limit) {
      if (count === 1) { onAppend(); return true; }
      return false;
    }
    return [start + count, start];
  }

  shiftRows(startIndex: number, count = 1, direction: 'up' | 'down' = 'down'): boolean {
    const res = this._resolveShift(startIndex, count, this.height, direction === 'up', () => this.insertRow(startIndex));
    if (typeof res === 'boolean') return res;
    const [from, to] = res;
    const move = (src: number, dst: number) => {
      const [row] = this._data.splice(src, 1);
      if (row) this._data.splice(dst, 0, row);
    };
    this.record(() => move(from, to), () => move(to, from));
    return true;
  }

  shiftCols(startIndex: number, count = 1, direction: 'left' | 'right' = 'right'): boolean {
    const res = this._resolveShift(startIndex, count, this.width, direction === 'left', () => this.insertCol(startIndex));
    if (typeof res === 'boolean') return res;
    const [from, to] = res;
    const move = (src: number, dst: number) => {
      for (let y = 0; y < this.height; y++) {
        const [col] = this._data[y].splice(src, 1);
        this._data[y].splice(dst, 0, col ?? '');
      }
    };
    this.record(() => move(from, to), () => move(to, from));
    return true;
  }

  sort(n: number, options?: SortOptions): number[] {
    if (this.lock || n < 0 || n >= this.width) return [];
    const hasHeader = options?.hasHeader ?? false;
    const dir = (options?.ascending ?? true) ? 1 : -1;
    const numbersFirst = options?.numbersFirst ?? false;

    const numbers: { val: number; idx: number }[] = [];
    const strings: { val: string; idx: number }[] = [];
    const empty: number[] = [];

    for (let idx = hasHeader ? 1 : 0; idx < this.height; idx++) {
      const val = this._data[idx][n];
      if (!val) {
        empty.push(idx);
      } else {
        const trimmed = val.trim();
        const num = Number(trimmed);
        if (trimmed !== '' && !Number.isNaN(num)) numbers.push({ val: num, idx });
        else strings.push({ val, idx });
      }
    }

    numbers.sort((a, b) => (a.val - b.val) * dir);
    strings.sort((a, b) => a.val.localeCompare(b.val) * dir);

    const first = numbersFirst ? numbers : strings;
    const second = numbersFirst ? strings : numbers;
    const newOrder: number[] = hasHeader ? [0] : [];
    for (let i = 0; i < first.length; i++) newOrder.push(first[i].idx);
    for (let i = 0; i < second.length; i++) newOrder.push(second[i].idx);
    for (let i = 0; i < empty.length; i++) newOrder.push(empty[i]);

    const oldOrder = new Array<number>(newOrder.length);
    for (let i = 0; i < newOrder.length; i++) oldOrder[newOrder[i]] = i;

    const reorder = (order: number[]) => {
      if (order.length === this.height) this._data = order.map(idx => this._data[idx]);
    };
    this.record(() => reorder(newOrder), () => reorder(oldOrder));
    return newOrder;
  }

  static transpose2D<U>(grid: U[][]): U[][] {
    if (!grid || grid.length === 0 || grid[0].length === 0) return [[]];
    const height = grid.length, width = grid[0].length;
    return Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) => grid[y][x]));
  }

  transpose(range?: CellRange): void {
    if (this.lock) return;
    if (!range) {
      const toggle = () => { this._data = Dataframe.transpose2D(this._data); this.square(); };
      this.record(toggle, toggle);
      return;
    }
    const r = orderRange(range);
    const slice = Dataframe.transpose2D(this.slice(r));
    const span = Math.max(r.xmax - r.xmin, r.ymax - r.ymin);
    this.mutateRange(
      { xmin: r.xmin, xmax: r.xmin + span, ymin: r.ymin, ymax: r.ymin + span },
      (oldVal, x, y) => {
        const ry = y - r.ymin, rx = x - r.xmin;
        if (ry < slice.length && rx < slice[ry].length) return slice[ry][rx];
        return (x <= r.xmax && y <= r.ymax) ? '' : oldVal;
      }
    );
  }

  trimAll(): void {
    if (this.lock) return;
    this.runTransaction('Trim Empty Rows/Cols', () => {
      for (let x = this.width - 1; x >= 0 && this.width > 1; x--) {
        if (this._data.every(row => !row?.[x]?.trim())) this.deleteCols(x, 1);
      }
      for (let y = this.height - 1; y >= 0 && this.height > 1; y--) {
        if (this._data[y]?.every(val => !val?.trim())) this.deleteRows(y, 1);
      }
    });
  }

  appendRows(rows: CellValue[][], bypassLock = false): void {
    if ((this.lock && !bypassLock) || !rows || rows.length === 0) return;
    let targetWidth = this.width;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].length > targetWidth) targetWidth = rows[i].length;
    }
    if (targetWidth > this.width) {
      for (let i = 0; i < this._data.length; i++) padRow(this._data[i], targetWidth);
    }
    for (let i = 0; i < rows.length; i++) {
      const copy = rows[i].slice(0, targetWidth).map(normalizeCellValue);
      padRow(copy, targetWidth);
      this._data.push(copy);
    }
    if (!this.lock) this.markDirty();
  }

  slice(range: CellRange): string[][] {
    const { xmin, xmax, ymin, ymax } = orderRange(range);
    const result: string[][] = [];
    for (let y = ymin; y <= ymax; y++) {
      const row: string[] = [];
      for (let x = xmin; x <= xmax; x++) row.push(this.get(x, y));
      result.push(row);
    }
    return result;
  }

  square(): void {
    if (this.lock || this._data.length === 0) return;
    let maxWidth = 1;
    for (let i = 0; i < this._data.length; i++) {
      if (this._data[i].length > maxWidth) maxWidth = this._data[i].length;
    }
    for (let i = 0; i < this._data.length; i++) padRow(this._data[i], maxWidth);
  }

  ensureCapacity(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return;
    if (x >= this.width) {
      const newWidth = x + 1;
      for (let r = 0; r < this._data.length; r++) padRow(this._data[r], newWidth);
    }
    if (y >= this.height) {
      const curWidth = Math.max(1, this.width);
      const count = y + 1 - this.height;
      for (let i = 0; i < count; i++) this._data.push(new Array(curWidth).fill(''));
    }
  }

  filterColumn(colIndex: number, query: string, caseSensitive = false, skipHeader = false): number[] {
    if (colIndex < 0 || colIndex >= this.width) return [];
    const totalRows = this.height;
    const startRow = skipHeader ? 1 : 0;
    if (startRow >= totalRows) return [];

    if (!query) {
      return Array.from({ length: totalRows - startRow }, (_, i) => startRow + i);
    }

    const needle = caseSensitive ? String(query) : String(query).toLowerCase();
    const matches: number[] = [];
    for (let r = startRow; r < totalRows; r++) {
      const cellVal = this._data[r]?.[colIndex];
      if (cellVal == null) continue;
      const strVal = caseSensitive ? String(cellVal) : String(cellVal).toLowerCase();
      if (strVal.includes(needle)) matches.push(r);
    }
    return matches;
  }

  find(query: SearchQuery): SearchMatch[] {
    const matches: SearchMatch[] = [];
    const regex = buildSearchRegex(query);
    if (!regex) return matches;

    const yStart = query.scopeRange ? query.scopeRange.ymin : 0;
    const yEnd = query.scopeRange ? query.scopeRange.ymax : this.height - 1;
    const xStart = query.scopeRange ? query.scopeRange.xmin : 0;
    const xEnd = query.scopeRange ? query.scopeRange.xmax : this.width - 1;

    for (let y = yStart; y <= yEnd; y++) {
      for (let x = xStart; x <= xEnd; x++) {
        const value = this.get(x, y);
        regex.lastIndex = 0;
        if (regex.test(value)) matches.push({ x, y, value });
      }
    }
    return matches;
  }

  goToMatching(currentCoord: CellCoordinate, step: 1 | -1 = 1): CellCoordinate | null {
    const targetVal = this.get(currentCoord.x, currentCoord.y);
    const width = this.width, height = this.height, total = width * height;
    if (total <= 1) return null;

    let idx = currentCoord.y * width + currentCoord.x;
    for (let i = 1; i < total; i++) {
      idx = (idx + step + total) % total;
      const x = idx % width;
      const y = (idx - x) / width;
      if ((this._data[y]?.[x] ?? '') === targetVal) return { x, y };
    }
    return null;
  }

  replaceAll(query: SearchQuery, replacement: string): number {
    const regex = buildSearchRegex(query);
    if (!regex) return 0;
    const matches = this.find(query);
    const changes: CellChange[] = [];

    for (const { x, y, value } of matches) {
      regex.lastIndex = 0;
      const newValue = value.replace(regex, replacement);
      if (newValue !== value) changes.push({ x, y, oldValue: value, newValue });
    }
    this.applyChanges(changes);
    return changes.length;
  }

  markDirty(): void {
    this._isSaved = false;
  }
}
