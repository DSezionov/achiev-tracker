// Редактор гри: поля гри, розділи, досягнення, швидке додавання, масовий імпорт,
// масові дії і шаблон гри.
// Зміни зберігаються одразу: текстові поля — на подію change (втрата фокусу / Enter),
// структурні дії (додати, перемістити, видалити) — по кліку.

import {
  getGame,
  subscribe,
  createGame,
  updateGame,
  deleteGame,
  addSection,
  updateSection,
  deleteSection,
  moveSection,
  addAchievement,
  updateAchievement,
  updateAchievements,
  deleteAchievements,
  restoreAchievements,
  moveAchievement,
  moveAchievementsToSection,
  importSections,
  findSectionByTitle,
  gameTemplate,
  DEFAULT_ACCENT,
  DEFAULT_SECTION_TITLE,
  GAME_STATUSES,
} from '../store.js';
import { el, safeColor, safeUrl, steamCoverUrl, plural, downloadFile } from '../utils.js';
import { icon, iconButton, checkMark, confirmDialog, toast, setPageTitle } from '../ui.js';
import { parseBulkText, parseSteamText, parseJsonImport, looksLikeJson, fetchGameFromUrl } from '../import.js';

let fieldCounter = 0;
const nextId = (prefix) => `${prefix}-${++fieldCounter}`;
const pluralAch = (n) => `${n} ${plural(n, ['досягнення', 'досягнення', 'досягнень'])}`;

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

  const selection = new Set();
  const sectionsHost = el('div', { class: 'editor-sections' });
  const quickAdd = quickAddForm(id);
  const bulk = bulkImport(id);
  const bulkBar = bulkActionsBar(id, selection, () => redraw());
  const fields = gameFieldsForm(game, { onChange: (patch) => updateGame(id, patch) });

  function redraw() {
    const current = getGame(id);
    if (!current) {
      location.hash = '#/';
      return;
    }
    for (const achId of [...selection]) {
      if (!current.sections.some((s) => s.achievements.some((a) => a.id === achId))) selection.delete(achId);
    }
    drawSections(sectionsHost, current, selection, () => bulkBar.refresh());
    quickAdd.refreshSections(current);
    bulk.refreshSections(current);
    bulkBar.refresh();
  }

  const editor = el(
    'div',
    { class: 'editor' },
    el('a', { class: 'back-link', href: `#/game/${id}` }, icon('back'), 'До гри'),
    el('h1', {}, 'Редагування гри'),
    fields,
    editorPanel('Додати досягнення', quickAdd.element),
    editorPanel('Масовий імпорт', bulk.element, { collapsible: true }),
    el(
      'section',
      { class: 'panel', 'aria-labelledby': 'sections-title' },
      el('h2', { id: 'sections-title', class: 'panel__title' }, 'Розділи і досягнення'),
      sectionsHost,
      addSectionForm(id),
    ),
    editorPanel('Поділитися шаблоном', templatePanel(id), { collapsible: true }),
    dangerZone(game),
    bulkBar.element,
  );
  root.replaceChildren(editor);
  redraw();

  // Перемальовуємо список при структурних змінах. Якщо в цей момент
  // редагується поле — відкладаємо до втрати фокусу, щоб не загубити введене.
  let lastStructure = structureKey(getGame(id));
  let pendingRedraw = false;
  const isEditingText = () => {
    const active = document.activeElement;
    return Boolean(active && editor.contains(active) && active.matches('input[type=text], input[type=url], input[type=number], textarea'));
  };
  const onFocusOut = () => {
    setTimeout(() => {
      if (pendingRedraw && !isEditingText()) {
        pendingRedraw = false;
        keepScroll(redraw);
      }
    });
  };
  editor.addEventListener('focusout', onFocusOut);

  const unsubscribe = subscribe(({ source }) => {
    const current = getGame(id);
    if (!current) {
      if (source === 'remote') location.hash = '#/';
      return;
    }
    if (source === 'remote') fields.refresh(current);
    const key = structureKey(current);
    if (key === lastStructure && source !== 'remote') return;
    lastStructure = key;
    if (source === 'remote' && isEditingText()) {
      pendingRedraw = true;
      return;
    }
    keepScroll(redraw);
  });

  return () => {
    // Зберегти поле, яке зараз редагується (change спрацює на blur).
    if (root.contains(document.activeElement)) document.activeElement.blur();
    unsubscribe();
  };
}

