// The Help & FAQs page's pieces: the hero with its search, the topic list, the accordion cards, the
// no-results card and the "still stuck?" footer. Pure builders: they take state + handlers and
// return nodes. Answer text is rendered as text nodes only (core/faq.js splits the markup), never
// as HTML.

import { answerBlocks, highlightSegments, inlineParts } from "../core/faq.js";
import { S, t } from "../core/strings.js";
import { button, el } from "../ui/components.js";
import { icon } from "../ui/icons.js";

/** Text with the searched words wrapped in <mark>. */
function marked(text, words) {
  return highlightSegments(text, words).map((s) => (s.hit ? el("mark", { text: s.text }) : s.text));
}

/** One line of an answer: plain text, **bold** and {{keys}}, with the searched words marked. */
function line(text, words) {
  return inlineParts(text).map((p) =>
    p.type === "kbd" ? el("kbd", { class: "kbd", text: p.text }) : p.type === "b" ? el("strong", {}, marked(p.text, words)) : marked(p.text, words)
  );
}

function answer(item, words) {
  return answerBlocks(item.answer).map((b) =>
    b.type === "p"
      ? el("p", {}, line(b.text, words))
      : el(b.type, { class: "fq-list" }, b.items.map((x) => el("li", {}, line(x, words))))
  );
}

/** A question as an accordion card. `open` is the live state; the page flips it on click. */
export function item(it, { open, words }, h) {
  const bodyId = `faq-body-${it.id}`;
  const head = el(
    "button",
    { type: "button", class: "fq-head", "aria-expanded": open ? "true" : "false", "aria-controls": bodyId, "data-fk": `faq-q-${it.id}`, onclick: () => h.onToggle(it.id) },
    [el("span", { class: "fq-q" }, marked(it.question, words)), el("span", { class: "fq-chev", "aria-hidden": "true" }, [icon("chevron-down")])]
  );
  const extras = [
    it.example ? el("div", { class: "fq-example" }, [el("b", { text: S.FAQ_EXAMPLE }), el("span", {}, line(it.example, words))]) : null,
    el("div", { class: "fq-foot" }, [
      it.link ? button({ label: it.link.label, iconRight: "arrow-right", variant: "soft", size: "sm", href: h.href(it.link.to) }) : null,
      el("button", { type: "button", class: "fq-copy", title: S.FAQ_COPY_LINK, "aria-label": S.FAQ_COPY_LINK, onclick: () => h.onCopyLink(it.id) }, [icon("link"), el("span", { text: S.FAQ_COPY_LINK })]),
    ]),
  ];
  return el("article", { class: `fq ${open ? "is-open" : ""}`, id: `faq-${it.id}`, "data-id": it.id }, [
    head,
    el("div", { class: "fq-body", id: bodyId, role: "region" }, [el("div", { class: "fq-inner" }, [...answer(it, words), ...extras])]),
  ]);
}

/** A topic heading and its cards. */
export function section(category, items, state, h) {
  return el("section", { class: "fq-sec", id: `topic-${category.id}`, "data-cat": category.id }, [
    el("header", { class: "fq-sec-head" }, [
      el("span", { class: "fq-sec-mark" }, [icon(category.icon)]),
      el("div", {}, [el("h2", { text: category.label }), el("p", { text: category.blurb })]),
      el("span", { class: "fq-sec-n", text: t(S.FAQ_N_QUESTIONS, { n: items.length }) }),
    ]),
    el("div", { class: "fq-cards" }, items.map((it) => item(it, { open: state.open.has(it.id), words: state.words }, h))),
  ]);
}

/** Search results: one list, best match first, each card tagged with its topic. */
export function results(found, categories, state, h) {
  const label = new Map(categories.map((c) => [c.id, c]));
  return el("section", { class: "fq-sec fq-results" }, [
    el(
      "div",
      { class: "fq-cards" },
      found.map((it) => {
        const card = item(it, { open: state.open.has(it.id), words: state.words }, h);
        const c = label.get(it.category);
        card.querySelector(".fq-head").insertAdjacentElement("afterbegin", el("span", { class: "fq-tag", title: c.label }, [icon(c.icon), el("span", { text: c.label })]));
        return card;
      })
    ),
  ]);
}

