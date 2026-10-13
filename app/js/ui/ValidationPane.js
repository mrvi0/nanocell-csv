import { getSheet } from '../appContext.js';
import { setIcon } from '../utils/icons.js';
import { Notification } from './Notification.js';
import { DataValidator } from '../../../core/validation/DataValidator.js';

export const VALIDATION_RULES = [
  { id: 'headers', label: 'Headers & SQL Compliance', description: 'Sanitize column headers for SQL identifier standards and duplicates', icon: 'validate_headers' },
  { id: 'dates', label: 'Date Formats (YYYY-MM-DD)', description: 'Standardize date formats across columns to YYYY-mm-dd', icon: 'date_checker' },
  { id: 'trim_whitespace', label: 'Trim Whitespace', description: 'Remove leading and trailing whitespace from cell text', icon: 'trim' },
  { id: 'comma_decimals', label: 'Decimal Comma -> Dot', description: 'Convert comma decimals (3,14) to dot notation in numeric fields', icon: 'decimal' },
  { id: 'line_returns', label: 'Line Returns -> Pipe', description: 'Replace embedded newline line breaks with pipe character (|)', icon: 'replace' },
  { id: 'double_quotes', label: 'Double Quotes -> Single', description: 'Replace double quotation marks (") with single quotes (\')', icon: 'replace' },
  { id: 'text_commas', label: 'Text Commas -> Dash', description: 'Replace commas inside text cells with hyphens (-)', icon: 'replace' },
  { id: 'lowercase', label: 'Force Lowercase', description: 'Convert all text cells to lowercase', icon: 'match_case' },
];

const ITEM_HEIGHT = 44;

class ValidationPane extends HTMLElement {
  constructor() {
    super();
    this.items = [];
    this.colItems = [];
    this.currentRule = null;
    this.currentCol = null;
    this.view = 'rules';
    this.selectedItem = null;
    this._initialized = false;
    this._lastTxTimestamp = 0;
  }

  connectedCallback() {
    this.init();
  }

  get isOpen() {
    return this.classList.contains('open') && this.style.display !== 'none';
  }