/** Порядок і вміст, що впливає на вигляд списку в редакторі. */
function structureKey(game) {
  if (!game) return '';
  return JSON.stringify(
    game.sections.map((s) => [s.id, s.title, s.checkpoint, s.achievements.map((a) => a.id)]),
  );
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

function checkField(label, input) {
  input.id ||= nextId('check');
  return el('div', { class: 'check-field' }, checkMark(input, 'check--sm'), el('label', { for: input.id }, label));
}

function gameFieldsForm(game, { onChange, onSubmit }) {
  const values = {
    title: game?.title || '',
    platform: game?.platform || '',
    accent: safeColor(game?.accent, DEFAULT_ACCENT),
    coverUrl: game?.coverUrl || '',
    guideUrl: game?.guideUrl || '',
    notes: game?.notes || '',
    status: game?.status || 'playing',
    archived: Boolean(game?.archived),
  };

  const cover = el('div', { class: 'cover-preview' });
  const renderCover = () => {
    const url = safeUrl(coverUrl.value);
    cover.replaceChildren(url ? el('img', { src: url, alt: 'Попередній перегляд обкладинки', loading: 'lazy', referrerpolicy: 'no-referrer' }) : '');
    cover.hidden = !url;
    const steam = steamCoverUrl(guideUrl.value);
    steamButton.hidden = !steam || steam === coverUrl.value;
  };

  const emit = (key, value) => {
    values[key] = value;
    onChange?.({ [key]: value });
  };

  const bind = (key) => (event) => {
    let value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    if (key === 'title' && !value.trim()) {
      event.target.value = values.title;
      toast('Назва гри обов’язкова', { type: 'error' });
      return;
    }
    // Посилання на гру в Steam замість картинки — беремо обкладинку зі Steam CDN.
    if (key === 'coverUrl' && steamCoverUrl(value)) {
      value = steamCoverUrl(value);
      event.target.value = value;
    }
    emit(key, value);
    if (key === 'coverUrl' || key === 'guideUrl') renderCover();
  };

  const title = el('input', { class: 'input', type: 'text', required: true, maxlength: '200', value: values.title, autocomplete: 'off', onchange: bind('title') });
  const platform = el('input', { class: 'input', type: 'text', value: values.platform, placeholder: 'Steam, PlayStation, Xbox…', list: 'platform-options', onchange: bind('platform') });
  const status = el(
    'select',
    { class: 'select select--full', value: values.status, onchange: bind('status') },
    Object.entries(GAME_STATUSES).map(([value, label]) => el('option', { value }, label)),
  );
  const accent = el('input', { class: 'color-input', type: 'color', value: values.accent, onchange: bind('accent') });
  const coverUrl = el('input', { class: 'input', type: 'url', value: values.coverUrl, placeholder: 'https://… або посилання на гру в Steam', inputmode: 'url', onchange: bind('coverUrl') });
  const guideUrl = el('input', { class: 'input', type: 'url', value: values.guideUrl, placeholder: 'https://…', inputmode: 'url', onchange: bind('guideUrl') });
  const notes = el('textarea', { class: 'input textarea', rows: '3', value: values.notes, onchange: bind('notes') });
  const archived = el('input', { type: 'checkbox', class: 'checkbox', checked: values.archived, onchange: bind('archived') });

  const steamButton = el(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost btn--sm',
      hidden: true,
      onclick: () => {
        coverUrl.value = steamCoverUrl(guideUrl.value);
        emit('coverUrl', coverUrl.value);
        renderCover();
      },
    },
    'Взяти обкладинку зі Steam',
  );

  const platformOptions = el(
    'datalist',
    { id: 'platform-options' },
    ['Steam', 'PlayStation', 'Xbox', 'Nintendo Switch', 'Epic Games', 'GOG', 'Android', 'iOS'].map((p) => el('option', { value: p })),
  );

  const form = el(
    'form',
    { class: 'panel form-grid', novalidate: !onSubmit },
    field('Назва *', title, { wide: true }),
    field('Платформа', platform),
    field('Статус', status),
    field('Колір акценту', accent),
    field('URL гайду', guideUrl),
    el(
      'div',
      { class: 'field field--wide' },
      el('label', { class: 'field__label', for: (coverUrl.id = nextId('cover')) }, 'URL обкладинки'),
      coverUrl,
      el('p', { class: 'field__hint' }, 'Можна вставити посилання на сторінку гри в Steam — обкладинка підтягнеться сама.'),
      steamButton,
      cover,
    ),
    field('Нотатки', notes, { wide: true }),
    onSubmit ? null : el('div', { class: 'field--wide' }, checkField('В архіві (сховати з основного списку)', archived)),
    platformOptions,
  );
  renderCover();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!onSubmit) {
      document.activeElement?.blur();
      return;
    }
    const data = {
      title: title.value,
      platform: platform.value,
      status: status.value,
      accent: accent.value,
      coverUrl: steamCoverUrl(coverUrl.value) || coverUrl.value,
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

  /** Оновити поля з даних (зміни з іншого пристрою), не чіпаючи поле у фокусі. */
  form.refresh = (fresh) => {
    const controls = { title, platform, status, accent, coverUrl, guideUrl, notes };
    for (const [key, control] of Object.entries(controls)) {
      if (control === document.activeElement) continue;
      control.value = key === 'accent' ? safeColor(fresh.accent, DEFAULT_ACCENT) : fresh[key];
      values[key] = control.value;
    }
    archived.checked = fresh.archived;
    renderCover();
  };
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

  const createFromParsed = (parsed) => {
    if (parsed.kind !== 'game') throw new Error('Тут очікується одна гра. Повний експорт імпортуйте в Налаштуваннях.');
    const game = createGame(parsed.game);
    toast(`Гру «${game.title}» імпортовано`, { type: 'success' });
    location.replace(`#/game/${game.id}`);
  };

  const jsonArea = el('textarea', {
    class: 'input textarea textarea--code',
    rows: '6',
    spellcheck: 'false',
    placeholder: '{ "title": "Назва гри", "sections": [ … ] }',
    'aria-label': 'JSON гри',
  });
  const urlInput = el('input', {
    class: 'input',
    type: 'url',
    inputmode: 'url',
    placeholder: 'https://gist.githubusercontent.com/…/raw/…',
    'aria-label': 'Посилання на JSON гри',
  });

  const jsonImport = el(
    'details',
    { class: 'panel panel--details' },
    el('summary', { class: 'panel__title' }, 'Імпорт гри з JSON або за посиланням'),
    el('p', { class: 'field__hint' }, 'Шаблон гри, яким з вами поділились (кнопка «Поділитися шаблоном» у редакторі), або об’єкт гри без id, done і doneAt.'),
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
              createFromParsed(parseJsonImport(jsonArea.value));
            } catch (error) {
              toast(error.message, { type: 'error' });
            }
          },
        },
        'Створити з JSON',
      ),
    ),
    el('div', { class: 'field' }, el('span', { class: 'field__label' }, 'Або посилання на файл (наприклад, raw-файл Gist)'), el('div', { class: 'inline-form' }, urlInput,
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost',
          onclick: async (event) => {
            const url = safeUrl(urlInput.value);
            if (!url) {
              toast('Вставте коректне посилання https://…', { type: 'error' });
              return;
            }
            event.currentTarget.disabled = true;
            try {
              createFromParsed(await fetchGameFromUrl(url));
            } catch (error) {
              toast(error.message, { type: 'error' });
            } finally {
              event.currentTarget.disabled = false;
            }
          },
        },
        'Завантажити',
      ))),
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

