/**
 * @file app/js/state.js
 * Unified application runtime context, persistent settings store (Setting / stg),
 * environment detection, and PWA install state manager.
 * Zero DOM component dependencies, zero circular imports.
 */

let activeSheet = null;
let activeCsvHandle = null;

export function getSheet() { return activeSheet; }
export function setSheet(sheet) { activeSheet = sheet; }
export function getDataframe() { return activeSheet?.df || null; }
export function getCsvHandle() { return activeCsvHandle; }
export function setCsvHandle(handle) { activeCsvHandle = handle; }
export function resetContext() { activeSheet = null; activeCsvHandle = null; }

// --- Persistent Settings Store ---

const stg = {};
if (typeof globalThis !== 'undefined') globalThis.stg = stg;

export class Setting {
  constructor(s) {
    let stored = null;
    try {
      stored = (typeof window !== 'undefined' && typeof localStorage !== 'undefined') ? localStorage.getItem(s.key) : null;
    } catch {}

    if (stored !== null && stored !== '' && !isNaN(stored)) stored = Number(stored);
    if (stored === 'true') stored = true;
    if (stored === 'false') stored = false;
    if (s.key === 'editMaxFileSize' && (stored === 100 || stored === '100')) {
      stored = s.dflt;
      try { localStorage?.setItem('editMaxFileSize', String(s.dflt)); } catch {}
    }

    this.key = s.key;
    if (stored !== null) {
      this.value = stored;
    } else if (s.key === 'theme') {
      const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      this.value = prefersDark ? 'nord' : 'light';
    } else {
      this.value = s.dflt;
    }
    this.cb = s.cb;

    Object.defineProperty(stg, this.key, {
      get: () => this.value,
      set: (val) => {
        this.value = val;
        try { localStorage?.setItem(this.key, val); } catch {}
        this.cb?.(this.value);
      },
      configurable: true
    });
  }

  static set(key, val) { stg[key] = val; }
  static toggleActionBar() { stg.actionBar = stg.actionBar === false; }

  static init() {
    for (const s of Setting.list) if (!s.title) new Setting(s);
    Setting.setTheme();
  }

  static setTheme(themeName) {
    const activeTheme = themeName || globalThis.stg?.theme || 'light';
    if (typeof document !== 'undefined') {
      document.documentElement?.setAttribute('data-theme', activeTheme);
      document.body?.setAttribute('data-theme', activeTheme);
    }
  }

  static runAll() {
    for (const s of Setting.list) if (s.key && typeof s.cb === 'function') s.cb(stg[s.key]);
  }

  static resetDefault() {
    for (const s of Setting.list) if (s.key) stg[s.key] = s.dflt;
  }
}

Setting.list = [
  { title: 'Appearance' },
  { key: 'theme', dflt: 'nord', name: 'Theme', list: ['light', 'slate', 'dark', 'solarized', 'night', 'nord', 'dracula'], hide: true, cb: Setting.setTheme },
  { key: 'font', dflt: 13, name: 'Font Size', min: 7, max: 24, cb: n => {
    const b = typeof document !== 'undefined' ? document.body : null;
    if (b) {
      b.style.setProperty('--app-font-size', `${n}px`);
      b.style.fontSize = `${n}px`;
    }
  } },
  { key: 'rows', dflt: 25, name: 'Rows', min: 10, max: 60, cb: () => getSheet()?.reload?.() },
  { key: 'cols', dflt: 7, name: 'Cols', min: 3, max: 30, cb: () => getSheet()?.reload?.() },
  { key: 'actionBar', dflt: true, name: 'Action Bar', cb: b => {
    const header = typeof document !== 'undefined' && (document.getElementById('header') || document.querySelector('header'));
    if (header) {
      header.classList.toggle('hidden', !b);
      header.hidden = !b;
      header.style.display = b ? 'flex' : 'none';
    }
    getSheet()?.scrollbarRefresh?.();
  } },
  { key: 'purple', dflt: true, name: 'Warning color on line return, comma and double quote values', cb: () => getSheet()?.reload?.() },

  { title: 'Csv Save' },
  { key: 'encoding', dflt: 'utf-8', name: 'Encoding' },
  { key: 'delimiter', dflt: ',', name: 'Delimiter', list: [',', ';', 'TAB', '|'], hide: true },
  { key: 'save_fixed_width_size', dflt: 0, name: 'Minimum column size', min: 0, max: 100 },
  { key: 'save_strict', dflt: false, name: 'Save-Strict (error on comma  or double quotes)' },

  { title: 'Csv Open' },
  { key: 'set_headers', dflt: true, name: 'Set headers' },
  { key: 'trim', dflt: false, name: 'Remove empty rows and columns' },
  { key: 'trim_unquoted', dflt: true, name: 'Trim unquoted whitespace' },

  { title: 'Csv View Only' },
  { key: 'editMaxFileSize', dflt: 10, name: 'Max editable file size (Mo)', min: 1, max: Infinity, stepMode: 'pow2' },
  { key: 'vo_n_chunks', dflt: 8, name: 'Number of chunks loaded', min: 8, stepMode: 'pow2' },
  { key: 'vo_n_rows', dflt: 8, name: 'Number of rows per chunk loaded', min: 8, stepMode: 'pow2' },

  { title: 'Sort' },
  { key: 'sort_header', dflt: true, name: 'Ignore 1st row (header row)' },
  { key: 'sort_num_first', dflt: false, name: 'Numbers are sorted before text' },
];

