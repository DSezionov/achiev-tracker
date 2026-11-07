// Стан застосунку: завантаження, міграції, збереження в localStorage і події змін.
// Усі зміни даних проходять через update(), який оновлює updatedAt і зберігає стан.

import { uid, safeColor } from './utils.js';

export const STORAGE_KEY = 'achievement-tracker:v1';
export const BACKUP_KEY = 'achievement-tracker:backup';
export const PREFS_KEY = 'achievement-tracker:prefs';
export const SCHEMA_VERSION = 1;
export const DEFAULT_SECTION_TITLE = 'Загальне';
export const DEFAULT_ACCENT = '#7c9cff';

let state = null;
const listeners = new Set();

// ---------- Модель ----------

/** updatedAt = null означає «ще нічого не змінювали» (програє будь-якій синхронізації). */
export function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: null, games: [] };
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const isoOrNull = (value) => {
  if (typeof value !== 'string') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
};
const validId = (value, prefix) =>
  typeof value === 'string' && value.startsWith(`${prefix}_`) && value.length <= 40;

export function normalizeAchievement(input, { freshIds = false } = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const done = raw.done === true;
  return {
    id: !freshIds && validId(raw.id, 'a') ? raw.id : uid('a'),
    name: text(raw.name) || 'Без назви',
    condition: text(raw.condition),
    tip: text(raw.tip),
    missable: raw.missable === true,
    done,
    doneAt: done ? isoOrNull(raw.doneAt) : null,
  };
}

export function normalizeSection(input, options = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    id: !options.freshIds && validId(raw.id, 's') ? raw.id : uid('s'),
    title: text(raw.title) || DEFAULT_SECTION_TITLE,
    achievements: Array.isArray(raw.achievements)
      ? raw.achievements.map((a) => normalizeAchievement(a, options))
      : [],
  };
}

/**
 * Приводить об'єкт гри до схеми. Відсутні id генеруються, зайві поля відкидаються.
 * Для зручності імпорту приймає і гру з масивом achievements без розділів.
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
    createdAt: isoOrNull(input.createdAt) || new Date().toISOString(),
    sections,
  };
}

/**
 * Приводить збережені або імпортовані дані до поточної схеми.
 * При зміні схеми: збільшити SCHEMA_VERSION і дописати крок у MIGRATIONS.
 */
const MIGRATIONS = {
  // 0 → 1: дані без schemaVersion (наприклад, написані вручну) — лише нормалізація.
  1: (data) => data,
};

export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Файл не схожий на дані трекера');
  }
  if (!Array.isArray(raw.games)) throw new Error('У даних немає списку ігор (games)');

  let data = structuredClone(raw);
  let version = Number.isInteger(data.schemaVersion) ? data.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    throw new Error('Дані створені новішою версією застосунку');
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
  return { schemaVersion: SCHEMA_VERSION, updatedAt: isoOrNull(data.updatedAt), games };
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

