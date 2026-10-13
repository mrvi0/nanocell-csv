/**
 * @file core/model/Dataframe.ts
 * Authoritative 2D tabular data store directly managing string[][] cell memory.
 * Incorporates cell/range utilities, transactional history, atomic batch operations,
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

export class Dataframe {
  public static readonly MS_DELTA = 100;

  protected _data: string[][];
  protected _isSaved = true;
  protected _isLocked = false;

  public undoStack: CommandDescriptor[] = [];
  public redoStack: CommandDescriptor[] = [];
  protected _transactionStack: { description?: string; timestamp: number; commands: CommandDescriptor[] }[] = [];

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

  get width(): number {
    return this._data.length > 0 ? this._data[0].length : 0;
  }

  get height(): number {
    return this._data.length;
  }

  get isSaved(): boolean { return this._isSaved; }
  set isSaved(val: boolean) { this._isSaved = val; }

  get lock(): boolean { return this._isLocked; }
  set lock(val: boolean) { this._isLocked = val; }

  get data(): string[][] { return this._data; }
  set data(newRows: string[][]) {
    if (this._isLocked) return;
    this._data = newRows && newRows.length > 0 ? newRows.map(r => [...r]) : [['']];
    this.square();
    this.markDirty();
  }

  get(x: number, y: number): string {
    if (y < 0 || x < 0 || y >= this.height || x >= this.width) return '';
    return normalizeCellValue(this._data[y]?.[x]);
  }

  set(x: number, y: number, value: CellValue): boolean {
    if (this._isLocked || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return false;
    const oldVal = this.get(x, y);
    const formatted = normalizeCellValue(value);
    const willExpand = x >= this.width || y >= this.height;
    this.ensureCapacity(x, y);
    this._data[y][x] = formatted;
    if (willExpand || formatted !== oldVal) this.markDirty();
    return true;
  }

  private _applyChanges(changes: CellChange[], description?: string): void {
    if (changes.length > 0) {
      this.create({
        type: 'RANGE_EDIT',
        timestamp: Date.now(),
        payload: { changes, description }
      });
    }
  }

  edit(x: number, y: number, n: CellValue): void {
    if (this.lock) return;
    const oldValue = this.get(x, y);
    const newValue = normalizeCellValue(n);
    if (newValue !== oldValue) {
      this._applyChanges([{ x, y, oldValue, newValue }]);
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

  deleteRow(n: number): string[] {
    return this.deleteRows(n, 1)[0] ?? [];
  }

  deleteCol(n: number): string[] {
    return this.deleteCols(n, 1)[0] ?? [];
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

  shiftRow(n: number, direction: 'up' | 'down' = 'down'): boolean {
    if (this.lock) return false;
    let idx = n;
    if (direction === 'up') {
      if (idx <= 0 || idx >= this.height) return false;
      idx--;
    } else {
      if (idx < 0 || idx >= this.height) return false;
      if (idx + 1 === this.height) {
        this.insertRow(idx);
        return true;
      }
    }
    if (idx < 0 || idx + 1 >= this.height) return false;
    this.create({ type: 'SHIFT_ROW', timestamp: Date.now(), payload: { index: idx } });
    return true;
  }

  shiftCol(n: number, direction: 'left' | 'right' = 'right'): boolean {
    if (this.lock) return false;
    let idx = n;
    if (direction === 'left') {
      if (idx <= 0 || idx >= this.width) return false;
      idx--;
    } else {
      if (idx < 0 || idx >= this.width) return false;
      if (idx + 1 === this.width) {
        this.insertCol(idx);
        return true;
      }
    }
    if (idx < 0 || idx + 1 >= this.width) return false;
    this.create({ type: 'SHIFT_COL', timestamp: Date.now(), payload: { index: idx } });
    return true;
  }

  shiftRows(startIndex: number, count = 1, direction: 'up' | 'down' = 'down'): boolean {
    if (this.lock || count <= 0) return false;
    if (direction === 'up' ? (startIndex <= 0 || startIndex >= this.height) : (startIndex < 0 || startIndex + count > this.height)) return false;
    if (count === 1) return this.shiftRow(startIndex, direction);
    this.runTransaction(`Shift Rows ${direction}`, () => {
      if (direction === 'up') {
        for (let y = startIndex; y < startIndex + count; y++) this.shiftRow(y, 'up');
      } else {
        for (let y = startIndex + count - 1; y >= startIndex; y--) this.shiftRow(y, 'down');
      }
    });
    return true;
  }

  shiftCols(startIndex: number, count = 1, direction: 'left' | 'right' = 'right'): boolean {
    if (this.lock || count <= 0) return false;
    if (direction === 'left' ? (startIndex <= 0 || startIndex >= this.width) : (startIndex < 0 || startIndex + count > this.width)) return false;
    if (count === 1) return this.shiftCol(startIndex, direction);
    this.runTransaction(`Shift Cols ${direction}`, () => {
      if (direction === 'left') {
        for (let x = startIndex; x < startIndex + count; x++) this.shiftCol(x, 'left');
      } else {
        for (let x = startIndex + count - 1; x >= startIndex; x--) this.shiftCol(x, 'right');
      }
    });
    return true;
  }

  order(newOrder: number[]): void {
    if (this.lock || !Array.isArray(newOrder) || newOrder.length !== this.height) return;
    const oldOrder = new Array<number>(newOrder.length);
    const seen = new Set<number>();
    for (let i = 0; i < newOrder.length; i++) {
      const idx = newOrder[i];
      if (!Number.isInteger(idx) || idx < 0 || idx >= this.height || seen.has(idx)) return;
      seen.add(idx);
      oldOrder[idx] = i;
    }
    this.create({ type: 'ORDER_ROWS', timestamp: Date.now(), payload: { newOrder, oldOrder } });
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
        if (trimmed !== '' && !Number.isNaN(num)) {
          numbers.push({ val: num, idx });
        } else {
          strings.push({ val, idx });
        }
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

    this.order(newOrder);
    return newOrder;
  }

  static transpose2D<U>(grid: U[][]): U[][] {
    if (!grid || grid.length === 0 || grid[0].length === 0) return [[]];
    const height = grid.length;
    const width = grid[0].length;
    return Array.from({ length: width }, (_, x) =>
      Array.from({ length: height }, (_, y) => grid[y][x])
    );
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
        const tx = ordered.xmin + c;
        const ty = ordered.ymin + r;
        const key = `${tx}:${ty}`;
        const existing = changesMap.get(key);
        if (existing) {
          existing.newValue = transposedSlice[r][c];
        } else {
          changesMap.set(key, { x: tx, y: ty, oldValue: this.get(tx, ty), newValue: transposedSlice[r][c] });
        }
      }
    }
    this._applyChanges(Array.from(changesMap.values()), 'Transpose Range');
  }

  trimAll(): void {
    if (this.lock) return;
    this.runTransaction('Trim Empty Rows/Cols', () => {
      for (let x = this.width - 1; x >= 0 && this.width > 1; x--) {
        if (this._data.every(row => !row?.[x]?.trim())) this.deleteCol(x);
      }
      for (let y = this.height - 1; y >= 0 && this.height > 1; y--) {
        if (this._data[y]?.every(val => !val?.trim())) this.deleteRow(y);
      }
    });
  }

  executeCommand(command: CommandDescriptor, isRevert = false): void {
    if (!command || !command.type) return;
    const payload = command.payload || {};
    switch (command.type) {
      case 'INSERT_ROW': {
        const { index, rowData } = payload;
        if (isRevert) {
          if (this.height > 1 && index >= 0 && index < this.height) {
            this._data.splice(index, 1);
          }
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
          for (let i = 0; i < rowsData.length; i++) {
            this._data.splice(index + i, 0, [...rowsData[i]]);
          }
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
      case 'SHIFT_ROW': {
        const index = payload.index;
        if (index >= 0 && index < this.height - 1) {
          const temp = this._data[index];
          this._data[index] = this._data[index + 1];
          this._data[index + 1] = temp;
          this.markDirty();
        }
        break;
      }
      case 'SHIFT_COL': {
        const index = payload.index;
        if (index >= 0 && index < this.width - 1) {
          for (let y = 0; y < this.height; y++) {
            const temp = this._data[y][index];
            this._data[y][index] = this._data[y][index + 1];
            this._data[y][index + 1] = temp;
          }
          this.markDirty();
        }
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

  beginTransaction(description?: string): void {
    this._transactionStack.push({ description, timestamp: Date.now(), commands: [] });
  }

  commitTransaction(): void {
    if (this._transactionStack.length === 0) return;
    const tx = this._transactionStack.pop()!;
    if (tx.commands.length === 0) return;

    if (this._transactionStack.length > 0) {
      this._transactionStack[this._transactionStack.length - 1].commands.push(...tx.commands);
      return;
    }

    const allRangeEdits = tx.commands.every(c => c.type === 'RANGE_EDIT');
    const committedCommand: CommandDescriptor = allRangeEdits
      ? {
          type: 'RANGE_EDIT',
          timestamp: tx.timestamp,
          payload: { changes: tx.commands.flatMap(c => c.payload.changes), description: tx.description }
        }
      : {
          type: 'TRANSACTION',
          timestamp: tx.timestamp,
          payload: { description: tx.description, commands: tx.commands }
        };

    this.undoStack.push(committedCommand);
    this.redoStack = [];
    this.isSaved = false;
  }

  rollbackTransaction(): void {
    if (this._transactionStack.length === 0) return;
    const tx = this._transactionStack.pop()!;
    for (let i = tx.commands.length - 1; i >= 0; i--) {
      this.executeCommand(tx.commands[i], true);
    }
  }

  runTransaction<T>(description: string, fn: () => T): T {
    this.beginTransaction(description);
    try {
      const result = fn();
      this.commitTransaction();
      return result;
    } catch (err) {
      this.rollbackTransaction();
      throw err;
    }
  }

  create(cmd: CommandDescriptor): void {
    if (this.lock || !cmd || typeof cmd !== 'object' || !cmd.type) return;
    if (cmd.timestamp === undefined) cmd.timestamp = Date.now();
    this.executeCommand(cmd, false);
    if (this._transactionStack.length > 0) {
      this._transactionStack[this._transactionStack.length - 1].commands.push(cmd);
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
      for (let i = 0; i < this._data.length; i++) {
        const curLen = this._data[i].length;
        if (curLen < targetWidth) {
          this._data[i].length = targetWidth;
          this._data[i].fill('', curLen);
        }
      }
    }
    for (let i = 0; i < rows.length; i++) {
      const copy = rows[i].slice(0, targetWidth).map(normalizeCellValue);
      const curLen = copy.length;
      if (curLen < targetWidth) {
        copy.length = targetWidth;
        copy.fill('', curLen);
      }
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
    for (let i = 0; i < this._data.length; i++) {
      const curLen = this._data[i].length;
      if (curLen < maxWidth) {
        this._data[i].length = maxWidth;
        this._data[i].fill('', curLen);
      }
    }
  }

  ensureCapacity(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return;
    if (x >= this.width) {
      const newWidth = x + 1;
      for (let r = 0; r < this._data.length; r++) {
        const curLen = this._data[r].length;
        if (curLen < newWidth) {
          this._data[r].length = newWidth;
          this._data[r].fill('', curLen);
        }
      }
    }
    if (y >= this.height) {
      const curWidth = Math.max(1, this.width);
      const count = y + 1 - this.height;
      for (let i = 0; i < count; i++) {
        this._data.push(new Array(curWidth).fill(''));
      }
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

  markDirty(): void {
    this._isSaved = false;
  }
}
