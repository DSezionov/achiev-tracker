// Спільні елементи інтерфейсу: іконки, progress bar, діалоги, сповіщення.

import { el } from './utils.js';
import { getPref, setPref } from './store.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M6 9l6 6 6-6',
  link: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  trophy:
    'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  upload: 'M12 21V9M7 14l5-5 5 5M5 3h14',
  sync: 'M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M18 2v4h-4M6 22v-4h4',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
};

/** Декоративна SVG-іконка (aria-hidden). */
export function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.appendChild(path);
  return svg;
}

/** Кнопка з іконкою і прихованим текстом для скрінрідерів. */
export function iconButton(name, label, attrs = {}) {
  return el(
    'button',
    { type: 'button', title: label, ...attrs, class: `btn btn--icon ${attrs.class || ''}`.trim(), 'aria-label': label },
    icon(name),
  );
}

/** Обгортка для справжнього чекбокса з намальованою галочкою. */
export function checkMark(input, modifier = '') {
  return el('span', { class: `check ${modifier}`.trim() }, input, icon('check', 'icon check__mark'));
}

/**
 * Progress bar з підписом. Повертає { element, set(progress) }.
 * size: 'sm' | 'md' | 'lg'
 */
export function progressBar({ label, size = 'md', showText = true } = {}) {
  const fill = el('div', { class: 'progress__fill' });
  const track = el(
    'div',
    {
      class: 'progress__track',
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-label': label,
    },
    fill,
  );
  const caption = showText ? el('div', { class: 'progress__text' }) : null;
  const element = el('div', { class: `progress progress--${size}` }, track, caption);

  function set({ done, total, percent }) {
    fill.style.setProperty('--progress', `${percent}%`);
    track.setAttribute('aria-valuenow', String(percent));
    track.setAttribute('aria-valuetext', `${done} з ${total} (${percent}%)`);
    element.classList.toggle('is-complete', total > 0 && done === total);
    if (caption) caption.textContent = `${done} з ${total} (${percent}%)`;
  }

  return { element, set };
}

// ---------- Діалоги ----------

/**
 * Модальний діалог на <dialog>. Повертає Promise зі значенням натиснутої кнопки
 * або null, якщо діалог закрили.
 *
 * actions: [{ value, label, variant: 'primary' | 'danger' | 'ghost' }]
 * requireText: рядок, який треба ввести для підтвердження небезпечної дії.
 */
export function openDialog({ title, message, content, actions, requireText }) {
  return new Promise((resolve) => {
    const confirmInput = requireText
      ? el('input', {
          class: 'input',
          type: 'text',
          autocomplete: 'off',
          spellcheck: 'false',
          'aria-label': `Введіть «${requireText}» для підтвердження`,
        })
      : null;

    const buttons = actions.map((action) =>
      el(
        'button',
        {
          type: 'button',
          class: `btn btn--${action.variant || 'ghost'}`,
          dataset: { value: String(action.value) },
          onclick: () => close(action.value),
        },
        action.label,
      ),
    );

    const guarded = buttons.filter((_, i) => actions[i].variant === 'danger');
    const syncGuard = () => {
      const ok = !confirmInput || confirmInput.value.trim() === requireText;
      for (const btn of guarded) btn.disabled = !ok;
    };

    const dialog = el(
      'dialog',
      { class: 'dialog', 'aria-labelledby': 'dialog-title' },
      el(
        'form',
        { method: 'dialog', class: 'dialog__body', onsubmit: (e) => e.preventDefault() },
        el('h2', { class: 'dialog__title', id: 'dialog-title' }, title),
        message ? el('p', { class: 'dialog__message' }, message) : null,
        content || null,
        confirmInput
          ? el(
              'label',
              { class: 'field' },
              el('span', { class: 'field__label' }, `Щоб підтвердити, введіть: ${requireText}`),
              confirmInput,
            )
          : null,
        el('div', { class: 'dialog__actions' }, buttons),
      ),
    );

    let settled = false;
    function close(value) {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    }

    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(null);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close(null);
    });
    if (confirmInput) {
      confirmInput.addEventListener('input', syncGuard);
      syncGuard();
    }

    document.body.appendChild(dialog);
    dialog.showModal();
    (confirmInput || buttons.find((b) => !b.disabled && b.dataset.value !== 'true') || buttons[0]).focus();
  });
}

/** Підтвердження так/ні. Повертає true/false. */
export async function confirmDialog({
  title,
  message,
  confirmLabel = 'Підтвердити',
  cancelLabel = 'Скасувати',
  danger = false,
  requireText,
}) {
  const result = await openDialog({
    title,
    message,
    requireText,
    actions: [
      { value: false, label: cancelLabel, variant: 'ghost' },
      { value: true, label: confirmLabel, variant: danger ? 'danger' : 'primary' },
    ],
  });
  return result === true;
}

// ---------- Сповіщення ----------

/** Коротке сповіщення внизу екрана. type: 'info' | 'success' | 'error' */
export function toast(message, { type = 'info', duration = 3500 } = {}) {
  const region = document.getElementById('toasts');
  if (!region) return;
  const item = el('div', { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  region.appendChild(item);
  setTimeout(() => {
    item.classList.add('is-leaving');
    setTimeout(() => item.remove(), 300);
  }, duration);
}

/** Заголовок сторінки і фокус для скрінрідерів після переходу. */
export function setPageTitle(title) {
  document.title = title ? `${title} — Трекер досягнень` : 'Трекер досягнень';
}

// ---------- Тема ----------

const THEME_COLORS = { dark: '#0f1115', light: '#f6f7fb' };

export function getTheme() {
  return getPref('theme', 'dark') === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme = getTheme()) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}

export function setTheme(theme) {
  setPref('theme', theme);
  applyTheme(theme);
}