  init() {
    if (this._initialized) return;
    this._initialized = true;

    this.classList.add('ui-validation-pane');
    this.setAttribute('role', 'region');
    this.setAttribute('aria-label', 'Validation Results');

    this.innerHTML = `
      <div class="validation-pane-header">
        <div class="validation-header-left">
          <button class="icon validation-btn back-btn" id="validation-back-btn" type="button" title="Back" aria-label="Back" data-icon="arrow_left"></button>
          <span class="validation-pane-title" id="validation-title">Data Validation</span>
          <span class="validation-badge" id="validation-count-badge">0</span>
        </div>
        <div class="validation-pane-action-bar">
          <button class="icon validation-btn accept-all-btn" id="validation-accept-all-btn" type="button" title="Accept all proposed edits" aria-label="Accept all proposed edits" data-icon="done_all"></button>
          <button class="icon validation-btn reject-all-btn" id="validation-reject-all-btn" type="button" title="Reject all proposed edits" aria-label="Reject all proposed edits" data-icon="exit"></button>
          <button class="icon validation-btn close-btn" id="validation-close-btn" type="button" title="Close validation pane" aria-label="Close validation pane" data-icon="off"></button>
        </div>
      </div>
      <div class="validation-pane-content scroll" id="validation-content">
        <div class="validation-rules-view" id="validation-rules-view"></div>
        <div class="validation-columns-view" id="validation-columns-view"></div>
        <div class="validation-detail-view" id="validation-detail-view">
          <div class="validation-virtual-spacer" id="validation-virtual-spacer">
            <div class="validation-virtual-content" id="validation-virtual-content"></div>
          </div>
          <div class="validation-empty-state" id="validation-empty-state">No validation issues found.</div>
        </div>
      </div>
    `;

    this.contentContainer = this.querySelector('#validation-content');
    this.titleEl = this.querySelector('#validation-title');
    this.countBadge = this.querySelector('#validation-count-badge');
    this.backBtn = this.querySelector('#validation-back-btn');
    this.acceptAllBtn = this.querySelector('#validation-accept-all-btn');
    this.rejectAllBtn = this.querySelector('#validation-reject-all-btn');
    this.closeBtn = this.querySelector('#validation-close-btn');
    this.rulesView = this.querySelector('#validation-rules-view');
    this.columnsView = this.querySelector('#validation-columns-view');
    this.detailView = this.querySelector('#validation-detail-view');
    this.virtualSpacer = this.querySelector('#validation-virtual-spacer');
    this.virtualContent = this.querySelector('#validation-virtual-content');

    this.applyIcons(this);

    this.backBtn?.addEventListener('click', () => this.handleBack());
    this.acceptAllBtn?.addEventListener('click', () => this.handleAcceptAll());
    this.rejectAllBtn?.addEventListener('click', () => this.handleRejectAll());
    this.closeBtn?.addEventListener('click', () => this.close());
    this.contentContainer?.addEventListener('scroll', () => {
      if (this.view === 'detail') this.renderVirtualWindow();
    }, { passive: true });

    this.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.handleBack();
      }
    });

    this.rulesView?.addEventListener('click', (e) => {
      const ruleId = e.target.closest('.validation-rule-card')?.dataset.ruleId;
      if (ruleId) this.runRule(ruleId);
    });

    this.columnsView?.addEventListener('click', (e) => {
      const btn = e.target.closest('.validation-btn');
      if (btn) {
        e.stopPropagation();
        const col = parseInt(btn.dataset.col, 10);
        if (!Number.isNaN(col)) {
          if (btn.classList.contains('col-accept-btn')) this.resolveItems(this.getPendingItems(col), true);
          else if (btn.classList.contains('col-reject-btn')) this.resolveItems(this.getPendingItems(col), false);
          else if (btn.classList.contains('col-inspect-btn')) this.showDetail(col);
        }
        return;
      }
      const card = e.target.closest('.validation-col-card');
      if (card) this.showDetail(parseInt(card.dataset.col, 10));
    });

    this.virtualContent?.addEventListener('click', (e) => {
      const card = e.target.closest('.validation-item');
      if (!card) return;
      const item = this.colItems[parseInt(card.dataset.idx, 10)];
      if (!item) return;

      const btn = e.target.closest('.validation-btn');
      if (btn) {
        e.stopPropagation();
        if (btn.classList.contains('item-accept-btn')) this.resolveItems([item], true);
        else if (btn.classList.contains('item-reject-btn')) this.resolveItems([item], false);
        return;
      }
      this.handleItemClick(item, card);
    });

    this.showRules();
  }

  applyIcons(container = this) {
    if (!container) return;
    for (const el of container.querySelectorAll('[data-icon]')) {
      setIcon(el, el.dataset.icon);
    }
  }

  getColHeader(colIndex) {
    const df = getSheet()?.df;
    return (df ? df.get(colIndex, 0) : '') || `col_${colIndex + 1}`;
  }

  getPendingItems(colIndex = null) {
    return this.items.filter(item =>
      (item.status === 'pending' || !item.status) && (colIndex === null || item.x === colIndex)
    );
  }

  getColumnGroups() {
    const groupsMap = new Map();
    for (const item of this.getPendingItems()) {
      let group = groupsMap.get(item.x);
      if (!group) {
        group = { x: item.x, header: this.getColHeader(item.x), items: [] };
        groupsMap.set(item.x, group);
      }
      group.items.push(item);
    }
    return Array.from(groupsMap.values()).sort((a, b) => a.x - b.x);
  }

  show() {
    this.init();
    this.classList.add('open');
    this.setAttribute('open', '');
    this.removeAttribute('hidden');
    this.style.display = 'flex';
  }

  toggle() {
    if (this.isOpen) {
      if (this.view === 'rules') this.close();
      else this.showRules();
    } else {
      this.show();
      this.showRules();
    }
  }

  close() {
    this.init();
    this.classList.remove('open');
    this.removeAttribute('open');
    this.setAttribute('hidden', '');
    this.style.display = 'none';
  }

  runRule(ruleId) {
    this.init();
    const s = getSheet();
    if (!s?.df) return;

    if (s.df.lock) {
      Notification.warning('File is in View-Only mode. Edits are disabled.', 'Validation');
      return;
    }

    const rule = VALIDATION_RULES.find(r => r.id === ruleId);
    if (!rule) return;

    const { proposals, reason } = DataValidator.runRule(s.df, ruleId);
    if (reason === 'coexistence') {
      Notification.warning("Both 'dd-mm-YYYY' and 'mm-dd-YYYY' formats coexist in the file.", 'Date Validation');
    } else if (reason === 'ambiguous') {
      Notification.warning('Cannot determine date format with certainty: no date has a digit over 12.', 'Date Validation');
    }

    if (!proposals || proposals.length === 0) {
      Notification.success(`No issues found for ${rule.label}.`, 'Validation');
      if (this.view !== 'rules') this.showRules();
      return;
    }

    this.currentRule = rule;
    this.items = proposals;
    this.show();
    this.showColumns();
  }

  handleBack() {
    if (this.view === 'detail') this.showColumns();
    else if (this.view === 'columns') this.showRules();
    else this.close();
  }

  handleAcceptAll() {
    if (this.view === 'columns') {
      const pending = this.getPendingItems();
      if (pending.length === 0) return;
      this.resolveItems(pending, true);
    } else if (this.view === 'detail' && this.currentCol !== null) {
      this.resolveItems(this.getPendingItems(this.currentCol), true);
    }
  }

  handleRejectAll() {
    if (this.view === 'columns') {
      this.resolveItems(this.getPendingItems(), false);
    } else if (this.view === 'detail' && this.currentCol !== null) {
      this.resolveItems(this.getPendingItems(this.currentCol), false);
    }
  }

  setView(mode, title, count = 0, scopeLabel = '') {
    this.view = mode;
    const isRoot = mode === 'rules';
    if (this.backBtn) this.backBtn.style.display = isRoot ? 'none' : 'inline-flex';
    if (this.titleEl) this.titleEl.textContent = title;
    if (this.countBadge) {
      this.countBadge.textContent = count;
      this.countBadge.style.display = isRoot ? 'none' : 'inline-block';
    }
    if (this.acceptAllBtn) {
      this.acceptAllBtn.style.display = isRoot ? 'none' : 'inline-flex';
      if (scopeLabel) {
        const label = `Accept all corrections ${scopeLabel}`;
        this.acceptAllBtn.title = label;
        this.acceptAllBtn.setAttribute('aria-label', label);
      }
    }
    if (this.rejectAllBtn) {
      this.rejectAllBtn.style.display = isRoot ? 'none' : 'inline-flex';
      if (scopeLabel) {
        const label = `Reject all corrections ${scopeLabel}`;
        this.rejectAllBtn.title = label;
        this.rejectAllBtn.setAttribute('aria-label', label);
      }
    }
    if (this.rulesView) this.rulesView.style.display = mode === 'rules' ? 'flex' : 'none';
    if (this.columnsView) this.columnsView.style.display = mode === 'columns' ? 'flex' : 'none';
    if (this.detailView) this.detailView.style.display = mode === 'detail' ? 'block' : 'none';
  }

  showRules() {
    this.init();
    this.currentRule = null;
    this.currentCol = null;
    this.selectedItem = null;
    this.setView('rules', 'Validation');
    if (!this.rulesView) return;

    this.rulesView.innerHTML = VALIDATION_RULES.map(rule => `
      <div class="validation-rule-card" data-rule-id="${rule.id}">
        <button class="icon validation-rule-icon" type="button" tabindex="-1" aria-hidden="true" data-icon="${rule.icon}"></button>
        <div class="validation-rule-body">
          <div class="validation-rule-title">${this.escapeHtml(rule.label)}</div>
          <div class="validation-rule-desc">${this.escapeHtml(rule.description)}</div>
        </div>
        <button class="icon validation-rule-nav" type="button" tabindex="-1" aria-hidden="true" data-icon="arrow_right"></button>
      </div>
    `).join('');
    this.applyIcons(this.rulesView);
  }

  showColumns() {
    this.init();
    this.currentCol = null;
    this.selectedItem = null;
    const pending = this.getPendingItems();
    if (pending.length === 0) return this.showRules();

    this.setView('columns', this.currentRule ? this.currentRule.label : 'Columns', pending.length, 'across all columns');
    this.renderColumns();
  }

  renderColumns() {
    if (!this.columnsView) return;
    const groups = this.getColumnGroups();
    if (groups.length === 0) return this.showRules();

    if (this.countBadge) this.countBadge.textContent = this.getPendingItems().length;
    this.columnsView.innerHTML = groups.map(group => `
      <div class="validation-col-card" data-col="${group.x}">
        <div class="validation-col-info">
          <span class="validation-col-label">Col ${group.x + 1}: ${this.escapeHtml(group.header)}</span>
          <span class="validation-col-count">${group.items.length}</span>
        </div>
        <div class="validation-col-actions">
          <button class="icon validation-btn col-accept-btn" type="button" title="Accept column ${group.x + 1}" aria-label="Accept column ${group.x + 1}" data-icon="on" data-col="${group.x}"></button>
          <button class="icon validation-btn col-reject-btn" type="button" title="Reject column ${group.x + 1}" aria-label="Reject column ${group.x + 1}" data-icon="off" data-col="${group.x}"></button>
          <button class="icon validation-btn col-inspect-btn" type="button" title="Inspect individual corrections" aria-label="Inspect individual corrections" data-icon="arrow_right" data-col="${group.x}"></button>
        </div>
      </div>
    `).join('');
    this.applyIcons(this.columnsView);
  }

  showDetail(colIndex) {
    this.init();
    this.currentCol = colIndex;
    const inCol = this.getPendingItems(colIndex);
    if (inCol.length === 0) return this.showColumns();

    this.setView('detail', `Col ${colIndex + 1}: ${this.getColHeader(colIndex)}`, inCol.length, `in Col ${colIndex + 1}`);
    this.renderDetail();
  }

  renderDetail() {
    if (!this.detailView) return;
    this.colItems = this.getPendingItems(this.currentCol);
    if (this.colItems.length === 0) return this.showColumns();

    if (this.countBadge) this.countBadge.textContent = this.colItems.length;
    if (this.virtualSpacer) {
      this.virtualSpacer.style.height = `${this.colItems.length * ITEM_HEIGHT}px`;
    }
    this._lastRenderStart = -1;
    this._lastRenderEnd = -1;
    this.renderVirtualWindow();
  }

  resolveItems(itemsList, accept) {
    if (!itemsList || itemsList.length === 0) return;
    if (accept) {
      const s = getSheet();
      if (s?.df) {
        if (s.df.lock) {
          Notification.warning('File is in View-Only mode. Edits are disabled.', 'Validation');
          return;
        }
        const changes = itemsList.map(item => ({
          x: item.x,
          y: item.y,
          oldValue: item.oldValue,
          newValue: item.newValue
        }));
        const txTimestamp = Math.max(Date.now(), (this._lastTxTimestamp || 0) + 105);
        this._lastTxTimestamp = txTimestamp;
        s.df.create({ type: 'RANGE_EDIT', timestamp: txTimestamp, payload: { changes } });
      }
      for (const item of itemsList) item.status = 'accepted';
      const s2 = getSheet();
      if (s2) {
        s2.reload?.();
        s2.slctRefresh?.(true);
      }
    } else {
      for (const item of itemsList) item.status = 'rejected';
    }

    if (this.getPendingItems().length === 0) {
      Notification.success('All corrections resolved.', 'Validation');
      this.showRules();
      return;
    }
    if (this.view === 'detail') {
      if (this.getPendingItems(this.currentCol).length === 0) this.showColumns();
      else this.renderDetail();
    } else if (this.view === 'columns') {
      this.renderColumns();
    }
  }

  renderVirtualWindow() {
    if (!this.virtualContent) return;
    const total = this.colItems.length;
    if (total === 0) {
      this.virtualContent.innerHTML = '';
      this.virtualContent.style.transform = 'translateY(0px)';
      return;
    }

    const scrollTop = this.contentContainer ? this.contentContainer.scrollTop : 0;
    const containerHeight = this.contentContainer?.clientHeight || 600;
    const startIndex = Math.max(0, Math.min(total - 1, Math.floor(scrollTop / ITEM_HEIGHT)));
    const endIndex = Math.min(total, Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT));
    const renderStart = Math.max(0, startIndex - 5);
    const renderEnd = Math.min(total, endIndex + 5);

    this.virtualContent.style.transform = `translateY(${renderStart * ITEM_HEIGHT}px)`;
    if (this._lastRenderStart === renderStart && this._lastRenderEnd === renderEnd && this._lastSelected === this.selectedItem) {
      return;
    }
    this._lastRenderStart = renderStart;
    this._lastRenderEnd = renderEnd;
    this._lastSelected = this.selectedItem;

    let html = '';
    for (let i = renderStart; i < renderEnd; i++) {
      const item = this.colItems[i];
      html += `
        <div class="validation-item ${this.selectedItem === item ? 'selected' : ''}" data-idx="${i}">
          <div class="validation-item-diff">
            <span class="diff-old" title="${this.escapeHtml(item.oldValue)}">${this.formatVal(item.oldValue)}</span>
            <span class="diff-arrow">&rarr;</span>
            <span class="diff-new" title="${this.escapeHtml(item.newValue)}">${this.formatVal(item.newValue)}</span>
          </div>
          <div class="validation-item-actions">
            <button class="icon validation-btn item-accept-btn" type="button" title="Accept edit" aria-label="Accept edit" data-icon="on"></button>
            <button class="icon validation-btn item-reject-btn" type="button" title="Reject edit" aria-label="Reject edit" data-icon="off"></button>
          </div>
        </div>
      `;
    }
    this.virtualContent.innerHTML = html;
    this.applyIcons(this.virtualContent);
  }

  handleItemClick(item, cardEl) {
    this.selectedItem = item;
    if (this.virtualContent) {
      for (const c of this.virtualContent.querySelectorAll('.validation-item')) {
        c.classList.toggle('selected', c === cardEl);
      }
    }
    getSheet()?.focus_cell?.(item.x, item.y);
  }

  formatVal(val) {
    if (val === undefined || val === null || val === '') return '<em>empty</em>';
    const escaped = this.escapeHtml(val);
    return escaped.includes('\n') ? escaped.replace(/\n/g, '\\n') : escaped;
  }

  escapeHtml(str) {
    if (typeof str !== 'string') str = String(str ?? '');
    if (!/[&<>"']/.test(str)) return str;
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

if (!customElements.get('ui-validation-pane')) {
  customElements.define('ui-validation-pane', ValidationPane);
}

export { ValidationPane };
