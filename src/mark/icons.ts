// Small inline SVG icons for the marker's toolbar. Inline so no icon library or remote asset is
// needed (ADR 0001). Each is 16x16, drawn with `currentColor`, and hidden from screen readers;
// the button's own text or aria-label names it.

const svg = (body: string) =>
  `<svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${body}</svg>`

const stroke = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'

export const ICONS = {
  open: svg(
    `<path ${stroke} d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3A1 1 0 0 0 2 4.5Z"/>`,
  ),
  tick: svg(`<path ${stroke} stroke-width="2" d="M3 8.5 6.5 12 13 4"/>`),
  cross: svg(`<path ${stroke} stroke-width="2" d="M4 4l8 8M12 4l-8 8"/>`),
  grip: svg(
    '<g fill="currentColor"><circle cx="6" cy="4" r="1.1"/><circle cx="10" cy="4" r="1.1"/><circle cx="6" cy="8" r="1.1"/><circle cx="10" cy="8" r="1.1"/><circle cx="6" cy="12" r="1.1"/><circle cx="10" cy="12" r="1.1"/></g>',
  ),
  undo: svg(`<path ${stroke} d="M5.5 3 2.5 6l3 3"/><path ${stroke} d="M2.5 6h7a4 4 0 0 1 0 8H7"/>`),
  redo: svg(`<path ${stroke} d="M10.5 3l3 3-3 3"/><path ${stroke} d="M13.5 6h-7a4 4 0 0 0 0 8H9"/>`),
  minus: svg(`<path ${stroke} d="M3.5 8h9"/>`),
  plus: svg(`<path ${stroke} d="M3.5 8h9M8 3.5v9"/>`),
  fit: svg(`<path ${stroke} d="M2.5 8h11M5 5.5 2.5 8 5 10.5M11 5.5l2.5 2.5-2.5 2.5"/>`),
  list: svg(`<path ${stroke} d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h0M2.5 8h0M2.5 12h0"/>`),
  more: svg(
    '<g fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></g>',
  ),
  download: svg(`<path ${stroke} d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>`),
  close: svg(`<path ${stroke} d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>`),
} as const

export type IconName = keyof typeof ICONS

/** Fills every element with a `data-icon` attribute with its icon, before its text. */
export function applyIcons(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    const name = el.dataset.icon as IconName
    if (ICONS[name] && !el.querySelector(':scope > svg.icon')) el.insertAdjacentHTML('afterbegin', ICONS[name])
  }
}
