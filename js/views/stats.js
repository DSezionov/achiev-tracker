// Статистика: ключові числа, календар активності, графік за місяцями
// і підсумки по іграх.

import { getState, subscribe, doneEvents, gameProgress, gameSummary, isComplete } from '../store.js';
import { el, formatDate, plural } from '../utils.js';
import { icon, setPageTitle } from '../ui.js';

const DAY = 24 * 60 * 60 * 1000;
const WEEKS = 26;
const MONTHS = 12;
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const monthShort = new Intl.DateTimeFormat('uk-UA', { month: 'short' });
const monthLong = new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' });
const pluralAch = (n) => `${n} ${plural(n, ['досягнення', 'досягнення', 'досягнень'])}`;

export function renderStats(root) {
  setPageTitle('Статистика');
  const draw = () => drawStats(root);
  draw();
  return subscribe(draw);
}

/** Ключ дня в локальному часі: YYYY-MM-DD. */
function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function drawStats(root) {
  const state = getState();
  const events = doneEvents(state);
  const perDay = new Map();
  for (const event of events) {
    const key = dayKey(event.time);
    perDay.set(key, (perDay.get(key) || 0) + 1);
  }

  const tooltip = el('div', { class: 'chart-tooltip', role: 'tooltip', hidden: true });

  root.replaceChildren(
    el(
      'div',
      { class: 'stats-page' },
      el('a', { class: 'back-link', href: '#/' }, icon('back'), 'Усі ігри'),
      el('h1', {}, 'Статистика'),
      events.length
        ? [
            tiles(state, events, perDay),
            heatmapPanel(perDay, tooltip),
            monthlyPanel(events, tooltip),
            gamesPanel(state),
          ]
        : el('section', { class: 'panel empty' }, el('p', { class: 'muted' }, 'Ще немає отриманих досягнень з датою. Відмітьте перше — і тут з’явиться статистика.')),
      tooltip,
    ),
  );
  // Якщо календар не вміщається, показуємо найсвіжіші тижні.
  const heatmap = root.querySelector('.heatmap');
  if (heatmap) heatmap.scrollLeft = heatmap.scrollWidth;
}

// ---------- Ключові числа ----------

function streaks(perDay) {
  const days = [...perDay.keys()]
    .map((key) => {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y, m, d).getTime();
    })
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of days) {
    run = prev !== null && Math.round((day - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  // Поточна серія: закінчується сьогодні або вчора.
  const today = startOfDay(Date.now()).getTime();
  let current = 0;
  for (let day = perDay.has(dayKey(today)) ? today : today - DAY; perDay.has(dayKey(day)); day -= DAY) current += 1;
  return { best, current };
}

function tiles(state, events, perDay) {
  const completed = state.games.filter((g) => isComplete(gameProgress(g))).length;
  const { best, current } = streaks(perDay);
  const tile = (label, value, note) =>
    el('div', { class: 'tile' }, el('p', { class: 'tile__label' }, label), el('p', { class: 'tile__value' }, value), note ? el('p', { class: 'tile__note' }, note) : null);
  return el(
    'section',
    { class: 'tiles', 'aria-label': 'Ключові показники' },
    tile('Отримано', String(events.length), `за ${perDay.size} ${plural(perDay.size, ['день', 'дні', 'днів'])}`),
    tile('Ігор на 100%', String(completed), `з ${state.games.length}`),
    tile('Найдовша серія', `${best} ${plural(best, ['день', 'дні', 'днів'])}`, 'днів поспіль з досягненнями'),
    tile('Поточна серія', `${current} ${plural(current, ['день', 'дні', 'днів'])}`, current ? 'так тримати!' : 'відмітьте щось сьогодні'),
  );
}

// ---------- Підказка ----------

function attachTooltip(target, tooltip, text) {
  const show = () => {
    tooltip.textContent = text;
    tooltip.hidden = false;
    const rect = target.getBoundingClientRect();
    const tip = tooltip.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - tip.width / 2), window.innerWidth - tip.width - 8);
    tooltip.style.left = `${left + window.scrollX}px`;
    tooltip.style.top = `${rect.top + window.scrollY - tip.height - 8}px`;
  };
  const hide = () => {
    tooltip.hidden = true;
  };
  target.addEventListener('pointerenter', show);
  target.addEventListener('pointerleave', hide);
  target.addEventListener('focus', show);
  target.addEventListener('blur', hide);
  target.addEventListener('click', show);
}

// ---------- Календар активності ----------

/** Рівень інтенсивності 0–4 відносно найактивнішого дня. */
function level(count, max) {
  if (!count) return 0;
  if (max <= 4) return Math.min(4, count);
  return Math.min(4, Math.ceil((count / max) * 4));
}

