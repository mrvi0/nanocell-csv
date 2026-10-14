/**
 * @file app/js/AppLayout.js
 * Application shell chrome: Header action bar, Footer status bar & coordinate jumper,
 * custom <ui-scroller> bars, and shared DOM references.
 */

import { BaseElement, defineEl, setIcon, hydrateIcons } from './icons.js';
import { getSheet, getCsvHandle, pwa, formatShortcut } from './state.js';
import { DialogManager } from './Dialogs.js';
import { Notification, triggerAppInstall } from './Notification.js';

export class Scroller extends BaseElement {
  constructor(vertical = true) {
    super();
    this.vertical = vertical;
    this.classList?.add(vertical ? 'vertical' : 'horizontal');
  }
}

defineEl('ui-scroller', Scroller);

let dom = undefined;
let isEditingCoords = false;

export class AppLayout {
  static init() {
    const getById = (id) => globalThis.document?.getElementById?.(id) || null;
    const dialogEl = getById('dialog');
    DialogManager.init(dialogEl);
    isEditingCoords = false;

    dom = {
      palette: getById('palette') || globalThis.document?.querySelector?.('ui-command-palette') || null,
      header: getById('header'),
      body: getById('body') || globalThis.document?.body || null,
      content: getById('content'),
      mainContainer: getById('main-container'),
      validationPane: getById('validation-pane'),
      dialog: dialogEl,
      footer: getById('footer'),
      contextMenu: globalThis.document?.createElement?.('ui-cmenu') || null,
      footerElements: {
        left: getById('footer-left'),
        center: getById('footer-center'),
        right: getById('footer-right'),
        lock: getById('lock'),
      },
    };

    if (dom.footerElements.lock) setIcon(dom.footerElements.lock, 'edit_square');
    if (dom.content) {
      dom.content.scrollerY = new Scroller(true);
      dom.content.scrollerX = new Scroller(false);
    }
    if (dom.body && dom.contextMenu) dom.body.appendChild(dom.contextMenu);
    initFooterEvents();
    return dom;
  }

  static get elements() { return dom; }
}

function initFooterEvents() {
  const leftEl = dom?.footerElements?.left;
  if (leftEl && !leftEl._coordClickBound) {
    leftEl._coordClickBound = true;
    leftEl.title = 'Click to jump to cell';
    leftEl.addEventListener('click', (e) => {
      if (!e.target.closest('.coord-editor')) startCoordEdit();
    });
  }

  const lockEl = dom?.footerElements?.lock;
  if (lockEl && !lockEl._hasLockListener) {
    lockEl._hasLockListener = true;
    lockEl.addEventListener('click', () => {
      const sheet = getSheet();
      const csvHandle = getCsvHandle();
      if (!sheet?.df?.lock && !csvHandle?.viewOnly) return;
      Notification.warning(
        sheet?.filterRows ? 'File is locked while a filter is active.' : 'File is in View-Only mode. Edits are disabled.',
        'View-Only Mode'
      );
    });
  }
}

