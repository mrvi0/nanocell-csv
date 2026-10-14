/**
 * @file core/Dataframe.ts
 * Authoritative 2D tabular data store directly managing string[][] cell memory.
 * Incorporates cell/range utilities, transactional history, search/replace, sort/filter,
 * and undo/redo stacks with zero browser/DOM dependencies.
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

export interface CommandDescriptor {
  type: string;
  timestamp?: number;
  payload?: any;
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
  if (!isNumeric(str)) return str;
  const num = Number(str);
  if (!Number.isFinite(num)) return str;
  return Number(Math.round(Number(num + 'e' + decimals)) + 'e-' + decimals).toFixed(decimals);
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
  const isNum0 = v0 !== '' && isNumeric(v0);
  const isNum1 = hasV1 && v1 !== '' && isNumeric(v1);
  if (isNum0) {
    const num0 = Number(v0);
    const step = isNum1 ? Number(v1) - num0 : 1;
    const dec0 = (v0.split('.')[1] || '').length;
    const decimals = isNum1 ? Math.max(dec0, (v1.split('.')[1] || '').length) : dec0;
    return Array.from({ length: count }, (_, k) => {
      const val = num0 + step * k;
      return decimals > 0 ? String(Number(val.toFixed(decimals))) : String(val);
    });
  }
  return Array.from({ length: count }, () => v0);
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
  public static readonly MS_DELTA = 100;

  protected _data: string[][];
  protected _isSaved = true;
  protected _isLocked = false;

  public undoStack: CommandDescriptor[] = [];
  public redoStack: CommandDescriptor[] = [];
  private _txCommands: CommandDescriptor[] | null = null;

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

  private _applyChanges(changes: CellChange[], description?: string): void {
    if (changes.length > 0) {
      this.create({ type: 'RANGE_EDIT', timestamp: Date.now(), payload: { changes, description } });
    }
  }

  editRange(range: CellRange, value: CellValue): void {
    if (this.lock) return;
    const { xmin, xmax, ymin, ymax } = orderRange(range);
    const newValue = normalizeCellValue(value);
    const changes: CellChange[] = [];
    for (let y = ymin; y <= ymax; y++) {
      for (let x = xmin; x <= xmax; x++) {
        const oldValue = this.get(x, y);
        if (oldValue !== newValue) changes.push({ x, y, oldValue, newValue });
      }
    }
    this._applyChanges(changes, 'Range Edit');
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
    this._applyChanges(changes, 'Paste Matrix');
  }

  fillSeries(range: CellRange): void {
    if (this.lock) return;
    const { xmin, xmax, ymin, ymax } = orderRange(range);
    const changes: CellChange[] = [];

    if (ymin === ymax) {
      const count = xmax - xmin + 1;
      const vals = expandSeries(this.get(xmin, ymin), this.get(xmin + 1, ymin), count, xmin + 1 <= xmax);
      for (let j = 0; j < count; j++) {
        const x = xmin + j;
        const oldValue = this.get(x, ymin);
        if (oldValue !== vals[j]) changes.push({ x, y: ymin, oldValue, newValue: vals[j] });
      }
    } else {
      const count = ymax - ymin + 1;
      for (let x = xmin; x <= xmax; x++) {
        const vals = expandSeries(this.get(x, ymin), this.get(x, ymin + 1), count, ymin + 1 <= ymax);
        for (let j = 0; j < count; j++) {
          const y = ymin + j;
          const oldValue = this.get(x, y);
          if (oldValue !== vals[j]) changes.push({ x, y, oldValue, newValue: vals[j] });
        }
      }
    }
    this._applyChanges(changes, 'Expand Pattern');
  }

  roundRange(range: CellRange, integer = true): void {
    if (this.lock) return;
    const { xmin, xmax, ymin, ymax } = orderRange(range);
    const changes: CellChange[] = [];
    for (let y = ymin; y <= ymax; y++) {
      for (let x = xmin; x <= xmax; x++) {
        const oldValue = this.get(x, y);
        if (oldValue !== '' && isNumeric(oldValue)) {
          const newValue = integer ? String(Math.round(Number(oldValue))) : roundNumericString(oldValue, 2);
          if (newValue !== oldValue) changes.push({ x, y, oldValue, newValue });
        }
      }
    }
    this._applyChanges(changes, 'Round Values');
  }

  insertRow(index: number, rowData?: CellValue[]): void {
    if (this.lock || index < 0 || index > this.height) return;
    const targetWidth = Math.max(1, this.width);
    const newRow = new Array<string>(targetWidth).fill('');
    if (rowData) {
      const len = Math.min(rowData.length, targetWidth);
      for (let i = 0; i < len; i++) newRow[i] = normalizeCellValue(rowData[i]);
    }
    this.create({ type: 'INSERT_ROW', timestamp: Date.now(), payload: { index, rowData: newRow } });
  }

  insertCol(index: number, colData?: CellValue[]): void {
    if (this.lock || index < 0 || index > this.width) return;
    const normalized = colData ? colData.map(normalizeCellValue) : undefined;
    this.create({ type: 'INSERT_COL', timestamp: Date.now(), payload: { index, colData: normalized } });
  }

  deleteRows(startIndex: number, count = 1): string[][] {
    if (this.lock || startIndex < 0 || startIndex >= this.height || count <= 0) return [];
    const actualCount = Math.min(count, this.height - startIndex);
    if (this.height - actualCount < 1) return [];
    const rowsData = this._data.slice(startIndex, startIndex + actualCount).map(r => [...r]);
    this.create({ type: 'BATCH_DELETE_ROWS', timestamp: Date.now(), payload: { index: startIndex, rowsData } });
    return rowsData;
  }

  deleteCols(startIndex: number, count = 1): string[][] {
    if (this.lock || startIndex < 0 || startIndex >= this.width || count <= 0) return [];
    const actualCount = Math.min(count, this.width - startIndex);
    if (this.width - actualCount < 1) return [];
    const colsData: string[][] = [];
    for (let c = 0; c < actualCount; c++) {
      const colIdx = startIndex + c;
      colsData.push(this._data.map(row => row[colIdx]));
    }
    this.create({ type: 'BATCH_DELETE_COLS', timestamp: Date.now(), payload: { index: startIndex, colsData } });
    return colsData;
  }

  shiftRows(startIndex: number, count = 1, direction: 'up' | 'down' = 'down'): boolean {
    if (this.lock || count <= 0 || startIndex < 0) return false;
    if (direction === 'up') {
      if (startIndex <= 0 || startIndex + count > this.height) return false;
      this.create({ type: 'SHIFT_ROWS', timestamp: Date.now(), payload: { from: startIndex - 1, to: startIndex + count - 1 } });
      return true;
    }
    if (startIndex + count > this.height) return false;
    if (startIndex + count === this.height) {
      if (count === 1) { this.insertRow(startIndex); return true; }
      return false;
    }
    this.create({ type: 'SHIFT_ROWS', timestamp: Date.now(), payload: { from: startIndex + count, to: startIndex } });
    return true;
  }

  shiftCols(startIndex: number, count = 1, direction: 'left' | 'right' = 'right'): boolean {
    if (this.lock || count <= 0 || startIndex < 0) return false;
    if (direction === 'left') {
      if (startIndex <= 0 || startIndex + count > this.width) return false;
      this.create({ type: 'SHIFT_COLS', timestamp: Date.now(), payload: { from: startIndex - 1, to: startIndex + count - 1 } });
      return true;
    }
    if (startIndex + count > this.width) return false;
    if (startIndex + count === this.width) {
      if (count === 1) { this.insertCol(startIndex); return true; }
      return false;
    }
    this.create({ type: 'SHIFT_COLS', timestamp: Date.now(), payload: { from: startIndex + count, to: startIndex } });
    return true;
  }

  sort(n: number, options?: SortOptions): number[] {
    if (this.lock || n < 0 || n >= this.width) return [];
    const hasHeader = options?.hasHeader ?? false;
    const ascending = options?.ascending ?? true;
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

    const dir = ascending ? 1 : -1;
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
    this.create({ type: 'ORDER_ROWS', timestamp: Date.now(), payload: { newOrder, oldOrder } });
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
      this.create({ type: 'TRANSPOSE', timestamp: Date.now() });
      return;
    }
    const ordered = orderRange(range);
    const transposedSlice = Dataframe.transpose2D(this.slice(ordered));
    const changesMap = new Map<string, CellChange>();

    for (let y = ordered.ymin; y <= ordered.ymax; y++) {
      for (let x = ordered.xmin; x <= ordered.xmax; x++) {
        changesMap.set(`${x}:${y}`, { x, y, oldValue: this.get(x, y), newValue: '' });
      }
    }
    for (let r = 0; r < transposedSlice.length; r++) {
      for (let c = 0; c < transposedSlice[r].length; c++) {
        const tx = ordered.xmin + c, ty = ordered.ymin + r, key = `${tx}:${ty}`;
        const existing = changesMap.get(key);
        if (existing) existing.newValue = transposedSlice[r][c];
        else changesMap.set(key, { x: tx, y: ty, oldValue: this.get(tx, ty), newValue: transposedSlice[r][c] });
      }
    }
    this._applyChanges(Array.from(changesMap.values()), 'Transpose Range');
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

  executeCommand(command: CommandDescriptor, isRevert = false): void {
    if (!command?.type) return;
    const payload = command.payload || {};
    switch (command.type) {
      case 'INSERT_ROW': {
        const { index, rowData } = payload;
        if (isRevert) {
          if (this.height > 1 && index >= 0 && index < this.height) this._data.splice(index, 1);
        } else {
          const targetWidth = Math.max(1, this.width);
          const row = new Array<string>(targetWidth).fill('');
          if (rowData) {
            const len = Math.min(rowData.length, targetWidth);
            for (let i = 0; i < len; i++) row[i] = rowData[i];
          }
          this._data.splice(index, 0, row);
        }
        this.markDirty();
        break;
      }
      case 'BATCH_DELETE_ROWS': {
        const { index, rowsData } = payload;
        if (isRevert) {
          for (let i = 0; i < rowsData.length; i++) this._data.splice(index + i, 0, [...rowsData[i]]);
        } else {
          this._data.splice(index, rowsData.length);
        }
        this.markDirty();
        break;
      }
      case 'INSERT_COL': {
        const { index, colData } = payload;
        if (isRevert) {
          if (this.width > 1 && index >= 0 && index < this.width) {
            for (let y = 0; y < this.height; y++) this._data[y].splice(index, 1);
          }
        } else {
          const isAppend = index === this.width;
          for (let y = 0; y < this.height; y++) {
            const val = colData && y < colData.length ? colData[y] : '';
            if (isAppend) this._data[y].push(val);
            else this._data[y].splice(index, 0, val);
          }
        }
        this.markDirty();
        break;
      }
      case 'BATCH_DELETE_COLS': {
        const { index, colsData } = payload;
        const count = colsData.length;
        if (isRevert) {
          for (let y = 0; y < this.height; y++) {
            const items: string[] = [];
            for (let c = 0; c < count; c++) items.push(colsData[c][y] ?? '');
            this._data[y].splice(index, 0, ...items);
          }
        } else {
          for (let y = 0; y < this.height; y++) this._data[y].splice(index, count);
        }
        this.markDirty();
        break;
      }
      case 'SHIFT_ROWS': {
        const src = isRevert ? payload.to : payload.from;
        const dst = isRevert ? payload.from : payload.to;
        const [row] = this._data.splice(src, 1);
        if (row) {
          this._data.splice(dst, 0, row);
          this.markDirty();
        }
        break;
      }
      case 'SHIFT_COLS': {
        const src = isRevert ? payload.to : payload.from;
        const dst = isRevert ? payload.from : payload.to;
        for (let y = 0; y < this.height; y++) {
          const [col] = this._data[y].splice(src, 1);
          this._data[y].splice(dst, 0, col ?? '');
        }
        this.markDirty();
        break;
      }
      case 'ORDER_ROWS': {
        const order = isRevert ? payload.oldOrder : payload.newOrder;
        if (Array.isArray(order) && order.length === this.height) {
          this._data = order.map((idx: number) => this._data[idx]);
          this.markDirty();
        }
        break;
      }
      case 'RANGE_EDIT': {
        const { changes } = payload;
        if (Array.isArray(changes)) {
          if (isRevert) {
            for (let i = changes.length - 1; i >= 0; i--) {
              const edit = changes[i];
              this.ensureCapacity(edit.x, edit.y);
              this._data[edit.y][edit.x] = normalizeCellValue(edit.oldValue);
            }
          } else {
            for (let i = 0; i < changes.length; i++) {
              const edit = changes[i];
              this.ensureCapacity(edit.x, edit.y);
              this._data[edit.y][edit.x] = normalizeCellValue(edit.newValue);
            }
          }
          this.markDirty();
        }
        break;
      }
      case 'TRANSPOSE': {
        this._data = Dataframe.transpose2D(this._data);
        this.square();
        this.markDirty();
        break;
      }
      case 'TRANSACTION': {
        const { commands } = payload;
        if (Array.isArray(commands)) {
          if (isRevert) {
            for (let i = commands.length - 1; i >= 0; i--) this.executeCommand(commands[i], true);
          } else {
            for (let i = 0; i < commands.length; i++) this.executeCommand(commands[i], false);
          }
        }
        break;
      }
    }
  }

  runTransaction<T>(description: string, fn: () => T): T {
    const prev = this._txCommands;
    const commands: CommandDescriptor[] = [];
    this._txCommands = commands;
    try {
      const res = fn();
      this._txCommands = prev;
      if (commands.length > 0) {
        if (prev) prev.push(...commands);
        else {
          this.undoStack.push({ type: 'TRANSACTION', timestamp: Date.now(), payload: { description, commands } });
          this.redoStack = [];
          this.isSaved = false;
        }
      }
      return res;
    } catch (err) {
      this._txCommands = prev;
      for (let i = commands.length - 1; i >= 0; i--) this.executeCommand(commands[i], true);
      throw err;
    }
  }

  create(cmd: CommandDescriptor): void {
    if (this.lock || !cmd || typeof cmd !== 'object' || !cmd.type) return;
    cmd.timestamp ??= Date.now();
    this.executeCommand(cmd, false);
    if (this._txCommands) {
      this._txCommands.push(cmd);
    } else {
      this.undoStack.push(cmd);
      this.redoStack = [];
    }
    this.isSaved = false;
  }

  undo(): void {
    let prev: CommandDescriptor | undefined, action: CommandDescriptor | undefined;
    do {
      if (this.undoStack.length < 1) return;
      action = this.undoStack.pop();
      if (!action) return;
      this.executeCommand(action, true);
      this.redoStack.push(action);
      prev = this.undoStack[this.undoStack.length - 1];
    } while (prev && action && ((action.timestamp ?? 0) - (prev.timestamp ?? 0)) < Dataframe.MS_DELTA);
    this.isSaved = false;
  }

  redo(): void {
    let next: CommandDescriptor | undefined, action: CommandDescriptor | undefined;
    do {
      if (this.redoStack.length < 1) return;
      action = this.redoStack.pop();
      if (!action) return;
      this.executeCommand(action, false);
      this.undoStack.push(action);
      next = this.redoStack[this.redoStack.length - 1];
    } while (next && action && ((next.timestamp ?? 0) - (action.timestamp ?? 0)) < Dataframe.MS_DELTA);
    this.isSaved = false;
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
      const all: number[] = [];
      for (let r = startRow; r < totalRows; r++) all.push(r);
      return all;
    }

    const needle = caseSensitive ? String(query) : String(query).toLowerCase();
    const matches: number[] = [];
    for (let r = startRow; r < totalRows; r++) {
      const cellVal = this._data[r]?.[colIndex];
      if (cellVal === undefined || cellVal === null) continue;
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
    this._applyChanges(changes, `Replace all occurrences of '${query.term}' with '${replacement}'`);
    return changes.length;
  }

  markDirty(): void {
    this._isSaved = false;
  }
}
