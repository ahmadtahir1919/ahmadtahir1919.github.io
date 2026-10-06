// The report pages — the class report, the student comparison and report cards — and the
// spreadsheet preview, as DOM. The dialog draws page 1 into its scaled A4 preview; the PDF
// export renders every page of the same markup, so what you see is what downloads.
//
// The PDF follows the Android app's report (util/ResultPdfGenerator.kt): a band in the quiz's
// colour with the app icon, stat cards, Question accuracy, Poll results, Participants, then each
// student's answers with ✓ / ✗, and the app's footer line on every page. Pages are laid out by
// measuring (flow): blocks fill a page, tables carry on onto the next with their header repeated,
// and nothing is ever cut through a row.

import { route } from "../core/paths.js";
import { S, t } from "../core/strings.js";
import { el } from "../ui/components.js";
import { fmt, plural } from "./gx-util.js";
import { qScore, tallyOf } from "./store.js";

const PAGE_H = 842;
const FOOT_ZONE = 46; // footer + breathing room at the bottom of every page
const PASS = 60; // the app's pass mark (green at or above, red below)

const okInk = (pct) => (pct >= PASS ? "#16A34A" : "#DC2626");
const generated = () => new Date().toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const logo = (size) => el("span", { class: "rplogo", style: `width:${size}px;height:${size}px` }, [el("img", { src: route("ui/logo.webp"), alt: "", width: String(size), height: String(size) })]);

// ── Page frame: header band, body, footer ───────────────────────────────────

/** The big band on a report's first page (and on each report card). */
function band(qm, badge, sub, meta) {
  const line = [qm.quiz?.groupName?.trim(), meta.teacher ? t(S.GX_RP_TEACHER, { name: meta.teacher }) : null, t(S.GX_RP_GENERATED, { date: generated() })].filter(Boolean).join("   ·   ");
  return el("div", { class: "rpband" }, [
    el("i", { class: "c1" }),
    el("i", { class: "c2" }),
    el("div", { class: "rpbt" }, [
      el("span", { class: "badge", text: badge }),
      el("h1", { dir: "auto", text: qm.title }),
      el("div", { class: "sub", dir: "auto", text: sub ? `${sub}   ·   ${line}` : line }),
    ]),
    el("span", { class: "lt" }, [logo(40)]),
  ]);
}

/** The slim band on every following page. */
const slim = (qm, section) =>
  el("div", { class: "rpslim" }, [el("b", { dir: "auto", text: qm.title }), el("span", { text: section }), el("span", { class: "lt" }, [logo(18)])]);

/** The app's footer: icon · "Quizoma: Quiz & Test Maker · quizoma.com" · Page n of N. */
const foot = (n, total) =>
  el("div", { class: "rpfoot" }, [logo(11), el("span", { text: S.GX_RP_FOOT_BRAND }), el("span", { class: "pn", text: t(S.GX_RP_PAGE_OF, { n, total }) })]);

const sec = (text) => el("div", { class: "rpsec", text });

/**
 * Lays blocks onto pages by measuring them in `host` (the dialog's off-screen 595px page).
 * Blocks: { node } — kept whole; { table } — { cls, head(), rows[], cap?, tail? } split
 * between rows with the header repeated (cap — e.g. a section title — stays with the first
 * row; tail goes after the last row); { newPage, head? } — start a new page unless this one is
 * still empty. Returns [[...nodes of page 1], ...], each ending with its footer.
 */
