// Download reports — one dialog for the whole class, picked students or one student, as PDF,
// Excel or CSV, with a live A4 preview of page 1. State is the reference's RS object.
// While it is open every grading shortcut stands down (suite.js checks for .rpm).

import { S, t } from "../core/strings.js";
import { el } from "../ui/components.js";
import { G, colOf, fmt, ini, plural, reduce } from "./gx-util.js";
import { buildPages, sheetPreview } from "./report-pages.js";
import { downloadReport, fileName } from "./export.js";
import { draftCount, qScore, subs } from "./store.js";
import { toast } from "./toast.js";

const RS = { qm: null, scope: "class", kind: "both", fmt: "pdf", sel: new Set(), one: null, search: "", ans: true, notes: true, chart: true };
let ui = null; // the open dialog's nodes
let hooks = {};

const targets = () => {
  const st = subs(RS.qm);
  return RS.scope === "class" ? st : RS.scope === "some" ? st.filter((s) => RS.sel.has(s.id)) : st.filter((s) => s.id === RS.one);
};

/**
 * openReport(qm, { scope: "class"|"some"|"one", sid }, { teacher, isOpenQuiz(qm), finishMarking() })
 */
export function openReport(qm, o = {}, h = {}) {
  hooks = h;
  RS.qm = qm;
  RS.scope = o.scope || "class";
  RS.kind = RS.scope === "one" ? "card" : "both";
  RS.search = "";
  const st = subs(qm);
  RS.sel = new Set(st.map((s) => s.id));
  RS.one = o.sid || st[0]?.id || null;
  document.querySelector(".gx .rpm")?.remove();

  const x = el("button", { class: "rpx", type: "button", "aria-label": S.CLOSE, id: "rpX" }, [G.x()]);
  const opts = el("div", { class: "rpopts", id: "rpOpts" });
  const pgLbl = el("span", { id: "pgLbl" });
  const pgIn = el("div", { class: "inner", id: "pgIn" });
  const pg = el("div", { class: "pg", id: "pg" }, [pgIn]);
  const pgStack = el("div", { class: "pgstack", id: "pgStack" }, [pg]);
  const pgCount = el("div", { class: "pgcount", id: "pgCount" });
  const sum = el("span", { class: "sum", id: "rpSum", role: "status" });
  const goT = el("span", { id: "rpGoT" });
  const go = el("button", { class: "bt pri gobtn", type: "button", id: "rpGo" }, [el("span", { class: "fill" }), goT]);
  const box = el("div", { class: "rpbox" }, [
    el("div", { class: "rph" }, [el("span", { class: "ini", vars: { c: qm.color }, text: qm.ini }), el("div", { style: "min-width:0" }, [el("h2", { text: S.GX_DOWNLOAD_REPORTS }), el("small", { text: qm.title })]), x]),
    el("div", { class: "rpmain" }, [opts, el("div", { class: "rpprev" }, [el("h5", {}, [el("span", { text: S.GX_PREVIEW }), pgLbl]), el("div", { class: "pgwrap" }, [pgStack]), pgCount])]),
    el("div", { class: "rpf" }, [sum, el("span", { class: "sp" }), el("button", { class: "bt", type: "button", id: "rpCancel", text: S.CANCEL, onclick: closeReport }), go]),
  ]);
  const host = el("div", { class: "pdfhost", "aria-hidden": "true" });
  const m = el("div", { class: "rpm", role: "dialog", "aria-modal": "true", "aria-label": S.GX_DOWNLOAD_REPORTS }, [box, host]);
  document.querySelector(".gx").appendChild(m);
  ui = { m, opts, pg, pgIn, pgStack, pgLbl, pgCount, sum, go, goT, host };
  m.addEventListener("click", (e) => e.target === m && closeReport());
  x.addEventListener("click", closeReport);
  go.addEventListener("click", doDownload);
  render(true);
  setTimeout(() => x.focus(), 40);
}

export function closeReport() {
  const m = document.querySelector(".gx .rpm");
  if (!m || m.dataset.closing) return;
  m.dataset.closing = "1";
  ui = null;
  if (reduce()) {
    m.remove();
    return;
  }
  m.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180 }).onfinish = () => m.remove();
}

document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && document.querySelector(".gx .rpm")) {
      e.stopImmediatePropagation();
      closeReport();
    }
  },
  true
);

const ICON = { class: G.rClass, some: G.rSome, one: G.rOne, sum: G.rSum, card: G.rCard, cmp: G.rCmp, both: G.rBoth };

function opc(attr, key, on, label, desc) {
  return el("button", { type: "button", class: `opc ${on ? "on" : ""}`, [`data-${attr}`]: key, role: "radio", "aria-checked": String(on) }, [
    el("span", { class: "oi" }, [ICON[key]()]),
    el("span", {}, [el("b", { text: label }), el("small", { text: desc })]),
  ]);
}

