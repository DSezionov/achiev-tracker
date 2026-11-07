// Розбір імпорту: JSON-файл з усіма даними, JSON однієї гри і швидкий текстовий формат.

import { migrate, normalizeGame } from './store.js';

/**
 * Розбирає вміст JSON-файлу. Повертає
 *   { kind: 'state', state }  — повний експорт застосунку;
 *   { kind: 'game', game }    — одна гра.
 * Кидає Error з людським повідомленням, якщо формат невідомий.
 */
export function parseJsonImport(textContent) {
  let raw;
  try {
    raw = JSON.parse(textContent);
  } catch {
    throw new Error('Файл не є коректним JSON');
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.games)) {
    return { kind: 'state', state: migrate(raw) };
  }
  if (raw && typeof raw === 'object' && typeof raw.title === 'string') {
    return { kind: 'game', game: normalizeGame(raw, { freshIds: true }) };
  }
  throw new Error('Не вдалося розпізнати формат: очікується експорт трекера або об’єкт гри');
}

/** Чи схожий текст на JSON (а не на текстовий список). */
export function looksLikeJson(textContent) {
  return /^\s*[{[]/.test(textContent);
}

/**
 * Швидкий текстовий формат:
 *   ## Розділ
 *   Назва | Умова | Порада
 *   ! Назва пропускного | Умова
 *
 * Повертає { sections: [{ title, achievements }], errors: [{ line, message }], count }.
 * title === null — рядки до першого заголовка (підуть у перший розділ гри).
 */
export function parseBulkText(textContent) {
  const sections = [];
  const errors = [];
  const byTitle = new Map();
  let current = null;
  let count = 0;

  const sectionFor = (title) => {
    const key = title === null ? null : title.toLocaleLowerCase('uk-UA');
    if (!byTitle.has(key)) {
      const section = { title, achievements: [] };
      byTitle.set(key, section);
      sections.push(section);
    }
    return byTitle.get(key);
  };

  String(textContent ?? '')
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (!line) return;

      if (line.startsWith('##')) {
        const title = line.replace(/^#+/, '').trim();
        if (!title) {
          errors.push({ line: index + 1, message: 'Порожня назва розділу' });
          return;
        }
        current = sectionFor(title);
        return;
      }

      let body = line;
      let missable = false;
      if (body.startsWith('!')) {
        missable = true;
        body = body.slice(1).trim();
      }

      const [name = '', condition = '', ...tipParts] = body.split('|').map((part) => part.trim());
      if (!name) {
        errors.push({ line: index + 1, message: 'Немає назви досягнення' });
        return;
      }

      if (!current) current = sectionFor(null);
      current.achievements.push({ name, condition, tip: tipParts.join(' | ').trim(), missable });
      count += 1;
    });

  return { sections, errors, count };
}
