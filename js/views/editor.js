// Редактор гри: поля гри, розділи, досягнення, швидке додавання і масовий імпорт.
// Зміни зберігаються одразу: текстові поля — на подію change (втрата фокусу / Enter),
// структурні дії (додати, перемістити, видалити) — по кліку.

import {
  getGame,
  subscribe,
  createGame,
  updateGame,
  deleteGame,
  addSection,
  renameSection,
  deleteSection,
  moveSection,
  addAchievement,
  updateAchievement,
  deleteAchievement,
  moveAchievement,
  moveAchievementToSection,
  importSections,
  findSectionByTitle,
  DEFAULT_ACCENT,
  DEFAULT_SECTION_TITLE,
} from '../store.js';
import { el, safeColor, plural } from '../utils.js';
import { icon, iconButton, checkMark, confirmDialog, toast, setPageTitle } from '../ui.js';
import { parseBulkText, parseJsonImport, looksLikeJson } from '../import.js';

let fieldCounter = 0;
const nextId = (prefix) => `${prefix}-${++fieldCounter}`;

export function renderEditor(root, { id }) {
  if (id === 'new') return renderNewGame(root);

  const game = getGame(id);
  if (!game) {
    root.replaceChildren(
      el(
        'section',
        { class: 'panel empty' },
        el('h1', {}, 'Гру не знайдено'),
        el('a', { class: 'btn btn--primary', href: '#/' }, 'На головну'),
      ),
    );
    return null;
  }
  setPageTitle(`Редагування: ${game.title}`);

  const sectionsHost = el('div', { class: 'editor-sections' });
  const quickAdd = quickAddForm(id);
  const redraw = () => {
    const current = getGame(id);
    if (!current) {
      location.hash = '#/';
      return;
    }
    drawSections(sectionsHost, current, redraw);
    quickAdd.refreshSections(current);
  };

  root.replaceChildren(
    el(
      'div',
      { class: 'editor' },
      el('a', { class: 'back-link', href: `#/game/${id}` }, icon('back'), 'До гри'),
      el('h1', {}, 'Редагування гри'),
      gameFieldsForm(game, {
        onChange: (patch) => updateGame(id, patch),
      }),
      editorPanel('Додати досягнення', quickAdd.element),
      editorPanel('Масовий імпорт', bulkImport(id), { collapsible: true }),
      el(
        'section',
        { class: 'panel', 'aria-labelledby': 'sections-title' },
        el('h2', { id: 'sections-title', class: 'panel__title' }, 'Розділи і досягнення'),
        sectionsHost,
        addSectionForm(id),
      ),
      dangerZone(game),
    ),
  );
  redraw();

  // Перемальовуємо список при структурних змінах. Зміни тексту в полях
  // не потребують перебудови, тому ігноруємо їх, поки фокус у редакторі.
  let lastStructure = structureKey(getGame(id));
  const unsubscribe = subscribe(({ source }) => {
    const current = getGame(id);
    if (!current) {
      if (source === 'remote') location.hash = '#/';
      return;
    }
    const key = structureKey(current);
    if (key !== lastStructure || source === 'remote') {
      lastStructure = key;
      keepScroll(redraw);
    }
  });

  return () => {
    // Зберегти поле, яке зараз редагується (change спрацює на blur).
    if (root.contains(document.activeElement)) document.activeElement.blur();
    unsubscribe();
  };
}

/** Порядок розділів і досягнень, назви розділів. */
function structureKey(game) {
  if (!game) return '';
  return game.sections
    .map((s) => `${s.id}:${s.title}:${s.achievements.map((a) => a.id).join(',')}`)
    .join('|');
}

/** Перебудова без стрибка прокрутки і з поверненням фокусу на ту саму кнопку чи поле. */
function keepScroll(fn) {
  const y = window.scrollY;
  const active = document.activeElement;
  const owner = active?.closest?.('[data-id]');
  const label = active?.getAttribute?.('aria-label');
  fn();
  window.scrollTo(0, y);
  if (!owner) return;
  const scope = document.querySelector(`[data-id="${CSS.escape(owner.dataset.id)}"]`);
  if (!scope) return;
  const target =
    (label && scope.querySelector(`[aria-label="${CSS.escape(label)}"]:not(:disabled)`)) ||
    scope.querySelector('button:not(:disabled), input, select, textarea');
  target?.focus({ preventScroll: true });
}

