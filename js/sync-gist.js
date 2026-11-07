// Синхронізація з секретним GitHub Gist.
// localStorage лишається джерелом правди: помилки мережі лише змінюють статус.
// Локальні дані й дані з Gist об'єднуються (mergeStates): зміни з обох
// пристроїв зберігаються на рівні окремих досягнень.

import { getState, subscribe, replaceState, saveBackup, migrate, mergeStates, sameContent } from './store.js';
import { debounce } from './utils.js';

const CONFIG_KEY = 'achievement-tracker:gist';
const API = 'https://api.github.com';
const FILE_NAME = 'achievements.json';
export const GIST_DESCRIPTION = 'achievement-tracker-data';
const PUSH_DELAY = 2000;
const FOCUS_CHECK_INTERVAL = 30 * 1000;
const POLL_INTERVAL = 2 * 60 * 1000;

/** 'off' | 'syncing' | 'ok' | 'offline' | 'error' */
let status = 'off';
let lastError = '';
let running = null;
let rerun = false;
let lastCheck = 0;
const statusListeners = new Set();

export const STATUS_LABELS = {
  off: 'Синхронізацію вимкнено',
  syncing: 'Синхронізація…',
  ok: 'Синхронізовано',
  offline: 'Офлайн',
  error: 'Помилка',
};

// ---------- Конфігурація (лише в localStorage цього браузера) ----------

