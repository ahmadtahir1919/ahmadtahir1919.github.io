// The centre column: the question card (design-reference/editor.html renderCardInner/bodyFor)
// and the "Question settings" card under it (renderPane). The settings inside follow the app's
// question builder: its time and points presets, its written-answer checking rules, its
// fill-in-the-blank points modes and its poll settings, in its order.
//
// [ed] is the page's editor API (builder-page.js): form(), index(), total(), limits, quiz(),
// readOnly(), change(key, fn, opts), toast(), and the render/navigation calls.

import { MARKS_PATTERNS as MP, MATCH_MODES as MM, MAX_POINTS, QUESTION_TYPES as T, FILL_BLANK_CHECKING } from "../core/models.js";
import { S, t } from "../core/strings.js";
import { el } from "../ui/components.js";
import { animateOut, prefersReducedMotion, reveal, smooth } from "../ui/motion.js";
import { item, sentenceBlanks } from "./form.js";
import { G, TYPE_ICON, svg } from "./qe-icons.js";
import { FILLS, missing, shortTime, steps, typeName } from "./qe-model.js";

const TIME_PRESETS = [15, 30, 60]; // the app's TimeLimitPicker chips
const POINT_PRESETS = [5, 10, 20]; // the app's PointsPicker chips
const TIME_MIN = 5;
const TIME_MAX = 3600; // the app's custom clamp (5–3600 s)
const SMART_PASTE_MAX = 10;

// ── Character counters (applyLimits) ─────────────────────────────────────────

/** Adds an "x / max" counter to every [data-max] field under [root] not counted yet.
 *  Options and alias boxes get theirs inside the box (below it); the rest right-aligned under. */
export function applyLimits(root) {
  root.querySelectorAll("input[data-max], textarea[data-max]").forEach((field) => {
    if (field.dataset.cc) return;
    field.dataset.cc = "1";
    const max = Number(field.dataset.max);
    field.maxLength = max;
    const inside = field.closest(".opt") || field.closest(".aw");
    const c = el("span", { class: `cc${inside ? " in" : ""}`, "aria-live": "polite" });
    if (!inside && getComputedStyle(field.parentElement).position === "static") field.parentElement.style.position = "relative";
    field.after(c);
    const up = () => {
      const l = field.value.length;
      c.textContent = `${l} / ${max}`;
      c.classList.toggle("near", l >= max * 0.9 && l < max);
      c.classList.toggle("full", l >= max);
    };
    field.addEventListener("input", up);
    field._cc = up;
    up();
  });
}

