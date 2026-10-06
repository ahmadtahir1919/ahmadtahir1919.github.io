// Mode 2 — By question: every different answer to one question as a card; one click marks
// everyone who gave it (one undo entry, one queued batch). Only the clicked card re-renders,
// in place, with a flash ring in its new status colour. Polls are never here (the top bar's
// poll chip shows them); tab numbers are the questions' places in the whole quiz.

import { QUESTION_TYPES as QT } from "../core/models.js";
import { S, t } from "../core/strings.js";
import { VERDICT, verdictMark } from "../core/scoring.js";
import { el } from "../ui/components.js";
import { G, colOf, fmt, groupable, ini, norm, plural, shake, softOf, typeOf } from "./gx-util.js";
import { ansOf, isDraft, setMarks, subs } from "./store.js";

const CHOICE = new Set([QT.SINGLE_CHOICE, QT.MULTIPLE_CORRECT, QT.TRUE_FALSE]);
const halfOf = (max) => verdictMark(VERDICT.PARTIAL, max);

/** Clusters of identical answers (same normalisation as Rapid Grade); choice questions cluster
 *  by the option(s) picked, blanks cluster together; long typed answers each get their own
 *  card. Groups split or people taken out (ctx.dissolved / ctx.excluded, shared with Rapid
 *  Grade) become single cards marked `split`. Pending first. */
function clustersFor(ctx, q) {
  const qm = ctx.qm;
  const map = new Map();
  for (const s of subs(qm)) {
    const a = ansOf(qm, s.id, q.id);
    if (!a) continue;
    const n = norm(a.given);
    const gk = !n || groupable(a.given) || CHOICE.has(q.type) ? `${q.id}::${n}` : null;
    const split = !!gk && (ctx.dissolved.has(gk) || ctx.excluded.has(`${s.id}|${q.id}`));
    const key = gk && !split ? gk : `__${s.id}`;
    if (!map.has(key)) map.set(key, { key, gk, split, given: a.given, sids: [] });
    map.get(key).sids.push(s.id);
  }
  const arr = [...map.values()];
  const pend = (c) => (c.sids.some((s) => ansOf(qm, s, q.id).pts == null) ? 1 : 0);
  arr.sort((a, b) => pend(b) - pend(a) || b.sids.length - a.sids.length);
  return arr;
}

/** The tab to open on: the first question anyone needs marking by hand, else the first. */
export const firstToMark = (qm) => Math.max(0, qm.qs.findIndex((q) => qm.studs.some((s) => qm.A.get(`${s.id}|${q.id}`)?.manual)));

const pendingFor = (qm, q) => subs(qm).filter((s) => {
  const a = ansOf(qm, s.id, q.id);
  return a && a.pts == null;
}).length;

/** Marks on this question changed here and not submitted yet. */
const changedFor = (qm, q) => subs(qm).some((s) => isDraft(ansOf(qm, s.id, q.id)));

const okMark = () => el("span", { class: "okk", title: S.GX_ALL_MARKED_TIP }, [G.check(15, 2.6)]);
const chgDot = () => el("i", { class: "chg", title: S.GX_BQ_LG_CHANGED });

/** The next question (after the current one, wrapping) with answers left to mark, or -1. */
function nextPending(qm, cur) {
  for (let k = 1; k < qm.qs.length; k++) {
    const i = (cur + k) % qm.qs.length;
    if (pendingFor(qm, qm.qs[i])) return i;
  }
  return -1;
}

function goTo(ctx, i) {
  if (i < 0 || i >= ctx.qm.qs.length || i === ctx.bqCur) return;
  ctx.bqCur = i;
  renderByQ(ctx);
}

/** ← / → move between questions. */
export function byqKey(ctx, e) {
  if (e.altKey || e.shiftKey) return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    goTo(ctx, ctx.bqCur + (e.key === "ArrowRight" ? 1 : -1));
  }
}

