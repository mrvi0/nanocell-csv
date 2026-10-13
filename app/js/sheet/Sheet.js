import { Dataframe, orderRange } from '../../../core/model/Dataframe.js';
import { dom } from '../ui/AppLayout.js';
import { FinderDialog } from '../ui/FinderDialog.js';
import { FilterDialog } from '../ui/FilterDialog.js';
import { getSheet, setSheet } from '../appContext.js';
import { Setting, stg } from '../ui/settings/Setting.js';
import { Notification } from '../ui/Notification.js';
import { SearchEngine } from '../../../core/search/SearchEngine.js';
import { SheetView } from './SheetView.js';

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

let dragTarget = null; // 'cell' | 'rowH' | 'colH' | 'allH' | 'scrollY' | 'scrollX' | null
let mouseX = 0;
let mouseY = 0;
let scrollIntervalId = null;
let cachedScrollY = null;
let cachedScrollX = null;
let globalMouseBound = false;

function getScrollBoundsY(sheet) {
  if (!sheet.rows[1]) return null;
  const offset = sheet.rows[1].getBoundingClientRect().top;
  const theight = Math.max(1, sheet.getBoundingClientRect().bottom - offset);
  return { offset, theight };
}

function getScrollBoundsX(sheet) {
  if (!sheet.rows[0]?.cells[0]) return null;
  const offset = sheet.rows[0].cells[0].getBoundingClientRect().left;
  const tWidth = Math.max(1, sheet.getBoundingClientRect().right - offset);
  return { offset, tWidth };
}

function startOutOfBoundsScroll() {
  if (scrollIntervalId !== null) clearInterval(scrollIntervalId);
  scrollIntervalId = setInterval(() => {
    const sheet = getSheet();
    if (!dragTarget || !sheet) {
      clearInterval(scrollIntervalId);
      scrollIntervalId = null;
      return;
    }
    let change = false;
    const rect = sheet.getBoundingClientRect();
    if (mouseY <= rect.top) {
      if (sheet.rangeEnd) sheet.rangeEnd.y = sheet.baseY;
      sheet.baseY--;
      change = true;
    }
    if (mouseX >= rect.right - 5) {
      if (sheet.rangeEnd) sheet.rangeEnd.x = sheet.baseX + sheet.width - 1;
      sheet.baseX++;
      change = true;
    }
    if (mouseY >= rect.bottom) {
      if (sheet.rangeEnd) sheet.rangeEnd.y = sheet.baseY + sheet.height - 1;
      sheet.baseY++;
      change = true;
    }
    if (mouseX <= rect.left + 5) {
      if (sheet.rangeEnd) sheet.rangeEnd.x = sheet.baseX;
      sheet.baseX--;
      change = true;
    }
    if (change) sheet.slctRefresh(false);
  }, 100);
}

