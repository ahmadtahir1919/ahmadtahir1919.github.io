// Mode 3 — By student: the roster on the left, that student's whole paper on the right.
// A mark updates in place (verdict pill, presets, stepper, total, roster row, roster progress)
// without re-rendering the section, so focus and caret survive. Enter = save & next student;
// "Next to mark" jumps to the next student who still needs marking. Polls are never in the
// paper (the top bar's poll chip shows them).

import { S, t } from "../core/strings.js";
import { el } from "../ui/components.js";
import { FEEDBACK_CHIPS, G, anim, appendChip, colOf, firstName, fmt, ini, kbdOnPri, plural, shake, typeOf, updCounter, when } from "./gx-util.js";
import { ansOf, draftCount, needCount, setMarks, setOverall, stuScore, stuStatus, subs } from "./store.js";

const FILTERS = ["all", "need", "done", "none"];
/** Notes still inside their 500 ms typing pause: Save & next commits them before it flushes. */
const pendingNotes = new Map();
export const commitNotes = () => [...pendingNotes.values()].forEach((n) => n.commit());

function rosterList(ctx) {
  const qm = ctx.qm;
  return qm.studs.filter((s) => (ctx.rFilter === "all" || stuStatus(qm, s) === ctx.rFilter) && (!ctx.rSearch || s.name.toLowerCase().includes(ctx.rSearch)));
}

const platBadge = (s) => (s.plat ? el("span", { class: `plat ${s.attempt?.source === "ANDROID" ? "and" : ""}`, text: s.plat }) : null);

function scoreCell(qm, s) {
  const stt = stuStatus(qm, s);
  if (stt === "none") return [el("span", { class: "gpill", text: "—" })];
  const [g, m] = stuScore(qm, s);
  return [
    el("b", { text: t(S.GX_SCORE, { g: fmt(g), m }) }),
    stt === "need" ? el("span", { class: "gpill warn" }, [el("span", { class: "dotp" }), t(S.GX_N_TO_MARK, { n: needCount(qm, s) })]) : el("span", { class: "gpill ok", text: S.GX_GRADED }),
  ];
}

/** The next student (after the current one, wrapping) who still needs marking, or -1. */
function nextNeed(ctx) {
  const qm = ctx.qm;
  const n = qm.studs.length;
  for (let k = 1; k < n; k++) {
    const i = (ctx.stuCur + k) % n;
    if (stuStatus(qm, qm.studs[i]) === "need") return i;
  }
  return -1;
}

/** "1 of 2 students fully marked", a bar, and unsent changes with a Submit link. */
function rprogNode(ctx) {
  const qm = ctx.qm;
  const total = subs(qm).length;
  const done = subs(qm).filter((s) => stuStatus(qm, s) === "done").length;
  const dn = draftCount(qm);
  const bar = el("i");
  bar.style.width = `${total ? Math.round((done / total) * 100) : 100}%`;
  return el("div", { class: `rprog ${done === total ? "done" : ""}`, id: "rprog" }, [
    el("div", { class: "rpt" }, [
      el("span", {}, [done === total ? G.check(13, 2.8) : null, el("b", { text: String(done) }), t(S.GX_IND_PROG, { n: total })]),
      dn ? el("button", { class: "rdraft", type: "button", onclick: () => ctx.submit() }, [plural(dn, S.GX_IND_UNSENT_ONE, S.GX_IND_UNSENT_MANY)]) : null,
    ]),
    el("div", { class: "pbar" }, [bar]),
  ]);
}

