// Report files, generated in the browser from the page's current data (after the save queue is
// flushed, so marks made a moment ago are in). Nothing is uploaded: the file goes straight to
// the teacher's device.
//
//  - CSV: built here, UTF-8 with a BOM so Excel opens Urdu names correctly; answers and notes
//    become extra columns. Cells go through results/csv.js csvField (quoting + formula guard).
//  - Excel: SheetJS, loaded from its CDN only when an .xlsx is asked for — sheets Scores,
//    Answers, Notes.
//  - PDF: jsPDF (+ its html2canvas companion) loaded on demand; every page is the same markup
//    as the dialog's preview (report-pages.js, which lays pages out by measuring), rendered
//    off-screen at A4 size, one image per page. Pages render one at a time with a frame between,
//    so a big class never freezes the UI.

import { S } from "../core/strings.js";
import { csvField } from "../results/csv.js";
import { el } from "../ui/components.js";
import { buildPages } from "./report-pages.js";
import { qScore } from "./store.js";

const CDN = {
  xlsx: { src: "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js", global: "XLSX" },
  jspdf: { src: "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js", global: "jspdf" },
  html2canvas: { src: "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js", global: "html2canvas" },
};
const loading = new Map();
function loadLib(name) {
  const { src, global } = CDN[name];
  if (window[global]) return Promise.resolve(window[global]);
  if (!loading.has(name)) {
    loading.set(
      name,
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => (window[global] ? resolve(window[global]) : reject(new Error(`${name} did not load`)));
        s.onerror = () => {
          loading.delete(name);
          s.remove();
          reject(new Error(`${name} did not load`));
        };
        document.head.appendChild(s);
      })
    );
  }
  return loading.get(name);
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

/** `{quiz title before "—", spaces→-}_{class | N-students | Student-Name}.{pdf|xlsx|csv}` */
export function fileName(qm, rs, targets) {
  const base = qm.title.replace(/—.*/, "").trim().replace(/\s+/g, "-") || S.GX_FILE_FALLBACK;
  const who = rs.scope === "one" && targets[0] ? targets[0].name.trim().replace(/\s+/g, "-") : rs.scope === "some" ? `${targets.length}-students` : "class";
  return `${base}_${who}.${rs.fmt}`;
}

