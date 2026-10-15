/**
 * @file app/js/SheetOverlays.js
 * Floating top-right sheet toolbars: Find & Replace (<ui-finder>) and Column Filter (<ui-filter>).
 */

import { getSheet, getCsvHandle } from './state.js';
import { BaseElement, defineEl, hydrateIcons, setOpen } from './icons.js';
import { DialogManager, NumInput } from './Dialogs.js';
import { Notification } from './Notification.js';

class FloatingToolbar extends BaseElement {
  constructor(sheet) {
    super();
    this.sheet = sheet;
    this.matchCase = false;
    this.classList.add('floating-panel');
    this.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        event.stopPropagation();
        DialogManager.cycleFocus(event, this.getFocusableElements());
      }
    });
  }

  get activeSheet() { return this.sheet || getSheet(); }
  get isOpen() { return this.classList.contains('open') || this.hasAttribute('open'); }

  bindCaseToggle(button, onToggle) {
    button.addEventListener('click', () => {
      this.matchCase = !this.matchCase;
      button.setAttribute('aria-pressed', String(this.matchCase));
      button.classList.toggle('active', this.matchCase);
      onToggle();
    });
  }

  showOverlay() {
    if (!this.parentNode) globalThis.document?.body?.appendChild(this);
    setOpen(this, true);
  }

  hideOverlay() {
    setOpen(this, false);
  }
}