function flow(host, qm, firstHead, nextHead, blocks) {
  const pages = [];
  let cur = null;
  const open = (head) => {
    const body = el("div", { class: "rpbody" });
    const inner = el("div", { class: "inner rpage" }, [head, body]);
    inner.style.setProperty("--qcol", qm.color);
    host.replaceChildren(el("div", { class: "pg" }, [inner]));
    cur = { head, body, inner };
    pages.push(cur);
  };
  const fits = () => cur.body.getBoundingClientRect().bottom - cur.inner.getBoundingClientRect().top <= PAGE_H - FOOT_ZONE;
  const empty = () => !cur.body.childElementCount;
  const place = (node) => {
    cur.body.append(node);
    if (fits() || empty() || cur.body.firstChild === node) return;
    node.remove();
    open(nextHead());
    cur.body.append(node);
  };

  open(firstHead);
  for (const b of blocks) {
    if (!b) continue;
    if (b.newPage) {
      if (!empty()) open((b.head ?? nextHead)());
      else if (b.head) {
        const h = b.head();
        cur.head.replaceWith(h);
        cur.head = h;
      }
      continue;
    }
    if (b.node) {
      place(b.node);
      continue;
    }
    const tb = b.table;
    let tbody = null;
    const start = (withCap) => {
      tbody = el("tbody");
      const table = el("table", { class: tb.cls }, [tb.head(), tbody]);
      const wrap = el("div", { class: "rptw" }, [withCap && tb.cap ? tb.cap : null, table]);
      cur.body.append(wrap);
      return wrap;
    };
    let wrap = start(true);
    let first = true;
    for (const row of tb.rows) {
      tbody.append(row);
      if (fits()) {
        first = false;
        continue;
      }
      row.remove();
      if (!tbody.childElementCount) {
        // Not even one row fits under what's on this page: move the whole start along.
        wrap.remove();
        if (empty()) {
          wrap = start(first);
          tbody.append(row); // taller than a page on its own: let it run
          first = false;
          continue;
        }
        open(nextHead());
        wrap = start(first);
      } else {
        open(nextHead());
        wrap = start(false);
      }
      tbody.append(row);
      first = false;
    }
    if (tb.tail) place(tb.tail);
  }
  host.replaceChildren();
  return pages.map((p, i) => [p.head, p.body, foot(i + 1, pages.length)]);
}

// ── Scores ──────────────────────────────────────────────────────────────────

/** Students with their score, ranked like the app: fully marked first, by %, then name. */
function ranked(qm, T) {
  return T.map((s) => ({ s, ...qScore(qm, s) })).sort((a, b) => (a.p > 0) - (b.p > 0) || b.pct - a.pct || a.s.name.localeCompare(b.s.name));
}

/** "correct" | "wrong" | "partial" | "skipped" | "pending" for one answer. */
function verdict(a) {
  if (a.pts == null) return "pending";
  if (!a.given.trim()) return "skipped";
  return a.pts === a.max ? "correct" : a.pts === 0 ? "wrong" : "partial";
}
const MARK = { correct: ["✓", "#16A34A"], wrong: ["✗", "#DC2626"], partial: ["◐", "#D97706"], skipped: ["–", "#6B7280"], pending: ["…", "#B08900"] };

function counts(qm, s) {
  const c = { correct: 0, wrong: 0, partial: 0, skipped: 0, pending: 0 };
  for (const q of qm.qs) {
    const a = qm.A.get(`${s.id}|${q.id}`);
    if (a) c[verdict(a)]++;
  }
  return c;
}

// ── Class report: stats, accuracy, polls, participants ──────────────────────

function statGrid(qm, rows) {
  const done = rows.filter((r) => !r.p);
  const pc = done.map((r) => r.pct);
  const pend = rows.reduce((n, r) => n + r.p, 0);
  const pctOr = (v) => (pc.length ? `${v}%` : "—");
  const card = (label, value, color) => el("div", { class: "rpstat", style: `--sc:${color}` }, [el("small", { text: label }), el("b", { text: value })]);
  return el("div", { class: "rpstats" }, [
    card(S.GX_RP_ST_PARTS, String(rows.length), "#6C5CE7"),
    card(S.GX_RP_ST_AVG, pctOr(pc.length ? Math.round(pc.reduce((a, b) => a + b, 0) / pc.length) : 0), "var(--qcol)"),
    card(S.GX_RP_ST_HIGH, pctOr(pc.length ? Math.max(...pc) : 0), "#D97706"),
    card(S.GX_RP_ST_LOW, pctOr(pc.length ? Math.min(...pc) : 0), "#DC2626"),
    card(S.GX_RP_ST_PASSED, `${pc.filter((v) => v >= PASS).length} / ${done.length}`, "#16A34A"),
    pend ? card(S.GX_RP_ST_AWAIT, String(pend), "#D97706") : null,
    card(S.GX_RP_ST_QUESTIONS, String(qm.qs.length), "#6B6880"),
  ]);
}

