import { getSheet, getCsvHandle, Setting, stg, pwa, formatShortcut } from './state.js';
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

  static setDefaultCommands(commands) {
    CommandPalette._defaultCommands = commands;
    const existing = typeof document !== 'undefined'
      ? (document.getElementById('palette') || document.querySelector('ui-command-palette'))
      : null;
    if (existing) existing.commands = commands;
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
      <div class="cmd_palette_backdrop palette-backdrop"></div>
      <div class="cmd_palette_modal palette-container">
        <div class="cmd_palette_header">
          <input type="text" class="cmd_palette_input palette-input" placeholder="Type a command or search..." autofocus />
          <span class="cmd_palette_close icon" role="button" title="Close (Esc)" aria-label="Close"></span>
        </div>
        <ul class="cmd_palette_list command-list" role="listbox"></ul>
        <div class="cmd_palette_footer">
          <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> Navigate</span>
          <span><kbd>&crarr;</kbd> Select</span>
          <span><kbd>Esc</kbd> Dismiss</span>
        </div>
      </div>
    `;

    this.classList.remove('open');
    this.removeAttribute('open');
    this.style.display = 'none';

    this.backdropEl = this.querySelector('.cmd_palette_backdrop');
    this.inputEl = this.querySelector('input');
    this.listEl = this.querySelector('.cmd_palette_list');
    this.closeBtn = this.querySelector('.cmd_palette_close');

    this.backdropEl?.addEventListener('click', () => this.close());
    if (this.closeBtn) {
      setIcon(this.closeBtn, 'off');
      this.closeBtn.addEventListener('click', () => this.close());
    }
    this.inputEl?.addEventListener('input', () => this.filterCommands());
    this.inputEl?.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  get isOpen() {
    return Boolean(this.classList.contains('open') || this.hasAttribute('open') || this.style.display === 'block');
  }

  getCommands() {
    const canInstall = pwa.getState().canInstall;
    const commandMap = this.commands || CommandPalette._defaultCommands || {};
    return Object.entries(commandMap)
      .filter(([id, c]) => c && typeof c.run === 'function' && (id !== 'installApp' || canInstall))
      .map(([id, c]) => ({
        id,
        label: c.label || id,
        description: c.description || c.label || id,
        key: formatShortcut(c),
        run: c.run
      }));
  }

  filterCommands() {
    this.init();
    this.commands ||= CommandPalette._defaultCommands;
    const query = (this.inputEl?.value || '').trim();
    const all = this.getCommands();

    this.filteredCommands = !query ? all : all
      .map(c => ({
        cmd: c,
        score: Math.max(fuzzyScore(query, c.description), fuzzyScore(query, c.label || '') * 0.95, fuzzyScore(query, c.id) * 0.9)
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.cmd);
    this.selectedIndex = 0;
    this.renderList();
  }

  setSelectedIndex(idx, scrollIntoView = true) {
    if (idx < 0 || idx >= this.filteredCommands.length) return;
    if (this.listEl?.children.length > 0) {
      const prev = this.listEl.children[this.selectedIndex];
      if (prev) {
        prev.classList.remove('selected');
        prev.setAttribute('aria-selected', 'false');
      }
      this.selectedIndex = idx;
      const current = this.listEl.children[this.selectedIndex];
      if (current) {
        current.classList.add('selected');
        current.setAttribute('aria-selected', 'true');
        if (scrollIntoView) {
          try { current.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch {}
        }
      }
    } else {
      this.selectedIndex = idx;
    }
  }

  renderList() {
    this.init();
    if (!this.listEl) return;
    this.listEl.innerHTML = '';

    if (this.filteredCommands.length === 0) {
      this.listEl.innerHTML = '<li class="cmd_palette_empty">No matching commands</li>';
      return;
    }

    this.filteredCommands.forEach((cmdItem, idx) => {
      const li = document.createElement('li');
      const isSel = idx === this.selectedIndex;
      li.className = `cmd_palette_item command-item ${isSel ? 'selected' : ''}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', isSel ? 'true' : 'false');
      li.setAttribute('data-index', idx);
      li.innerHTML = `
        <span class="cmd_palette_item_label">${escapeHtml(cmdItem.description)}</span>
        ${cmdItem.key ? `<span class="cmd_palette_item_shortcut command-key">${escapeHtml(cmdItem.key)}</span>` : ''}
      `;
      li.addEventListener('mouseenter', () => this.setSelectedIndex(idx, false));
      li.addEventListener('click', () => this.executeIndex(idx));
      this.listEl.appendChild(li);
    });

    try { this.listEl.children[this.selectedIndex]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch {}
  }

  handleKeyDown(e) {
    this.init();
    const len = this.filteredCommands.length;
    if (e.key === 'ArrowDown' && len > 0) {
      e.preventDefault();
      this.setSelectedIndex((this.selectedIndex + 1) % len, true);
    } else if (e.key === 'ArrowUp' && len > 0) {
      e.preventDefault();
      this.setSelectedIndex((this.selectedIndex - 1 + len) % len, true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.executeIndex(this.selectedIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  executeIndex(idx) {
    const item = this.filteredCommands[idx];
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

  static toggle(commands = null) {
    let palette = typeof document !== 'undefined'
      ? (document.getElementById('palette') || document.querySelector('ui-command-palette'))
      : null;
    if (!palette && typeof document !== 'undefined') {
      palette = document.createElement('ui-command-palette');
      palette.id = 'palette';
      document.body.appendChild(palette);
    }
    if (palette) {
      const cmds = commands || CommandPalette._defaultCommands;
      if (cmds) palette.commands = cmds;
      palette.toggle?.();
    }
    return palette;
  }
}

class ContextMenu extends HTMLElement {
  constructor() {
    super();
    this.table = document.createElement('table');
    this.firstBlock = document.createElement('div');
    this.firstBlock.className = 'cmenu_header';
    this.targetCol = null;

    this.list = [
      { key: 'fl', txt: 'Filter', opt: '', run: () => cmd.filter?.run(this.targetCol) },
      { key: 'sa', txt: 'Sort', opt: 'A<br>Z', run: (e) => cmd.sort?.run(e) },
      { key: 'sd', txt: 'Sort', opt: 'Z<br>A', run: (e) => cmd.sort_reverse?.run(e) },
      { key: 'rn', txt: 'Round', opt: 'N', run: (e) => cmd.integer?.run(e) },
      { key: 'rf', txt: 'Round', opt: '$', run: (e) => cmd.decimal?.run(e) },
      { key: 'ic', txt: 'Insert', opt: '&verbar;', run: (e) => cmd.insertLeft?.run(e) },
      { key: 'ir', txt: 'Insert', opt: '&horbar;', run: (e) => cmd.insertUp?.run(e) },
      { key: 'dc', txt: 'Delete', opt: '&verbar;', run: (e) => cmd.deleteCol?.run(e) },
      { key: 'dr', txt: 'Delete', opt: '&horbar;', run: (e) => cmd.deleteRow?.run(e) },
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
    for (const item of this.list) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><div>${item.txt}</div></td>${item.opt ? `<td><div class="cmenu_opt">${item.opt}</div></td>` : ''}`;
      tr.addEventListener('click', (ev) => {
        this.hide();
        item.run(ev);
      });
      this.table.appendChild(tr);
    }
    if (!this.firstBlock.parentNode) {
      this.appendChild(this.firstBlock);
      this.appendChild(this.table);
    }
  }

  connectedCallback() {
    this.hide();
    this.ensureInitialized();
  }

  showItems(showList) {
    for (let i = 0; i < this.list.length; i++) {
      const isVisible = showList.includes(this.list[i].key);
      this.table.rows[i].classList.toggle('hidden', !isVisible);
      this.table.rows[i].style.display = isVisible ? 'table-row' : 'none';
    }
  }

  pop(e) {
    this.ensureInitialized();
    const sheet = getSheet();
    const targetCell = e.target.closest?.('td, th');
    if (!sheet || !targetCell || !sheet.contains(targetCell) || (targetCell.tx < 0 && targetCell.ty < 0)) return;

    this.x = targetCell.tx;
    this.y = targetCell.ty;

    const menuWidth = 140, menuHeight = 220;
    const x = (typeof window !== 'undefined' && e.clientX + menuWidth > window.innerWidth)
      ? Math.max(0, e.clientX - menuWidth)
      : e.clientX - 2;
    const y = (typeof window !== 'undefined' && e.clientY + menuHeight > window.innerHeight)
      ? Math.max(0, e.clientY - menuHeight)
      : e.clientY - 2;
    this.style.left = `${x}px`;
    this.style.top = `${y}px`;

    if (this.y < 0) {
      this.targetCol = this.x + sheet.baseX;
      sheet.slctCol(this.targetCol);
      this.firstBlock.innerText = `col : ${targetCell.innerText}`;
      this.showItems(['fl', 'sa', 'sd', 'rn', 'rf', 'ic', 'dc']);
    } else if (this.x < 0) {
      this.targetCol = null;
      sheet.slctRow(this.y + sheet.baseY);
      this.firstBlock.innerText = `row : ${targetCell.innerText}`;
      this.showItems(['rn', 'rf', 'ir', 'dr']);
    } else if (targetCell.classList.contains('slct')) {
      this.targetCol = null;
      this.firstBlock.innerText = 'selection';
      this.showItems(['rn', 'rf', 'dc', 'dr']);
    } else {
      this.targetCol = targetCell.tx + sheet.baseX;
      sheet.x = targetCell.tx + sheet.baseX;
      sheet.y = targetCell.ty + sheet.baseY;
      sheet.slctRefresh();
      this.firstBlock.innerText = 'cell';
      this.showItems(['rn', 'rf', 'ic', 'ir', 'dc', 'dr']);
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

const cmd = {
  about: { label: 'About', k: 'H', ctrl: true, run: () => AboutDialog.show(), description: 'About' },
  installApp: { label: 'Install Desktop App', run: () => triggerAppInstall(), description: 'Install NanoCell as standalone desktop app' },
  new: { label: 'New Sheet', k: 'N', ctrl: true, run: () => getCsvHandle()?.new(), description: 'New sheet' },
  deleteRow: { label: 'Delete Row', k: 'BACKSPACE', ctrl: true, run: () => getSheet()?.deleteRows(), description: 'Delete Row' },
  deleteCol: { label: 'Delete Col', k: 'BACKSPACE', ctrl: true, shift: true, run: () => getSheet()?.deleteCols(), description: 'Delete Col' },
  delete: { label: 'Delete Selection', k: 'BACKSPACE', run: () => getSheet()?.deleteSelection(), description: 'Delete Selection' },
  settings: { label: 'Settings', k: 'G', ctrl: true, run: () => SettingDialog.show(), description: 'Display Settings' },
  shortcuts: { label: 'Command Palette', k: 'P', ctrl: true, run: () => CommandPalette.toggle(cmd), description: 'Command Palette' },
  slctAll: { label: 'Select All', k: 'A', ctrl: true, run: () => getSheet()?.slctAll(), description: 'Select All' },
  transpose: { label: 'Transpose', k: 'T', ctrl: true, shift: true, run: () => getSheet()?.rangeTranspose(), description: 'Transpose rows and columns (selection or whole sheet)' },
  trim: { label: 'Trim Empty Rows/Cols', k: 'T', ctrl: true, alt: true, run: () => getSheet()?.trim(), description: 'Trim : remove all empty rows/cols' },
  integer: { label: 'Round to Integer', k: 'I', ctrl: true, run: () => getSheet()?.round(true), description: 'Round selection to integer' },
  decimal: { label: 'Round to Decimal', k: '$', ctrl: true, run: () => getSheet()?.round(false), description: 'Round selection to decimal' },
  fixTop: { label: 'Freeze Header Row', k: 'B', ctrl: true, run: () => getSheet()?.toggleFixTop(), description: 'Freeze Header Row' },
  undo: { label: 'Undo', k: 'Z', ctrl: true, run: () => getSheet()?.undo(), description: 'Undo' },
  redo: { label: 'Redo', k: 'Z', ctrl: true, shift: true, run: () => getSheet()?.redo(), description: 'Redo' },
  date: { label: "Insert Today's Date", k: ';', ctrl: true, run: () => getSheet()?.insertDate(), description: "Insert today's date" },
  validate_dates: { label: 'Validate: Date Formats (YYYY-MM-DD)', run: () => ValidationPane.run('dates'), description: 'Standardize date formats across columns to YYYY-mm-dd' },
  validate_whitespace: { label: 'Validate: Trim Whitespace', run: () => ValidationPane.run('trim_whitespace'), description: 'Remove leading and trailing whitespace from cell text' },
  validate_comma_num: { label: 'Validate: Decimal Comma -> Dot', run: () => ValidationPane.run('comma_decimals'), description: 'Convert comma decimals (3,14) to dot notation in numeric fields' },
  validate_line_returns: { label: 'Validate: Line Returns -> Pipe', run: () => ValidationPane.run('line_returns'), description: 'Replace embedded newline line breaks with pipe character (|)' },
  validate_quotes: { label: 'Validate: Double Quotes -> Single', run: () => ValidationPane.run('double_quotes'), description: 'Replace double quotation marks (") with single quotes (\')' },
  validate_comma_text: { label: 'Validate: Text Commas -> Dash', run: () => ValidationPane.run('text_commas'), description: 'Replace commas inside text cells with hyphens (-)' },
  validate_lower: { label: 'Validate: Force Lowercase', run: () => ValidationPane.run('lowercase'), description: 'Convert all text cells to lowercase' },
  filter: { label: 'Filter Column', k: 'Q', ctrl: true, run: (col) => getSheet()?.openFilter(col), description: 'Filter sheet rows by column value' },
  find: { label: 'Find & Match', k: 'F', ctrl: true, run: () => getSheet()?.find(false), description: 'Quick find / match' },
  findAdvanced: { label: 'Advanced Find / Replace', k: 'F', ctrl: true, shift: true, run: () => getSheet()?.find(true), description: 'Advanced find / replace (work in progress)' },
  menubar: { label: 'Toggle Menu Bar', k: 'M', ctrl: true, run: () => Setting.toggleActionBar(), description: 'Toggle action bar display' },
  open: { label: 'Open File', k: 'O', ctrl: true, run: () => getCsvHandle()?.open(), description: 'Open a CSV file from the file finder' },
  save: { label: 'Save', k: 'S', ctrl: true, run: () => getCsvHandle()?.save(), description: 'Save' },
  saveAs: { label: 'Save As', k: 'S', ctrl: true, shift: true, run: () => getCsvHandle()?.saveAs(), description: 'Save As' },
  reloadFile: { label: 'Reload File', k: 'R', ctrl: true, run: () => getCsvHandle()?.reloadFile(), description: 'Reload file from last save' },
  expand: { label: 'Expand Row', k: 'E', ctrl: true, run: () => getSheet()?.expand(), description: 'Expand first row to selection' },
  validate_data: { label: 'Validate Data: Open Pane', k: 'P', ctrl: true, shift: true, run: () => ValidationPane.toggle(), description: 'Open data validation pane with all validation rules' },
  validate_headers: { label: 'Validate: Headers & SQL Compliance', k: 'H', ctrl: true, shift: true, run: () => ValidationPane.run('headers'), description: 'Validate and sanitize column headers for SQL identifier standards and duplicates' },
  next_occurance: { label: 'Next Occurrence', k: 'D', ctrl: true, run: () => getSheet()?.go_to_occurrence(true), description: 'Go to next occurence of cell value' },
  prev_occurance: { label: 'Previous Occurrence', k: 'D', ctrl: true, shift: true, run: () => getSheet()?.go_to_occurrence(false), description: 'Go to previous occurence of cell value' },
  goToCoordinate: { label: 'Go to Coordinate', run: () => startCoordEdit(), description: 'Go to coordinate' },
  sort: { label: 'Sort Ascending', k: 'L', ctrl: true, run: () => { const s = getSheet(); s?.sort(s.x, true); }, description: 'Sort rows based on active column (ascending order)' },
  sort_reverse: { label: 'Sort Descending', k: 'L', ctrl: true, shift: true, run: () => { const s = getSheet(); s?.sort(s.x, false); }, description: 'Sort rows based on active column (descending order)' },
  shiftUp: { label: 'Shift Row Up', k: 'ARROWUP', alt: true, run: () => getSheet()?.shift(0), description: 'Shift row up' },
  shiftDown: { label: 'Shift Row Down', k: 'ARROWDOWN', alt: true, run: () => getSheet()?.shift(2), description: 'Shift row down' },
  shiftRight: { label: 'Shift Col Right', k: 'ARROWRIGHT', alt: true, run: () => getSheet()?.shift(1), description: 'Shift col right' },
  shiftLeft: { label: 'Shift Col Left', k: 'ARROWLEFT', alt: true, run: () => getSheet()?.shift(3), description: 'Shift col left' },
  insertUp: { label: 'Insert Row Above', k: 'ARROWUP', shift: true, alt: true, run: () => getSheet()?.insert(0), description: 'Insert row above' },
  insertDown: { label: 'Insert Row Below', k: 'ARROWDOWN', shift: true, alt: true, run: () => getSheet()?.insert(2), description: 'Insert row below' },
  insertRight: { label: 'Insert Col Right', k: 'ARROWRIGHT', shift: true, alt: true, run: () => getSheet()?.insert(1), description: 'Insert col right' },
  insertLeft: { label: 'Insert Col Left', k: 'ARROWLEFT', shift: true, alt: true, run: () => getSheet()?.insert(3), description: 'Insert col left' },
  exportJson: { label: 'Export as JSON', run: () => getCsvHandle()?.exportJson(), description: 'Export current sheet as JSON file' },
  exportTsv: { label: 'Export as TSV', run: () => getCsvHandle()?.exportTsv(), description: 'Export current sheet as Tab-Separated Values (TSV) file' },
  exportMarkdown: { label: 'Export as Markdown', run: () => getCsvHandle()?.exportMarkdown(), description: 'Export current sheet as GitHub Flavored Markdown table' },
  copyMarkdown: { label: 'Copy as Markdown', run: () => getCsvHandle()?.copyMarkdown(), description: 'Copy active selection as Markdown table to clipboard' },
  copyJson: { label: 'Copy as JSON', run: () => getCsvHandle()?.copyJson(), description: 'Copy active selection as JSON to clipboard' },
};

CommandPalette.setDefaultCommands(cmd);

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
    for (const c of Object.values(cmd)) {
      if (!c.k || typeof c.run !== 'function') continue;
      const keyUpper = String(c.k).toUpperCase();
      const ctrl = Boolean(c.ctrl), shift = Boolean(c.shift), alt = Boolean(c.alt);
      shortcutMap.set(getShortcutKey(keyUpper, ctrl, shift, alt), c);
      if (c.k !== keyUpper) shortcutMap.set(getShortcutKey(c.k, ctrl, shift, alt), c);
    }
    if (cmd.delete) shortcutMap.set(getShortcutKey('DELETE', false, false, false), cmd.delete);
    if (cmd.redo) shortcutMap.set(getShortcutKey('Y', true, false, false), cmd.redo);
    if (cmd.shortcuts) shortcutMap.set(getShortcutKey('K', true, false, false), cmd.shortcuts);
  }
  return shortcutMap;
}

const PREVENT_DFLT_KEYS = new Set([
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

  activeKeyDownHandler = (e) => {
    let k = e.key.toUpperCase();
    const ctrlDown = e.metaKey || e.ctrlKey;
    const alt = e.altKey;
    const shift = e.shiftKey;
    const activeSheet = getSheet();

    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    const isCellInput = Boolean(activeSheet?.inputing && activeEl === activeSheet.inputField);
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

    if (ctrlDown && (PREVENT_DFLT_KEYS.has(k) || PREVENT_DFLT_KEYS.has(e.key))) {
      if (!(isOtherInput || isCellInput) || (k !== 'C' && k !== 'V' && k !== 'X' && k !== 'A' && k !== 'Z')) {
        e.preventDefault();
      }
    }

    if (inCommandPalette) {
      if (k === 'ESCAPE') {
        (document.getElementById('palette') || document.querySelector('ui-command-palette'))?.close?.();
      }
      return;
    }

    if (ctrlDown && (k === 'P' || k === 'K') && !shift && !alt) {
      e.preventDefault();
      if (cmd.shortcuts?.run) cmd.shortcuts.run();
      else (document.getElementById('palette') || document.querySelector('ui-command-palette'))?.toggle?.();
      return;
    }

    if (inDialog) {
      if (k === 'ESCAPE') { e.preventDefault(); DialogManager.close(); }
      return;
    }

    if (inFinder) {
      if (k === 'ESCAPE') { e.preventDefault(); activeEl.closest('ui-finder')?.close?.(); }
      else if (ctrlDown && k === 'F') { e.preventDefault(); activeSheet?.find(shift); }
      return;
    }

    if (inFilter) {
      if (k === 'ESCAPE' || (ctrlDown && k === 'Q')) { e.preventDefault(); activeEl.closest('ui-filter')?.close?.(); }
      return;
    }

    if (inValidationPane && k === 'ESCAPE' && !isCellInput) {
      e.preventDefault();
      validationPane.handleBack?.();
      return;
    }

    if (isOtherInput) return;

    if (isCellInput) {
      if (ctrlDown && (k === 'S' || k === 'O' || k === 'Q')) {
        e.preventDefault();
        if (k === 'S') (shift ? cmd.saveAs : cmd.save).run();
        else if (k === 'O') cmd.open.run();
        else if (k === 'Q') cmd.filter.run();
      }
      return;
    }

    const isBoundaryKey = k === 'ARROWUP' || k === 'ARROWDOWN' || k === 'ARROWLEFT' || k === 'ARROWRIGHT' ||
                          k === 'HOME' || k === 'END' || k === 'PAGEUP' || k === 'PAGEDOWN';
    if (activeSheet) {
      activeSheet.slctRange = shift && !alt && !e.metaKey && isBoundaryKey;
    }

    if ((alt && k === 'TAB') || (ctrlDown && (k === 'C' || k === 'V'))) return;
    if (k === 'TAB') e.preventDefault();
    if (e.code === 'Space') k = 'SPACE';

    if (activeSheet) {
      const pageSize = stg?.rows || 10;
      const maxX = Math.max(0, activeSheet.df.width - 1);
      const maxY = Math.max(0, activeSheet.rowCount - 1);

      if (k === 'PAGEUP') {
        e.preventDefault();
        activeSheet.y = Math.max(0, activeSheet.y - pageSize);
        return activeSheet.slctRefresh();
      }
      if (k === 'PAGEDOWN') {
        e.preventDefault();
        activeSheet.y = Math.min(maxY, activeSheet.y + pageSize);
        return activeSheet.slctRefresh();
      }
      if (k === 'HOME') {
        e.preventDefault();
        activeSheet.x = 0;
        if (ctrlDown) activeSheet.y = 0;
        return activeSheet.slctRefresh();
      }
      if (k === 'END' && ctrlDown) {
        e.preventDefault();
        activeSheet.x = maxX;
        activeSheet.y = maxY;
        return activeSheet.slctRefresh();
      }
      if (k === 'F2') {
        e.preventDefault();
        if (!activeSheet.df?.lock) activeSheet.input();
        return;
      }
      if (ctrlDown) {
        if (k === 'ARROWUP') { e.preventDefault(); activeSheet.y = 0; return activeSheet.slctRefresh(); }
        if (k === 'ARROWRIGHT') { e.preventDefault(); activeSheet.x = maxX; return activeSheet.slctRefresh(); }
        if (k === 'ARROWDOWN') { e.preventDefault(); activeSheet.y = maxY; return activeSheet.slctRefresh(); }
        if (k === 'ARROWLEFT') { e.preventDefault(); activeSheet.x = 0; return activeSheet.slctRefresh(); }
      }
    }

    const map = getShortcutMap();
    const matchedCmd = map.get(getShortcutKey(k, ctrlDown, shift, alt)) ||
                       map.get(getShortcutKey(e.key, ctrlDown, shift, alt));
    if (matchedCmd) {
      matchedCmd.run();
      return e.preventDefault();
    }

    if (e.key.length === 1 && !ctrlDown && !e.metaKey && !alt && activeSheet) {
      if (activeSheet.df?.lock) return;
      e.preventDefault();
      return activeSheet.input(e.key);
    }

    if (activeSheet) {
      switch (k) {
        case 'ARROWUP': e.preventDefault(); activeSheet.y--; activeSheet.slctRefresh(); return;
        case 'ARROWDOWN': e.preventDefault(); activeSheet.y++; activeSheet.slctRefresh(); return;
        case 'ARROWLEFT': e.preventDefault(); activeSheet.x--; activeSheet.slctRefresh(); return;
        case 'ARROWRIGHT': e.preventDefault(); activeSheet.x++; activeSheet.slctRefresh(); return;
        case 'TAB':
          e.preventDefault();
          activeSheet.slctRange = false;
          activeSheet.rangeEnd = undefined;
          activeSheet.x += shift ? -1 : 1;
          activeSheet.slctRefresh();
          return;
        case 'ENTER':
          e.preventDefault();
          if (!activeSheet.df?.lock) activeSheet.input();
          return;
        case 'BACKSPACE':
        case 'DELETE':
          e.preventDefault();
          if (!activeSheet.df?.lock) {
            activeSheet.rangeEdit('');
            activeSheet.refresh();
          }
          return;
      }
    }
  };

  activeKeyUpHandler = (e) => {
    const k = e.key.toUpperCase();
    const activeSheet = getSheet();
    if (activeSheet && (k === 'CONTROL' || k === 'SHIFT') && !e.shiftKey) {
      activeSheet.slctRange = false;
    }
  };

  const getClipboardSheet = (requireUnlocked = false) => {
    if (isInputElement(document.activeElement)) return null;
    const s = getSheet();
    return (!s || (requireUnlocked && s.df?.lock)) ? null : s;
  };

  activeCopyHandler = (e) => {
    const s = getClipboardSheet(false);
    if (!s) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', s.copySelection());
  };

  activeCutHandler = (e) => {
    const s = getClipboardSheet(true);
    if (!s) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', s.cutSelection());
  };

  activePasteHandler = (e) => {
    const s = getClipboardSheet(true);
    if (!s) return;
    e.preventDefault();
    const rawText = e.clipboardData?.getData('text');
    if (rawText) s.pasteText(rawText);
  };

  document.addEventListener('keydown', activeKeyDownHandler);
  document.addEventListener('keyup', activeKeyUpHandler);
  document.addEventListener('copy', activeCopyHandler);
  document.addEventListener('cut', activeCutHandler);
  document.addEventListener('paste', activePasteHandler);
}

export { cmd, formatShortcut, CommandPalette, ContextMenu };
