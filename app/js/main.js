import { getSheet, setCsvHandle } from './appContext.js';
import './ui/ContextMenu.js';
import { CsvHandle } from './io/CsvHandle.js';
import { Dataframe } from '../../core/model/Dataframe.js';
import { AppLayout, buildMenu } from './ui/AppLayout.js';
import { buildKeys } from './interaction/KeyboardRouter.js';
import { Setting } from './ui/settings/Setting.js';
import { Sheet } from './sheet/Sheet.js';
import './ui/CommandPalette.js';
import './ui/ValidationPane.js';
import './ui/AboutDialog.js';
import './ui/FinderDialog.js';
import { Notification, showBrowserCompatibilityNotice } from './ui/Notification.js';
import { registerSW } from 'virtual:pwa-register';
import { env } from './utils/misc.js';

window.addEventListener('beforeunload', (e) => {
  const currentSheet = getSheet();
  if (currentSheet?.df && !currentSheet.df.isSaved) e.preventDefault();
});

export function nanocell_cleanStart() {
  const csvHandle = new CsvHandle();
  setCsvHandle(csvHandle);
  Setting.init();
  AppLayout.init();
  Setting.runAll();
  buildMenu();
  buildKeys();
  new Sheet(new Dataframe([['Hello World']]));
  csvHandle.initListeners();
  if (!env.supportsFileSystemAccess) {
    showBrowserCompatibilityNotice();
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => nanocell_cleanStart(), { once: true });
  } else {
    nanocell_cleanStart();
  }
}

export function handleSWUpdatePrompt(updateSWFn = updateSW) {
  const currentSheet = getSheet();
  const hasUnsaved = currentSheet?.df && !currentSheet.df.isSaved;
  const message = hasUnsaved
    ? 'A new update is available. You have unsaved changes. Please save your file before updating.'
    : 'A new update is available. Reload to update?';

  return new Notification(message, {
    id: 3,
    type: hasUnsaved ? 'warning' : 'info',
    title: 'Update Available',
    okText: 'Reload',
    cancelText: 'Later',
    defaultFocus: hasUnsaved ? 'cancel' : 'ok',
    cbt: () => {
      const sheetNow = getSheet();
      if (sheetNow?.df && !sheetNow.df.isSaved) {
        Notification.warning('Please save your changes before reloading.', 'Unsaved Changes');
        return;
      }
      if (typeof updateSWFn === 'function') updateSWFn(true);
    }
  }).show();
}

export const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    handleSWUpdatePrompt(updateSW);
  },
  onOfflineReady() {
    console.log('App ready to work offline');
  },
  onRegisteredSW(swUrl, registration) {
    if (registration) {
      setInterval(() => registration.update(), 60 * 60 * 1000);
      window.addEventListener('focus', () => registration.update());
    }
  }
});
