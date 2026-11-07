// Головна: загальний прогрес, статистика і сітка карток ігор.

import {
  getState,
  subscribe,
  gameProgress,
  totalProgress,
  achievementStats,
  moveGame,
  getPref,
  setPref,
} from '../store.js';
import { el, safeUrl, safeColor, readableTextColor, formatDate, plural } from '../utils.js';
import { icon, iconButton, progressBar, setPageTitle } from '../ui.js';
import { loadExampleData } from './settings.js';

const SORTS = {
  manual: 'Ручний порядок',
  title: 'За назвою',
  progress: 'За прогресом',
};

export function renderHome(root) {
  setPageTitle('');
  const draw = () => drawHome(root);
  draw();
  return subscribe(draw);
}

function drawHome(root) {
  const state = getState();
  const sort = SORTS[getPref('homeSort')] ? getPref('homeSort') : 'manual';

  if (!state.games.length) {
    root.replaceChildren(emptyState());
    return;
  }

  const total = totalProgress(state);
  const overall = progressBar({ label: 'Загальний прогрес', size: 'lg' });
  overall.set(total);
  const completed = state.games.filter((g) => {
    const p = gameProgress(g);
    return p.total > 0 && p.done === p.total;
  }).length;

  const summary = el(
    'section',
    { class: 'panel overview', 'aria-labelledby': 'overview-title' },
    el('h1', { class: 'overview__title', id: 'overview-title' }, 'Загальний прогрес'),
    overall.element,
    el(
      'p',
      { class: 'overview__meta' },
      `${state.games.length} ${plural(state.games.length, ['гра', 'гри', 'ігор'])}, закрито на 100%: ${completed}`,
    ),
    statsBlock(state),
  );

  const sortSelect = el(
    'select',
    {
      class: 'select',
      id: 'home-sort',
      value: sort,
      onchange: (event) => {
        setPref('homeSort', event.target.value);
        drawHome(root);
      },
    },
    Object.entries(SORTS).map(([value, label]) => el('option', { value }, label)),
  );

  const toolbar = el(
    'div',
    { class: 'toolbar' },
    el(
      'div',
      { class: 'toolbar__group' },
      el('label', { class: 'toolbar__label', for: 'home-sort' }, 'Сортування'),
      sortSelect,
    ),
    el('a', { class: 'btn btn--primary', href: '#/game/new/edit' }, icon('plus'), 'Додати гру'),
  );

  const games = sortGames(state.games, sort);
  const grid = el(
    'ul',
    { class: 'game-grid', 'aria-label': 'Ігри' },
    games.map((game, index) =>
      gameCard(game, {
        manual: sort === 'manual',
        index,
        count: games.length,
        onMove: (delta, focusKey) => {
          moveGame(game.id, delta);
          // Підписка вже перемалювала сітку — повертаємо фокус на ту саму кнопку.
          root.querySelector(`[data-focus="${focusKey}"]:not(:disabled)`)?.focus();
        },
      }),
    ),
  );

  root.replaceChildren(summary, toolbar, grid);
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

function gameCard(game, { manual, index, count, onMove }) {
  const p = gameProgress(game);
  const accent = safeColor(game.accent);
  const bar = progressBar({ label: `Прогрес: ${game.title}`, size: 'sm', showText: false });
  bar.set(p);
  const complete = p.total > 0 && p.done === p.total;

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

  const reorder = manual && count > 1
    ? el(
        'div',
        { class: 'game-card__reorder' },
        iconButton('up', `Перемістити «${game.title}» вище`, {
          disabled: index === 0,
          dataset: { focus: `up-${game.id}` },
          onclick: () => onMove(-1, `up-${game.id}`),
        }),
        iconButton('down', `Перемістити «${game.title}» нижче`, {
          disabled: index === count - 1,
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
      game.platform ? el('p', { class: 'game-card__platform' }, game.platform) : null,
      bar.element,
      el(
        'div',
        { class: 'game-card__footer' },
        el('span', { class: 'game-card__count' }, `${p.done} / ${p.total}`),
        complete ? el('span', { class: 'badge badge--success' }, icon('trophy'), '100%') : null,
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