/** opts.keepScroll keeps the card list where it was (after a split or put back). */
export function renderByQ(ctx, opts = {}) {
  const qm = ctx.qm;
  if (!qm.qs.length) {
    ctx.stage.replaceChildren(el("div", { class: "view" }, [el("div", { class: "gempty" }, [el("b", { text: S.GX_NO_QUESTIONS })])]));
    return;
  }
  const scroll = opts.keepScroll ? ctx.stage.querySelector("#bqbody")?.scrollTop ?? 0 : 0;
  ctx.bqCur = Math.min(ctx.bqCur, qm.qs.length - 1);
  const q = qm.qs[ctx.bqCur];
  ctx.bqSeen.add(q.id);

  const tabs = el(
    "div",
    { class: "qtabs", id: "qtabs", role: "tablist", "aria-label": S.GX_QUESTIONS },
    qm.qs.map((x, i) => {
      const on = i === ctx.bqCur;
      const p = pendingFor(qm, x);
      const tt = typeOf(x.type);
      return el("button", { type: "button", "data-i": String(i), role: "tab", "aria-selected": String(on), class: `qtab ${on ? "on" : ""} ${ctx.bqSeen.has(x.id) ? "seen" : ""}`, style: `--tc:${tt.c}` }, [
        el("span", { class: "qn", text: String(x.num) }),
        tt.n(),
        p ? el("span", { class: "pend", text: String(p) }) : okMark(),
        changedFor(qm, x) ? chgDot() : null,
      ]);
    })
  );
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest(".qtab");
    if (b) goTo(ctx, Number(b.dataset.i));
  });
  const legend = el("div", { class: "qlegend" }, [
    el("span", {}, [el("span", { class: "pend", text: "2" }), S.GX_BQ_LG_PEND]),
    el("span", {}, [okMark(), S.GX_BQ_LG_DONE]),
    el("span", {}, [chgDot(), S.GX_BQ_LG_CHANGED]),
    el("span", {}, [el("i", { class: "unseen" }), S.GX_BQ_LG_UNSEEN]),
  ]);

  const T = typeOf(q.type);
  const cl = clustersFor(ctx, q);
  const pend = pendingFor(qm, q);
  const answered = subs(qm).filter((s) => ansOf(qm, s.id, q.id)).length;
  const manual = subs(qm).some((s) => ansOf(qm, s.id, q.id)?.manual);
  const max = maxFor(qm, q);
  const toMark = el("b", {});
  setToMark(toMark, pend);
  const stat = (value, label, tip) => el("div", { title: tip }, [value, el("small", { text: label })]);
  const head = el("div", { class: "bqhead" }, [
    el("div", {}, [
      el("span", { class: "gpill", style: `background:${softOf(T.c)};color:${T.c}`, text: t(S.GX_Q_TYPE_PTS, { n: q.num, type: T.n(), pts: plural(max, S.GX_PTS_ONE, S.GX_PTS_MANY) }) }),
      el("h2", { text: q.text }),
      el("div", { class: "expl" }, manual ? [S.GX_EXPECTED_LABEL, el("b", { text: q.exp })] : [S.GX_CORRECT_LABEL, el("b", { text: q.exp }), S.GX_AUTO_OVERRIDE]),
    ]),
    el("div", { class: "bqstats" }, [
      stat(el("b", { text: String(answered) }), S.GX_BQ_ST_ANSWERED, S.GX_BQ_ST_ANSWERED_TIP),
      stat(el("b", { text: String(cl.length) }), S.GX_BQ_ST_DIFFERENT, S.GX_BQ_ST_DIFFERENT_TIP),
      stat(toMark, S.GX_BQ_ST_LEFT, S.GX_BQ_ST_LEFT_TIP),
    ]),
  ]);
  const nav = navNode(ctx, manual);
  const clist = el("div", { class: "clist", id: "clist" }, cl.map((c, i) => clNode(ctx, q, c, i)));
  const body = el("div", { class: "bqbody", id: "bqbody" }, [legend, head, nav, clist]);
  ctx.stage.replaceChildren(el("div", { class: "view" }, [tabs, body]));
  body.scrollTop = scroll;
  body.addEventListener("scroll", closeMenu, { passive: true });
  tabs.querySelector(".qtab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  wire(ctx, q, cl, clist, toMark, nav, manual);
}

/** The "left to mark" number: amber while answers wait, a green ✓ at none. */
function setToMark(node, p) {
  node.textContent = p ? String(p) : "✓";
  node.style.color = p ? "var(--warn-ink)" : "var(--ok-ink)";
}

/** Previous · "Question 3 of 10" · Next, and once this question has nothing left to mark,
 *  a green note with the way on (the next question still to mark, else simply the next one). */