function bindGlobalMouse() {
  if (globalMouseBound || typeof document === 'undefined') return;
  globalMouseBound = true;

  document.addEventListener('contextmenu', (e) => {
    if (!e.ctrlKey && dom?.cmenu) {
      e.preventDefault();
      dom.cmenu.pop(e);
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (e.buttons < 1) {
      dragTarget = null;
      cachedScrollY = null;
      cachedScrollX = null;
      if (scrollIntervalId !== null) {
        clearInterval(scrollIntervalId);
        scrollIntervalId = null;
      }
    }
  });

  document.addEventListener('mousedown', (e) => {
    const isSelectable = Boolean(e.target.closest?.('ui-about'));
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && !isSelectable) {
      e.preventDefault();
    }
    if (e.target.tagName !== 'INPUT' && document.activeElement?.tagName === 'INPUT') {
      document.activeElement.blur();
    }
    if (e.button !== 0) return;

    const sheet = getSheet();
    if (!sheet) return;

    if (e.target === dom?.content?.scrollerY) {
      dragTarget = 'scrollY';
      cachedScrollY = getScrollBoundsY(sheet);
      return;
    }
    if (e.target === dom?.content?.scrollerX) {
      dragTarget = 'scrollX';
      cachedScrollX = getScrollBoundsX(sheet);
      return;
    }

    const cell = e.target.closest?.('td, th');
    if (!cell || !sheet.contains(cell)) {
      dragTarget = null;
      return;
    }

    if (cell.tx < 0 && cell.ty < 0) {
      dragTarget = 'allH';
      sheet.slctAll();
    } else if (cell.ty < 0) {
      dragTarget = 'colH';
      const col = cell.tx + sheet.baseX;
      sheet.slctCol(e.shiftKey ? sheet.x : col, col);
      startOutOfBoundsScroll();
    } else if (cell.tx < 0) {
      dragTarget = 'rowH';
      const row = cell.ty + sheet.baseY;
      sheet.slctRow(e.shiftKey ? sheet.y : row, row);
      startOutOfBoundsScroll();
    } else {
      dragTarget = 'cell';
      sheet.slctRange = Boolean(e.shiftKey);
      if (!e.shiftKey) sheet.rangeEnd = undefined;
      sheet.x = cell.tx + sheet.baseX;
      sheet.y = cell.ty + sheet.baseY;
      if (e.ctrlKey && cell.firstElementChild?.classList.contains('url')) {
        window.open(cell.innerText, '_blank');
      }
      sheet.slctRefresh();
      startOutOfBoundsScroll();
    }
  });

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (e.buttons < 1) {
      dragTarget = null;
      cachedScrollY = null;
      cachedScrollX = null;
      return;
    }
    const sheet = getSheet();
    if (!sheet) return;
    if (dragTarget === 'scrollY') {
      cachedScrollY ||= getScrollBoundsY(sheet);
      if (cachedScrollY) {
        const r = Math.max(0, Math.min(1, (e.clientY - cachedScrollY.offset) / cachedScrollY.theight));
        sheet.baseY = Math.floor(sheet.rowCount * r);
        sheet.slctRefresh(false);
      }
    } else if (dragTarget === 'scrollX') {
      cachedScrollX ||= getScrollBoundsX(sheet);
      if (cachedScrollX) {
        const r = Math.max(0, Math.min(1, (e.clientX - cachedScrollX.offset) / cachedScrollX.tWidth));
        sheet.baseX = Math.floor(sheet.df.width * r);
        sheet.slctRefresh(false);
      }
    }
  });
}

class Sheet extends BaseElement {
  static _finder = null;
  static _filter = null;

  constructor(df = new Dataframe()) {
    super();
    bindGlobalMouse();
    this.df = df;
    setSheet(this);

    this.finder = Sheet._finder ||= new FinderDialog(this);
    this.finder.sheet = this;
    this.filter = Sheet._filter ||= new FilterDialog(this);
    this.filter.sheet = this;

    this.filterRows = null;
    this.inputField = document.createElement('input');
    this.inputing = false;
    this.nViewCols = stg.cols;
    this.nViewRows = stg.rows;
    this.escape = false;
    this.fixTop = false;
    this.slctRange = false;
    this.rangeEnd = undefined;
    this.expandedCol = null;
    this._x = 0;
    this._y = 0;
    this._bx = 0;
    this._by = 0;
    this._selectedCells = [];

    this.id = 'sheet';
    this.classList.add('sheet');

    this.view = new SheetView(this);
    this.selection = this;
    this.controller = this;

    this.bindEvents();

    const container = dom?.mainContainer || (typeof document !== 'undefined' ? document.getElementById('main-container') : null);
    if (container) {
      container.querySelectorAll('ui-sheet, #sheet').forEach(el => {
        if (el !== this) {
          el.disconnectedCallback?.();
          el.remove();
        }
      });
      if (this.parentNode !== container) container.appendChild(this);
      if (dom?.content?.scrollerY) container.appendChild(dom.content.scrollerY);
      if (dom?.content?.scrollerX) container.appendChild(dom.content.scrollerX);
    } else if (dom?.content) {
      dom.content.innerHTML = '';
      dom.content.appendChild(this);
      if (dom.content.scrollerY) dom.content.appendChild(dom.content.scrollerY);
      if (dom.content.scrollerX) dom.content.appendChild(dom.content.scrollerX);
    }

    this.reload();
  }

