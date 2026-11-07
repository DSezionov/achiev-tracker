// Стан застосунку: завантаження, міграції, збереження в localStorage і події змін.
// Усі зміни даних проходять через update(), який оновлює updatedAt і зберігає стан.
//
// Для синхронізації кожна гра, розділ і досягнення мають власний updatedAt,
// а видалені id записуються в deleted (tombstones). Це дозволяє об'єднувати
// зміни з різних пристроїв на рівні окремих досягнень (mergeStates).

import { uid, safeColor } from './utils.js';

export const STORAGE_KEY = 'achievement-tracker:v1';
export const BACKUP_KEY = 'achievement-tracker:backup';
export const PREFS_KEY = 'achievement-tracker:prefs';
export const SCHEMA_VERSION = 2;
export const DEFAULT_SECTION_TITLE = 'Загальне';
export const DEFAULT_ACCENT = '#7c9cff';
export const GAME_STATUSES = {
  playing: 'Граю',
  completed: 'Пройдено',
  paused: 'Відкладено',
  dropped: 'Покинуто',
};
/** Скільки днів пам'ятати видалені id. */
const TOMBSTONE_TTL_DAYS = 180;

let state = null;
const listeners = new Set();

// ---------- Годинник ----------
// Гібридний логічний годинник: позначки часу не йдуть назад, навіть якщо
// годинник цього пристрою відстає від пристрою, з якого прийшли дані.

let clock = 0;

/** Позначка часу для updatedAt: не менша за будь-яку вже бачену. */
export function stamp() {
  clock = Math.max(Date.now(), clock + 1);
  return new Date(clock).toISOString();
}

function observe(iso) {
  const time = iso ? Date.parse(iso) : NaN;
  if (!Number.isNaN(time) && time > clock) clock = time;
}

function observeState(data) {
  observe(data.updatedAt);
  observe(data.orderUpdatedAt);
  for (const game of data.games) {
    observe(game.updatedAt);
    for (const section of game.sections) {
      observe(section.updatedAt);
      for (const ach of section.achievements) observe(ach.updatedAt);
    }
  }
}

const time = (iso) => (iso ? Date.parse(iso) || 0 : 0);
const latest = (...values) => values.reduce((a, b) => (time(b) > time(a) ? b : a), null);

// ---------- Модель ----------

/** updatedAt = null означає «ще нічого не змінювали» (програє будь-якій синхронізації). */
export function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: null, orderUpdatedAt: null, deleted: {}, games: [] };
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const isoOrNull = (value) => {
  if (typeof value !== 'string') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
};
const validId = (value, prefix) =>
  typeof value === 'string' && value.startsWith(`${prefix}_`) && value.length <= 40;
const toInt = (value) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : NaN;
};

/** { current, target } або null. Ціль 2..1 000 000. */
export function normalizeCounter(input) {
  if (!input || typeof input !== 'object') return null;
  const target = toInt(input.target);
  if (!(target >= 2 && target <= 1_000_000)) return null;
  const current = toInt(input.current);
  return { current: current >= 0 ? Math.min(current, target) : 0, target };
}

export function normalizeAchievement(input, { freshIds = false, now = null } = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const done = raw.done === true;
  return {
    id: !freshIds && validId(raw.id, 'a') ? raw.id : uid('a'),
    name: text(raw.name) || 'Без назви',
    condition: text(raw.condition),
    tip: text(raw.tip),
    note: text(raw.note),
    missable: raw.missable === true,
    spoiler: raw.spoiler === true,
    focus: raw.focus === true,
    counter: normalizeCounter(raw.counter),
    done,
    doneAt: done ? isoOrNull(raw.doneAt) : null,
    updatedAt: now || isoOrNull(raw.updatedAt),
  };
}