export class FinderDialog extends FloatingToolbar {
  constructor(sheet) {
    super(sheet);
    this.matches = [];
    this.query = '';
    this.lastQuery = '';
    this.currentIndex = 0;
    this.isAdvanced = false;

    this.innerHTML = `
      <div class="finder-row">
        <button class="finder-toggle-btn icon" type="button" title="Toggle Replace (Ctrl+Shift+F)" aria-label="Toggle Replace" data-icon="arrow_right"></button>
        <div class="finder-input-wrapper">
          <input type="text" class="finder-input find-input" placeholder="Find" aria-label="Find term" />
          <span class="finder-count-badge">No match</span>
        </div>
        <div class="btn-group">
          <button class="case-btn icon" type="button" title="Match Case (Alt+C)" aria-label="Match Case" aria-pressed="false" data-icon="match_case"></button>
          <button class="prev-btn icon" type="button" title="Previous Match (Shift+Enter)" aria-label="Previous Match" data-icon="arrow_up"></button>
          <button class="next-btn icon" type="button" title="Next Match (Enter)" aria-label="Next Match" data-icon="arrow_down"></button>
          <button class="close-btn icon" type="button" title="Close (Escape)" aria-label="Close" data-icon="off"></button>
        </div>
      </div>
      <div class="finder-row replace-row hidden">
        <div class="finder-row-spacer"></div>
        <div class="finder-input-wrapper">
          <input type="text" class="finder-input replace-input" placeholder="Replace" aria-label="Replace term" />
        </div>
        <div class="btn-group">
          <button class="replace-all-btn accept-btn icon" type="button" title="Replace All (Alt+A)" aria-label="Replace All" data-icon="find_replace"></button>
        </div>
      </div>
    `;
    hydrateIcons(this);

    this.findInput = this.querySelector('.find-input');
    this.replaceInput = this.querySelector('.replace-input');
    this.matchBadge = this.querySelector('.finder-count-badge');
    this.caseBtn = this.querySelector('.case-btn');
    this.toggleBtn = this.querySelector('.finder-toggle-btn');
    this.prevBtn = this.querySelector('.prev-btn');
    this.nextBtn = this.querySelector('.next-btn');
    this.closeBtn = this.querySelector('.close-btn');
    this.replaceRow = this.querySelector('.replace-row');
    this.replaceBtn = this.querySelector('.replace-all-btn');

    this.bindCaseToggle(this.caseBtn, () => this.find(true));
    this.findInput.addEventListener('input', () => this.find());
    this.matchBadge.addEventListener('click', () => this.findNext());
    this.findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? this.findPrev() : this.findNext(); }
    });
    this.replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'Enter') { e.preventDefault(); this.replaceAll(); }
    });
    this.toggleBtn.addEventListener('click', () => this.toggleReplaceRow());
    this.prevBtn.addEventListener('click', () => this.findPrev());
    this.nextBtn.addEventListener('click', () => this.findNext());
    this.closeBtn.addEventListener('click', () => this.close());
    this.replaceBtn.addEventListener('click', () => this.replaceAll());
  }

  getFocusableElements() {
    const list = [this.toggleBtn, this.findInput, this.caseBtn, this.prevBtn, this.nextBtn, this.closeBtn];
    if (this.replaceRow && !this.replaceRow.classList.contains('hidden')) list.push(this.replaceInput, this.replaceBtn);
    return list.filter(el => el && !el.disabled && !el.hidden && !el.classList.contains('hidden'));
  }

  toggleReplaceRow(show = this.replaceRow.classList.contains('hidden')) {
    this.replaceRow.classList.toggle('hidden', !show);
    this.toggleBtn.classList.toggle('expanded', show);
    this.isAdvanced = Boolean(show);
    if (!show && (document.activeElement === this.replaceInput || document.activeElement === this.replaceBtn)) {
      this.findInput.focus();
    }
  }

  _syncMatchView() {
    this.matchBadge.textContent = this.matches.length === 0 ? 'No match' : `${this.currentIndex + 1} / ${this.matches.length}`;
    if (this.matches.length > 0) {
      const m = this.matches[this.currentIndex];
      this.activeSheet?.focusCell(m.x, m.y);
    }
  }

  find(forceRecompute = false) {
    const activeSheet = this.activeSheet;
    this.query = this.findInput.value;

    if (!this.query) {
      this.lastQuery = '';
      this.matches = [];
      this.currentIndex = 0;
    } else if (this.lastQuery === this.query && !forceRecompute) {
      if (this.matches.length > 0) this.currentIndex = (this.currentIndex + 1) % this.matches.length;
    } else {
      this.lastQuery = this.query;
      this.currentIndex = 0;
      this.matches = activeSheet?.df ? activeSheet.df.find({ term: this.query, caseSensitive: this.matchCase }) : [];
    }
    this._syncMatchView();
  }

  findNext() { this.find(this.query !== this.findInput.value || this.matches.length === 0); }

  findPrev() {
    if (this.query !== this.findInput.value || this.matches.length === 0) return this.find(true);
    this.currentIndex = (this.currentIndex - 1 + this.matches.length) % this.matches.length;
    this._syncMatchView();
  }

  replaceAll() {
    const activeSheet = this.activeSheet;
    if (!this.query || !activeSheet?.df) return;
    activeSheet.df.replaceAll({ term: this.query, caseSensitive: this.matchCase }, this.replaceInput.value);
    activeSheet.refresh();
    activeSheet.refreshSelection(true);
    this.find(true);
  }

  open(prefill = '', isAdvanced = false) {
    this.toggleReplaceRow(isAdvanced);
    if (prefill) this.findInput.value = prefill;
    this.showOverlay();
    this.findInput.focus();
    if (prefill) this.find(true);
  }

  show() { this.showOverlay(); }
  close() { this.hideOverlay(); }
}

