// /faq/ — Help & FAQs for Studio: the app's FAQ (ui/faq/FaqData.kt) rewritten for the browser, with
// search. A hero with a big search box, a sticky topic list that follows your scrolling, and the
// answers as accordion cards, grouped by topic.
//   • typing filters across every topic at once (all words must match), marks the words found, and
//     opens the answers when only a few are left;
//   • "/" focuses the search, Esc clears it;
//   • every answer has a link of its own: /faq/#share-code opens and scrolls to it;
//   • nothing found → a card that sends the question to feedback.
// The questions and answers are data in ./faq-data.js; the search and markup rules are in
// core/faq.js (unit-tested).

import { FAQ_CATEGORIES, FAQ_ITEMS } from "./faq-data.js";
import { countByCategory, groupByCategory, searchFaq, tokenize } from "../core/faq.js";
import { requireUser } from "../core/auth.js";
import { route } from "../core/paths.js";
import { S, t } from "../core/strings.js";
import { copyText, el, renderSignInGate, renderSpinner } from "../ui/components.js";
import { stagger } from "../ui/motion.js";
import { mountShell } from "../ui/shell.js";
import * as V from "./faq-views.js";

const root = document.getElementById("root");

/** When a search leaves this many answers or fewer, they open by themselves. */
const AUTO_OPEN_AT = 3;

const state = {
  query: "",
  words: [],
  open: new Set(),
  popular: ["share code", "rapid grade", "import", "results", "locked"],
};

let shell = null;
let heroParts = null;
let navHost = null;
let listHost = null;
let observer = null;
let activeTopic = null;
let lockUntil = 0;

const handlers = {
  href: (to) => route(to),
  onToggle(id) {
    toggle(id);
  },
  onCopyLink(id) {
    copyText(`${window.location.origin}${window.location.pathname}#${id}`, S.FAQ_LINK_COPIED);
  },
  onTopic(id) {
    // While searching, a topic click leaves the search and goes to that topic.
    if (state.query) setQuery("");
    lockUntil = performance.now() + 1200; // the scroll passes other topics on the way; don't flicker through them
    document.getElementById(`topic-${id}`)?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
    setActiveTopic(id);
  },
  onQuery(query, focus = false) {
    setQuery(query);
    if (focus) heroParts.input.focus({ preventScroll: true });
  },
};

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const PHONE = window.matchMedia("(max-width: 860px)");

// ── Start ───────────────────────────────────────────────────────────────────

async function start() {
  renderSpinner(root);
  const user = await requireUser();
  if (!user) {
    renderSignInGate(root);
    return;
  }
  shell = mountShell(root, {
    user,
    active: "faq",
    title: S.FAQ_TITLE,
    crumbs: [{ label: S.NAV_DASHBOARD, href: route("") }, { label: S.FAQ_TITLE }],
    width: "wide",
  });
  shell.content.classList.add("fq-page");
  paint();
  openFromHash({ scroll: true });
  window.addEventListener("hashchange", () => openFromHash({ scroll: true }));
  document.addEventListener("keydown", onKey);
}

// ── Render ──────────────────────────────────────────────────────────────────

/** First paint: the hero, then the topic list beside the answers (each region updates in place). */
function paint() {
  heroParts = V.hero(state, handlers);
  navHost = el("aside", { class: "fq-side" });
  listHost = el("div", { class: "fq-main" });
  shell.content.replaceChildren(heroParts.node, el("div", { class: "fq-layout" }, [navHost, listHost]));
  renderList();
  stagger(shell.content);
}