export function normalizeSection(input, options = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    id: !options.freshIds && validId(raw.id, 's') ? raw.id : uid('s'),
    title: text(raw.title) || DEFAULT_SECTION_TITLE,
    checkpoint: raw.checkpoint === true,
    achievements: Array.isArray(raw.achievements)
      ? raw.achievements.map((a) => normalizeAchievement(a, options))
      : [],
    updatedAt: options.now || isoOrNull(raw.updatedAt),
  };
}

/**
 * Приводить об'єкт гри до схеми. Відсутні id генеруються, зайві поля відкидаються.
 * Для зручності імпорту приймає і гру з масивом achievements без розділів.
 * options.now — проставити цей updatedAt усім елементам (нові дані).
 */
export function normalizeGame(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Гра має бути об’єктом');
  }
  const title = text(input.title);
  if (!title) throw new Error('У гри немає назви (поле title)');

  let sections = Array.isArray(input.sections)
    ? input.sections.map((s) => normalizeSection(s, options))
    : [];
  if (!sections.length && Array.isArray(input.achievements)) {
    sections = [normalizeSection({ achievements: input.achievements }, options)];
  }
  if (!sections.length) sections = [normalizeSection({}, options)];

  // id розділів і досягнень мають бути унікальними в межах гри.
  const seen = new Set();
  for (const section of sections) {
    if (seen.has(section.id)) section.id = uid('s');
    seen.add(section.id);
    for (const ach of section.achievements) {
      if (seen.has(ach.id)) ach.id = uid('a');
      seen.add(ach.id);
    }
  }

  return {
    id: !options.freshIds && validId(input.id, 'g') ? input.id : uid('g'),
    title,
    platform: text(input.platform),
    accent: safeColor(input.accent, DEFAULT_ACCENT),
    coverUrl: text(input.coverUrl),
    guideUrl: text(input.guideUrl),
    notes: text(input.notes),
    status: input.status in GAME_STATUSES ? input.status : 'playing',
    archived: input.archived === true,
    createdAt: isoOrNull(input.createdAt) || new Date().toISOString(),
    updatedAt: options.now || isoOrNull(input.updatedAt),
    sections,
  };
}

/** Заповнює порожні updatedAt (дані з v1 або написані вручну). */
function fillTimestamps(data) {
  const fallback = data.updatedAt || new Date(0).toISOString();
  for (const game of data.games) {
    game.updatedAt ||= fallback;
    for (const section of game.sections) {
      section.updatedAt ||= game.updatedAt;
      for (const ach of section.achievements) {
        ach.updatedAt ||= latest(ach.doneAt, section.updatedAt) || section.updatedAt;
      }
    }
  }
  data.orderUpdatedAt ||= fallback;
}

function normalizeTombstones(input) {
  const result = {};
  if (!input || typeof input !== 'object') return result;
  const cutoff = Date.now() - TOMBSTONE_TTL_DAYS * 24 * 60 * 60 * 1000;
  for (const [id, at] of Object.entries(input)) {
    if (typeof id === 'string' && isoOrNull(at) && Date.parse(at) >= cutoff) result[id] = at;
  }
  return result;
}

/**
 * Приводить збережені або імпортовані дані до поточної схеми.
 * При зміні схеми: збільшити SCHEMA_VERSION і дописати крок у MIGRATIONS.
 */
const MIGRATIONS = {
  // 0 → 1: дані без schemaVersion (наприклад, написані вручну) — лише нормалізація.
  1: (data) => data,
  // 1 → 2: updatedAt у кожного елемента, deleted, нові поля (заповнює нормалізація).
  2: (data) => ({ ...data, deleted: {} }),
};

export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Файл не схожий на дані трекера');
  }
  if (!Array.isArray(raw.games)) throw new Error('У даних немає списку ігор (games)');

  let data = structuredClone(raw);
  let version = Number.isInteger(data.schemaVersion) ? data.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    throw new Error('Дані створені новішою версією застосунку — оновіть сторінку');
  }
  while (version < SCHEMA_VERSION) {
    version += 1;
    data = MIGRATIONS[version](data);
  }

  const games = data.games.map((g) => normalizeGame(g));
  const ids = new Set();
  for (const game of games) {
    if (ids.has(game.id)) game.id = uid('g');
    ids.add(game.id);
  }
  const result = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: isoOrNull(data.updatedAt),
    orderUpdatedAt: isoOrNull(data.orderUpdatedAt),
    deleted: normalizeTombstones(data.deleted),
    games,
  };
  fillTimestamps(result);
  return result;
}