function distribution(rows) {
  const bins = [0, 0, 0, 0, 0];
  for (const r of rows) if (!r.p) bins[Math.min(4, Math.floor(r.pct / 20))]++;
  const mx = Math.max(1, ...bins);
  return el("div", { class: "rpgroup" }, [
    sec(S.GX_RP_SEC_DIST),
    el(
      "div",
      { class: "rpbars" },
      bins.map((b, i) => el("div", {}, [el("b", { text: String(b) }), el("i", { style: `height:${Math.max(3, (b / mx) * 52)}px` }), t(S.GX_BAND, { lo: i * 20, hi: i * 20 + 20 })]))
    ),
  ]);
}

/** Average mark per question over the answers that have one (partial marks count partly). */
function accuracyOf(qm, rows, q) {
  const v = rows.map((r) => qm.A.get(`${r.s.id}|${q.id}`)).filter((a) => a && a.pts != null).map((a) => a.pts / a.max);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) : null;
}

function accuracyTable(qm, rows) {
  return {
    table: {
      cls: "rpt acc",
      cap: sec(S.GX_RP_SEC_ACC),
      head: () => el("thead", {}, [el("tr", {}, [el("th", { class: "n", text: "#" }), el("th", { text: S.GX_RP_QUESTION }), el("th", { class: "r", text: S.GX_RP_ACC })])]),
      rows: qm.qs.map((q) => {
        const v = accuracyOf(qm, rows, q);
        return el("tr", {}, [
          el("td", { class: "n", text: String(q.num) }),
          el("td", { dir: "auto", text: q.text }),
          el("td", { class: "r" }, [v == null ? el("span", { class: "mut", text: "—" }) : el("b", { style: `color:${okInk(v)}`, text: `${v}%` })]),
        ]);
      }),
    },
  };
}

function pollCards(qm) {
  if (!qm.polls.length) return [];
  return qm.polls.map((p, i) => {
    const tally = tallyOf(qm, p);
    const opts = [...tally.options, ...(tally.other.count ? [{ label: S.POLL_OTHER, ...tally.other }] : [])];
    const card = el("div", { class: "rppoll" }, [
      el("div", { class: "ph" }, [el("b", { dir: "auto", text: `Q${p.num}. ${p.text}` }), el("span", { text: plural(tally.voters, S.GX_POLL_VOTED_ONE, S.GX_POLL_VOTED_MANY) })]),
      tally.voters
        ? el(
            "div",
            { class: "po" },
            opts.map((o) =>
              el("div", {}, [el("span", { dir: "auto", text: o.label }), el("span", { class: "tr" }, [el("i", { style: `width:${o.percent}%` })]), el("b", { text: `${o.percent}% (${o.count})` })])
            )
          )
        : el("div", { class: "mut", text: S.POLL_NO_VOTES }),
    ]);
    // The section title travels with the first card.
    return { node: i ? card : el("div", { class: "rpgroup" }, [sec(S.GX_RP_SEC_POLLS), card]) };
  });
}

function participantsTable(qm, rows) {
  return {
    table: {
      cls: "rpt parts",
      cap: sec(t(S.GX_RP_SEC_PARTS, { n: rows.length })),
      head: () =>
        el("thead", {}, [
          el("tr", {}, [el("th", { class: "n", text: S.GX_RP_RANK }), el("th", { text: S.GX_RP_STUDENT }), el("th", { class: "r", text: S.GX_RP_SCORE }), el("th", { class: "r", text: "%" }), el("th", { text: S.GX_RP_STATUS })]),
        ]),
      rows: rows.map((r, i) =>
        el("tr", {}, [
          el("td", { class: "n", text: String(i + 1) }),
          el("td", { dir: "auto", text: r.s.name }),
          el("td", { class: "r", text: t(S.GX_SCORE, { g: fmt(r.g), m: r.m }) }),
          el("td", { class: "r" }, [r.p ? el("span", { class: "mut", text: "—" }) : el("b", { style: `color:${okInk(r.pct)}`, text: `${r.pct}%` })]),
          el("td", { class: r.p ? "pe" : "ok", text: r.p ? t(S.GX_RP_N_NOT_MARKED, { n: r.p }) : S.GX_RP_MARKED }),
        ])
      ),
    },
  };
}

// ── One student's results (the app's drawParticipantDetail) ─────────────────

