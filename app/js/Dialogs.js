/**
 * @file app/js/Dialogs.js
 * Modal dialog manager (#dialog), About dialog (<ui-about>), Settings dialog,
 * and custom setting form controls (<ui-bool>, <ui-list>, <ui-num>).
 */

import { getSheet, Setting, stg, pwa, getNewIssueUrl } from './state.js';
import { setIcon } from './icons.js';
import { Notification } from './Notification.js';

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class DialogManager {
  static container = null;

  static init(container) {
    this.container = container || (typeof document !== 'undefined' ? document.getElementById('dialog') : null);
    if (!this.container || this.container._dialogManagerBound) return;
    this.container._dialogManagerBound = true;
    this.container.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  static open(element, { fullscreen = false, closeButton = true } = {}) {
    if (!this.container && typeof document !== 'undefined') this.init();
    if (!this.container) return;

    this.close();
    document.activeElement?.blur?.();

    const s = getSheet();
    s?.finder?.close?.();
    if (typeof document !== 'undefined') {
      for (const f of document.querySelectorAll('ui-finder, .finder-widget')) {
        (typeof f.close === 'function' ? f : f.parentElement)?.close?.();
      }
    }

    this.container.classList.add(fullscreen ? 'dialog_large' : 'dialog_small', 'scroll');
    this.container.appendChild(element);

    if (closeButton) {
      const btn = document.createElement('span');
      btn.className = 'icon';
      btn.id = 'closeDialog';
      btn.title = 'Close (Esc)';
      btn.setAttribute('aria-label', 'Close');
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      setIcon(btn, 'off');
      btn.addEventListener('click', () => this.close());
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.close();
        }
      });
      this.container.appendChild(btn);
    }
  }

  static close() {
    if (!this.container) return;
    this.container.innerHTML = '';
    this.container.className = '';
    getSheet()?.scrollbarRefresh?.();
  }

  static get isBusy() {
    return Boolean(this.container && this.container.children.length > 0);
  }

  static get isLarge() {
    return Boolean(this.container?.classList.contains('dialog_large'));
  }

  static cycleFocus(e, focusable) {
    if (!focusable || focusable.length === 0) return;
    e.preventDefault();
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const idx = focusable.indexOf(active);
    const next = e.shiftKey
      ? (idx <= 0 ? focusable.length - 1 : idx - 1)
      : (idx === -1 || idx >= focusable.length - 1 ? 0 : idx + 1);
    focusable[next].focus();
  }

  static handleKeyDown(e) {
    if (e.defaultPrevented || e.key !== 'Tab' || !this.container) return;
    const selector = '.ui-list, .ui-num, .ui-bool-toggle, ui-bool, button:not([tabindex="-1"]), input:not([tabindex="-1"]), select:not([tabindex="-1"]), textarea:not([tabindex="-1"]), #closeDialog, [tabindex="0"]';
    const focusable = Array.from(this.container.querySelectorAll(selector))
      .filter(el => !el.disabled && el.style.display !== 'none' && !el.closest?.('.hidden'))
      .filter((el, _, arr) => !arr.some(p => p !== el && p.contains(el)));
    this.cycleFocus(e, focusable);
  }
}

// --- Custom Setting Controls (<ui-bool>, <ui-list>, <ui-num>) ---

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
    if (!this._initialized) return;
    if (!this.track) {
      this.track = document.createElement('div');
      this.track.className = 'toggle-track';
      this.thumb = document.createElement('div');
      this.thumb.className = 'toggle-thumb';
      this.track.appendChild(this.thumb);
      this.appendChild(this.track);
    }
    this.setAttribute('aria-checked', String(this.b));
    this.classList.toggle('checked', this.b);
  }

  get value() { return this.b; }
  set value(val) { this.setValueInternal(val, false); }

  setValueInternal(val, isUserAction = false) {
    this.b = Boolean(val);
    this.render();
    if (isUserAction && typeof Event !== 'undefined') {
      this.dispatchEvent?.(new Event('change', { bubbles: true }));
    }
  }
}

class StepperInput extends BaseElement {
  initStepper(cls, leftIcon, leftLabel, rightIcon, rightLabel) {
    this.classList.add(cls);
    const mkBtn = (icon, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon';
      b.tabIndex = -1;
      b.setAttribute('aria-label', label);
      b.title = label;
      setIcon(b, icon);
      return b;
    };
    this.left = mkBtn(leftIcon, leftLabel);
    this.center = document.createElement('section');
    this.right = mkBtn(rightIcon, rightLabel);
  }