Setting.map = new Map(Setting.list.filter(s => s.key).map(s => [s.key, s]));
Setting.getDef = (key) => Setting.map.get(key);

export { stg };

// --- Environment Detection & PWA State Manager ---

export const PWA_INSTALLED_KEY = 'nanocell_pwa_installed';

export function detectEnvironment(overrides = {}) {
  const win = overrides.window !== undefined ? overrides.window : (typeof window !== 'undefined' ? window : null);
  const nav = overrides.navigator !== undefined ? overrides.navigator : (typeof navigator !== 'undefined' ? navigator : null);
  const ua = typeof overrides.userAgent === 'string' ? overrides.userAgent : (nav?.userAgent || '');
  const uaData = overrides.userAgentData !== undefined ? overrides.userAgentData : nav?.userAgentData;
  const rawPlatform = typeof overrides.platform === 'string' ? overrides.platform : (uaData?.platform || nav?.platform || '');
  const touchPoints = typeof overrides.maxTouchPoints === 'number' ? overrides.maxTouchPoints : (nav?.maxTouchPoints || 0);

  let os = 'unknown', osLabel = '';
  if (/iPhone|iPad|iPod/i.test(ua) || /iPhone|iPad|iPod/i.test(rawPlatform) || ((/Mac/i.test(rawPlatform) || /Macintosh/i.test(ua)) && touchPoints > 1)) {
    os = 'ios'; osLabel = 'iOS';
  } else if (/Android/i.test(ua) || /Android/i.test(rawPlatform)) {
    os = 'android'; osLabel = 'Android';
  } else if (/CrOS/i.test(ua) || /Chrome OS|CrOS/i.test(rawPlatform)) {
    os = 'chromeos'; osLabel = 'ChromeOS';
  } else if (/Win/i.test(rawPlatform) || /Windows/i.test(ua)) {
    os = 'windows'; osLabel = /Windows NT 10\.0/i.test(ua) ? 'Windows 10/11' : 'Windows';
  } else if (/Mac/i.test(rawPlatform) || /Macintosh|Mac OS X/i.test(ua)) {
    os = 'macos'; osLabel = 'macOS';
  } else if (/Linux/i.test(rawPlatform) || /Linux/i.test(ua)) {
    os = 'linux'; osLabel = 'Linux';
  } else if (rawPlatform) {
    osLabel = rawPlatform;
  }

  const isMobile = os === 'ios' || os === 'android' || Boolean(uaData?.mobile) || /BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
  const isDesktop = !isMobile;
  const isMac = os === 'macos' || os === 'ios';

  let browser = 'unknown', browserName = 'Unknown Browser', browserVersion = '', isChromium = false;
  const ffMatch = ua.match(/(?:Firefox|FxiOS)\/([0-9.]+)/i);
  const edgeMatch = ua.match(/Edg(?:e|A|iOS)?\/([0-9.]+)/i);
  const operaMatch = ua.match(/(?:OPR|Opera)\/([0-9.]+)/i);
  const criosMatch = ua.match(/CriOS\/([0-9.]+)/i);
  const chromeMatch = ua.match(/(?:Chrome|Chromium)\/([0-9.]+)/i);

  if (ffMatch) {
    browser = 'firefox'; browserName = 'Firefox'; browserVersion = ffMatch[1];
  } else if (edgeMatch) {
    browser = 'edge'; browserName = 'Microsoft Edge'; browserVersion = edgeMatch[1];
    isChromium = !/EdgiOS/i.test(ua) && os !== 'ios';
  } else if (operaMatch) {
    browser = 'opera'; browserName = 'Opera'; browserVersion = operaMatch[1];
    isChromium = os !== 'ios';
  } else if (criosMatch) {
    browser = 'chrome'; browserName = 'Chrome'; browserVersion = criosMatch[1];
  } else if (Array.isArray(uaData?.brands)) {
    const validBrands = uaData.brands.filter(b => b?.brand && !/Not.*Brand/i.test(b.brand));
    if (validBrands.length > 0) {
      const preferred = validBrands.find(b => /Edge|Opera|Brave|Vivaldi|Chrome/i.test(b.brand)) || validBrands[0];
      const bName = preferred.brand;
      browserVersion = preferred.version || (chromeMatch ? chromeMatch[1] : '');
      isChromium = os !== 'ios';
      if (/Edge/i.test(bName)) { browser = 'edge'; browserName = 'Microsoft Edge'; }
      else if (/Opera/i.test(bName)) { browser = 'opera'; browserName = 'Opera'; }
      else if (/Brave/i.test(bName)) { browser = 'chrome'; browserName = 'Brave'; }
      else if (/Vivaldi/i.test(bName)) { browser = 'chrome'; browserName = 'Vivaldi'; }
      else { browser = 'chrome'; browserName = bName === 'Google Chrome' ? 'Chrome' : bName; }
    }
  }

  if (browser === 'unknown') {
    if (chromeMatch) {
      browser = 'chrome';
      browserName = /Chromium\//i.test(ua) && !/Chrome\//i.test(ua) ? 'Chromium' : 'Chrome';
      browserVersion = chromeMatch[1];
      isChromium = os !== 'ios';
    } else if (/Safari\/([0-9.]+)/i.test(ua) && !/Chrome|CriOS|FxiOS|Edg|OPR|Android/i.test(ua)) {
      const verMatch = ua.match(/Version\/([0-9.]+)/i) || ua.match(/Safari\/([0-9.]+)/i);
      browser = 'safari'; browserName = 'Safari'; browserVersion = verMatch ? verMatch[1] : '';
    }
  }

  const browserInfo = browser !== 'unknown'
    ? `${browserName}${browserVersion ? ` ${browserVersion}` : ''}${osLabel ? ` (${osLabel})` : ''}`.trim()
    : (ua || 'Unknown');

  const supportsFileSystemAccess = Boolean(win && typeof win.showOpenFilePicker === 'function' && typeof win.showSaveFilePicker === 'function');
  const supportsPwaInstall = Boolean(isDesktop && isChromium);

  return {
    os, osLabel, browser, browserName, browserVersion, browserInfo,
    userAgent: ua, isMobile, isDesktop, isMac, isChromium,
    supportsFileSystemAccess, supportsPwaInstall
  };
}

