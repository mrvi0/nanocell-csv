import { setIcon } from '../utils/icons.js';
import { Notification } from './Notification.js';
import { DialogManager } from './DialogManager.js';
import { getNewIssueUrl, pwa } from '../utils/misc.js';

class AboutDialog extends HTMLElement {
  ensureRendered() {
    if (this._initialized) return;
    this._initialized = true;

    const version = this.getVersion();
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

  connectedCallback() {
    this.ensureRendered();
  }

  static show() {
    const el = document.createElement('ui-about');
    el.ensureRendered();
    DialogManager.open(el, { fullscreen: true });
    return el;
  }

  getVersion(cb) {
    const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v1.0.1-dev';
    if (typeof cb === 'function') cb(version);
    return version;
  }
}

if (!customElements.get('ui-about')) {
  customElements.define('ui-about', AboutDialog);
}

export { AboutDialog };
