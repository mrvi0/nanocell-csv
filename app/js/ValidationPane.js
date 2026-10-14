/**
 * @file app/js/ValidationPane.js
 * Three-tier validation drawer (<ui-validation-pane>) with virtualized item list.
 */

import { getSheet } from './state.js';
import { BaseElement, defineEl, hydrateIcons, setOpen, escapeHtml } from './icons.js';
import { Notification } from './Notification.js';
import { DataValidator, VALIDATION_RULES } from '../../core/DataValidator.js';

export { VALIDATION_RULES };

const ITEM_HEIGHT = 44;

export class ValidationPane extends BaseElement {
  static getInstance() {
    return globalThis.document?.getElementById?.('validation-pane') || globalThis.document?.querySelector?.('ui-validation-pane') || null;
  }

  static toggle() {
    const pane = ValidationPane.getInstance();
    if (pane) pane.toggle ? pane.toggle() : pane.show?.();
  }

  static run(ruleId) {
    const pane = ValidationPane.getInstance();
    if (pane) {
      pane.show?.();
      pane.runRule?.(ruleId);
    }
  }

  constructor() {
    super();
    this.items = [];
    this.colItems = [];
    this.currentRule = null;
    this.currentCol = null;
    this.view = 'rules';
    this.selectedItem = null;
    this._initialized = false;
  }

  connectedCallback() { this.init(); }

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

    hydrateIcons(this);

    this.backBtn?.addEventListener('click', () => this.handleBack());
    this.acceptAllBtn?.addEventListener('click', () => this.resolveScope(true));
    this.rejectAllBtn?.addEventListener('click', () => this.resolveScope(false));
    this.closeBtn?.addEventListener('click', () => this.close());
    this.contentContainer?.addEventListener('scroll', () => {
      if (this.view === 'detail') this.renderVirtualWindow();
    }, { passive: true });