export function startCoordEdit(sheet = getSheet()) {
  const footer = dom?.footerElements;
  if (!sheet || !footer?.left || isEditingCoords) return;
  isEditingCoords = true;

  const currentCol = sheet.x + 1;
  const currentRow = sheet.y + 1;

  footer.left.classList.add('editing');
  footer.left.innerHTML = `
    <span class="coord-editor">
      <input type="number" class="coord-input coord-col finder-input" min="1" value="${currentCol}" aria-label="Column" title="Column" />
      <span class="coord-sep">:</span>
      <input type="number" class="coord-input coord-row finder-input" min="1" value="${currentRow}" aria-label="Row" title="Row" />
      <button class="icon coord-go-btn" type="button" title="Go to cell (Enter)" aria-label="Go to cell" data-icon="arrow_right"></button>
    </span>
  `;
  hydrateIcons(footer.left);

  const inputCol = footer.left.querySelector('.coord-col');
  const inputRow = footer.left.querySelector('.coord-row');
  const goBtn = footer.left.querySelector('.coord-go-btn');
  const container = footer.left.querySelector('.coord-editor');

  let committed = false;
  const finish = (apply) => {
    if (committed) return;
    committed = true;
    isEditingCoords = false;
    footer.left.classList.remove('editing');
    if (apply) {
      const col = Math.max(1, parseInt(inputCol.value, 10) || currentCol);
      const row = Math.max(1, parseInt(inputRow.value, 10) || currentRow);
      sheet.focusCell(col - 1, row - 1);
      sheet.refresh();
    }
    updateFooter(sheet);
  };

  const focusables = [inputCol, inputRow, goBtn].filter(Boolean);
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.stopPropagation();
      DialogManager.cycleFocus(e, focusables);
      globalThis.document?.activeElement?.select?.();
    } else if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(e.key === 'Enter');
    }
  });

  goBtn?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); finish(true); });
  container.addEventListener('click', (e) => e.stopPropagation());
  container.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!committed && !container.contains(globalThis.document?.activeElement)) finish(true);
    }, 100);
  });

  inputCol.focus();
  inputCol.select();
}

export function updateFooter(sheet = getSheet()) {
  const footer = dom?.footerElements;
  if (!sheet || !footer?.left) return;
  initFooterEvents();
  if (isEditingCoords) return;

  const actualY = sheet.getRowIndex(sheet.y);
  const startYDisplay = actualY >= 0 ? actualY + 1 : sheet.y + 1;

  if (sheet.rangeEnd) {
    const deltaX = Math.abs(sheet.rangeEnd.x - sheet.x) + 1;
    const actualRangeY = sheet.getRowIndex(sheet.rangeEnd.y);
    const endYDisplay = actualRangeY >= 0 ? actualRangeY + 1 : sheet.rangeEnd.y + 1;
    const deltaY = Math.abs(endYDisplay - startYDisplay) + 1;
    footer.left.innerHTML = `${sheet.x + 1}:${startYDisplay} to ${sheet.rangeEnd.x + 1}:${endYDisplay} (${deltaX}x${deltaY})`;
  } else {
    footer.left.innerHTML = `${sheet.x + 1}:${startYDisplay}`;
  }

  footer.right.innerHTML = sheet.filterRows
    ? `${sheet.df.width}:${sheet.filterRows.length} (${sheet.df.height})`
    : `${sheet.df.width}:${sheet.df.height}`;

  const cellValue = (actualY >= 0 && actualY < sheet.df.height) ? sheet.df.get(sheet.x, actualY) : '';
  footer.center.innerHTML = cellValue
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('\n', '<br>')
    .replaceAll(' ', '<span class="cell-space-dot">&bull;</span>');

  if (footer.lock) {
    const csvHandle = getCsvHandle();
    const isLocked = Boolean(sheet.df?.lock || csvHandle?.viewOnly);
    const hasFileHandle = Boolean(csvHandle?.handle);
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

    setIcon(footer.lock, lockIcon);
    footer.lock.setAttribute('title', lockTitle);
    footer.lock.setAttribute('aria-label', lockTitle);
    footer.lock.classList.toggle('warning', isLocked);
  }
}

export function getScrollBoundsY(sheet) {
  if (!sheet?.rows?.[1]) return null;
  const rect = sheet.getBoundingClientRect?.();
  if (!rect) return null;
  const offset = sheet.rows[1].getBoundingClientRect().top;
  return { offset, topOffset: offset - rect.top, trackHeight: Math.max(1, rect.bottom - offset) };
}

export function getScrollBoundsX(sheet) {
  if (!sheet?.rows?.[0]?.cells?.[0]) return null;
  const rect = sheet.getBoundingClientRect?.();
  if (!rect) return null;
  const leftCell = sheet.rows[0].cells[1] || sheet.rows[0].cells[0];
  const offset = sheet.rows[0].cells[0].getBoundingClientRect().left;
  const leftOffset = leftCell.getBoundingClientRect().left;
  return { offset, leftOffset, trackWidth: Math.max(1, rect.right - offset), barTrackWidth: rect.right - leftOffset };
}

