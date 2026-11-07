// Сторінка гри: розділи, відмітка досягнень, лічильники, фокус-список,
// фільтри і пошук. Відмітка досягнення не перебудовує сторінку — оновлюються
// лише рядки й прогрес, щоб не збивати прокрутку на телефоні.

import {
  getGame,
  subscribe,
  toggleAchievement,
  restoreAchievementState,
  stepCounter,
  setCounter,
  updateAchievement,
  gameProgress,
  sectionProgress,
  isComplete,
  missablesBeforeCheckpoint,
  gameSummary,
  getPref,
  setPref,
  locateAchievement,
  GAME_STATUSES,
} from '../store.js';
import { el, safeUrl, safeColor, readableTextColor, formatDate, normalizeForSearch, plural } from '../utils.js';
import {
  icon,
  iconButton,
  checkMark,
  progressBar,
  setPageTitle,
  toast,
  vibrate,
  celebrate,
  promptDialog,
} from '../ui.js';

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

/** Скільки показувати рядок, що перестав відповідати фільтру, перш ніж сховати. */
const LEAVE_DELAY = 900;

/**
 * Відбиток структури гри без полів, які оновлюються на місці (done, лічильник,
 * фокус, нотатка): якщо він змінився, сторінку треба перебудувати.
 */
const PATCHED_KEYS = new Set(['done', 'doneAt', 'updatedAt', 'focus', 'note', 'current']);
function structureSignature(game) {
  return JSON.stringify(game, (key, value) => (PATCHED_KEYS.has(key) ? undefined : value));
}

export function renderGame(root, { id }) {
  let game = getGame(id);
  if (!game) {
    root.replaceChildren(notFound());
    setPageTitle('Гру не знайдено');
    return null;
  }

  const view = {
    gameId: id,
    filter: 'all',
    query: '',
    collapsed: new Set(getPref('collapsed', {})[id] || []),
    revealed: new Set(),
    warnedCheckpoints: new Set(),
    hideCompleted: getPref('hideCompletedSections', false),
    applyFilters: () => filterRows(refs, game, view),
    getGame: () => game,
  };
  let signature = structureSignature(game);
  let refs = build();
  let leaveTimer = null;

  function build() {
    setPageTitle(game.title);
    const result = buildPage(root, game, view);
    result.wasComplete = isComplete(gameProgress(game));
    return result;
  }

  function patch() {
    const p = gameProgress(game);
    refs.progress.set(p);
    let doneChanged = false;
    for (const section of game.sections) {
      const sectionRef = refs.sections.get(section.id);
      sectionRef?.count.replaceChildren(countText(sectionProgress(section)));
      if (sectionRef?.warning) updateCheckpointWarning(sectionRef.warning, game, section);
      for (const ach of section.achievements) {
        const row = refs.rows.get(ach.id);
        if (!row) continue;
        const wasDone = row.li.classList.contains('is-done');
        updateRow(row, ach);
        if (ach.done !== wasDone) {
          doneChanged = true;
          if (ach.done) flash(row.li);
          if (!rowVisible(ach, section, view)) row.li.classList.add('is-leaving');
        }
      }
    }
    refs.renderFocus();
    refs.renderSummary();

    const complete = isComplete(p);
    refs.banner.hidden = !complete;
    if (complete && !refs.wasComplete) {
      toast(`«${game.title}» закрито на 100%!`, { type: 'success' });
      celebrate(safeColor(game.accent));
      vibrate([30, 60, 30, 60, 90]);
    }
    refs.wasComplete = complete;

    // Рядки, що перестали відповідати фільтру, ховаємо не одразу, а з затримкою.
    if (doneChanged) {
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(view.applyFilters, LEAVE_DELAY);
    }
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
      view.applyFilters();
      window.scrollTo(0, scroll);
    } else {
      patch();
    }
  });

  return () => {
    clearTimeout(leaveTimer);
    unsubscribe();
  };
}

const countText = (p) => `${p.done} / ${p.total}`;