export class FilterDialog extends FloatingToolbar {
  constructor(sheet) {
    super(sheet);
    this._previousLock = null;

    this.innerHTML = `
      <div class="finder-row">
        <div class="finder-input-wrapper">
          <input type="text" class="finder-input filter-input" placeholder="Filter column..." aria-label="Filter text" />
          <span class="finder-count-badge"></span>
        </div>
      </div>
      <div class="finder-row filter-bottom-row">
        <span class="filter-col-title truncate" title="Selected column header"></span>
        <div class="btn-group">
          <button class="case-btn icon" type="button" title="Match Case" aria-label="Match Case" aria-pressed="false" data-icon="match_case"></button>
          <button class="apply-btn accept-btn icon" type="button" title="Apply Filter (Enter)" aria-label="Apply Filter" data-icon="on"></button>
          <button class="close-btn icon" type="button" title="Close (Escape)" aria-label="Close" data-icon="off"></button>
        </div>
      </div>
    `;
    hydrateIcons(this);

    this.colInput = new NumInput(1, 1, 999, 'linear');
    this.colInput.setAttribute('aria-label', 'Column number');
    this.colInput.setAttribute('title', 'Column number');
    if (!this.colInput._initialized) this.colInput.connectedCallback?.();
    this.firstElementChild.prepend(this.colInput);

    this.colTitle = this.querySelector('.filter-col-title');
    this.filterInput = this.querySelector('.filter-input');
    this.countBadge = this.querySelector('.finder-count-badge');
    this.caseBtn = this.querySelector('.case-btn');
    this.applyBtn = this.querySelector('.apply-btn');
    this.closeBtn = this.querySelector('.close-btn');

    this.bindCaseToggle(this.caseBtn, () => { if (this.filterInput.value) this.applyFilter(); });
    this.applyBtn.addEventListener('click', () => this.applyFilter());
    this.closeBtn.addEventListener('click', () => this.close());

    const handleKeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.applyFilter(); }
    };

    this.filterInput.addEventListener('keydown', handleKeydown);
    this.filterInput.addEventListener('input', () => {
      if (!this.filterInput.value) {
        if (this.activeSheet?.filterRows !== null) this.applyFilter();
        else this.countBadge.textContent = '';
      }
    });
    this.colInput.addEventListener('keydown', handleKeydown);
    this.colInput.addEventListener('change', () => {
      this.updateColTitle();
      if (this.filterInput.value) this.applyFilter();
    });
  }

  getFocusableElements() {
    return [this.colInput, this.filterInput, this.caseBtn, this.applyBtn, this.closeBtn]
      .filter(el => el && !el.disabled && !el.hidden);
  }

  getColIndex() {
    const df = this.activeSheet?.df;
    const colVal = Number(this.colInput.value);
    return Math.max(0, Math.min((isNaN(colVal) ? 1 : colVal) - 1, (df?.width || 1) - 1));
  }

  updateColTitle() {
    const df = this.activeSheet?.df;
    if (!this.colTitle) return;
    if (!df) { this.colTitle.textContent = ''; return; }
    const colIndex = this.getColIndex();
    const title = df.get(colIndex, 0)?.trim() || `Column ${colIndex + 1}`;
    this.colTitle.textContent = title;
    this.colTitle.setAttribute('title', `Column ${colIndex + 1}: ${title}`);
  }

  open(colIndex) {
    if (getCsvHandle()?.viewOnly) {
      return Notification.warning('Filter is not available in Fast Preview mode.', 'Filter');
    }
    const activeSheet = this.activeSheet;
    if (!activeSheet?.df) return;

    this._previousLock ??= Boolean(activeSheet.df.lock);
    activeSheet.df.lock = true;
    if (activeSheet.isEditing) activeSheet.commitEdit?.();
    activeSheet.updateFooter?.();

    const maxCols = Math.max(1, activeSheet.df.width);
    this.colInput.min = 1;
    this.colInput.max = maxCols;
    const targetCol = (colIndex != null && colIndex >= 0) ? colIndex + 1 : activeSheet.x + 1;
    this.colInput.value = Math.max(1, Math.min(targetCol, maxCols));
    this.updateColTitle();

    this.showOverlay();
    if (activeSheet.filterRows === null) this.countBadge.textContent = '';
    this.filterInput.focus();
    this.filterInput.select();
  }

  close() {
    this.hideOverlay();
    const activeSheet = this.activeSheet;
    if (activeSheet) {
      activeSheet.clearFilter();
      if (activeSheet.df) activeSheet.df.lock = this._previousLock ?? false;
      this._previousLock = null;
      activeSheet.refresh?.();
      activeSheet.refreshSelection?.(true);
    }
    this.countBadge.textContent = '';
  }

  applyFilter() {
    const activeSheet = this.activeSheet;
    if (!activeSheet?.df) return;
    this.updateColTitle();
    activeSheet.setFilter(this.getColIndex(), this.filterInput.value, this.matchCase);
    if (activeSheet.filterRows === null) {
      this.countBadge.textContent = '';
    } else {
      const totalDataRows = activeSheet.df.height - (activeSheet.fixTop ? 1 : 0);
      this.countBadge.textContent = `${activeSheet.filterRows.length} / ${Math.max(1, totalDataRows)}`;
    }
  }
}

defineEl('ui-finder', FinderDialog);
defineEl('ui-filter', FilterDialog);