export function renderInd(ctx, keepScroll = false) {
  const qm = ctx.qm;
  const prevList = keepScroll ? ctx.stage.querySelector("#rlist")?.scrollTop ?? 0 : 0;
  const prevPaper = keepScroll ? ctx.stage.querySelector("#pbody")?.scrollTop ?? 0 : 0;
  const cnt = (k) => qm.studs.filter((s) => k === "all" || stuStatus(qm, s) === k).length;
  const list = rosterList(ctx);
  const s = qm.studs[ctx.stuCur];
  const labels = { all: S.GX_R_ALL, need: S.GX_R_NEED, done: S.GX_R_DONE, none: S.GX_R_NONE };

  const search = el("input", { id: "rSearch", placeholder: S.GX_SEARCH_STUDENTS, "aria-label": S.GX_SEARCH_STUDENTS, value: ctx.rSearch, autocomplete: "off" });
  const chips = el(
    "div",
    { class: "chips", id: "rfil2" },
    FILTERS.map((k) => el("button", { type: "button", "data-f": k, class: ctx.rFilter === k ? "on" : "", "aria-pressed": String(ctx.rFilter === k) }, [labels[k], el("i", { text: String(cnt(k)) })]))
  );
  const rlist = el(
    "div",
    { class: "rlist", id: "rlist" },
    list.length
      ? list.map((x) =>
          el("button", { class: `st ${x === s ? "on" : ""}`, type: "button", "data-s": x.id, "aria-current": x === s ? "true" : null }, [
            el("span", { class: "ini", vars: { c: colOf(x.name) }, text: ini(x.name) }),
            el("span", { style: "min-width:0" }, [
              el("span", { class: "nm", text: x.name }),
              el("span", { class: "sub" }, x.sub ? [when(x.sub), " ", platBadge(x)] : [S.GX_NOT_STARTED_YET]),
            ]),
            el("span", { class: "scr" }, scoreCell(qm, x)),
          ])
        )
      : [el("div", { class: "gempty" }, [el("b", { text: S.GX_NO_STUDENTS_HERE }), S.GX_TRY_FILTER])]
  );
  const view = el("div", { class: "view ind", id: "indv", "data-pane": ctx.pane }, [
    el("div", { class: "roster" }, [el("div", { class: "rtools" }, [rprogNode(ctx), el("label", { class: "gsearch" }, [G.search(), search]), chips]), rlist]),
    el("div", { class: "paper" }, paperNodes(ctx, s)),
  ]);
  ctx.stage.replaceChildren(view);
  if (keepScroll) {
    rlist.scrollTop = prevList;
    const pb = ctx.stage.querySelector("#pbody");
    if (pb) pb.scrollTop = prevPaper;
  }

  search.addEventListener("input", () => {
    ctx.rSearch = search.value.toLowerCase().trim();
    const pos = search.selectionStart;
    renderInd(ctx, true);
    const next = ctx.stage.querySelector("#rSearch");
    next.focus();
    next.setSelectionRange(pos, pos);
  });
  chips.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    ctx.rFilter = b.dataset.f;
    renderInd(ctx);
  });
  rlist.addEventListener("click", (e) => {
    const b = e.target.closest(".st");
    if (!b) return;
    ctx.stuCur = qm.studs.findIndex((x) => x.id === b.dataset.s);
    ctx.pane = "paper";
    renderInd(ctx, true);
    const pb = ctx.stage.querySelector("#pbody");
    if (pb) pb.scrollTop = 0;
    animPaper(ctx);
    if (window.matchMedia("(max-width: 860px)").matches) window.scrollTo(0, 0);
  });
  wirePaper(ctx, s);
}

function paperNodes(ctx, s) {
  const qm = ctx.qm;
  if (!s) return [el("div", { class: "gempty" }, [el("b", { text: S.GX_PICK_STUDENT })])];
  const idx = qm.studs.indexOf(s);
  const [g, m] = stuScore(qm, s);
  const head = el("div", { class: "phead" }, [
    el("button", { class: "bt sm mback", type: "button", id: "mBack", text: S.GX_BACK_STUDENTS }),
    el("span", { class: "ini", style: `--c:${colOf(s.name)};width:40px;height:40px;border-radius:12px;font-size:14px`, text: ini(s.name) }),
    el("div", { style: "min-width:0" }, [
      el("h2", { text: s.name }),
      el("small", {}, s.sub ? (s.plat ? [t(S.GX_SUBMITTED_WHEN_SEP, { when: when(s.sub) }), platBadge(s)] : [t(S.GX_SUBMITTED_CAP, { when: when(s.sub) })]) : [S.GX_HAS_NOT_STARTED]),
    ]),
    s.sub ? el("div", { class: "ptot" }, [el("b", { id: "ptotV", text: fmt(g) }), " ", el("span", { text: t(S.GX_OF_PTS, { m }) })]) : null,
    s.sub
      ? el("button", { class: "icob", type: "button", id: "stuDl", title: t(S.GX_DL_STUDENT_TITLE, { name: firstName(s.name) }), "aria-label": t(S.GX_DL_STUDENT_LABEL, { name: s.name }) }, [G.download()])
      : null,
  ]);
  const foot = el("div", { class: "pfoot" }, [
    el("button", { class: "bt sm", type: "button", id: "prevS", text: S.GX_PREVIOUS }),
    el("span", { class: "pos", text: t(S.GX_I_OF_N, { i: idx + 1, n: qm.studs.length }) }),
    el("span", { class: "sp" }),
    wayNode(ctx),
    el("button", { class: "bt pri", type: "button", id: "nextS" }, [S.GX_SAVE_NEXT, " ", kbdOnPri(S.GX_KEY_ENTER)]),
  ]);
  if (!s.sub) {
    return [head, el("div", { class: "pbody", id: "pbody" }, [el("div", { class: "gempty" }, [el("b", { text: S.GX_NOTHING_YET }), t(S.GX_NOT_STARTED_BODY, { name: firstName(s.name) })])]), foot];
  }
  const ofb = el("textarea", { class: "ftxt", id: "ofb", maxlength: "500", placeholder: S.GX_OVERALL_PH, "aria-label": t(S.GX_OVERALL_FOR, { name: firstName(s.name) }) });
  ofb.value = s.attempt?.overall_feedback ?? "";
  const sections = qm.qs.map((q) => (ansOf(qm, s.id, q.id) ? pqNode(ctx, s, q) : null));
  return [
    head,
    el("div", { class: "pbody", id: "pbody" }, [
      ...sections,
      el("div", { class: "ovf" }, [el("h4", {}, [t(S.GX_NOTE_FOR, { name: firstName(s.name) }), " ", el("span", { text: S.GX_WHOLE_QUIZ })]), ofb, el("span", { class: "cc", id: "ofbCc" })]),
    ]),
    foot,
  ];
}

