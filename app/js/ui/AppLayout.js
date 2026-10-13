import { setIcon } from '../utils/icons.js';
import { DialogManager } from './DialogManager.js';
import { cmd, getCommandTooltip } from '../interaction/CommandRegistry.js';
import { pwa } from '../utils/misc.js';
import { triggerAppInstall } from './Notification.js';

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class Scroller extends BaseElement {
  constructor(vertical = true) {
    super();
    this.vertical = vertical;
    this.classList?.add(vertical ? 'vertical' : 'horizontal');
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('ui-scroller')) {
  customElements.define('ui-scroller', Scroller);
}

let dom = undefined;

export class AppLayout {
  static init() {
    const get = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
    const dialogEl = get('dialog');
    DialogManager.init(dialogEl);

    dom = {
      palette: get('palette') || (typeof document !== 'undefined' ? document.querySelector('ui-command-palette') : null),
      header: get('header'),
      body: get('body') || (typeof document !== 'undefined' ? document.body : null),
      content: get('content'),
      mainContainer: get('main-container'),
      validationPane: get('validation-pane'),
      dialog: dialogEl,
      footer: get('footer'),
      cmenu: typeof document !== 'undefined' ? document.createElement('ui-cmenu') : null,
      footerDiv: {
        left: get('footerLeft'),
        center: get('footerCenter'),
        right: get('footerRight'),
        lock: get('lock'),
      },
    };

    if (dom.footerDiv.lock) setIcon(dom.footerDiv.lock, 'edit_square');
    if (dom.content) {
      dom.content.scrollerY = new Scroller(true);
      dom.content.scrollerX = new Scroller(false);
    }
    if (dom.body && dom.cmenu) dom.body.appendChild(dom.cmenu);
    return dom;
  }

  static get elements() {
    return dom;
  }
}

export function buildMenu() {
  if (!dom?.header) return;
  const menuItems = [
    'new', 'open', 'save', 'reloadFile', 'undo', 'redo', '',
    'fixTop', 'sort', 'sort_reverse', 'transpose', 'trim', 'date', 'integer', 'decimal', 'validate_data',
    'filter', 'find', '', 'about', 'settings', 'shortcuts'
  ];

  for (const item of menuItems) {
    if (!item) {
      const spacer = document.createElement('div');
      spacer.className = 'header-spacer grow';
      dom.header.appendChild(spacer);
      continue;
    }
    const tooltip = getCommandTooltip(cmd[item], item);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon';
    btn.setAttribute('data-icon', item);
    setIcon(btn, item);
    btn.setAttribute('title', tooltip);
    btn.setAttribute('aria-label', tooltip);
    btn.setAttribute('role', 'button');
    btn.addEventListener('click', () => cmd[item]?.run?.());
    dom.header.appendChild(btn);
  }

  const installBtn = document.createElement('button');
  installBtn.type = 'button';
  installBtn.id = 'menuInstallBtn';
  installBtn.className = 'menu-install-btn';
  installBtn.setAttribute('title', 'Install Desktop App');
  installBtn.setAttribute('aria-label', 'Install Desktop App');
  installBtn.setAttribute('role', 'button');
  installBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
    <span>Install</span>
  `;
  installBtn.addEventListener('click', () => triggerAppInstall());
  pwa.subscribe((state) => {
    installBtn.style.display = state.canInstall ? 'inline-flex' : 'none';
  });
  dom.header.appendChild(installBtn);
}

export { dom };