function buildPage(root, game, view) {
  const accent = safeColor(game.accent);
  const rows = new Map();
  const sections = new Map();

  const progress = progressBar({ label: `Прогрес гри ${game.title}`, size: 'md' });
  progress.set(gameProgress(game));

  const summary = el('p', { class: 'game-summary' });
  const renderSummary = () => {
    const data = gameSummary(view.getGame());
    summary.hidden = !data;
    if (!data) return;
    const parts = [`Перше: ${formatDate(data.first.achievement.doneAt)}`];
    if (data.last !== data.first) parts.push(`останнє: ${formatDate(data.last.achievement.doneAt)}`);
    if (data.complete) parts.push(`100% за ${data.days} ${plural(data.days, ['день', 'дні', 'днів'])}`);
    summary.textContent = parts.join(' · ');
  };
  renderSummary();

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
        el(
          'p',
          { class: 'game-header__platform' },
          game.platform || null,
          game.platform ? ' · ' : null,
          GAME_STATUSES[game.status],
          game.archived ? ' · в архіві' : null,
        ),
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
    summary,
  );

  const sticky = el('div', { class: 'game-progress' }, progress.element);

  const banner = el(
    'div',
    { class: 'complete-banner', role: 'status', hidden: !isComplete(gameProgress(game)) },
    icon('trophy'),
    el('span', {}, 'Гру закрито на 100%! Вітаємо!'),
  );

  // Фокус-список «Зараз роблю»: позначені зірочкою й ще не отримані.
  const focusHost = el('section', { class: 'focus-panel', 'aria-labelledby': 'focus-title' });
  const renderFocus = () => {
    for (const [achId, list] of rows) rows.set(achId, list.filter((r) => !r.inFocus));
    const items = [];
    const fresh = view.getGame();
    for (const section of fresh.sections) {
      for (const ach of section.achievements) if (ach.focus && !ach.done) items.push(ach);
    }
    focusHost.hidden = !items.length;
    focusHost.replaceChildren(
      el('h2', { class: 'focus-panel__title', id: 'focus-title' }, icon('star'), 'Зараз роблю'),
      el(
        'ul',
        { class: 'ach-list' },
        items.map((ach) => {
          const row = achievementRow(fresh, ach, view, { inFocus: true });
          rows.get(ach.id)?.push(row);
          return row.li;
        }),
      ),
    );
  };

  const total = gameProgress(game).total;
  const controls = total ? buildControls(game, view) : null;

  const showSectionTitles = game.sections.length > 1;
  const sectionNodes = game.sections.map((section) => {
    const list = el(
      'ul',
      { class: 'ach-list', id: `list-${section.id}` },
      section.achievements.map((ach) => {
        const row = achievementRow(game, ach, view);
        rows.set(ach.id, [row]);
        return row.li;
      }),
    );

    if (!showSectionTitles) {
      sections.set(section.id, { node: list, list, count: el('span') });
      return list;
    }

    const count = el('span', { class: 'section__count' }, countText(sectionProgress(section)));
    const toggle = el(
      'button',
      {
        type: 'button',
        class: 'section__toggle',
        'aria-expanded': String(!view.collapsed.has(section.id)),
        'aria-controls': `list-${section.id}`,
      },
      icon('chevron', 'icon section__chevron'),
      el('span', { class: 'section__title' }, section.title),
      count,
    );
    list.hidden = view.collapsed.has(section.id);
    toggle.addEventListener('click', () => {
      if (toggle.getAttribute('aria-expanded') === 'true') view.collapsed.add(section.id);
      else view.collapsed.delete(section.id);
      saveCollapsed(game.id, view.collapsed);
      view.applyFilters();
    });

    const warning = section.checkpoint ? el('p', { class: 'checkpoint-warning' }) : null;
    if (warning) updateCheckpointWarning(warning, game, section);

    const node = el(
      'section',
      { class: 'section', dataset: { id: section.id } },
      el('h2', { class: 'section__heading' }, toggle),
      section.checkpoint
        ? el('p', { class: 'checkpoint-badge' }, icon('flag'), 'Точка неповернення: після цього розділу пропускні вже не отримати')
        : null,
      warning,
      list,
    );
    sections.set(section.id, { node, list, count, toggle, warning });
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
    focusHost,
    controls,
    emptyGame,
    el('div', { class: 'sections' }, sectionNodes),
    noResults,
  );
  root.replaceChildren(page);
  renderFocus();

  const refs = { progress, rows: new RowIndex(rows), sections, banner, noResults, renderFocus, renderSummary };
  return refs;
}

