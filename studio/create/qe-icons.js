// The editor's glyphs, drawn exactly as in design-reference/editor.html (object I and the
// inline SVGs there). Static constants only — never user text — so parsing them is safe.

import { QUESTION_TYPES as T } from "../core/models.js";

const SVG = (attrs, body) => `<svg ${attrs} fill="none" stroke="currentColor" aria-hidden="true">${body}</svg>`;

/** Question-type icons (15px), keyed by the stored type. */
export const TYPE_ICON = {
  [T.SINGLE_CHOICE]: SVG('width="15" height="15" viewBox="0 0 24 24" stroke-width="2.2"', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>'),
  [T.MULTIPLE_CORRECT]: SVG('width="15" height="15" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"', '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8 12 3 3 5-6"/>'),
  [T.TRUE_FALSE]: SVG('width="15" height="15" viewBox="0 0 24 24" stroke-width="2.2"', '<rect x="2.5" y="7" width="19" height="10" rx="5"/><circle cx="16" cy="12" r="2.6" fill="currentColor"/>'),
  [T.WRITTEN]: SVG('width="15" height="15" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round"', '<path d="M5 5h14M12 5v14"/>'),
  [T.FILL_BLANK]: SVG('width="15" height="15" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round"', '<path d="M4 8h16M4 16h5M14 16h6"/>'),
  [T.POLL]: SVG('width="15" height="15" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round"', '<path d="M6 20V11M12 20V5M18 20v-6M3 20h18"/>'),
};

const S18 = 'width="18" height="18" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const G = {
  plus: SVG(S18, '<path d="M12 5v14M5 12h14"/>'),
  back: SVG('width="15" height="15" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"', '<path d="M15 18l-6-6 6-6"/>'),
  check14: SVG('class="sv-ok" width="14" height="14" viewBox="0 0 24 24" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"', '<path d="M20 6 9 17l-5-5"/>'),
  undo: SVG('width="17" height="17" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"', '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: SVG('width="17" height="17" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"', '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  keyboard: SVG(S18, '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12.5h.01M10 12.5h.01M14 12.5h.01M18 12.5h.01M8 16h8"/>'),
  close14: SVG('width="14" height="14" viewBox="0 0 24 24" stroke-width="2.4" stroke-linecap="round"', '<path d="M6 6l12 12M18 6 6 18"/>'),
  eye: SVG('class="eye" width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"', '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  importIcon: SVG('width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"', '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/>'),
  results: SVG('width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"', '<path d="M6 20V11M12 20V5M18 20v-6M3 20h18"/>'),
  copy16: SVG('width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"', '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
  send: SVG('width="15" height="15" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"', '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'),
  save: SVG('width="15" height="15" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"', '<path d="M20 6 9 17l-5-5"/>'),
  shield: SVG('width="13" height="13" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"', '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/>'),
  grip: '<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="2" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>',
  addSmall: SVG('width="15" height="15" viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round"', '<path d="M12 5v14M5 12h14"/>'),
  bankSmall: SVG('width="15" height="15" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"', '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Zm0 0A2 2 0 0 0 6 22h13"/>'),
  caret: SVG('class="car" width="12" height="12" viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round"', '<path d="m6 9 6 6 6-6"/>'),
  dup: SVG('width="15" height="15" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"', '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
  del: SVG('width="15" height="15" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"', '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
  arrowRight: SVG('width="16" height="16" viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"', '<path d="M5 12h14M13 6l6 6-6 6"/>'),
  stepTick: SVG('width="10" height="10" viewBox="0 0 24 24" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"', '<path d="m5 12 5 5 9-10"/>'),
  bolt: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  sparkle: SVG('width="14" height="14" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"', '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'),
  hidePanel: SVG('width="16" height="16" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"', '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16M9 10l2 2-2 2"/>'),
  sliders: SVG('width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"', '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  sliders2: SVG('width="15" height="15" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"', '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  infinity18: SVG('width="18" height="18" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"', '<path d="M12 12c-2-2.7-3.6-4-5.5-4a4 4 0 0 0 0 8c1.9 0 3.5-1.3 5.5-4Zm0 0c2 2.7 3.6 4 5.5 4a4 4 0 0 0 0-8c-1.9 0-3.5 1.3-5.5 4Z"/>'),
  alarm18: SVG('width="18" height="18" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round"', '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 2h6M19 5l1.5 1.5"/>'),
  clock18: SVG('width="18" height="18" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round"', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  clock13: SVG('width="13" height="13" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round"', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  inf13: SVG('width="13" height="13" viewBox="0 0 24 24" stroke-width="2.4" stroke-linecap="round"', '<path d="M18.2 8.8a4.4 4.4 0 1 1 0 6.4L12 9l-6.2 6.2a4.4 4.4 0 1 1 0-6.4L12 15z"/>'),
  okBig: '<svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>',
  whatsapp: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/></svg>',
};

/** Parses one of the constants above into an element. */
export function svg(markup, cls) {
  const tpl = document.createElement("template");
  tpl.innerHTML = markup.trim();
  const node = tpl.content.firstChild;
  if (cls) node.classList.add(...cls.split(" "));
  return node;
}