function editorPanel(title, content, { collapsible = false } = {}) {
  if (collapsible) {
    return el(
      'details',
      { class: 'panel panel--details' },
      el('summary', { class: 'panel__title' }, title),
      content,
    );
  }
  const titleId = nextId('panel');
  return el(
    'section',
    { class: 'panel', 'aria-labelledby': titleId },
    el('h2', { class: 'panel__title', id: titleId }, title),
    content,
  );
}

// ---------- Поля гри ----------

function field(label, control, { hint, wide = false } = {}) {
  const id = control.id || nextId('field');
  control.id = id;
  return el(
    'div',
    { class: wide ? 'field field--wide' : 'field' },
    el('label', { class: 'field__label', for: id }, label),
    control,
    hint ? el('p', { class: 'field__hint' }, hint) : null,
  );
}

function gameFieldsForm(game, { onChange, onSubmit }) {
  const values = {
    title: game?.title || '',
    platform: game?.platform || '',
    accent: safeColor(game?.accent, DEFAULT_ACCENT),
    coverUrl: game?.coverUrl || '',
    guideUrl: game?.guideUrl || '',
    notes: game?.notes || '',
  };

  const bind = (key) => (event) => {
    const value = event.target.value;
    if (key === 'title' && !value.trim()) {
      event.target.value = values.title;
      toast('Назва гри обов’язкова', { type: 'error' });
      return;
    }
    values[key] = value;
    onChange?.({ [key]: value });
  };

  const title = el('input', {
    class: 'input',
    type: 'text',
    required: true,
    maxlength: '200',
    value: values.title,
    autocomplete: 'off',
    onchange: bind('title'),
  });
  const platform = el('input', {
    class: 'input',
    type: 'text',
    value: values.platform,
    placeholder: 'Steam, PlayStation, Xbox…',
    list: 'platform-options',
    onchange: bind('platform'),
  });
  const accent = el('input', {
    class: 'color-input',
    type: 'color',
    value: values.accent,
    onchange: bind('accent'),
  });
  const coverUrl = el('input', {
    class: 'input',
    type: 'url',
    value: values.coverUrl,
    placeholder: 'https://…',
    inputmode: 'url',
    onchange: bind('coverUrl'),
  });
  const guideUrl = el('input', {
    class: 'input',
    type: 'url',
    value: values.guideUrl,
    placeholder: 'https://…',
    inputmode: 'url',
    onchange: bind('guideUrl'),
  });
  const notes = el('textarea', { class: 'input textarea', rows: '3', value: values.notes, onchange: bind('notes') });

  const platformOptions = el(
    'datalist',
    { id: 'platform-options' },
    ['Steam', 'PlayStation', 'Xbox', 'Nintendo Switch', 'Epic Games', 'GOG', 'Android', 'iOS'].map((p) =>
      el('option', { value: p }),
    ),
  );

  const form = el(
    'form',
    { class: 'panel form-grid', novalidate: !onSubmit },
    field('Назва *', title, { wide: true }),
    field('Платформа', platform),
    field('Колір акценту', accent),
    field('URL обкладинки', coverUrl),
    field('URL гайду', guideUrl),
    field('Нотатки', notes, { wide: true }),
    platformOptions,
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!onSubmit) {
      document.activeElement?.blur();
      return;
    }
    const data = {
      title: title.value,
      platform: platform.value,
      accent: accent.value,
      coverUrl: coverUrl.value,
      guideUrl: guideUrl.value,
      notes: notes.value,
    };
    if (!data.title.trim()) {
      title.focus();
      toast('Вкажіть назву гри', { type: 'error' });
      return;
    }
    onSubmit(data);
  });

  if (onSubmit) {
    form.appendChild(
      el('div', { class: 'form-actions' }, el('button', { type: 'submit', class: 'btn btn--primary' }, 'Створити гру')),
    );
  }
  form.titleInput = title;
  return form;
}

// ---------- Нова гра ----------