// ---------- Прогрес (єдине місце підрахунку) ----------

/** Прогрес за списком досягнень: { done, total, percent }. */
export function progress(achievements) {
  let total = 0;
  let done = 0;
  for (const ach of achievements) {
    total += 1;
    if (ach.done) done += 1;
  }
  return { done, total, percent: total ? Math.floor((done / total) * 100) : 0 };
}

export function* gameAchievements(game) {
  for (const section of game.sections) yield* section.achievements;
}

export function* allAchievements(data = state) {
  for (const game of data.games) yield* gameAchievements(game);
}

export const sectionProgress = (section) => progress(section.achievements);
export const gameProgress = (game) => progress(gameAchievements(game));
export const totalProgress = (data = state) => progress(allAchievements(data));
export const isComplete = (p) => p.total > 0 && p.done === p.total;

/** Пропускні досягнення, які ще не отримано. */
export function remainingMissables(achievements) {
  let count = 0;
  for (const ach of achievements) if (ach.missable && !ach.done) count += 1;
  return count;
}

/**
 * Для розділу-«точки неповернення»: скільки пропускних лишилось у ньому
 * та в усіх розділах перед ним.
 */
export function missablesBeforeCheckpoint(game, sectionId) {
  let count = 0;
  for (const section of game.sections) {
    count += remainingMissables(section.achievements);
    if (section.id === sectionId) break;
  }
  return count;
}

/** Дати отримання по всіх досягненнях: [{ time, achievement, game }]. */
export function doneEvents(data = state) {
  const events = [];
  for (const game of data.games) {
    for (const ach of gameAchievements(game)) {
      if (!ach.done || !ach.doneAt) continue;
      const at = Date.parse(ach.doneAt);
      if (!Number.isNaN(at)) events.push({ time: at, achievement: ach, game });
    }
  }
  return events.sort((a, b) => a.time - b.time);
}

/** Статистика отриманих досягнень: останнє і кількість за 7 / 30 днів. */
export function achievementStats(data = state, now = Date.now()) {
  const DAY = 24 * 60 * 60 * 1000;
  const events = doneEvents(data);
  return {
    last: events.at(-1) || null,
    week: events.filter((e) => now - e.time <= 7 * DAY).length,
    month: events.filter((e) => now - e.time <= 30 * DAY).length,
  };
}

/** Підсумки гри: перше й останнє отримане, днів до 100%. */
export function gameSummary(game) {
  const events = doneEvents({ games: [game] });
  if (!events.length) return null;
  const first = events[0];
  const last = events.at(-1);
  const complete = isComplete(gameProgress(game));
  const days = Math.max(1, Math.ceil((last.time - Math.min(first.time, Date.parse(game.createdAt) || first.time)) / 86400000));
  return { first, last, complete, days };
}

// ---------- Об'єднання станів (синхронізація) ----------

function byId(list) {
  return new Map(list.map((item) => [item.id, item]));
}

/** Найпізніший updatedAt елемента разом із вкладеними. */
function effectiveTime(item) {
  let result = time(item.updatedAt);
  for (const child of item.sections || item.achievements || []) {
    result = Math.max(result, effectiveTime(child));
  }
  return result;
}

/**
 * Об'єднує два списки за id. Порядок — зі списку preferred; елементи, яких
 * у ньому немає, вставляються після свого сусіда з іншого списку.
 * Видалений елемент лишається видаленим, якщо його не змінювали після видалення.
 */
