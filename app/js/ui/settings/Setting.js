import { getSheet } from '../../appContext.js';
import { setIcon } from '../../utils/icons.js';
import { DialogManager } from '../DialogManager.js';

const stg = {};
if (typeof globalThis !== 'undefined') {
  globalThis.stg = stg;
}

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export function getNextPow2(v) {
  if (v < 1) return 1;
  const p = Math.floor(Math.log2(v));
  const candidate = Math.pow(2, p);
  return candidate > v ? candidate : Math.pow(2, p + 1);
}

export function getPrevPow2(v) {
  if (v <= 1) return 1;
  const p = Math.ceil(Math.log2(v));
  const candidate = Math.pow(2, p);
  return candidate < v ? candidate : Math.pow(2, p - 1);
}

export function formatThousands(v) {
  if (v === null || v === undefined || v === '') return '';
  const str = typeof v === 'string' ? v.replace(/\s+/g, '') : String(v);
  if (!Number.isFinite(Number(str))) return String(v);
  const parts = str.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return parts.join('.');
}

class BoolInput extends BaseElement {
  constructor(start = false) {
    super();
    this.b = Boolean(start);
  }

  connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;
    this.setAttribute('tabindex', '0');
    this.setAttribute('role', 'switch');
    this.classList.add('ui-bool-toggle');
    this.render();

