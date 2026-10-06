// Mode 1 — Rapid Grade: one big card at a time, keyboard first.
//
// The deck goes question by question in quiz order; inside a question, identical short answers
// (≤ 50 chars, ≤ 6 words once normalised) from 2+ students become one group card, biggest
// first. → / ← / ↓ / a digit marks every student on the card at once (one undo entry, one queued
// batch); the card is stamped and glides away on a clone while the next card is already live
// underneath, so input is never blocked.

import { QUESTION_TYPES as QT } from "../core/models.js";
import { S, t } from "../core/strings.js";
import { VERDICT, verdictMark } from "../core/scoring.js";
import { el } from "../ui/components.js";
import { closeness } from "./similarity.js";
import { FEEDBACK_CHIPS, G, anim, appendChip, colOf, firstName, fmt, groupable, ini, kbd, kbdOnPri, norm, plural, shake, softOf, typeOf, updCounter, when } from "./gx-util.js";
import { ansOf, draftCount, pendingOf, setMarks, subs } from "./store.js";

const FILTERS = ["unmarked", "typed", "common", "all"];
const pendingFilter = (f) => f === "unmarked" || f === "common";

/** The deck for a filter, without touching the context. */
function deckFor(ctx, filter) {
  const qm = ctx.qm;
  const studs = subs(qm);
  const cards = [];
  for (const q of qm.qs) {
    const keys = [];
    for (const s of studs) {
      const a = ansOf(qm, s.id, q.id);
      if (!a) continue;
      if (filter === "typed" && !a.manual) continue;
      if (pendingFilter(filter) && !(a.manual && a.pts == null)) continue;
      keys.push([s.id, a]);
    }
    const groups = new Map();
    const singles = [];
    for (const [sid, a] of keys) {
      const gk = `${q.id}::${norm(a.given)}`;
      if (groupable(a.given) && !ctx.dissolved.has(gk) && !ctx.excluded.has(`${sid}|${q.id}`)) {
        if (!groups.has(gk)) groups.set(gk, []);
        groups.get(gk).push(sid);
      } else singles.push(sid);
    }
    const qCards = [];
    for (const [gk, list] of groups) {
      if (list.length > 1) qCards.push({ qid: q.id, sids: list, gk });
      else singles.push(list[0]);
    }
    if (filter !== "common") for (const sid of singles) qCards.push({ qid: q.id, sids: [sid] });
    // Bigger groups first inside each question: the biggest wins at the start.
    qCards.sort((a, b) => b.sids.length - a.sids.length);
    cards.push(...qCards);
  }
  return cards;
}

export function buildDeck(ctx) {
  ctx.deck = deckFor(ctx, ctx.filter);
  ctx.di = 0;
}

const cardKeys = (c) => c.sids.map((s) => `${s}|${c.qid}`);
const cardDone = (ctx, c) => cardKeys(c).every((k) => ctx.qm.A.get(k)?.pts != null);
function skipDone(ctx) {
  if (pendingFilter(ctx.filter)) while (ctx.di < ctx.deck.length && cardDone(ctx, ctx.deck[ctx.di])) ctx.di++;
}
const halfOf = (max) => verdictMark(VERDICT.PARTIAL, max);

