import { dom } from './AppLayout.js';
import { DialogManager } from './DialogManager.js';
import { getSheet } from '../appContext.js';
import { setIcon } from '../utils/icons.js';
import { SearchEngine } from '../../../core/search/SearchEngine.js';

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

class FinderDialog extends BaseElement {
  constructor(sheet) {
    super();
    this.sheet = sheet;
    this.found = [];
    this.search = '';
    this.lastSearch = '';
    this.idx = 0;
    this.advanced = false;
    this.matchCase = false;

    this.widget = document.createElement('div');
    this.widget.className = 'finder-widget floating-panel';
    this.widget.innerHTML = `
      <div class="finder-row find-row">
        <button class="finder-toggle-btn icon" type="button" title="Toggle Replace (Ctrl+Shift+F)" aria-label="Toggle Replace"></button>
        <div class="finder-input-wrapper">
          <input type="text" class="finder-input find-input" placeholder="Find" aria-label="Find term" />
          <span class="finder-count-badge">No match</span>
        </div>
        <div class="finder-btn-group">
          <button class="finder-action-icon-btn case-btn icon" type="button" title="Match Case (Alt+C)" aria-label="Match Case" aria-pressed="false"></button>
          <button class="finder-action-icon-btn prev-btn icon" type="button" title="Previous Match (Shift+Enter)" aria-label="Previous Match"></button>
          <button class="finder-action-icon-btn next-btn icon" type="button" title="Next Match (Enter)" aria-label="Next Match"></button>
          <button class="finder-action-icon-btn close-btn icon" type="button" title="Close (Escape)" aria-label="Close"></button>
        </div>
      </div>
      <div class="finder-row replace-row hidden">
        <div class="finder-row-spacer"></div>
        <div class="finder-input-wrapper">
          <input type="text" class="finder-input replace-input" placeholder="Replace" aria-label="Replace term" />
        </div>
        <div class="finder-btn-group">
          <button class="finder-action-icon-btn replace-all-btn icon" type="button" title="Replace All (Alt+A)" aria-label="Replace All"></button>
        </div>
      </div>
    `;

    this.findIn = this.widget.querySelector('.find-input');
    this.replaceIn = this.widget.querySelector('.replace-input');
    this.foundInfo = this.widget.querySelector('.finder-count-badge');
    this.caseBtn = this.widget.querySelector('.case-btn');
    this.toggleBtn = this.widget.querySelector('.finder-toggle-btn');
    this.prevBtn = this.widget.querySelector('.prev-btn');
    this.nextBtn = this.widget.querySelector('.next-btn');
    this.closeBtn = this.widget.querySelector('.close-btn');
    this.replaceRow = this.widget.querySelector('.replace-row');
    this.replaceBtn = this.widget.querySelector('.replace-all-btn');

    setIcon(this.toggleBtn, 'arrow_right');
    setIcon(this.caseBtn, 'match_case');
    setIcon(this.prevBtn, 'arrow_up');
    setIcon(this.nextBtn, 'arrow_down');
    setIcon(this.closeBtn, 'off');
    setIcon(this.replaceBtn, 'find_replace');

    this.appendChild(this.widget);

    this.findIn.addEventListener('input', () => this.find());
    this.foundInfo.addEventListener('click', () => this.findNext());

    this.findIn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? this.findPrev() : this.findNext(); }
    });

    this.replaceIn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'Enter') { e.preventDefault(); this.replaceAll(); }
    });

    this.widget.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') DialogManager.cycleFocus(e, this.getFocusableElements());
    });

    this.toggleBtn.addEventListener('click', () => this.toggleReplaceRow());
    this.caseBtn.addEventListener('click', () => {
      this.matchCase = !this.matchCase;
      this.caseBtn.setAttribute('aria-pressed', this.matchCase ? 'true' : 'false');
      this.caseBtn.classList.toggle('active', this.matchCase);
      this.find(true);
    });
    this.prevBtn.addEventListener('click', () => this.findPrev());
    this.nextBtn.addEventListener('click', () => this.findNext());
    this.closeBtn.addEventListener('click', () => this.close());
    this.replaceBtn.addEventListener('click', () => this.replaceAll());
  }

  getFocusableElements() {
    const list = [this.toggleBtn, this.findIn, this.caseBtn, this.prevBtn, this.nextBtn, this.closeBtn];
    if (this.replaceRow && !this.replaceRow.classList.contains('hidden')) {
      list.push(this.replaceIn, this.replaceBtn);
    }
    return list.filter(el => el && !el.disabled && !el.hidden && !el.classList.contains('hidden') && el.style.display !== 'none');
  }

  toggleReplaceRow(show = this.replaceRow.classList.contains('hidden')) {
    this.replaceRow.classList.toggle('hidden', !show);
    this.toggleBtn.classList.toggle('expanded', show);
    this.advanced = Boolean(show);
    if (!show && (document.activeElement === this.replaceIn || document.activeElement === this.replaceBtn)) {
      this.findIn.focus();
    }
  }

  get activeSheet() { return this.sheet || getSheet(); }

  find(force = false) {
    const activeSheet = this.activeSheet;
    this.search = this.findIn.value;

    if (!this.search) {
      this.lastSearch = '';
      this.found = [];
      this.idx = 0;
    } else if (this.lastSearch === this.search && !force) {
      if (this.found.length > 0) this.idx = (this.idx + 1) % this.found.length;
    } else {
      this.lastSearch = this.search;
      this.idx = 0;
      this.found = activeSheet?.df
        ? new SearchEngine().find(activeSheet.df, { term: this.search, caseSensitive: this.matchCase })
        : [];
    }

    this.foundInfo.innerHTML = this.found.length === 0 ? 'No match' : `${this.idx + 1} / ${this.found.length}`;
    if (this.found.length > 0 && activeSheet) {
      activeSheet.focus_cell(this.found[this.idx].x, this.found[this.idx].y);
    }
  }

  findNext() {
    this.find(this.search !== this.findIn.value || this.found.length === 0);
  }

  findPrev() {
    if (this.search !== this.findIn.value || this.found.length === 0) return this.find(true);
    if (this.found.length > 0) {
      this.idx = (this.idx - 1 + this.found.length) % this.found.length;
      this.foundInfo.innerHTML = `${this.idx + 1} / ${this.found.length}`;
      this.activeSheet?.focus_cell(this.found[this.idx].x, this.found[this.idx].y);
    }
  }

  replaceAll() {
    if (!this.search) return;
    const activeSheet = this.activeSheet;
    if (!activeSheet?.df) return;

    new SearchEngine().replaceAll(activeSheet.df, {
      term: this.search,
      caseSensitive: this.matchCase
    }, this.replaceIn.value);

    activeSheet.refresh();
    activeSheet.slctRefresh(true);
    this.find(true);
  }

  findMenu(prefill = '', adv = false) {
    this.toggleReplaceRow(adv);
    if (prefill) this.findIn.value = prefill;
    this.show();
    this.findIn.focus();
    if (prefill) this.find(true);
  }

  show() {
    if (!this.parentNode) document.body.appendChild(this);
    this.classList.add('visible', 'open');
    this.setAttribute('open', '');
    this.removeAttribute('hidden');
    this.style.display = 'block';
  }

  close() {
    this.classList.remove('visible', 'open');
    this.removeAttribute('open');
    this.setAttribute('hidden', '');
    this.style.display = 'none';
    if (dom?.dialog?.contains(this)) DialogManager.close();
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('ui-finder')) {
  customElements.define('ui-finder', FinderDialog);
}

export { FinderDialog };
