/**
 * @file app/js/AppLayout.js
 * Application shell chrome: Header action bar, Footer status bar & coordinate jumper,
 * custom <ui-scroller> bars, and shared DOM references.
 */

import { setIcon } from './icons.js';
import { getSheet, getCsvHandle, pwa, formatShortcut } from './state.js';
import { DialogManager } from './Dialogs.js';
import { Notification, triggerAppInstall } from './Notification.js';

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
let isEditingCoords = false;

export class AppLayout {
  static init() {
    const get = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
    const dialogEl = get('dialog');
    DialogManager.init(dialogEl);
    isEditingCoords = false;

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
    initFooterEvents();
    return dom;
  }

  static get elements() {
    return dom;
  }
}

function initFooterEvents() {
  const left = dom?.footerDiv?.left;
  if (left && !left._coordClickBound) {
    left._coordClickBound = true;
    left.title = 'Click to jump to cell';
    left.addEventListener('click', (e) => {
      if (!e.target.closest('.coord-editor')) startCoordEdit();
    });
  }

  const lock = dom?.footerDiv?.lock;
  if (lock && !lock._hasLockListener) {
    lock._hasLockListener = true;
    lock.addEventListener('click', () => {
      const sheet = getSheet();
      const csv = getCsvHandle();
      if (!sheet?.df?.lock && !csv?.viewOnly) return;
      const msg = sheet?.filterRows
        ? 'File is locked while a filter is active.'
        : 'File is in View-Only mode. Edits are disabled.';
      Notification.warning(msg, 'View-Only Mode');
    });
  }
}

export function startCoordEdit(sheet = getSheet()) {
  const f = dom?.footerDiv;
  if (!sheet || !f?.left || isEditingCoords) return;
  isEditingCoords = true;

  const currentX = sheet.x + 1;
  const currentY = sheet.y + 1;

  f.left.classList.add('editing');
  f.left.innerHTML = `
    <span class="coord-editor">
      <input type="number" class="coord-input coord-col finder-input" min="1" value="${currentX}" aria-label="Column" title="Column" />
      <span class="coord-sep">:</span>
      <input type="number" class="coord-input coord-row finder-input" min="1" value="${currentY}" aria-label="Row" title="Row" />
      <button class="icon coord-go-btn" type="button" title="Go to cell (Enter)" aria-label="Go to cell"></button>
    </span>
  `;

  const inputCol = f.left.querySelector('.coord-col');
  const inputRow = f.left.querySelector('.coord-row');
  const goBtn = f.left.querySelector('.coord-go-btn');
  const container = f.left.querySelector('.coord-editor');
  if (goBtn) setIcon(goBtn, 'arrow_right');

  let committed = false;
  const finish = (apply) => {
    if (committed) return;
    committed = true;
    isEditingCoords = false;
    f.left.classList.remove('editing');
    if (apply) {
      const col = Math.max(1, parseInt(inputCol.value, 10) || currentX);
      const row = Math.max(1, parseInt(inputRow.value, 10) || currentY);
      sheet.rangeEnd = undefined;
      sheet.slctRange = false;
      sheet.x = col - 1;
      sheet.y = row - 1;
      sheet.slctFocus();
      sheet.refresh();
      sheet.slctRefresh(false);
    }
    footerUpdate(sheet);
  };

  const focusables = [inputCol, inputRow, goBtn].filter(Boolean);
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.stopPropagation();
      DialogManager.cycleFocus(e, focusables);
      document.activeElement?.select?.();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  });

  goBtn?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); finish(true); });
  container.addEventListener('click', (e) => e.stopPropagation());
  container.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!committed && !container.contains(document.activeElement)) finish(true);
    }, 100);
  });

  inputCol.focus();
  inputCol.select();
}

