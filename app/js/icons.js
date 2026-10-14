export const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export function defineEl(tag, cls) {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, cls);
  }
}

let iconModules = {};
try {
  iconModules = import.meta.glob('../icons/*.svg', { eager: true, import: 'default' });
} catch {}

export const iconMap = new Map();
for (const [path, url] of Object.entries(iconModules)) {
  const filename = path.replace(/^\.\.\/icons\//, '');
  iconMap.set(filename, url);
  iconMap.set(filename.replace(/\.svg$/, ''), url);
}

export function getIconUrl(iconName) {
  if (!iconName) return '';
  return iconMap.get(iconName) || iconMap.get(iconName.replace(/\.svg$/, '')) || iconName;
}

export function setIcon(element, iconName) {
  if (!element?.style) return;
  const url = getIconUrl(iconName);
  if (url) {
    element.style.setProperty('--icon-url', `url("${url}")`);
    if (element.dataset) element.dataset.icon = iconName;
  }
}

export function hydrateIcons(root) {
  if (!root?.querySelectorAll) return;
  for (const el of root.querySelectorAll('[data-icon]')) setIcon(el, el.dataset.icon);
}

export function setOpen(el, open, display = 'block') {
  if (!el) return;
  el.classList?.toggle('open', open);
  el.classList?.toggle('visible', open);
  if (open) {
    el.setAttribute?.('open', '');
    el.removeAttribute?.('hidden');
    if (el.style) el.style.display = display;
  } else {
    el.removeAttribute?.('open');
    el.setAttribute?.('hidden', '');
    if (el.style) el.style.display = 'none';
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