function navNode(ctx, manual) {
  const qm = ctx.qm;
  const cur = ctx.bqCur;
  const n = qm.qs.length;
  const pend = pendingFor(qm, qm.qs[cur]);
  const np = nextPending(qm, cur);
  const arrow = (dir) => {
    const g = G.back();
    if (dir === "r") g.style.transform = "scaleX(-1)";
    return g;
  };
  const right = [];
  if (!pend) right.push(el("span", { class: "bqok" }, [G.check(14, 2.6), manual ? S.GX_BQ_DONE : S.GX_BQ_AUTO_DONE]));
  if (np >= 0) right.push(el("button", { class: `bt sm ${pend ? "" : "pri"}`, type: "button", "data-go": String(np) }, [S.GX_BQ_NEXT_TO_MARK, arrow("r")]));
  else if (!pend && cur < n - 1) right.push(el("button", { class: "bt sm pri", type: "button", "data-go": String(cur + 1) }, [S.GX_BQ_NEXT_Q, arrow("r")]));
  const node = el("div", { class: `bqnav ${pend ? "" : "done"}` }, [
    el("div", { class: "bqpn" }, [
      el("button", { class: "bt sm", type: "button", "data-go": String(cur - 1), disabled: cur === 0 }, [arrow("l"), el("span", { text: S.GX_BQ_PREV })]),
      el("span", { class: "bqpos", text: t(S.GX_BQ_POS, { n: cur + 1, total: n }) }),
      el("button", { class: "bt sm", type: "button", "data-go": String(cur + 1), disabled: cur === n - 1 }, [el("span", { text: S.GX_BQ_NEXT }), arrow("r")]),
    ]),
    el("div", { class: "bqgo" }, right),
  ]);
  node.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (b && !b.disabled) goTo(ctx, Number(b.dataset.go));
  });
  return node;
}

// ── Group menu: split a card or take one person out ─────────────────────────

function closeMenu() {
  document.getElementById("gdrop")?.remove();
}

/** Opens (or closes, if it's already open for this card) the group menu under `anchor`.
 *  Lives in the .view, not the card, so the card's overflow can't clip it. It reuses Rapid
 *  Grade's #gdrop, so the suite's outside-click and Esc already close it. */
function toggleMenu(ctx, q, c, card, anchor) {
  const open = document.getElementById("gdrop");
  const same = !!open && !open.hidden && open.dataset.card === card.dataset.i;
  closeMenu();
  if (same) return;
  const qm = ctx.qm;
  const view = ctx.stage.querySelector(".view");
  const drop = el("div", { class: "gdrop gmenu bqdrop", id: "gdrop", role: "menu", "data-card": card.dataset.i }, [
    el("p", { class: "ghint", text: S.GX_GROUP_HINT }),
    el("button", { type: "button", "data-g": "split", role: "menuitem", title: t(S.GX_TIP_SPLIT, { n: c.sids.length }) }, [G.split(), S.GX_BQ_SPLIT_ALL]),
    el("hr"),
    el("div", { class: "glab", text: S.GX_BQ_TAKE_OUT }),
    el(
      "div",
      { class: "glist" },
      c.sids.map((sid) => {
        const name = qm.studs.find((x) => x.id === sid).name;
        return el("button", { type: "button", "data-ex": sid, role: "menuitem", title: t(S.GX_TIP_TAKE_OUT_BQ, { name }) }, [
          el("span", { class: "ini", style: `--c:${colOf(name)};width:22px;height:22px;border-radius:7px;font-size:9px`, text: ini(name) }),
          name,
          el("span", { class: "gx", text: S.GX_EXCLUDE }),
        ]);
      })
    ),
  ]);
  const vr = view.getBoundingClientRect();
  const ar = anchor.getBoundingClientRect();
  drop.style.top = `${ar.bottom - vr.top + 6}px`;
  drop.style.left = `${Math.max(8, Math.min(ar.right - vr.left - 270, vr.width - 278))}px`;
  drop.addEventListener("click", (e) => {
    e.stopPropagation();
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.g === "split") {
      ctx.dissolved.add(c.gk);
      ctx.toast(t(S.GX_SPLIT, { n: c.sids.length }));
    } else if (b.dataset.ex) {
      ctx.excluded.add(`${b.dataset.ex}|${q.id}`);
      ctx.toast(t(S.GX_BQ_TOOK_OUT, { name: qm.studs.find((x) => x.id === b.dataset.ex).name }));
    } else return;
    closeMenu();
    renderByQ(ctx, { keepScroll: true });
  });
  view.append(drop);
  drop.querySelector("button")?.focus();
}