function counterInput(value = '') {
  return el('input', {
    class: 'input input--narrow',
    type: 'number',
    min: '2',
    max: '1000000',
    step: '1',
    inputmode: 'numeric',
    placeholder: 'немає',
    value,
  });
}

function quickAddForm(gameId) {
  const sectionSelect = el('select', { class: 'select select--full' });
  const name = el('input', { class: 'input', type: 'text', autocomplete: 'off', required: true });
  const condition = el('input', { class: 'input', type: 'text', autocomplete: 'off' });
  const tip = el('input', { class: 'input', type: 'text', autocomplete: 'off' });
  const target = counterInput();
  const missable = el('input', { type: 'checkbox', class: 'checkbox' });
  const spoiler = el('input', { type: 'checkbox', class: 'checkbox' });

  const form = el(
    'form',
    { class: 'form-grid', novalidate: true },
    field('Розділ', sectionSelect),
    field('Назва *', name),
    field('Умова', condition),
    field('Порада', tip),
    field('Лічильник: ціль', target, { hint: 'Для «гриндових» досягнень, наприклад 50 убивств. Порожньо — без лічильника.' }),
    el('div', { class: 'check-row' }, checkField('Можна пропустити', missable), checkField('Спойлер', spoiler)),
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
      spoiler: spoiler.checked,
      counter: target.value ? { current: 0, target: target.value } : null,
    });
    toast(`Додано: ${name.value.trim()}`, { type: 'success', duration: 1800 });
    const keepSection = sectionSelect.value;
    form.reset();
    sectionSelect.value = keepSection;
    name.focus();
  });

  function refreshSections(game) {
    fillSectionSelect(sectionSelect, game);
    sectionSelect.closest('.field').hidden = game.sections.length < 2;
  }

  return { element: form, refreshSections };
}

