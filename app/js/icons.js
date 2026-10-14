let iconModules = {};
try {
  iconModules = import.meta.glob('../icons/*.svg', {
    eager: true,
    import: 'default'
  });
} catch {}

const iconMap = new Map();

for (const [path, url] of Object.entries(iconModules)) {
  const rel = path.replace(/^\.\.\/icons\//, '');
  const name = rel.replace(/\.svg$/, '');
  iconMap.set(rel, url);
  iconMap.set(name, url);
  iconMap.set(`icn/${rel}`, url);
  iconMap.set(`icn/${name}`, url);
  iconMap.set(`/app/icn/${rel}`, url);
}

if (iconMap.has('on')) {
  iconMap.set('check', iconMap.get('on'));
  iconMap.set('accept', iconMap.get('on'));
}
if (iconMap.has('off')) {
  iconMap.set('cross', iconMap.get('off'));
  iconMap.set('reject', iconMap.get('off'));
  iconMap.set('close', iconMap.get('off'));
}

export function getIconUrl(name) {
  if (!name) return '';
  let clean = name.trim().replace(/^url\(["']?|["']?\)$/g, '');
  if (iconMap.has(clean)) return iconMap.get(clean);
  clean = clean.replace(/^\/?(app\/)?/, '');
  if (iconMap.has(clean)) return iconMap.get(clean);
  const withoutExt = clean.replace(/\.svg$/, '');
  if (iconMap.has(withoutExt)) return iconMap.get(withoutExt);
  return iconMap.get(name) || name;
}

export function setIcon(element, iconName) {
  if (!element?.style) return;
  const url = getIconUrl(iconName);
  if (url) {
    element.style.setProperty('--icon-url', `url("${url}")`);
    if (element.dataset) element.dataset.icon = iconName;
  }
}

export function escapeHtml(str) {
  if (typeof str !== 'string') str = String(str ?? '');
  if (!/[&<>"']/.test(str)) return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export { iconMap };
