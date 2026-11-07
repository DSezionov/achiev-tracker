// Головна: загальний прогрес, статистика, пошук, фільтр за статусом,
// сітка карток ігор і архів.

import {
  getState,
  subscribe,
  gameProgress,
  gameAchievements,
  totalProgress,
  achievementStats,
  remainingMissables,
  isComplete,
  moveGame,
  getPref,
  setPref,
  GAME_STATUSES,
} from '../store.js';
import { el, safeUrl, safeColor, readableTextColor, formatDate, plural, normalizeForSearch } from '../utils.js';
import { icon, iconButton, progressBar, setPageTitle } from '../ui.js';
import { loadExampleData } from './settings.js';

const SORTS = {
  manual: 'Ручний порядок',
  title: 'За назвою',
  progress: 'За прогресом',
};

const STATUS_FILTERS = { all: 'Усі', ...GAME_STATUSES };

export function renderHome(root) {
  setPageTitle('');
  const view = { query: '' };
  const draw = () => drawHome(root, view);
  draw();
  return subscribe(draw);
}

function drawHome(root, view) {
  const state = getState();
  const sort = SORTS[getPref('homeSort')] ? getPref('homeSort') : 'manual';
  const statusFilter = STATUS_FILTERS[getPref('homeStatus')] ? getPref('homeStatus') : 'all';

  if (!state.games.length) {
    root.replaceChildren(emptyState());
    return;
  }

  // Перемальовування не має збивати фокус і курсор у полі пошуку.
  const hadSearchFocus = document.activeElement?.id === 'home-search';
  const caret = hadSearchFocus ? document.activeElement.selectionStart : null;

  const total = totalProgress(state);
  const overall = progressBar({ label: 'Загальний прогрес', size: 'lg' });
  overall.set(total);
  const completed = state.games.filter((g) => isComplete(gameProgress(g))).length;

  const summary = el(
    'section',
    { class: 'panel overview', 'aria-labelledby': 'overview-title' },
    el(
      'div',
      { class: 'overview__head' },
      el('h1', { class: 'overview__title', id: 'overview-title' }, 'Загальний прогрес'),
      el('a', { class: 'btn btn--ghost btn--sm', href: '#/stats' }, icon('chart'), 'Статистика'),
    ),
    overall.element,
    el(
      'p',
      { class: 'overview__meta' },
      `${state.games.length} ${plural(state.games.length, ['гра', 'гри', 'ігор'])}, закрито на 100%: ${completed}`,
    ),
    statsBlock(state),
  );

  const rerender = () => drawHome(root, view);

  const search = el('input', {
    class: 'input search__input',
    type: 'search',
    id: 'home-search',
    placeholder: 'Пошук ігор',
    'aria-label': 'Пошук ігор за назвою або платформою',
    value: view.query,
    oninput: (event) => {
      view.query = event.target.value;
      rerender();
    },
  });

  const sortSelect = el(
    'select',
    {
      class: 'select',
      id: 'home-sort',
      value: sort,
      onchange: (event) => {
        setPref('homeSort', event.target.value);
        rerender();
      },
    },
    Object.entries(SORTS).map(([value, label]) => el('option', { value }, label)),
  );

  const statusSelect = el(
    'select',
    {
      class: 'select',
      id: 'home-status',
      value: statusFilter,
      onchange: (event) => {
        setPref('homeStatus', event.target.value);
        rerender();
      },
    },
    Object.entries(STATUS_FILTERS).map(([value, label]) => el('option', { value }, label)),
  );

  const toolbar = el(
    'div',
    { class: 'toolbar' },
    el('div', { class: 'search toolbar__search' }, icon('search', 'icon search__icon'), search),
    el(
      'div',
      { class: 'toolbar__group' },
      el('label', { class: 'toolbar__label', for: 'home-status' }, 'Статус'),
      statusSelect,
    ),
    el(
      'div',
      { class: 'toolbar__group' },
      el('label', { class: 'toolbar__label', for: 'home-sort' }, 'Сортування'),
      sortSelect,
    ),
    el('a', { class: 'btn btn--primary', href: '#/game/new/edit' }, icon('plus'), 'Додати гру'),
  );

  const query = normalizeForSearch(view.query.trim());
  const matches = (g) =>
    (statusFilter === 'all' || g.status === statusFilter) &&
    (!query || normalizeForSearch(`${g.title}\n${g.platform}`).includes(query));

  const active = sortGames(state.games.filter((g) => !g.archived), sort);
  const archived = sortGames(state.games.filter((g) => g.archived), sort);
  const visible = active.filter(matches);
  const visibleArchived = archived.filter(matches);
  // Ручне впорядкування має сенс лише коли видно всі активні ігри.
  const canReorder = sort === 'manual' && !query && statusFilter === 'all';

  const grid = (games, reorder) =>
    el(
      'ul',
      { class: 'game-grid', 'aria-label': 'Ігри' },
      games.map((game, index) =>
        gameCard(game, {
          manual: reorder,
          first: index === 0,
          last: index === games.length - 1,
          onMove: (delta, focusKey) => {
            // У state.games ігри з архіву теж є — рухаємо до сусідньої видимої.
            const ids = state.games.map((g) => g.id);
            const neighbour = games[index + delta];
            if (!neighbour) return;
            const steps = ids.indexOf(neighbour.id) - ids.indexOf(game.id);
            moveGame(game.id, steps);
            // Підписка вже перемалювала сітку — повертаємо фокус на ту саму кнопку.
            root.querySelector(`[data-focus="${focusKey}"]:not(:disabled)`)?.focus();
          },
        }),
      ),
    );

  const content = [summary, toolbar];
  if (visible.length) content.push(grid(visible, canReorder));
  else if (active.length || !archived.length) content.push(el('p', { class: 'muted empty-results' }, 'Нічого не знайдено.'));

  if (visibleArchived.length) {
    const details = el(
      'details',
      {
        class: 'archive',
        open: getPref('archiveOpen', false) || Boolean(query),
        ontoggle: (event) => {
          if (!query) setPref('archiveOpen', event.target.open);
        },
      },
      el('summary', { class: 'archive__title' }, icon('archive'), `Архів (${visibleArchived.length})`),
      grid(visibleArchived, false),
    );
    content.push(details);
  }

  root.replaceChildren(...content);

  if (hadSearchFocus) {
    const input = root.querySelector('#home-search');
    input.focus();
    input.setSelectionRange(caret, caret);
  }
}