function mergeList(preferred, other, mergeItem, deleted) {
  const mapP = byId(preferred);
  const mapO = byId(other);
  const result = [];
  const index = new Map();

  const build = (id) => {
    const a = mapP.get(id);
    const b = mapO.get(id);
    const item = a && b ? mergeItem(a, b) : structuredClone(a || b);
    const removedAt = deleted[id];
    if (removedAt && time(removedAt) >= effectiveTime(item)) return null;
    return item;
  };

  for (const { id } of preferred) {
    const item = build(id);
    if (!item) continue;
    index.set(id, result.length);
    result.push(item);
  }
  let previous = null;
  for (const { id } of other) {
    if (mapP.has(id)) {
      previous = id;
      continue;
    }
    const item = build(id);
    if (!item) continue;
    const at = previous !== null && result.some((x) => x.id === previous)
      ? result.findIndex((x) => x.id === previous) + 1
      : result.length;
    result.splice(at, 0, item);
    previous = id;
  }
  return result;
}

const newerOf = (a, b) => (time(b.updatedAt) > time(a.updatedAt) ? b : a);

function mergeAchievement(a, b) {
  return structuredClone(newerOf(a, b));
}

function mergeSection(a, b, deleted) {
  const winner = newerOf(a, b);
  const loser = winner === a ? b : a;
  return {
    ...structuredClone({ ...winner, achievements: [] }),
    achievements: mergeList(winner.achievements, loser.achievements, mergeAchievement, deleted),
  };
}

function mergeGame(a, b, deleted) {
  const winner = newerOf(a, b);
  const loser = winner === a ? b : a;

  // Де має бути кожне досягнення: розділ із версії, де воно змінене пізніше
  // (переміщення між розділами оновлює updatedAt досягнення).
  const home = new Map();
  for (const game of [loser, winner]) {
    for (const section of game.sections) {
      for (const ach of section.achievements) {
        const known = home.get(ach.id);
        if (!known || time(ach.updatedAt) >= known.time) home.set(ach.id, { section: section.id, time: time(ach.updatedAt) });
      }
    }
  }

  const sections = mergeList(winner.sections, loser.sections, (x, y) => mergeSection(x, y, deleted), deleted);
  const placed = new Set();
  for (const section of sections) {
    section.achievements = section.achievements.filter((ach) => {
      const target = home.get(ach.id)?.section;
      const keep = !placed.has(ach.id) && (target === section.id || !sections.some((s) => s.id === target));
      if (keep) placed.add(ach.id);
      return keep;
    });
  }
  if (!sections.length) sections.push(normalizeSection({}, { now: winner.updatedAt }));

  return { ...structuredClone({ ...winner, sections: [] }), sections };
}

/** Об'єднує два стани без втрати змін з жодного боку. */
export function mergeStates(local, remote) {
  const deleted = { ...local.deleted };
  for (const [id, at] of Object.entries(remote.deleted || {})) {
    if (!deleted[id] || time(at) > time(deleted[id])) deleted[id] = at;
  }
  const localOrderFirst = time(local.orderUpdatedAt) >= time(remote.orderUpdatedAt);
  const [preferred, other] = localOrderFirst ? [local, remote] : [remote, local];
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: latest(local.updatedAt, remote.updatedAt),
    orderUpdatedAt: latest(local.orderUpdatedAt, remote.orderUpdatedAt),
    deleted,
    games: mergeList(preferred.games, other.games, (a, b) => mergeGame(a, b, deleted), deleted),
  };
}

/** Чи однаковий вміст (без урахування загального updatedAt). */
export function sameContent(a, b) {
  const pick = (s) => JSON.stringify([s.orderUpdatedAt, s.deleted, s.games]);
  return pick(a) === pick(b);
}