/** Map id → [рядки]: одне досягнення може бути і в списку, і у фокус-панелі. */
class RowIndex {
  constructor(map) {
    this.map = map;
  }
  /** Основний рядок (у розділі). */
  get(id) {
    return this.map.get(id)?.find((r) => !r.inFocus) || null;
  }
  all(id) {
    return this.map.get(id) || [];
  }
}

function buildControls(game, view) {
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
            view.applyFilters();
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
    'aria-label': 'Пошук за назвою, умовою, порадою, нотаткою або розділом',
    value: view.query,
    oninput: (event) => {
      view.query = event.target.value;
      view.applyFilters();
    },
  });

  const multiSection = game.sections.length > 1;
  const hideCompletedId = 'hide-completed';
  const extra = multiSection
    ? el(
        'div',
        { class: 'section-tools' },
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            onclick: () => {
              view.collapsed = new Set(game.sections.map((s) => s.id));
              saveCollapsed(game.id, view.collapsed);
              view.applyFilters();
            },
          },
          'Згорнути все',
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            onclick: () => {
              view.collapsed.clear();
              saveCollapsed(game.id, view.collapsed);
              view.applyFilters();
            },
          },
          'Розгорнути все',
        ),
        el(
          'div',
          { class: 'check-field check-field--sm' },
          checkMark(
            el('input', {
              type: 'checkbox',
              class: 'checkbox',
              id: hideCompletedId,
              checked: view.hideCompleted,
              onchange: (event) => {
                view.hideCompleted = event.target.checked;
                setPref('hideCompletedSections', view.hideCompleted);
                view.applyFilters();
              },
            }),
            'check--sm',
          ),
          el('label', { for: hideCompletedId }, 'Ховати закриті розділи'),
        ),
      )
    : null;

  return el(
    'div',
    { class: 'game-controls' },
    filterGroup,
    el('div', { class: 'search' }, icon('search', 'icon search__icon'), search),
    extra,
  );
}

function snapshot(ach) {
  return { done: ach.done, doneAt: ach.doneAt, counter: ach.counter ? { ...ach.counter } : null };
}

function offerUndo(game, ach, before, message) {
  toast(message, {
    duration: 5000,
    action: { label: 'Скасувати', onClick: () => restoreAchievementState(game.id, ach.id, before) },
  });
}

/** Попередження, якщо позначаєте досягнення вже після точки неповернення з невідміченими пропускними. */
function warnPastCheckpoints(game, ach, view) {
  const found = locateAchievement(game, ach.id);
  if (!found) return;
  for (const section of game.sections) {
    if (section === found.section) break;
    if (!section.checkpoint || view.warnedCheckpoints.has(section.id)) continue;
    const left = missablesBeforeCheckpoint(game, section.id);
    if (!left) continue;
    view.warnedCheckpoints.add(section.id);
    toast(
      `Ви вже після точки неповернення «${section.title}», а до неї лишилось ${left} ${plural(left, ['пропускне досягнення', 'пропускні досягнення', 'пропускних досягнень'])}.`,
      { type: 'warning', duration: 7000 },
    );
  }
}

