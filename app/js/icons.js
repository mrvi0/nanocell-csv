let iconModules = {};
try {
  iconModules = import.meta.glob('../icons/*.svg', {
    eager: true,
    import: 'default'
  });
} catch {}

const iconMap = new Map();

for (const [path, url] of Object.entries(iconModules)) {
  const filename = path.replace(/^\.\.\/icons\//, '');
  const iconName = filename.replace(/\.svg$/, '');
  iconMap.set(filename, url);
  iconMap.set(iconName, url);
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

export function getIconUrl(iconName) {
  if (!iconName) return '';
  let normalized = iconName.trim().replace(/^url\(["']?|["']?\)$/g, '');
  if (iconMap.has(normalized)) return iconMap.get(normalized);
  normalized = normalized.replace(/^\/?(app\/)?(icons\/)?/, '');
  if (iconMap.has(normalized)) return iconMap.get(normalized);
  const withoutExt = normalized.replace(/\.svg$/, '');
  if (iconMap.has(withoutExt)) return iconMap.get(withoutExt);
  return iconMap.get(iconName) || iconName;
}

export function setIcon(element, iconName) {
  if (!element?.style) return;
  const url = getIconUrl(iconName);
  if (url) {
    element.style.setProperty('--icon-url', `url("${url}")`);
    if (element.dataset) element.dataset.icon = iconName;
  }
}

export function escapeHtml(text) {
  if (typeof text !== 'string') text = String(text ?? '');
  if (!/[&<>"']/.test(text)) return text;
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export { iconMap };