function stamp(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The Scores table: one row per student (ranked for a comparison). */
function scoreRows(qm, targets, rs) {
  const rows = targets.map((s) => ({ s, ...qScore(qm, s) }));
  const ranked = rs.kind === "cmp";
  if (ranked) rows.sort((a, b) => b.pct - a.pct || a.s.name.localeCompare(b.s.name));
  const head = [...(ranked ? [S.GX_RP_COL_RANK] : []), S.GX_RP_COL_STUDENT, S.GX_RP_COL_SUBMITTED, ...qm.qs.map((q, i) => `Q${i + 1}`), S.GX_RP_COL_TOTAL, "%"];
  const body = rows.map((r, i) => [
    ...(ranked ? [i + 1] : []),
    r.s.name,
    stamp(r.s.sub),
    ...qm.qs.map((q) => {
      const a = qm.A.get(`${r.s.id}|${q.id}`);
      return a && a.pts != null ? a.pts : "";
    }),
    r.g,
    r.pct,
  ]);
  return { head, body, rows };
}

function answerRows(qm, rows) {
  return {
    head: [S.GX_RP_COL_STUDENT, ...qm.qs.map((q, i) => `Q${i + 1}`)],
    body: rows.map((r) => [r.s.name, ...qm.qs.map((q) => qm.A.get(`${r.s.id}|${q.id}`)?.given ?? "")]),
  };
}

function noteRows(qm, rows) {
  return {
    head: [S.GX_RP_COL_STUDENT, ...qm.qs.map((q, i) => `Q${i + 1}`), S.GX_RP_COL_OVERALL],
    body: rows.map((r) => [r.s.name, ...qm.qs.map((q) => qm.A.get(`${r.s.id}|${q.id}`)?.fb ?? ""), r.s.attempt?.overall_feedback ?? ""]),
  };
}

export function buildCsvText(qm, targets, rs) {
  const sc = scoreRows(qm, targets, rs);
  const head = [...sc.head];
  const body = sc.body.map((row) => [...row]);
  if (rs.ans) {
    const ans = answerRows(qm, sc.rows);
    head.push(...qm.qs.map((q, i) => `Q${i + 1} ${S.GX_RP_COL_ANSWER_SUFFIX}`));
    ans.body.forEach((row, i) => body[i].push(...row.slice(1)));
  }
  if (rs.notes) {
    const notes = noteRows(qm, sc.rows);
    head.push(...qm.qs.map((q, i) => `Q${i + 1} ${S.GX_RP_COL_NOTE_SUFFIX}`), S.GX_RP_COL_OVERALL);
    notes.body.forEach((row, i) => body[i].push(...row.slice(1)));
  }
  return `﻿${[head, ...body].map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}

async function buildXlsx(qm, targets, rs) {
  const XLSX = await loadLib("xlsx");
  const wb = XLSX.utils.book_new();
  const sc = scoreRows(qm, targets, rs);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sc.head, ...sc.body]), S.GX_RP_SHEET_SCORES);
  if (rs.ans) {
    const a = answerRows(qm, sc.rows);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([a.head, ...a.body]), S.GX_RP_SHEET_ANSWERS);
  }
  if (rs.notes) {
    const n = noteRows(qm, sc.rows);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([n.head, ...n.body]), S.GX_RP_SHEET_NOTES);
  }
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function buildPdf(qm, targets, rs, meta, host) {
  const [{ jsPDF }, html2canvas] = await Promise.all([loadLib("jspdf"), loadLib("html2canvas")]);
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const pages = buildPages(qm, targets, rs, meta, host);
  // html2canvas measures text baselines with an <img> in this document; ui/base.css makes every
  // img a block, which would draw all text a few pixels low. Undone only while rendering.
  const fix = document.head.appendChild(Object.assign(document.createElement("style"), { textContent: "body>div>img{display:inline!important}" }));
  try {
    return await renderPages(pdf, pages, qm, host, html2canvas, W, H);
  } finally {
    fix.remove();
  }
}

async function renderPages(pdf, pages, qm, host, html2canvas, W, H) {
  for (let i = 0; i < pages.length; i++) {
    const inner = el("div", { class: "inner rpage" }, pages[i]);
    inner.style.setProperty("--qcol", qm.color);
    host.replaceChildren(el("div", { class: "pg" }, [inner]));
    // The app icon in the band and footer has to be decoded before the capture.
    await Promise.all([...inner.querySelectorAll("img")].map((img) => img.decode().catch(() => {})));
    await frame();
    const canvas = await html2canvas(inner, { scale: 2, backgroundColor: "#ffffff", logging: false, useCORS: true });
    // Pages are laid out to fit A4 (report-pages.js flow); one that still runs long (a single
    // enormous answer) is shrunk onto its sheet rather than cut.
    const h = (canvas.height * W) / canvas.width;
    const scale = Math.min(1, H / h);
    if (i) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (W - W * scale) / 2, 0, W * scale, h * scale);
    await frame();
  }
  host.replaceChildren();
  return pdf.output("blob");
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Builds the file for the dialog's current choices and downloads it. */
export async function downloadReport(qm, targets, rs, meta, host) {
  const name = fileName(qm, rs, targets);
  let blob;
  if (rs.fmt === "csv") blob = new Blob([buildCsvText(qm, targets, rs)], { type: "text/csv;charset=utf-8" });
  else if (rs.fmt === "xlsx") blob = await buildXlsx(qm, targets, rs);
  else blob = await buildPdf(qm, targets, rs, meta, host);
  save(blob, name);
  return name;
}