function render(first = false) {
  if (!ui) return;
  const qm = RS.qm;
  const st = subs(qm);
  const T = targets();
  const pendTot = T.reduce((n, s) => n + qScore(qm, s).p, 0);
  if (RS.scope === "one") RS.kind = "card";
  const kinds =
    RS.scope === "one"
      ? [["card", S.GX_K_CARD, S.GX_K_CARD_D]]
      : [
          ["sum", S.GX_K_SUM, S.GX_K_SUM_D],
          ["cmp", S.GX_K_CMP, S.GX_K_CMP_D],
          ["card", S.GX_K_CARDS, S.GX_K_CARDS_D],
          ["both", S.GX_K_BOTH, S.GX_K_BOTH_D],
        ];
  const list = st.filter((s) => !RS.search || s.name.toLowerCase().includes(RS.search));
  const keepScroll = ui.opts.querySelector(".plist")?.scrollTop ?? 0;

  const nodes = [
    el("div", { class: "rpg" }, [
      el("h5", { text: S.GX_WHO_FOR }),
      el("div", { class: "seg3", role: "radiogroup", "aria-label": S.GX_WHO }, [
        opc("scope", "class", RS.scope === "class", S.GX_SC_CLASS, plural(st.length, S.GX_SC_CLASS_D_ONE, S.GX_SC_CLASS_D_MANY)),
        opc("scope", "some", RS.scope === "some", S.GX_SC_SOME, RS.scope === "some" ? t(S.GX_SC_SOME_D, { n: RS.sel.size }) : S.GX_SC_SOME_D0),
        opc("scope", "one", RS.scope === "one", S.GX_SC_ONE, S.GX_SC_ONE_D),
      ]),
    ]),
  ];
  if (RS.scope !== "class") {
    const search = el("input", { id: "rpSearch", placeholder: S.GX_SEARCH_STUDENTS, "aria-label": S.GX_SEARCH_STUDENTS, value: RS.search, autocomplete: "off" });
    const all = RS.scope === "some" ? el("button", { type: "button", id: "rpAll", text: RS.sel.size === st.length ? S.GX_CLEAR_ALL : S.GX_SELECT_ALL }) : null;
    const plist = el(
      "div",
      { class: "plist", id: "rpList", role: RS.scope === "some" ? "group" : "radiogroup", "aria-label": RS.scope === "some" ? S.GX_STUDENTS_H : S.GX_STUDENT_H },
      list.length
        ? list.map((s) => {
            const sc = qScore(qm, s);
            const on = RS.scope === "some" ? RS.sel.has(s.id) : RS.one === s.id;
            return el("button", { type: "button", class: `prow ${on ? "on" : ""}`, "data-sid": s.id, role: RS.scope === "some" ? "checkbox" : "radio", "aria-checked": String(on) }, [
              el("span", { class: `box ${RS.scope === "one" ? "rd" : ""}` }),
              el("span", { class: "ini", vars: { c: colOf(s.name) }, text: ini(s.name) }),
              el("span", { class: "nm", text: s.name }),
              el("span", { class: `sc ${sc.p ? "p" : ""}`, text: sc.p ? t(S.GX_N_UNMARKED, { n: sc.p }) : t(S.GX_SCORE, { g: fmt(sc.g), m: sc.m }) }),
            ]);
          })
        : [el("div", { class: "gempty", style: "padding:20px", text: S.GX_NO_MATCH })]
    );
    nodes.push(
      el("div", { class: "rpg" }, [
        el("h5", {}, [RS.scope === "some" ? S.GX_STUDENTS_H : S.GX_STUDENT_H, el("span", { text: RS.scope === "some" ? t(S.GX_X_OF_N, { x: RS.sel.size, n: st.length }) : "" })]),
        el("div", { class: "pickw" }, [el("div", { class: "pickt" }, [G.search(15, "color:var(--muted)"), search, all]), plist]),
      ])
    );
    search.addEventListener("input", () => {
      RS.search = search.value.toLowerCase().trim();
      const pos = search.selectionStart;
      render();
      const next = ui.opts.querySelector("#rpSearch");
      next.focus();
      next.setSelectionRange(pos, pos);
    });
    all?.addEventListener("click", () => {
      if (RS.sel.size === st.length) RS.sel.clear();
      else st.forEach((s) => RS.sel.add(s.id));
      render();
    });
    plist.addEventListener("click", (e) => {
      const r = e.target.closest(".prow");
      if (!r) return;
      const id = r.dataset.sid;
      if (RS.scope === "some") RS.sel.has(id) ? RS.sel.delete(id) : RS.sel.add(id);
      else RS.one = id;
      render();
    });
  }
  nodes.push(
    el("div", { class: "rpg" }, [
      el("h5", { text: S.GX_WHAT }),
      el(
        "div",
        { class: `seg3 ${kinds.length === 4 ? "two" : ""}`, role: "radiogroup", "aria-label": S.GX_REPORT_TYPE, style: kinds.length === 1 ? "grid-template-columns:minmax(0,1fr)" : null },
        kinds.map(([k, l, d]) => opc("kind", k, RS.kind === k, l, d))
      ),
    ]),
    el("div", { class: "rpg" }, [
      el("h5", { text: S.GX_FORMAT }),
      el("div", { class: "fmt", role: "radiogroup", "aria-label": S.GX_FORMAT }, [
        el("button", { type: "button", "data-fmt": "pdf", class: RS.fmt === "pdf" ? "on" : "", role: "radio", "aria-checked": String(RS.fmt === "pdf") }, [el("i", { style: "background:#e5484d", text: "PDF" }), S.GX_FMT_PDF]),
        el("button", { type: "button", "data-fmt": "xlsx", class: RS.fmt === "xlsx" ? "on" : "", role: "radio", "aria-checked": String(RS.fmt === "xlsx") }, [el("i", { style: "background:#15803d", text: "XLS" }), S.GX_FMT_XLSX]),
        el("button", { type: "button", "data-fmt": "csv", class: RS.fmt === "csv" ? "on" : "", role: "radio", "aria-checked": String(RS.fmt === "csv") }, [el("i", { style: "background:#64748b", text: "CSV" }), S.GX_FMT_CSV]),
      ]),
    ]),
    el("div", { class: "rpg" }, [
      el("h5", { text: S.GX_OPTIONS }),
      el("div", { class: "tgl2" }, [
        toggle("ans", S.GX_OPT_ANS, S.GX_OPT_ANS_D),
        toggle("notes", S.GX_OPT_NOTES, S.GX_OPT_NOTES_D),
        toggle("chart", S.GX_OPT_CHART, S.GX_OPT_CHART_D, RS.kind === "card" || RS.fmt !== "pdf"),
      ]),
    ])
  );
  if (pendTot) {
    const canFinish = hooks.isOpenQuiz?.(qm);
    nodes.push(
      el("div", { class: "rpwarn", role: "note" }, [
        G.warn(),
        el("span", { text: plural(pendTot, S.GX_RP_WARN_ONE, S.GX_RP_WARN_MANY) }),
        canFinish
          ? el("button", {
              type: "button",
              id: "rpFinish",
              text: S.GX_FINISH_MARKING,
              onclick: () => {
                closeReport();
                hooks.finishMarking?.();
              },
            })
          : null,
      ])
    );
  }
  // Marks not submitted yet are already in the report (the teacher's current marks).
  const dn = draftCount(qm);
  if (dn) nodes.push(el("div", { class: "rpinfo", role: "note" }, [G.send(14), el("span", { text: plural(dn, S.GX_RP_DRAFTS_ONE, S.GX_RP_DRAFTS_MANY) })]));
  ui.opts.replaceChildren(...nodes);
  const pl = ui.opts.querySelector(".plist");
  if (pl) pl.scrollTop = keepScroll;
  if (first && RS.scope === "one") ui.opts.querySelector(".prow.on")?.scrollIntoView({ block: "center" });

  for (const b of ui.opts.querySelectorAll("[data-scope]")) {
    b.addEventListener("click", () => {
      RS.scope = b.dataset.scope;
      if (RS.scope !== "one" && RS.kind === "card" && b.dataset.scope === "class") RS.kind = "both";
      if (RS.scope === "some" && !RS.sel.size) st.forEach((s) => RS.sel.add(s.id));
      render();
    });
  }
  for (const b of ui.opts.querySelectorAll("[data-kind]")) b.addEventListener("click", () => ((RS.kind = b.dataset.kind), render()));
  for (const b of ui.opts.querySelectorAll("[data-fmt]")) b.addEventListener("click", () => ((RS.fmt = b.dataset.fmt), render()));
  for (const b of ui.opts.querySelectorAll(".sw[data-o]")) {
    b.addEventListener("click", () => {
      if (b.disabled) return;
      RS[b.dataset.o] = !RS[b.dataset.o];
      b.setAttribute("aria-checked", String(RS[b.dataset.o]));
      renderPreview(true);
      updSum();
    });
  }

  renderPreview(!first);
  updSum();
}