/** The way on, beside Save & next: "Next to mark" while someone else still needs marking,
 *  else "Everyone is marked" (and Submit while marks are unsent). */
function wayNode(ctx) {
  const qm = ctx.qm;
  const ni = nextNeed(ctx);
  let kids = [];
  if (ni >= 0) kids = [el("button", { class: "bt sm", type: "button", id: "nextNeed", title: qm.studs[ni].name }, [S.GX_BQ_NEXT_TO_MARK, " →"])];
  else if (stuStatus(qm, qm.studs[ctx.stuCur]) !== "need" && subs(qm).length) {
    kids = [
      el("span", { class: "bqok" }, [G.check(14, 2.6), el("span", { class: "evl", text: S.GX_IND_ALL_DONE })]),
      draftCount(qm) ? el("button", { class: "bt sm", type: "button", onclick: () => ctx.submit() }, [G.send(), S.GX_SUBMIT]) : null,
    ];
  }
  return el("span", { class: "pway", id: "pway" }, kids);
}

function verdictPill(a) {
  if (a.pts == null) return el("span", { class: "gpill warn" }, [el("span", { class: "dotp" }), S.GX_NEEDS_MARKING]);
  if (a.pts === a.max) return el("span", { class: "gpill ok", text: t(S.GX_V_FULL, { x: fmt(a.pts), max: a.max }) });
  if (a.pts === 0) return el("span", { class: "gpill bad", text: t(S.GX_V_ZERO, { max: a.max }) });
  return el("span", { class: "gpill acc", text: t(S.GX_X_OF_MAX, { x: fmt(a.pts), max: a.max }) });
}

function vrNodes(a) {
  return [
    a.auto ? el("span", { style: "font-size:11.5px;color:var(--faint)", text: a.adj ? S.GX_CHANGED_BY_YOU : S.GX_AUTO_MARKED_LBL }) : null,
    verdictPill(a),
    G.chevron(16, 2.2, "chev"),
  ];
}

const pctOf = (a) => (a.pts == null ? null : Math.round((a.pts / a.max) * 100));

function pqNode(ctx, s, q) {
  const a = ansOf(ctx.qm, s.id, q.id);
  const T = q.type;
  const need = a.manual && a.pts == null;
  const open = need || (a.manual && a.fb) || a._open;
  const filled = a.given.trim().length > 0;
  const pct = pctOf(a);
  const ta = el("textarea", { class: "ftxt", maxlength: "500", placeholder: S.GX_NOTE_ANSWER_PH, "aria-label": S.GX_NOTE_LABEL });
  ta.value = a.fb;
  return el("section", { class: `pq ${need ? "need" : ""} ${open ? "open" : ""}`, "data-q": q.id, style: `--tc:${typeOf(T).c}` }, [
    el("button", { class: "pqh", type: "button", "aria-expanded": String(!!open) }, [el("span", { class: "qn", text: String(q.num) }), el("span", { class: "qt", text: q.text }), el("span", { class: "vr" }, vrNodes(a))]),
    el("div", { class: "pqb", hidden: !open }, [
      el("div", { class: "ansr" }, [
        el("div", { class: "abox stu" }, [el("small", {}, [el("span", { text: S.GX_ANSWER })]), el("div", { class: `big ${a.given.length > 60 ? "long" : ""} ${filled ? "" : "empty"}`, text: filled ? a.given : S.GX_NO_ANSWER })]),
        el("div", { class: "abox" }, [el("small", {}, [el("span", { text: a.manual ? S.GX_EXPECTED : S.GX_CORRECT })]), el("div", { class: "exp", text: q.exp })]),
      ]),
      el("div", { class: "wid" }, [
        el("div", { class: "wrow" }, [
          el("div", { class: "pres", role: "group", "aria-label": S.GX_QUICK_MARKS }, [0, 25, 50, 75, 100].map((p) => el("button", { type: "button", "data-p": String(p), class: pct === p ? "on" : "", "aria-pressed": String(pct === p), text: `${p}%` }))),
          el("div", { class: "stepper" }, [
            el("button", { type: "button", "data-d": "-1", "aria-label": S.GX_LESS, text: "−" }),
            el("input", { inputmode: "numeric", value: a.pts == null ? "" : fmt(a.pts), placeholder: "–", "aria-label": S.GX_MARKS, autocomplete: "off" }),
            el("button", { type: "button", "data-d": "1", "aria-label": S.GX_MORE, text: "+" }),
          ]),
          el("span", { text: t(S.GX_OF_PTS, { m: a.max }) }),
        ]),
        el("div", { class: "fchips" }, FEEDBACK_CHIPS().map((x) => el("button", { type: "button", text: x, "data-chip": x }))),
        ta,
        el("span", { class: "cc" }),
      ]),
    ]),
  ]);
}