const grow = (ta) => {
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`;
};

const raw = (markup) => svg(markup);

// ── Card ─────────────────────────────────────────────────────────────────────

/** Renders the card for the current question into [host]. [enter] plays the qIn entrance (only
 *  when the question changed), [swap] crossfades the body (type change), [fresh] marks the last
 *  option as newly added. */
export function renderCard(host, ed, { enter = false, swap = false, fresh = null, focus = null } = {}) {
  smooth(host, () => {
    host.replaceChildren(cardNode(ed));
    applyLimits(host);
    host.querySelectorAll("textarea.qtext, textarea.fibin").forEach(grow);
  });
  const card = host.querySelector(".qcard");
  if (enter && !prefersReducedMotion()) card.classList.add("enter");
  if (swap && !prefersReducedMotion()) card.querySelector(".cbody").classList.add("swap");
  if (fresh) host.querySelector(`.opt[data-k="${CSS.escape(fresh)}"]`)?.classList.add("fresh");
  if (focus) requestAnimationFrame(() => host.querySelector(focus)?.focus());
}

function cardNode(ed) {
  const form = ed.form();
  const ro = ed.readOnly();
  const typeBtn = el("button", { class: "typebtn", type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "data-type-btn": "", disabled: ro || undefined }, [
    el("span", { class: "ti" }, [raw(TYPE_ICON[form.type])]),
    typeName(form.type),
    raw(G.caret),
  ]);
  typeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    ed.toggleTypeMenu(typeBtn);
  });
  const head = el("div", { class: "chead" }, [
    el("span", { class: "qn", text: t(S.QE_QUESTION_N_OF, { n: ed.index() + 1, total: ed.total() }) }),
    typeBtn,
    ro ? null : el("button", { class: "iconbtn", type: "button", title: S.QE_DUPLICATE, "aria-label": S.QE_DUPLICATE_Q, onclick: () => ed.duplicate() }, [raw(G.dup)]),
    ro ? null : el("button", { class: "iconbtn", type: "button", title: S.QE_DELETE, "aria-label": S.QE_DELETE_Q, onclick: () => ed.remove() }, [raw(G.del)]),
  ]);

  const fb = form.type === T.FILL_BLANK;
  const text = el("textarea", {
    class: "qtext",
    rows: "1",
    dir: "auto",
    placeholder: fb ? S.QE_FB_TITLE_PH : S.QE_TEXT_PH,
    "aria-label": fb ? S.FILL_TITLE_LABEL : S.QUESTION_TEXT_LABEL,
    "data-max": String(ed.limits.maxQuestionTextChars),
    "data-fk": "question-text",
    readonly: ro || undefined,
  });
  text.value = fb ? form.fb.title : form.text;
  text.addEventListener("input", () => {
    grow(text);
    ed.change("text", (f) => (f.type === T.FILL_BLANK ? (f.fb.title = text.value) : (f.text = text.value)));
    ed.nudge();
  });
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const next = document.querySelector(".opt input:not([readonly]), #qe-exp, .fibin") ?? document.querySelector(".mark");
      next?.focus();
    }
  });

  const body = el("div", { class: "cbody" }, [text, ...bodyFor(ed, form), footer(ed, form)]);
  return el("div", { class: "qcard", "data-ty": form.type }, [head, body]);
}

function footer(ed, form) {
  const ready = !missing(form, ed.ctx());
  const last = ed.index() >= ed.total() - 1;
  const next = el("button", { class: `nqb ${ready ? "ready" : ""}`, type: "button", "data-card-next": "", onclick: () => ed.goNext() }, [
    el("span", { text: last ? S.QE_NEXT : t(S.QE_GO_TO, { n: ed.index() + 2 }) }),
    el("kbd", { text: S.QE_KBD_NEXT }),
    raw(G.arrowRight),
  ]);
  if (ed.readOnly() && last) next.disabled = true;
  return el("div", { class: "cnext" }, [el("div", { class: "steps", "data-steps": "" }, stepsNodes(form, ed)), next]);
}

export function stepsNodes(form, ed) {
  const list = steps(form, ed.ctx());
  const n = list.filter((s) => s[1]).length;
  const all = n === list.length;
  const out = [el("span", { class: `slab ${all ? "ok" : ""}`, text: all ? S.QE_COMPLETE : S.QE_TO_FINISH })];
  list.forEach(([label, ok], i) => {
    if (i) out.push(el("span", { class: "sjoin" }));
    out.push(el("span", { class: `stp ${ok ? "ok" : ""}` }, [el("i", {}, [ok ? raw(G.stepTick) : null]), label]));
  });
  return out;
}

/** Steps + Next button + rail after typing (no card re-render, so the caret stays put). */
export function nudgeCard(host, ed) {
  const form = ed.form();
  const box = host.querySelector("[data-steps]");
  if (!box) return;
  const before = box.querySelectorAll(".stp.ok").length;
  const nodes = stepsNodes(form, ed);
  const after = nodes.filter((n) => n.classList?.contains("stp") && n.classList.contains("ok")).length;
  if (before !== after || box.children.length !== nodes.length) box.replaceChildren(...nodes);
  host.querySelector("[data-card-next]")?.classList.toggle("ready", !missing(form, ed.ctx()));
}

function bodyFor(ed, form) {
  if (form.type === T.WRITTEN) return writtenBody(ed, form);
  if (form.type === T.FILL_BLANK) return blanksBody(ed, form);
  return optionsBody(ed, form);
}

function labelRow(left, right) {
  return el("div", { class: "qlabel" }, [el("span", { text: left }), el("span", { text: right })]);
}

function writtenBody(ed, form) {
  const manual = ed.quiz().manualMarkingDefault;
  const exp = el("input", {
    class: "qfield",
    id: "qe-exp",
    dir: "auto",
    placeholder: S.QE_EXPECTED_PH,
    "aria-label": S.WRITTEN_ANSWER_LABEL,
    "data-max": String(ed.limits.maxAnswerTextChars),
    "data-fk": "written-answer",
    readonly: ed.readOnly() || undefined,
  });
  exp.value = form.writtenAnswer;
  exp.addEventListener("input", () => {
    ed.change("written-answer", (f) => (f.writtenAnswer = exp.value));
    ed.nudge();
    ed.refreshTry();
  });
  const smart = (form.answerRule.matchModeList ?? []).includes(MM.FUZZY_TYPO_TOLERANT);
  return [
    labelRow(S.QE_EXPECTED, manual ? S.QE_HINT_MANUAL : S.QE_EXPECTED_SUB),
    el("div", { class: "written" }, [exp, el("div", { class: "hintline", text: manual ? S.QE_EXPECTED_HINT_MANUAL : smart ? S.QE_EXPECTED_HINT : S.QE_EXPECTED_HINT_PLAIN })]),
  ];
}

function optionsBody(ed, form) {
  const ro = ed.readOnly();
  const poll = form.type === T.POLL;
  const multi = form.type === T.MULTIPLE_CORRECT;
  const tf = form.type === T.TRUE_FALSE;
  const manual = ed.quiz().manualMarkingDefault;
  const parts = [];

  if (poll) {
    const current = form.items.map((i) => i.text).join("\n");
    parts.push(
      el("div", { class: "qfill", "data-pollfill": "" }, [
        el("span", { class: "qfl" }, [raw(G.bolt), S.QE_QUICK_FILL]),
        ...FILLS.map(([label, list]) =>
          el("button", {
            type: "button",
            class: current === list.join("\n") ? "on" : "",
            text: label(),
            disabled: ro || undefined,
            onclick: () => {
              ed.change("poll-fill", (f) => (f.items = list.slice(0, ed.limits.maxOptions).map((x) => item(x))), { card: true, rail: true });
            },
          })
        ),
      ])
    );
  }

  const side = poll ? S.QE_HINT_POLL : manual ? S.QE_HINT_MANUAL : multi ? S.QE_HINT_MULTI : S.QE_HINT_SINGLE;
  parts.push(labelRow(poll ? S.QE_OPTIONS : S.QE_ANSWERS, side));

  const opts = el("div", { class: `opts ${multi ? "multi" : poll ? "poll" : ""}`, "data-opts": "" });
  form.items.forEach((row, i) => {
    const correct = row.correct && !poll;
    const input = el("input", {
      dir: "auto",
      placeholder: tf ? "" : t(S.QE_OPTION_N, { n: i + 1 }),
      "aria-label": t(S.QE_OPTION_N, { n: i + 1 }),
      readonly: tf || ro || undefined,
      "data-max": String(ed.limits.maxOptionTextChars),
      "data-fk": `opt-${row.key}`,
    });
    input.value = row.text;
    opts.appendChild(
      el("div", { class: `opt ${correct ? "correct" : ""}`, "data-k": row.key }, [
        tf || ro ? null : el("span", { class: "ograb", title: S.QE_DRAG_HINT.split(" · ")[0], "aria-hidden": "true" }, [raw(G.grip)]),
        el("button", { class: "mark", type: "button", "aria-label": t(S.QE_MARK_N, { n: i + 1 }), "aria-pressed": correct ? "true" : "false", disabled: ro || undefined }, [el("span")]),
        input,
        correct ? el("span", { class: "ctag", text: S.QE_CORRECT }) : null,
        tf || ro ? null : el("button", { class: "iconbtn x", type: "button", "aria-label": S.QE_REMOVE_OPTION, text: "✕" }),
      ])
    );
  });
  if (!tf && !ro) {
    opts.appendChild(
      el("button", { class: "addopt", type: "button", text: S.QE_ADD_OPTION, disabled: form.items.length >= ed.limits.maxOptions || undefined, title: form.items.length >= ed.limits.maxOptions ? t(S.QE_MAX_OPTIONS, { n: ed.limits.maxOptions }) : undefined, onclick: () => addOption(ed) })
    );
  }
  if (!ro) wireOptions(opts, ed);
  parts.push(opts);
  return parts;
}

function addOption(ed, focusNew = true) {
  const form = ed.form();
  if (form.items.length >= ed.limits.maxOptions) {
    ed.toast(t(S.QE_MAX_OPTIONS, { n: ed.limits.maxOptions }));
    return;
  }
  const row = item();
  ed.change("add-option", (f) => f.items.push(row), { card: { fresh: row.key, focus: focusNew ? `.opt[data-k="${CSS.escape(row.key)}"] input` : null }, rail: true });
}

function wireOptions(opts, ed) {
  const keyOf = (node) => node.closest(".opt")?.dataset.k;
  opts.addEventListener("click", (e) => {
    const k = keyOf(e.target);
    if (!k) return;
    const form = ed.form();
    if (e.target.closest(".mark")) {
      if (form.type === T.POLL) return;
      ed.change(
        `mark-${k}`,
        (f) => {
          if (f.type === T.MULTIPLE_CORRECT) {
            const row = f.items.find((i) => i.key === k);
            if (row) row.correct = !row.correct;
          } else f.items.forEach((i) => (i.correct = i.key === k));
        },
        { card: true, rail: true, pane: true }
      );
    } else if (e.target.closest(".x")) {
      if (form.items.length <= 2) {
        ed.toast(S.QE_MIN_OPTIONS);
        return;
      }
      animateOut(e.target.closest(".opt"), () => ed.change(`remove-${k}`, (f) => (f.items = f.items.filter((i) => i.key !== k)), { card: true, rail: true, pane: true }));
    }
  });
  opts.addEventListener("input", (e) => {
    const k = keyOf(e.target);
    if (!k || !e.target.matches("input")) return;
    ed.change(`opt-${k}`, (f) => {
      const row = f.items.find((i) => i.key === k);
      if (row) row.text = e.target.value;
    });
    ed.nudge();
  });
  opts.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.ctrlKey || e.metaKey || !e.target.matches("input")) return;
    e.preventDefault();
    const k = keyOf(e.target);
    const items = ed.form().items;
    const at = items.findIndex((i) => i.key === k);
    if (at === items.length - 1) addOption(ed);
    else opts.querySelectorAll(".opt input")[at + 1]?.focus();
  });
  // Drag to reorder by the grip (HTML5 DnD).
  let from = null;
  opts.addEventListener("mousedown", (e) => {
    const grab = e.target.closest(".ograb");
    if (grab) grab.closest(".opt").setAttribute("draggable", "true");
  });
  opts.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".opt");
    if (!row) return;
    from = row.dataset.k;
    row.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", from);
    } catch {
      /* some browsers refuse custom data */
    }
  });
  opts.addEventListener("dragover", (e) => {
    const row = e.target.closest(".opt");
    if (!row || from === null) return;
    e.preventDefault();
    opts.querySelectorAll(".opt").forEach((x) => x.classList.toggle("drop-on", x === row && row.dataset.k !== from));
  });
  opts.addEventListener("drop", (e) => {
    const row = e.target.closest(".opt");
    if (!row || from === null) return;
    e.preventDefault();
    const to = row.dataset.k;
    const f = from;
    from = null;
    if (f === to) return ed.renderCard();
    ed.change("reorder-options", (form) => {
      const a = form.items.findIndex((i) => i.key === f);
      const b = form.items.findIndex((i) => i.key === to);
      const [moved] = form.items.splice(a, 1);
      form.items.splice(b, 0, moved);
    }, { card: true });
  });
  opts.addEventListener("dragend", () => {
    from = null;
    opts.querySelectorAll(".opt").forEach((x) => {
      x.classList.remove("dragging", "drop-on");
      x.removeAttribute("draggable");
    });
  });
}

/** Smart paste (single, multiple, poll): a pasted list fills options, or — pasted into the
 *  question text with 3+ lines — becomes the question plus its options. */
export function wireSmartPaste(host, ed) {
  const clean = (line) => line.replace(/^\s*(?:[-•*▪●○◦]|\(?[a-zA-Z0-9]{1,2}[.):])\s+/, "").trim();
  host.addEventListener("paste", (e) => {
    if (ed.readOnly()) return;
    const form = ed.form();
    if (!form || ![T.SINGLE_CHOICE, T.MULTIPLE_CORRECT, T.POLL].includes(form.type)) return;
    const target = e.target;
    const lines = (e.clipboardData?.getData("text") ?? "").split(/\r?\n/).map(clean).filter(Boolean);
    let at;
    let qline = null;
    if (target.matches(".opt input:not([readonly])")) {
      if (lines.length < 2) return;
      at = form.items.findIndex((i) => i.key === target.closest(".opt").dataset.k);
    } else if (target.matches(".qtext") && lines.length >= 3) {
      qline = lines.shift();
      at = 0;
    } else return;
    e.preventDefault();
    const cap = Math.min(SMART_PASTE_MAX, ed.limits.maxOptions);
    const take = lines.slice(0, Math.max(0, cap - at));
    const maxOpt = ed.limits.maxOptionTextChars;
    ed.change(
      "smart-paste",
      (f) => {
        if (qline !== null) f.text = qline.slice(0, ed.limits.maxQuestionTextChars);
        take.forEach((text, k) => {
          const i = at + k;
          if (i < f.items.length) f.items[i].text = text.slice(0, maxOpt);
          else f.items.push(item(text.slice(0, maxOpt)));
        });
        if (qline !== null) f.items = f.items.filter((row, i) => i < take.length || row.text.trim());
        while (f.items.length < 2) f.items.push(item());
      },
      { card: true, rail: true, breakChain: true }
    );
    ed.toast(qline !== null ? t(S.QE_FILLED_Q, { n: take.length }) : t(S.QE_FILLED, { n: take.length }), { label: S.UNDO, fn: ed.undo });
  });
}

// ── Fill in the blanks (the existing bracket-sentence model, in the reference's style) ──

function blanksBody(ed, form) {
  const ro = ed.readOnly();
  const { maxQuestionTextChars, maxFillBlanks } = ed.limits;
  const sentence = el("textarea", {
    class: "qfield fibin",
    rows: "1",
    dir: "auto",
    placeholder: S.QE_SENTENCE_PH,
    "aria-label": S.FILL_SENTENCE_LABEL,
    "data-fk": "fb-sentence",
    readonly: ro || undefined,
  });
  sentence.value = form.fb.sentence;
  const preview = el("div", { class: "fib", dir: "auto", "aria-live": "polite" });
  const list = el("div", { class: "blist" });
  const visible = (s) => s.replace(/\[[^[\]]*\]/g, "").length;
  const counter = el("span", { class: "cc" });
  const upCount = () => {
    const l = visible(sentence.value);
    counter.textContent = `${l} / ${maxQuestionTextChars}`;
    counter.classList.toggle("near", l >= maxQuestionTextChars * 0.9 && l < maxQuestionTextChars);
    counter.classList.toggle("full", l >= maxQuestionTextChars);
  };
  let lastCount = sentenceBlanks(form.fb.sentence).length;
  const refresh = (structural) => {
    renderFibPreview(preview, ed.form().fb.sentence);
    if (structural) renderBlankRows(list, ed);
    else updateBlankNames(list, ed.form().fb.sentence);
  };
  sentence.addEventListener("input", () => {
    grow(sentence);
    upCount();
    const count = sentenceBlanks(sentence.value).length;
    const changed = count !== lastCount;
    lastCount = count;
    ed.change("fb-sentence", (f) => {
      f.fb.sentence = sentence.value;
      if (changed) syncBlankPoints(f);
    }, changed ? { pane: true } : {});
    refresh(changed);
    ed.nudge();
  });
  const make = el("button", { type: "button", text: S.QE_MAKE_BLANK, title: S.MAKE_BLANK_TITLE, disabled: ro || lastCount >= maxFillBlanks || undefined });
  make.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
  make.addEventListener("click", () => {
    const { selectionStart: a, selectionEnd: b, value } = sentence;
    if (sentenceBlanks(value).length >= maxFillBlanks) return;
    const picked = value.slice(a, b);
    if (/[[\]]/.test(picked)) return;
    sentence.value = `${value.slice(0, a)}[${picked.trim()}]${value.slice(b)}`;
    sentence.dispatchEvent(new Event("input"));
    sentence.focus();
    const caret = a + picked.trim().length + 2;
    sentence.setSelectionRange(caret, caret);
  });
  upCount();
  renderFibPreview(preview, form.fb.sentence);
  renderBlankRows(list, ed);
  return [
    labelRow(S.QE_SENTENCE, S.QE_SENTENCE_SUB),
    el("div", {}, [sentence, counter]),
    ro ? null : el("div", { class: "fibbar" }, [make, el("span", { text: S.QE_SENTENCE_HINT })]),
    preview,
    list,
  ];
}

function renderFibPreview(node, sentence) {
  const parts = [];
  const re = /\[([^[\]]*)\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(sentence)) !== null) {
    if (m.index > last) parts.push(document.createTextNode(sentence.slice(last, m.index)));
    parts.push(el("span", { class: `blank ${m[1].trim() ? "" : "is-empty"}`, text: m[1].trim() || " " }));
    last = m.index + m[0].length;
  }
  if (last < sentence.length) parts.push(document.createTextNode(sentence.slice(last)));
  if (!parts.length) parts.push(el("span", { class: "ph", text: S.QE_PREVIEW_EMPTY }));
  node.replaceChildren(...parts);
}

function updateBlankNames(list, sentence) {
  const answers = sentenceBlanks(sentence);
  list.querySelectorAll("[data-canonical]").forEach((b) => {
    const v = (answers[Number(b.dataset.canonical)] ?? "").trim();
    b.textContent = v || S.QE_BLANK_EMPTY;
    b.classList.toggle("is-empty", !v);
  });
}

/** Per-blank points modes, as the app derives them from the saved data. */
export function blankPointsMode(form) {
  const n = sentenceBlanks(form.fb.sentence).length;
  const pts = form.fb.points.slice(0, n);
  const custom = pts.some((p) => p !== null && p !== undefined);
  if (!custom) return "off";
  if (form.fb.equal === true) return "split";
  if (form.fb.equal === false) return "each";
  const share = (form.points || 0) / Math.max(1, n);
  return pts.every((p) => Math.abs((p ?? 0) - share) < 0.01) ? "split" : "each";
}

/** Keeps per-blank points in step after the blank list changes (resyncFillBlankPoints). */
export function syncBlankPoints(form) {
  const n = sentenceBlanks(form.fb.sentence).length;
  const mode = blankPointsMode(form);
  if (mode === "off") return;
  if (mode === "split") {
    form.fb.points = Array.from({ length: n }, () => Math.max(0, form.points) / Math.max(1, n));
  } else {
    form.fb.points = Array.from({ length: n }, (_, i) => form.fb.points[i] ?? 0);
    form.points = Math.max(0, Math.round(form.fb.points.reduce((a, b) => a + (b ?? 0), 0)));
  }
}

const fmtPts = (v) => {
  const r = Math.round(v * 10) / 10;
  return String(r);
};

function renderBlankRows(list, ed) {
  const form = ed.form();
  const ro = ed.readOnly();
  const answers = sentenceBlanks(form.fb.sentence);
  const { maxFillBlankAnswers, maxAnswerTextChars } = ed.limits;
  const mode = blankPointsMode(form);
  list.replaceChildren(
    ...answers.map((canonical, index) => {
      const alts = form.fb.alts[index] ?? [];
      const altIn = el("input", { dir: "auto", placeholder: S.QE_ALSO_ACCEPT_PH, maxlength: String(maxAnswerTextChars), "aria-label": S.ADD_ALTERNATIVE_PLACEHOLDER, "data-fk": `fb-alt-${index}`, disabled: ro || 1 + alts.length >= maxFillBlankAnswers || undefined });
      altIn.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const v = altIn.value.trim();
        if (!v) return;
        ed.change(`fb-alt-${index}`, (f) => (f.fb.alts[index] = [...(f.fb.alts[index] ?? []), v].slice(0, maxFillBlankAnswers - 1)));
        renderBlankRows(list, ed);
        requestAnimationFrame(() => list.querySelector(`[data-fk="fb-alt-${index}"]`)?.focus());
      });
      let ptsIn = null;
      if (mode === "each") {
        ptsIn = el("input", { class: "bpts", inputmode: "decimal", "aria-label": t(S.QE_BLANK_POINTS, { n: index + 1 }), readonly: ro || undefined });
        ptsIn.value = fmtPts(form.fb.points[index] ?? 0);
        ptsIn.addEventListener("input", () => {
          const v = Math.max(0, Math.min(100000, Number(ptsIn.value.replace(",", ".")) || 0));
          ed.change(`fb-pts-${index}`, (f) => {
            f.fb.equal = false;
            f.fb.points[index] = v;
            f.points = Math.max(0, Math.round(f.fb.points.slice(0, answers.length).reduce((a, b) => a + (b ?? 0), 0)));
          });
          ed.refreshPointsNote();
        });
      } else if (mode === "split") {
        ptsIn = el("small", { text: `${fmtPts(form.fb.points[index] ?? 0)} ${S.QE_STAT_POINTS}` });
      }
      return el("div", { class: "brow" }, [
        el("div", { class: "brow-h" }, [
          el("span", { class: "bn", text: String(index + 1) }),
          el("b", { class: canonical.trim() ? "" : "is-empty", dir: "auto", "data-canonical": String(index), text: canonical.trim() || S.QE_BLANK_EMPTY }),
          el("span", { class: "sp" }),
          ptsIn,
          el("small", { text: t(S.QE_BLANK_ANSWERS, { n: 1 + alts.length, max: maxFillBlankAnswers }) }),
        ]),
        el("div", { class: "balts" }, [
          ...alts.map((alt, ai) =>
            el("span", { class: "alt", dir: "auto" }, [
              alt,
              ro
                ? null
                : el("button", {
                    type: "button",
                    "aria-label": t(S.QE_REMOVE_ALT, { name: alt }),
                    text: "✕",
                    onclick: () => {
                      ed.change(`fb-alt-rm-${index}`, (f) => (f.fb.alts[index] = (f.fb.alts[index] ?? []).filter((_, i) => i !== ai)));
                      renderBlankRows(list, ed);
                    },
                  }),
            ])
          ),
          ro ? null : altIn,
        ]),
      ]);
    })
  );
}

// ── Question settings (below the card) ───────────────────────────────────────

/** [changed] = the question or its type changed → crossfade the contents. */
export function renderQset(node, ed, { changed = false } = {}) {
  smooth(node, () => {
    node.replaceChildren(...qsetNodes(ed));
    applyLimits(node);
  });
  if (changed && !prefersReducedMotion()) {
    node.classList.remove("swap");
    void node.offsetWidth;
    node.classList.add("swap");
    clearTimeout(node._sw);
    node._sw = setTimeout(() => node.classList.remove("swap"), 320);
  }
}

const chipRow = (list, isOn, onPick, { disabled = false } = {}) =>
  el(
    "div",
    { class: "chips" },
    list.map(([value, label]) => el("button", { type: "button", class: isOn(value) ? "on" : "", text: label, "aria-pressed": isOn(value) ? "true" : "false", disabled: disabled || undefined, onclick: () => onPick(value) }))
  );

const h5 = (title, sub) => el("h5", {}, [title, sub ? el("span", { text: sub }) : null]);

function switchRow(label, sub, on, onToggle, { disabled = false } = {}) {
  const sw = el("button", { class: "sw", role: "switch", "aria-checked": String(on), type: "button", "aria-label": label, disabled: disabled || undefined });
  sw.addEventListener("click", () => onToggle(!on));
  return el("div", { class: "tg" }, [el("div", {}, [el("b", { text: label }), el("small", { text: sub })]), sw]);
}

function qsetNodes(ed) {
  const form = ed.form();
  const ro = ed.readOnly();
  const poll = form.type === T.POLL;
  const fbMode = form.type === T.FILL_BLANK ? blankPointsMode(form) : "off";
  const nodes = [el("header", {}, [el("h4", { text: S.QE_Q_SETTINGS }), el("small", { text: t(S.QE_ONLY_FOR, { n: ed.index() + 1 }) })])];
  const grid = el("div", { class: "qgrid" });

  // TIME LIMIT — the app's 15s · 30s · 1 min · Custom · No limit.
  const customTime = form._customTime || (form.timeSec > 0 && !TIME_PRESETS.includes(form.timeSec));
  const timeGrp = el("div", { class: "grp" }, [
    h5(S.QE_TIME),
    el("div", { class: "presets" }, [
      ...TIME_PRESETS.map((sec) => presetBtn(shortTime(sec), !customTime && form.timeSec === sec, () => setTime(ed, sec, false), ro)),
      presetBtn(S.QE_CUSTOM, customTime, () => setTime(ed, form.timeSec > 0 ? form.timeSec : 90, true), ro),
      presetBtn(S.QE_NO_LIMIT, !customTime && !(form.timeSec > 0), () => setTime(ed, 0, false), ro),
    ]),
  ]);
  if (customTime) timeGrp.append(...customTimeRow(ed, form, ro));
  grid.appendChild(timeGrp);

  // POINTS — the app's 5 · 10 · 20 · Custom; Custom opens the stepper (0–1000, step 1).
  if (poll) {
    grid.appendChild(el("div", { class: "grp" }, [h5(S.QE_POINTS), el("p", { class: "note2 flat", text: S.QE_POLL_NO_POINTS })]));
  } else if (fbMode === "each") {
    grid.appendChild(el("div", { class: "grp" }, [h5(S.QE_POINTS), el("p", { class: "note2 flat", "data-fb-total": "", text: t(S.QE_FB_POINTS_NOTE_EACH, { n: form.points }) })]));
  } else {
    grid.appendChild(pointsGrp(ed, form, ro));
  }

  // "Same for every question?"
  const ata = ro ? null : ataText(ed);
  if (ata) {
    grid.appendChild(
      el("div", { class: "ata" }, [
        el("span", {}, [raw(G.sparkle), S.QE_SAME_FOR_ALL]),
        el("button", { type: "button", "data-ata": "", text: ata, onclick: () => ed.applyToAll() }),
      ])
    );
  }

  if (!poll) {
    grid.appendChild(textGrp(ed, "hint", S.QE_HINT, S.QE_HINT_SUB, S.QE_HINT_PH, ed.limits.maxHintChars, ro));
    grid.appendChild(textGrp(ed, "reason", S.QE_REASON, S.QE_REASON_SUB, S.QE_REASON_PH, ed.limits.maxReasonChars, ro));
  }
  nodes.push(grid);

  const sub = typeSection(ed, form, ro);
  if (sub) nodes.push(sub);
  if (!poll) nodes.push(rapidSection(ed, form, ro));
  return nodes;
}

/** The "Use … for all n questions" label, or null when every other question already matches. */
export function ataText(ed) {
  const form = ed.form();
  const poll = form.type === T.POLL;
  const others = ed.forms().filter((f) => f.id !== form.id && f.type !== T.POLL);
  if (!others.length || !others.some((f) => f.timeSec !== form.timeSec || (!poll && f.points !== form.points))) return null;
  const what = poll ? shortTime(form.timeSec) : t(S.QE_APPLY_TIME_PTS, { time: shortTime(form.timeSec), pts: form.points });
  return t(S.QE_APPLY_ALL, { what, n: others.length + (poll ? 0 : 1) });
}

function presetBtn(label, on, onClick, ro) {
  return el("button", { type: "button", class: on ? "on" : "", text: label, "aria-pressed": on ? "true" : "false", disabled: ro || undefined, onclick: onClick });
}

function setTime(ed, sec, custom) {
  ed.change(
    "time",
    (f) => {
      f._customTime = custom;
      f.timeSec = sec;
      if (f.type === T.POLL) f.pollSettings.noTimeLimit = !(sec > 0);
    },
    { pane: { focus: custom ? "#qe-cmin" : null }, rail: true }
  );
}

function customTimeRow(ed, form, ro) {
  const note = el("p", { class: "cnote", text: S.QE_TIME_NOTE });
  const mm = el("input", { id: "qe-cmin", inputmode: "numeric", maxlength: "2", "aria-label": S.QE_MINUTES, readonly: ro || undefined });
  const ss = el("input", { inputmode: "numeric", maxlength: "2", "aria-label": S.QE_SECONDS, readonly: ro || undefined });
  const show = () => {
    const sec = ed.form().timeSec;
    mm.value = String(Math.floor(sec / 60));
    ss.value = String(sec % 60).padStart(2, "0");
  };
  show();
  const upd = () => {
    mm.value = mm.value.replace(/\D/g, "");
    ss.value = ss.value.replace(/\D/g, "");
    let sec = Math.max(0, parseInt(mm.value, 10) || 0) * 60 + Math.max(0, Math.min(59, parseInt(ss.value, 10) || 0));
    if (sec > TIME_MAX) {
      sec = TIME_MAX;
      note.textContent = S.QE_TIME_MAX;
      note.classList.add("warn");
    } else if (sec < TIME_MIN) {
      note.textContent = S.QE_TIME_MIN;
      note.classList.add("warn");
    } else {
      note.textContent = S.QE_TIME_NOTE;
      note.classList.remove("warn");
    }
    ed.change("time-custom", (f) => {
      f._customTime = true;
      f.timeSec = Math.max(TIME_MIN, sec);
      if (f.type === T.POLL) f.pollSettings.noTimeLimit = false;
    }, { rail: true });
  };
  [mm, ss].forEach((x) => {
    x.addEventListener("input", upd);
    x.addEventListener("blur", show);
  });
  return [
    el("div", { class: "custom" }, [el("label", { text: S.QE_YOUR_TIME }), mm, el("span", { text: S.QE_MIN }), ss, el("span", { text: S.QE_SEC })]),
    note,
  ];
}

function pointsGrp(ed, form, ro) {
  const fb = form.type === T.FILL_BLANK;
  const floor = fb ? 1 : 0; // a fill-blank's total is divided across blanks (onPointsChanged)
  const custom = form._customPts || !POINT_PRESETS.includes(form.points);
  const grp = el("div", { class: "grp" }, [
    h5(S.QE_POINTS, t(fb ? S.QE_POINTS_SUB_FB : S.QE_POINTS_SUB, { max: MAX_POINTS })),
    el("div", { class: "presets" }, [
      ...POINT_PRESETS.map((n) => presetBtn(String(n), !custom && form.points === n, () => setPoints(ed, n, false), ro)),
      presetBtn(S.QE_CUSTOM, custom, () => setPoints(ed, form.points, true, "#qe-pts"), ro),
    ]),
  ]);
  if (!custom) return grp;
  const minus = el("button", { type: "button", "aria-label": S.QE_FEWER, text: "−", disabled: ro || form.points <= floor || undefined });
  const plus = el("button", { type: "button", "aria-label": S.QE_MORE_PTS, text: "+", disabled: ro || form.points >= MAX_POINTS || undefined });
  const input = el("input", { id: "qe-pts", inputmode: "numeric", maxlength: "4", "aria-label": t(S.QE_POINTS_LABEL, { max: MAX_POINTS }), readonly: ro || undefined });
  input.value = String(form.points);
  const stepper = el("div", { class: "stepper" }, [minus, input, plus]);
  const note = el("p", { class: "cnote warn", text: t(S.QE_POINTS_MAX, { max: MAX_POINTS }), hidden: form.points < MAX_POINTS || undefined });
  const sync = (v) => {
    minus.disabled = ro || v <= floor;
    plus.disabled = ro || v >= MAX_POINTS;
  };
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "");
    let v = parseInt(input.value, 10) || 0;
    if (v > MAX_POINTS) {
      v = MAX_POINTS;
      input.value = String(MAX_POINTS);
      reveal(note, true);
      stepper.classList.remove("shake");
      void stepper.offsetWidth;
      stepper.classList.add("shake");
      setTimeout(() => stepper.classList.remove("shake"), 400);
    } else reveal(note, v >= MAX_POINTS);
    commitPoints(ed, Math.max(floor, v));
    sync(v);
  });
  input.addEventListener("blur", () => (input.value = String(ed.form().points)));
  stepper.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const v = Math.max(floor, Math.min(MAX_POINTS, ed.form().points + (b === plus ? 1 : -1)));
    input.value = String(v);
    reveal(note, v >= MAX_POINTS);
    commitPoints(ed, v);
    sync(v);
  });
  grp.append(stepper, note);
  return grp;
}

function setPoints(ed, n, custom, focus = null) {
  ed.change("points-preset", (f) => {
    f._customPts = custom;
    applyPoints(f, n);
  }, { pane: { focus }, rail: true });
}

function commitPoints(ed, n) {
  ed.change("points", (f) => {
    f._customPts = true;
    applyPoints(f, n);
  }, { rail: true });
  ed.refreshAta();
}

/** onPointsChanged: in split mode the total is re-divided across the blanks. */
function applyPoints(f, n) {
  f.points = n;
  if (f.type === T.FILL_BLANK && blankPointsMode(f) === "split") syncBlankPoints(f);
}

function textGrp(ed, key, title, sub, ph, max, ro) {
  const area = el("textarea", { class: "ptxt", dir: "auto", placeholder: ph, "data-max": String(max), "data-fk": `q-${key}`, readonly: ro || undefined });
  area.value = ed.form()[key] ?? "";
  area.addEventListener("input", () => ed.change(`q-${key}`, (f) => (f[key] = area.value)));
  return el("div", { class: "grp" }, [h5(title, sub), area]);
}

function typeSection(ed, form, ro) {
  const head = (title) => el("h4", {}, [el("span", { class: "ti" }, [raw(TYPE_ICON[form.type])]), title]);
  if (form.type === T.MULTIPLE_CORRECT) {
    const correct = form.items.filter((i) => i.correct && i.text.trim()).length;
    // The app shows the rule only once two or more answers are marked right.
    if (correct < 2 || ed.quiz().manualMarkingDefault) return null;
    const any = form.acceptAnyCorrect === true;
    return el("div", { class: "sub" }, [
      head(S.QE_MULTI_TITLE),
      el("div", { class: "grp" }, [
        h5(S.QE_MUST_PICK),
        chipRow(
          [
            [false, correct === 2 ? S.QE_PICK_BOTH : t(S.QE_PICK_ALL_N, { n: correct })],
            [true, correct === 2 ? S.QE_PICK_EITHER : S.QE_PICK_ANY],
          ],
          (v) => v === any,
          (v) => ed.change("accept-any", (f) => (f.acceptAnyCorrect = v), { pane: true }),
          { disabled: ro }
        ),
        el("p", { class: "note2", text: any ? S.QE_PICK_ANY_NOTE : S.QE_PICK_ALL_NOTE }),
        el("p", { class: "note2", text: S.QE_PARTIAL_NOTE }),
      ]),
    ]);
  }
  if (form.type === T.WRITTEN) {
    if (ed.quiz().manualMarkingDefault) return null;
    return writtenChecking(ed, form, ro, head);
  }
  if (form.type === T.FILL_BLANK) {
    const mode = blankPointsMode(form);
    const n = sentenceBlanks(form.fb.sentence).length;
    const parts = [head(S.QE_FB_TITLE)];
    if (n > 0) {
      parts.push(
        el("div", { class: "grp" }, [
          h5(S.QE_FB_POINTS),
          chipRow(
            [
              ["off", S.QE_FB_POINTS_OFF],
              ["split", S.QE_FB_POINTS_SPLIT],
              ["each", S.QE_FB_POINTS_EACH],
            ],
            (v) => v === mode,
            (v) => ed.change("fb-points-mode", (f) => setBlankMode(f, v), { pane: true, card: true }),
            { disabled: ro }
          ),
          el("p", { class: "note2", "data-fb-total": "", text: mode === "off" ? S.QE_FB_POINTS_NOTE_OFF : mode === "split" ? S.QE_FB_POINTS_NOTE_SPLIT : t(S.QE_FB_POINTS_NOTE_EACH, { n: form.points }) }),
        ])
      );
    }
    parts.push(
      el("div", { class: "grp" }, [
        h5(S.QE_FB_CHECKING),
        chipRow(
          [
            [FILL_BLANK_CHECKING.FLEXIBLE, S.QE_FB_FLEXIBLE],
            [FILL_BLANK_CHECKING.STRICT, S.QE_FB_STRICT],
          ],
          (v) => v === form.fb.checking,
          (v) => ed.change("fb-checking", (f) => (f.fb.checking = v), { pane: true }),
          { disabled: ro }
        ),
        el("p", { class: "note2", text: form.fb.checking === FILL_BLANK_CHECKING.STRICT ? S.QE_FB_STRICT_NOTE : S.QE_FB_FLEXIBLE_NOTE }),
      ]),
      el("p", { class: "note2 flat", text: t(S.QE_FB_LIMITS, { blanks: ed.limits.maxFillBlanks, answers: ed.limits.maxFillBlankAnswers }) })
    );
    return el("div", { class: "sub" }, parts);
  }
  if (form.type === T.POLL) {
    const p = form.pollSettings;
    const set = (key) => (on) => ed.change(`poll-${key}`, (f) => (f.pollSettings[key] = on), { pane: true });
    // The app's order: the three always-visible rows, then its "More settings" four.
    return el("div", { class: "sub" }, [
      head(S.QE_POLL_TITLE),
      el("div", { class: "tgl" }, [
        switchRow(S.QE_POLL_MULTI, S.QE_POLL_MULTI_SUB, p.allowMultiple === true, set("allowMultiple"), { disabled: ro }),
        switchRow(S.QE_POLL_ANON, S.QE_POLL_ANON_SUB, p.anonymous === true, set("anonymous"), { disabled: ro }),
        switchRow(S.QE_POLL_REASON, S.QE_POLL_REASON_SUB, p.askReason === true, set("askReason"), { disabled: ro }),
        switchRow(S.QE_POLL_CHANGE, S.QE_POLL_CHANGE_SUB, p.allowVoteChange === true, set("allowVoteChange"), { disabled: ro }),
        switchRow(S.QE_POLL_OTHER, S.QE_POLL_OTHER_SUB, p.allowOther === true, set("allowOther"), { disabled: ro }),
        switchRow(S.QE_POLL_SHUFFLE, S.QE_POLL_SHUFFLE_SUB, p.shuffleOptions === true, set("shuffleOptions"), { disabled: ro }),
        switchRow(S.QE_POLL_RESULTS, S.QE_POLL_RESULTS_SUB, p.showResultsToVoters === true, set("showResultsToVoters"), { disabled: ro }),
      ]),
      p.anonymous ? el("p", { class: "note2 flat", text: S.QE_POLL_ANON_NOTE }) : null,
    ]);
  }
  return null;
}

/** onFillBlankCustomPointsToggled / onFillBlankEqualSplitToggled. */
function setBlankMode(f, mode) {
  const n = sentenceBlanks(f.fb.sentence).length;
  const share = Math.max(0, f.points) / Math.max(1, n);
  if (mode === "off") {
    if (blankPointsMode(f) !== "off") f.points = Math.max(1, Math.round(f.fb.points.slice(0, n).reduce((a, b) => a + (b ?? 0), 0)));
    f.fb.points = f.fb.points.map(() => null);
    delete f.fb.equal;
  } else if (mode === "split") {
    f.fb.points = Array.from({ length: n }, () => share);
    f.fb.equal = true;
  } else {
    if (blankPointsMode(f) === "off") f.fb.points = Array.from({ length: n }, () => share);
    f.fb.equal = false;
  }
}

function rapidSection(ed, form, ro) {
  const manual = ed.quiz().manualMarkingDefault;
  const quizOn = ed.quiz().timeWeightageEnabled === true;
  const value = form.rapidBonus ?? null;
  return el("div", { class: "sub" }, [
    el("div", { class: "grp" }, [
      h5(S.QE_RAPID, S.QE_RAPID_SUB),
      chipRow(
        [
          [null, quizOn ? S.QE_RAPID_DEFAULT_ON : S.QE_RAPID_DEFAULT_OFF],
          [true, S.QE_RAPID_ON],
          [false, S.QE_RAPID_OFF],
        ],
        (v) => v === value,
        (v) => ed.change("rapid", (f) => (f.rapidBonus = v), { pane: true }),
        { disabled: ro || manual }
      ),
      manual ? el("p", { class: "note2", text: S.QE_RAPID_MANUAL }) : null,
    ]),
  ]);
}

// Written answer checking — the app's AnswerCheckingPanel rules (onMatchModeToggled,
// onMarksPatternChanged): Exact is exclusive; Case sensitive combines with Keywords and
// Number; "All or nothing" drops Smart match, the two partial patterns add it.
function writtenChecking(ed, form, ro, head) {
  const rule = form.answerRule;
  const modes = new Set(rule.matchModeList ?? []);
  const exact = modes.has(MM.STRICT_EXACT);
  const setRule = (key, fn, opts = { pane: true }) => ed.change(key, (f) => fn(f.answerRule), opts);
  const toggleMode = (mode) =>
    setRule(`mode-${mode}`, (r) => {
      const cur = new Set(r.matchModeList ?? []);
      if (mode === MM.STRICT_EXACT) r.matchModeList = cur.has(mode) ? [] : [MM.STRICT_EXACT];
      else {
        if (cur.has(mode)) cur.delete(mode);
        else {
          cur.delete(MM.STRICT_EXACT);
          cur.add(mode);
        }
        r.matchModeList = [...cur];
      }
    }, { pane: true, card: true });

  const parts = [
    head(S.QE_CHECKING),
    el("div", { class: "grp" }, [
      h5(S.QE_HOW_MATCH, S.QE_HOW_MATCH_SUB),
      chipRow(
        [
          [MM.STRICT_EXACT, S.QE_MODE_EXACT],
          [MM.CASE_SENSITIVE_EXACT, S.QE_MODE_CASE],
          [MM.KEYWORD_MATCH, S.QE_MODE_KEYWORDS],
          [MM.NUMERIC_EQUIVALENT, S.QE_MODE_NUMBER],
        ],
        (v) => modes.has(v),
        toggleMode,
        { disabled: ro }
      ),
    ]),
  ];

  if (modes.has(MM.KEYWORD_MATCH)) {
    const kw = el("input", { class: "qfield", dir: "auto", placeholder: S.QE_KEYWORD_PH, "aria-label": S.QE_KEYWORD_PH, "data-fk": "keyword-input", readonly: ro || undefined });
    const add = () => {
      const words = kw.value.split(",").map((w) => w.trim()).filter(Boolean);
      if (!words.length) return;
      setRule("keywords", (r) => (r.keywords = [...new Set([...(r.keywords ?? []), ...words])]), { pane: { focus: '[data-fk="keyword-input"]' } });
    };
    kw.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        add();
      }
    });
    parts.push(
      el("div", { class: "grp" }, [
        h5(S.QE_KEYWORDS, S.QE_KEYWORDS_SUB),
        el("div", { class: "kwin" }, [
          ...(rule.keywords ?? []).map((w) =>
            el("span", { class: "alt", dir: "auto" }, [
              w,
              ro ? null : el("button", { type: "button", "aria-label": t(S.QE_REMOVE_ALT, { name: w }), text: "✕", onclick: () => setRule("keywords", (r) => (r.keywords = (r.keywords ?? []).filter((x) => x !== w))) }),
            ])
          ),
          kw,
        ]),
      ]),
      el("div", { class: "grp" }, [
        h5(S.QE_KEYWORDS_NEEDED),
        chipRow(
          [
            ["ALL", S.QE_COVER_ALL],
            ["MOST", S.QE_COVER_MOST],
            ["HALF", S.QE_COVER_HALF],
          ],
          (v) => v === (rule.keywordCoverage ?? "ALL"),
          (v) => setRule("coverage", (r) => (r.keywordCoverage = v)),
          { disabled: ro }
        ),
      ])
    );
  }

  // Equal words (aliases).
  const expected = form.writtenAnswer.toLowerCase();
  const pairs = rule.aliasPairs ?? [];
  const rows = (pairs.length ? pairs : [{ answerWord: "", acceptedWord: "" }]).map((pair, i) => {
    const a = el("input", { class: "qfield", dir: "auto", placeholder: S.QE_ALIAS_ANSWER, "aria-label": S.QE_ALIAS_ANSWER, "data-max": String(ed.limits.maxAnswerTextChars), "data-fk": `alias-a-${i}`, readonly: ro || undefined });
    const b = el("input", { class: "qfield", dir: "auto", placeholder: S.QE_ALIAS_ACCEPT, "aria-label": S.QE_ALIAS_ACCEPT, "data-max": String(ed.limits.maxAnswerTextChars), "data-fk": `alias-b-${i}`, readonly: ro || undefined });
    a.value = pair.answerWord;
    b.value = pair.acceptedWord;
    const write = () =>
      ed.change(`alias-${i}`, (f) => {
        const list = f.answerRule.aliasPairs ?? (f.answerRule.aliasPairs = []);
        while (list.length <= i) list.push({ answerWord: "", acceptedWord: "" });
        list[i] = { answerWord: a.value, acceptedWord: b.value };
      });
    a.addEventListener("input", write);
    b.addEventListener("input", write);
    const off = pair.answerWord.trim() && !expected.includes(pair.answerWord.trim().toLowerCase());
    return [
      el("div", { class: "alias" }, [
        el("span", { class: "aw" }, [a]),
        el("span", { class: "eq", text: "=" }),
        el("span", { class: "aw" }, [b]),
        ro || !pairs.length ? null : el("button", { class: "iconbtn x", type: "button", "aria-label": S.QE_ALIAS_REMOVE, text: "✕", onclick: () => setRule("alias-remove", (r) => r.aliasPairs.splice(i, 1)) }),
      ]),
      off ? el("p", { class: "note2 flat", text: S.QE_ALIAS_NOT_IN }) : null,
    ];
  });
  parts.push(
    el("div", { class: "grp" }, [
      h5(S.QE_EQUAL_WORDS, S.QE_EQUAL_WORDS_SUB),
      ...rows.flat(),
      ro ? null : el("button", { class: "addopt", type: "button", "data-add-alias": "", text: S.QE_ADD_ANOTHER, onclick: () => setRule("alias-add", (r) => (r.aliasPairs = [...(r.aliasPairs ?? []), ...(r.aliasPairs?.length ? [] : [{ answerWord: "", acceptedWord: "" }]), { answerWord: "", acceptedWord: "" }])) }),
    ])
  );

  // How are marks given — hidden while Exact is on (the app hides it).
  if (!exact) {
    const pattern = rule.marksPattern ?? MP.ALL_OR_NOTHING;
    parts.push(
      el("div", { class: "grp" }, [
        h5(S.QE_MARKS, S.QE_MARKS_SUB),
        chipRow(
          [
            [MP.ALL_OR_NOTHING, S.QE_MARKS_ALL],
            [MP.HALF_FOR_PARTIAL, S.QE_MARKS_HALF],
            [MP.WEIGHTED_BY_SIMILARITY, S.QE_MARKS_SIM],
          ],
          (v) => v === pattern,
          (v) =>
            setRule("marks", (r) => {
              const cur = new Set(r.matchModeList ?? []);
              if (v === MP.ALL_OR_NOTHING) cur.delete(MM.FUZZY_TYPO_TOLERANT);
              else {
                cur.delete(MM.STRICT_EXACT);
                cur.add(MM.FUZZY_TYPO_TOLERANT);
              }
              r.marksPattern = v;
              r.matchModeList = [...cur];
            }, { pane: true, card: true }),
          { disabled: ro }
        ),
      ])
    );
    if (pattern === MP.WEIGHTED_BY_SIMILARITY) {
      const value = Math.round((rule.minSimilarity ?? 0.85) * 100);
      const out = el("b", { text: `${value}%` });
      const range = el("input", { type: "range", min: "70", max: "100", step: "5", "aria-label": S.QE_STRICTNESS, disabled: ro || undefined });
      range.value = String(value);
      range.addEventListener("input", () => {
        out.textContent = `${range.value}%`;
        setRule("strictness", (r) => (r.minSimilarity = Number(range.value) / 100), {});
        ed.refreshTry();
      });
      parts.push(
        el("div", { class: "grp" }, [
          h5(S.QE_STRICTNESS, S.QE_STRICTNESS_SUB),
          el("div", { class: "qrange" }, [el("span", { text: S.QE_FORGIVING }), range, el("span", { text: S.QE_STRICT }), out]),
          el("p", { class: "note2", text: S.QE_SHORT_EXACT }),
        ])
      );
    }
  }

  // Try it out — the take page's real evaluator (deploy/take/evaluator.js).
  const tryIn = el("input", { class: "qfield", id: "qe-try", dir: "auto", placeholder: S.QE_TRY_PH, "aria-label": S.QE_TRY_PH, "data-max": "500" });
  const res = el("div", { class: "res", id: "qe-try-res", text: S.QE_TRY_IDLE });
  tryIn.addEventListener("input", () => ed.refreshTry());
  parts.push(el("div", { class: "tryit" }, [el("h5", { text: S.QE_TRY }), tryIn, res]));
  return el("div", { class: "sub" }, parts);
}

let evaluatorLoad = null;
function loadEvaluator() {
  if (window.Evaluator) return Promise.resolve(window.Evaluator);
  if (evaluatorLoad) return evaluatorLoad;
  const add = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  // The take page lives at the site root (/take/) both locally (server.mjs) and live.
  evaluatorLoad = add("/take/strings.js")
    .then(() => add("/take/evaluator.js"))
    .then(() => window.Evaluator)
    .catch(() => null);
  return evaluatorLoad;
}

/** Re-runs "Try it out" for the current question. */
export async function runTry(ed) {
  const input = document.getElementById("qe-try");
  const res = document.getElementById("qe-try-res");
  if (!input || !res) return;
  const answer = input.value;
  const form = ed.form();
  if (!answer.trim()) {
    res.className = "res";
    res.textContent = S.QE_TRY_IDLE;
    return;
  }
  if (!form.writtenAnswer.trim()) {
    res.className = "res no";
    res.textContent = S.QE_TRY_NEED;
    return;
  }
  const ev = await loadEvaluator();
  if (input.value !== answer) return; // typed on while loading
  if (!ev) {
    res.className = "res no";
    res.textContent = S.QE_TRY_UNAVAILABLE;
    return;
  }
  const out = ev.evaluate(answer, form.writtenAnswer, form.answerRule);
  const pct = Math.round((out.similarityScore ?? 0) * 100);
  const ok = out.status === "EXACT_MATCH" || out.status === "ACCEPTED_WITH_TYPO";
  const partial = out.status === "PARTIAL_MATCH" && (form.answerRule.marksPattern ?? MP.ALL_OR_NOTHING) !== MP.ALL_OR_NOTHING;
  res.className = `res ${ok ? "ok" : "no"}`;
  res.textContent = t(ok ? S.QE_TRY_OK : partial ? S.QE_TRY_PARTIAL : S.QE_TRY_NO, { n: pct });
}
