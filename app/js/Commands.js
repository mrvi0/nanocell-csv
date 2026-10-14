import { getSheet, getCsvHandle, Setting, settings, pwa, formatShortcut } from './state.js';
import { AboutDialog, SettingDialog, DialogManager } from './Dialogs.js';
import { triggerAppInstall } from './Notification.js';
import { dom, startCoordEdit } from './AppLayout.js';
import { ValidationPane } from './ValidationPane.js';
import { setIcon, escapeHtml } from './icons.js';

function fuzzyScore(query, text) {
  if (!query) return 1;
  if (!text) return 0;
  const q = query.trim().toLowerCase(), t = text.toLowerCase();
  if (!q) return 1;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - (t.length - q.length);
  for (const word of t.split(/[\s_\-/]+/)) {
    if (word.startsWith(q)) return 600 - (t.length - q.length);
  }
  const subIdx = t.indexOf(q);
  if (subIdx !== -1) return 400 - subIdx;

  let qIdx = 0, score = 0, consecutive = 0, prevMatchIdx = -10;
  for (let i = 0; i < t.length && qIdx < q.length; i++) {
    if (t[i] === q[qIdx]) {
      score += 10;
      consecutive = (i === prevMatchIdx + 1) ? consecutive + 1 : 0;
      score += consecutive * 5;
      prevMatchIdx = i;
      qIdx++;
    }
  }
  return qIdx === q.length ? score : 0;
}

class CommandPalette extends HTMLElement {
  static _defaultCommands = null;

  static setDefaultCommands(commandMap) {
    CommandPalette._defaultCommands = commandMap;
    const existing = typeof document !== 'undefined'
      ? (document.getElementById('palette') || document.querySelector('ui-command-palette'))
      : null;
    if (existing) existing.commands = commandMap;
  }

  constructor() {
    super();
    this.commands = CommandPalette._defaultCommands || null;
    this.selectedIndex = 0;
    this.filteredCommands = [];
    this.style.display = 'none';
    this._initialized = false;
  }

  connectedCallback() {
    this.init();
    this.commands ||= CommandPalette._defaultCommands;
  }

  init() {
    if (this._initialized) return;
    this._initialized = true;

    this.setAttribute('role', 'dialog');
    this.setAttribute('aria-modal', 'true');
    this.innerHTML = `
      <div class="cmd-palette-backdrop palette-backdrop"></div>
      <div class="cmd-palette-modal palette-container">
        <div class="cmd-palette-header">
          <input type="text" class="cmd-palette-input palette-input" placeholder="Type a command or search..." autofocus />
          <span class="cmd-palette-close icon" role="button" title="Close (Esc)" aria-label="Close"></span>
        </div>
        <ul class="cmd-palette-list command-list" role="listbox"></ul>
        <div class="cmd-palette-footer">
          <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> Navigate</span>
          <span><kbd>&crarr;</kbd> Select</span>
          <span><kbd>Esc</kbd> Dismiss</span>
        </div>
      </div>
    `;

    this.classList.remove('open');
    this.removeAttribute('open');
    this.style.display = 'none';

    this.backdropEl = this.querySelector('.cmd-palette-backdrop');
    this.inputEl = this.querySelector('input');
    this.listEl = this.querySelector('.cmd-palette-list');
    this.closeBtn = this.querySelector('.cmd-palette-close');

    this.backdropEl?.addEventListener('click', () => this.close());
    if (this.closeBtn) {
      setIcon(this.closeBtn, 'off');
      this.closeBtn.addEventListener('click', () => this.close());
    }
    this.inputEl?.addEventListener('input', () => this.filterCommands());
    this.inputEl?.addEventListener('keydown', (event) => this.handleKeyDown(event));
  }

  get isOpen() {
    return Boolean(this.classList.contains('open') || this.hasAttribute('open') || this.style.display === 'block');
  }

  getCommands() {
    const canInstall = pwa.getState().canInstall;
    const commandMap = this.commands || CommandPalette._defaultCommands || {};
    return Object.entries(commandMap)
      .filter(([id, command]) => command && typeof command.run === 'function' && (id !== 'installApp' || canInstall))
      .map(([id, command]) => ({
        id,
        label: command.label || id,
        description: command.description || command.label || id,
        shortcut: formatShortcut(command),
        run: command.run
      }));
  }

