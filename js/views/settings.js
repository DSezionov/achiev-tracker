// Налаштування: тема, експорт/імпорт, синхронізація з Gist, скидання даних.

import {
  getState,
  subscribe,
  replaceState,
  addGames,
  saveBackup,
  getBackup,
  resetGameProgress,
  clearAll,
  getGame,
} from '../store.js';
import { el, todayStamp, downloadFile, formatDate, plural } from '../utils.js';
import { icon, openDialog, confirmDialog, toast, setPageTitle, getTheme, setTheme } from '../ui.js';
import { parseJsonImport } from '../import.js';
import {
  getStatus,
  onStatusChange,
  connect,
  resolveInitial,
  disconnect,
  syncNow,
  STATUS_LABELS,
} from '../sync-gist.js';

const TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=gist&description=achievement-tracker';

export function renderSettings(root) {
  setPageTitle('Налаштування');
  const syncHost = el('div');
  const dangerHost = el('div');
  const backupHost = el('div');

  root.replaceChildren(
    el(
      'div',
      { class: 'settings' },
      el('a', { class: 'back-link', href: '#/' }, icon('back'), 'Усі ігри'),
      el('h1', {}, 'Налаштування'),
      themePanel(),
      el(
        'section',
        { class: 'panel', 'aria-labelledby': 'data-title' },
        el('h2', { class: 'panel__title', id: 'data-title' }, 'Експорт та імпорт'),
        el('p', { class: 'muted' }, 'Файл JSON з усіма іграми і прогресом. Зберігайте копію час від часу.'),
        dataActions(),
        backupHost,
      ),
      el(
        'section',
        { class: 'panel', 'aria-labelledby': 'sync-title' },
        el('h2', { class: 'panel__title', id: 'sync-title' }, 'Синхронізація з GitHub Gist'),
        syncHost,
      ),
      el(
        'section',
        { class: 'panel panel--danger', 'aria-labelledby': 'reset-title' },
        el('h2', { class: 'panel__title', id: 'reset-title' }, 'Скидання'),
        dangerHost,
      ),
    ),
  );

  const drawData = () => {
    backupHost.replaceChildren(...[backupInfo()].filter(Boolean));
    dangerHost.replaceChildren(dangerActions());
  };
  const drawSync = () => syncHost.replaceChildren(syncPanel(drawSync));
  drawData();
  drawSync();

  const offData = subscribe(drawData);
  const offStatus = onStatusChange(() => updateSyncStatus(syncHost));
  return () => {
    offData();
    offStatus();
  };
}

// ---------- Тема ----------

function themePanel() {
  const current = getTheme();
  return el(
    'section',
    { class: 'panel', 'aria-labelledby': 'theme-title' },
    el('h2', { class: 'panel__title', id: 'theme-title' }, 'Вигляд'),
    el(
      'fieldset',
      { class: 'segmented' },
      el('legend', { class: 'visually-hidden' }, 'Тема'),
      [
        ['dark', 'Темна'],
        ['light', 'Світла'],
      ].map(([value, label]) =>
        el(
          'label',
          { class: 'segmented__item' },
          el('input', {
            type: 'radio',
            name: 'theme',
            value,
            checked: current === value,
            onchange: () => setTheme(value),
          }),
          el('span', {}, label),
        ),
      ),
    ),
  );
}

// ---------- Експорт / імпорт ----------

function dataActions() {
  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'visually-hidden',
    id: 'import-file',
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      await importFromText(await file.text());
    } catch (error) {
      toast(error.message, { type: 'error' });
    }
  });

  return el(
    'div',
    { class: 'button-row' },
    el('button', { type: 'button', class: 'btn btn--primary', onclick: exportData }, icon('download'), 'Експорт JSON'),
    fileInput,
    el('label', { class: 'btn btn--ghost', for: 'import-file', tabindex: '0', role: 'button',
      onkeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          fileInput.click();
        }
      } }, icon('upload'), 'Імпорт JSON'),
    el('button', { type: 'button', class: 'btn btn--ghost', onclick: () => loadExampleData() }, 'Завантажити приклад'),
  );
}

function exportData() {
  downloadFile(`achievements-${todayStamp()}.json`, JSON.stringify(getState(), null, 2));
  toast('Файл експорту збережено', { type: 'success' });
}