function studentBlock(qm, r, rank, rs) {
  const s = r.s;
  const c = counts(qm, s);
  const meta = [
    t(S.GX_RP_META_SCORE, { g: fmt(r.g), m: r.m, pct: r.pct }),
    t(S.GX_RP_META_RIGHT, { c: c.correct, w: c.wrong }),
    c.partial ? t(S.GX_RP_META_PART, { n: c.partial }) : null,
    c.skipped ? t(S.GX_RP_META_SKIP, { n: c.skipped }) : null,
    r.p ? t(S.GX_RP_N_NOT_MARKED, { n: r.p }) : null,
    s.sub ? t(S.GX_SUBMITTED_CAP, { when: new Date(s.sub).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) }) : null,
  ].filter(Boolean);
  const note = rs.notes ? s.attempt?.overall_feedback?.trim() : "";
  const cap = el("div", { class: "rpstu" }, [
    el("div", { class: "hd" }, [el("b", { dir: "auto", text: rank ? `#${rank}  ${s.name}` : s.name }), el("div", { class: "mt", text: meta.join("   ·   ") })]),
    note ? el("div", { class: "nt" }, [el("b", { text: S.GX_RP_OWNER_NOTE }), el("div", { dir: "auto", text: note })]) : null,
  ]);
  const rows = qm.qs
    .map((q) => {
      const a = qm.A.get(`${s.id}|${q.id}`);
      if (!a) return null;
      const v = verdict(a);
      const [glyph, ink] = MARK[v];
      return el("tr", {}, [
        el("td", { class: "n", text: String(q.num) }),
        el("td", {}, [el("div", { dir: "auto", text: q.text }), rs.notes && a.fb ? el("div", { class: "fb", dir: "auto", text: t(S.GX_RP_NOTE, { text: a.fb }) }) : null]),
        rs.ans ? el("td", { dir: "auto", style: `color:${ink}` }, [a.given.trim() ? a.given : el("span", { class: "mut", text: S.GX_RP_NO_ANSWER })]) : null,
        rs.ans ? el("td", { dir: "auto", text: q.exp }) : null,
        el("td", { class: "r", text: a.pts == null ? S.GX_RP_NOT_MARKED : t(S.GX_SCORE, { g: fmt(a.pts), m: a.max }) }),
        el("td", { class: "mk", style: `color:${ink}`, text: glyph }),
      ]);
    })
    .filter(Boolean);
  return {
    table: {
      cls: "rpt answ",
      cap,
      head: () =>
        el("thead", {}, [
          el("tr", {}, [
            el("th", { class: "n", text: "#" }),
            el("th", { text: S.GX_RP_QUESTION }),
            rs.ans ? el("th", { text: S.GX_RP_GIVEN }) : null,
            rs.ans ? el("th", { text: S.GX_RP_CORRECT }) : null,
            el("th", { class: "r", text: S.GX_RP_MARKS }),
            el("th", { class: "mk" }),
          ]),
        ]),
      rows,
    },
  };
}

// ── Student comparison (web only) ───────────────────────────────────────────

const BAND = (p) => (p >= 80 ? ["#10b981", "#dcfaee", "#047857"] : p >= 50 ? ["#4f46e5", "#eceafe", "#4338ca"] : p >= 30 ? ["#f59e0b", "#fff3d6", "#a35e00"] : ["#e5484d", "#fde9e9", "#c23136"]);