export function getConfig() {
  try {
    const config = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    return config && config.token && config.gistId ? config : null;
  } catch {
    return null;
  }
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

// ---------- Статус ----------

export function getStatus() {
  return { status, label: STATUS_LABELS[status], error: lastError, config: getConfig() };
}

export function onStatusChange(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function setStatus(next, error = '') {
  status = next;
  lastError = error;
  for (const listener of statusListeners) listener(getStatus());
}

// ---------- GitHub API ----------

export class SyncError extends Error {
  constructor(message, { status: httpStatus = 0, offline = false } = {}) {
    super(message);
    this.status = httpStatus;
    this.offline = offline;
  }
}

async function request(path, token, { method = 'GET', body, keepalive = false } = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      keepalive,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncError('Немає з’єднання з GitHub', { offline: true });
  }
  if (!response.ok) throw new SyncError(httpErrorMessage(response), { status: response.status });
  return response.json();
}

function httpErrorMessage(response) {
  switch (response.status) {
    case 401:
      return 'Токен недійсний або прострочений';
    case 403:
      return response.headers.get('x-ratelimit-remaining') === '0'
        ? 'Перевищено ліміт запитів до GitHub, спробуйте пізніше'
        : 'Немає доступу: у токена має бути право gist';
    case 404:
      return 'Gist не знайдено (перевірте ID і токен)';
    default:
      return `GitHub відповів помилкою ${response.status}`;
  }
}

/** Повертає дані з Gist (вже після migrate) або null, якщо файлу ще немає. */
async function readGistState(gist) {
  const file = gist.files?.[FILE_NAME];
  if (!file) return null;
  let content = file.content;
  // Файли понад ~1 МБ API віддає обрізаними — дочитуємо через raw_url.
  if (file.truncated) {
    try {
      const raw = await fetch(file.raw_url, { cache: 'no-store' });
      if (!raw.ok) throw new Error();
      content = await raw.text();
    } catch {
      throw new SyncError('Не вдалося завантажити великий файл з Gist', { offline: !navigator.onLine });
    }
  }
  if (!content || !content.trim()) return null;
  try {
    return migrate(JSON.parse(content));
  } catch (error) {
    throw new SyncError(`Дані в Gist пошкоджені: ${error.message}`);
  }
}

const serialize = (state) => JSON.stringify(state, null, 2);

async function fetchGist(config) {
  const gist = await request(`/gists/${encodeURIComponent(config.gistId)}`, config.token);
  return { gist, remote: await readGistState(gist) };
}

/** keepalive дозволяє запиту завершитися, навіть якщо сторінку закривають (до 64 КБ). */
const KEEPALIVE_LIMIT = 60 * 1024;

async function pushGist(config, state, { keepalive = false } = {}) {
  const content = keepalive ? JSON.stringify(state) : serialize(state);
  const body = { files: { [FILE_NAME]: { content } } };
  await request(`/gists/${encodeURIComponent(config.gistId)}`, config.token, {
    method: 'PATCH',
    body,
    keepalive: keepalive && JSON.stringify(body).length < KEEPALIVE_LIMIT,
  });
}

/** Шукає Gist за описом серед Gist'ів власника токена. */
async function findGist(token) {
  for (let page = 1; page <= 10; page += 1) {
    const gists = await request(`/gists?per_page=100&page=${page}`, token);
    const found = gists.find((g) => g.description === GIST_DESCRIPTION && g.files?.[FILE_NAME]);
    if (found) return found;
    if (gists.length < 100) return null;
  }
  return null;
}

async function createGist(token, state) {
  return request('/gists', token, {
    method: 'POST',
    body: {
      description: GIST_DESCRIPTION,
      public: false,
      files: { [FILE_NAME]: { content: serialize(state) } },
    },
  });
}

// ---------- Підключення ----------

/**
 * Підключає синхронізацію. Якщо Gist новий — одразу відправляє в нього дані.
 * Якщо знайдено наявний — повертає { pending, remote }: конфіг ще не збережено,
 * поки UI не спитає, чиї дані взяти (resolveInitial), щоб фонова синхронізація
 * не встигла нічого перезаписати.
 */
export async function connect({ token, gistId }) {
  token = token.trim();
  gistId = (gistId || '').trim().replace(/^.*\//, '');
  if (!token) throw new SyncError('Вставте токен');

  const gist = gistId
    ? await request(`/gists/${encodeURIComponent(gistId)}`, token)
    : await findGist(token);

  if (!gist) {
    const created = await createGist(token, getState());
    saveConfig({ token, gistId: created.id, htmlUrl: created.html_url });
    setStatus('ok');
    return { created: true, pending: null, remote: null };
  }

  const remote = await readGistState(gist);
  return { created: false, pending: { token, gistId: gist.id, htmlUrl: gist.html_url }, remote };
}

/**
 * Завершує підключення до наявного Gist:
 *   'merge' — об'єднати локальні дані з даними з Gist;
 *   'pull'  — замінити локальні даними з Gist (локальні — в резервну копію);
 *   'push'  — замінити дані в Gist локальними.
 */
export async function resolveInitial(direction, pending, remote) {
  saveConfig(pending);
  setStatus('syncing');
  try {
    if (direction === 'pull' && remote) {
      applyRemote(remote, 'Перед завантаженням даних з Gist');
    } else if (direction === 'push' || !remote) {
      await pushGist(getConfig(), getState());
    } else {
      await reconcile(getConfig(), remote);
    }
    setStatus('ok');
  } catch (error) {
    fail(error);
    throw error;
  }
}

export function disconnect() {
  localStorage.removeItem(CONFIG_KEY);
  schedulePush.cancel();
  setStatus('off');
}

// ---------- Синхронізація ----------

function applyRemote(remote, reason) {
  if (getState().games.length) saveBackup(getState(), reason);
  replaceState(remote, { source: 'remote', keepUpdatedAt: true });
}

/** Звіряє локальні дані з Gist і переносить зміни в обидва боки. */
export function syncNow() {
  if (!getConfig()) return Promise.resolve();
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      await syncOnce();
    } while (rerun);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Об'єднує локальний стан з remote: оновлює локальні дані і/або Gist, якщо треба. */
async function reconcile(config, remote) {
  const local = getState();
  if (!remote) {
    await pushGist(config, local);
    return;
  }
  const merged = mergeStates(local, remote);
  if (!sameContent(merged, local)) {
    applyRemote(merged, 'Перед об’єднанням із даними з Gist');
  }
  if (!sameContent(merged, remote)) {
    await pushGist(config, getState());
  }
}

async function syncOnce() {
  const config = getConfig();
  if (!config) return;
  if (!navigator.onLine) {
    setStatus('offline');
    return;
  }
  setStatus('syncing');
  lastCheck = Date.now();
  try {
    const { remote } = await fetchGist(config);
    await reconcile(config, remote);
    setStatus('ok');
  } catch (error) {
    fail(error);
  }
}

/**
 * Сторінку ховають (заблокували телефон, перемкнули вкладку): відправляємо
 * локальні зміни одразу, не чекаючи debounce. Без попереднього читання Gist —
 * інший пристрій усе одно об'єднає свої зміни під час наступної синхронізації.
 */
function pushBeforeHide() {
  const config = getConfig();
  if (!config || !schedulePush.pending()) return;
  schedulePush.cancel();
  pushGist(config, getState(), { keepalive: true }).catch(() => {
    /* не встигли — відправимо під час наступного відкриття */
  });
}

function fail(error) {
  if (error instanceof SyncError && error.offline) setStatus('offline', error.message);
  else setStatus('error', error.message || 'Невідома помилка');
}

const schedulePush = debounce(() => syncNow(), PUSH_DELAY);

// ---------- Запуск ----------

let started = false;

export function startSync() {
  if (started) return;
  started = true;

  subscribe(({ source }) => {
    if (source === 'remote' || source === 'storage-error' || !getConfig()) return;
    setStatus('syncing');
    schedulePush();
  });

  window.addEventListener('online', () => getConfig() && syncNow());
  window.addEventListener('offline', () => getConfig() && setStatus('offline'));

  // Повернулися у вкладку — перевіряємо, чи не змінились дані на іншому пристрої.
  const checkIfStale = () => {
    if (!getConfig() || document.visibilityState !== 'visible') return;
    if (Date.now() - lastCheck < FOCUS_CHECK_INTERVAL) return;
    if (schedulePush.pending()) return;
    syncNow();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pushBeforeHide();
    else checkIfStale();
  });
  window.addEventListener('focus', checkIfStale);
  setInterval(() => {
    if (Date.now() - lastCheck >= POLL_INTERVAL) checkIfStale();
  }, POLL_INTERVAL);

  window.addEventListener('pagehide', pushBeforeHide);

  if (getConfig()) syncNow();
}