function renderNewGame(root) {
  setPageTitle('Нова гра');
  const form = gameFieldsForm(null, {
    onSubmit: (data) => {
      const game = createGame(data);
      toast('Гру створено. Тепер додайте досягнення.', { type: 'success' });
      location.replace(`#/game/${game.id}/edit`);
    },
  });

  const jsonArea = el('textarea', {
    class: 'input textarea textarea--code',
    rows: '6',
    spellcheck: 'false',
    placeholder: '{ "title": "Назва гри", "sections": [ … ] }',
    'aria-label': 'JSON гри',
  });
  const jsonImport = el(
    'details',
    { class: 'panel panel--details' },
    el('summary', { class: 'panel__title' }, 'Або вставте JSON гри'),
    el('p', { class: 'field__hint' }, 'Об’єкт гри без id, done і doneAt — їх буде згенеровано.'),
    jsonArea,
    el(
      'div',
      { class: 'form-actions' },
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary',
          onclick: () => {
            try {
              const parsed = parseJsonImport(jsonArea.value);
              if (parsed.kind !== 'game') throw new Error('Тут очікується одна гра. Повний експорт імпортуйте в Налаштуваннях.');
              const game = createGame(parsed.game);
              toast('Гру імпортовано', { type: 'success' });
              location.replace(`#/game/${game.id}`);
            } catch (error) {
              toast(error.message, { type: 'error' });
            }
          },
        },
        'Створити з JSON',
      ),
    ),
  );

  root.replaceChildren(
    el(
      'div',
      { class: 'editor' },
      el('a', { class: 'back-link', href: '#/' }, icon('back'), 'Усі ігри'),
      el('h1', {}, 'Нова гра'),
      form,
      jsonImport,
    ),
  );
  form.titleInput.focus();
  return null;
}

// ---------- Швидке додавання ----------

function quickAddForm(gameId) {
  const sectionSelect = el('select', { class: 'select' });
  const name = el('input', { class: 'input', type: 'text', autocomplete: 'off', required: true });
  const condition = el('input', { class: 'input', type: 'text', autocomplete: 'off' });
  const tip = el('input', { class: 'input', type: 'text', autocomplete: 'off' });
  const missable = el('input', { type: 'checkbox', class: 'checkbox' });
  const missableId = nextId('missable');
  missable.id = missableId;

  const form = el(
    'form',
    { class: 'form-grid', novalidate: true },
    field('Розділ', sectionSelect),
    field('Назва *', name),
    field('Умова', condition),
    field('Порада', tip),
    el(
      'div',
      { class: 'check-field' },
      checkMark(missable, 'check--sm'),
      el('label', { for: missableId }, 'Можна пропустити'),
    ),
    el(
      'div',
      { class: 'form-actions' },
      el('button', { type: 'submit', class: 'btn btn--primary' }, icon('plus'), 'Додати'),
      el('span', { class: 'field__hint' }, 'Enter у будь-якому полі теж додає.'),
    ),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!name.value.trim()) {
      name.focus();
      toast('Вкажіть назву досягнення', { type: 'error' });
      return;
    }
    addAchievement(gameId, sectionSelect.value, {
      name: name.value,
      condition: condition.value,
      tip: tip.value,
      missable: missable.checked,
    });
    toast(`Додано: ${name.value.trim()}`, { type: 'success', duration: 1800 });
    form.reset();
    name.focus();
  });

  function refreshSections(game) {
    const selected = sectionSelect.value;
    sectionSelect.replaceChildren(...game.sections.map((s) => el('option', { value: s.id }, s.title)));
    if (game.sections.some((s) => s.id === selected)) sectionSelect.value = selected;
    sectionSelect.closest('.field').hidden = game.sections.length < 2;
  }

  return { element: form, refreshSections };
}

// ---------- Масовий імпорт ----------