    this.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.handleBack(); }
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
          if (btn.classList.contains('col-inspect-btn')) this.showDetail(col);
          else this.resolveItems(this.getPendingItems(col), btn.classList.contains('col-accept-btn'));
        }
        return;
      }
      const card = e.target.closest('.validation-col-card');
      if (card) this.showDetail(parseInt(card.dataset.col, 10));
    });

    this.virtualContent?.addEventListener('click', (e) => {
      const card = e.target.closest('.validation-item');
      const item = card ? this.colItems[parseInt(card.dataset.idx, 10)] : null;
      if (!item) return;

      const btn = e.target.closest('.validation-btn');
      if (btn) {
        e.stopPropagation();
        this.resolveItems([item], btn.classList.contains('item-accept-btn'));
        return;
      }
      this.handleItemClick(item, card);
    });

    this.showRules();
  }

  getColHeader(colIndex) {
    return getSheet()?.df?.get(colIndex, 0) || `col_${colIndex + 1}`;
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
    setOpen(this, true, 'flex');
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
    setOpen(this, false);
  }

  runRule(ruleId) {
    this.init();
    const sheet = getSheet();
    if (!sheet?.df) return;
    if (sheet.df.lock) return Notification.warning('File is in View-Only mode. Edits are disabled.', 'Validation');

    const rule = VALIDATION_RULES.find(r => r.id === ruleId);
    if (!rule) return;

    const { proposals, reason } = DataValidator.runRule(sheet.df, ruleId);
    if (reason === 'coexistence') {
      Notification.warning("Both 'dd-mm-YYYY' and 'mm-dd-YYYY' formats coexist in the file.", 'Date Validation');
    } else if (reason === 'ambiguous') {
      Notification.warning('Cannot determine date format with certainty: no date has a digit over 12.', 'Date Validation');
    }

    if (!proposals?.length) {
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

  resolveScope(accept) {
    if (this.view === 'columns') this.resolveItems(this.getPendingItems(), accept);
    else if (this.view === 'detail' && this.currentCol !== null) this.resolveItems(this.getPendingItems(this.currentCol), accept);
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
    for (const [btn, verb] of [[this.acceptAllBtn, 'Accept'], [this.rejectAllBtn, 'Reject']]) {
      if (!btn) continue;
      btn.style.display = isRoot ? 'none' : 'inline-flex';
      if (scopeLabel) {
        const label = `${verb} all corrections ${scopeLabel}`;
        btn.title = label;
        btn.setAttribute('aria-label', label);
      }
    }
    if (this.rulesView) this.rulesView.style.display = mode === 'rules' ? 'flex' : 'none';
    if (this.columnsView) this.columnsView.style.display = mode === 'columns' ? 'flex' : 'none';
    if (this.detailView) this.detailView.style.display = mode === 'detail' ? 'block' : 'none';
  }

  showRules() {
    this.init();
    this.currentRule = this.currentCol = this.selectedItem = null;
    this.setView('rules', 'Validation');
    if (!this.rulesView) return;

    this.rulesView.innerHTML = VALIDATION_RULES.map(rule => `
      <div class="validation-rule-card" data-rule-id="${rule.id}">
        <button class="icon validation-rule-icon" type="button" tabindex="-1" aria-hidden="true" data-icon="${rule.icon}"></button>
        <div class="validation-rule-body">
          <div class="validation-rule-title">${escapeHtml(rule.label)}</div>
          <div class="validation-rule-desc">${escapeHtml(rule.description)}</div>
        </div>
        <button class="icon validation-rule-nav" type="button" tabindex="-1" aria-hidden="true" data-icon="arrow_right"></button>
      </div>
    `).join('');
    hydrateIcons(this.rulesView);
  }

  showColumns() {
    this.init();
    this.currentCol = this.selectedItem = null;
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
    this.columnsView.innerHTML = groups.map(g => `
      <div class="validation-col-card" data-col="${g.x}">
        <div class="validation-col-info">
          <span class="validation-col-label">Col ${g.x + 1}: ${escapeHtml(g.header)}</span>
          <span class="validation-col-count">${g.items.length}</span>
        </div>
        <div class="validation-col-actions">
          <button class="icon validation-btn col-accept-btn" type="button" title="Accept column ${g.x + 1}" aria-label="Accept column ${g.x + 1}" data-icon="on" data-col="${g.x}"></button>
          <button class="icon validation-btn col-reject-btn" type="button" title="Reject column ${g.x + 1}" aria-label="Reject column ${g.x + 1}" data-icon="off" data-col="${g.x}"></button>
          <button class="icon validation-btn col-inspect-btn" type="button" title="Inspect individual corrections" aria-label="Inspect individual corrections" data-icon="arrow_right" data-col="${g.x}"></button>
        </div>
      </div>
    `).join('');
    hydrateIcons(this.columnsView);
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
    if (this.virtualSpacer) this.virtualSpacer.style.height = `${this.colItems.length * ITEM_HEIGHT}px`;
    this._lastRenderStart = this._lastRenderEnd = -1;
    this.renderVirtualWindow();
  }

  resolveItems(itemsList, accept) {
    if (!itemsList?.length) return;
    if (accept) {
      const sheet = getSheet();
      if (sheet?.df) {
        if (sheet.df.lock) return Notification.warning('File is in View-Only mode. Edits are disabled.', 'Validation');
        sheet.df.applyChanges(itemsList.map(({ x, y, oldValue, newValue }) => ({ x, y, oldValue, newValue })));
        sheet.reload?.();
        sheet.refreshSelection?.(true);
      }
      for (const item of itemsList) item.status = 'accepted';
    } else {
      for (const item of itemsList) item.status = 'rejected';
    }

    if (this.getPendingItems().length === 0) {
      Notification.success('All corrections resolved.', 'Validation');
      return this.showRules();
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
    if (this._lastRenderStart === renderStart && this._lastRenderEnd === renderEnd && this._lastSelected === this.selectedItem) return;
    this._lastRenderStart = renderStart;
    this._lastRenderEnd = renderEnd;
    this._lastSelected = this.selectedItem;

    let html = '';
    for (let i = renderStart; i < renderEnd; i++) {
      const item = this.colItems[i];
      html += `
        <div class="validation-item ${this.selectedItem === item ? 'selected' : ''}" data-idx="${i}">
          <div class="validation-item-diff">
            <span class="diff-old" title="${escapeHtml(item.oldValue)}">${this.formatValue(item.oldValue)}</span>
            <span class="diff-arrow">&rarr;</span>
            <span class="diff-new" title="${escapeHtml(item.newValue)}">${this.formatValue(item.newValue)}</span>
          </div>
          <div class="validation-item-actions">
            <button class="icon validation-btn item-accept-btn" type="button" title="Accept edit" aria-label="Accept edit" data-icon="on"></button>
            <button class="icon validation-btn item-reject-btn" type="button" title="Reject edit" aria-label="Reject edit" data-icon="off"></button>
          </div>
        </div>
      `;
    }
    this.virtualContent.innerHTML = html;
    hydrateIcons(this.virtualContent);
  }

  handleItemClick(item, cardEl) {
    this.selectedItem = item;
    if (this.virtualContent) {
      for (const card of this.virtualContent.querySelectorAll('.validation-item')) {
        card.classList.toggle('selected', card === cardEl);
      }
    }
    getSheet()?.focusCell?.(item.x, item.y);
  }

  formatValue(value) {
    if (!value) return '<em>empty</em>';
    return escapeHtml(value).replaceAll('\n', '\\n');
  }
}

defineEl('ui-validation-pane', ValidationPane);
