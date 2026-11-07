// Сторінка гри: розділи, відмітка досягнень, фільтри і пошук.
// Відмітка досягнення не перебудовує сторінку — оновлюються лише рядок і прогрес,
// щоб не збивати прокрутку на телефоні.

import {
  getGame,
  subscribe,
  toggleAchievement,
  gameProgress,
  sectionProgress,
  getPref,
  setPref,
} from '../store.js';
import { el, safeUrl, safeColor, readableTextColor, formatDate, normalizeForSearch } from '../utils.js';
import { icon, checkMark, progressBar, setPageTitle, toast } from '../ui.js';

const FILTERS = [
  ['all', 'Усі'],
  ['remaining', 'Залишилось'],
  ['done', 'Отримані'],
  ['missable', 'Можна пропустити'],
];

const matchesFilter = {
  all: () => true,
  remaining: (a) => !a.done,
  done: (a) => a.done,
  missable: (a) => a.missable,
};

/** Відбиток структури гри без прапорців done: якщо він змінився, сторінку треба перебудувати. */
function structureSignature(game) {
  return JSON.stringify(game, (key, value) => (key === 'done' || key === 'doneAt' ? undefined : value));
}

export function renderGame(root, { id }) {
  let game = getGame(id);
  if (!game) {
    root.replaceChildren(notFound());
    setPageTitle('Гру не знайдено');
    return null;
  }

  const view = { filter: 'all', query: '' };
  let signature = structureSignature(game);
  let refs = build();

  function build() {
    setPageTitle(game.title);
    const result = buildPage(root, game, view, applyFilters);
    result.wasComplete = isComplete(gameProgress(game));
    return result;
  }

  function applyFilters() {
    filterRows(refs, game, view);
  }

  function patch() {
    const p = gameProgress(game);
    refs.progress.set(p);
    for (const section of game.sections) {
      refs.sections.get(section.id)?.count.replaceChildren(countText(sectionProgress(section)));
      for (const ach of section.achievements) {
        const row = refs.rows.get(ach.id);
        if (!row) continue;
        const wasDone = row.li.classList.contains('is-done');
        updateRow(row, ach);
        if (ach.done && !wasDone) flash(row.li);
      }
    }
    const complete = isComplete(p);
    refs.banner.hidden = !complete;
    if (complete && !refs.wasComplete) {
      toast(`«${game.title}» закрито на 100%!`, { type: 'success' });
    }
    refs.wasComplete = complete;
  }

  const unsubscribe = subscribe(() => {
    const fresh = getGame(id);
    if (!fresh) {
      root.replaceChildren(notFound());
      return;
    }
    game = fresh;
    const nextSignature = structureSignature(game);
    if (nextSignature !== signature) {
      signature = nextSignature;
      const scroll = window.scrollY;
      refs = build();
      applyFilters();
      window.scrollTo(0, scroll);
    } else {
      patch();
    }
  });

  return unsubscribe;
}

const isComplete = (p) => p.total > 0 && p.done === p.total;
const countText = (p) => `${p.done} / ${p.total}`;