/** The footer: "N students · N pages", the Download button's label and file name. */
function updSum() {
  const qm = RS.qm;
  const T = targets();
  const n = T.length;
  const pages = RS.fmt !== "pdf" ? 0 : ui.pageN;
  const need2 = RS.kind === "cmp" && n < 2;
  if (need2) ui.sum.replaceChildren(S.GX_PICK_2);
  else if (!n) ui.sum.replaceChildren(S.GX_PICK_1);
  else {
    ui.sum.replaceChildren(el("b", { text: String(n) }), n === 1 ? S.GX_STUDENT_W : S.GX_STUDENTS_W);
    if (pages) ui.sum.append(S.GX_SEP, el("b", { text: String(pages) }), pages === 1 ? S.GX_PAGE_W : S.GX_PAGES_W);
  }
  if (!ui.go.classList.contains("busy") && !ui.go.classList.contains("done")) ui.goT.textContent = n && !need2 ? t(S.GX_DOWNLOAD_FMT, { fmt: RS.fmt.toUpperCase() }) : S.GX_DOWNLOAD;
  ui.go.disabled = !n || need2;
  ui.go.title = fileName(qm, RS, T);
}

function toggle(key, label, desc, disabled = false) {
  return el("div", { class: "tg2" }, [
    el("div", {}, [el("b", { text: label }), el("small", { text: desc })]),
    el("button", { class: "sw", type: "button", role: "switch", "aria-checked": String(RS[key]), "data-o": key, "aria-label": label, disabled }),
  ]);
}