function compareBlocks(qm, T, rs) {
  const rows = T.map((s) => ({ s, ...qScore(qm, s) })).sort((a, b) => b.pct - a.pct || a.s.name.localeCompare(b.s.name));
  const avg = Math.round(rows.reduce((a, r) => a + r.pct, 0) / rows.length);
  const qAvg = qm.qs.map((q) => accuracyOf(qm, rows, q));
  let hard = -1;
  qAvg.forEach((v, i) => {
    if (v != null && (hard < 0 || v < qAvg[hard])) hard = i;
  });
  const hq = hard >= 0 ? qm.qs[hard] : null;
  const cell = (a) => {
    if (!a || a.pts == null) return el("td", { class: "cm" }, [el("span", { class: "cx pe", text: "–" })]);
    const r = a.pts / a.max;
    return el("td", { class: "cm" }, [el("span", { class: `cx ${r === 1 ? "ok" : r === 0 ? "no" : "pt"}`, text: fmt(a.pts) })]);
  };
  const blocks = [
    {
      node: el("div", { class: "cmi" }, [
        el("div", {}, [el("small", { text: S.GX_RP_TOP }), el("b", { text: `${rows[0].pct}%` }), el("span", { dir: "auto", text: rows[0].s.name })]),
        el("div", {}, [el("small", { text: S.GX_RP_AVERAGE }), el("b", { text: `${avg}%` }), el("span", { text: plural(rows.length, S.GX_RP_COMPARED_ONE, S.GX_RP_COMPARED_MANY) })]),
        el("div", {}, [
          el("small", { text: S.GX_RP_HARDEST }),
          el("b", { text: hq ? `Q${hq.num}` : "—" }),
          el("span", { dir: "auto", text: hq ? t(S.GX_RP_HARD_LINE, { avg: qAvg[hard], text: hq.text.slice(0, 30) + (hq.text.length > 30 ? "…" : "") }) : "" }),
        ]),
      ]),
    },
  ];
  if (rs.chart) {
    blocks.push({
      node: el("div", { class: "rpgroup" }, [
        sec(S.GX_RP_SCORES),
        el("div", { class: "cmbars" }, [
          ...rows.map((r) => {
            const [c] = BAND(r.pct);
            return el("div", { class: "cmb" }, [
              el("span", { class: "nm", dir: "auto", text: r.s.name }),
              el("span", { class: "tr" }, [el("i", { style: `width:${Math.max(1, r.pct)}%;background:${c}` }), el("em", { style: `left:${avg}%` })]),
              el("b", { text: `${r.pct}%` }),
            ]);
          }),
          el("div", { class: "cmavg" }, [el("span"), el("span", { style: `padding-left:${avg}%`, text: t(S.GX_RP_CLASS_AVG_MARK, { avg }) })]),
        ]),
      ]),
    });
  }
  blocks.push({
    table: {
      cls: "cmt",
      cap: sec(S.GX_RP_QBYQ),
      head: () =>
        el("thead", {}, [
          el("tr", {}, [
            el("th", { class: "rk", text: "#" }),
            el("th", { text: S.GX_RP_STUDENT }),
            ...qm.qs.map((q) => el("th", { class: "cm" }, [`Q${q.num}`, el("small", { text: `/${q.pts}` })])),
            el("th", { class: "r", text: S.GX_RP_TOTAL }),
            el("th", { class: "r", text: "%" }),
          ]),
        ]),
      rows: rows.map((r, i) => {
        const [, bg, ink] = BAND(r.pct);
        return el("tr", {}, [
          el("td", { class: "rk", text: String(i + 1) }),
          el("td", { class: "sn", dir: "auto", text: r.s.name }),
          ...qm.qs.map((q) => cell(qm.A.get(`${r.s.id}|${q.id}`))),
          el("td", { class: "r" }, [el("b", { text: fmt(r.g) }), `/${r.m}`]),
          el("td", { class: "r" }, [el("span", { class: "pp", style: `background:${bg};color:${ink}`, text: `${r.pct}%` })]),
        ]);
      }),
      tail: el("div", {}, [
        el("table", { class: "cmt avgrow" }, [
          el("tbody", {}, [
            el("tr", {}, [
              el("td", { class: "rk" }),
              el("td", { class: "sn", text: S.GX_RP_CLASS_AVG }),
              ...qAvg.map((v, i) => el("td", { class: "cm" }, [el("span", { class: `qa ${i === hard ? "hd" : ""}`, text: v == null ? "–" : `${v}%` })])),
              el("td", { class: "r" }),
              el("td", { class: "r" }, [el("b", { text: `${avg}%` })]),
            ]),
          ]),
        ]),
        el("div", { class: "cmleg" }, [
          el("span", {}, [el("i", { class: "cx ok" }), S.GX_RP_LEG_FULL]),
          el("span", {}, [el("i", { class: "cx pt" }), S.GX_RP_LEG_PART]),
          el("span", {}, [el("i", { class: "cx no" }), S.GX_RP_LEG_ZERO]),
          el("span", {}, [el("i", { class: "cx pe" }), S.GX_RP_LEG_PENDING]),
        ]),
      ]),
    },
  });
  return blocks;
}

// ── Putting a report together ───────────────────────────────────────────────