function wirePaper(ctx, s) {
  const qm = ctx.qm;
  const $ = (sel) => ctx.stage.querySelector(sel);
  $("#stuDl")?.addEventListener("click", () => ctx.openReport({ scope: "one", sid: s.id }));
  $("#mBack")?.addEventListener("click", () => {
    ctx.pane = "roster";
    renderInd(ctx, true);
  });
  $("#prevS")?.addEventListener("click", () => goStu(ctx, -1, false));
  $("#nextS")?.addEventListener("click", () => goStu(ctx, 1, true));
  $(".pfoot")?.addEventListener("click", (e) => {
    if (e.target.closest("#nextNeed")) goNeed(ctx);
  });
  if (!s || !s.sub) return;

  const ofb = $("#ofb");
  const ofbCc = $("#ofbCc");
  const upo = () => updCounter(ofbCc, ofb.value.length);
  upo();
  ofb.addEventListener("input", () => {
    upo();
    setOverall(qm, s, ofb.value);
  });

  for (const sec of ctx.stage.querySelectorAll(".pq")) {
    const q = qm.qs.find((x) => x.id === sec.dataset.q);
    const key = `${s.id}|${q.id}`;
    const a = qm.A.get(key);
    const head = sec.querySelector(".pqh");
    const body = sec.querySelector(".pqb");
    head.addEventListener("click", () => {
      const open = body.hidden;
      a._open = open;
      sec.classList.toggle("open", open);
      head.setAttribute("aria-expanded", String(open));
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        body.hidden = !open;
        return;
      }
      if (open) {
        body.hidden = false;
        const h = body.offsetHeight;
        body.animate([{ height: "0px", opacity: 0, overflow: "hidden" }, { height: `${h}px`, opacity: 1, overflow: "hidden" }], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
      } else {
        const h = body.offsetHeight;
        body.animate([{ height: `${h}px`, opacity: 1, overflow: "hidden" }, { height: "0px", opacity: 0, overflow: "hidden" }], { duration: 180, easing: "ease-in" }).onfinish = () => {
          if (!a._open) body.hidden = true;
        };
      }
    });

    const inp = sec.querySelector(".stepper input");
    const ta = sec.querySelector("textarea");
    const cc = sec.querySelector(".wid .cc");
    const upc = () => updCounter(cc, ta.value.length);
    upc();
    const apply = (v) => {
      const cur = qm.A.get(key);
      setMarks(qm, [key], Math.max(0, Math.min(cur.max, Math.round(v))));
      updPaper(ctx, sec, s, q);
    };
    for (const b of sec.querySelectorAll(".pres button")) b.addEventListener("click", () => apply(Math.floor((qm.A.get(key).max * Number(b.dataset.p)) / 100)));
    for (const b of sec.querySelectorAll(".stepper [data-d]")) {
      b.addEventListener("click", () => {
        const cur = qm.A.get(key);
        apply((cur.pts == null ? 0 : cur.pts) + Number(b.dataset.d));
      });
    }
    inp.addEventListener("change", () => {
      const cur = qm.A.get(key);
      const raw = inp.value.trim();
      const v = Number(raw);
      if (!raw || Number.isNaN(v)) {
        inp.value = cur.pts == null ? "" : fmt(cur.pts);
        return;
      }
      if (!Number.isInteger(v) || v > cur.max || v < 0) {
        shake(inp);
        ctx.toast(t(S.GX_ENTER_RANGE, { max: cur.max }));
        if (!Number.isInteger(v)) {
          inp.value = cur.pts == null ? "" : fmt(cur.pts);
          return;
        }
      }
      apply(v);
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        inp.blur();
      }
    });
    ta.addEventListener("input", () => {
      upc();
      clearTimeout(pendingNotes.get(key)?.timer);
      const commit = () => {
        clearTimeout(pendingNotes.get(key)?.timer);
        pendingNotes.delete(key);
        setMarks(qm, [key], undefined, { fb: ta.value });
      };
      pendingNotes.set(key, { commit, timer: setTimeout(commit, 500) });
    });
    for (const b of sec.querySelectorAll(".fchips button")) b.addEventListener("click", () => appendChip(ta, b.dataset.chip));
  }
}