  filterCommands() {
    this.init();
    this.commands ||= CommandPalette._defaultCommands;
    const query = (this.inputEl?.value || '').trim();
    const allCommands = this.getCommands();

    this.filteredCommands = !query ? allCommands : allCommands
      .map(command => ({
        command,
        score: Math.max(fuzzyScore(query, command.description), fuzzyScore(query, command.label || '') * 0.95, fuzzyScore(query, command.id) * 0.9)
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.command);
    this.selectedIndex = 0;
    this.renderList();
  }

  setSelectedIndex(index, scrollIntoView = true) {
    if (index < 0 || index >= this.filteredCommands.length) return;
    if (this.listEl?.children.length > 0) {
      const prevEl = this.listEl.children[this.selectedIndex];
      if (prevEl) {
        prevEl.classList.remove('selected');
        prevEl.setAttribute('aria-selected', 'false');
      }
      this.selectedIndex = index;
      const currentEl = this.listEl.children[this.selectedIndex];
      if (currentEl) {
        currentEl.classList.add('selected');
        currentEl.setAttribute('aria-selected', 'true');
        if (scrollIntoView) {
          try { currentEl.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch {}
        }
      }
    } else {
      this.selectedIndex = index;
    }
  }

  renderList() {
    this.init();
    if (!this.listEl) return;
    this.listEl.innerHTML = '';

    if (this.filteredCommands.length === 0) {
      this.listEl.innerHTML = '<li class="cmd-palette-empty">No matching commands</li>';
      return;
    }

    this.filteredCommands.forEach((commandItem, index) => {
      const li = document.createElement('li');
      const isSelected = index === this.selectedIndex;
      li.className = `cmd-palette-item command-item ${isSelected ? 'selected' : ''}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      li.setAttribute('data-index', index);
      li.innerHTML = `
        <span class="cmd-palette-item-label">${escapeHtml(commandItem.description)}</span>
        ${commandItem.shortcut ? `<span class="cmd-palette-item-shortcut command-key">${escapeHtml(commandItem.shortcut)}</span>` : ''}
      `;
      li.addEventListener('mouseenter', () => this.setSelectedIndex(index, false));
      li.addEventListener('click', () => this.executeIndex(index));
      this.listEl.appendChild(li);
    });

    try { this.listEl.children[this.selectedIndex]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch {}
  }

  handleKeyDown(event) {
    this.init();
    const length = this.filteredCommands.length;
    if (event.key === 'ArrowDown' && length > 0) {
      event.preventDefault();
      this.setSelectedIndex((this.selectedIndex + 1) % length, true);
    } else if (event.key === 'ArrowUp' && length > 0) {
      event.preventDefault();
      this.setSelectedIndex((this.selectedIndex - 1 + length) % length, true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.executeIndex(this.selectedIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  executeIndex(index) {
    const item = this.filteredCommands[index];
    if (item && typeof item.run === 'function') {
      this.close();
      item.run();
    }
  }

  open() {
    this.init();
    this.commands ||= CommandPalette._defaultCommands;
    this.classList.add('open');
    this.setAttribute('open', '');
    this.style.display = 'block';
    if (this.inputEl) this.inputEl.value = '';
    this.filterCommands();
    setTimeout(() => this.inputEl?.focus(), 10);
  }

  close() {
    this.init();
    this.classList.remove('open');
    this.removeAttribute('open');
    this.style.display = 'none';
  }

  toggle() {
    this.init();
    if (this.isOpen) this.close();
    else this.open();
  }

  static toggle(commandMap = null) {
    let palette = typeof document !== 'undefined'
      ? (document.getElementById('palette') || document.querySelector('ui-command-palette'))
      : null;
    if (!palette && typeof document !== 'undefined') {
      palette = document.createElement('ui-command-palette');
      palette.id = 'palette';
      document.body.appendChild(palette);
    }
    if (palette) {
      const activeCommands = commandMap || CommandPalette._defaultCommands;
      if (activeCommands) palette.commands = activeCommands;
      palette.toggle?.();
    }
    return palette;
  }
}

class ContextMenu extends HTMLElement {
  constructor() {
    super();
    this.table = document.createElement('table');
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'cmenu-header';
    this.targetCol = null;

    this.items = [
      { id: 'filter', label: 'Filter', symbol: '', run: () => commands.filter?.run(this.targetCol) },
      { id: 'sortAsc', label: 'Sort', symbol: 'A<br>Z', run: (event) => commands.sortAscending?.run(event) },
      { id: 'sortDesc', label: 'Sort', symbol: 'Z<br>A', run: (event) => commands.sortDescending?.run(event) },
      { id: 'roundInt', label: 'Round', symbol: 'N', run: (event) => commands.integer?.run(event) },
      { id: 'roundDec', label: 'Round', symbol: '$', run: (event) => commands.decimal?.run(event) },
      { id: 'insertCol', label: 'Insert', symbol: '&verbar;', run: (event) => commands.insertLeft?.run(event) },
      { id: 'insertRow', label: 'Insert', symbol: '&horbar;', run: (event) => commands.insertUp?.run(event) },
      { id: 'deleteCol', label: 'Delete', symbol: '&verbar;', run: (event) => commands.deleteCol?.run(event) },
      { id: 'deleteRow', label: 'Delete', symbol: '&horbar;', run: (event) => commands.deleteRow?.run(event) },
    ];

    this.addEventListener('mouseout', (event) => {
      if (!this.contains(event.relatedTarget)) this.hide();
    });
  }

  hide() {
    this.classList.remove('open', 'visible');
    this.removeAttribute('open');
    this.style.display = 'none';
  }

  ensureInitialized() {
    if (this._menuInitialized) return;
    this._menuInitialized = true;
    this.table.innerHTML = '';
    for (const item of this.items) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><div>${item.label}</div></td>${item.symbol ? `<td><div class="cmenu-opt">${item.symbol}</div></td>` : ''}`;
      tr.addEventListener('click', (event) => {
        this.hide();
        item.run(event);
      });
      this.table.appendChild(tr);
    }
    if (!this.headerEl.parentNode) {
      this.appendChild(this.headerEl);
      this.appendChild(this.table);
    }
  }

  connectedCallback() {
    this.hide();
    this.ensureInitialized();
  }

  showItems(visibleIds) {
    for (let i = 0; i < this.items.length; i++) {
      const isVisible = visibleIds.includes(this.items[i].id);
      this.table.rows[i].classList.toggle('hidden', !isVisible);
      this.table.rows[i].style.display = isVisible ? 'table-row' : 'none';
    }
  }

  openAt(event) {
    this.ensureInitialized();
    const sheet = getSheet();
    const targetCell = event.target.closest?.('td, th');
    if (!sheet || !targetCell || !sheet.contains(targetCell) || (targetCell.colOffset < 0 && targetCell.rowOffset < 0)) return;

    this.colOffset = targetCell.colOffset;
    this.rowOffset = targetCell.rowOffset;

    const menuWidth = 140, menuHeight = 220;
    const left = (typeof window !== 'undefined' && event.clientX + menuWidth > window.innerWidth)
      ? Math.max(0, event.clientX - menuWidth)
      : event.clientX - 2;
    const top = (typeof window !== 'undefined' && event.clientY + menuHeight > window.innerHeight)
      ? Math.max(0, event.clientY - menuHeight)
      : event.clientY - 2;
    this.style.left = `${left}px`;
    this.style.top = `${top}px`;

    if (this.rowOffset < 0) {
      this.targetCol = this.colOffset + sheet.baseX;
      sheet.selectCol(this.targetCol);
      this.headerEl.innerText = `col : ${targetCell.innerText}`;
      this.showItems(['filter', 'sortAsc', 'sortDesc', 'roundInt', 'roundDec', 'insertCol', 'deleteCol']);
    } else if (this.colOffset < 0) {
      this.targetCol = null;
      sheet.selectRow(this.rowOffset + sheet.baseY);
      this.headerEl.innerText = `row : ${targetCell.innerText}`;
      this.showItems(['roundInt', 'roundDec', 'insertRow', 'deleteRow']);
    } else if (targetCell.classList.contains('selected')) {
      this.targetCol = null;
      this.headerEl.innerText = 'selection';
      this.showItems(['roundInt', 'roundDec', 'deleteCol', 'deleteRow']);
    } else {
      this.targetCol = targetCell.colOffset + sheet.baseX;
      sheet.x = targetCell.colOffset + sheet.baseX;
      sheet.y = targetCell.rowOffset + sheet.baseY;
      sheet.refreshSelection();
      this.headerEl.innerText = 'cell';
      this.showItems(['roundInt', 'roundDec', 'insertCol', 'insertRow', 'deleteCol', 'deleteRow']);
    }

    this.classList.add('open', 'visible');
    this.setAttribute('open', '');
    this.style.display = 'block';
  }
}

if (typeof customElements !== 'undefined') {
  if (!customElements.get('ui-command-palette')) customElements.define('ui-command-palette', CommandPalette);
  if (!customElements.get('ui-cmenu')) customElements.define('ui-cmenu', ContextMenu);
}

const commands = {
  about: { label: 'About', key: 'H', ctrl: true, run: () => AboutDialog.show(), description: 'About' },
  installApp: { label: 'Install Desktop App', run: () => triggerAppInstall(), description: 'Install NanoCell as standalone desktop app' },
  new: { label: 'New Sheet', key: 'N', ctrl: true, run: () => getCsvHandle()?.new(), description: 'New sheet' },
  deleteRow: { label: 'Delete Row', key: 'BACKSPACE', ctrl: true, run: () => getSheet()?.deleteRows(), description: 'Delete Row' },
  deleteCol: { label: 'Delete Col', key: 'BACKSPACE', ctrl: true, shift: true, run: () => getSheet()?.deleteCols(), description: 'Delete Col' },
  delete: { label: 'Delete Selection', key: 'BACKSPACE', run: () => getSheet()?.deleteSelection(), description: 'Delete Selection' },
  settings: { label: 'Settings', key: 'G', ctrl: true, run: () => SettingDialog.show(), description: 'Display Settings' },
  shortcuts: { label: 'Command Palette', key: 'P', ctrl: true, run: () => CommandPalette.toggle(commands), description: 'Command Palette' },
  selectAll: { label: 'Select All', key: 'A', ctrl: true, run: () => getSheet()?.selectAll(), description: 'Select All' },
  transpose: { label: 'Transpose', key: 'T', ctrl: true, shift: true, run: () => getSheet()?.transposeSelection(), description: 'Transpose rows and columns (selection or whole sheet)' },
  trim: { label: 'Trim Empty Rows/Cols', key: 'T', ctrl: true, alt: true, run: () => getSheet()?.trim(), description: 'Trim : remove all empty rows/cols' },
  integer: { label: 'Round to Integer', key: 'I', ctrl: true, run: () => getSheet()?.round(true), description: 'Round selection to integer' },
  decimal: { label: 'Round to Decimal', key: '$', ctrl: true, run: () => getSheet()?.round(false), description: 'Round selection to decimal' },
  fixTop: { label: 'Freeze Header Row', icon: 'fix_top', key: 'B', ctrl: true, run: () => getSheet()?.toggleFixTop(), description: 'Freeze Header Row' },
  undo: { label: 'Undo', key: 'Z', ctrl: true, run: () => getSheet()?.undo(), description: 'Undo' },
  redo: { label: 'Redo', key: 'Z', ctrl: true, shift: true, run: () => getSheet()?.redo(), description: 'Redo' },
  date: { label: "Insert Today's Date", key: ';', ctrl: true, run: () => getSheet()?.insertDate(), description: "Insert today's date" },
  validateDates: { label: 'Validate: Date Formats (YYYY-MM-DD)', run: () => ValidationPane.run('dates'), description: 'Standardize date formats across columns to YYYY-mm-dd' },
  validateWhitespace: { label: 'Validate: Trim Whitespace', run: () => ValidationPane.run('trim_whitespace'), description: 'Remove leading and trailing whitespace from cell text' },
  validateCommaDecimals: { label: 'Validate: Decimal Comma -> Dot', run: () => ValidationPane.run('comma_decimals'), description: 'Convert comma decimals (3,14) to dot notation in numeric fields' },
  validateLineReturns: { label: 'Validate: Line Returns -> Pipe', run: () => ValidationPane.run('line_returns'), description: 'Replace embedded newline line breaks with pipe character (|)' },
  validateQuotes: { label: 'Validate: Double Quotes -> Single', run: () => ValidationPane.run('double_quotes'), description: 'Replace double quotation marks (") with single quotes (\')' },
  validateTextCommas: { label: 'Validate: Text Commas -> Dash', run: () => ValidationPane.run('text_commas'), description: 'Replace commas inside text cells with hyphens (-)' },
  validateLowercase: { label: 'Validate: Force Lowercase', run: () => ValidationPane.run('lowercase'), description: 'Convert all text cells to lowercase' },
  filter: { label: 'Filter Column', key: 'Q', ctrl: true, run: (col) => getSheet()?.openFilter(col), description: 'Filter sheet rows by column value' },
  find: { label: 'Find & Match', key: 'F', ctrl: true, run: () => getSheet()?.find(false), description: 'Quick find / match' },
  findAdvanced: { label: 'Advanced Find / Replace', key: 'F', ctrl: true, shift: true, run: () => getSheet()?.find(true), description: 'Advanced find / replace' },
  toggleActionBar: { label: 'Toggle Menu Bar', key: 'M', ctrl: true, run: () => Setting.toggleActionBar(), description: 'Toggle action bar display' },
  open: { label: 'Open File', key: 'O', ctrl: true, run: () => getCsvHandle()?.open(), description: 'Open a CSV file from the file finder' },
  save: { label: 'Save', key: 'S', ctrl: true, run: () => getCsvHandle()?.save(), description: 'Save' },
  saveAs: { label: 'Save As', key: 'S', ctrl: true, shift: true, run: () => getCsvHandle()?.saveAs(), description: 'Save As' },
  reloadFile: { label: 'Reload File', icon: 'reload_file', key: 'R', ctrl: true, run: () => getCsvHandle()?.reloadFile(), description: 'Reload file from last save' },
  expand: { label: 'Expand Row', key: 'E', ctrl: true, run: () => getSheet()?.expand(), description: 'Expand first row to selection' },
  validateData: { label: 'Validate Data: Open Pane', icon: 'validate_data', key: 'P', ctrl: true, shift: true, run: () => ValidationPane.toggle(), description: 'Open data validation pane with all validation rules' },
  validateHeaders: { label: 'Validate: Headers & SQL Compliance', key: 'H', ctrl: true, shift: true, run: () => ValidationPane.run('headers'), description: 'Validate and sanitize column headers for SQL identifier standards and duplicates' },
  nextOccurrence: { label: 'Next Occurrence', key: 'D', ctrl: true, run: () => getSheet()?.goToOccurrence(true), description: 'Go to next occurrence of cell value' },
  prevOccurrence: { label: 'Previous Occurrence', key: 'D', ctrl: true, shift: true, run: () => getSheet()?.goToOccurrence(false), description: 'Go to previous occurrence of cell value' },
  goToCoordinate: { label: 'Go to Coordinate', run: () => startCoordEdit(), description: 'Go to coordinate' },
  sortAscending: { label: 'Sort Ascending', icon: 'sort', key: 'L', ctrl: true, run: () => { const s = getSheet(); s?.sort(s.x, true); }, description: 'Sort rows based on active column (ascending order)' },
  sortDescending: { label: 'Sort Descending', icon: 'sort_reverse', key: 'L', ctrl: true, shift: true, run: () => { const s = getSheet(); s?.sort(s.x, false); }, description: 'Sort rows based on active column (descending order)' },
  shiftUp: { label: 'Shift Row Up', key: 'ARROWUP', alt: true, run: () => getSheet()?.shift(0), description: 'Shift row up' },
  shiftDown: { label: 'Shift Row Down', key: 'ARROWDOWN', alt: true, run: () => getSheet()?.shift(2), description: 'Shift row down' },
  shiftRight: { label: 'Shift Col Right', key: 'ARROWRIGHT', alt: true, run: () => getSheet()?.shift(1), description: 'Shift col right' },
  shiftLeft: { label: 'Shift Col Left', key: 'ARROWLEFT', alt: true, run: () => getSheet()?.shift(3), description: 'Shift col left' },
  insertUp: { label: 'Insert Row Above', key: 'ARROWUP', shift: true, alt: true, run: () => getSheet()?.insert(0), description: 'Insert row above' },
  insertDown: { label: 'Insert Row Below', key: 'ARROWDOWN', shift: true, alt: true, run: () => getSheet()?.insert(2), description: 'Insert row below' },
  insertRight: { label: 'Insert Col Right', key: 'ARROWRIGHT', shift: true, alt: true, run: () => getSheet()?.insert(1), description: 'Insert col right' },
  insertLeft: { label: 'Insert Col Left', key: 'ARROWLEFT', shift: true, alt: true, run: () => getSheet()?.insert(3), description: 'Insert col left' },
  exportJson: { label: 'Export as JSON', run: () => getCsvHandle()?.exportJson(), description: 'Export current sheet as JSON file' },
  exportTsv: { label: 'Export as TSV', run: () => getCsvHandle()?.exportTsv(), description: 'Export current sheet as Tab-Separated Values (TSV) file' },
  exportMarkdown: { label: 'Export as Markdown', run: () => getCsvHandle()?.exportMarkdown(), description: 'Export current sheet as GitHub Flavored Markdown table' },
  copyMarkdown: { label: 'Copy as Markdown', run: () => getCsvHandle()?.copyMarkdown(), description: 'Copy active selection as Markdown table to clipboard' },
  copyJson: { label: 'Copy as JSON', run: () => getCsvHandle()?.copyJson(), description: 'Copy active selection as JSON to clipboard' },
};

CommandPalette.setDefaultCommands(commands);

let activeKeyDownHandler = null;
let activeKeyUpHandler = null;
let activeCopyHandler = null;
let activeCutHandler = null;
let activePasteHandler = null;
let shortcutMap = null;

function getShortcutKey(key, ctrl, shift, alt) {
  return `${ctrl ? 1 : 0}:${shift ? 1 : 0}:${alt ? 1 : 0}:${String(key).toUpperCase()}`;
}

function getShortcutMap() {
  if (!shortcutMap) {
    shortcutMap = new Map();
    for (const command of Object.values(commands)) {
      if (!command.key || typeof command.run !== 'function') continue;
      const keyUpper = String(command.key).toUpperCase();
      const ctrl = Boolean(command.ctrl), shift = Boolean(command.shift), alt = Boolean(command.alt);
      shortcutMap.set(getShortcutKey(keyUpper, ctrl, shift, alt), command);
      if (command.key !== keyUpper) shortcutMap.set(getShortcutKey(command.key, ctrl, shift, alt), command);
    }
    if (commands.delete) shortcutMap.set(getShortcutKey('DELETE', false, false, false), commands.delete);
    if (commands.redo) shortcutMap.set(getShortcutKey('Y', true, false, false), commands.redo);
    if (commands.shortcuts) shortcutMap.set(getShortcutKey('K', true, false, false), commands.shortcuts);
  }
  return shortcutMap;
}

const PREVENT_DEFAULT_KEYS = new Set([
  'H', 'N', 'T', 'F', 'O', 'P', 'M', 'S', 'R', 'G', 'K',
  'A', 'B', 'D', 'E', 'L', 'Z', 'Y', 'Q', ';', 'BACKSPACE'
]);

const isInputElement = (el) =>
  Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));

export function buildKeys() {
  shortcutMap = null;
  if (typeof document !== 'undefined') {
    if (activeKeyDownHandler) document.removeEventListener('keydown', activeKeyDownHandler);
    if (activeKeyUpHandler) document.removeEventListener('keyup', activeKeyUpHandler);
    if (activeCopyHandler) document.removeEventListener('copy', activeCopyHandler);
    if (activeCutHandler) document.removeEventListener('cut', activeCutHandler);
    if (activePasteHandler) document.removeEventListener('paste', activePasteHandler);
  }

  activeKeyDownHandler = (event) => {
    let key = event.key.toUpperCase();
    const ctrlDown = event.metaKey || event.ctrlKey;
    const alt = event.altKey;
    const shift = event.shiftKey;
    const activeSheet = getSheet();

    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    const isCellInput = Boolean(activeSheet?.isEditing && activeEl === activeSheet.inputField);
    const inCommandPalette = Boolean(
      activeEl?.closest?.('ui-command-palette') ||
      dom?.palette?.isOpen ||
      (typeof document !== 'undefined' && document.querySelector('ui-command-palette')?.isOpen)
    );
    const inDialog = Boolean(DialogManager.isBusy);
    const inFinder = Boolean(activeEl?.closest?.('ui-finder'));
    const inFilter = Boolean(activeEl?.closest?.('ui-filter'));
    const validationPane = dom?.validationPane || (typeof document !== 'undefined' ? (document.getElementById('validation-pane') || document.querySelector('ui-validation-pane')) : null);
    const inValidationPane = Boolean(validationPane?.isOpen);
    const isOtherInput = isInputElement(activeEl) && !isCellInput;

    if (ctrlDown && (PREVENT_DEFAULT_KEYS.has(key) || PREVENT_DEFAULT_KEYS.has(event.key))) {
      if (!(isOtherInput || isCellInput) || (key !== 'C' && key !== 'V' && key !== 'X' && key !== 'A' && key !== 'Z')) {
        event.preventDefault();
      }
    }

    if (inCommandPalette) {
      if (key === 'ESCAPE') {
        (document.getElementById('palette') || document.querySelector('ui-command-palette'))?.close?.();
      }
      return;
    }

    if (ctrlDown && (key === 'P' || key === 'K') && !shift && !alt) {
      event.preventDefault();
      if (commands.shortcuts?.run) commands.shortcuts.run();
      else (document.getElementById('palette') || document.querySelector('ui-command-palette'))?.toggle?.();
      return;
    }

    if (inDialog) {
      if (key === 'ESCAPE') { event.preventDefault(); DialogManager.close(); }
      return;
    }

    if (inFinder) {
      if (key === 'ESCAPE') { event.preventDefault(); activeEl.closest('ui-finder')?.close?.(); }
      else if (ctrlDown && key === 'F') { event.preventDefault(); activeSheet?.find(shift); }
      return;
    }

    if (inFilter) {
      if (key === 'ESCAPE' || (ctrlDown && key === 'Q')) { event.preventDefault(); activeEl.closest('ui-filter')?.close?.(); }
      return;
    }

    if (inValidationPane && key === 'ESCAPE' && !isCellInput) {
      event.preventDefault();
      validationPane.handleBack?.();
      return;
    }

    if (isOtherInput) return;

    if (isCellInput) {
      if (ctrlDown && (key === 'S' || key === 'O' || key === 'Q')) {
        event.preventDefault();
        if (key === 'S') (shift ? commands.saveAs : commands.save).run();
        else if (key === 'O') commands.open.run();
        else if (key === 'Q') commands.filter.run();
      }
      return;
    }

    const isBoundaryKey = key === 'ARROWUP' || key === 'ARROWDOWN' || key === 'ARROWLEFT' || key === 'ARROWRIGHT' ||
                          key === 'HOME' || key === 'END' || key === 'PAGEUP' || key === 'PAGEDOWN';
    if (activeSheet) {
      activeSheet.isSelectingRange = shift && !alt && !event.metaKey && isBoundaryKey;
    }

    if ((alt && key === 'TAB') || (ctrlDown && (key === 'C' || key === 'V'))) return;
    if (key === 'TAB') event.preventDefault();
    if (event.code === 'Space') key = 'SPACE';

    if (activeSheet) {
      const pageSize = settings?.rows || 10;
      const maxX = Math.max(0, activeSheet.df.width - 1);
      const maxY = Math.max(0, activeSheet.rowCount - 1);

      if (key === 'PAGEUP') {
        event.preventDefault();
        activeSheet.y = Math.max(0, activeSheet.y - pageSize);
        return activeSheet.refreshSelection();
      }
      if (key === 'PAGEDOWN') {
        event.preventDefault();
        activeSheet.y = Math.min(maxY, activeSheet.y + pageSize);
        return activeSheet.refreshSelection();
      }
      if (key === 'HOME') {
        event.preventDefault();
        activeSheet.x = 0;
        if (ctrlDown) activeSheet.y = 0;
        return activeSheet.refreshSelection();
      }
      if (key === 'END' && ctrlDown) {
        event.preventDefault();
        activeSheet.x = maxX;
        activeSheet.y = maxY;
        return activeSheet.refreshSelection();
      }
      if (key === 'F2') {
        event.preventDefault();
        if (!activeSheet.df?.lock) activeSheet.startEdit();
        return;
      }
      if (ctrlDown) {
        if (key === 'ARROWUP') { event.preventDefault(); activeSheet.y = 0; return activeSheet.refreshSelection(); }
        if (key === 'ARROWRIGHT') { event.preventDefault(); activeSheet.x = maxX; return activeSheet.refreshSelection(); }
        if (key === 'ARROWDOWN') { event.preventDefault(); activeSheet.y = maxY; return activeSheet.refreshSelection(); }
        if (key === 'ARROWLEFT') { event.preventDefault(); activeSheet.x = 0; return activeSheet.refreshSelection(); }
      }
    }

    const map = getShortcutMap();
    const matchedCmd = map.get(getShortcutKey(key, ctrlDown, shift, alt)) ||
                       map.get(getShortcutKey(event.key, ctrlDown, shift, alt));
    if (matchedCmd) {
      matchedCmd.run();
      return event.preventDefault();
    }

    if (event.key.length === 1 && !ctrlDown && !event.metaKey && !alt && activeSheet) {
      if (activeSheet.df?.lock) return;
      event.preventDefault();
      return activeSheet.startEdit(event.key);
    }

    if (activeSheet) {
      switch (key) {
        case 'ARROWUP': event.preventDefault(); activeSheet.y--; activeSheet.refreshSelection(); return;
        case 'ARROWDOWN': event.preventDefault(); activeSheet.y++; activeSheet.refreshSelection(); return;
        case 'ARROWLEFT': event.preventDefault(); activeSheet.x--; activeSheet.refreshSelection(); return;
        case 'ARROWRIGHT': event.preventDefault(); activeSheet.x++; activeSheet.refreshSelection(); return;
        case 'TAB':
          event.preventDefault();
          activeSheet.isSelectingRange = false;
          activeSheet.rangeEnd = undefined;
          activeSheet.x += shift ? -1 : 1;
          activeSheet.refreshSelection();
          return;
        case 'ENTER':
          event.preventDefault();
          if (!activeSheet.df?.lock) activeSheet.startEdit();
          return;
        case 'BACKSPACE':
        case 'DELETE':
          event.preventDefault();
          if (!activeSheet.df?.lock) {
            activeSheet.editSelection('');
            activeSheet.refresh();
          }
          return;
      }
    }
  };

  activeKeyUpHandler = (event) => {
    const key = event.key.toUpperCase();
    const activeSheet = getSheet();
    if (activeSheet && (key === 'CONTROL' || key === 'SHIFT') && !event.shiftKey) {
      activeSheet.isSelectingRange = false;
    }
  };

  const getClipboardSheet = (requireUnlocked = false) => {
    if (isInputElement(document.activeElement)) return null;
    const sheet = getSheet();
    return (!sheet || (requireUnlocked && sheet.df?.lock)) ? null : sheet;
  };

  activeCopyHandler = (event) => {
    const sheet = getClipboardSheet(false);
    if (!sheet) return;
    event.preventDefault();
    event.clipboardData?.setData('text/plain', sheet.copySelection());
  };

  activeCutHandler = (event) => {
    const sheet = getClipboardSheet(true);
    if (!sheet) return;
    event.preventDefault();
    event.clipboardData?.setData('text/plain', sheet.cutSelection());
  };

  activePasteHandler = (event) => {
    const sheet = getClipboardSheet(true);
    if (!sheet) return;
    event.preventDefault();
    const rawText = event.clipboardData?.getData('text');
    if (rawText) sheet.pasteText(rawText);
  };

  document.addEventListener('keydown', activeKeyDownHandler);
  document.addEventListener('keyup', activeKeyUpHandler);
  document.addEventListener('copy', activeCopyHandler);
  document.addEventListener('cut', activeCutHandler);
  document.addEventListener('paste', activePasteHandler);
}

export { commands, formatShortcut, CommandPalette, ContextMenu };
