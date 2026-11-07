// Точка входу: завантаження стану, hash-роутер, шапка, синхронізація, service worker.

import { load, subscribe } from './store.js';
import { icon, toast, applyTheme, getTheme, setTheme } from './ui.js';
import { startSync, onStatusChange, getStatus } from './sync-gist.js';
import { renderHome } from './views/home.js';
import { renderGame } from './views/game.js';
import { renderEditor } from './views/editor.js';
import { renderSettings } from './views/settings.js';
import { renderStats } from './views/stats.js';

const ROUTES = [
  { pattern: /^\/$/, view: renderHome },
  { pattern: /^\/game\/([\w-]+)\/edit$/, view: renderEditor, params: ['id'] },
  { pattern: /^\/game\/([\w-]+)$/, view: renderGame, params: ['id'] },
  { pattern: /^\/settings$/, view: renderSettings },
  { pattern: /^\/stats$/, view: renderStats },
];

const root = document.getElementById('app');
let cleanup = null;
let previousPath = null;

function parseHash() {
  const path = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function route() {
  const path = parseHash();
  if (path === previousPath) return;

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;

  for (const { pattern, view, params = [] } of ROUTES) {
    const match = path.match(pattern);
    if (!match) continue;
    const args = Object.fromEntries(params.map((name, i) => [name, match[i + 1]]));
    previousPath = path;
    try {
      cleanup = view(root, args);
    } catch (error) {
      console.error(error);
      root.textContent = 'Сталася помилка. Спробуйте оновити сторінку.';
    }
    window.scrollTo(0, 0);
    root.focus({ preventScroll: true });
    updateNav(path);
    return;
  }

  // Невідомий маршрут — на головну.
  previousPath = null;
  location.replace('#/');
}

function updateNav(path) {
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.getAttribute('href') === `#${path}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

// ---------- Шапка ----------

function setupThemeToggle() {
  const button = document.getElementById('theme-toggle');
  const render = () => {
    const theme = getTheme();
    const label = theme === 'dark' ? 'Увімкнути світлу тему' : 'Увімкнути темну тему';
    button.replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'));
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  button.addEventListener('click', () => {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  });
  window.addEventListener('themechange', render);
  render();
}

function setupSyncIndicator() {
  const indicator = document.getElementById('sync-status');
  const render = ({ status, label, error }) => {
    indicator.hidden = status === 'off';
    indicator.dataset.status = status;
    indicator.title = error ? `${label}: ${error}` : label;
    indicator.querySelector('.sync-status__label').textContent = label;
  };
  onStatusChange(render);
  render(getStatus());
}

function setupSkipLink() {
  // Звичайне посилання #app зламало б hash-роутер, тому фокус переводимо вручну.
  document.querySelector('.skip-link').addEventListener('click', (event) => {
    event.preventDefault();
    root.focus();
  });
}

function setupHeaderIcons() {
  document.getElementById('settings-link').prepend(icon('settings'));
  document.querySelector('.brand__icon').replaceChildren(icon('trophy'));
}

// ---------- Запуск ----------

load();
applyTheme();
setupSkipLink();
setupHeaderIcons();
setupThemeToggle();
setupSyncIndicator();

subscribe(({ source }) => {
  if (source === 'storage-error') {
    toast('Не вдалося зберегти дані: сховище браузера переповнене або недоступне', { type: 'error', duration: 8000 });
  }
});

window.addEventListener('hashchange', route);
route();
startSync();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service worker не зареєстровано', error));
  });
}