/** Swap only the header verdict + widget state, so the textarea keeps focus and caret. */
function updPaper(ctx, sec, s, q) {
  const qm = ctx.qm;
  const a = qm.A.get(`${s.id}|${q.id}`);
  a._open = true;
  sec.querySelector(".vr").replaceChildren(...vrNodes(a).filter(Boolean));
  sec.classList.toggle("need", a.manual && a.pts == null);
  const pct = pctOf(a);
  for (const b of sec.querySelectorAll(".pres button")) {
    b.classList.toggle("on", Number(b.dataset.p) === pct);
    b.setAttribute("aria-pressed", String(Number(b.dataset.p) === pct));
  }
  sec.querySelector(".stepper input").value = a.pts == null ? "" : fmt(a.pts);
  anim(sec.querySelector(".vr .gpill"), [{ transform: "scale(.85)" }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.34,1.56,.64,1)" });
  const [g] = stuScore(qm, s);
  const tot = ctx.stage.querySelector("#ptotV");
  if (tot) tot.textContent = fmt(g);
  const row = ctx.stage.querySelector(`.st[data-s="${CSS.escape(s.id)}"] .scr`);
  if (row) row.replaceChildren(...scoreCell(qm, s));
  ctx.stage.querySelector("#rprog")?.replaceWith(rprogNode(ctx));
  // The way on can change with this mark (this student done, or everyone done).
  ctx.stage.querySelector("#pway")?.replaceWith(wayNode(ctx));
}

/** Jump to the next student who still needs marking. */
function goNeed(ctx) {
  const i = nextNeed(ctx);
  if (i < 0) return;
  commitNotes();
  // Make sure they're in the list being shown.
  if (ctx.rFilter !== "all" && ctx.rFilter !== "need") ctx.rFilter = "all";
  ctx.rSearch = "";
  ctx.stuCur = i;
  ctx.pane = "paper";
  renderInd(ctx, true);
  const pb = ctx.stage.querySelector("#pbody");
  if (pb) pb.scrollTop = 0;
  animPaper(ctx);
  ctx.stage.querySelector(".st.on")?.scrollIntoView({ block: "nearest" });
}

function goStu(ctx, d, save) {
  const qm = ctx.qm;
  const list = rosterList(ctx);
  if (!list.length) return;
  let i = list.indexOf(qm.studs[ctx.stuCur]);
  commitNotes();
  if (save) {
    const s = qm.studs[ctx.stuCur];
    const left = s && s.sub ? needCount(qm, s) : 0;
    const name = s ? firstName(s.name) : "";
    // Nothing is sent here: marks stay drafts until Submit marks (one notification per student).
    ctx.toast(left ? plural(left, S.GX_SAVED_LEFT_ONE, S.GX_SAVED_LEFT_MANY, { name }) : S.GX_SAVED_TOAST);
  }
  i = i < 0 ? 0 : (i + d + list.length) % list.length;
  ctx.stuCur = qm.studs.indexOf(list[i]);
  ctx.pane = "paper";
  renderInd(ctx, true);
  const pb = ctx.stage.querySelector("#pbody");
  if (pb) pb.scrollTop = 0;
  animPaper(ctx, d);
  ctx.stage.querySelector(".st.on")?.scrollIntoView({ block: "nearest" });
}

function animPaper(ctx, d = 1) {
  anim(ctx.stage.querySelector(".paper"), [{ opacity: 0, transform: `translateY(${(d || 1) * 10}px)` }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
}

/** By student keys (only reached when not typing and no dialog is open). */
export function indKey(ctx, e) {
  if (e.key === "Enter") {
    e.preventDefault();
    goStu(ctx, 1, true);
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    goStu(ctx, 1, false);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    goStu(ctx, -1, false);
  }
}