/** The hero: title, search with its result count, popular searches. */
export function hero(state, h) {
  const input = el("input", {
    class: "input fq-search-input",
    type: "search",
    id: "faq-search",
    value: state.query,
    placeholder: S.FAQ_SEARCH_PH,
    "aria-label": S.FAQ_SEARCH_LABEL,
    autocomplete: "off",
    spellcheck: "false",
    "data-fk": "faq-search",
    oninput: (e) => h.onQuery(e.target.value),
    onkeydown: (e) => {
      if (e.key === "Escape" && e.target.value) {
        e.preventDefault();
        h.onQuery("");
      }
    },
  });
  const count = el("div", { class: "fq-count", role: "status", "aria-live": "polite" });
  const clear = el("button", { type: "button", class: "fq-clear", "aria-label": S.FAQ_CLEAR, title: S.FAQ_CLEAR, hidden: !state.query, onclick: () => h.onQuery("", true) }, [icon("x")]);
  return {
    count,
    clear,
    input,
    node: el("section", { class: "fq-hero" }, [
      el("div", { class: "fq-hero-text" }, [
        el("span", { class: "fq-hero-mark" }, [icon("help")]),
        el("div", {}, [el("h2", { text: S.FAQ_HERO_TITLE }), el("p", { text: S.FAQ_HERO_SUB })]),
      ]),
      el("label", { class: "fq-search", for: "faq-search" }, [icon("search"), input, el("kbd", { class: "kbd fq-slash", "aria-hidden": "true", text: "/" }), clear]),
      el("div", { class: "fq-meta" }, [
        count,
        el(
          "div",
          { class: "fq-popular" },
          [el("span", { text: S.FAQ_POPULAR }), ...state.popular.map((q) => el("button", { type: "button", class: "fq-pop", text: q, onclick: () => h.onQuery(q, true) }))]
        ),
      ]),
    ]),
  };
}

/** The topic list: sticky on desktop, a scrolling chip row on a phone. Counts follow the search. */
export function topics(categories, counts, activeId, h) {
  return el(
    "nav",
    { class: "fq-nav", "aria-label": S.FAQ_TOPICS_LABEL },
    [
      el("div", { class: "fq-nav-title", text: S.FAQ_TOPICS }),
      ...categories.map((c) => {
        const n = counts.get(c.id) ?? 0;
        return el(
          "button",
          {
            type: "button",
            class: `fq-topic ${activeId === c.id ? "is-on" : ""} ${n ? "" : "is-empty"}`,
            "aria-current": activeId === c.id ? "true" : undefined,
            disabled: !n,
            "data-cat": c.id,
            "data-fk": `faq-topic-${c.id}`,
            onclick: () => h.onTopic(c.id),
          },
          [icon(c.icon), el("span", { class: "fq-topic-l", text: c.label }), el("span", { class: "fq-topic-n", text: String(n) })]
        );
      }),
    ]
  );
}

/** Nothing matched. */
export function noResults(query, h) {
  return el("section", { class: "fq-none", role: "status" }, [
    el("span", { class: "fq-none-mark" }, [icon("search")]),
    el("h3", { text: t(S.FAQ_NO_RESULTS, { q: query }) }),
    el("p", { text: S.FAQ_NO_RESULTS_HINT }),
    el("p", { class: "fq-none-ask", text: S.FAQ_NO_RESULTS_ASK }),
    el("div", { class: "fq-none-actions" }, [
      button({ label: S.FAQ_CLEAR, icon: "x", variant: "secondary", onClick: () => h.onQuery("", true) }),
      button({ label: S.QE_FEEDBACK, icon: "feedback", variant: "primary", href: h.href("feedback/") }),
    ]),
  ]);
}

/** The way out for anyone this page did not answer. */
export function stuck(h) {
  return el("section", { class: "fq-stuck" }, [
    el("span", { class: "fq-hero-mark" }, [icon("feedback")]),
    el("div", { class: "fq-stuck-text" }, [el("h3", { text: S.FAQ_STILL_STUCK }), el("p", { text: S.FAQ_STILL_BODY })]),
    el("div", { class: "fq-stuck-actions" }, [
      button({ label: S.QE_FEEDBACK, icon: "feedback", variant: "primary", href: h.href("feedback/") }),
      button({ label: S.FAQ_USER_GUIDE, icon: "guide", variant: "secondary", href: "https://quizoma.com/how-it-works/", attrs: { target: "_blank", rel: "noopener" } }),
      button({ label: S.FAQ_SUPPORT, icon: "support", variant: "ghost", href: "https://quizoma.com/contact/", attrs: { target: "_blank", rel: "noopener" } }),
    ]),
  ]);
}
