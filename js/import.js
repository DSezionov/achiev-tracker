// Розбір імпорту: JSON-файл з усіма даними, JSON однієї гри, швидкий текстовий
// формат і текст, скопійований зі сторінки досягнень Steam.

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

/** Збирає розділи за назвою (без урахування регістру); title === null — перший розділ гри. */
function sectionCollector() {
  const sections = [];
  const byTitle = new Map();
  return {
    sections,
    get(title) {
      const key = title === null ? null : title.toLocaleLowerCase('uk-UA');
      if (!byTitle.has(key)) {
        const section = { title, achievements: [] };
        byTitle.set(key, section);
        sections.push(section);
      }
      return byTitle.get(key);
    },
  };
}

/**
 * Швидкий текстовий формат:
 *   ## Розділ
 *   Назва | Умова | Порада
 *   ! Назва пропускного | Умова
 *   ? Назва зі спойлером | Умова
 *   Гриндове | Убити 50 ворогів | | 50     ← четверта колонка-число = ціль лічильника
 *
 * Повертає { sections: [{ title, achievements }], errors: [{ line, message }], count }.
 * title === null — рядки до першого заголовка (підуть у перший розділ гри).
 */
export function parseBulkText(textContent) {
  const collector = sectionCollector();
  const errors = [];
  let current = null;
  let count = 0;

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
        current = collector.get(title);
        return;
      }

      let body = line;
      let missable = false;
      let spoiler = false;
      for (;;) {
        if (body.startsWith('!')) missable = true;
        else if (body.startsWith('?')) spoiler = true;
        else break;
        body = body.slice(1).trimStart();
      }

      const parts = body.split('|').map((part) => part.trim());
      let counter = null;
      if (parts.length >= 4 && /^\d+$/.test(parts.at(-1))) {
        const target = Number(parts.pop());
        if (target >= 2) counter = { current: 0, target };
      }
      const [name = '', condition = '', ...tipParts] = parts;
      if (!name) {
        errors.push({ line: index + 1, message: 'Немає назви досягнення' });
        return;
      }

      if (!current) current = collector.get(null);
      current.achievements.push({
        name,
        condition,
        tip: tipParts.join(' | ').trim(),
        missable,
        spoiler,
        counter,
      });
      count += 1;
    });

  return { sections: collector.sections, errors, count };
}

// ---------- Текст зі сторінки досягнень Steam ----------

const PERCENT_LINE = /^\d{1,3}([.,]\d+)?\s*%(\s.*)?$/;
const COUNTER_LINE = /^(\d[\d\s,.]*)\s*\/\s*(\d[\d\s,.]*)$/;
const UNLOCKED_LINE = /^(unlocked|отримано|разблокировано|розблоковано|получено)\b/i;
const NOISE_LINE =
  /^(hidden achievements?|приховані досягнення|скрытые достижения|\d+ of \d+ .*achievements|\d+ з \d+|\d+ из \d+|global gameplay stats|personal achievements|compare with friends|view my stats|.*achievements earned.*)$/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** «Unlocked 12 Nov, 2024 @ 8:15pm» або «Unlocked Nov 12, 2024 @ 8:15pm» → ISO-рядок або поточний час. */
function parseUnlocked(line) {
  const dayFirst = line.match(/(\d{1,2}) ([a-z]{3})[a-z]*,? (\d{4})/i);
  const monthFirst = line.match(/([a-z]{3})[a-z]* (\d{1,2}),? (\d{4})/i);
  const [day, month, year] = dayFirst
    ? [dayFirst[1], dayFirst[2], dayFirst[3]]
    : monthFirst
      ? [monthFirst[2], monthFirst[1], monthFirst[3]]
      : [];
  const monthIndex = month ? MONTHS.indexOf(month.toLowerCase()) : -1;
  if (monthIndex === -1) return new Date().toISOString();
  let hours = 0;
  let minutes = 0;
  const clock = line.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (clock) {
    hours = Number(clock[1]) % 12 + (clock[3]?.toLowerCase() === 'pm' ? 12 : clock[3] ? 0 : Math.floor(Number(clock[1]) / 12) * 12);
    minutes = Number(clock[2]);
  }
  return new Date(Number(year), monthIndex, Number(day), hours, minutes).toISOString();
}

const toNumber = (value) => Number(String(value).replace(/[\s,.]/g, ''));

/**
 * Евристичний розбір тексту, скопійованого зі сторінки досягнень Steam
 * (глобальна статистика або особиста сторінка). Пари рядків «назва / опис»;
 * відсотки ігноруються, «Unlocked …» робить досягнення отриманим,
 * «23 / 50» стає лічильником.
 *
 * Повертає ту саму структуру, що й parseBulkText (усе — в один розділ).
 */
export function parseSteamText(textContent, sectionTitle = null) {
  const lines = String(textContent ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !NOISE_LINE.test(l.replace(/[:.]+$/, '')));

  const achievements = [];
  let currentAch = null;
  let pendingName = null;

  const flushName = () => {
    if (pendingName === null) return;
    currentAch = { name: pendingName, condition: '', tip: '', missable: false, spoiler: false, counter: null };
    achievements.push(currentAch);
    pendingName = null;
  };

  for (const line of lines) {
    // Відсоток гравців стоїть перед кожним досягненням на глобальній сторінці —
    // це межа між досягненнями (у прихованих може не бути опису).
    if (PERCENT_LINE.test(line)) {
      flushName();
      continue;
    }
    if (UNLOCKED_LINE.test(line)) {
      flushName();
      if (currentAch) {
        currentAch.done = true;
        currentAch.doneAt = parseUnlocked(line);
      }
      continue;
    }
    const counterMatch = line.match(COUNTER_LINE);
    if (counterMatch) {
      flushName();
      const current = toNumber(counterMatch[1]);
      const target = toNumber(counterMatch[2]);
      if (currentAch && target >= 2) currentAch.counter = { current: Math.min(current, target), target };
      continue;
    }
    if (pendingName === null) {
      pendingName = line;
    } else {
      currentAch = { name: pendingName, condition: line, tip: '', missable: false, spoiler: false, counter: null };
      achievements.push(currentAch);
      pendingName = null;
    }
  }
  flushName();

  for (const ach of achievements) {
    if (ach.counter && ach.counter.current >= ach.counter.target) {
      ach.done = true;
      ach.doneAt ||= new Date().toISOString();
    }
  }

  return {
    sections: achievements.length ? [{ title: sectionTitle, achievements }] : [],
    errors: [],
    count: achievements.length,
  };
}

/** Завантажує JSON гри за посиланням (наприклад, raw-файл Gist). */
export async function fetchGameFromUrl(url) {
  let response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch {
    throw new Error('Не вдалося завантажити файл (немає з’єднання або сайт не дозволяє доступ)');
  }
  if (!response.ok) throw new Error(`Сервер відповів помилкою ${response.status}`);
  return parseJsonImport(await response.text());
}