    this.addEventListener('click', () => {
      this.focus();
      this.setValueInternal(!this.b, true);
    });
    this.addEventListener('keydown', (e) => {
      const k = e.key.toUpperCase();
      if (k === ' ' || k === 'ENTER' || k === 'ARROWLEFT' || k === 'ARROWRIGHT') {
        e.preventDefault();
        this.setValueInternal(!this.b, true);
      }
    });
  }

  render() {
    this.setAttribute('aria-checked', this.b ? 'true' : 'false');
    this.classList.toggle('checked', this.b);
    this.innerHTML = '<div class="toggle-track"><div class="toggle-thumb"></div></div>';
  }

  get value() { return this.b; }
  set value(b) { this.setValueInternal(b, false); }

  setValueInternal(b, isUserAction = false) {
    this.b = Boolean(b);
    this.render();
    if (isUserAction) this.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

class StepperInput extends BaseElement {
  initStepper(cls, leftIcon, leftLabel, rightIcon, rightLabel) {
    if (typeof document === 'undefined') return;
    this.classList?.add(cls);
    const makeBtn = (icon, label) => {
      const btn = document.createElement('button');
      btn.className = 'icon';
      btn.type = 'button';
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
      btn.setAttribute('tabindex', '-1');
      setIcon(btn, icon);
      return btn;
    };
    this.left = makeBtn(leftIcon, leftLabel);
    this.center = document.createElement('section');
    this.right = makeBtn(rightIcon, rightLabel);
  }

  mountStepper(onLeft, onRight) {
    this.setAttribute('tabindex', '0');
    this.append(this.left, this.center, this.right);
    this.left.addEventListener('click', onLeft);
    this.right.addEventListener('click', onRight);
    this.addEventListener('click', () => this.focus());
    this.addEventListener('keydown', (e) => {
      const k = e.key.toUpperCase();
      if (k === 'ARROWRIGHT') { e.preventDefault(); onRight(); }
      else if (k === 'ARROWLEFT') { e.preventDefault(); onLeft(); }
    });
  }
}

class ListInput extends StepperInput {
  constructor(list = [], hide = false) {
    super();
    this.list = list;
    this.hideValue = hide;
    this.idx = 0;
    this.initStepper('ui-list', 'arrow_left', 'Previous', 'arrow_right', 'Next');
  }

  connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;
    this.setAttribute('hide', this.hideValue);
    this.mountStepper(
      () => this.setValueInternal(this.list[(this.idx + this.list.length - 1) % this.list.length], true),
      () => this.setValueInternal(this.list[(this.idx + 1) % this.list.length], true)
    );
    this.center.innerHTML = '';
    this.list.forEach((item, i) => {
      const span = document.createElement('span');
      span.innerHTML = item;
      span.setAttribute('selected', i === this.idx ? 'true' : 'false');
      span.addEventListener('click', () => this.setValueInternal(item, true));
      this.center.appendChild(span);
    });
  }

  get value() { return this.list[this.idx] ?? ''; }
  set value(txt) { this.setValueInternal(txt, false); }

  setValueInternal(txt, isUserAction = false) {
    const i = this.list.indexOf(txt);
    if (i === -1) return;
    this.idx = i;
    if (this._initialized) {
      for (let j = 0; j < this.center.children.length; j++) {
        this.center.children[j].setAttribute('selected', j === i ? 'true' : 'false');
      }
    }
    if (isUserAction) this.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

class NumInput extends StepperInput {
  constructor(start = 0, min = 0, max = 999, stepMode = 'linear') {
    super();
    const initial = typeof start === 'string' ? start.replace(/\s+/g, '') : start;
    this.n = Number.isNaN(Number(initial)) ? 0 : Number(initial);
    this._min = Number(min);
    this._max = Number(max);
    this.stepMode = stepMode;
    this.initStepper('ui-num', 'remove', 'Decrease', 'add', 'Increase');
    if (this.center) this.center.innerHTML = formatThousands(this.n);
    this.updateButtonStates();
  }

  updateButtonStates() {
    if (this.left) this.left.disabled = this.n <= this.min;
    if (this.right) this.right.disabled = this.n >= this.max;
  }

  stepValue(dir = 1) {
    const next = this.stepMode === 'pow2'
      ? (dir > 0 ? getNextPow2(this.n) : getPrevPow2(this.n))
      : this.n + dir;
    this.setValueInternal(next, true);
  }

  connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;
    this.mountStepper(() => this.stepValue(-1), () => this.stepValue(1));
    this.updateButtonStates();
  }

  get min() { return this._min ?? 0; }
  set min(v) { this._min = Number(v); this.updateButtonStates(); }

  get max() { return this._max ?? 999; }
  set max(v) { this._max = Number(v); this.updateButtonStates(); }

  get value() { return this.n; }
  set value(n) { this.setValueInternal(n, false); }

  setValueInternal(n, isUserAction = false) {
    if (typeof n === 'string') n = n.replace(/\s+/g, '');
    this.n = Math.max(this.min, Math.min(this.max, Number(n)));
    if (this.center) this.center.innerHTML = formatThousands(this.n);
    this.updateButtonStates();
    if (isUserAction && typeof Event !== 'undefined') {
      this.dispatchEvent?.(new Event('change', { bubbles: true }));
    }
  }
}

if (typeof customElements !== 'undefined') {
  if (!customElements.get('ui-bool')) customElements.define('ui-bool', BoolInput);
  if (!customElements.get('ui-list')) customElements.define('ui-list', ListInput);
  if (!customElements.get('ui-num')) customElements.define('ui-num', NumInput);
}

class Setting {
  constructor(s) {
    let stored = null;
    try {
      stored = (typeof window !== 'undefined' && typeof localStorage !== 'undefined') ? localStorage.getItem(s.key) : null;
    } catch {}

    if (stored !== null && stored !== '' && !isNaN(stored)) stored = Number(stored);
    if (stored === 'true') stored = true;
    if (stored === 'false') stored = false;
    if (s.key === 'editMaxFileSize' && (stored === 100 || stored === '100')) {
      stored = s.dflt;
      try { localStorage?.setItem('editMaxFileSize', String(s.dflt)); } catch {}
    }

    this.key = s.key;
    if (stored !== null) {
      this.value = stored;
    } else if (s.key === 'theme') {
      const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      this.value = prefersDark ? 'nord' : 'light';
    } else {
      this.value = s.dflt;
    }
    this.cb = s.cb;

    Object.defineProperty(stg, this.key, {
      get: () => this.value,
      set: (val) => {
        this.value = val;
        try { localStorage?.setItem(this.key, val); } catch {}
        this.cb?.(this.value);
      },
      configurable: true
    });
  }

  static set(key, val) { stg[key] = val; }
  static toggleActionBar() { stg.actionBar = stg.actionBar === false; }

  static init() {
    for (const s of Setting.list) if (!s.title) new Setting(s);
    Setting.setTheme();
  }

  static setTheme(themeName) {
    const activeTheme = themeName || globalThis.stg?.theme || 'light';
    if (typeof document !== 'undefined') {
      document.documentElement?.setAttribute('data-theme', activeTheme);
      document.body?.setAttribute('data-theme', activeTheme);
    }
  }

  static runAll() {
    for (const s of Setting.list) if (s.key && typeof s.cb === 'function') s.cb(stg[s.key]);
  }

  static resetDefault() {
    for (const s of Setting.list) if (s.key) stg[s.key] = s.dflt;
  }
}

Setting.list = [
  { title: 'Appearance' },
  { key: 'theme', dflt: 'nord', name: 'Theme', list: ['light', 'slate', 'dark', 'solarized', 'night', 'nord', 'dracula'], hide: true, cb: Setting.setTheme },
  { key: 'font', dflt: 13, name: 'Font Size', min: 7, max: 24, cb: n => {
    const b = typeof document !== 'undefined' ? document.body : null;
    if (b) {
      b.style.setProperty('--app-font-size', `${n}px`);
      b.style.fontSize = `${n}px`;
    }
  } },
  { key: 'rows', dflt: 25, name: 'Rows', min: 10, max: 60, cb: () => getSheet()?.reload?.() },
  { key: 'cols', dflt: 7, name: 'Cols', min: 3, max: 30, cb: () => getSheet()?.reload?.() },
  { key: 'actionBar', dflt: true, name: 'Action Bar', cb: b => {
    const header = typeof document !== 'undefined' && (document.getElementById('header') || document.querySelector('header'));
    if (header) {
      header.classList.toggle('hidden', !b);
      header.hidden = !b;
      header.style.display = b ? 'flex' : 'none';
    }
    getSheet()?.scrollbarRefresh?.();
  } },
  { key: 'purple', dflt: true, name: 'Warning color on line return, comma and double quote values', cb: () => getSheet()?.reload?.() },

  { title: 'Csv Save' },
  { key: 'encoding', dflt: 'utf-8', name: 'Encoding' },
  { key: 'delimiter', dflt: ',', name: 'Delimiter', list: [',', ';', 'TAB', '|'], hide: true },
  { key: 'save_fixed_width_size', dflt: 0, name: 'Minimum column size', min: 0, max: 100 },
  { key: 'save_strict', dflt: false, name: 'Save-Strict (error on comma  or double quotes)' },

  { title: 'Csv Open' },
  { key: 'set_headers', dflt: true, name: 'Set headers' },
  { key: 'trim', dflt: false, name: 'Remove empty rows and columns' },
  { key: 'trim_unquoted', dflt: true, name: 'Trim unquoted whitespace' },

  { title: 'Csv View Only' },
  { key: 'editMaxFileSize', dflt: 10, name: 'Max editable file size (Mo)', min: 1, max: Infinity, stepMode: 'pow2' },
  { key: 'vo_n_chunks', dflt: 8, name: 'Number of chunks loaded', min: 8, stepMode: 'pow2' },
  { key: 'vo_n_rows', dflt: 8, name: 'Number of rows per chunk loaded', min: 8, stepMode: 'pow2' },

  { title: 'Sort' },
  { key: 'sort_header', dflt: true, name: 'Ignore 1st row (header row)' },
  { key: 'sort_num_first', dflt: false, name: 'Numbers are sorted before text' },
];

Setting.map = new Map(Setting.list.filter(s => s.key).map(s => [s.key, s]));
Setting.getDef = (key) => Setting.map.get(key);

export class SettingDialog {
  static buildRow(setting) {
    const row = document.createElement('div');
    row.className = 'setting-row';
    row.innerHTML = `<div class="setting-label-container"><span class="setting-name">${setting.name}</span></div><div class="setting-control"></div>`;
    const inputCell = row.lastElementChild;

    let input;
    if (setting.list) input = new ListInput(setting.list, setting.hide);
    else if (setting.stepMode) input = new NumInput(stg[setting.key] ?? setting.dflt, setting.min ?? 1, setting.max ?? Infinity, setting.stepMode);
    else if (setting.max) input = new NumInput(setting.dflt, setting.min, setting.max);
    else if (typeof setting.dflt === 'boolean') input = new BoolInput();

    if (input) {
      if (!input._initialized) input.connectedCallback?.();
      input.value = stg[setting.key];
      input.onchange = (e) => {
        const c = e.target.value;
        stg[setting.key] = (c !== '' && !isNaN(c)) ? Number(c) : c;
      };
    } else {
      input = document.createElement('span');
      input.innerText = stg[setting.key];
    }

    inputCell.appendChild(input);
    row.addEventListener('focusin', () => row.classList.add('active'));
    row.addEventListener('focusout', (e) => {
      if (!row.contains(e.relatedTarget)) row.classList.remove('active');
    });
    row.addEventListener('click', (e) => {
      if (input.focus && !input.contains(e.target)) input.focus();
    });
    return row;
  }

  static show() {
    const content = document.createElement('div');
    content.className = 'stg-container stg';
    content.innerHTML = `
      <div class="stg-header"><h1>Settings</h1></div>
      <div class="stg-body"></div>
      <div class="stg-footer">
        <button class="icon btn-reset-settings" type="button" title="Reset to default settings" aria-label="Reset to default settings"></button>
      </div>
    `;

    const body = content.querySelector('.stg-body');
    const resetBtn = content.querySelector('.btn-reset-settings');
    setIcon(resetBtn, 'reset_settings');
    resetBtn.onclick = () => {
      Setting.resetDefault();
      SettingDialog.show();
    };

    let sectionBody = null;
    for (const s of Setting.list) {
      if (s.title) {
        const section = document.createElement('div');
        section.className = 'settings-section';
        section.innerHTML = `<div class="settings-section-header"><h3>${s.title}</h3></div><div class="settings-section-body"></div>`;
        sectionBody = section.lastElementChild;
        body.appendChild(section);
      } else if (sectionBody) {
        sectionBody.appendChild(SettingDialog.buildRow(s));
      }
    }

    DialogManager.open(content, { fullscreen: true });
    const firstInput = content.querySelector('.ui-list, .ui-num, .ui-bool-toggle');
    if (firstInput?.focus) {
      setTimeout(() => { try { firstInput.focus(); } catch {} }, 0);
    }
  }
}

export { Setting, stg, BoolInput, ListInput, NumInput };
