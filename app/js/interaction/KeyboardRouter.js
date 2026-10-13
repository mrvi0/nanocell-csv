import { cmd } from './CommandRegistry.js';
import { dom } from '../ui/AppLayout.js';
import { DialogManager } from '../ui/DialogManager.js';
import { getSheet } from '../appContext.js';
import { stg } from '../ui/settings/Setting.js';
import { CsvParser } from '../../../core/csv/CsvParser.js';
import { CsvSerializer } from '../../../core/csv/CsvSerializer.js';
import { SeparatorDetector } from '../../../core/csv/SeparatorDetector.js';

let activeKeyDownHandler = null;
let activeKeyUpHandler = null;
let activeCopyHandler = null;
let activeCutHandler = null;
let activePasteHandler = null;
let shortcutMap = null;

function getShortcutKey(key, ctrl, shift, alt) {
  return `${ctrl ? 1 : 0}:${shift ? 1 : 0}:${alt ? 1 : 0}:${String(key).toUpperCase()}`;
}

function getShortcutMap() {
  if (!shortcutMap) {
    shortcutMap = new Map();
    for (const c of Object.values(cmd)) {
      if (!c.k || typeof c.run !== 'function') continue;
      const keyUpper = String(c.k).toUpperCase();
      const ctrl = Boolean(c.ctrl), shift = Boolean(c.shift), alt = Boolean(c.alt);
      shortcutMap.set(getShortcutKey(keyUpper, ctrl, shift, alt), c);
      if (c.k !== keyUpper) shortcutMap.set(getShortcutKey(c.k, ctrl, shift, alt), c);
    }
    if (cmd.delete) shortcutMap.set(getShortcutKey('DELETE', false, false, false), cmd.delete);
    if (cmd.redo) shortcutMap.set(getShortcutKey('Y', true, false, false), cmd.redo);
    if (cmd.shortcuts) shortcutMap.set(getShortcutKey('K', true, false, false), cmd.shortcuts);
  }
  return shortcutMap;
}

const PREVENT_DFLT_KEYS = new Set([
  'H', 'N', 'T', 'F', 'O', 'P', 'M', 'S', 'R', 'G', 'K',
  'A', 'B', 'D', 'E', 'L', 'Z', 'Y', 'Q', ';', 'BACKSPACE'
]);

const isInputElement = (el) =>
  Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));