const meta = () => ({ teacher: hooks.teacher ?? "" });

function renderPreview(animate) {
  if (!ui) return;
  const qm = RS.qm;
  const T = targets();
  const { pg, pgIn, pgStack, pgLbl, pgCount } = ui;
  pg.style.setProperty("--qcol", qm.color);
  pgIn.style.setProperty("--qcol", qm.color);
  const blank = (lines) => el("div", { style: "display:grid;place-items:center;height:700px;color:#a3a6bd;font-size:16px;text-align:center" }, lines);
  // A report page has its own frame (band, body, footer); the sheet preview and blanks don't.
  const pdfPage = (nodes) => {
    pgIn.classList.add("rpage");
    pgIn.replaceChildren(...nodes);
  };
  pgIn.classList.remove("rpage");
  ui.pageN = 0;
  if (RS.fmt !== "pdf") {
    pgIn.replaceChildren(...sheetPreview(qm, T, RS, fileName(qm, RS, T)));
    pgStack.classList.add("single");
    pgLbl.textContent = RS.fmt === "xlsx" ? S.GX_PV_XLSX : S.GX_PV_CSV;
    pgCount.textContent = S.GX_PV_SHEET_CAP;
  } else if (!T.length || (RS.kind === "cmp" && T.length < 2)) {
    pgIn.replaceChildren(blank(T.length ? [S.GX_PICK_2_A, el("br"), S.GX_PICK_2_B] : [S.GX_PICK_1]));
    pgStack.classList.add("single");
    pgLbl.textContent = "";
    pgCount.textContent = "";
  } else {
    // The same measured layout the PDF uses, so the page count and page 1 are exact.
    const pages = buildPages(qm, T, RS, meta(), ui.host);
    ui.pageN = pages.length;
    pdfPage(pages[0]);
    pgStack.classList.toggle("single", pages.length < 2);
    pgLbl.textContent = t(S.GX_PAGE_1_OF, { n: pages.length });
    pgCount.textContent =
      RS.kind === "cmp" ? S.GX_PV_CMP_CAP : RS.kind === "both" ? S.GX_PV_BOTH_CAP : RS.kind === "card" ? plural(T.length, S.GX_PV_CARDS_ONE, S.GX_PV_CARDS_MANY) : S.GX_PV_SUM_CAP;
  }
  if (animate && !reduce()) {
    pg.classList.remove("swap");
    void pg.offsetWidth;
    pg.classList.add("swap");
  }
}

async function doDownload() {
  if (!ui) return;
  const { go, goT, host } = ui;
  if (go.classList.contains("busy") || go.disabled) return;
  go.classList.add("busy");
  goT.textContent = S.GX_PREPARING;
  const started = performance.now();
  try {
    const name = await downloadReport(RS.qm, targets(), { ...RS }, meta(), host);
    const wait = reduce() ? 0 : Math.max(0, 1100 - (performance.now() - started));
    await new Promise((r) => setTimeout(r, wait));
    go.classList.remove("busy");
    go.classList.add("done");
    goT.textContent = S.GX_DOWNLOADED;
    toast(t(S.GX_FILE_DOWNLOADED, { file: name }));
    setTimeout(() => ui && closeReport(), 900);
  } catch (error) {
    console.error(error);
    go.classList.remove("busy");
    render();
    toast(S.GX_DOWNLOAD_FAILED);
  }
}