function sortGames(games, sort) {
  const list = [...games];
  if (sort === 'title') {
    list.sort((a, b) => a.title.localeCompare(b.title, 'uk'));
  } else if (sort === 'progress') {
    const percent = new Map(list.map((g) => [g.id, gameProgress(g).percent]));
    list.sort((a, b) => percent.get(b.id) - percent.get(a.id) || a.title.localeCompare(b.title, 'uk'));
  }
  return list;
}

function gameCard(game, { manual, first, last, onMove }) {
  const p = gameProgress(game);
  const accent = safeColor(game.accent);
  const bar = progressBar({ label: `Прогрес: ${game.title}`, size: 'sm', showText: false });
  bar.set(p);
  const complete = isComplete(p);
  const missables = remainingMissables(gameAchievements(game));

  const cover = el(
    'div',
    {
      class: 'game-card__cover',
      style: { '--game-accent': accent, '--game-accent-contrast': readableTextColor(accent) },
    },
    el('span', { class: 'game-card__initial', 'aria-hidden': 'true' }, [...game.title][0]?.toUpperCase() || '?'),
  );
  const coverUrl = safeUrl(game.coverUrl);
  if (coverUrl) {
    const img = el('img', { src: coverUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove());
    cover.appendChild(img);
  }

  const reorder = manual && !(first && last)
    ? el(
        'div',
        { class: 'game-card__reorder' },
        iconButton('up', `Перемістити «${game.title}» вище`, {
          disabled: first,
          dataset: { focus: `up-${game.id}` },
          onclick: () => onMove(-1, `up-${game.id}`),
        }),
        iconButton('down', `Перемістити «${game.title}» нижче`, {
          disabled: last,
          dataset: { focus: `down-${game.id}` },
          onclick: () => onMove(1, `down-${game.id}`),
        }),
      )
    : null;

  return el(
    'li',
    { class: `game-card${complete ? ' is-complete' : ''}`, style: { '--game-accent': accent } },
    cover,
    el(
      'div',
      { class: 'game-card__body' },
      el('h2', { class: 'game-card__title' }, el('a', { class: 'game-card__link', href: `#/game/${game.id}` }, game.title)),
      el(
        'p',
        { class: 'game-card__platform' },
        [game.platform, game.status !== 'playing' ? GAME_STATUSES[game.status] : ''].filter(Boolean).join(' · ') || ' ',
      ),
      bar.element,
      el(
        'div',
        { class: 'game-card__footer' },
        el('span', { class: 'game-card__count' }, `${p.done} / ${p.total}`),
        complete ? el('span', { class: 'badge badge--success' }, icon('trophy'), '100%') : null,
        !complete && missables
          ? el('span', { class: 'badge badge--warning', title: 'Пропускні досягнення, які ще не отримано' }, `${missables} ${plural(missables, ['пропускне', 'пропускні', 'пропускних'])}`)
          : null,
      ),
    ),
    reorder,
  );
}

function statsBlock(state) {
  const { last, week, month } = achievementStats(state);
  if (!last) return null;
  return el(
    'dl',
    { class: 'stats' },
    el(
      'div',
      { class: 'stats__item stats__item--wide' },
      el('dt', {}, 'Останнє отримане'),
      el(
        'dd',
        {},
        el('a', { href: `#/game/${last.game.id}` }, last.achievement.name),
        el('span', { class: 'stats__muted' }, ` — ${last.game.title}, ${formatDate(last.achievement.doneAt)}`),
      ),
    ),
    el('div', { class: 'stats__item' }, el('dt', {}, 'За тиждень'), el('dd', {}, String(week))),
    el('div', { class: 'stats__item' }, el('dt', {}, 'За місяць'), el('dd', {}, String(month))),
  );
}

function emptyState() {
  return el(
    'section',
    { class: 'panel empty' },
    el('div', { class: 'empty__icon' }, icon('trophy')),
    el('h1', {}, 'Ще немає жодної гри'),
    el('p', { class: 'muted' }, 'Додайте гру, перенесіть досягнення з гайду і відмічайте отримані.'),
    el(
      'div',
      { class: 'empty__actions' },
      el('a', { class: 'btn btn--primary', href: '#/game/new/edit' }, icon('plus'), 'Додати гру'),
      el('button', { type: 'button', class: 'btn btn--ghost', onclick: () => loadExampleData() }, 'Завантажити приклад'),
    ),
  );
}