export function renderRapid(ctx, o = {}) {
  const qm = ctx.qm;
  skipDone(ctx);
  const counts = Object.fromEntries(FILTERS.map((f) => [f, deckFor(ctx, f).length]));
  const card = ctx.deck[ctx.di];
  const remaining = ctx.deck.slice(ctx.di).filter((c) => !cardDone(ctx, c)).length;
  const labels = { unmarked: S.GX_F_UNMARKED, typed: S.GX_F_TYPED, common: S.GX_F_COMMON, all: S.GX_F_ALL };

  const chips = el(
    "div",
    { class: "chips", id: "rfil" },
    FILTERS.map((f) =>
      el("button", { type: "button", "data-f": f, class: ctx.filter === f ? "on" : "", "aria-pressed": String(ctx.filter === f) }, [labels[f], el("i", { text: String(counts[f]) })])
    )
  );
  chips.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    ctx.filter = b.dataset.f;
    buildDeck(ctx);
    renderRapid(ctx, { enter: true });
  });
  const pos = el("span", { class: "rpos" });
  if (card) {
    pos.append(S.GX_CARD, el("b", { text: String(Math.min(ctx.di + 1, ctx.deck.length)) }), S.GX_CARD_OF, el("b", { text: String(ctx.deck.length) }));
    if (ctx.filter === "unmarked") pos.append(t(S.GX_CARD_LEFT, { n: remaining }));
  }

  const left = ctx.deck.length - ctx.di;
  const deckEl = el(
    "div",
    { class: "deck", id: "deckEl" },
    card
      ? el("div", { class: "dwrap", id: "dwrap" }, [left > 2 ? el("div", { class: "ghostc g2" }) : null, left > 1 ? el("div", { class: "ghostc g1" }) : null, cardNode(ctx, card)])
      : endNode(ctx)
  );
  const last = el("div", { class: "last", id: "last" });
  const legend = card
    ? el("div", { class: "legend" }, [
        el("span", {}, [kbd("→"), S.GX_LG_FULL]),
        el("span", {}, [kbd("↓"), "/", kbd(S.GX_KEY_SPACE), S.GX_LG_HALF]),
        el("span", {}, [kbd("←"), S.GX_LG_ZERO]),
        el("span", {}, [kbd("0"), "–", kbd("9"), S.GX_LG_EXACT]),
        el("span", {}, [kbd("C"), S.GX_LG_COMMENT]),
        el("span", {}, [kbd("Z"), S.GX_LG_UNDO]),
      ])
    : null;
  // Everything is marked but cards are showing: the teacher is re-marking, so say so up top —
  // once a session. It stays up for this visit until Done, which only closes it.
  const remark = card && pendingOf(qm) === 0 && remarkNoteDue(ctx) ? remarkNode(ctx) : null;
  ctx.stage.replaceChildren(el("div", { class: "view", id: "rv" }, [el("div", { class: "rtop" }, [chips, pos]), remark, deckEl, last, legend]));
  renderLast(ctx);

  const rc = ctx.stage.querySelector("#rcard");
  if (rc) {
    if (o.from) {
      const dx = o.from === "f" ? 60 : o.from === "z" ? -60 : 0;
      const dy = o.from === "h" ? 50 : 0;
      anim(rc, [{ opacity: 0, transform: `translate(${dx}%,${dy}px) rotate(${dx / 20}deg)` }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
    } else if (o.enter) anim(rc, [{ opacity: 0.4, transform: "translateY(12px) scale(.965)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
}

const REMARK_SEEN = "gx-remark-seen";

/** True while the "Marking again" note should show: the first time this session, then for the
 *  rest of that visit until Done. */
function remarkNoteDue(ctx) {
  if (ctx.remarkFor === ctx.qm.id) return true;
  try {
    if (sessionStorage.getItem(REMARK_SEEN)) return false;
    sessionStorage.setItem(REMARK_SEEN, "1");
  } catch {
    // storage blocked: show it for this visit only
  }
  ctx.remarkFor = ctx.qm.id;
  return true;
}

function remarkNode(ctx) {
  const node = el("div", { class: "remark", role: "status" }, [
    G.redo(16),
    el("div", { style: "min-width:0" }, [el("b", { text: S.GX_REMARK_TITLE }), el("span", { text: S.GX_REMARK_BODY })]),
    el("button", {
      class: "bt sm",
      type: "button",
      id: "remarkDone",
      text: S.GX_REMARK_DONE,
      onclick: () => {
        ctx.remarkFor = null;
        node.remove();
      },
    }),
  ]);
  return node;
}

function cardNode(ctx, c) {
  const qm = ctx.qm;
  const q = qm.qs.find((x) => x.id === c.qid);
  const a = ansOf(qm, c.sids[0], c.qid);
  const T = typeOf(q.type);
  const g = c.sids.length > 1;
  const studs = c.sids.map((id) => qm.studs.find((s) => s.id === id));
  const keys = cardKeys(c);
  const given = a.given;
  const max = a.max;
  const half = halfOf(max);
  const filled = given.trim().length > 0;
  const long = given.length > 60;
  const typed = q.type === QT.WRITTEN || q.type === QT.FILL_BLANK;
  const sim = a.manual && typed && q.exp ? closeness(given, q.exp) : null;
  const marked = keys.map((k) => qm.A.get(k).pts);
  const allSame = marked.every((v) => v === marked[0]);
  const expWords = new Set(norm(q.exp).split(" ").filter((w) => w.length > 2));
  const fbs = keys.map((k) => qm.A.get(k).fb).filter(Boolean);

  // ── Header ──
  let who;
  if (g) {
    const n = studs.length;
    const splitTip = t(S.GX_TIP_SPLIT, { n });
    // The whole chip opens the menu (it used to be only the little chevron), and a visible
    // Split button beside it splits the group in one click. Both explain themselves on hover.
    const gmBtn = el("button", { class: "grpchip", type: "button", id: "gmBtn", "aria-haspopup": "menu", "aria-expanded": "false", "data-tip": t(S.GX_TIP_GROUP, { n }), "aria-label": `${t(S.GX_GROUP_N, { n })} · ${S.GX_GROUP_OPTIONS}` }, [
      el("span", { class: "avs" }, studs.slice(0, 4).map((s) => el("span", { vars: { c: colOf(s.name) }, text: ini(s.name) }))),
      t(S.GX_GROUP_N, { n }),
      G.chevron(),
    ]);
    const gdrop = el("div", { class: "gdrop", id: "gdrop", hidden: true, role: "menu" }, [
      el("p", { class: "ghint", text: S.GX_GROUP_HINT }),
      el("button", { type: "button", "data-g": "dissolve", role: "menuitem", title: splitTip }, [G.split(), S.GX_DISSOLVE]),
      el("hr"),
      el("div", { class: "glab", text: S.GX_EXCLUDE_HEAD }),
      el(
        "div",
        { class: "glist" },
        studs.map((s) =>
          el("button", { type: "button", "data-ex": s.id, role: "menuitem", title: t(S.GX_TIP_TAKE_OUT, { name: s.name }) }, [
            el("span", { class: "ini", style: `--c:${colOf(s.name)};width:22px;height:22px;border-radius:7px;font-size:9px`, text: ini(s.name) }),
            s.name,
            el("span", { class: "gx", text: S.GX_EXCLUDE }),
          ])
        )
      ),
    ]);
    gmBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      gdrop.hidden = !gdrop.hidden;
      gmBtn.setAttribute("aria-expanded", String(!gdrop.hidden));
    });
    gdrop.addEventListener("click", (e) => groupAction(ctx, e));
    const splitBtn = el("button", { class: "gsplit", type: "button", "data-g": "dissolve", "data-tip": splitTip, "aria-label": splitTip, onclick: (e) => groupAction(ctx, e) }, [G.split(), el("span", { class: "gsl", text: S.GX_SPLIT_BTN })]);
    who = el("div", { class: "gmenu" }, [gmBtn, splitBtn, gdrop]);
  } else {
    const s = studs[0];
    const back = splitOut(ctx, c)
      ? el("button", { class: "putback", type: "button", "data-tip": S.GX_TIP_PUT_BACK, "aria-label": S.GX_TIP_PUT_BACK, onclick: () => putBack(ctx, c) }, [G.redo(12), S.GX_BQ_PUT_BACK])
      : null;
    who = el("div", { class: "who" }, [
      el("span", { class: "ini", vars: { c: colOf(s.name) }, text: ini(s.name) }),
      el("div", { style: "min-width:0" }, [
        el("b", { text: s.name }),
        el("small", { text: s.plat ? t(S.GX_PLAT_SUBMITTED, { plat: s.plat, when: when(s.sub) }) : t(S.GX_SUBMITTED_CAP, { when: when(s.sub) }) }),
      ]),
      back,
    ]);
  }
  const typePill = el("span", { class: "gpill tp", style: `background:${softOf(T.c)};color:${T.c}`, text: t(S.GX_Q_TYPE, { n: q.num, type: T.n() }) });
  const ptsPill = el("span", { class: "gpill acc", text: plural(max, S.GX_PTS_ONE, S.GX_PTS_MANY) });

  // ── Answer boxes ──
  const big = el("div", { class: `big ${long ? "long" : ""} ${filled ? "" : "empty"}` });
  if (filled) {
    for (const w of given.split(/(\s+)/)) big.append(expWords.has(norm(w)) ? el("mark", { text: w }) : w);
  } else big.textContent = S.GX_NO_ANSWER;
  const nowPill =
    marked[0] != null && allSame
      ? el("span", { class: `gpill ${marked[0] === max ? "ok" : marked[0] === 0 ? "bad" : "warn"}`, text: t(S.GX_NOW, { x: fmt(marked[0]), max }) })
      : null;
  const simc =
    sim != null && filled
      ? el("div", { class: "simc" }, [
          S.GX_CLOSE,
          el("span", { class: "simbar" }, [el("i", { style: `width:${sim}%;background:${sim >= 85 ? "var(--live)" : sim >= 55 ? "var(--warn)" : "var(--bad)"}` })]),
          el("b", { text: `${sim}%` }),
        ])
      : null;
  const autoLine = a.auto
    ? el("div", { class: "simc" }, [
        S.GX_AUTO_MARKED,
        a.ok ? el("b", { style: "color:var(--ok-ink)", text: S.GX_CORRECT }) : el("b", { style: "color:var(--bad-ink)", text: S.GX_WRONG }),
        S.GX_YOU_CAN_OVERRIDE,
      ])
    : null;

  // ── Actions ──
  const gbtn = (v, value, key, label) => el("button", { class: `gbtn ${v}`, type: "button", "data-v": v }, [String(value), el("small", {}, [kbd(key), label])]);
  const exIn = el("input", { id: "exIn", inputmode: "numeric", "aria-label": S.GX_EXACT_MARK, placeholder: "–", autocomplete: "off" });
  const exGo = el("button", { type: "button", id: "exGo", text: S.GX_MARK });
  const exact = el("label", { class: "exact", title: S.GX_EXACT_TITLE }, [exIn, el("span", { text: t(S.GX_OUT_OF, { max }) }), exGo]);
  const ract = el("div", { class: "ract", style: half == null ? "grid-template-columns:repeat(2,minmax(0,1fr)) auto" : null }, [
    gbtn("z", 0, "←", S.GX_LG_ZERO),
    half == null ? null : gbtn("h", half, "↓", S.GX_LG_HALF),
    gbtn("f", max, "→", S.GX_LG_FULL),
    exact,
  ]);

  // ── Comment ──
  const cBtn = el("button", { class: `cbtn ${fbs.length ? "has" : ""}`, type: "button", id: "cBtn", "aria-expanded": "false" }, [G.comment(), fbs.length ? S.GX_EDIT_COMMENT : S.GX_ADD_COMMENT, " ", kbd("C")]);
  const fbIn = el("textarea", {
    id: "fbIn",
    maxlength: "500",
    "aria-label": S.GX_COMMENT_LABEL,
    placeholder: g ? t(S.GX_NOTE_FOR_GROUP, { n: studs.length }) : t(S.GX_NOTE_FOR_ONE, { name: firstName(studs[0].name) }),
  });
  fbIn.value = fbs[0] ?? "";
  const fbCc = el("span", { class: "cc", id: "fbCc" });
  const fbx = el("div", { class: "fbx", id: "fbx", hidden: true }, [
    el("div", { class: "fchips" }, FEEDBACK_CHIPS().map((x) => el("button", { type: "button", text: x, onclick: () => appendChip(fbIn, x) }))),
    fbIn,
    el("div", { class: "fbrow" }, [
      fbCc,
      el("span", { style: "display:flex;gap:6px" }, [
        el("button", { class: "bt sm", type: "button", id: "fbCancel", onclick: () => openFb(ctx, false) }, [S.CANCEL, " ", kbd(S.GX_KEY_ESC)]),
        el("button", { class: "bt sm pri", type: "button", id: "fbSave", onclick: () => saveFb(ctx) }, [S.GX_SAVE_NOTE, " ", kbdOnPri(S.GX_KEY_ENTER)]),
      ]),
    ]),
  ]);
  const upc = () => updCounter(fbCc, fbIn.value.length);
  fbIn.addEventListener("input", upc);
  upc();
  fbIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveFb(ctx);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      openFb(ctx, false);
    }
  });
  cBtn.addEventListener("click", () => openFb(ctx, true));

  const rfoot = el("div", { class: "rfoot" }, [
    cBtn,
    fbs.length ? el("span", { style: "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%", text: t(S.GX_QUOTE, { text: fbs[0] }) }) : null,
    g ? el("span", { style: "margin-left:auto", text: t(S.GX_ONE_MARK_ALL, { n: studs.length }) }) : null,
  ]);

  const article = el("article", { class: "rcard", id: "rcard", "data-q": q.id }, [
    el("div", { class: "rhead" }, [who, el("div", { class: "qmeta" }, [typePill, ptsPill])]),
    el("p", { class: "qtext" }, [el("b", { text: q.text })]),
    el("div", { class: "ans" }, [
      el("div", { class: "abox stu" }, [el("small", {}, [el("span", { text: g ? S.GX_THEIR_ANSWER : S.GX_STUDENT_ANSWER }), nowPill]), big, simc]),
      el("div", { class: "abox" }, [el("small", {}, [el("span", { text: a.manual ? S.GX_EXPECTED : S.GX_CORRECT_ANSWER })]), el("div", { class: "exp", text: q.exp }), autoLine]),
    ]),
    ract,
    rfoot,
    fbx,
  ]);
  for (const b of ract.querySelectorAll(".gbtn")) b.addEventListener("click", () => rapidMark(ctx, b.dataset.v));
  exGo.addEventListener("click", () => commitExact(ctx));
  exIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitExact(ctx);
    }
    if (e.key === "Escape") {
      exIn.value = "";
      exIn.blur();
    }
  });
  return article;
}

