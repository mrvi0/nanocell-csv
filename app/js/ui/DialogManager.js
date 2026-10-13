import { setIcon } from '../utils/icons.js';
import { getSheet } from '../appContext.js';

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