export const env = detectEnvironment();

export function formatShortcut(c) {
  if (!c?.k) return '';
  const mod = env.isMac ? '⌘' : 'Ctrl+';
  const shift = env.isMac ? '⇧' : 'Shift+';
  const alt = env.isMac ? '⌥' : 'Alt+';
  return `${c.ctrl ? mod : ''}${c.alt ? alt : ''}${c.shift ? shift : ''}${c.k}`;
}

export function getNewIssueUrl(appVersion, customEnv = env) {
  const version = appVersion || (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v1.0.1-dev');
  const body = `### Environment
- **App Version:** \`${version}\`
- **Browser / OS:** ${customEnv.browserInfo}
- **User Agent:** \`${customEnv.userAgent}\`

---

### Description
<!-- Please describe the issue or unexpected behavior below -->
`;
  return `https://github.com/CedricBonjour/nanocell-csv/issues/new?body=${encodeURIComponent(body)}`;
}

export function createPwaManager(options = {}) {
  const win = options.window !== undefined ? options.window : (typeof window !== 'undefined' ? window : null);
  const nav = options.navigator !== undefined ? options.navigator : (typeof navigator !== 'undefined' ? navigator : null);
  let storage = options.storage;
  if (storage === undefined) {
    try { storage = win?.localStorage || null; } catch { storage = null; }
  }
  const currentEnv = options.env || detectEnvironment({ window: win, navigator: nav });

  const readStorageInstalled = () => {
    try { return storage?.getItem(PWA_INSTALLED_KEY) === 'true'; } catch { return false; }
  };

  const writeStorageInstalled = (installed) => {
    try {
      if (!storage) return;
      if (installed) storage.setItem(PWA_INSTALLED_KEY, 'true');
      else storage.removeItem(PWA_INSTALLED_KEY);
    } catch {}
  };

  const checkStandalone = () => {
    try {
      return Boolean(win?.matchMedia?.('(display-mode: standalone)').matches || nav?.standalone === true);
    } catch { return false; }
  };

  let isStandalone = checkStandalone();
  let storageInstalled = readStorageInstalled();
  let deferredPrompt = null;
  let authoritativeState = isStandalone ? 'installed' : 'unknown';

  if (isStandalone && !storageInstalled) {
    storageInstalled = true;
    writeStorageInstalled(true);
  }

  const subscribers = new Set();

  function getState() {
    const isInstalled = isStandalone || authoritativeState === 'installed' || (authoritativeState === 'unknown' && storageInstalled);
    let status;
    if (isStandalone) status = 'standalone';
    else if (isInstalled) status = 'installed';
    else if (currentEnv.isMobile) status = 'unsupported-mobile';
    else if (!currentEnv.supportsPwaInstall) status = 'unsupported-browser';
    else if (deferredPrompt !== null) status = 'installable-prompt';
    else status = 'installable-manual';

    const canInstall = status === 'installable-prompt' || status === 'installable-manual';
    return { status, isStandalone, isInstalled, canInstall, hasPrompt: status === 'installable-prompt', env: currentEnv };
  }

  let prevSnapshot = getState();

  function notify() {
    const next = getState();
    if (
      next.status === prevSnapshot.status &&
      next.isStandalone === prevSnapshot.isStandalone &&
      next.isInstalled === prevSnapshot.isInstalled &&
      next.canInstall === prevSnapshot.canInstall &&
      next.hasPrompt === prevSnapshot.hasPrompt
    ) return;
    prevSnapshot = next;
    for (const listener of subscribers) {
      try { listener(next); } catch (err) { console.error('PWA subscriber error:', err); }
    }
  }

  const onBeforeInstallPrompt = (e) => {
    e?.preventDefault?.();
    deferredPrompt = e;
    authoritativeState = 'not-installed';
    storageInstalled = false;
    writeStorageInstalled(false);
    notify();
  };

  const onAppInstalled = () => {
    deferredPrompt = null;
    authoritativeState = 'installed';
    storageInstalled = true;
    writeStorageInstalled(true);
    notify();
  };

  const onStorage = (e) => {
    if (e && e.key !== null && e.key !== undefined && e.key !== PWA_INSTALLED_KEY) return;
    const nextVal = e?.key === PWA_INSTALLED_KEY ? e.newValue === 'true' : readStorageInstalled();
    storageInstalled = nextVal;
    if (nextVal) {
      authoritativeState = 'installed';
      deferredPrompt = null;
    } else if (!isStandalone && deferredPrompt === null) {
      authoritativeState = 'not-installed';
    }
    notify();
  };

  const onDisplayModeChange = (e) => {
    isStandalone = Boolean(e?.matches || checkStandalone());
    if (isStandalone) {
      authoritativeState = 'installed';
      storageInstalled = true;
      writeStorageInstalled(true);
    }
    notify();
  };

  let mql = null;
  if (typeof win?.addEventListener === 'function') {
    win.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    win.addEventListener('appinstalled', onAppInstalled);
    win.addEventListener('storage', onStorage);
    try {
      mql = win.matchMedia?.('(display-mode: standalone)');
      mql?.addEventListener?.('change', onDisplayModeChange);
    } catch {}
  }

  async function checkRelatedApps() {
    if (isStandalone || typeof nav?.getInstalledRelatedApps !== 'function') return getState();
    try {
      const apps = await nav.getInstalledRelatedApps();
      if (Array.isArray(apps) && apps.length > 0 && authoritativeState !== 'not-installed') {
        authoritativeState = 'installed';
        storageInstalled = true;
        writeStorageInstalled(true);
        notify();
      }
    } catch {}
    return getState();
  }

  checkRelatedApps();

  function subscribe(listener, opts = { immediate: true }) {
    if (typeof listener !== 'function') return () => {};
    subscribers.add(listener);
    if (opts?.immediate !== false) listener(getState());
    return () => subscribers.delete(listener);
  }

  async function promptInstall() {
    const current = getState();
    if (current.isStandalone || current.isInstalled) return 'already-installed';
    if (!current.canInstall) return 'unsupported';
    if (!deferredPrompt) return 'manual';

    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    notify();

    try {
      const promptRes = typeof promptEvent.prompt === 'function' ? await promptEvent.prompt() : null;
      let outcome = typeof promptRes?.outcome === 'string' ? promptRes.outcome : null;
      if (!outcome && promptEvent.userChoice) {
        outcome = (await promptEvent.userChoice)?.outcome || null;
      }
      if (outcome === 'accepted') {
        authoritativeState = 'installed';
        storageInstalled = true;
        writeStorageInstalled(true);
        notify();
        return 'accepted';
      }
    } catch {}

    notify();
    return 'dismissed';
  }

  function destroy() {
    subscribers.clear();
    if (typeof win?.removeEventListener === 'function') {
      win.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      win.removeEventListener('appinstalled', onAppInstalled);
      win.removeEventListener('storage', onStorage);
    }
    mql?.removeEventListener?.('change', onDisplayModeChange);
  }

  return { getState, subscribe, promptInstall, checkRelatedApps, destroy };
}

export const pwa = createPwaManager({ env });