function endNode(ctx) {
  const qm = ctx.qm;
  const p = pendingOf(qm);
  if (p === 0) {
    const ok = el("div", { class: "cok" }, [G.okCircle()]);
    const drafts = draftCount(qm);
    const stat = (n, one, many) => el("span", {}, [el("b", { text: String(n) }), plural(n, one, many)]);
    // Re-marking goes through the typed answers when the quiz has any, otherwise through every answer.
    const again = () => {
      ctx.filter = deckFor(ctx, "typed").length ? "typed" : "all";
      buildDeck(ctx);
      renderRapid(ctx, { enter: true });
    };
    return el("div", { class: "endc done" }, [
      ok,
      el("h2", { text: S.GX_ALL_MARKED }),
      el("p", { text: S.GX_READY_EXPORT }),
      el("div", { class: "endstats" }, [
        stat(subs(qm).length, S.GX_END_STUDENTS_ONE, S.GX_END_STUDENTS_MANY),
        stat([...qm.A.values()].filter((a) => a.pts != null).length, S.GX_END_ANSWERS_ONE, S.GX_END_ANSWERS_MANY),
        stat(qm.qs.length, S.GX_END_QUESTIONS_ONE, S.GX_END_QUESTIONS_MANY),
      ]),
      el("div", { class: "acts" }, [
        drafts
          ? el("button", { class: "bt pri subbtn", type: "button", id: "endSubmit", onclick: () => ctx.submit() }, [G.send(), S.GX_SUBMIT_MARKS, el("i", { class: "subn", text: String(drafts) })])
          : null,
        el("button", { class: drafts ? "bt" : "bt pri", type: "button", id: "seeChart", text: S.GX_VIEW_CHART, onclick: () => ctx.celebrate(true) }),
        el("button", { class: "bt", type: "button", id: "remark", onclick: again }, [G.redo(14), S.GX_MARK_AGAIN]),
        el("button", { class: "bt", type: "button", "data-goto": "ind", text: S.GX_REVIEW_BY_STUDENT, onclick: () => ctx.setMode("ind") }),
      ]),
    ]);
  }
  return el("div", { class: "endc" }, [
    el("h2", { text: S.GX_END_LIST }),
    el("p", { text: plural(p, S.GX_STILL_WAITING_ONE, S.GX_STILL_WAITING_MANY) }),
    el("div", { class: "acts" }, [
      el("button", {
        class: "bt pri",
        type: "button",
        id: "toUnm",
        text: S.GX_GO_UNMARKED,
        onclick: () => {
          ctx.filter = "unmarked";
          buildDeck(ctx);
          renderRapid(ctx, { enter: true });
        },
      }),
    ]),
  ]);
}