// ---------- Завантаження, збереження, підписка ----------

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Не вдалося записати ${key}`, error);
    return false;
  }
}

export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? migrate(JSON.parse(raw)) : emptyState();
  } catch (error) {
    console.error('Пошкоджені дані в localStorage, починаю з порожнього стану', error);
    if (raw) writeRawBackup(raw, 'Пошкоджені дані при завантаженні');
    state = emptyState();
  }
  observeState(state);
  return state;
}

function persist() {
  if (!writeJson(STORAGE_KEY, state)) {
    emit({ source: 'storage-error' });
  }
}

export function getState() {
  if (!state) load();
  return state;
}

/** Підписка на зміни. Слухач отримує { source }. Повертає функцію відписки. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(detail) {
  for (const listener of [...listeners]) {
    try {
      listener(detail);
    } catch (error) {
      console.error(error);
    }
  }
}

/**
 * Єдиний спосіб змінити дані. mutator отримує стан і позначку часу now
 * і змінює стан на місці. source: 'local' (дії користувача), 'import', 'remote'.
 */
export function update(mutator, { source = 'local' } = {}) {
  const data = getState();
  const now = stamp();
  const result = mutator(data, now);
  data.updatedAt = now;
  persist();
  emit({ source });
  return result;
}

/** Повна заміна стану (імпорт, дані з Gist). keepUpdatedAt — не чіпати updatedAt. */
export function replaceState(next, { source = 'import', keepUpdatedAt = false } = {}) {
  state = migrate(next);
  observeState(state);
  if (!keepUpdatedAt || !state.updatedAt) {
    const now = stamp();
    state.updatedAt = now;
    if (!keepUpdatedAt) state.orderUpdatedAt = now;
  }
  persist();
  emit({ source });
  return state;
}

// ---------- Резервна копія ----------

export function saveBackup(data = getState(), reason = '') {
  return writeJson(BACKUP_KEY, { savedAt: new Date().toISOString(), reason, data });
}

function writeRawBackup(raw, reason) {
  try {
    localStorage.setItem(
      BACKUP_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), reason, raw }),
    );
  } catch {
    /* немає місця — нічого не вдієш */
  }
}

/** { savedAt, reason, data } або null. */
export function getBackup() {
  const backup = readJson(BACKUP_KEY);
  if (!backup || !backup.data) return null;
  return backup;
}

// ---------- Налаштування інтерфейсу (не синхронізуються) ----------

export function getPref(key, fallback) {
  const prefs = readJson(PREFS_KEY) || {};
  return key in prefs ? prefs[key] : fallback;
}

export function setPref(key, value) {
  const prefs = readJson(PREFS_KEY) || {};
  prefs[key] = value;
  writeJson(PREFS_KEY, prefs);
}

// ---------- Пошук ----------

export function getGame(gameId, data = getState()) {
  return data.games.find((g) => g.id === gameId) || null;
}

function requireGame(data, gameId) {
  const game = getGame(gameId, data);
  if (!game) throw new Error(`Гру ${gameId} не знайдено`);
  return game;
}

function findSection(game, sectionId) {
  const section = game.sections.find((s) => s.id === sectionId);
  if (!section) throw new Error(`Розділ ${sectionId} не знайдено`);
  return section;
}

/** { section, index, achievement } для досягнення. */
export function locateAchievement(game, achievementId) {
  for (const section of game.sections) {
    const index = section.achievements.findIndex((a) => a.id === achievementId);
    if (index !== -1) return { section, index, achievement: section.achievements[index] };
  }
  return null;
}

function requireAchievement(game, achievementId) {
  const found = locateAchievement(game, achievementId);
  if (!found) throw new Error(`Досягнення ${achievementId} не знайдено`);
  return found;
}

/** Переміщує елемент масиву на delta позицій. Повертає true, якщо щось змінилось. */
function moveInArray(list, index, delta) {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return false;
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
  return true;
}

function bury(data, ids, now) {
  for (const id of ids) data.deleted[id] = now;
}

// ---------- Ігри ----------

const GAME_FIELDS = ['title', 'platform', 'accent', 'coverUrl', 'guideUrl', 'notes', 'status', 'archived'];

export function createGame(fields) {
  return update((data, now) => {
    const game = normalizeGame({ ...fields, createdAt: new Date().toISOString() }, { freshIds: true, now });
    data.games.push(game);
    data.orderUpdatedAt = now;
    return game;
  });
}

export function updateGame(gameId, patch) {
  update((data, now) => {
    const game = requireGame(data, gameId);
    for (const key of GAME_FIELDS) {
      if (!(key in patch)) continue;
      if (key === 'accent') game.accent = safeColor(patch.accent, DEFAULT_ACCENT);
      else if (key === 'title') game.title = text(patch.title) || game.title;
      else if (key === 'status') game.status = patch.status in GAME_STATUSES ? patch.status : game.status;
      else if (key === 'archived') game.archived = patch.archived === true;
      else game[key] = text(patch[key]);
    }
    game.updatedAt = now;
  });
}

export function deleteGame(gameId) {
  update((data, now) => {
    bury(data, [gameId], now);
    data.games = data.games.filter((g) => g.id !== gameId);
    data.orderUpdatedAt = now;
  });
}

export function moveGame(gameId, delta) {
  update((data, now) => {
    if (moveInArray(data.games, data.games.findIndex((g) => g.id === gameId), delta)) data.orderUpdatedAt = now;
  });
}

export function resetGameProgress(gameId) {
  update((data, now) => {
    for (const ach of gameAchievements(requireGame(data, gameId))) {
      ach.done = false;
      ach.doneAt = null;
      if (ach.counter) ach.counter.current = 0;
      ach.updatedAt = now;
    }
  });
}

/** Додає ігри з імпорту. Якщо id вже зайнятий — генерує новий. */
export function addGames(games) {
  update(
    (data, now) => {
      const ids = new Set(data.games.map((g) => g.id));
      for (const input of games) {
        const game = normalizeGame(input, { now });
        if (ids.has(game.id)) game.id = uid('g');
        ids.add(game.id);
        delete data.deleted[game.id];
        data.games.push(game);
      }
      data.orderUpdatedAt = now;
    },
    { source: 'import' },
  );
}

export function clearAll() {
  update((data, now) => {
    bury(data, data.games.map((g) => g.id), now);
    data.games = [];
    data.orderUpdatedAt = now;
  });
}

// ---------- Розділи ----------

export function addSection(gameId, title) {
  return update((data, now) => {
    const game = requireGame(data, gameId);
    const section = normalizeSection({ title }, { freshIds: true, now });
    game.sections.push(section);
    game.updatedAt = now;
    return section;
  });
}

export function updateSection(gameId, sectionId, patch) {
  update((data, now) => {
    const section = findSection(requireGame(data, gameId), sectionId);
    if ('title' in patch) section.title = text(patch.title) || DEFAULT_SECTION_TITLE;
    if ('checkpoint' in patch) section.checkpoint = patch.checkpoint === true;
    section.updatedAt = now;
  });
}

export function renameSection(gameId, sectionId, title) {
  updateSection(gameId, sectionId, { title });
}

/** Видаляє розділ разом із досягненнями. Останній розділ гри видалити не можна. */
export function deleteSection(gameId, sectionId) {
  update((data, now) => {
    const game = requireGame(data, gameId);
    if (game.sections.length <= 1) throw new Error('У гри має лишитися хоча б один розділ');
    const section = findSection(game, sectionId);
    bury(data, [section.id, ...section.achievements.map((a) => a.id)], now);
    game.sections = game.sections.filter((s) => s.id !== sectionId);
    game.updatedAt = now;
  });
}

export function moveSection(gameId, sectionId, delta) {
  update((data, now) => {
    const game = requireGame(data, gameId);
    if (moveInArray(game.sections, game.sections.findIndex((s) => s.id === sectionId), delta)) game.updatedAt = now;
  });
}

// ---------- Досягнення ----------

export function addAchievement(gameId, sectionId, fields) {
  return update((data, now) => {
    const section = findSection(requireGame(data, gameId), sectionId);
    const achievement = normalizeAchievement({ ...fields, done: false }, { freshIds: true, now });
    section.achievements.push(achievement);
    section.updatedAt = now;
    return achievement;
  });
}

const ACHIEVEMENT_TEXT = ['condition', 'tip', 'note'];
const ACHIEVEMENT_FLAGS = ['missable', 'spoiler', 'focus'];

export function updateAchievement(gameId, achievementId, patch) {
  update((data, now) => {
    const { achievement } = requireAchievement(requireGame(data, gameId), achievementId);
    if ('name' in patch) achievement.name = text(patch.name) || achievement.name;
    for (const key of ACHIEVEMENT_TEXT) if (key in patch) achievement[key] = text(patch[key]);
    for (const key of ACHIEVEMENT_FLAGS) if (key in patch) achievement[key] = patch[key] === true;
    if ('counterTarget' in patch) {
      const target = toInt(patch.counterTarget);
      achievement.counter = target >= 2
        ? normalizeCounter({ current: achievement.counter?.current ?? (achievement.done ? target : 0), target })
        : null;
    }
    achievement.updatedAt = now;
  });
}

/** Масове оновлення прапорців кількох досягнень. */
export function updateAchievements(gameId, ids, patch) {
  update((data, now) => {
    const game = requireGame(data, gameId);
    for (const id of ids) {
      const found = locateAchievement(game, id);
      if (!found) continue;
      for (const key of ACHIEVEMENT_FLAGS) if (key in patch) found.achievement[key] = patch[key] === true;
      found.achievement.updatedAt = now;
    }
  });
}

function setDone(achievement, done, now) {
  if (achievement.done === done) return;
  achievement.done = done;
  achievement.doneAt = done ? new Date().toISOString() : null;
  achievement.updatedAt = now;
}

/** Перемикає done. Якщо value не задано — інвертує. Повертає нове значення. */
export function toggleAchievement(gameId, achievementId, value) {
  return update((data, now) => {
    const { achievement } = requireAchievement(requireGame(data, gameId), achievementId);
    const done = value === undefined ? !achievement.done : Boolean(value);
    setDone(achievement, done, now);
    if (done && achievement.counter) achievement.counter.current = achievement.counter.target;
    achievement.updatedAt = now;
    return achievement.done;
  });
}

/** Повертає done/doneAt/лічильник до попереднього значення (кнопка «Скасувати»). */
export function restoreAchievementState(gameId, achievementId, snapshot) {
  update((data, now) => {
    const { achievement } = requireAchievement(requireGame(data, gameId), achievementId);
    achievement.done = snapshot.done;
    achievement.doneAt = snapshot.done ? snapshot.doneAt : null;
    achievement.counter = snapshot.counter ? { ...snapshot.counter } : null;
    achievement.updatedAt = now;
  });
}

/** Встановлює точне значення лічильника. */
export function setCounter(gameId, achievementId, value) {
  const game = getGame(gameId);
  const ach = game && locateAchievement(game, achievementId)?.achievement;
  if (!ach?.counter) return null;
  return stepCounter(gameId, achievementId, toInt(value) - ach.counter.current);
}

/**
 * Змінює лічильник на delta. Досягнення стає отриманим, коли лічильник
 * доходить до цілі, і неотриманим, коли опускається нижче.
 * Повертає { current, target, done }.
 */
export function stepCounter(gameId, achievementId, delta) {
  return update((data, now) => {
    const { achievement } = requireAchievement(requireGame(data, gameId), achievementId);
    const counter = achievement.counter;
    if (!counter) return null;
    counter.current = Math.max(0, Math.min(counter.target, counter.current + delta));
    setDone(achievement, counter.current >= counter.target, now);
    achievement.updatedAt = now;
    return { ...counter, done: achievement.done };
  });
}

/** Видаляє досягнення. Повертає дані для restoreAchievement (скасування). */
export function deleteAchievement(gameId, achievementId) {
  return update((data, now) => {
    const { section, index, achievement } = requireAchievement(requireGame(data, gameId), achievementId);
    section.achievements.splice(index, 1);
    section.updatedAt = now;
    bury(data, [achievementId], now);
    return { gameId, sectionId: section.id, index, achievement };
  });
}

export function deleteAchievements(gameId, ids) {
  return update((data, now) => {
    const game = requireGame(data, gameId);
    const removed = [];
    for (const id of ids) {
      const found = locateAchievement(game, id);
      if (!found) continue;
      found.section.achievements.splice(found.index, 1);
      found.section.updatedAt = now;
      removed.push({ gameId, sectionId: found.section.id, index: found.index, achievement: found.achievement });
    }
    bury(data, ids, now);
    return removed;
  });
}

/** Повертає видалені досягнення на свої місця (у зворотному порядку видалення). */
export function restoreAchievements(entries) {
  update((data, now) => {
    for (const { gameId, sectionId, index, achievement } of [...entries].reverse()) {
      const game = getGame(gameId, data);
      if (!game) continue;
      const section = game.sections.find((s) => s.id === sectionId) || game.sections[0];
      section.achievements.splice(Math.min(index, section.achievements.length), 0, { ...achievement, updatedAt: now });
      section.updatedAt = now;
      delete data.deleted[achievement.id];
    }
  });
}

export function moveAchievement(gameId, achievementId, delta) {
  update((data, now) => {
    const { section, index } = requireAchievement(requireGame(data, gameId), achievementId);
    if (moveInArray(section.achievements, index, delta)) section.updatedAt = now;
  });
}

/** Переносить досягнення в кінець іншого розділу. */
export function moveAchievementsToSection(gameId, ids, targetSectionId) {
  update((data, now) => {
    const game = requireGame(data, gameId);
    const target = findSection(game, targetSectionId);
    for (const id of ids) {
      const found = locateAchievement(game, id);
      if (!found || found.section === target) continue;
      found.section.achievements.splice(found.index, 1);
      found.section.updatedAt = now;
      found.achievement.updatedAt = now;
      target.achievements.push(found.achievement);
    }
    target.updatedAt = now;
  });
}

export function moveAchievementToSection(gameId, achievementId, targetSectionId) {
  moveAchievementsToSection(gameId, [achievementId], targetSectionId);
}

/**
 * Дописує розділи з масового імпорту. Розділ із такою самою назвою (без урахування
 * регістру) доповнюється; title === null означає «перший розділ гри».
 */
export function importSections(gameId, sections) {
  update(
    (data, now) => {
      const game = requireGame(data, gameId);
      for (const incoming of sections) {
        let target =
          incoming.title == null
            ? game.sections[0]
            : findSectionByTitle(game, incoming.title);
        if (!target) {
          target = normalizeSection({ title: incoming.title }, { freshIds: true, now });
          game.sections.push(target);
          game.updatedAt = now;
        }
        for (const ach of incoming.achievements) {
          target.achievements.push(normalizeAchievement(ach, { freshIds: true, now }));
        }
        target.updatedAt = now;
      }
    },
    { source: 'import' },
  );
}

export function findSectionByTitle(game, title) {
  const wanted = text(title).toLocaleLowerCase('uk-UA');
  return game.sections.find((s) => s.title.toLocaleLowerCase('uk-UA') === wanted) || null;
}

/** Копія гри без прогресу й особистих нотаток — щоб поділитися списком. */
export function gameTemplate(game) {
  return {
    title: game.title,
    platform: game.platform,
    accent: game.accent,
    coverUrl: game.coverUrl,
    guideUrl: game.guideUrl,
    notes: game.notes,
    sections: game.sections.map((section) => ({
      title: section.title,
      checkpoint: section.checkpoint,
      achievements: section.achievements.map((ach) => ({
        name: ach.name,
        condition: ach.condition,
        tip: ach.tip,
        missable: ach.missable,
        spoiler: ach.spoiler,
        ...(ach.counter ? { counter: { current: 0, target: ach.counter.target } } : {}),
      })),
    })),
  };
}
