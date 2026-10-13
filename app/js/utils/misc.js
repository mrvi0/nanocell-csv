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
