import { setIcon } from '../utils/icons.js';
import { pwa } from '../utils/misc.js';
import { DialogManager } from './DialogManager.js';

function sanitizeHtml(html) {
  if (typeof html !== 'string') return '';
  if (!html.includes('<')) return html;
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*(?:'javascript:[^']*'|"javascript:[^"]*"|javascript:[^\s>]+)/gi, '');
}

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

class Notification extends BaseElement {
  constructor(txt = 'Empty message', opt = {}) {
    super();
    this.txt = txt;
    this.opt = typeof opt === 'number' ? { t: opt } : (opt || {});
    if (typeof document === 'undefined') return;

    this.content = document.createElement('div');
    this.content.className = 'ui-msg-text';
    if (typeof txt === 'string' && !txt.includes('<') && !txt.includes('&')) {
      this.content.textContent = txt;
    } else {
      this.content.innerHTML = sanitizeHtml(txt);
    }

    const makeBtn = (cls, label, icon, onClick) => {
      const btn = document.createElement('button');
      btn.className = `icon ${cls}`;
      btn.type = 'button';
      btn.setAttribute('title', label);
      btn.setAttribute('aria-label', label);
      setIcon(btn, icon);
      btn.onclick = onClick;
      return btn;
    };

    this.ok = makeBtn('ui-msg-btn ui-msg-ok', this.opt.okText || 'OK', 'on', () => {
      this.opt.cbt?.();
      this.dismiss();
    });
    this.cancel = makeBtn('ui-msg-btn ui-msg-cancel', this.opt.cancelText || 'Cancel', 'off', () => {
      this.opt.cbf?.();
      this.dismiss();
    });
    this.closeBtn = makeBtn('ui-toast-close-btn', 'Close notification', 'off', () => {
      this.opt.cbf?.();
      this.dismiss();
    });

    this.addEventListener('keydown', (e) => {
      const k = e.key.toUpperCase();
      const focusable = [this.cancel, this.ok, this.closeBtn].filter(b => b?.parentNode);
      if (k === 'TAB') {
        if (focusable.length > 1) DialogManager.cycleFocus(e, focusable);
      } else if ((k === 'ARROWLEFT' || k === 'ARROWRIGHT') && this.cancel.parentNode && this.ok.parentNode) {
        e.preventDefault();
        (document.activeElement === this.ok ? this.cancel : this.ok).focus();
      } else if (k === 'ESCAPE') {
        e.preventDefault();
        if (this.cancel.parentNode) this.cancel.click();
        else if (this.closeBtn.parentNode) this.closeBtn.click();
        else this.dismiss();
      }
    });
  }

  connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;
    this.renderToast();
  }

  show() {
    if (typeof document === 'undefined') return this;
    let container = document.getElementById('ui-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'ui-toast-container';
      container.className = 'ui-toast-container';
      document.body.appendChild(container);
    }
    if (!container.contains(this)) container.appendChild(this);
    if (!this._initialized) this.connectedCallback();
    return this;
  }

  renderToast() {
    const type = this.opt.type || (this.opt.id === 3 ? 'warning' : 'info');
    this.className = `ui-toast-card ui-toast-${type}`;

    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'ui-toast-body';
    if (this.opt.title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'ui-toast-title';
      titleEl.innerText = this.opt.title;
      bodyDiv.appendChild(titleEl);
    }
    bodyDiv.appendChild(this.content);

    const hasButtons = this.opt.id === 3 || (this.opt.id === 2 && !this.opt.t) || (!this.opt.t && (this.opt.cbt || this.opt.cbf));
    if (hasButtons) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'ui-toast-actions';
      if (this.opt.id === 3) actionsDiv.appendChild(this.cancel);
      actionsDiv.appendChild(this.ok);
      bodyDiv.appendChild(actionsDiv);
    }

    this.appendChild(bodyDiv);
    this.appendChild(this.closeBtn);

    if (this.opt.t) {
      const timeout = Number(this.opt.t) || 2000;
      const progress = document.createElement('div');
      progress.className = 'ui-toast-progress';
      progress.style.setProperty('--toast-duration', `${timeout}ms`);
      progress.style.animationDuration = `${timeout}ms`;
      this.appendChild(progress);
      this.timer = setTimeout(() => this.dismiss(), timeout);
    }

    if (hasButtons) {
      setTimeout(() => {
        (this.opt.id === 3 && this.opt.defaultFocus === 'cancel' ? this.cancel : this.ok).focus();
      }, 10);
    }
  }

  dismiss() {
    if (this.timer) clearTimeout(this.timer);
    this.classList?.add('ui-msg-closing');
    setTimeout(() => this.remove?.(), 150);
  }

  static quick(txt) { return new Notification(txt, { id: 0, t: 1500, type: 'info' }).show(); }
  static long(txt) { return new Notification(txt, { id: 1, t: 3500, type: 'info' }).show(); }
  static confirm(txt, cb) { return new Notification(txt, { id: 2, cbt: cb, type: 'info' }).show(); }
  static choice(txt, cbTrue, cbFalse) { return new Notification(txt, { id: 3, cbt: cbTrue, cbf: cbFalse, type: 'warning' }).show(); }
  static info(txt, title = 'Information') { return new Notification(txt, { t: 3000, type: 'info', title }).show(); }
  static success(txt, title = 'Success') { return new Notification(txt, { t: 3000, type: 'success', title }).show(); }
  static warning(txt, title = 'Warning') { return new Notification(txt, { t: 4000, type: 'warning', title }).show(); }
  static error(txt, title = 'Error') { return new Notification(txt, { id: 2, type: 'error', title }).show(); }
}

if (typeof customElements !== 'undefined' && !customElements.get('ui-msg')) {
  customElements.define('ui-msg', Notification);
}

let activeCompatToast = null;

export function showBrowserCompatibilityNotice() {
  if (typeof document === 'undefined' || activeCompatToast?.parentNode) return;
  const messageHtml = `
    <div>
      Direct in-place file saving requires the modern <strong>File System Access API</strong>, which is not supported in this browser.
      <div style="margin-top: 6px;">NanoCell is running in <strong>compatibility mode</strong>:</div>
      <ul style="margin: 4px 0 6px 18px; padding: 0; line-height: 1.4;">
        <li><strong>Open:</strong> File picker upload and drag-and-drop are supported.</li>
        <li><strong>Save:</strong> Files are saved by downloading them to your device.</li>
      </ul>
      <div style="font-size: 0.9em; opacity: 0.85; margin-top: 6px;">
        Direct in-place file editing is supported in Chrome, Edge, Brave, and Opera.
      </div>
    </div>
  `;
  activeCompatToast = new Notification(messageHtml, {
    id: 2,
    type: 'info',
    title: 'Browser Compatibility Notice'
  }).show();
}

export async function triggerAppInstall() {
  const outcome = await pwa.promptInstall();
  if (outcome === 'already-installed') {
    Notification.quick('NanoCell is already installed.');
  } else if (outcome === 'manual') {
    Notification.confirm('To install NanoCell, click the install icon in your browser address bar or browser menu.');
  } else if (outcome === 'unsupported') {
    Notification.confirm('Desktop installation is available on Chrome, Edge, Brave, and Chromium browsers.');
  }
  return outcome;
}

if (typeof window !== 'undefined') {
  window.addEventListener('appinstalled', () => Notification.quick('NanoCell installed successfully!'));
}

export { Notification };
