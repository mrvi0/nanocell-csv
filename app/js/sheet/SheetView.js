/**
 * View Component for `<ui-sheet>` Web Component.
 * Handles DOM rendering, virtualized cell loading, header updates, and scrollbar calculations.
 * @module SheetView
 */
import { dom } from '../ui/AppLayout.js';
import { getSheet, getCsvHandle } from '../appContext.js';
import { DialogManager } from '../ui/DialogManager.js';
import { stg } from '../ui/settings/Setting.js';
import { isUrl } from '../../../core/model/Dataframe.js';
import { isIsoDate } from '../../../core/utils/date.js';
import { Notification } from '../ui/Notification.js';
import { setIcon } from '../utils/icons.js';

export class SheetView {
  constructor(sheet) {
    this.sheet = sheet;
    this.table = document.createElement('table');
    this.sheet.appendChild(this.table);
    this._isEditingCoords = false;
    this.initFooterLeft();
    this.initFooterLock();
  }

  get rows() {
    return this.table.rows;
  }

  reload() {
    while (this.table.rows[0]) this.table.rows[0].remove();
    for (let y = 0; y < this.sheet.nViewRows + 1; y++) {
      const tr = document.createElement('tr');
      this.table.appendChild(tr);
      for (let x = 0; x < this.sheet.nViewCols + 1; x++) {
        const cell = document.createElement('td');
        cell.tx = x - 1;
        cell.ty = y - 1;

        if (x === 0 || y === 0) cell.classList.add('tHeader');
        if (y === 0) cell.classList.add('tColHeader');
        if (x === 0) cell.classList.add('tRowHeader');

        if (y === 0 && x > 0) {
          const hdrTxt = document.createElement('span');
          hdrTxt.classList.add('noclick');
          cell.appendChild(hdrTxt);
        } else if (y > 0) {
          cell.appendChild(document.createElement('div'));
        }
        tr.appendChild(cell);
      }
    }
    this.refresh();
    this.sheet.slctRefresh(false);
  }

  refresh() {
    if (this._refreshRafId) cancelAnimationFrame(this._refreshRafId);
    this._refreshRafId = requestAnimationFrame(() => {
      this._refreshRafId = null;
      for (let x = 0; x < this.sheet.width; x++) this.loadTopHeader(x);
      for (let y = 0; y < this.sheet.height; y++) {
        const actualY = this.sheet.getRowIndex(this.sheet.baseY + y);
        this.loadLeftHeader(y, actualY);
        for (let x = 0; x < this.sheet.width; x++) {
          this.loadCell(this.rows[y + 1].cells[x + 1], this.sheet.baseX + x, actualY);
        }
      }
      const cell = this.sheet.bestInputCell();
      if (this.sheet.inputing && cell && this.sheet.inputField.parentNode !== cell) {
        cell.appendChild(this.sheet.inputField);
      }
      this.footerUpdate();
    });
  }

  loadCell(c, x, y) {
    const div = c?.firstChild;
    if (!div) return;
    if (y < 0 || y >= this.sheet.df.height) {
      div.className = '';
      div.textContent = '';
      return;
    }

    const d = this.sheet.df.get(x, y);
    if (!d) {
      div.className = '';
      div.textContent = '';
      return;
    }

    let cls = '';
    if (d[0] === '!') cls += ' error';
    if (!isNaN(d)) cls += ' num';
    if (isIsoDate(d)) cls += ' date';
    if (isUrl(d)) cls += ' url';
    if (stg.purple && (d.includes(',') || d.includes('"') || d.includes('\n'))) cls += ' noComply';

    div.className = cls.charCodeAt(0) === 32 ? cls.slice(1) : cls;
    if (!d.includes('&') && !d.includes('<') && !d.includes('\n')) {
      div.textContent = d;
    } else {
      div.innerHTML = d.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\n', '<br>');
    }
  }

  loadTopHeader(x) {
    const cell = this.rows[0]?.cells[x + 1];
    if (!cell) return;
    const matrixX = this.sheet.baseX + x;
    const hdr = this.sheet.fixTop ? this.sheet.df.get(matrixX, 0) : '';
    cell.firstChild.textContent = hdr.length > 0 ? hdr : matrixX + 1;

    if (this.sheet.expandedCol !== null && this.sheet.expandedCol !== undefined) {
      const isExp = matrixX === this.sheet.expandedCol;
      cell.classList.toggle('col-expanded', isExp);
      cell.classList.toggle('col-collapsed', !isExp);
      cell.style.width = isExp ? '100%' : '0%';
    } else {
      cell.classList.remove('col-expanded', 'col-collapsed');
      cell.style.width = `${100.0 / (this.sheet.nViewCols || 10)}%`;
    }
  }