export function footerUpdate(sheet = getSheet()) {
  const f = dom?.footerDiv;
  if (!sheet || !f?.left) return;
  initFooterEvents();
  if (isEditingCoords) return;

  const actualY = sheet.getRowIndex(sheet.y);
  const startYDisplay = actualY >= 0 ? actualY + 1 : sheet.y + 1;

  if (sheet.rangeEnd) {
    const deltaX = Math.abs(sheet.rangeEnd.x - sheet.x) + 1;
    const actualRangeY = sheet.getRowIndex(sheet.rangeEnd.y);
    const endYDisplay = actualRangeY >= 0 ? actualRangeY + 1 : sheet.rangeEnd.y + 1;
    const deltaY = Math.abs(endYDisplay - startYDisplay) + 1;
    f.left.innerHTML = `${sheet.x + 1}:${startYDisplay} to ${sheet.rangeEnd.x + 1}:${endYDisplay} (${deltaX}x${deltaY})`;
  } else {
    f.left.innerHTML = `${sheet.x + 1}:${startYDisplay}`;
  }

  f.right.innerHTML = sheet.filterRows
    ? `${sheet.df.width}:${sheet.filterRows.length} (${sheet.df.height})`
    : `${sheet.df.width}:${sheet.df.height}`;

  const cellVal = (actualY >= 0 && actualY < sheet.df.height) ? sheet.df.get(sheet.x, actualY) : '';
  f.center.innerHTML = cellVal
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('\n', '<br>')
    .replaceAll(' ', '<span class="cell-space-dot">&bull;</span>');

  if (f.lock) {
    const csv = getCsvHandle();
    const isLocked = Boolean(sheet.df?.lock || csv?.viewOnly);
    const hasFileHandle = Boolean(csv?.handle);
    const isSaved = Boolean(sheet.df?.isSaved);

    let lockIcon = 'edit_square';
    let lockTitle = hasFileHandle ? 'Unsaved changes relative to disk' : 'New file edit';
    if (isLocked) {
      lockIcon = 'lock';
      lockTitle = sheet.filterRows ? 'Locked (filter active)' : 'Locked (view-only mode)';
    } else if (hasFileHandle && isSaved) {
      lockIcon = 'save_disk';
      lockTitle = 'File saved (no edits ongoing)';
    }

    setIcon(f.lock, lockIcon);
    f.lock.setAttribute('title', lockTitle);
    f.lock.setAttribute('aria-label', lockTitle);
    f.lock.classList.toggle('warning', isLocked);
  }
}

export function scrollbarRefresh(sheet = getSheet()) {
  const dsy = dom?.content?.scrollerY;
  const dsx = dom?.content?.scrollerX;
  if (!sheet || !dsy || !dsx) return;

  const dfh = sheet.rowCount;
  const dfw = sheet.df.width;
  const showY = dfh >= sheet.nViewRows / 2;
  const showX = dfw >= sheet.nViewCols - 2;

  dsy.classList.toggle('hidden', !showY);
  dsy.style.display = showY ? 'block' : 'none';
  dsx.classList.toggle('hidden', !showX);
  dsx.style.display = showX ? 'block' : 'none';

  const totalY = Math.max(dfh - 1, sheet.baseY, 1);
  const totalX = Math.max(dfw - 1, sheet.baseX, 1);
  const sheetRect = (showY || showX) ? sheet.getBoundingClientRect?.() : null;

  if (showY) {
    const [sizeY, hStr] = totalY < 100 ? ['lg', '50vh'] : (totalY < 1000 ? ['md', '20vh'] : ['sm', '10vh']);
    dsy.setAttribute('data-size', sizeY);
    dsy.style.height = hStr;
    const top = (sheet.rows[1] && sheetRect) ? (sheet.rows[1].getBoundingClientRect().top - sheetRect.top) : 0;
    const theight = (sheetRect ? sheetRect.height : 0) - top - dsy.offsetHeight;
    dsy.style.top = `${top + Math.round((theight * sheet.baseY) / totalY)}px`;
  }
  if (showX) {
    const [sizeX, wStr] = totalX < 30 ? ['lg', '50vw'] : (totalX < 100 ? ['md', '20vw'] : ['sm', '10vw']);
    dsx.setAttribute('data-size', sizeX);
    dsx.style.width = wStr;
    const left = sheet.rows[0]?.cells[1] ? sheet.rows[0].cells[1].getBoundingClientRect().left : 0;
    const twidth = (sheetRect ? sheetRect.right : 0) - left - dsx.offsetWidth;
    dsx.style.left = `${left + Math.round((twidth * sheet.baseX) / totalX)}px`;
  }
}

export function buildMenu(cmd) {
  if (!dom?.header || !cmd) return;
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
    const c = cmd[item];
    const shortcut = formatShortcut(c);
    const name = c?.label || c?.description || item;
    const tooltip = shortcut ? `${name} (${shortcut})` : name;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon';
    btn.setAttribute('data-icon', item);
    setIcon(btn, item);
    btn.setAttribute('title', tooltip);
    btn.setAttribute('aria-label', tooltip);
    btn.setAttribute('role', 'button');
    btn.addEventListener('click', () => c?.run?.());
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