/**
 * Every page of the PDF for the dialog's choices, in order: [[nodes], ...]. Needs `host` — an
 * attached, unscaled 595px-wide element (the dialog's .pdfhost) — to measure in.
 *   sum  — the class report        card — one report card per student, each on new pages
 *   both — class report, then everyone's answers (they flow, like the app's report)
 *   cmp  — the student comparison
 */
export function buildPages(qm, T, rs, meta, host) {
  if (!T.length) return [];
  const rows = ranked(qm, T);
  const rankOf = new Map(rows.map((r, i) => [r.s.id, i + 1]));
  const later = (section) => () => slim(qm, section);

  if (rs.kind === "cmp") return flow(host, qm, band(qm, S.GX_RP_BADGE_CMP, "", meta), later(S.GX_RP_COMPARE), compareBlocks(qm, T, rs));

  if (rs.kind === "card") {
    // Each student starts on a fresh page under their own band, like the app's one-person report.
    const blocks = [];
    T.forEach((s, i) => {
      const r = rows.find((x) => x.s === s);
      const head = () => band(qm, S.GX_RP_BADGE_ONE, s.name, meta);
      if (i) blocks.push({ newPage: true, head });
      blocks.push(studentBlock(qm, r, 0, rs));
    });
    return flow(host, qm, band(qm, S.GX_RP_BADGE_ONE, T[0].name, meta), later(S.GX_RP_CARD), blocks);
  }

  const blocks = [{ node: statGrid(qm, rows) }, rs.chart ? { node: distribution(rows) } : null, accuracyTable(qm, rows), ...pollCards(qm), participantsTable(qm, rows)];
  if (rs.kind === "both") {
    blocks.push({ newPage: true }, { node: el("div", { class: "rpsec big", text: S.GX_RP_SEC_INDIV }) });
    for (const r of rows) blocks.push(studentBlock(qm, r, rankOf.get(r.s.id), rs));
  }
  return flow(host, qm, band(qm, S.GX_RP_BADGE_CLASS, "", meta), later(rs.kind === "both" ? S.GX_RP_REPORT : S.GX_RP_SUMMARY), blocks);
}

// ── Spreadsheet preview ─────────────────────────────────────────────────────

export function sheetPreview(qm, T, rs, fileName) {
  const head = [S.GX_RP_COL_STUDENT, S.GX_RP_COL_SUBMITTED, ...qm.qs.map((q, i) => `Q${i + 1}`), S.GX_RP_COL_TOTAL, "%"];
  const extras = [rs.ans ? S.GX_RP_PLUS_ANSWERS : "", rs.notes ? S.GX_RP_PLUS_NOTES : ""].filter(Boolean).join(S.GX_SEP);
  return [
    el("div", { style: "font-family:var(--mono);font-size:11px" }, [
      el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:10px;font-family:var(--font)" }, [
        el("span", { style: `background:${rs.fmt === "xlsx" ? "#15803d" : "#64748b"};color:#fff;font-weight:800;font-size:10px;padding:3px 6px;border-radius:5px`, text: rs.fmt === "xlsx" ? "XLS" : "CSV" }),
        el("b", { style: "font-size:13px", text: fileName }),
      ]),
      el("table", { class: "rptb", style: "font-size:10.5px" }, [
        el("thead", {}, [el("tr", {}, head.map((h, i) => el("th", { style: "background:#f0f1fa;border:1px solid #e4e6f2", class: i > 1 ? "r" : null, text: h })))]),
        el(
          "tbody",
          {},
          T.slice(0, 24).map((s) => {
            const sc = qScore(qm, s);
            const cells = [
              s.name,
              new Date(s.sub).toLocaleDateString([], { day: "2-digit", month: "2-digit" }),
              ...qm.qs.map((q) => {
                const a = qm.A.get(`${s.id}|${q.id}`);
                return a && a.pts != null ? fmt(a.pts) : "";
              }),
              fmt(sc.g),
              String(sc.pct),
            ];
            return el("tr", {}, cells.map((c, i) => el("td", { style: "border:1px solid #eef0f6", class: i > 1 ? "r" : null, text: c })));
          })
        ),
      ]),
      extras
        ? el("div", { style: "margin-top:8px;color:#6a6e88;font-family:var(--font);font-size:10.5px", text: extras + (rs.fmt === "csv" ? S.GX_RP_CSV_EXTRA : "") })
        : null,
    ]),
  ];
}