/** The visible items, the topic list, the count line and the answer sections — for the current query. */
function renderList() {
  const found = searchFaq(FAQ_ITEMS, FAQ_CATEGORIES, state.query);
  const searching = state.words.length > 0;
  const groups = groupByCategory(found, FAQ_CATEGORIES);
  const counts = countByCategory(found);

  heroParts.count.textContent = !searching
    ? t(S.FAQ_COUNT_ALL, { n: FAQ_ITEMS.length, c: FAQ_CATEGORIES.length })
    : found.length === 1
      ? S.FAQ_COUNT_ONE
      : t(S.FAQ_COUNT_MANY, { n: found.length });
  heroParts.clear.hidden = !state.query;

  observer?.disconnect();
  navHost.replaceChildren(V.topics(FAQ_CATEGORIES, counts, searching ? null : (activeTopic ?? groups[0]?.category.id), handlers), expandAll(found));
  // No search: every topic with its answers. Searching: one list, best match first.
  const body = !found.length
    ? [V.noResults(state.query.trim(), handlers)]
    : searching
      ? [V.results(found, FAQ_CATEGORIES, state, handlers)]
      : groups.map((g) => V.section(g.category, g.items, state, handlers));
  listHost.replaceChildren(...body, V.stuck(handlers));
  watchTopics();
}

/** "Expand all / Collapse all" under the topic list. */
function expandAll(found) {
  const every = found.length > 0 && found.every((i) => state.open.has(i.id));
  return el("button", {
    type: "button",
    class: "link-btn fq-expand",
    hidden: found.length === 0,
    text: every ? S.FAQ_COLLAPSE_ALL : S.FAQ_EXPAND_ALL,
    onclick: () => {
      for (const i of found) every ? state.open.delete(i.id) : state.open.add(i.id);
      renderList();
    },
  });
}

// ── Behaviour ───────────────────────────────────────────────────────────────

function setQuery(query) {
  state.query = query;
  state.words = tokenize(query);
  if (heroParts.input.value !== query) heroParts.input.value = query;
  // A short list of matches opens itself; a long one stays closed so the page stays scannable.
  const found = searchFaq(FAQ_ITEMS, FAQ_CATEGORIES, query);
  if (state.words.length && found.length <= AUTO_OPEN_AT) for (const i of found) state.open.add(i.id);
  renderList();
}

/** Flips one card in place (no re-render, so the height animation plays and nothing jumps). */
function toggle(id) {
  const open = !state.open.has(id);
  if (open) state.open.add(id);
  else state.open.delete(id);
  const card = document.getElementById(`faq-${id}`);
  card?.classList.toggle("is-open", open);
  card?.querySelector(".fq-head")?.setAttribute("aria-expanded", String(open));
}

/** #share-code in the address: open that answer, scroll to it and let it glow for a moment. */
function openFromHash({ scroll }) {
  const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  const item = FAQ_ITEMS.find((i) => i.id === id);
  if (!item) return;
  if (state.query) {
    state.query = "";
    state.words = [];
    heroParts.input.value = "";
    renderList();
  }
  state.open.add(id);
  const card = document.getElementById(`faq-${id}`);
  if (!card) return;
  card.classList.add("is-open");
  card.querySelector(".fq-head")?.setAttribute("aria-expanded", "true");
  setActiveTopic(item.category);
  if (scroll) card.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
  card.classList.remove("is-flash");
  void card.offsetWidth;
  card.classList.add("is-flash");
}

function onKey(e) {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable || document.querySelector(".overlay")) return;
  e.preventDefault();
  heroParts.input.focus();
  heroParts.input.select();
}

// ── Topic list follows the scroll ───────────────────────────────────────────

function setActiveTopic(id) {
  activeTopic = id;
  for (const b of navHost.querySelectorAll(".fq-topic")) {
    const on = b.dataset.cat === id;
    b.classList.toggle("is-on", on);
    if (on) {
      b.setAttribute("aria-current", "true");
      // On a phone the topics are a sideways row: keep the active one in view (scrolling that row only).
      if (PHONE.matches) {
        const row = b.parentElement;
        row.scrollTo?.({ left: b.offsetLeft - (row.clientWidth - b.offsetWidth) / 2, behavior: reduced() ? "auto" : "smooth" });
      }
    } else b.removeAttribute("aria-current");
  }
}

function watchTopics() {
  if (!("IntersectionObserver" in window)) return;
  observer = new IntersectionObserver(
    (entries) => {
      if (performance.now() < lockUntil) return;
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (seen) setActiveTopic(seen.target.dataset.cat);
    },
    { rootMargin: "-90px 0px -65% 0px" }
  );
  for (const sec of listHost.querySelectorAll(".fq-sec")) observer.observe(sec);
}

start();
