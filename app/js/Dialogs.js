/**
 * @file app/js/Dialogs.js
 * Modal dialog manager (#dialog), About dialog (<ui-about>), Settings dialog,
 * and custom setting form controls (<ui-bool>, <ui-list>, <ui-num>).
 */

import { getSheet, Setting, settings, pwa, getNewIssueUrl } from './state.js';
import { setIcon } from './icons.js';
import { Notification } from './Notification.js';

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class DialogManager {
  static container = null;

  static init(container) {
    this.container = container || (typeof document !== 'undefined' ? document.getElementById('dialog') : null);
    if (!this.container || this.container._dialogManagerBound) return;
    this.container._dialogManagerBound = true;
    this.container.addEventListener('keydown', (event) => this.handleKeyDown(event));
  }

  static open(element, { fullscreen = false, closeButton = true } = {}) {
    if (!this.container && typeof document !== 'undefined') this.init();
    if (!this.container) return;

    this.close();
    document.activeElement?.blur?.();

    const sheet = getSheet();
    sheet?.finder?.close?.();
    if (typeof document !== 'undefined') {
      for (const finderEl of document.querySelectorAll('ui-finder, .finder-widget')) {
        (typeof finderEl.close === 'function' ? finderEl : finderEl.parentElement)?.close?.();
      }
    }

    this.container.classList.add(fullscreen ? 'dialog-large' : 'dialog-small', 'scroll');
    this.container.appendChild(element);

    if (closeButton) {
      const closeBtn = document.createElement('span');
      closeBtn.className = 'icon';
      closeBtn.id = 'close-dialog';
      closeBtn.title = 'Close (Esc)';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.setAttribute('role', 'button');
      closeBtn.setAttribute('tabindex', '0');
      setIcon(closeBtn, 'off');
      closeBtn.addEventListener('click', () => this.close());
      closeBtn.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.close();
        }
      });
      this.container.appendChild(closeBtn);
    }
  }

  static close() {
    if (!this.container) return;
    this.container.innerHTML = '';
    this.container.className = '';
    getSheet()?.refreshScrollbars?.();
  }

  static get isBusy() {
    return Boolean(this.container && this.container.children.length > 0);
  }

  static get isLarge() {
    return Boolean(this.container?.classList.contains('dialog-large'));
  }

  static cycleFocus(event, focusableElements) {
    if (!focusableElements || focusableElements.length === 0) return;
    event.preventDefault();
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const index = focusableElements.indexOf(active);
    const nextIndex = event.shiftKey
      ? (index <= 0 ? focusableElements.length - 1 : index - 1)
      : (index === -1 || index >= focusableElements.length - 1 ? 0 : index + 1);
    focusableElements[nextIndex].focus();
  }

  static handleKeyDown(event) {
    if (event.defaultPrevented || event.key !== 'Tab' || !this.container) return;
    const selector = '.ui-list, .ui-num, .ui-bool-toggle, ui-bool, button:not([tabindex="-1"]), input:not([tabindex="-1"]), select:not([tabindex="-1"]), textarea:not([tabindex="-1"]), #close-dialog, [tabindex="0"]';
    const focusableElements = Array.from(this.container.querySelectorAll(selector))
      .filter(el => !el.disabled && el.style.display !== 'none' && !el.closest?.('.hidden'))
      .filter((el, _, arr) => !arr.some(parent => parent !== el && parent.contains(el)));
    this.cycleFocus(event, focusableElements);
  }
}

// --- Custom Setting Controls (<ui-bool>, <ui-list>, <ui-num>) ---

export function getNextPow2(value) {
  if (value < 1) return 1;
  const power = Math.floor(Math.log2(value));
  const candidate = Math.pow(2, power);
  return candidate > value ? candidate : Math.pow(2, power + 1);
}