function bulkImport(gameId) {
  const textarea = el('textarea', {
    class: 'input textarea textarea--code',
    rows: '8',
    spellcheck: 'false',
    'aria-label': 'Текст для імпорту',
    placeholder:
      '## Сюжет\nНовий старий друг | Пройти Кордон і поговорити з Сидоровичем.\n! Посмішка Марти | Врятувати напарника | Порада\n## Колекціонування\nСталкерстрайк | Убити 50 сталкерів хедшотами.',
  });
  const preview = el('div', { class: 'import-preview', 'aria-live': 'polite' });
  const applyBtn = el('button', { type: 'button', class: 'btn btn--primary', disabled: true }, 'Додати');
  let parsed = null;

  function analyse() {
    const game = getGame(gameId);
    parsed = null;
    applyBtn.disabled = true;
    const value = textarea.value;
    if (!value.trim()) {
      preview.replaceChildren();
      return;
    }

    let sections;
    let errors = [];
    try {
      if (looksLikeJson(value)) {
        const result = parseJsonImport(value);
        if (result.kind !== 'game') throw new Error('Очікується JSON однієї гри');
        sections = result.game.sections.map((s) => ({ title: s.title, achievements: s.achievements }));
      } else {
        ({ sections, errors } = parseBulkText(value));
      }
    } catch (error) {
      preview.replaceChildren(el('p', { class: 'error-text' }, error.message));
      return;
    }

    const achievementsCount = sections.reduce((sum, s) => sum + s.achievements.length, 0);
    const newSections = sections.filter((s) => s.title !== null && !findSectionByTitle(game, s.title));

    preview.replaceChildren(
      el(
        'p',
        { class: 'import-preview__summary' },
        `Буде додано: ${newSections.length} ${plural(newSections.length, ['розділ', 'розділи', 'розділів'])}, ` +
          `${achievementsCount} ${plural(achievementsCount, ['досягнення', 'досягнення', 'досягнень'])}`,
      ),
      el(
        'ul',
        { class: 'import-preview__list' },
        sections.map((s) => {
          const target = s.title === null ? game.sections[0]?.title || DEFAULT_SECTION_TITLE : s.title;
          const isNew = s.title !== null && !findSectionByTitle(game, s.title);
          return el(
            'li',
            {},
            `${target} — ${s.achievements.length} `,
            el('span', { class: 'muted' }, isNew ? '(новий розділ)' : '(наявний розділ)'),
          );
        }),
      ),
      errors.length
        ? el(
            'ul',
            { class: 'import-preview__errors' },
            errors.map((e) => el('li', {}, `Рядок ${e.line}: ${e.message} — пропущено`)),
          )
        : '',
    );

    if (achievementsCount || newSections.length) {
      parsed = sections;
      applyBtn.disabled = false;
    }
  }

  textarea.addEventListener('input', analyse);
  applyBtn.addEventListener('click', () => {
    if (!parsed) return;
    importSections(gameId, parsed);
    const count = parsed.reduce((sum, s) => sum + s.achievements.length, 0);
    toast(`Імпортовано ${count} ${plural(count, ['досягнення', 'досягнення', 'досягнень'])}`, { type: 'success' });
    textarea.value = '';
    analyse();
  });

  return el(
    'div',
    { class: 'bulk-import' },
    el(
      'p',
      { class: 'field__hint' },
      'Формат: «## Розділ» — новий розділ; «Назва | Умова | Порада» — досягнення; «!» на початку — можна пропустити. Також приймається JSON однієї гри.',
    ),
    textarea,
    preview,
    el('div', { class: 'form-actions' }, applyBtn),
  );
}

// ---------- Розділи і досягнення ----------

function drawSections(host, game, redraw) {
  host.replaceChildren(
    ...game.sections.map((section, index) => sectionEditor(game, section, index, redraw)),
  );
}

function sectionEditor(game, section, index, redraw) {
  const count = game.sections.length;
  const titleInput = el('input', {
    class: 'input section-editor__title',
    type: 'text',
    value: section.title,
    'aria-label': 'Назва розділу',
    onchange: (event) => renameSection(game.id, section.id, event.target.value),
  });

  const actions = el(
    'div',
    { class: 'row-actions' },
    iconButton('up', 'Розділ вище', {
      disabled: index === 0,
      onclick: () => moveSection(game.id, section.id, -1),
    }),
    iconButton('down', 'Розділ нижче', {
      disabled: index === count - 1,
      onclick: () => moveSection(game.id, section.id, 1),
    }),
    iconButton('trash', `Видалити розділ «${section.title}»`, {
      class: 'btn--danger-ghost',
      disabled: count === 1,
      onclick: async () => {
        if (section.achievements.length) {
          const ok = await confirmDialog({
            title: 'Видалити розділ?',
            message: `Розділ «${section.title}» містить ${section.achievements.length} ${plural(section.achievements.length, ['досягнення', 'досягнення', 'досягнень'])}. Їх буде видалено разом із розділом.`,
            confirmLabel: 'Видалити',
            danger: true,
          });
          if (!ok) return;
        }
        deleteSection(game.id, section.id);
      },
    }),
  );

  return el(
    'section',
    { class: 'section-editor', dataset: { id: section.id } },
    el('div', { class: 'section-editor__header' }, titleInput, actions),
    section.achievements.length
      ? el(
          'ol',
          { class: 'ach-editor-list' },
          section.achievements.map((ach, i) => achievementEditor(game, section, ach, i)),
        )
      : el('p', { class: 'muted section-editor__empty' }, 'У розділі ще немає досягнень.'),
  );
}