function fillSectionSelect(select, game, extra = []) {
  const selected = select.value;
  select.replaceChildren(...extra, ...game.sections.map((s) => el('option', { value: s.id }, s.title)));
  if ([...select.options].some((o) => o.value === selected)) select.value = selected;
}

// ---------- Масовий імпорт ----------

function bulkImport(gameId) {
  const formatName = nextId('bulk-format');
  let mode = 'text';
  const textarea = el('textarea', {
    class: 'input textarea textarea--code',
    rows: '8',
    spellcheck: 'false',
    'aria-label': 'Текст для імпорту',
  });
  const steamSection = el('select', { class: 'select select--full' });
  const steamSectionField = field('Куди додати', steamSection);
  const hint = el('p', { class: 'field__hint' });
  const preview = el('div', { class: 'import-preview', 'aria-live': 'polite' });
  const applyBtn = el('button', { type: 'button', class: 'btn btn--primary', disabled: true }, 'Додати');
  let parsed = null;

  const HINTS = {
    text:
      'Формат: «## Розділ» — новий розділ; «Назва | Умова | Порада» — досягнення; «!» на початку — можна пропустити, «?» — спойлер; четверта колонка-число — ціль лічильника («Назва | Умова | | 50»). Також приймається JSON однієї гри.',
    steam:
      'Відкрийте сторінку досягнень гри в Steam (глобальну статистику або свою), виділіть список і скопіюйте сюди. Назви й описи розпізнаються автоматично, «Unlocked …» позначить досягнення отриманим, «23 / 50» стане лічильником. Перевірте попередній перегляд.',
  };
  const PLACEHOLDERS = {
    text: '## Сюжет\nНовий старий друг | Пройти Кордон і поговорити з Сидоровичем.\n! Посмішка Марти | Врятувати напарника | Порада\n## Колекціонування\nСталкерстрайк | Убити 50 сталкерів хедшотами. | | 50',
    steam: '52.3%\nНовий старий друг\nПройти Кордон і поговорити з Сидоровичем.\n12.1%\nСталкерстрайк\nУбити 50 сталкерів хедшотами.',
  };

  const setMode = (value) => {
    mode = value;
    hint.textContent = HINTS[mode];
    textarea.placeholder = PLACEHOLDERS[mode];
    steamSectionField.hidden = mode !== 'steam';
    analyse();
  };

  const modeSwitch = el(
    'fieldset',
    { class: 'segmented' },
    el('legend', { class: 'visually-hidden' }, 'Формат тексту'),
    [
      ['text', 'Мій формат'],
      ['steam', 'Текст зі Steam'],
    ].map(([value, label]) =>
      el(
        'label',
        { class: 'segmented__item' },
        el('input', { type: 'radio', name: formatName, value, checked: value === mode, onchange: () => setMode(value) }),
        el('span', {}, label),
      ),
    ),
  );

  function analyse() {
    const game = getGame(gameId);
    parsed = null;
    applyBtn.disabled = true;
    const value = textarea.value;
    if (!value.trim() || !game) {
      preview.replaceChildren();
      return;
    }

    let sections;
    let errors = [];
    try {
      if (mode === 'steam') {
        const target = game.sections.find((s) => s.id === steamSection.value) || game.sections[0];
        ({ sections, errors } = parseSteamText(value, target.title));
      } else if (looksLikeJson(value)) {
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
    const doneCount = sections.reduce((sum, s) => sum + s.achievements.filter((a) => a.done).length, 0);

    preview.replaceChildren(
      el(
        'p',
        { class: 'import-preview__summary' },
        `Буде додано: ${newSections.length} ${plural(newSections.length, ['розділ', 'розділи', 'розділів'])}, ${pluralAch(achievementsCount)}` +
          (doneCount ? ` (з них уже отримано: ${doneCount})` : ''),
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
      mode === 'steam' && sections[0]
        ? el(
            'ol',
            { class: 'import-preview__sample' },
            sections[0].achievements.slice(0, 5).map((a) =>
              el('li', {}, el('strong', {}, a.name), a.condition ? ` — ${a.condition}` : '', a.counter ? ` [${a.counter.current}/${a.counter.target}]` : '', a.done ? ' ✓' : ''),
            ),
          )
        : '',
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
  steamSection.addEventListener('change', analyse);
  applyBtn.addEventListener('click', () => {
    if (!parsed) return;
    importSections(gameId, parsed);
    const count = parsed.reduce((sum, s) => sum + s.achievements.length, 0);
    toast(`Імпортовано ${pluralAch(count)}`, { type: 'success' });
    textarea.value = '';
    analyse();
  });

  setMode('text');

  return {
    element: el('div', { class: 'bulk-import' }, modeSwitch, hint, steamSectionField, textarea, preview, el('div', { class: 'form-actions' }, applyBtn)),
    refreshSections: (game) => fillSectionSelect(steamSection, game),
  };
}

// ---------- Розділи і досягнення ----------

function drawSections(host, game, selection, onSelect) {
  host.replaceChildren(
    ...game.sections.map((section, index) => sectionEditor(game, section, index, selection, onSelect)),
  );
}

function sectionEditor(game, section, index, selection, onSelect) {
  const count = game.sections.length;
  const titleInput = el('input', {
    class: 'input section-editor__title',
    type: 'text',
    value: section.title,
    'aria-label': 'Назва розділу',
    onchange: (event) => updateSection(game.id, section.id, { title: event.target.value }),
  });
  const checkpoint = el('input', {
    type: 'checkbox',
    class: 'checkbox',
    checked: section.checkpoint,
    onchange: (event) => updateSection(game.id, section.id, { checkpoint: event.target.checked }),
  });

  const ids = section.achievements.map((a) => a.id);
  const selectAll = el('input', {
    type: 'checkbox',
    class: 'checkbox',
    'aria-label': `Вибрати всі в розділі «${section.title}»`,
    checked: ids.length > 0 && ids.every((id) => selection.has(id)),
    disabled: !ids.length,
    onchange: (event) => {
      for (const id of ids) {
        if (event.target.checked) selection.add(id);
        else selection.delete(id);
      }
      for (const box of event.target.closest('.section-editor').querySelectorAll('.ach-editor__select')) {
        box.checked = event.target.checked;
      }
      onSelect();
    },
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
            message: `Розділ «${section.title}» містить ${pluralAch(section.achievements.length)}. Їх буде видалено разом із розділом.`,
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
    el('div', { class: 'section-editor__header' }, checkMark(selectAll, 'check--sm'), titleInput, actions),
    checkField('Точка неповернення (після цього розділу пропускні вже не отримати)', checkpoint),
    section.achievements.length
      ? el(
          'ol',
          { class: 'ach-editor-list' },
          section.achievements.map((ach, i) => achievementEditor(game, section, ach, i, selection, onSelect)),
        )
      : el('p', { class: 'muted section-editor__empty' }, 'У розділі ще немає досягнень.'),
  );
}

/** Видаляє досягнення і пропонує скасувати. */
function deleteWithUndo(gameId, ids) {
  const removed = deleteAchievements(gameId, ids);
  if (!removed.length) return;
  const label = removed.length === 1 ? `Видалено: ${removed[0].achievement.name}` : `Видалено ${pluralAch(removed.length)}`;
  toast(label, { duration: 6000, action: { label: 'Скасувати', onClick: () => restoreAchievements(removed) } });
}

function achievementEditor(game, section, ach, index, selection, onSelect) {
  const update = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    if (key === 'name' && !value.trim()) {
      event.target.value = ach.name;
      toast('Назва досягнення обов’язкова', { type: 'error' });
      return;
    }
    if (key === 'counterTarget' && value && !(Number(value) >= 2)) {
      toast('Ціль лічильника — ціле число від 2', { type: 'error' });
      event.target.value = ach.counter?.target ?? '';
      return;
    }
    updateAchievement(game.id, ach.id, { [key]: value });
  };

  const name = el('input', { class: 'input', type: 'text', value: ach.name, onchange: update('name') });
  const condition = el('textarea', { class: 'input textarea', rows: '2', value: ach.condition, onchange: update('condition') });
  const tip = el('textarea', { class: 'input textarea', rows: '2', value: ach.tip, onchange: update('tip') });
  const note = el('textarea', { class: 'input textarea', rows: '1', value: ach.note, onchange: update('note') });
  const target = counterInput(ach.counter?.target ?? '');
  target.addEventListener('change', update('counterTarget'));
  const missable = el('input', { type: 'checkbox', class: 'checkbox', checked: ach.missable, onchange: update('missable') });
  const spoiler = el('input', { type: 'checkbox', class: 'checkbox', checked: ach.spoiler, onchange: update('spoiler') });

  const select = el('input', {
    type: 'checkbox',
    class: 'checkbox ach-editor__select',
    'aria-label': `Вибрати «${ach.name}»`,
    checked: selection.has(ach.id),
    onchange: (event) => {
      if (event.target.checked) selection.add(ach.id);
      else selection.delete(ach.id);
      onSelect();
    },
  });

  const moveTarget =
    game.sections.length > 1
      ? el(
          'select',
          {
            class: 'select select--sm',
            'aria-label': `Перенести «${ach.name}» в інший розділ`,
            onchange: (event) => {
              if (event.target.value) moveAchievementsToSection(game.id, [ach.id], event.target.value);
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
      { class: 'ach-editor__top' },
      checkMark(select, 'check--sm'),
      el('span', { class: 'ach-editor__index' }, `#${index + 1}`),
    ),
    el(
      'div',
      { class: 'ach-editor__fields' },
      field('Назва', name),
      field('Умова', condition),
      field('Порада', tip),
      field('Моя нотатка', note),
      field('Лічильник: ціль', target),
      el('div', { class: 'check-row' }, checkField('Можна пропустити', missable), checkField('Спойлер', spoiler)),
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
        onclick: () => deleteWithUndo(game.id, [ach.id]),
      }),
    ),
  );
}

// ---------- Масові дії ----------

function bulkActionsBar(gameId, selection, redraw) {
  const counter = el('span', { class: 'bulk-bar__count', 'aria-live': 'polite' });
  const moveSelect = el('select', {
    class: 'select select--sm',
    'aria-label': 'Перенести вибрані в розділ',
    onchange: (event) => {
      if (!event.target.value) return;
      moveAchievementsToSection(gameId, [...selection], event.target.value);
      toast(`Перенесено ${pluralAch(selection.size)}`);
      selection.clear();
      redraw();
    },
  });

  const flag = (key, value, label) =>
    el(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost btn--sm',
        onclick: () => {
          updateAchievements(gameId, [...selection], { [key]: value });
          toast(`${label}: ${pluralAch(selection.size)}`);
          selection.clear();
          redraw();
        },
      },
      label,
    );

  const element = el(
    'div',
    { class: 'bulk-bar', role: 'region', 'aria-label': 'Дії з вибраними досягненнями', hidden: true },
    counter,
    moveSelect,
    flag('missable', true, 'Можна пропустити'),
    flag('missable', false, 'Не пропускне'),
    flag('spoiler', true, 'Спойлер'),
    flag('spoiler', false, 'Не спойлер'),
    el(
      'button',
      {
        type: 'button',
        class: 'btn btn--danger btn--sm',
        onclick: () => {
          deleteWithUndo(gameId, [...selection]);
          selection.clear();
          redraw();
        },
      },
      icon('trash'),
      'Видалити',
    ),
    el(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost btn--sm',
        onclick: () => {
          selection.clear();
          redraw();
        },
      },
      'Зняти вибір',
    ),
  );

  function refresh() {
    element.hidden = selection.size === 0;
    counter.textContent = `Вибрано: ${selection.size}`;
    const game = getGame(gameId);
    if (!game) return;
    moveSelect.hidden = game.sections.length < 2;
    moveSelect.replaceChildren(
      el('option', { value: '' }, 'Перенести в…'),
      ...game.sections.map((s) => el('option', { value: s.id }, s.title)),
    );
  }

  return { element, refresh };
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

// ---------- Шаблон гри ----------

function templatePanel(gameId) {
  const json = () => {
    const game = getGame(gameId);
    return game ? JSON.stringify(gameTemplate(game), null, 2) : '';
  };
  const filename = () => {
    const title = getGame(gameId)?.title || 'game';
    return `template-${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}.json`;
  };
  return el(
    'div',
    { class: 'template-panel' },
    el(
      'p',
      { class: 'field__hint' },
      'Список розділів і досягнень без вашого прогресу й особистих нотаток. Друг може вставити його на сторінці «Нова гра» або завантажити за посиланням (наприклад, якщо викласти файл у публічний Gist).',
    ),
    el(
      'div',
      { class: 'button-row' },
      el('button', { type: 'button', class: 'btn btn--ghost', onclick: () => downloadFile(filename(), json()) }, icon('download'), 'Завантажити JSON'),
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(json());
              toast('Шаблон скопійовано', { type: 'success' });
            } catch {
              toast('Не вдалося скопіювати', { type: 'error' });
            }
          },
        },
        icon('share'),
        'Копіювати JSON',
      ),
    ),
  );
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