export function buildKeys() {
  shortcutMap = null;
  if (typeof document !== 'undefined') {
    if (activeKeyDownHandler) document.removeEventListener('keydown', activeKeyDownHandler);
    if (activeKeyUpHandler) document.removeEventListener('keyup', activeKeyUpHandler);
    if (activeCopyHandler) document.removeEventListener('copy', activeCopyHandler);
    if (activeCutHandler) document.removeEventListener('cut', activeCutHandler);
    if (activePasteHandler) document.removeEventListener('paste', activePasteHandler);
  }

  activeKeyDownHandler = (e) => {
    let k = e.key.toUpperCase();
    const ctrlDown = e.metaKey || e.ctrlKey;
    const alt = e.altKey;
    const shift = e.shiftKey;
    const activeSheet = getSheet();

    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    const isCellInput = Boolean(activeSheet?.inputing && activeEl === activeSheet.inputField);
    const inCommandPalette = Boolean(
      activeEl?.closest?.('ui-command-palette') ||
      dom?.palette?.isOpen ||
      (typeof document !== 'undefined' && document.querySelector('ui-command-palette')?.isOpen)
    );
    const inDialog = Boolean(DialogManager.isBusy);
    const inFinder = Boolean(activeEl?.closest?.('ui-finder'));
    const inFilter = Boolean(activeEl?.closest?.('ui-filter'));
    const validationPane = dom?.validationPane || (typeof document !== 'undefined' ? (document.getElementById('validation-pane') || document.querySelector('ui-validation-pane')) : null);
    const inValidationPane = Boolean(validationPane?.isOpen);
    const isOtherInput = isInputElement(activeEl) && !isCellInput;

    if (ctrlDown && (PREVENT_DFLT_KEYS.has(k) || PREVENT_DFLT_KEYS.has(e.key))) {
      if (!(isOtherInput || isCellInput) || (k !== 'C' && k !== 'V' && k !== 'X' && k !== 'A' && k !== 'Z')) {
        e.preventDefault();
      }
    }

    if (inCommandPalette) {
      if (k === 'ESCAPE') {
        (document.getElementById('palette') || document.querySelector('ui-command-palette'))?.close?.();
      }
      return;
    }

    if (ctrlDown && (k === 'P' || k === 'K') && !shift && !alt) {
      e.preventDefault();
      if (cmd.shortcuts?.run) cmd.shortcuts.run();
      else (document.getElementById('palette') || document.querySelector('ui-command-palette'))?.toggle?.();
      return;
    }

    if (inDialog) {
      if (k === 'ESCAPE') { e.preventDefault(); DialogManager.close(); }
      return;
    }

    if (inFinder) {
      if (k === 'ESCAPE') { e.preventDefault(); activeEl.closest('ui-finder')?.close?.(); }
      else if (ctrlDown && k === 'F') { e.preventDefault(); activeSheet?.find(shift); }
      return;
    }

    if (inFilter) {
      if (k === 'ESCAPE' || (ctrlDown && k === 'Q')) { e.preventDefault(); activeEl.closest('ui-filter')?.close?.(); }
      return;
    }

    if (inValidationPane && k === 'ESCAPE' && !isCellInput) {
      e.preventDefault();
      validationPane.handleBack?.();
      return;
    }

    if (isOtherInput) return;

    if (isCellInput) {
      if (ctrlDown && (k === 'S' || k === 'O' || k === 'Q')) {
        e.preventDefault();
        if (k === 'S') (shift ? cmd.saveAs : cmd.save).run();
        else if (k === 'O') cmd.open.run();
        else if (k === 'Q') cmd.filter.run();
      }
      return;
    }

    const isBoundaryKey = k === 'ARROWUP' || k === 'ARROWDOWN' || k === 'ARROWLEFT' || k === 'ARROWRIGHT' ||
                          k === 'HOME' || k === 'END' || k === 'PAGEUP' || k === 'PAGEDOWN';
    if (activeSheet) {
      activeSheet.slctRange = shift && !alt && !e.metaKey && isBoundaryKey;
    }

    if ((alt && k === 'TAB') || (ctrlDown && (k === 'C' || k === 'V'))) return;
    if (k === 'TAB') e.preventDefault();
    if (e.code === 'Space') k = 'SPACE';

    if (activeSheet) {
      const pageSize = stg?.rows || 10;
      const maxX = Math.max(0, activeSheet.df.width - 1);
      const maxY = Math.max(0, activeSheet.rowCount - 1);

      if (k === 'PAGEUP') {
        e.preventDefault();
        activeSheet.y = Math.max(0, activeSheet.y - pageSize);
        return activeSheet.slctRefresh();
      }
      if (k === 'PAGEDOWN') {
        e.preventDefault();
        activeSheet.y = Math.min(maxY, activeSheet.y + pageSize);
        return activeSheet.slctRefresh();
      }
      if (k === 'HOME') {
        e.preventDefault();
        activeSheet.x = 0;
        if (ctrlDown) activeSheet.y = 0;
        return activeSheet.slctRefresh();
      }
      if (k === 'END' && ctrlDown) {
        e.preventDefault();
        activeSheet.x = maxX;
        activeSheet.y = maxY;
        return activeSheet.slctRefresh();
      }
      if (k === 'F2') {
        e.preventDefault();
        if (!activeSheet.df?.lock) activeSheet.input();
        return;
      }
      if (ctrlDown) {
        if (k === 'ARROWUP') { e.preventDefault(); activeSheet.y = 0; return activeSheet.slctRefresh(); }
        if (k === 'ARROWRIGHT') { e.preventDefault(); activeSheet.x = maxX; return activeSheet.slctRefresh(); }
        if (k === 'ARROWDOWN') { e.preventDefault(); activeSheet.y = maxY; return activeSheet.slctRefresh(); }
        if (k === 'ARROWLEFT') { e.preventDefault(); activeSheet.x = 0; return activeSheet.slctRefresh(); }
      }
    }

    const map = getShortcutMap();
    const matchedCmd = map.get(getShortcutKey(k, ctrlDown, shift, alt)) ||
                       map.get(getShortcutKey(e.key, ctrlDown, shift, alt));
    if (matchedCmd) {
      matchedCmd.run();
      return e.preventDefault();
    }

    if (e.key.length === 1 && !ctrlDown && !e.metaKey && !alt && activeSheet) {
      if (activeSheet.df?.lock) return;
      e.preventDefault();
      return activeSheet.input(e.key);
    }

    if (activeSheet) {
      switch (k) {
        case 'ARROWUP': e.preventDefault(); activeSheet.y--; activeSheet.slctRefresh(); return;
        case 'ARROWDOWN': e.preventDefault(); activeSheet.y++; activeSheet.slctRefresh(); return;
        case 'ARROWLEFT': e.preventDefault(); activeSheet.x--; activeSheet.slctRefresh(); return;
        case 'ARROWRIGHT': e.preventDefault(); activeSheet.x++; activeSheet.slctRefresh(); return;
        case 'TAB':
          e.preventDefault();
          activeSheet.slctRange = false;
          activeSheet.rangeEnd = undefined;
          activeSheet.x += shift ? -1 : 1;
          activeSheet.slctRefresh();
          return;
        case 'ENTER':
          e.preventDefault();
          if (!activeSheet.df?.lock) activeSheet.input();
          return;
        case 'BACKSPACE':
        case 'DELETE':
          e.preventDefault();
          if (!activeSheet.df?.lock) {
            activeSheet.rangeEdit('');
            activeSheet.refresh();
          }
          return;
      }
    }
  };

  activeKeyUpHandler = (e) => {
    const k = e.key.toUpperCase();
    const activeSheet = getSheet();
    if (activeSheet && (k === 'CONTROL' || k === 'SHIFT') && !e.shiftKey) {
      activeSheet.slctRange = false;
    }
  };

  const getClipboardSheet = (requireUnlocked = false) => {
    if (isInputElement(document.activeElement)) return null;
    const s = getSheet();
    return (!s || (requireUnlocked && s.df?.lock)) ? null : s;
  };

  activeCopyHandler = (e) => {
    const s = getClipboardSheet(false);
    if (!s) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', new CsvSerializer({ delimiter: '\t' }).serialize(s.rangeArray()));
  };

  activeCutHandler = (e) => {
    const s = getClipboardSheet(true);
    if (!s) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', new CsvSerializer({ delimiter: '\t' }).serialize(s.rangeArray()));
    s.rangeEdit('');
    s.refresh();
  };

  activePasteHandler = (e) => {
    const s = getClipboardSheet(true);
    if (!s) return;
    e.preventDefault();
    const rawText = e.clipboardData?.getData('text');
    if (!rawText) return;
    const delimiter = rawText.includes('\t') ? '\t' : SeparatorDetector.detect(rawText);
    const matrix = new CsvParser({ delimiter, trimUnquotedWhitespace: Boolean(stg?.trim_unquoted) }).parse(rawText);
    if (matrix?.length > 0) {
      s.paste(matrix);
      s.refresh();
    }
  };

  document.addEventListener('keydown', activeKeyDownHandler);
  document.addEventListener('keyup', activeKeyUpHandler);
  document.addEventListener('copy', activeCopyHandler);
  document.addEventListener('cut', activeCutHandler);
  document.addEventListener('paste', activePasteHandler);
}
