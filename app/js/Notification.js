import { setIcon } from './icons.js';
import { env, pwa } from './state.js';

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

class Notification extends BaseElement {
  constructor(txt, opt = {}) {
    super();
    this.txt = txt;
    this.opt = opt;

    this.content = document.createElement('div');
    this.content.className = 'ui-msg-text';
    if (txt instanceof HTMLElement) {
      this.content.appendChild(txt);
    } else if (opt.allowHtml && typeof txt === 'string') {
      this.content.innerHTML = txt;
    } else {
      this.content.innerText = txt ?? '';
    }

    const mkBtn = (cls, icon, label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `${cls} icon`;
      b.setAttribute('aria-label', label);
      b.title = label;
      setIcon(b, icon);
      b.onclick = fn;
      b.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          fn();
        }
      };
      return b;
    };

    this.ok = mkBtn('ui-msg-ok', 'on', opt.okText || 'Confirm', () => this.resolve(true));
    this.cancel = mkBtn('ui-msg-cancel', 'off', opt.cancelText || 'Cancel', () => this.resolve(false));
    this.closeBtn = mkBtn('ui-toast-close-btn', 'off', 'Dismiss notification', () => this.dismiss());

    this.keyHandler = (e) => {
      if (!this.isConnected) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.opt.id === 3 ? this.resolve(false) : this.dismiss();
      } else if (e.key === 'Enter' && this.opt.id === 3 && document.activeElement !== this.cancel) {
        e.preventDefault();
        e.stopPropagation();
        this.resolve(true);
      } else if (e.key === 'Tab' && this.opt.id === 3) {
        e.preventDefault();
        (document.activeElement === this.cancel ? this.ok : this.cancel).focus();
      }
    };
  }

  connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;
    this.setAttribute('role', this.opt.id === 3 ? 'alertdialog' : 'status');
    this.setAttribute('aria-live', 'polite');
    this.renderToast();
    document.addEventListener('keydown', this.keyHandler);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this.keyHandler);
    if (this.timer) clearTimeout(this.timer);
  }

  show() {
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
    if (this._closing) return;
    this._closing = true;
    this.remove();
  }

  resolve(confirmed) {
    if (this._resolved) return;
    this._resolved = true;
    if (confirmed && typeof this.opt.cbt === 'function') this.opt.cbt();
    else if (!confirmed && typeof this.opt.cbf === 'function') this.opt.cbf();
    this.dismiss();
  }

  static quick(txt, time = 2000, type = 'info', title = '') { return new Notification(txt, { id: 1, t: time, type, title }).show(); }
  static info(txt, title = 'Info', time = 2500) { return new Notification(txt, { id: 1, t: time, type: 'info', title }).show(); }
  static success(txt, title = 'Success', time = 2500) { return new Notification(txt, { id: 1, t: time, type: 'success', title }).show(); }
  static warning(txt, title = 'Warning', time = 3500) { return new Notification(txt, { id: 1, t: time, type: 'warning', title }).show(); }
  static error(txt, title = 'Error', time = 4500) { return new Notification(txt, { id: 1, t: time, type: 'error', title }).show(); }
  static confirm(txt, cb) { return new Notification(txt, { id: 2, t: 3500, cbt: cb, type: 'info' }).show(); }
  static choice(txt, cbt, cbf) { return new Notification(txt, { id: 3, cbt, cbf, type: 'warning', title: 'Confirm Action' }).show(); }
}

if (typeof customElements !== 'undefined' && !customElements.get('ui-msg')) {
  customElements.define('ui-msg', Notification);
}

export async function triggerAppInstall() {
  const state = pwa.getState();
  if (state.isStandalone || state.isInstalled) {
    return Notification.info('NanoCell is already installed as a desktop app.', 'App Installed', 3500);
  }
  if (!state.canInstall) {
    return Notification.warning('Desktop app installation requires a desktop Chromium browser (Chrome, Edge, or Brave).', 'Not Supported on This Browser', 5000);
  }
  const res = await pwa.promptInstall();
  if (res === 'accepted') {
    return Notification.success('NanoCell Desktop App installed!', 'App Installed', 3500);
  }
  if (res === 'manual') {
    return Notification.info('To install NanoCell: click the Install icon in your browser address bar (or Browser Menu -> Save and share -> Install page as app).', 'Install Desktop App', 6000);
  }
  return null;
}

let compatibilityNoticeShown = false;

export function showBrowserCompatibilityNotice() {
  if (compatibilityNoticeShown || env.supportsFileSystemAccess) return;
  compatibilityNoticeShown = true;
  const text = env.isMobile
    ? `Direct file saving and desktop app installation are not available on ${env.osLabel || 'mobile devices'}. You can still open, edit, and download CSV files normally.`
    : `Your browser (${env.browserName}) does not support direct in-place file saving or PWA installation. You can still open and download CSV files, or use Chrome, Edge, or Brave for full desktop integration.`;
  return Notification.info(text, 'Limited Browser Capabilities', 6500);
}

export { Notification };
