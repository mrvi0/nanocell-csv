import { DialogManager } from './DialogManager.js';
import { getSheet, getCsvHandle } from '../appContext.js';
import { setIcon } from '../utils/icons.js';
import { Notification } from './Notification.js';
import { NumInput } from './settings/Setting.js';

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

class FilterDialog extends BaseElement {
  constructor(sheet) {
    super();
    this.sheet = sheet;
    this._previousLock = null;
    this.matchCase = false;

    this.widget = document.createElement('div');
    this.widget.className = 'finder-widget filter-widget floating-panel';
    this.widget.innerHTML = `
      <div class="finder-row filter-row filter-top-row">
        <div class="filter-col-container"></div>
        <div class="finder-input-wrapper">
          <input type="text" class="finder-input filter-input" placeholder="Filter column..." aria-label="Filter text" />
          <span class="finder-count-badge"></span>
        </div>
      </div>
      <div class="finder-row filter-row filter-bottom-row">
        <span class="filter-col-title" title="Selected column header"></span>
        <div class="finder-btn-group">
          <button class="finder-action-icon-btn case-btn icon" type="button" title="Match Case" aria-label="Match Case" aria-pressed="false"></button>
          <button class="finder-action-icon-btn apply-btn icon" type="button" title="Apply Filter (Enter)" aria-label="Apply Filter"></button>
          <button class="finder-action-icon-btn close-btn icon" type="button" title="Close (Escape)" aria-label="Close"></button>
        </div>
      </div>
    `;

    this.colInput = new NumInput(1, 1, 999, 'linear');
    this.colInput.setAttribute('aria-label', 'Column number');
    this.colInput.setAttribute('title', 'Column number');
    if (!this.colInput._initialized) this.colInput.connectedCallback?.();
    this.widget.querySelector('.filter-col-container').appendChild(this.colInput);

    this.colTitle = this.widget.querySelector('.filter-col-title');
    this.filterInput = this.widget.querySelector('.filter-input');
    this.countBadge = this.widget.querySelector('.finder-count-badge');
    this.caseBtn = this.widget.querySelector('.case-btn');
    this.applyBtn = this.widget.querySelector('.apply-btn');
    this.closeBtn = this.widget.querySelector('.close-btn');

    setIcon(this.caseBtn, 'match_case');
    setIcon(this.applyBtn, 'on');
    setIcon(this.closeBtn, 'off');
    this.appendChild(this.widget);

    this.applyBtn.addEventListener('click', () => this.applyFilter());
    this.closeBtn.addEventListener('click', () => this.close());
    this.caseBtn.addEventListener('click', () => {
      this.matchCase = !this.matchCase;
      this.caseBtn.setAttribute('aria-pressed', this.matchCase ? 'true' : 'false');
      this.caseBtn.classList.toggle('active', this.matchCase);
      if (this.filterInput.value) this.applyFilter();
    });

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

    this.widget.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.stopPropagation();
        DialogManager.cycleFocus(e, this.getFocusableElements());
      }
    });
  }

  getFocusableElements() {
    return [this.colInput, this.filterInput, this.caseBtn, this.applyBtn, this.closeBtn]
      .filter(el => el && !el.disabled && !el.hidden && el.style.display !== 'none');
  }

  get activeSheet() { return this.sheet || getSheet(); }
  get isOpen() { return this.classList.contains('open') || this.hasAttribute('open'); }

  getColIndex() {
    const df = this.activeSheet?.df;
    const colVal = Number(this.colInput.value);
    return Math.max(0, Math.min((isNaN(colVal) ? 1 : colVal) - 1, (df?.width || 1) - 1));
  }

  updateColTitle() {
    const df = this.activeSheet?.df;
    if (!df) {
      if (this.colTitle) this.colTitle.textContent = '';
      return;
    }
    const colIndex = this.getColIndex();
    const headerVal = df.get(colIndex, 0)?.trim();
    const title = headerVal || `Column ${colIndex + 1}`;
    if (this.colTitle) {
      this.colTitle.textContent = title;
      this.colTitle.setAttribute('title', `Column ${colIndex + 1}: ${title}`);
    }
  }

  open(colIndex) {
    if (getCsvHandle()?.viewOnly) {
      Notification.warning('Filter is not available in Fast Preview mode.', 'Filter');
      return;
    }
    const activeSheet = this.activeSheet;
    if (!activeSheet?.df) return;

    if (this._previousLock === null || this._previousLock === undefined) {
      this._previousLock = Boolean(activeSheet.df.lock);
    }
    activeSheet.df.lock = true;
    if (activeSheet.inputing) activeSheet.inputBlur?.();
    activeSheet.view?.footerUpdate();

    const maxCols = Math.max(1, activeSheet.df.width);
    this.colInput.min = 1;
    this.colInput.max = maxCols;
    const targetCol = (colIndex !== undefined && colIndex !== null && colIndex >= 0) ? colIndex + 1 : activeSheet.x + 1;
    this.colInput.value = Math.max(1, Math.min(targetCol, maxCols));
    this.updateColTitle();

    if (!this.parentNode) document.body.appendChild(this);
    this.classList.add('visible', 'open');
    this.setAttribute('open', '');
    this.removeAttribute('hidden');
    this.style.display = 'block';

    if (activeSheet.filterRows === null) this.countBadge.textContent = '';
    this.filterInput.focus();
    this.filterInput.select();
  }

  close() {
    this.classList.remove('visible', 'open');
    this.removeAttribute('open');
    this.setAttribute('hidden', '');
    this.style.display = 'none';

    const activeSheet = this.activeSheet;
    if (activeSheet) {
      activeSheet.clearFilter();
      if (activeSheet.df) activeSheet.df.lock = this._previousLock ?? false;
      this._previousLock = null;
      activeSheet.view?.footerUpdate();
      activeSheet.view?.refresh();
      activeSheet.slctRefresh?.(true);
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

if (typeof customElements !== 'undefined' && !customElements.get('ui-filter')) {
  customElements.define('ui-filter', FilterDialog);
}

export { FilterDialog };