function renderLast(ctx) {
  const node = ctx.stage.querySelector("#last");
  if (!node) return;
  if (!ctx.lastAct) {
    node.replaceChildren();
    return;
  }
  node.replaceChildren(
    el("span", { class: "lastc" }, [
      S.GX_LAST,
      el("b", { text: ctx.lastAct.who }),
      S.GX_SEP,
      ctx.lastAct.txt,
      el("button", { type: "button", id: "lastU", onclick: () => ctx.undo() }, [S.UNDO, " ", kbd("Z")]),
    ])
  );
}

function groupAction(ctx, e) {
  const b = e.target.closest("button");
  if (!b) return;
  const c = ctx.deck[ctx.di];
  if (b.dataset.g === "dissolve") {
    ctx.dissolved.add(c.gk);
    ctx.deck.splice(ctx.di, 1, ...c.sids.map((s) => ({ qid: c.qid, sids: [s] })));
    ctx.toast(t(S.GX_SPLIT, { n: c.sids.length }));
    renderRapid(ctx, { enter: true });
  } else if (b.dataset.ex) {
    const s = b.dataset.ex;
    ctx.excluded.add(`${s}|${c.qid}`);
    c.sids = c.sids.filter((x) => x !== s);
    const name = ctx.qm.studs.find((x) => x.id === s).name;
    const solo = { qid: c.qid, sids: [s] };
    if (c.sids.length === 1) ctx.deck.splice(ctx.di, 1, { qid: c.qid, sids: c.sids }, solo);
    else ctx.deck.splice(ctx.di + 1, 0, solo);
    ctx.toast(t(S.GX_EXCLUDED, { name: firstName(name) }));
    renderRapid(ctx, {});
  }
}