function achievementRow(game, ach, view, { inFocus = false } = {}) {
  const prefix = inFocus ? 'focus' : 'chk';
  const inputId = `${prefix}-${ach.id}`;
  const input = el('input', { type: 'checkbox', class: 'checkbox', id: inputId, checked: ach.done });
  const date = el('span', { class: 'ach__date' });
  const hidden = ach.spoiler && !view.revealed.has(ach.id);

  const condition = ach.condition
    ? el('span', { class: 'ach__condition', hidden }, ach.condition)
    : null;
  const tip = ach.tip
    ? el(
        'details',
        { class: 'tip', hidden },
        el('summary', {}, 'Порада'),
        el('p', { class: 'tip__text' }, ach.tip),
      )
    : null;
  const spoilerButton =
    hidden && (ach.condition || ach.tip)
      ? el(
          'button',
          {
            type: 'button',
            class: 'spoiler-btn',
            onclick: (event) => {
              view.revealed.add(ach.id);
              for (const node of [condition, tip]) if (node) node.hidden = false;
              event.currentTarget.remove();
            },
          },
          icon('eye'),
          'Спойлер — показати',
        )
      : null;

  const counter = ach.counter ? counterControl(game, ach) : null;
  const note = el('p', { class: 'ach__note' });

  const star = iconButton('star', 'Зараз роблю', {
    class: 'ach__star',
    'aria-pressed': String(ach.focus),
    onclick: () => updateAchievement(game.id, ach.id, { focus: !getCurrent(game, ach.id)?.focus }),
  });
  const noteButton = iconButton('note', 'Моя нотатка', {
    class: 'ach__note-btn',
    onclick: async () => {
      const current = getCurrent(game, ach.id);
      const value = await promptDialog({
        title: 'Моя нотатка',
        message: current?.name,
        value: current?.note || '',
        multiline: true,
      });
      if (value !== null) updateAchievement(game.id, ach.id, { note: value });
    },
  });

  const li = el(
    'li',
    { class: `ach${inFocus ? ' ach--focus' : ''}`, dataset: { id: ach.id } },
    checkMark(input),
    el(
      'div',
      { class: 'ach__content' },
      el(
        'label',
        { class: 'ach__label', for: inputId },
        el('span', { class: 'ach__name' }, ach.name),
        condition,
      ),
      spoilerButton,
      counter?.element,
      el(
        'div',
        { class: 'ach__meta' },
        ach.missable ? el('span', { class: 'badge badge--warning' }, 'Можна пропустити') : null,
        date,
      ),
      note,
      tip,
    ),
    el('div', { class: 'ach__actions' }, star, noteButton),
  );

  input.addEventListener('change', () => {
    const current = getCurrent(game, ach.id);
    if (!current) return;
    const before = snapshot(current);
    if (input.checked) {
      warnPastCheckpoints(view.getGame(), current, view);
      vibrate();
    }
    toggleAchievement(game.id, ach.id, input.checked);
    offerUndo(game, current, before, `${input.checked ? 'Отримано' : 'Знято відмітку'}: ${current.name}`);
  });
  // Клік по вільному місцю рядка теж перемикає досягнення.
  li.addEventListener('click', (event) => {
    if (event.target.closest('input, label, a, button, details, .counter')) return;
    input.click();
  });

  const row = { li, input, date, note, star, counter, inFocus };
  updateRow(row, ach);
  return row;
}

/** Актуальна версія досягнення зі сховища (замикання можуть тримати стару). */
function getCurrent(game, achId) {
  const fresh = getGame(game.id);
  return fresh ? locateAchievement(fresh, achId)?.achievement : null;
}

function counterControl(game, ach) {
  const value = el('button', {
    type: 'button',
    class: 'counter__value',
    title: 'Ввести точне значення',
    onclick: async () => {
      const current = getCurrent(game, ach.id);
      if (!current?.counter) return;
      const input = await promptDialog({
        title: 'Значення лічильника',
        message: `${current.name}: від 0 до ${current.counter.target}`,
        value: String(current.counter.current),
      });
      if (input === null) return;
      const number = Number(input.replace(',', '.'));
      if (!Number.isFinite(number)) {
        toast('Введіть число', { type: 'error' });
        return;
      }
      const before = snapshot(current);
      const result = setCounter(game.id, ach.id, number);
      if (result?.done && !before.done) offerUndo(game, current, before, `Отримано: ${current.name}`);
    },
  });
  const bar = el('div', { class: 'counter__bar' }, el('div', { class: 'counter__fill' }));
  const step = (delta) => () => {
    const current = getCurrent(game, ach.id);
    if (!current?.counter) return;
    const before = snapshot(current);
    const result = stepCounter(game.id, ach.id, delta);
    vibrate(8);
    if (result?.done && !before.done) {
      vibrate([20, 40, 20]);
      offerUndo(game, current, before, `Отримано: ${current.name}`);
    }
  };
  const element = el(
    'div',
    { class: 'counter' },
    iconButton('minus', `Зменшити лічильник «${ach.name}»`, { class: 'counter__btn', onclick: step(-1) }),
    el('div', { class: 'counter__main' }, value, bar),
    iconButton('plus', `Збільшити лічильник «${ach.name}»`, { class: 'counter__btn', onclick: step(1) }),
  );
  return { element, value, bar };
}