export function getPrevPow2(value) {
  if (value <= 1) return 1;
  const power = Math.ceil(Math.log2(value));
  const candidate = Math.pow(2, power);
  return candidate < value ? candidate : Math.pow(2, power - 1);
}

export function formatThousands(value) {
  if (value === null || value === undefined || value === '') return '';
  const str = typeof value === 'string' ? value.replace(/\s+/g, '') : String(value);
  if (!Number.isFinite(Number(str))) return String(value);
  const parts = str.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return parts.join('.');
}

class BoolInput extends BaseElement {
  constructor(initialValue = false) {
    super();
    this._value = Boolean(initialValue);
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
      this.setValueInternal(!this._value, true);
    });
    this.addEventListener('keydown', (event) => {
      const key = event.key.toUpperCase();
      if (key === ' ' || key === 'ENTER' || key === 'ARROWLEFT' || key === 'ARROWRIGHT') {
        event.preventDefault();
        this.setValueInternal(!this._value, true);
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
    this.setAttribute('aria-checked', String(this._value));
    this.classList.toggle('checked', this._value);
  }

  get value() { return this._value; }
  set value(val) { this.setValueInternal(val, false); }

  setValueInternal(val, isUserAction = false) {
    this._value = Boolean(val);
    this.render();
    if (isUserAction && typeof Event !== 'undefined') {
      this.dispatchEvent?.(new Event('change', { bubbles: true }));
    }
  }
}

class StepperInput extends BaseElement {
  initStepper(className, leftIcon, leftLabel, rightIcon, rightLabel) {
    this.classList.add(className);
    const createStepButton = (iconName, label) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'icon';
      button.tabIndex = -1;
      button.setAttribute('aria-label', label);
      button.title = label;
      setIcon(button, iconName);
      return button;
    };
    this.leftBtn = createStepButton(leftIcon, leftLabel);
    this.centerEl = document.createElement('section');
    this.rightBtn = createStepButton(rightIcon, rightLabel);
  }

  mountStepper(onPrev, onNext) {
    this.setAttribute('tabindex', '0');
    this.appendChild(this.leftBtn);
    this.appendChild(this.centerEl);
    this.appendChild(this.rightBtn);
    this.leftBtn.addEventListener('click', (event) => { event.stopPropagation(); this.focus(); onPrev(); });
    this.rightBtn.addEventListener('click', (event) => { event.stopPropagation(); this.focus(); onNext(); });
    this.addEventListener('keydown', (event) => {
      const key = event.key.toUpperCase();
      if (key === 'ARROWLEFT' || key === 'ARROWDOWN') { event.preventDefault(); onPrev(); }
      else if (key === 'ARROWRIGHT' || key === 'ARROWUP') { event.preventDefault(); onNext(); }
    });
  }
}

class ListInput extends StepperInput {
  constructor(optionsList = [], hideUnselected = true) {
    super();
    this.selectedIndex = 0;
    this.initStepper('ui-list', 'arrow_left', 'Previous option', 'arrow_right', 'Next option');
    for (const item of optionsList) {
      const span = document.createElement('span');
      span.innerHTML = item;
      this.centerEl.appendChild(span);
    }
    this.setAttribute('hide', hideUnselected);
  }

  connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;
    this.setAttribute('role', 'listbox');
    this.mountStepper(
      () => this.setSelectedIndex(this.selectedIndex - 1, true),
      () => this.setSelectedIndex(this.selectedIndex + 1, true)
    );
    this.setSelectedIndex(this.selectedIndex, false);
  }

  get value() { return this.centerEl.children[this.selectedIndex]?.innerText; }
  set value(val) {
    for (let i = 0; i < this.centerEl.children.length; i++) {
      if (this.centerEl.children[i].innerText == val) {
        this.setSelectedIndex(i, false);
        break;
      }
    }
  }

  setSelectedIndex(index, isUserAction = false) {
    const length = this.centerEl.children.length;
    if (length === 0) return;
    this.selectedIndex = ((index % length) + length) % length;
    for (let i = 0; i < length; i++) {
      this.centerEl.children[i].setAttribute('selected', i === this.selectedIndex ? 'true' : 'false');
    }
    if (isUserAction && typeof Event !== 'undefined') {
      this.dispatchEvent?.(new Event('change', { bubbles: true }));
    }
  }
}