/** Імпорт повного експорту або однієї гри з підтвердженням. */
export async function importFromText(textContent) {
  const parsed = parseJsonImport(textContent);

  if (parsed.kind === 'game') {
    addGames([parsed.game]);
    toast(`Додано гру «${parsed.game.title}»`, { type: 'success' });
    return;
  }

  const incoming = parsed.state.games;
  const hasLocal = getState().games.length > 0;
  const count = `${incoming.length} ${plural(incoming.length, ['гра', 'гри', 'ігор'])}`;

  if (!hasLocal) {
    replaceState(parsed.state);
    toast(`Імпортовано: ${count}`, { type: 'success' });
    return;
  }

  const choice = await openDialog({
    title: 'Імпорт даних',
    message: `У файлі ${count}. Замінити всі поточні дані чи додати ігри з файлу до наявних?`,
    actions: [
      { value: 'cancel', label: 'Скасувати', variant: 'ghost' },
      { value: 'merge', label: 'Додати ігри', variant: 'ghost' },
      { value: 'replace', label: 'Замінити все', variant: 'primary' },
    ],
  });

  if (choice === 'replace') {
    saveBackup(getState(), 'Перед імпортом із заміною');
    replaceState(parsed.state);
    toast('Дані замінено. Попередні збережено в резервну копію.', { type: 'success' });
  } else if (choice === 'merge') {
    addGames(incoming);
    toast(`Додано: ${count}`, { type: 'success' });
  }
}

/** Завантажує data/example.json і додає ігри з нього. */
export async function loadExampleData() {
  try {
    const response = await fetch('./data/example.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error();
    const parsed = parseJsonImport(await response.text());
    const games = parsed.kind === 'state' ? parsed.state.games : [parsed.game];
    addGames(games);
    toast('Приклад завантажено', { type: 'success' });
  } catch {
    toast('Не вдалося завантажити приклад', { type: 'error' });
  }
}

function backupInfo() {
  const backup = getBackup();
  if (!backup) return null;
  const games = backup.data.games?.length || 0;
  return el(
    'div',
    { class: 'backup-info' },
    el(
      'p',
      { class: 'muted' },
      `Резервна копія від ${formatDate(backup.savedAt)} ${new Date(backup.savedAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}` +
        ` (${games} ${plural(games, ['гра', 'гри', 'ігор'])})${backup.reason ? ` — ${backup.reason}` : ''}.`,
    ),
    el(
      'div',
      { class: 'button-row' },
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost',
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Відновити резервну копію?',
              message: 'Поточні дані буде замінено резервною копією (а самі вони стануть новою резервною копією).',
              confirmLabel: 'Відновити',
            });
            if (!ok) return;
            const current = getState();
            replaceState(backup.data);
            saveBackup(current, 'Перед відновленням резервної копії');
            toast('Резервну копію відновлено', { type: 'success' });
          },
        },
        'Відновити',
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost',
          onclick: () => downloadFile(`achievements-backup-${todayStamp()}.json`, JSON.stringify(backup.data, null, 2)),
        },
        'Завантажити копію',
      ),
    ),
  );
}

// ---------- Синхронізація ----------

function syncPanel(redraw) {
  const { config, status, error } = getStatus();

  const statusLine = el(
    'p',
    { class: 'sync-panel__status', dataset: { role: 'sync-status' } },
    syncStatusContent(status, error),
  );

  if (!config) {
    const token = el('input', {
      class: 'input',
      type: 'password',
      autocomplete: 'off',
      spellcheck: 'false',
      id: 'gist-token',
      placeholder: 'ghp_…',
    });
    const gistId = el('input', {
      class: 'input',
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      id: 'gist-id',
      placeholder: 'Необов’язково',
    });
    const submit = el('button', { type: 'submit', class: 'btn btn--primary' }, icon('sync'), 'Підключити');

    const form = el(
      'form',
      { class: 'form-grid' },
      el(
        'div',
        { class: 'sync-help' },
        el('p', {}, 'Дані зберігатимуться в секретному Gist вашого GitHub-акаунта, щоб прогрес був однаковий на ПК і телефоні.'),
        el(
          'ol',
          {},
          el(
            'li',
            {},
            'Створіть ',
            el('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Personal Access Token (classic)'),
            ' лише з правом gist.',
          ),
          el('li', {}, 'Вставте токен нижче. На другому пристрої — той самий токен; Gist знайдеться автоматично.'),
        ),
        el('p', { class: 'field__hint' }, 'Токен зберігається лише в цьому браузері і нікуди, крім api.github.com, не надсилається.'),
      ),
      el('div', { class: 'field' }, el('label', { class: 'field__label', for: 'gist-token' }, 'Токен'), token),
      el('div', { class: 'field' }, el('label', { class: 'field__label', for: 'gist-id' }, 'ID Gist'), gistId,
        el('p', { class: 'field__hint' }, 'Якщо порожньо — знайдемо Gist «achievement-tracker-data» або створимо новий.')),
      el('div', { class: 'form-actions' }, submit),
    );

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const result = await connect({ token: token.value, gistId: gistId.value });
        if (result.created) {
          toast('Створено секретний Gist і відправлено дані', { type: 'success' });
        } else {
          await chooseInitialDirection(result.pending, result.remote);
        }
        syncNow();
      } catch (error) {
        toast(error.message, { type: 'error' });
      } finally {
        submit.disabled = false;
        redraw();
      }
    });

    return form;
  }

  return el(
    'div',
    { class: 'sync-panel' },
    statusLine,
    el(
      'dl',
      { class: 'kv' },
      el('dt', {}, 'ID Gist'),
      el(
        'dd',
        {},
        el('code', {}, config.gistId),
        ' ',
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            onclick: async () => {
              try {
                await navigator.clipboard.writeText(config.gistId);
                toast('ID скопійовано');
              } catch {
                toast('Не вдалося скопіювати', { type: 'error' });
              }
            },
          },
          'Копіювати',
        ),
      ),
      config.htmlUrl
        ? [
            el('dt', {}, 'Gist'),
            el('dd', {}, el('a', { href: config.htmlUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Відкрити на GitHub')),
          ]
        : null,
    ),
    el(
      'div',
      { class: 'button-row' },
      el('button', { type: 'button', class: 'btn btn--primary', onclick: () => syncNow() }, icon('sync'), 'Синхронізувати зараз'),
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost',
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Від’єднати синхронізацію?',
              message: 'Токен буде видалено з цього браузера. Дані тут і в Gist залишаться.',
              confirmLabel: 'Від’єднати',
            });
            if (!ok) return;
            disconnect();
            redraw();
          },
        },
        'Від’єднати',
      ),
    ),
  );
}