function updateRow(row, ach) {
  row.input.checked = ach.done;
  row.li.classList.toggle('is-done', ach.done);
  row.li.dataset.done = String(ach.done);
  row.date.textContent = ach.done && ach.doneAt ? `Отримано ${formatDate(ach.doneAt)}` : '';
  row.date.hidden = !row.date.textContent;
  row.note.replaceChildren(...(ach.note ? [icon('note'), el('span', {}, ach.note)] : []));
  row.note.hidden = !ach.note;
  row.star.setAttribute('aria-pressed', String(ach.focus));
  row.star.classList.toggle('is-active', ach.focus);
  if (row.counter && ach.counter) {
    const { current, target } = ach.counter;
    row.counter.value.textContent = `${current} / ${target}`;
    row.counter.value.setAttribute('aria-label', `Лічильник: ${current} з ${target}. Ввести точне значення`);
    row.counter.bar.firstChild.style.setProperty('--progress', `${Math.floor((current / target) * 100)}%`);
  }
}

function updateCheckpointWarning(node, game, section) {
  const left = missablesBeforeCheckpoint(game, section.id);
  node.hidden = !left;
  node.textContent = left
    ? `До цієї точки лишилось ${left} ${plural(left, ['пропускне досягнення', 'пропускні досягнення', 'пропускних досягнень'])}`
    : '';
}

function flash(li) {
  li.classList.remove('is-flash');
  // Перезапуск анімації.
  void li.offsetWidth;
  li.classList.add('is-flash');
  li.addEventListener('animationend', () => li.classList.remove('is-flash'), { once: true });
}

function matchesQuery(ach, section, query) {
  if (!query) return true;
  return normalizeForSearch(`${section.title}\n${ach.name}\n${ach.condition}\n${ach.tip}\n${ach.note}`).includes(query);
}

function rowVisible(ach, section, view) {
  const test = matchesFilter[view.filter] || matchesFilter.all;
  return test(ach) && matchesQuery(ach, section, normalizeForSearch(view.query.trim()));
}

function filterRows(refs, game, view) {
  const query = normalizeForSearch(view.query.trim());
  const narrowing = Boolean(query) || view.filter !== 'all';
  let visibleTotal = 0;

  for (const section of game.sections) {
    let visibleInSection = 0;
    for (const ach of section.achievements) {
      const row = refs.rows.get(ach.id);
      if (!row) continue;
      const visible = rowVisible(ach, section, view);
      row.li.hidden = !visible;
      row.li.classList.remove('is-leaving');
      if (visible) visibleInSection += 1;
    }
    visibleTotal += visibleInSection;

    const sectionRef = refs.sections.get(section.id);
    if (!sectionRef) continue;
    const completedHidden = view.hideCompleted && !query && isComplete(sectionProgress(section));
    sectionRef.node.hidden = (narrowing && visibleInSection === 0) || (completedHidden && game.sections.length > 1);
    if (sectionRef.toggle) {
      // Під час пошуку знайдене видно навіть у згорнутих розділах.
      const expanded = !view.collapsed.has(section.id) || Boolean(query);
      sectionRef.toggle.setAttribute('aria-expanded', String(expanded));
      sectionRef.list.hidden = !expanded;
    }
  }

  refs.noResults.hidden = !(narrowing && visibleTotal === 0);
}

function saveCollapsed(gameId, collapsed) {
  const all = getPref('collapsed', {});
  all[gameId] = [...collapsed];
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