/** A one-student card for someone split out of a group, so it can be put back. */
function splitOut(ctx, c) {
  if (c.sids.length !== 1) return false;
  const a = ansOf(ctx.qm, c.sids[0], c.qid);
  if (!a || !groupable(a.given)) return false;
  return ctx.excluded.has(`${c.sids[0]}|${c.qid}`) || ctx.dissolved.has(`${c.qid}::${norm(a.given)}`);
}

/** Undoes a split: back into the group, and the deck shows that group card. */
function putBack(ctx, c) {
  const sid = c.sids[0];
  const a = ansOf(ctx.qm, sid, c.qid);
  if (!ctx.excluded.delete(`${sid}|${c.qid}`)) ctx.dissolved.delete(`${c.qid}::${norm(a.given)}`);
  buildDeck(ctx);
  ctx.di = Math.max(0, ctx.deck.findIndex((x) => x.qid === c.qid && x.sids.includes(sid)));
  ctx.toast(S.GX_BQ_REGROUPED);
  renderRapid(ctx, { enter: true });
}

function openFb(ctx, open) {
  const f = ctx.stage.querySelector("#fbx");
  if (!f || open === !f.hidden) return;
  ctx.stage.querySelector("#cBtn")?.setAttribute("aria-expanded", String(open));
  if (open) {
    f.hidden = false;
    anim(f, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 180, easing: "ease-out" });
    const ta = ctx.stage.querySelector("#fbIn");
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  } else {
    f.hidden = true;
    document.activeElement?.blur();
  }
}