class NumInput extends StepperInput {
  constructor(initialValue = 0, min = 0, max = 999, stepMode = 'linear') {
    super();
    this._value = Number(initialValue);
    this._min = Number(min);
    this._max = Number(max);
    this.stepMode = stepMode;
    this.initStepper('ui-num', 'remove', 'Decrease', 'add', 'Increase');
    if (this.centerEl) this.centerEl.innerHTML = formatThousands(this._value);
    this.updateButtonStates();
  }

  updateButtonStates() {
    if (this.leftBtn) this.leftBtn.disabled = this._value <= this.min;
    if (this.rightBtn) this.rightBtn.disabled = this._value >= this.max;
  }

  step(direction = 1) {
    const nextValue = this.stepMode === 'pow2'
      ? (direction > 0 ? getNextPow2(this._value) : getPrevPow2(this._value))
      : this._value + direction;
    this.setValueInternal(nextValue, true);
  }

  connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;
    this.mountStepper(() => this.step(-1), () => this.step(1));
    this.updateButtonStates();
  }

  get min() { return this._min ?? 0; }
  set min(val) { this._min = Number(val); this.updateButtonStates(); }
  get max() { return this._max ?? 999; }
  set max(val) { this._max = Number(val); this.updateButtonStates(); }
  get value() { return this._value; }
  set value(val) { this.setValueInternal(val, false); }

  setValueInternal(val, isUserAction = false) {
    if (typeof val === 'string') val = val.replace(/\s+/g, '');
    this._value = Math.max(this.min, Math.min(this.max, Number(val)));
    if (this.centerEl) this.centerEl.innerHTML = formatThousands(this._value);
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
    if (setting.list) {
      input = new ListInput(setting.list, setting.hide);
    } else if (setting.stepMode) {
      input = new NumInput(settings[setting.key] ?? setting.defaultValue, setting.min ?? 1, setting.max ?? Infinity, setting.stepMode);
    } else if (setting.max) {
      input = new NumInput(setting.defaultValue, setting.min, setting.max);
    } else if (typeof setting.defaultValue === 'boolean') {
      input = new BoolInput();
    }

    if (input) {
      if (!input._initialized) input.connectedCallback?.();
      input.value = settings[setting.key];
      input.onchange = (event) => {
        const nextVal = event.target.value;
        settings[setting.key] = (nextVal !== '' && !isNaN(nextVal)) ? Number(nextVal) : nextVal;
      };
    } else {
      input = document.createElement('span');
      input.innerText = settings[setting.key];
    }

    inputCell.appendChild(input);
    row.addEventListener('focusin', () => row.classList.add('active'));
    row.addEventListener('focusout', (event) => {
      if (!row.contains(event.relatedTarget)) row.classList.remove('active');
    });
    row.addEventListener('click', (event) => {
      if (input.focus && !input.contains(event.target)) input.focus();
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
    for (const def of Setting.list) {
      if (def.title) {
        const section = document.createElement('div');
        section.className = 'settings-section';
        section.innerHTML = `<div class="settings-section-header"><h3>${def.title}</h3></div><div class="settings-section-body"></div>`;
        sectionBody = section.lastElementChild;
        body.appendChild(section);
      } else if (sectionBody) {
        sectionBody.appendChild(SettingDialog.buildRow(def));
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
    const element = document.createElement('ui-about');
    element.ensureRendered();
    DialogManager.open(element, { fullscreen: true });
    return element;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('ui-about')) {
  customElements.define('ui-about', AboutDialog);
}

export { BoolInput, ListInput, NumInput };