function heatmapPanel(perDay, tooltip) {
  const today = startOfDay(Date.now());
  // Останній стовпчик — поточний тиждень (понеділок..неділя).
  const weekday = (today.getDay() + 6) % 7;
  const start = new Date(today.getTime() - (weekday + (WEEKS - 1) * 7) * DAY);
  const max = Math.max(1, ...perDay.values());

  const cells = [];
  const monthLabels = [];
  let lastMonth = null;
  for (let week = 0; week < WEEKS; week += 1) {
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day);
      if (day === 0 && date.getMonth() !== lastMonth) {
        lastMonth = date.getMonth();
        monthLabels.push(el('span', { class: 'heatmap__month', style: { 'grid-column': String(week + 1) } }, monthShort.format(date)));
      }
      if (date > today) {
        cells.push(el('span', { class: 'heatmap__cell heatmap__cell--future', 'aria-hidden': 'true' }));
        continue;
      }
      const count = perDay.get(dayKey(date)) || 0;
      const cell = el('span', { class: `heatmap__cell heatmap__cell--l${level(count, max)}` });
      attachTooltip(cell, tooltip, `${formatDate(date.toISOString())}: ${count ? pluralAch(count) : 'нічого'}`);
      cells.push(cell);
    }
  }

  const legend = el(
    'div',
    { class: 'heatmap__legend', 'aria-hidden': 'true' },
    'Менше',
    [0, 1, 2, 3, 4].map((l) => el('span', { class: `heatmap__cell heatmap__cell--l${l}` })),
    'Більше',
  );

  return el(
    'section',
    { class: 'panel', 'aria-labelledby': 'heatmap-title' },
    el('h2', { class: 'panel__title', id: 'heatmap-title' }, 'Активність за пів року'),
    el(
      'div',
      { class: 'heatmap', role: 'img', 'aria-label': `Календар отриманих досягнень за останні ${WEEKS} тижнів. Деталі — у таблиці за місяцями нижче.` },
      el('div', { class: 'heatmap__months' }, monthLabels),
      el('div', { class: 'heatmap__body' },
        el('div', { class: 'heatmap__weekdays' }, WEEKDAYS.map((d, i) => el('span', {}, i % 2 === 0 ? d : ''))),
        el('div', { class: 'heatmap__grid' }, cells),
      ),
    ),
    legend,
  );
}

// ---------- Графік за місяцями ----------

function monthlyPanel(events, tooltip) {
  const now = new Date();
  const months = [];
  for (let i = MONTHS - 1; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ date, key: `${date.getFullYear()}-${date.getMonth()}`, count: 0 });
  }
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const event of events) {
    const d = new Date(event.time);
    const month = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (month) month.count += 1;
  }
  const max = Math.max(1, ...months.map((m) => m.count));
  const maxIndex = months.findIndex((m) => m.count === max);

  const bars = months.map((m, index) => {
    // Підписуємо лише максимум і поточний місяць, решта — у підказці й таблиці.
    const labelled = m.count > 0 && (index === maxIndex || index === months.length - 1);
    const column = el(
      'div',
      { class: 'bars__column', tabindex: '0', 'aria-label': `${monthLong.format(m.date)}: ${pluralAch(m.count)}` },
      el('span', { class: 'bars__value', hidden: !labelled }, String(m.count)),
      el('div', { class: 'bars__bar', style: { height: `${(m.count / max) * 100}%` } }),
    );
    attachTooltip(column, tooltip, `${monthLong.format(m.date)}: ${pluralAch(m.count)}`);
    return column;
  });

  const table = el(
    'details',
    { class: 'table-view' },
    el('summary', {}, 'Таблиця за місяцями'),
    el(
      'table',
      { class: 'data-table' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Місяць'), el('th', { scope: 'col', class: 'num' }, 'Отримано'))),
      el('tbody', {}, [...months].reverse().map((m) => el('tr', {}, el('td', {}, monthLong.format(m.date)), el('td', { class: 'num' }, String(m.count))))),
    ),
  );

  return el(
    'section',
    { class: 'panel', 'aria-labelledby': 'months-title' },
    el('h2', { class: 'panel__title', id: 'months-title' }, 'Отримано за місяцями'),
    el(
      'div',
      { class: 'bars' },
      el('div', { class: 'bars__plot' }, bars),
      el('div', { class: 'bars__axis', 'aria-hidden': 'true' }, months.map((m) => el('span', {}, monthShort.format(m.date).replace('.', '')))),
    ),
    table,
  );
}

// ---------- Підсумки по іграх ----------

function gamesPanel(state) {
  const rows = state.games
    .map((game) => ({ game, p: gameProgress(game), summary: gameSummary(game) }))
    .filter((row) => row.summary)
    .sort((a, b) => b.summary.last.time - a.summary.last.time);

  return el(
    'section',
    { class: 'panel', 'aria-labelledby': 'games-title' },
    el('h2', { class: 'panel__title', id: 'games-title' }, 'Підсумки по іграх'),
    el(
      'div',
      { class: 'table-scroll' },
      el(
        'table',
        { class: 'data-table' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { scope: 'col' }, 'Гра'),
            el('th', { scope: 'col', class: 'num' }, 'Прогрес'),
            el('th', { scope: 'col' }, 'Перше'),
            el('th', { scope: 'col' }, 'Останнє'),
            el('th', { scope: 'col', class: 'num' }, 'До 100%'),
          ),
        ),
        el(
          'tbody',
          {},
          rows.map(({ game, p, summary }) =>
            el(
              'tr',
              {},
              el('td', {}, el('a', { href: `#/game/${game.id}` }, game.title)),
              el('td', { class: 'num' }, `${p.done} / ${p.total}`),
              el('td', {}, formatDate(summary.first.achievement.doneAt)),
              el('td', {}, formatDate(summary.last.achievement.doneAt)),
              el('td', { class: 'num' }, summary.complete ? `${summary.days} ${plural(summary.days, ['день', 'дні', 'днів'])}` : '—'),
            ),
          ),
        ),
      ),
    ),
  );
}