function saveFb(ctx) {
  const c = ctx.deck[ctx.di];
  if (!c) return;
  const v = ctx.stage.querySelector("#fbIn").value.trim().slice(0, 500);
  setMarks(ctx.qm, cardKeys(c), undefined, { fb: v });
  ctx.toast(v ? S.GX_COMMENT_SAVED : S.GX_COMMENT_REMOVED);
  renderRapid(ctx, {});
}

function commitExact(ctx) {
  const c = ctx.deck[ctx.di];
  if (!c) return;
  const max = ansOf(ctx.qm, c.sids[0], c.qid).max;
  const ex = ctx.stage.querySelector("#exIn");
  const raw = ex.value.trim();
  const v = Number(raw);
  if (!raw || !Number.isInteger(v) || v < 0 || v > max) {
    shake(ex.closest(".exact"));
    ctx.toast(t(S.GX_ENTER_RANGE, { max }));
    return;
  }
  rapidMark(ctx, "x", v);
}

/** Marks the current card and glides it away; the next card is rendered underneath at once. */
function rapidMark(ctx, kind, val) {
  const qm = ctx.qm;
  const c = ctx.deck[ctx.di];
  if (!c) return;
  const max = ansOf(qm, c.sids[0], c.qid).max;
  const half = halfOf(max);
  if (kind === "h" && half == null) return;
  const pts = kind === "f" ? max : kind === "z" ? 0 : kind === "h" ? half : val;
  ctx.stage.querySelector(`.gbtn[data-v="${kind}"]`)?.classList.add("hit");
  const who = c.sids.length > 1 ? t(S.GX_N_STUDENTS, { n: c.sids.length }) : qm.studs.find((s) => s.id === c.sids[0]).name;
  const di = ctx.di;
  setMarks(qm, cardKeys(c), pts, { ctx: { mode: "rapid", di, dir: kind === "x" ? "h" : kind } });
  ctx.lastAct = { who, txt: t(S.GX_X_OF_MAX, { x: fmt(pts), max }) };

  const rc = ctx.stage.querySelector("#rcard");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (rc && !reduced) {
    const clone = rc.cloneNode(true);
    clone.removeAttribute("id");
    clone.classList.add("clone");
    clone.setAttribute("aria-hidden", "true");
    for (const x of clone.querySelectorAll("[id]")) x.removeAttribute("id");
    const stampText = kind === "f" ? S.GX_STAMP_FULL : kind === "z" ? S.GX_STAMP_ZERO : kind === "h" ? S.GX_STAMP_HALF : t(S.GX_STAMP_X, { x: fmt(pts), max });
    clone.prepend(el("span", { class: `stamp ${kind}`, text: stampText }));
    // Full marks float off right, zero left; half and exact follow the side of their score.
    const side = kind === "f" ? 1 : kind === "z" ? -1 : pts >= max / 2 ? 1 : -1;
    const from = rc.getBoundingClientRect();
    ctx.di++;
    renderRapid(ctx, { enter: true });
    const w = ctx.stage.querySelector("#dwrap") ?? ctx.stage.querySelector("#deckEl");
    if (w) {
      // Start exactly where the old card was, whatever height the next card has.
      const to = w.getBoundingClientRect();
      Object.assign(clone.style, {
        left: `${from.left - to.left}px`,
        top: `${from.top - to.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
        transformOrigin: "50% 100%",
      });
      w.appendChild(clone);
      const a = clone.animate(
        [
          { transform: "none", opacity: 1 },
          { opacity: 0.85, offset: 0.55 },
          { transform: `translate(${side * 42}%, -18px) rotate(${side * 9}deg) scale(.96)`, opacity: 0 },
        ],
        { duration: 420, easing: "cubic-bezier(.3,.7,.3,1)" }
      );
      a.onfinish = () => clone.remove();
    }
  } else {
    ctx.di++;
    renderRapid(ctx, {});
  }
}

/** Rapid Grade keys (only reached when not typing and no dialog is open). */
export function rapidKey(ctx, e) {
  const c = ctx.deck[ctx.di];
  if (!c) return;
  const max = ansOf(ctx.qm, c.sids[0], c.qid).max;
  if (e.key === "ArrowRight") {
    e.preventDefault();
    rapidMark(ctx, "f");
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    rapidMark(ctx, "z");
  } else if (e.key === "ArrowDown" || e.key === " ") {
    e.preventDefault();
    if (halfOf(max) == null) {
      shake(ctx.stage.querySelector(".exact"));
      ctx.toast(t(S.GX_NO_HALF, { max }));
    } else rapidMark(ctx, "h");
  } else if (/^[0-9]$/.test(e.key) && !e.altKey) {
    e.preventDefault();
    const v = Number(e.key);
    if (max > 10) {
      const ex = ctx.stage.querySelector("#exIn");
      ex.focus();
      ex.value = e.key;
      return;
    }
    if (v > max) {
      shake(ctx.stage.querySelector(".exact"));
      ctx.toast(t(S.GX_OUT_OF_MAX, { max }));
      return;
    }
    rapidMark(ctx, "x", v);
  } else if (e.key === "c" || e.key === "C") {
    e.preventDefault();
    openFb(ctx, true);
  }
}
