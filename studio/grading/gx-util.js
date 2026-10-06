// Small shared pieces for the grading suite — the helpers at the top of
// design-reference/grading.html (COLS, ini, colOf, fmt, norm, groupable, when), the type
// colours, the reference's inline SVG glyphs, and the motion helpers every view uses.

import { QUESTION_TYPES as QT } from "../core/models.js";
import { S, t } from "../core/strings.js";
import { el } from "../ui/components.js";

export const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const EASE = "cubic-bezier(.2,.8,.2,1)";
export const SPRING = "cubic-bezier(.34,1.56,.64,1)";

/** Question-type colours, the editor's. Soft backgrounds are computed in CSS (color-mix). */
export const TYPES = {
  [QT.SINGLE_CHOICE]: { c: "#4f46e5", n: () => S.GX_T_SINGLE },
  [QT.MULTIPLE_CORRECT]: { c: "#7c3aed", n: () => S.GX_T_MULTI },
  [QT.TRUE_FALSE]: { c: "#0d9488", n: () => S.GX_T_TF },
  [QT.WRITTEN]: { c: "#ea580c", n: () => S.GX_T_WRITTEN },
  [QT.FILL_BLANK]: { c: "#0284c7", n: () => S.GX_T_BLANKS },
  [QT.POLL]: { c: "#db2777", n: () => S.GX_T_POLL },
};
export const typeOf = (type) => TYPES[type] ?? TYPES[QT.SINGLE_CHOICE];
/** The type pill's computed soft background, so it works in dark mode too. */
export const softOf = (c) => `color-mix(in srgb,${c} 15%,var(--surface))`;