  get table() { return this.view.table; }
  get rows() { return this.view.rows; }
  get width() { return this.rows[0] ? this.rows[0].cells.length - 1 : 0; }
  get height() { return this.rows.length - 1; }
  get rowCount() { return this.filterRows ? this.filterRows.length : this.df.height; }

  get x() { return this._x; }
  set x(n) {
    if (this.inputing) this.inputBlur();
    if (!this.slctRange) this.rangeEnd = undefined;
    else if (!this.rangeEnd) this.rangeEnd = { x: this._x, y: this._y };
    this._x = Math.max(0, n);
  }

  get y() { return this._y; }
  set y(n) {
    if (this.inputing) this.inputBlur();
    if (!this.slctRange) this.rangeEnd = undefined;
    else if (!this.rangeEnd) this.rangeEnd = { x: this._x, y: this._y };
    this._y = Math.max(0, n);
  }

  get baseX() { return this._bx; }
  set baseX(n) {
    const next = Math.max(0, n);
    if (next !== this._bx) {
      this._bx = next;
      this.view.refresh();
    }
  }

  get baseY() { return this._by; }
  set baseY(n) {
    const next = Math.max(0, n);
    if (next !== this._by) {
      this._by = next;
      this.view.refresh();
    }
  }

  bindEvents() {
    this.addEventListener('wheel', (e) => this.scroll(e), { passive: false });
    this.inputField.addEventListener('focusout', () => this.inputBlur());
    this.inputField.addEventListener('keydown', (e) => {
      const k = e.key.toUpperCase();
      if (k === 'ENTER' && e.shiftKey) {
        this.inputField.value += '\u25BE';
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ';') {
        e.preventDefault();
        e.stopPropagation();
        this.insertDate();
        return;
      }
      if (k === 'ESCAPE') {
        this.escape = true;
        this.inputField.blur();
        return;
      }
      if (k === 'ENTER' || k === 'TAB' || k === 'ARROWUP' || k === 'ARROWDOWN') {
        e.stopPropagation();
        e.preventDefault();
        this.inputField.blur();
        if (k === 'TAB') this.x += e.shiftKey ? -1 : 1;
        else if (k === 'ARROWUP') this.y--;
        else this.y++;
        this.slctRefresh();
        this.view.refresh();
      }
    });

    this.addEventListener('mouseover', (e) => {
      if (!dragTarget) return;
      const td = e.target.closest('td');
      if (!td || td.tx === undefined || td.ty === undefined) return;

      if (dragTarget === 'cell') {
        this.rangeEnd = { x: td.tx + this.baseX, y: td.ty + this.baseY };
        this.slctRefresh(false);
      } else if (dragTarget === 'colH' && td.tx >= 0) {
        this.slctCol(this.x, td.tx + this.baseX);
      } else if (dragTarget === 'rowH' && td.ty >= 0) {
        this.slctRow(this.y, td.ty + this.baseY);
      }
    });

    this.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td');
      if (!td || td.tx === undefined || td.ty === undefined) return;
      if (td.tx >= 0 && td.ty >= 0) {
        if (!this.df?.lock) this.input();
      } else if (td.ty < 0 && td.tx >= 0) {
        const colIdx = this.baseX + td.tx;
        this.expandedCol = this.expandedCol === colIdx ? null : colIdx;
        this.view.refresh();
      }
    });
  }

  getRowIndex(viewY) {
    if (!this.filterRows) return viewY;
    return (viewY >= 0 && viewY < this.filterRows.length) ? this.filterRows[viewY] : -1;
  }

  setFilter(colIndex, text, matchCase = false) {
    if (!text) return this.clearFilter();
    this.filterRows = this.df.filterColumn(colIndex, text, matchCase, Boolean(this.fixTop));
    this.baseY = 0;
    this.y = 0;
    this.view.refresh();
    this.slctRefresh(true);
  }

  clearFilter() {
    if (this.filterRows !== null) {
      this.filterRows = null;
      this.view.refresh();
      this.slctRefresh(false);
    }
  }

  openFilter(colIndex) {
    this.filter?.open(colIndex);
  }

  // --- Selection & Viewport ---

  rangeOrdered() {
    const end = this.rangeEnd || this;
    return orderRange({ xmin: this.x, xmax: end.x, ymin: this.y, ymax: end.y });
  }

  rangeArray() {
    return this.df.slice(this.rangeOrdered());
  }

  focus_cell(x, y) {
    this.slctRange = false;
    this.rangeEnd = undefined;
    this.x = x;
    this.y = y;
    this.slctRefresh(true);
  }

  slctAll() {
    this.x = 0;
    this.y = 0;
    this.rangeEnd = { x: this.df.width - 1, y: this.df.height - 1 };
    this.slctRefresh(false);
  }

  slctCol(n, m = n) {
    this.x = n;
    this.y = 0;
    this.rangeEnd = { x: m, y: Math.max(0, this.df.height - 1) };
    this.slctRange = false;
    this.slctRefresh(false);
  }

  slctRow(n, m = n) {
    this.x = 0;
    this.y = n;
    this.rangeEnd = { x: Math.max(0, this.df.width - 1), y: m };
    this.slctRange = false;
    this.slctRefresh(false);
  }

  cellInView(x, y) {
    return x >= this.baseX && y >= this.baseY && x < this.baseX + this.width && y < this.baseY + this.height;
  }

  bestInputCell() {
    if (this.cellInView(this.x, this.y)) {
      return this.rows[this.y - this.baseY + 1]?.cells[this.x - this.baseX + 1];
    }
    if (this.rangeEnd) {
      const r = this.rangeOrdered();
      const vxEnd = this.baseX + this.width;
      const vyEnd = this.baseY + this.height;
      const rx = (this.baseX < r.xmin && vxEnd > r.xmin) ? r.xmin : (this.baseX > r.xmin && this.baseX <= r.xmax ? this.baseX : undefined);
      const ry = (this.baseY < r.ymin && vyEnd > r.ymin) ? r.ymin : (this.baseY > r.ymin && this.baseY <= r.ymax ? this.baseY : undefined);
      if (rx !== undefined && ry !== undefined) {
        return this.rows[ry - this.baseY + 1]?.cells[rx - this.baseX + 1];
      }
    }
    return undefined;
  }

  slctFocus() {
    if (this.x < this.baseX) this.baseX = this.x;
    else if (this.x >= this.baseX + this.width) this.baseX = this.x - this.width + 1;

    if (this.y < this.baseY) this.baseY = this.y;
    else if (this.y >= this.baseY + this.height) this.baseY = this.y - this.height + 1;
  }

  slctClear() {
    if (this._selectedCells.length > 0) {
      for (const cell of this._selectedCells) cell.classList.remove('slct');
      this._selectedCells.length = 0;
    } else {
      for (const cell of this.querySelectorAll('.slct')) cell.classList.remove('slct');
    }
  }

  slctRefresh(focus = true) {
    if (this._slctRafId) cancelAnimationFrame(this._slctRafId);
    this._slctRafId = requestAnimationFrame(() => {
      this._slctRafId = null;
      this.slctClear();
      this.view.scrollbarRefresh();
      if (focus) this.slctFocus();

      const r = this.rangeOrdered();
      const xStart = Math.max(0, r.xmin - this.baseX);
      const xEnd = Math.min(this.width - 1, r.xmax - this.baseX);
      const yStart = Math.max(0, r.ymin - this.baseY);
      const yEnd = Math.min(this.height - 1, r.ymax - this.baseY);

      for (let x = xStart; x <= xEnd; x++) {
        for (let y = yStart; y <= yEnd; y++) {
          const cell = this.rows[y + 1]?.cells[x + 1];
          if (cell) {
            cell.classList.add('slct');
            this._selectedCells.push(cell);
          }
        }
      }
      this.view.footerUpdate();
    });
  }

  scroll(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      const minRows = Setting.getDef?.('rows')?.min ?? 10;
      const minCols = Setting.getDef?.('cols')?.min ?? 3;
      if (e.shiftKey) {
        if (e.deltaY > 0) this.nViewRows++;
        else if (e.deltaY < 0 && this.nViewRows > minRows) this.nViewRows--;
      } else {
        if (e.deltaY > 0) this.nViewCols++;
        else if (e.deltaY < 0 && this.nViewCols > minCols) this.nViewCols--;
      }
      this.view.reload();
      return;
    }
    const step = (d) => d > 0 ? Math.floor(d / 16) : Math.ceil(d / 16);
    if (e.altKey) {
      this.baseX += step(e.deltaY);
    } else {
      this.baseX += step(e.deltaX);
      this.baseY += step(e.deltaY);
    }
    this.view.refresh();
    this.slctRefresh(false);
  }

  // --- Inline Cell Editing & Mutations ---

  input(txt) {
    if (this.df?.lock) return;
    const cell = this.bestInputCell();
    if (!cell) return;
    const actualY = this.getRowIndex(this.y);
    this.inputing = true;
    this.inputField.value = txt || (actualY >= 0 ? this.df.get(this.x, actualY).replaceAll('\n', '\u25BE') : '');
    cell.appendChild(this.inputField);
    this.inputField.focus();
  }

  inputBlur() {
    if (!this.inputing) return;
    this.inputing = false;
    const val = this.inputField.value.replaceAll('\u25BE', '\n');
    if (!this.escape) {
      this.rangeEdit(val);
      if (!this.rangeEnd) this.view.loadCell(this.inputField.parentNode, this.x, this.y);
      else this.view.refresh();
    }
    this.escape = false;
    this.inputField.remove();
  }

  insertDate() {
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (this.inputing && this.inputField) {
      const start = this.inputField.selectionStart || 0;
      const end = this.inputField.selectionEnd || 0;
      this.inputField.value = this.inputField.value.slice(0, start) + todayStr + this.inputField.value.slice(end);
      this.inputField.selectionStart = this.inputField.selectionEnd = start + todayStr.length;
    } else {
      this.rangeEdit(todayStr);
      this.view.refresh();
    }
  }

  rangeEdit(value) {
    this.df.editRange(this.rangeOrdered(), value);
  }

  deleteSelection() {
    this.rangeEdit('');
    this.view.refresh();
  }

  deleteRows() {
    const r = this.rangeOrdered();
    this.df.deleteRows(r.ymin, r.ymax - r.ymin + 1);
    this._y = r.ymin;
    if (this.rangeEnd) {
      this.rangeEnd.y = r.ymin;
      if (this.rangeEnd.x === this.x) this.rangeEnd = undefined;
    }
    this.view.refresh();
    this.slctRefresh(false);
  }

  deleteCols() {
    const r = this.rangeOrdered();
    this.df.deleteCols(r.xmin, r.xmax - r.xmin + 1);
    this._x = r.xmin;
    if (this.rangeEnd) {
      this.rangeEnd.x = r.xmin;
      if (this.rangeEnd.y === this.y) this.rangeEnd = undefined;
    }
    this.view.refresh();
    this.slctRefresh(false);
  }

  undo() { this.df.undo(); this.view.refresh(); }
  redo() { this.df.redo(); this.view.refresh(); }
  toggleFixTop() { this.fixTop = !this.fixTop; this.view.refresh(); }
  trim() { this.df.trimAll(); this.view.refresh(); }

  expand() {
    if (this.rangeEnd) {
      this.df.fillSeries(this.rangeOrdered());
      this.view.refresh();
    }
  }

  shift(direction) {
    const r = this.rangeOrdered();
    const rows = r.ymax - r.ymin + 1;
    const cols = r.xmax - r.xmin + 1;
    let dx = 0, dy = 0, moved = false;

    if (direction === 0 && this.df.shiftRows(r.ymin, rows, 'up')) { dy = -1; moved = true; }
    else if (direction === 1 && this.df.shiftCols(r.xmin, cols, 'right')) { dx = 1; moved = true; }
    else if (direction === 2 && this.df.shiftRows(r.ymin, rows, 'down')) { dy = 1; moved = true; }
    else if (direction === 3 && this.df.shiftCols(r.xmin, cols, 'left')) { dx = -1; moved = true; }

    if (moved) {
      const end = this.rangeEnd ? { x: this.rangeEnd.x + dx, y: this.rangeEnd.y + dy } : undefined;
      this._x = Math.max(0, this._x + dx);
      this._y = Math.max(0, this._y + dy);
      this.rangeEnd = end;
    }
    this.view.refresh();
    this.slctRefresh();
  }

  insert(direction) {
    if (direction === 0) { this.df.insertRow(this.y); this.y++; }
    else if (direction === 1) { this.df.insertCol(this.x + 1); }
    else if (direction === 2) { this.df.insertRow(this.y + 1); }
    else if (direction === 3) { this.df.insertCol(this.x); this.x++; }
    this.view.refresh();
    this.slctRefresh();
  }

  rangeTranspose() {
    if (this.df.lock) return;
    if (!this.rangeEnd) {
      this.df.transpose();
      this.focus_cell(
        Math.min(this.y, Math.max(0, this.df.width - 1)),
        Math.min(this.x, Math.max(0, this.df.height - 1))
      );
      this.view.scrollbarRefresh();
      this.view.refresh();
      return;
    }
    const r = this.rangeOrdered();
    this.df.transpose(r);
    this.rangeEnd = { x: r.xmin + (r.ymax - r.ymin), y: r.ymin + (r.xmax - r.xmin) };
    this.view.refresh();
  }

  round(integer = true) {
    this.df.roundRange(this.rangeOrdered(), integer);
    this.view.refresh();
  }

  paste(mat) {
    const r = this.rangeOrdered();
    this.df.pasteMatrix(r.xmin, r.ymin, mat);
    this.view.refresh();
  }

  sort(n, ascending) {
    this.df.sort(n, {
      ascending,
      hasHeader: Boolean(stg.sort_header),
      numbersFirst: Boolean(stg.sort_num_first)
    });
    this.view.refresh();
  }

  sortAscending() { this.sort(this.x, true); }
  sortDescending() { this.sort(this.x, false); }

  find(advanced = false) {
    this.finder.findMenu(this.df.get(this.x, this.y), advanced);
    if (!advanced) this.view.scrollbarRefresh();
  }

  go_to_occurrence(forward = true) {
    if (!this.df || this.df.width === 0 || this.df.height === 0) return;
    const next = new SearchEngine().goToMatching(this.df, { x: this.x, y: this.y }, forward ? 1 : -1);
    if (!next) Notification.quick('No match');
    else this.focus_cell(next.x, next.y);
  }

  go_to_next() { this.go_to_occurrence(true); }
  go_to_prev() { this.go_to_occurrence(false); }

  getValidationPane() {
    return dom?.validationPane || (typeof document !== 'undefined' ? (document.getElementById('validation-pane') || document.querySelector('ui-validation-pane')) : null);
  }

  open_validation_pane() {
    const pane = this.getValidationPane();
    if (pane) pane.toggle ? pane.toggle() : pane.show?.();
  }

  validate_rule(ruleId) {
    const pane = this.getValidationPane();
    if (pane) {
      pane.show?.();
      pane.runRule?.(ruleId);
    }
  }

  scrollbarRefresh() { return this.view.scrollbarRefresh(); }
  startCoordEdit() { return this.view.startCoordEdit(); }
  refresh() { return this.view.refresh(); }
  reload() { return this.view.reload(); }

  disconnectedCallback() {
    if (this.view?._refreshRafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.view._refreshRafId);
      this.view._refreshRafId = null;
    }
    if (this._slctRafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._slctRafId);
      this._slctRafId = null;
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('ui-sheet')) {
  customElements.define('ui-sheet', Sheet);
}

export { Sheet };