  mountStepper(onPrev, onNext) {
    this.setAttribute('tabindex', '0');
    this.appendChild(this.left);
    this.appendChild(this.center);
    this.appendChild(this.right);
    this.left.addEventListener('click', (e) => { e.stopPropagation(); this.focus(); onPrev(); });
    this.right.addEventListener('click', (e) => { e.stopPropagation(); this.focus(); onNext(); });
    this.addEventListener('keydown', (e) => {
      const k = e.key.toUpperCase();
      if (k === 'ARROWLEFT' || k === 'ARROWDOWN') { e.preventDefault(); onPrev(); }
      else if (k === 'ARROWRIGHT' || k === 'ARROWUP') { e.preventDefault(); onNext(); }
    });
  }
}

class ListInput extends StepperInput {
  constructor(list = [], hide = true) {
    super();
    this.idx = 0;
    this.initStepper('ui-list', 'arrow_left', 'Previous option', 'arrow_right', 'Next option');
    for (const item of list) {
      const s = document.createElement('span');
      s.innerHTML = item;
      this.center.appendChild(s);
    }
    this.setAttribute('hide', hide);
  }

  connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;
    this.setAttribute('role', 'listbox');
    this.mountStepper(() => this.setIdx(this.idx - 1, true), () => this.setIdx(this.idx + 1, true));
    this.setIdx(this.idx, false);
  }

  get value() { return this.center.children[this.idx]?.innerText; }
  set value(val) {
    for (let i = 0; i < this.center.children.length; i++) {
      if (this.center.children[i].innerText == val) {
        this.setIdx(i, false);
        break;
      }
    }
  }

  setIdx(idx, isUserAction = false) {
    const len = this.center.children.length;
    if (len === 0) return;
    this.idx = ((idx % len) + len) % len;
    for (let i = 0; i < len; i++) {
      this.center.children[i].setAttribute('selected', i === this.idx ? 'true' : 'false');
    }
    if (isUserAction && typeof Event !== 'undefined') {
      this.dispatchEvent?.(new Event('change', { bubbles: true }));
    }
  }
}

class NumInput extends StepperInput {
  constructor(start = 0, min = 0, max = 999, stepMode = 'linear') {
    super();
    this.n = Number(start);
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

// --- Settings Dialog ---

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

// --- About Dialog (<ui-about>) ---

export class AboutDialog extends BaseElement {
  ensureRendered() {
    if (this._initialized) return;
    this._initialized = true;

    const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v1.0.1-dev';
    const isStandalone = pwa.getState().isStandalone;

    this.innerHTML = `
      <img src="/logo.svg" class="about-logo" alt="Logo" />
      <h1>Nanocell CSV Editor</h1>
      <div class="about-version-container">
        <h3>${version}</h3>
        <button class="icon about-copy-btn" type="button" title="Copy version" aria-label="Copy version"></button>
        ${isStandalone ? '<span class="about-mode-badge">(Desktop App)</span>' : ''}
      </div>
      <div class="about-footer">
        <a href="${getNewIssueUrl(version)}" target="_blank" class="about-bug-link">
          <button class="icon" type="button" title="Bug Report" aria-label="Bug Report"></button>
        </a>
        <a href="https://nanocell-csv.com/" target="_blank" class="about-home-link">https://nanocell-csv.com/</a>
      </div>
    `;

    const copyBtn = this.querySelector('.about-copy-btn');
    const bugBtn = this.querySelector('.about-bug-link button');
    setIcon(copyBtn, 'copy');
    setIcon(bugBtn, 'bug');

    copyBtn.onclick = async () => {
      const textToCopy = `Nanocell CSV Editor-${version}`;
      try { await navigator.clipboard.writeText(textToCopy); } catch {}
      setIcon(copyBtn, 'on');
      setTimeout(() => setIcon(copyBtn, 'copy'), 1500);
      Notification.quick(`Copied: ${textToCopy}`);
    };
  }

  connectedCallback() { this.ensureRendered(); }

  static show() {
    const el = document.createElement('ui-about');
    el.ensureRendered();
    DialogManager.open(el, { fullscreen: true });
    return el;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('ui-about')) {
  customElements.define('ui-about', AboutDialog);
}

export { BoolInput, ListInput, NumInput };