  loadLeftHeader(y, actualY) {
    const cell = this.rows[y + 1]?.cells[0];
    if (!cell) return;
    const label = actualY !== undefined ? (actualY >= 0 ? String(actualY + 1) : '') : String(this.sheet.baseY + y + 1);
    (cell.firstChild || cell).textContent = label;
  }

  initFooterLeft() {
    const el = dom?.footerDiv?.left;
    if (!el || el._coordClickBound) return;
    el._coordClickBound = true;
    el.title = 'Click to jump to cell';
    el.addEventListener('click', (e) => {
      if (!e.target.closest('.coord-editor')) getSheet()?.view?.startCoordEdit();
    });
  }

  startCoordEdit() {
    const f = dom?.footerDiv;
    if (!f?.left || this._isEditingCoords) return;
    this._isEditingCoords = true;

    const currentX = this.sheet.x + 1;
    const currentY = this.sheet.y + 1;

    f.left.classList.add('editing');
    f.left.innerHTML = `
      <span class="coord-editor">
        <input type="number" class="coord-input coord-col finder-input" min="1" value="${currentX}" aria-label="Column" title="Column" />
        <span class="coord-sep">:</span>
        <input type="number" class="coord-input coord-row finder-input" min="1" value="${currentY}" aria-label="Row" title="Row" />
        <button class="icon coord-go-btn" type="button" title="Go to cell (Enter)" aria-label="Go to cell"></button>
      </span>
    `;

    const inputCol = f.left.querySelector('.coord-col');
    const inputRow = f.left.querySelector('.coord-row');
    const goBtn = f.left.querySelector('.coord-go-btn');
    const container = f.left.querySelector('.coord-editor');
    if (goBtn) setIcon(goBtn, 'arrow_right');

    let committed = false;
    const finish = (apply) => {
      if (committed) return;
      committed = true;
      this._isEditingCoords = false;
      f.left.classList.remove('editing');
      if (apply) {
        const col = Math.max(1, parseInt(inputCol.value, 10) || currentX);
        const row = Math.max(1, parseInt(inputRow.value, 10) || currentY);
        this.sheet.rangeEnd = undefined;
        this.sheet.slctRange = false;
        this.sheet.x = col - 1;
        this.sheet.y = row - 1;
        this.sheet.slctFocus();
        this.refresh();
        this.sheet.slctRefresh(false);
      }
      this.footerUpdate();
    };

    const focusables = [inputCol, inputRow, goBtn].filter(Boolean);
    container.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.stopPropagation();
        DialogManager.cycleFocus(e, focusables);
        document.activeElement?.select?.();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    });

    goBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      finish(true);
    });
    container.addEventListener('click', (e) => e.stopPropagation());
    container.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!committed && !container.contains(document.activeElement)) finish(true);
      }, 100);
    });

    inputCol.focus();
    inputCol.select();
  }

  initFooterLock() {
    const lock = dom?.footerDiv?.lock;
    if (!lock || lock._hasLockListener) return;
    lock._hasLockListener = true;
    lock.addEventListener('click', () => {
      const csv = getCsvHandle();
      if (!this.sheet?.df?.lock && !csv?.viewOnly) return;
      const msg = this.sheet?.filterRows
        ? 'File is locked while a filter is active.'
        : 'File is in View-Only mode. Edits are disabled.';
      Notification.warning(msg, 'View-Only Mode');
    });
  }

  footerUpdate() {
    const f = dom?.footerDiv;
    if (!f?.left) return;
    this.initFooterLeft();
    if (this._isEditingCoords) return;

    const actualY = this.sheet.getRowIndex(this.sheet.y);
    const startYDisplay = actualY >= 0 ? actualY + 1 : this.sheet.y + 1;

    if (this.sheet.rangeEnd) {
      const deltaX = Math.abs(this.sheet.rangeEnd.x - this.sheet.x) + 1;
      const actualRangeY = this.sheet.getRowIndex(this.sheet.rangeEnd.y);
      const endYDisplay = actualRangeY >= 0 ? actualRangeY + 1 : this.sheet.rangeEnd.y + 1;
      const deltaY = Math.abs(endYDisplay - startYDisplay) + 1;
      f.left.innerHTML = `${this.sheet.x + 1}:${startYDisplay} to ${this.sheet.rangeEnd.x + 1}:${endYDisplay} (${deltaX}x${deltaY})`;
    } else {
      f.left.innerHTML = `${this.sheet.x + 1}:${startYDisplay}`;
    }

    f.right.innerHTML = this.sheet.filterRows
      ? `${this.sheet.df.width}:${this.sheet.filterRows.length} (${this.sheet.df.height})`
      : `${this.sheet.df.width}:${this.sheet.df.height}`;

    const cellVal = (actualY >= 0 && actualY < this.sheet.df.height) ? this.sheet.df.get(this.sheet.x, actualY) : '';
    f.center.innerHTML = cellVal
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('\n', '<br>')
      .replaceAll(' ', '<span class="cell-space-dot">&bull;</span>');

    if (f.lock) {
      this.initFooterLock();
      const csv = getCsvHandle();
      const isLocked = Boolean(this.sheet.df?.lock || csv?.viewOnly);
      const hasFileHandle = Boolean(csv?.handle);
      const isSaved = Boolean(this.sheet.df?.isSaved);

      let lockIcon = 'edit_square';
      let lockTitle = hasFileHandle ? 'Unsaved changes relative to disk' : 'New file edit';
      if (isLocked) {
        lockIcon = 'lock';
        lockTitle = this.sheet.filterRows ? 'Locked (filter active)' : 'Locked (view-only mode)';
      } else if (hasFileHandle && isSaved) {
        lockIcon = 'save_disk';
        lockTitle = 'File saved (no edits ongoing)';
      }

      setIcon(f.lock, lockIcon);
      f.lock.setAttribute('title', lockTitle);
      f.lock.setAttribute('aria-label', lockTitle);
      f.lock.classList.toggle('warning', isLocked);
    }
  }

  scrollbarRefresh() {
    const dsy = dom?.content?.scrollerY;
    const dsx = dom?.content?.scrollerX;
    if (!dsy || !dsx) return;

    const dfh = this.sheet.rowCount;
    const dfw = this.sheet.df.width;
    const showY = dfh >= this.sheet.nViewRows / 2;
    const showX = dfw >= this.sheet.nViewCols - 2;

    dsy.classList.toggle('hidden', !showY);
    dsy.style.display = showY ? 'block' : 'none';
    dsx.classList.toggle('hidden', !showX);
    dsx.style.display = showX ? 'block' : 'none';

    const totalY = Math.max(dfh - 1, this.sheet.baseY, 1);
    const totalX = Math.max(dfw - 1, this.sheet.baseX, 1);
    const sheetRect = (showY || showX) ? this.sheet.getBoundingClientRect?.() : null;

    if (showY) {
      const [sizeY, hStr] = totalY < 100 ? ['lg', '50vh'] : (totalY < 1000 ? ['md', '20vh'] : ['sm', '10vh']);
      dsy.setAttribute('data-size', sizeY);
      dsy.style.height = hStr;
      const top = (this.rows[1] && sheetRect) ? (this.rows[1].getBoundingClientRect().top - sheetRect.top) : 0;
      const theight = (sheetRect ? sheetRect.height : 0) - top - dsy.offsetHeight;
      dsy.style.top = `${top + Math.round((theight * this.sheet.baseY) / totalY)}px`;
    }
    if (showX) {
      const [sizeX, wStr] = totalX < 30 ? ['lg', '50vw'] : (totalX < 100 ? ['md', '20vw'] : ['sm', '10vw']);
      dsx.setAttribute('data-size', sizeX);
      dsx.style.width = wStr;
      const left = this.rows[0]?.cells[1] ? this.rows[0].cells[1].getBoundingClientRect().left : 0;
      const twidth = (sheetRect ? sheetRect.right : 0) - left - dsx.offsetWidth;
      dsx.style.left = `${left + Math.round((twidth * this.sheet.baseX) / totalX)}px`;
    }
  }
}