function buildPage(root, game, view, applyFilters) {
  const accent = safeColor(game.accent);
  const rows = new Map();
  const sections = new Map();

  const progress = progressBar({ label: `Прогрес гри ${game.title}`, size: 'md' });
  progress.set(gameProgress(game));

  const guideUrl = safeUrl(game.guideUrl);
  const header = el(
    'header',
    { class: 'game-header' },
    el('a', { class: 'back-link', href: '#/' }, icon('back'), 'Усі ігри'),
    el(
      'div',
      { class: 'game-header__main' },
      el(
        'div',
        { class: 'game-header__titles' },
        el('h1', { class: 'game-header__title' }, game.title),
        game.platform ? el('p', { class: 'game-header__platform' }, game.platform) : null,
      ),
      el('a', { class: 'btn btn--ghost', href: `#/game/${game.id}/edit` }, icon('edit'), 'Редагувати'),
    ),
    guideUrl
      ? el(
          'a',
          { class: 'guide-link', href: guideUrl, target: '_blank', rel: 'noopener noreferrer' },
          icon('link'),
          'Відкрити гайд',
        )
      : null,
    game.notes ? el('p', { class: 'game-header__notes' }, game.notes) : null,
  );

  const sticky = el('div', { class: 'game-progress' }, progress.element);

  const banner = el(
    'div',
    { class: 'complete-banner', role: 'status', hidden: !isComplete(gameProgress(game)) },
    icon('trophy'),
    el('span', {}, 'Гру закрито на 100%! Вітаємо!'),
  );

  const total = gameProgress(game).total;
  const controls = total ? buildControls(view, applyFilters) : null;

  const collapsed = new Set(getPref('collapsed', {})[game.id] || []);
  const showSectionTitles = game.sections.length > 1;
  const sectionNodes = game.sections.map((section) => {
    const list = el(
      'ul',
      { class: 'ach-list', id: `list-${section.id}` },
      section.achievements.map((ach) => {
        const row = achievementRow(game, ach);
        rows.set(ach.id, row);
        return row.li;
      }),
    );

    if (!showSectionTitles) {
      sections.set(section.id, { node: list, list, count: el('span') });
      return list;
    }

    const count = el('span', { class: 'section__count' }, countText(sectionProgress(section)));
    const isCollapsed = collapsed.has(section.id);
    const toggle = el(
      'button',
      {
        type: 'button',
        class: 'section__toggle',
        'aria-expanded': String(!isCollapsed),
        'aria-controls': `list-${section.id}`,
      },
      icon('chevron', 'icon section__chevron'),
      el('span', { class: 'section__title' }, section.title),
      count,
    );
    list.hidden = isCollapsed;
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      list.hidden = expanded;
      saveCollapsed(game.id, section.id, expanded);
    });

    const node = el(
      'section',
      { class: 'section', dataset: { id: section.id } },
      el('h2', { class: 'section__heading' }, toggle),
      list,
    );
    sections.set(section.id, { node, list, count, toggle });
    return node;
  });

  const noResults = el('p', { class: 'muted empty-results', hidden: true }, 'Нічого не знайдено.');
  const emptyGame = total
    ? null
    : el(
        'div',
        { class: 'panel empty' },
        el('p', {}, 'Досягнень ще немає.'),
        el('a', { class: 'btn btn--primary', href: `#/game/${game.id}/edit` }, icon('plus'), 'Додати досягнення'),
      );

  const page = el(
    'div',
    {
      class: 'game-page',
      style: { '--game-accent': accent, '--game-accent-contrast': readableTextColor(accent) },
    },
    header,
    sticky,
    banner,
    controls,
    emptyGame,
    el('div', { class: 'sections' }, sectionNodes),
    noResults,
  );
  root.replaceChildren(page);

  return { progress, rows, sections, banner, noResults };
}

function buildControls(view, applyFilters) {
  const filterGroup = el(
    'fieldset',
    { class: 'segmented' },
    el('legend', { class: 'visually-hidden' }, 'Фільтр досягнень'),
    FILTERS.map(([value, label]) =>
      el(
        'label',
        { class: 'segmented__item' },
        el('input', {
          type: 'radio',
          name: 'ach-filter',
          value,
          checked: view.filter === value,
          onchange: () => {
            view.filter = value;
            applyFilters();
          },
        }),
        el('span', {}, label),
      ),
    ),
  );

  const search = el('input', {
    class: 'input search__input',
    type: 'search',
    placeholder: 'Пошук досягнень',
    'aria-label': 'Пошук досягнень',
    value: view.query,
    oninput: (event) => {
      view.query = event.target.value;
      applyFilters();
    },
  });

  return el(
    'div',
    { class: 'game-controls' },
    filterGroup,
    el('div', { class: 'search' }, icon('search', 'icon search__icon'), search),
  );
}

