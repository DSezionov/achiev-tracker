// Дрібні допоміжні функції без залежностей від стану застосунку.

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Короткий випадковий ідентифікатор: uid('g') → "g_k3j9x2". */
export function uid(prefix, length = 6) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `${prefix}_${id}`;
}

const dateFormatter = new Intl.DateTimeFormat('uk-UA', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** ISO-рядок → «7 листопада 2026 р.». Порожній рядок, якщо дата некоректна. */
export function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return dateFormatter.format(date);
}

/** Локальна дата у форматі YYYY-MM-DD (для назв файлів). */
export function todayStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** Відкладений виклик. Має методи flush() і cancel(). */
export function debounce(fn, wait) {
  let timer = null;
  let lastArgs = null;
  const debounced = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...lastArgs);
    }, wait);
  };
  debounced.flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    fn(...lastArgs);
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  debounced.pending = () => timer !== null;
  return debounced;
}

/**
 * Створює DOM-елемент. Текст завжди потрапляє через textContent / text-вузли,
 * тому користувацькі дані безпечно передавати як дочірні елементи.
 *
 * el('button', { class: 'btn', onclick: fn, 'aria-label': 'Закрити' }, 'Текст')
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  let value;
  let checked;
  for (const [key, val] of Object.entries(attrs || {})) {
    if (val == null || val === false) continue;
    if (key === 'class') node.className = val;
    else if (key === 'text') node.textContent = val;
    else if (key === 'dataset') Object.assign(node.dataset, val);
    else if (key === 'style') {
      for (const [prop, propValue] of Object.entries(val)) node.style.setProperty(prop, propValue);
    } else if (key === 'value') value = val;
    else if (key === 'checked') checked = val;
    else if (key.startsWith('on') && typeof val === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (val === true) node.setAttribute(key, '');
    else node.setAttribute(key, val);
  }
  append(node, children);
  if (value !== undefined) node.value = value;
  if (checked !== undefined) node.checked = Boolean(checked);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
}

/** Повертає URL лише якщо це http(s), інакше порожній рядок. */
export function safeUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return '';
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

/** Повертає колір у форматі #rrggbb або запасний варіант. */
export function safeColor(color, fallback = '#7c9cff') {
  if (typeof color !== 'string') return fallback;
  const value = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  return fallback;
}

/** Чорний або білий текст поверх кольору — що контрастніше. */
export function readableTextColor(hex) {
  const color = safeColor(hex);
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  // Порівнюємо контраст з білим (1.0) і чорним (0.0).
  return (1.05 / (luminance + 0.05)) >= ((luminance + 0.05) / 0.05) ? '#ffffff' : '#0b0d12';
}

/** Пропонує браузеру зберегти текстовий файл. */
export function downloadFile(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename, hidden: true });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Текст для пошуку: без урахування регістру й розділових знаків,
 * щоб «stalker» знаходив «S.T.A.L.K.E.R.», а «марти» — «Марти».
 */
export function normalizeForSearch(text) {
  return String(text ?? '')
    .toLocaleLowerCase('uk-UA')
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Відмінювання: plural(5, ['досягнення', 'досягнення', 'досягнень']). */
export function plural(n, [one, few, many]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Посилання на гру в Steam (магазин або спільнота) → URL обкладинки з Steam CDN.
 * Порожній рядок, якщо це не посилання на гру в Steam.
 */
export function steamCoverUrl(url) {
  const match = String(url || '').match(/(?:store\.steampowered\.com|steamcommunity\.com)\/(?:[^?#]*?\/)?(?:app|stats)\/(\d+)/i);
  return match ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${match[1]}/header.jpg` : '';
}