/** Student avatar colours: picked from the name, so a student has one colour everywhere. */
export const COLS = ["#4f46e5", "#0d9488", "#db2777", "#ea580c", "#0284c7", "#7c3aed", "#15803d", "#b45309", "#be123c", "#334155"];
export const colOf = (name) => COLS[[...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLS.length];
export const ini = (name) =>
  String(name)
    .trim()
    .split(/\s+/)
    .map((x) => [...x][0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
export const firstName = (name) => String(name).trim().split(/\s+/)[0] ?? "";

/** Marks as shown: whole numbers (save_grades stores ints); null as an en dash. */
export const fmt = (n) => (n == null ? "–" : String(Math.round(n * 10) / 10));

/** Answer normalisation for grouping: lower-case, no punctuation, single spaces. */
export const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
/** Short answers (≤ 50 chars, ≤ 6 words once normalised) group with identical ones. */
export const groupable = (s) => {
  const n = norm(s);
  return n.length > 0 && n.length <= 50 && n.split(" ").length <= 6;
};

/** "12 min ago" / "3 h ago" / "4 Oct" — the reference's relative time. */
export function when(ms) {
  if (!ms) return "—";
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return t(S.GX_MIN_AGO, { n: Math.max(0, m) });
  if (m < 1440) return t(S.GX_H_AGO, { n: Math.round(m / 60) });
  return new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** One-or-many string pick: the _ONE string when n is 1, else the _MANY one, with {n} filled. */
export const plural = (n, one, many, vars = {}) => t(n === 1 ? one : many, { n, ...vars });

/** An initials tile (.ini) in a colour. */
export const iniTile = (name, color, attrs = {}) => el("span", { class: "ini", vars: { c: color }, text: ini(name), ...attrs });

/** Restart the reference's .shk shake on a node. */
export function shake(node) {
  if (!node) return;
  node.classList.remove("shk");
  void node.offsetWidth;
  node.classList.add("shk");
}

/** Count a number up over 450 ms (ease-out cubic); jumps straight there with reduced motion. */
export function countTo(node, v) {
  const from = Number(node.dataset.v) || 0;
  node.dataset.v = v;
  if (reduce() || from === v) {
    node.textContent = String(v);
    return;
  }
  const t0 = performance.now();
  const d = 450;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / d);
    const e = 1 - Math.pow(1 - p, 3);
    if (node.dataset.v !== String(v)) return; // a newer count took over
    node.textContent = String(Math.round(from + (v - from) * e));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** WAAPI animate unless reduced motion is on. Returns the Animation or null. */
export function anim(node, frames, opts) {
  if (!node || reduce()) return null;
  return node.animate(frames, opts);
}

// ── The reference's inline SVGs (static constants, never user text) ─────────
const NS = "http://www.w3.org/2000/svg";
export function svg(inner, { w = 16, h = w, fill = "none", stroke = "currentColor", sw = 2, vb = "0 0 24 24", cls = "", lc = "round", lj = "round", style } = {}) {
  const node = document.createElementNS(NS, "svg");
  if (w) node.setAttribute("width", w);
  if (h) node.setAttribute("height", h);
  node.setAttribute("viewBox", vb);
  if (fill) node.setAttribute("fill", fill);
  if (stroke) node.setAttribute("stroke", stroke);
  if (stroke) node.setAttribute("stroke-width", sw);
  if (lc) node.setAttribute("stroke-linecap", lc);
  if (lj) node.setAttribute("stroke-linejoin", lj);
  node.setAttribute("aria-hidden", "true");
  if (cls) node.setAttribute("class", cls);
  if (style) node.setAttribute("style", style);
  node.innerHTML = inner;
  return node;
}

export const G = {
  bolt: (w = 15) => svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', { w, fill: "currentColor", stroke: null, lc: null, lj: null }),
  grid: () => svg('<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="15" width="7" height="5" rx="1.5"/><rect x="14" y="15" width="7" height="5" rx="1.5"/>', { w: 15, sw: 2.2 }),
  person: (w = 15, sw = 2.2) => svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>', { w, sw, lj: null }),
  back: () => svg('<path d="M15 18l-6-6 6-6"/>', { w: 15, sw: 2.2 }),
  check: (w = 14, sw = 2.6) => svg('<path d="M20 6 9 17l-5-5"/>', { w, sw }),
  download: () => svg('<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/>', { w: 17, sw: 2.2 }),
  keyboard: () =>
    svg('<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12.5h.01M10 12.5h.01M14 12.5h.01M18 12.5h.01M7 16h10"/>', { w: 18 }),
  chevron: (w = 15, sw = 2.4, cls = "") => svg('<path d="m6 9 6 6 6-6"/>', { w, sw, lj: null, cls }),
  split: () => svg('<circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/>', { w: 15, lj: null }),
  comment: () => svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>', { w: 15 }),
  search: (w = 16, style) => svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', { w, sw: 2.2, lj: null, style }),
  send: (w = 14) => svg('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>', { w, sw: 2.2 }),
  undo: (w = 15) => svg('<path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 3v6h6"/>', { w, sw: 2.3 }),
  redo: (w = 15) => svg('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>', { w, sw: 2.3 }),
  poll: (w = 15) => svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', { w, sw: 2.3, lj: null }),
  x: () => svg('<path d="M6 6l12 12M18 6 6 18"/>', { w: 16, sw: 2.4, lj: null }),
  warn: () => svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>', { w: 16, sw: 2.2, lj: null, style: "flex:none;margin-top:1px" }),
  okCircle: () => svg('<circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/>', { w: null, vb: "0 0 52 52", fill: null, stroke: null, lc: null, lj: null }),
  // bottom tabs
  tabDash: () => svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>', { w: 20 }),
  tabPlus: () => svg('<path d="M12 5v14M5 12h14"/>', { w: 16, sw: 2.6, lj: null }),
  tabGrade: () => svg('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', { w: 20 }),
  tabMore: () => svg('<path d="M4 6h16M4 12h16M4 18h16"/>', { w: 20, lj: null }),
  // report dialog option icons
  rClass: () => svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.6.3 4.4 2.1 5 5.4"/>', { w: 17, sw: 2.1 }),
  rSome: () => svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 10 2 2 3-3M7 16h.01M12 16h5M14 11h3"/>', { w: 17, sw: 2.1 }),
  rOne: () => svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>', { w: 17, sw: 2.1, lj: null }),
  rSum: () => svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', { w: 17, sw: 2.1, lj: null }),
  rCard: () => svg('<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h7M9 17h5"/>', { w: 17, sw: 2.1 }),
  rCmp: () =>
    svg('<path d="M4 6h9M4 12h14M4 18h6"/><circle cx="16" cy="6" r="1.6" fill="currentColor"/><circle cx="20.5" cy="12" r="1.6" fill="currentColor"/><circle cx="13" cy="18" r="1.6" fill="currentColor"/>', { w: 17, sw: 2.1, lj: null }),
  rBoth: () => svg('<rect x="3" y="6" width="13" height="16" rx="2"/><path d="M8 2h11a2 2 0 0 1 2 2v14"/>', { w: 17, sw: 2.1 }),
};

/** A <kbd> chip. */
export const kbd = (text, attrs = {}) => el("kbd", { ...attrs, text });
/** The white-on-accent kbd used inside primary buttons. */
export const kbdOnPri = (text) => el("kbd", { style: "background:rgba(255,255,255,.2);color:#fff;border-color:rgba(255,255,255,.3)", text });

/** The reference's 500-char counter: turns warn at 450, red at 500. */
export function updCounter(node, length) {
  node.textContent = t(S.GX_CHARS, { n: length, max: 500 });
  node.className = `cc${length >= 450 && length < 500 ? " near" : length >= 500 ? " full" : ""}`;
}

/** Feedback chips append their text to a note (". " between sentences), max 500. */
export const FEEDBACK_CHIPS = () => [S.GX_FC_WELL, S.GX_FC_PARTLY, S.GX_FC_INCOMPLETE, S.GX_FC_SPELLING, S.GX_FC_OFFTOPIC];
export function appendChip(textarea, chip) {
  const cur = textarea.value.trim();
  textarea.value = ((cur ? cur.replace(/[.]?$/, ". ") : "") + chip + ".").slice(0, 500);
  textarea.dispatchEvent(new Event("input"));
  textarea.focus();
}

/** True while focus is in something you type into: single-key shortcuts stand down. */
export const typing = () => {
  const a = document.activeElement;
  return !!a && (["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName) || a.isContentEditable);
};