function achievementRow(game, ach) {
  const inputId = `chk-${ach.id}`;
  const input = el('input', { type: 'checkbox', class: 'checkbox', id: inputId, checked: ach.done });
  const date = el('span', { class: 'ach__date' });
  const li = el(
    'li',
    { class: 'ach', dataset: { id: ach.id } },
    checkMark(input),
    el(
      'div',
      { class: 'ach__content' },
      el(
        'label',
        { class: 'ach__label', for: inputId },
        el('span', { class: 'ach__name' }, ach.name),
        ach.condition ? el('span', { class: 'ach__condition' }, ach.condition) : null,
      ),
      el(
        'div',
        { class: 'ach__meta' },
        ach.missable ? el('span', { class: 'badge badge--warning' }, 'Можна пропустити') : null,
        date,
      ),
      ach.tip
        ? el(
            'details',
            { class: 'tip' },
            el('summary', {}, 'Порада'),
            el('p', { class: 'tip__text' }, ach.tip),
          )
        : null,
    ),
  );

  input.addEventListener('change', () => toggleAchievement(game.id, ach.id, input.checked));
  // Клік по вільному місцю рядка теж перемикає досягнення.
  li.addEventListener('click', (event) => {
    if (event.target.closest('input, label, a, button, details')) return;
    input.click();
  });

  const row = { li, input, date };
  updateRow(row, ach);
  return row;
}

function updateRow(row, ach) {
  row.input.checked = ach.done;
  row.li.classList.toggle('is-done', ach.done);
  row.li.dataset.done = String(ach.done);
  row.date.textContent = ach.done && ach.doneAt ? `Отримано ${formatDate(ach.doneAt)}` : '';
  row.date.hidden = !row.date.textContent;
}

function flash(li) {
  li.classList.remove('is-flash');
  // Перезапуск анімації.
  void li.offsetWidth;
  li.classList.add('is-flash');
  li.addEventListener('animationend', () => li.classList.remove('is-flash'), { once: true });
}

function filterRows(refs, game, view) {
  const query = normalizeForSearch(view.query.trim());
  const test = matchesFilter[view.filter] || matchesFilter.all;
  const narrowing = Boolean(query) || view.filter !== 'all';
  let visibleTotal = 0;

  for (const section of game.sections) {
    let visibleInSection = 0;
    for (const ach of section.achievements) {
      const row = refs.rows.get(ach.id);
      if (!row) continue;
      const visible =
        test(ach) &&
        (!query || normalizeForSearch(`${ach.name}\n${ach.condition}\n${ach.tip}`).includes(query));
      row.li.hidden = !visible;
      if (visible) visibleInSection += 1;
    }
    visibleTotal += visibleInSection;

    const sectionRef = refs.sections.get(section.id);
    if (!sectionRef) continue;
    sectionRef.node.hidden = narrowing && visibleInSection === 0;
    // Під час пошуку показуємо знайдене навіть у згорнутих розділах.
    if (sectionRef.toggle) {
      const collapsed = sectionRef.toggle.getAttribute('aria-expanded') === 'false';
      sectionRef.list.hidden = collapsed && !query;
    }
  }

  refs.noResults.hidden = !(narrowing && visibleTotal === 0);
}

function saveCollapsed(gameId, sectionId, isCollapsed) {
  const all = getPref('collapsed', {});
  const set = new Set(all[gameId] || []);
  if (isCollapsed) set.add(sectionId);
  else set.delete(sectionId);
  all[gameId] = [...set];
  setPref('collapsed', all);
}

function notFound() {
  return el(
    'section',
    { class: 'panel empty' },
    el('h1', {}, 'Гру не знайдено'),
    el('p', { class: 'muted' }, 'Можливо, її видалили.'),
    el('a', { class: 'btn btn--primary', href: '#/' }, 'На головну'),
  );
}