function maxFor(qm, q) {
  for (const s of subs(qm)) {
    const a = ansOf(qm, s.id, q.id);
    if (a) return a.max;
  }
  return q.pts;
}

function clStatus(qm, q, c, max) {
  const v = c.sids.map((s) => ansOf(qm, s, q.id).pts);
  if (v.some((x) => x == null)) {
    const done = v.filter((x) => x != null).length;
    return ["pending", done === 0 ? S.GX_NOT_MARKED : t(S.GX_X_OF_N_MARKED, { x: done, n: v.length })];
  }
  if (!v.every((x) => x === v[0])) return ["part", S.GX_MIXED];
  return [v[0] === max ? "full" : v[0] === 0 ? "zero" : "part", t(S.GX_EACH, { x: fmt(v[0]), max })];
}

function clNode(ctx, q, c, i) {
  const qm = ctx.qm;
  const max = maxFor(qm, q);
  const half = halfOf(max);
  const [cls, txt] = clStatus(qm, q, c, max);
  const names = c.sids.map((s) => qm.studs.find((x) => x.id === s).name);
  const v = c.sids.map((s) => ansOf(qm, s, q.id).pts);
  const same = v.every((x) => x === v[0]) ? v[0] : null;
  const a0 = ansOf(qm, c.sids[0], q.id);
  const fb = c.sids.map((s) => ansOf(qm, s, q.id).fb).find(Boolean) ?? "";
  const filled = String(c.given).trim().length > 0;
  const n = c.sids.length;
  const numIn = el("input", {
    inputmode: "numeric",
    "aria-label": S.GX_EXACT_GROUP,
    value: same != null && same !== max && same !== 0 && same !== half ? fmt(same) : "",
    placeholder: "–",
    autocomplete: "off",
  });
  const noteIn = el("input", { maxlength: "500", "aria-label": S.GX_NOTE_LABEL, placeholder: n > 1 ? t(S.GX_SAME_NOTE, { n }) : S.GX_NOTE_ONE, value: fb });
  const group = n > 1 && !!c.gk;
  const count = group
    ? el("button", { class: "ccount", type: "button", "data-menu": "", "aria-haspopup": "menu", "data-tip": t(S.GX_TIP_GROUP, { n }), "aria-label": `${t(S.GX_GIVEN_TO_MANY, { n })} · ${S.GX_BQ_GROUP_TIP}` }, [t(S.GX_COUNT, { n }), G.chevron(13, 2.6)])
    : el("span", { class: "ccount", text: t(S.GX_COUNT, { n }) });
  const nameNode = (text) => (group ? el("button", { type: "button", "data-menu": "", title: S.GX_BQ_GROUP_TIP, text }) : el("span", { text }));
  return el("div", { class: `cl ${cls}`, "data-i": String(i), style: `animation-delay:${Math.min(i, 10) * 35}ms` }, [
    el("div", { class: "cltop" }, [
      el("div", { class: `clans ${filled ? "" : "empty"}`, text: filled ? c.given : S.GX_NO_ANSWER }),
      c.split ? el("button", { class: "putback", type: "button", "data-back": "", "data-tip": S.GX_TIP_PUT_BACK, "aria-label": S.GX_TIP_PUT_BACK }, [G.redo(12), S.GX_BQ_PUT_BACK]) : null,
      count,
    ]),
    el("div", { class: "names" }, [...names.slice(0, 6).map(nameNode), names.length > 6 ? nameNode(t(S.GX_N_MORE, { n: names.length - 6 })) : null]),
    el("div", { class: "clst" }, [
      el("span", { class: `gpill ${cls === "full" ? "ok" : cls === "zero" ? "bad" : cls === "pending" ? "warn" : "acc"}`, text: txt }),
      a0.auto ? el("span", { style: "color:var(--muted)", text: t(a0.adj ? S.GX_AUTO_CHANGED : S.GX_AUTO_VERDICT, { v: a0.ok ? S.GX_CORRECT : S.GX_WRONG }) }) : null,
    ]),
    el("div", { class: "clacts" }, [
      el("button", { class: `mini f ${same === max ? "on" : ""}`, "data-v": "f", type: "button", "aria-pressed": String(same === max), text: t(S.GX_FULL_N, { max }) }),
      half == null ? null : el("button", { class: `mini h ${same != null && same === half ? "on" : ""}`, "data-v": "h", type: "button", "aria-pressed": String(same === half), text: S.GX_HALF }),
      el("button", { class: `mini z ${same === 0 ? "on" : ""}`, "data-v": "z", type: "button", "aria-pressed": String(same === 0), text: "0" }),
      el("span", { class: "numin" }, [numIn, t(S.GX_OUT_OF, { max })]),
    ]),
    el("div", { class: "sfb" }, [noteIn, el("button", { class: "mini", type: "button", "data-fb": "", text: S.GX_SAVE })]),
  ]);
}

