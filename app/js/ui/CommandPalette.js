import { setIcon } from '../utils/icons.js';
import { pwa, formatShortcut } from '../utils/misc.js';

function fuzzyScore(query, text) {
  if (!query) return 1;
  if (!text) return 0;
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
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

    if (!query) {
      this.filteredCommands = all;
    } else {
      this.filteredCommands = all
        .map(c => ({
          cmd: c,
          score: Math.max(fuzzyScore(query, c.description), fuzzyScore(query, c.label || '') * 0.95, fuzzyScore(query, c.id) * 0.9)
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.cmd);
    }
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
        <span class="cmd_palette_item_label">${this.escapeHtml(cmdItem.description)}</span>
        ${cmdItem.key ? `<span class="cmd_palette_item_shortcut command-key">${this.escapeHtml(cmdItem.key)}</span>` : ''}
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

  escapeHtml(str) {
    if (typeof str !== 'string') str = String(str ?? '');
    if (!/[&<>"']/.test(str)) return str;
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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

if (!customElements.get('ui-command-palette')) {
  customElements.define('ui-command-palette', CommandPalette);
}

export { CommandPalette };