async function chooseInitialDirection(pending, remote) {
  const local = getState();
  const remoteGames = remote?.games.length || 0;
  if (!remoteGames) {
    await resolveInitial('push', pending, remote);
    toast('Gist підключено, локальні дані відправлено', { type: 'success' });
    return;
  }
  if (!local.games.length) {
    await resolveInitial('pull', pending, remote);
    toast('Дані завантажено з Gist', { type: 'success' });
    return;
  }
  const choice = await openDialog({
    title: 'Чиї дані залишити?',
    message:
      `У Gist є ${remoteGames} ${plural(remoteGames, ['гра', 'гри', 'ігор'])}, а в цьому браузері — ${local.games.length}. ` +
      'Оберіть, яку версію вважати основною. Інша буде збережена в резервну копію (якщо це локальні дані).',
    actions: [
      { value: 'push', label: 'Відправити локальні', variant: 'ghost' },
      { value: 'pull', label: 'Взяти з Gist', variant: 'primary' },
    ],
  });
  // Закрили діалог — безпечніший варіант: нічого не перезаписувати в Gist, взяти звідти з бекапом.
  await resolveInitial(choice === 'push' ? 'push' : 'pull', pending, remote);
  toast(choice === 'push' ? 'Локальні дані відправлено в Gist' : 'Дані завантажено з Gist', { type: 'success' });
}

function syncStatusContent(status, error) {
  return [
    el('span', { class: `status-dot status-dot--${status}`, 'aria-hidden': 'true' }),
    el('span', {}, STATUS_LABELS[status]),
    error ? el('span', { class: 'muted' }, ` — ${error}`) : null,
  ];
}

function updateSyncStatus(host) {
  const line = host.querySelector('[data-role="sync-status"]');
  if (!line) return;
  const { status, error } = getStatus();
  line.replaceChildren(...syncStatusContent(status, error).filter(Boolean));
}

// ---------- Скидання ----------

function dangerActions() {
  const { games } = getState();
  const select = el(
    'select',
    { class: 'select', id: 'reset-game', disabled: !games.length },
    games.map((g) => el('option', { value: g.id }, g.title)),
  );

  return el(
    'div',
    { class: 'danger-actions' },
    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field__label', for: 'reset-game' }, 'Скинути прогрес гри'),
      el(
        'div',
        { class: 'inline-form' },
        select,
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn--danger',
            disabled: !games.length,
            onclick: async () => {
              const game = getGame(select.value);
              if (!game) return;
              const ok = await confirmDialog({
                title: 'Скинути прогрес?',
                message: `Усі досягнення гри «${game.title}» буде позначено як неотримані.`,
                confirmLabel: 'Скинути',
                danger: true,
              });
              if (!ok) return;
              resetGameProgress(game.id);
              toast('Прогрес гри скинуто');
            },
          },
          'Скинути',
        ),
      ),
    ),
    el(
      'div',
      { class: 'field' },
      el('span', { class: 'field__label' }, 'Видалити всі дані'),
      el('p', { class: 'field__hint' }, 'Усі ігри буде видалено. Поточні дані збережуться в резервну копію в цьому браузері.'),
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn--danger',
          disabled: !games.length,
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Видалити всі дані?',
              message: 'Усі ігри та прогрес буде видалено. Якщо увімкнена синхронізація, видалення потрапить і в Gist.',
              confirmLabel: 'Видалити все',
              danger: true,
              requireText: 'ВИДАЛИТИ',
            });
            if (!ok) return;
            saveBackup(getState(), 'Перед видаленням усіх даних');
            clearAll();
            toast('Усі дані видалено');
          },
        },
        icon('trash'),
        'Видалити всі дані',
      ),
    ),
  );
}