function wire(ctx, q, cl, clist, toMark, nav, manual) {
  const qm = ctx.qm;
  const keysOf = (c) => c.sids.map((s) => `${s}|${q.id}`);
  const given = (n) => plural(n, S.GX_GIVEN_TO_ONE, S.GX_GIVEN_TO_MANY);
  const mark = (card, c, pts) => {
    const max = maxFor(qm, q);
    setMarks(qm, keysOf(c), pts);
    ctx.toast(t(S.GX_X_GIVEN, { x: fmt(pts), max, to: given(c.sids.length) }), { label: S.UNDO, fn: ctx.undo });
    refresh(card);
  };
  clist.addEventListener("click", (e) => {
    const card = e.target.closest(".cl");
    if (!card) return;
    const c = cl[Number(card.dataset.i)];
    const m = e.target.closest("[data-menu]");
    if (m) {
      e.stopPropagation();
      toggleMenu(ctx, q, c, card, card.querySelector(".ccount"));
      return;
    }
    if (e.target.closest("[data-back]")) {
      const sid = c.sids[0];
      if (!ctx.excluded.delete(`${sid}|${q.id}`)) ctx.dissolved.delete(c.gk);
      ctx.toast(S.GX_BQ_REGROUPED);
      renderByQ(ctx, { keepScroll: true });
      return;
    }
    const b = e.target.closest("[data-v]");
    if (b) {
      const max = maxFor(qm, q);
      mark(card, c, b.dataset.v === "f" ? max : b.dataset.v === "z" ? 0 : halfOf(max));
      return;
    }
    if (e.target.closest("[data-fb]")) {
      const v = card.querySelector(".sfb input").value.trim();
      setMarks(qm, keysOf(c), undefined, { fb: v });
      ctx.toast(v ? t(S.GX_NOTE_SAVED_N, { n: c.sids.length }) : S.GX_NOTE_REMOVED);
    }
  });
  clist.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const card = e.target.closest(".cl");
    if (!card) return;
    const c = cl[Number(card.dataset.i)];
    if (e.target.closest(".numin")) {
      e.preventDefault();
      const max = maxFor(qm, q);
      const raw = e.target.value.trim();
      const v = Number(raw);
      if (!raw || !Number.isInteger(v) || v < 0 || v > max) {
        shake(e.target);
        ctx.toast(t(S.GX_ENTER_RANGE, { max }));
        return;
      }
      mark(card, c, v);
    } else if (e.target.closest(".sfb")) {
      e.preventDefault();
      card.querySelector("[data-fb]").click();
    }
  });

  /** Re-render only this card, flash it, and update the tab (count + changed dot), the
   *  "to mark" stat and the nav bar. */
  function refresh(card) {
    const i = Number(card.dataset.i);
    const next = clNode(ctx, q, cl[i], i);
    next.style.animation = "none";
    card.replaceWith(next);
    next.classList.add("flash");
    setTimeout(() => next.classList.remove("flash"), 500);
    const p = pendingFor(qm, q);
    const tab = ctx.stage.querySelector("#qtabs .qtab.on");
    const pe = tab?.querySelector(".pend");
    if (pe && p) pe.textContent = String(p);
    else if (pe && !p) pe.replaceWith(okMark());
    else if (tab && p && !pe) tab.querySelector(".okk")?.replaceWith(el("span", { class: "pend", text: String(p) }));
    const dot = tab?.querySelector(".chg");
    if (tab && changedFor(qm, q) && !dot) tab.append(chgDot());
    else if (dot && !changedFor(qm, q)) dot.remove();
    setToMark(toMark, p);
    const nextNav = navNode(ctx, manual);
    nav.replaceWith(nextNav);
    nav = nextNav;
  }
}