function achievementEditor(game, section, ach, index) {
  const update = (key) => (event) => {
    const value = key === 'missable' ? event.target.checked : event.target.value;
    if (key === 'name' && !value.trim()) {
      event.target.value = ach.name;
      toast('Назва досягнення обов’язкова', { type: 'error' });
      return;
    }
    updateAchievement(game.id, ach.id, { [key]: value });
  };

  const name = el('input', { class: 'input', type: 'text', value: ach.name, onchange: update('name') });
  const condition = el('textarea', { class: 'input textarea', rows: '2', value: ach.condition, onchange: update('condition') });
  const tip = el('textarea', { class: 'input textarea', rows: '2', value: ach.tip, onchange: update('tip') });
  const missableId = nextId('missable');
  const missable = el('input', {
    type: 'checkbox',
    class: 'checkbox',
    id: missableId,
    checked: ach.missable,
    onchange: update('missable'),
  });

  const moveTarget =
    game.sections.length > 1
      ? el(
          'select',
          {
            class: 'select select--sm',
            'aria-label': `Перенести «${ach.name}» в інший розділ`,
            onchange: (event) => {
              if (event.target.value) moveAchievementToSection(game.id, ach.id, event.target.value);
            },
          },
          el('option', { value: '' }, 'Перенести в…'),
          game.sections.filter((s) => s.id !== section.id).map((s) => el('option', { value: s.id }, s.title)),
        )
      : null;

  return el(
    'li',
    { class: 'ach-editor', dataset: { id: ach.id } },
    el(
      'div',
      { class: 'ach-editor__fields' },
      field('Назва', name),
      field('Умова', condition),
      field('Порада', tip),
      el('div', { class: 'check-field' }, checkMark(missable, 'check--sm'), el('label', { for: missableId }, 'Можна пропустити')),
    ),
    el(
      'div',
      { class: 'ach-editor__actions' },
      iconButton('up', 'Вище', {
        disabled: index === 0,
        onclick: () => moveAchievement(game.id, ach.id, -1),
      }),
      iconButton('down', 'Нижче', {
        disabled: index === section.achievements.length - 1,
        onclick: () => moveAchievement(game.id, ach.id, 1),
      }),
      moveTarget,
      iconButton('trash', `Видалити «${ach.name}»`, {
        class: 'btn--danger-ghost',
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Видалити досягнення?',
            message: `«${ach.name}» буде видалено.`,
            confirmLabel: 'Видалити',
            danger: true,
          });
          if (ok) deleteAchievement(game.id, ach.id);
        },
      }),
    ),
  );
}

function addSectionForm(gameId) {
  const input = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Назва нового розділу',
    'aria-label': 'Назва нового розділу',
    autocomplete: 'off',
  });
  const form = el(
    'form',
    { class: 'inline-form' },
    input,
    el('button', { type: 'submit', class: 'btn btn--ghost' }, icon('plus'), 'Додати розділ'),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) {
      input.focus();
      return;
    }
    addSection(gameId, title);
    input.value = '';
    input.focus();
  });
  return form;
}

// ---------- Видалення гри ----------

function dangerZone(game) {
  return el(
    'section',
    { class: 'panel panel--danger', 'aria-labelledby': 'danger-title' },
    el('h2', { class: 'panel__title', id: 'danger-title' }, 'Небезпечна зона'),
    el(
      'button',
      {
        type: 'button',
        class: 'btn btn--danger',
        onclick: async () => {
          const current = getGame(game.id);
          if (!current) return;
          const ok = await confirmDialog({
            title: 'Видалити гру?',
            message: `Гру «${current.title}» і весь прогрес буде видалено без можливості відновлення (якщо немає експорту).`,
            confirmLabel: 'Видалити гру',
            danger: true,
            requireText: current.title,
          });
          if (!ok) return;
          deleteGame(current.id);
          toast(`Гру «${current.title}» видалено`);
          location.replace('#/');
        },
      },
      icon('trash'),
      'Видалити гру',
    ),
  );
}