/** Статистика отриманих досягнень: останнє і кількість за 7 / 30 днів. */
export function achievementStats(data = state, now = Date.now()) {
  const DAY = 24 * 60 * 60 * 1000;
  let last = null;
  let week = 0;
  let month = 0;
  for (const game of data.games) {
    for (const ach of gameAchievements(game)) {
      if (!ach.done || !ach.doneAt) continue;
      const time = Date.parse(ach.doneAt);
      if (Number.isNaN(time)) continue;
      if (now - time <= 7 * DAY) week += 1;
      if (now - time <= 30 * DAY) month += 1;
      if (!last || time > last.time) last = { time, achievement: ach, game };
    }
  }
  return { last, week, month };
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
 * Єдиний спосіб змінити дані. mutator отримує стан і змінює його на місці.
 * source: 'local' (дії користувача), 'import', 'remote' (синхронізація).
 */
export function update(mutator, { source = 'local' } = {}) {
  const data = getState();
  const result = mutator(data);
  data.updatedAt = new Date().toISOString();
  persist();
  emit({ source });
  return result;
}

/** Повна заміна стану (імпорт, дані з Gist). keepUpdatedAt — не чіпати updatedAt. */
export function replaceState(next, { source = 'import', keepUpdatedAt = false } = {}) {
  state = migrate(next);
  if (!keepUpdatedAt || !state.updatedAt) state.updatedAt = new Date().toISOString();
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

/** { section, index } для досягнення. */
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

// ---------- Ігри ----------

const GAME_FIELDS = ['title', 'platform', 'accent', 'coverUrl', 'guideUrl', 'notes'];

export function createGame(fields) {
  const game = normalizeGame({ ...fields, createdAt: new Date().toISOString() }, { freshIds: true });
  update((data) => data.games.push(game));
  return game;
}

export function updateGame(gameId, patch) {
  update((data) => {
    const game = requireGame(data, gameId);
    for (const key of GAME_FIELDS) {
      if (!(key in patch)) continue;
      if (key === 'accent') game.accent = safeColor(patch.accent, DEFAULT_ACCENT);
      else if (key === 'title') game.title = text(patch.title) || game.title;
      else game[key] = text(patch[key]);
    }
  });
}

export function deleteGame(gameId) {
  update((data) => {
    data.games = data.games.filter((g) => g.id !== gameId);
  });
}

export function moveGame(gameId, delta) {
  update((data) => moveInArray(data.games, data.games.findIndex((g) => g.id === gameId), delta));
}

export function resetGameProgress(gameId) {
  update((data) => {
    for (const ach of gameAchievements(requireGame(data, gameId))) {
      ach.done = false;
      ach.doneAt = null;
    }
  });
}

/** Додає ігри з імпорту. Якщо id вже зайнятий — генерує новий. */
export function addGames(games) {
  update(
    (data) => {
      const ids = new Set(data.games.map((g) => g.id));
      for (const input of games) {
        const game = normalizeGame(input);
        if (ids.has(game.id)) game.id = uid('g');
        ids.add(game.id);
        data.games.push(game);
      }
    },
    { source: 'import' },
  );
}

export function clearAll() {
  update((data) => {
    data.games = [];
  });
}

// ---------- Розділи ----------

export function addSection(gameId, title) {
  const section = normalizeSection({ title }, { freshIds: true });
  update((data) => requireGame(data, gameId).sections.push(section));
  return section;
}

export function renameSection(gameId, sectionId, title) {
  update((data) => {
    findSection(requireGame(data, gameId), sectionId).title = text(title) || DEFAULT_SECTION_TITLE;
  });
}

/** Видаляє розділ разом із досягненнями. Останній розділ гри видалити не можна. */
export function deleteSection(gameId, sectionId) {
  update((data) => {
    const game = requireGame(data, gameId);
    if (game.sections.length <= 1) throw new Error('У гри має лишитися хоча б один розділ');
    game.sections = game.sections.filter((s) => s.id !== sectionId);
  });
}

export function moveSection(gameId, sectionId, delta) {
  update((data) => {
    const game = requireGame(data, gameId);
    moveInArray(game.sections, game.sections.findIndex((s) => s.id === sectionId), delta);
  });
}

// ---------- Досягнення ----------

export function addAchievement(gameId, sectionId, fields) {
  const achievement = normalizeAchievement({ ...fields, done: false }, { freshIds: true });
  update((data) => findSection(requireGame(data, gameId), sectionId).achievements.push(achievement));
  return achievement;
}

const ACHIEVEMENT_FIELDS = ['name', 'condition', 'tip', 'missable'];

export function updateAchievement(gameId, achievementId, patch) {
  update((data) => {
    const { achievement } = requireAchievement(requireGame(data, gameId), achievementId);
    for (const key of ACHIEVEMENT_FIELDS) {
      if (!(key in patch)) continue;
      if (key === 'missable') achievement.missable = patch.missable === true;
      else if (key === 'name') achievement.name = text(patch.name) || achievement.name;
      else achievement[key] = text(patch[key]);
    }
  });
}

/** Перемикає done. Якщо value не задано — інвертує. Повертає нове значення. */
export function toggleAchievement(gameId, achievementId, value) {
  return update((data) => {
    const { achievement } = requireAchievement(requireGame(data, gameId), achievementId);
    achievement.done = value === undefined ? !achievement.done : Boolean(value);
    achievement.doneAt = achievement.done ? new Date().toISOString() : null;
    return achievement.done;
  });
}

export function deleteAchievement(gameId, achievementId) {
  update((data) => {
    const { section, index } = requireAchievement(requireGame(data, gameId), achievementId);
    section.achievements.splice(index, 1);
  });
}

export function moveAchievement(gameId, achievementId, delta) {
  update((data) => {
    const { section, index } = requireAchievement(requireGame(data, gameId), achievementId);
    moveInArray(section.achievements, index, delta);
  });
}

/** Переносить досягнення в кінець іншого розділу. */
export function moveAchievementToSection(gameId, achievementId, targetSectionId) {
  update((data) => {
    const game = requireGame(data, gameId);
    const { section, index } = requireAchievement(game, achievementId);
    const target = findSection(game, targetSectionId);
    if (target === section) return;
    const [achievement] = section.achievements.splice(index, 1);
    target.achievements.push(achievement);
  });
}

/**
 * Дописує розділи з масового імпорту. Розділ із такою самою назвою (без урахування
 * регістру) доповнюється; title === null означає «перший розділ гри».
 */
export function importSections(gameId, sections) {
  update(
    (data) => {
      const game = requireGame(data, gameId);
      for (const incoming of sections) {
        let target =
          incoming.title == null
            ? game.sections[0]
            : findSectionByTitle(game, incoming.title);
        if (!target) {
          target = normalizeSection({ title: incoming.title }, { freshIds: true });
          game.sections.push(target);
        }
        for (const ach of incoming.achievements) {
          target.achievements.push(normalizeAchievement(ach, { freshIds: true }));
        }
      }
    },
    { source: 'import' },
  );
}

export function findSectionByTitle(game, title) {
  const wanted = text(title).toLocaleLowerCase('uk-UA');
  return game.sections.find((s) => s.title.toLocaleLowerCase('uk-UA') === wanted) || null;
}
