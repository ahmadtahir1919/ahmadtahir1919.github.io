// Small helpers shared by the dashboard views.

import { S, t } from "../core/strings.js";
import { el, formatDate, formatDateTime, timeAgo, toast } from "../ui/components.js";
import { prefersReducedMotion } from "../ui/motion.js";

/** An inline icon from the references' own path data (static constants, never user text). */
export function svg(paths, { size = 20, stroke = "2.2" } = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const node = document.createElementNS(ns, "svg");
  const attrs = { width: String(size), height: String(size), viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": stroke, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" };
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.innerHTML = paths;
  return node;
}

/** "Ayesha Siddiqui" → "Ayesha"; blank → "". */
export function firstNameOf(name) {
  return String(name ?? "").trim().split(/\s+/)[0] || "";
}

/** one/many string pair → the right one for [n], with {n} filled in. */
export function plural(n, one, many) {
  return n === 1 ? one : t(many, { n });
}

/** "4:00 PM" when [ms] is today, otherwise "Oct 4, 4:00 PM". */
export function timeOrDate(ms) {
  const date = new Date(ms);
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return formatDateTime(ms);
}

/** "5 min ago" / "3 h ago" today, then "yesterday", a weekday within the week, then the date. */
export function relativeDay(ms) {
  const date = new Date(ms);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return timeAgo(ms);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return S.YESTERDAY;
  return sinceDay(ms);
}

/** "Thursday" within the last week, otherwise the date. */
export function sinceDay(ms) {
  const days = (Date.now() - ms) / 86400000;
  if (days < 7) return new Date(ms).toLocaleDateString(undefined, { weekday: "long" });
  return formatDate(ms);
}

/** "SU" from "Science Unit 4", "MA" from "Maths", "BC" from "Biology — Chapter 4". Only words
 *  with a letter or digit count, so a dash or emoji never becomes an initial. */
export function initialsOf(title) {
  const words = String(title ?? "")
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}

/** HH:MM:SS for a number of seconds. */
export function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Copies [text] and plays the reference's "Copied" tooltip on [node]. */
export async function copyWithTip(node, text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast(S.ERR_COPY_FAILED, { tone: "error" });
    return;
  }
  node.dataset.tip = S.COPIED;
  node.classList.remove("dv-copied");
  void node.offsetWidth;
  node.classList.add("dv-copied");
}

/** Counts every [data-count] under [root] up from 0 with an ease-out cubic, after [delay] ms
 *  over [duration] ms (the welcome reference: 500/900; dashboard.html: 400/700). Reduced
 *  motion jumps to the number. */
export function countUp(root, { delay = 500, duration = 900 } = {}) {
  const reduce = prefersReducedMotion();
  root.querySelectorAll("[data-count]").forEach((node) => {
    const to = Number(node.dataset.count);
    if (reduce) {
      node.textContent = String(to);
      return;
    }
    const t0 = performance.now() + delay;
    const d = duration;
    const frame = (now) => {
      const p = Math.min(1, Math.max(0, (now - t0) / d));
      node.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1 && node.isConnected) requestAnimationFrame(frame);
    };
    frame(t0);
  });
}

const SITE_LINKS = [
  ["https://quizoma.com/privacy/", () => S.FOOT_PRIVACY],
  ["https://quizoma.com/terms/", () => S.FOOT_TERMS],
  ["https://quizoma.com/faq/", () => S.FOOT_HELP],
  // There is no feedback form on the web; the site's contact page is where feedback goes.
  ["https://quizoma.com/contact/", () => S.FOOT_FEEDBACK],
];

/** The page footer from design-reference/dashboard.html, shown in both dashboard states. */
export function footer() {
  return el("footer", { class: "dv-foot" }, [
    el("p", { class: "dv-f-copy", text: t(S.FOOT_COPY, { year: new Date().getFullYear() }) }),
    el(
      "nav",
      { class: "dv-f-links", "aria-label": S.FOOT_LABEL },
      SITE_LINKS.map(([href, label]) => el("a", { href, target: "_blank", rel: "noopener", text: label() }))
    ),
  ]);
}