export function refreshScrollbars(sheet = getSheet()) {
  const scrollerY = dom?.content?.scrollerY;
  const scrollerX = dom?.content?.scrollerX;
  if (!sheet || !scrollerY || !scrollerX) return;

  const rowCount = sheet.rowCount;
  const colCount = sheet.df.width;
  const showY = rowCount >= sheet.viewRows / 2;
  const showX = colCount >= sheet.viewCols - 2;

  scrollerY.classList.toggle('hidden', !showY);
  scrollerY.style.display = showY ? 'block' : 'none';
  scrollerX.classList.toggle('hidden', !showX);
  scrollerX.style.display = showX ? 'block' : 'none';

  const totalY = Math.max(rowCount - 1, sheet.baseY, 1);
  const totalX = Math.max(colCount - 1, sheet.baseX, 1);

  if (showY) {
    const [sizeY, heightCss] = totalY < 100 ? ['lg', '50vh'] : (totalY < 1000 ? ['md', '20vh'] : ['sm', '10vh']);
    scrollerY.setAttribute('data-size', sizeY);
    scrollerY.style.height = heightCss;
    const boundsY = getScrollBoundsY(sheet);
    const topOffset = boundsY ? boundsY.topOffset : 0;
    const trackHeight = (boundsY ? boundsY.trackHeight : 0) - scrollerY.offsetHeight;
    scrollerY.style.top = `${topOffset + Math.round((trackHeight * sheet.baseY) / totalY)}px`;
  }
  if (showX) {
    const [sizeX, widthCss] = totalX < 30 ? ['lg', '50vw'] : (totalX < 100 ? ['md', '20vw'] : ['sm', '10vw']);
    scrollerX.setAttribute('data-size', sizeX);
    scrollerX.style.width = widthCss;
    const boundsX = getScrollBoundsX(sheet);
    const leftOffset = boundsX ? boundsX.leftOffset : 0;
    const trackWidth = (boundsX ? boundsX.barTrackWidth : 0) - scrollerX.offsetWidth;
    scrollerX.style.left = `${leftOffset + Math.round((trackWidth * sheet.baseX) / totalX)}px`;
  }
}

export function buildMenu(commands) {
  if (!dom?.header || !commands) return;
  const menuItems = [
    'new', 'open', 'save', 'reloadFile', 'undo', 'redo', '',
    'fixTop', 'sortAscending', 'sortDescending', 'transpose', 'trim', 'date', 'integer', 'decimal', 'validateData',
    'filter', 'find', '', 'about', 'settings', 'shortcuts'
  ];

  for (const itemId of menuItems) {
    if (!itemId) {
      const spacer = document.createElement('div');
      spacer.className = 'header-spacer grow';
      dom.header.appendChild(spacer);
      continue;
    }
    const command = commands[itemId];
    const iconName = command?.icon || itemId;
    const shortcut = formatShortcut(command);
    const label = command?.label || command?.description || itemId;
    const tooltip = shortcut ? `${label} (${shortcut})` : label;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon';
    setIcon(btn, iconName);
    btn.title = tooltip;
    btn.setAttribute('aria-label', tooltip);
    btn.setAttribute('role', 'button');
    btn.addEventListener('click', () => command?.run?.());
    dom.header.appendChild(btn);
  }

  const installBtn = document.createElement('button');
  installBtn.type = 'button';
  installBtn.id = 'menu-install-btn';
  installBtn.className = 'menu-install-btn';
  installBtn.title = 'Install Desktop App';
  installBtn.setAttribute('aria-label', 'Install Desktop App');
  installBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
    <span>Install</span>
  `;
  installBtn.addEventListener('click', () => triggerAppInstall());
  pwa.subscribe((state) => { installBtn.style.display = state.canInstall ? 'inline-flex' : 'none'; });
  dom.header.appendChild(installBtn);
}

export { dom };
