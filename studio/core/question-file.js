// Question files (.txt / .csv) — a line-for-line port of the app's
// ui/questionimport/QuestionFileParser.kt, SampleFileBuilder.kt and QuestionFileWriter.kt, so a
// file that imports in the app imports here with the same questions, the same skipped rows and
// the same line numbers. Also the Question Bank's export (BankExportBuilder.kt), which writes
// the same format back out. Pure: no DOM, runs under node for dev/question-file.test.mjs.
//
// The file only carries question text, options and which options are correct. There is no type
// column: the type is detected from the options (True/False pair → TRUE_FALSE, 2+ marked →
// MULTIPLE_CORRECT, else SINGLE_CHOICE). Timing and points come from the quiz at import time.
//
// .txt — blank-line-separated blocks; first line is the question, each next line an option,
// `*` at either end marks it correct, `#` lines are comments:
//     1. Capital of Pakistan?
//     Islamabad *
//     Lahore
//
// .csv — one row per question: question, option1, option2, …, correct. The LAST cell is the
// correct reference (1-based numbers split by | ; or space, or the option text); blank option
// cells are dropped. An optional header row whose first cell is "question" is skipped.

import { QUESTION_TYPES, newQuestion } from "./models.js";
import { S } from "./strings.js";

const { SINGLE_CHOICE, MULTIPLE_CORRECT, TRUE_FALSE } = QUESTION_TYPES;

/** Why a row/block was left out (ImportIssue). */
export const IMPORT_ISSUES = {
  EMPTY_QUESTION: "EMPTY_QUESTION",
  TOO_FEW_OPTIONS: "TOO_FEW_OPTIONS",
  NO_CORRECT: "NO_CORRECT",
  DUPLICATE_OPTIONS: "DUPLICATE_OPTIONS",
  /** CSV only: the correct cell names an option number/text that doesn't exist. */
  BAD_CORRECT_REF: "BAD_CORRECT_REF",
  /** Question or an option is too long, or there are too many options. */
  OVER_LIMIT: "OVER_LIMIT",
};

/** The three types the format can express — the only ones a sample can include. */
export const SAMPLE_QUESTION_TYPES = [SINGLE_CHOICE, MULTIPLE_CORRECT, TRUE_FALSE];
export const SAMPLE_FORMATS = { TXT: "txt", CSV: "csv" };

/** Files above this are refused up front (MAX_FILE_BYTES): a question file is text. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

let optionSeq = 0;
/** An option as the review step edits it: { key, text, correct }. */
export const option = (text, correct = false) => ({ key: `o${++optionSeq}`, text, correct });

const lines = (text) => text.split(/\r\n|\n|\r/);
const sameText = (a, b) => a.toLowerCase() === b.toLowerCase();
/** Kotlin's String.toIntOrNull: an optional sign and digits, nothing else. */
const toInt = (s) => (/^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null);

/**
 * parse(fileName, content, { allowNoCorrect, limits }) → { questions, skipped }
 *   question: { sourceLine, type, text, options: [{ key, text, correct }] }
 *   skipped:  { sourceLine, issue }
 *   limits:   { maxQuestionChars, maxOptionChars, maxOptions } | null — rows over any are skipped
 */
export function parse(fileName, content, { allowNoCorrect = false, limits = null } = {}) {
  // A byte-order mark (Excel/Notepad "UTF-8") is not text; left in, the CSV header row wasn't
  // recognised and came back as a bogus "bad reference" skipped row.
  const text = content.replace(/^﻿/, "");
  return /\.csv$/i.test(String(fileName ?? "").trim())
    ? parseCsv(text, { allowNoCorrect, limits })
    : parseTxt(text, { allowNoCorrect, limits });
}

// ── .txt ──────────────────────────────────────────────────────────────────

/** `1.`, `1)`, `1:`, `Q1:`, `Q1.`, `Q1)`, `Q1 -` — but a bare number takes no "-", and its
 *  "." / ")" / ":" must not be followed by a digit ("1984 - Who…", "3.14 is pi?" stay whole). */
const NUMBERING = /^\s*(?:[Qq]\s*\d+\s*[.):\-]|\d+\s*[.):](?!\d))\s*/;

export function parseTxt(content, { allowNoCorrect = false, limits = null } = {}) {
  const questions = [];
  const skipped = [];
  let blockStart = -1;
  const block = [];

  const flush = () => {
    if (!block.length) return;
    const text = block[0].replace(NUMBERING, "").trim();
    const options = block.slice(1).map((raw) => {
      const trimmed = raw.trim();
      const correct = trimmed.startsWith("*") || trimmed.endsWith("*");
      return option(trimmed.replace(/^\*+|\*+$/g, "").trim(), correct);
    });
    addOrSkip(blockStart, text, options, allowNoCorrect, questions, skipped, limits);
    block.length = 0;
    blockStart = -1;
  };

  lines(content).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) flush();
    else if (line.startsWith("#")) return;
    else {
      if (!block.length) blockStart = index + 1;
      block.push(line);
    }
  });
  flush();
  return { questions, skipped };
}

// ── .csv ──────────────────────────────────────────────────────────────────

export function parseCsv(content, { allowNoCorrect = false, limits = null } = {}) {
  const questions = [];
  const skipped = [];

  csvRecords(content).forEach(([lineNo, record], recordIndex) => {
    if (!record.trim()) return;
    const cells = splitCsvLine(record).map((c) => c.trim());
    if (cells.every((c) => !c)) return;
    if (recordIndex === 0 && sameText(cells[0], "question")) return;

    const text = cells[0];
    const correctCell = cells.length >= 2 ? cells[cells.length - 1] : "";
    const optionTexts = cells.slice(1, -1).filter(Boolean);

    const correctIndexes = resolveCorrectRefs(correctCell, optionTexts);
    if (correctIndexes == null) {
      skipped.push({ sourceLine: lineNo, issue: IMPORT_ISSUES.BAD_CORRECT_REF });
      return;
    }
    const options = optionTexts.map((t, i) => option(t, correctIndexes.has(i)));
    addOrSkip(lineNo, text, options, allowNoCorrect, questions, skipped, limits);
  });
  return { questions, skipped };
}

/** The correct cell as option indexes; null when any reference matches nothing. A number
 *  always means "option N" (options that are themselves numbers must not match by text
 *  first); then the whole cell as option text ("New York"); then | ; separated references,
 *  each of which may be space-separated numbers ("1 3"). */
function resolveCorrectRefs(correctCell, optionTexts) {
  const byText = (ref) => {
    const i = optionTexts.findIndex((t) => sameText(t, ref));
    return i >= 0 ? i : null;
  };
  const byNumber = (ref) => {
    const n = toInt(ref);
    return n != null && n - 1 >= 0 && n - 1 < optionTexts.length ? n - 1 : null;
  };
  if (!correctCell.trim()) return new Set();
  const whole = byNumber(correctCell.trim()) ?? byText(correctCell.trim());
  if (whole != null) return new Set([whole]);
  const result = new Set();
  for (const part of correctCell.split(/[|;]+/).map((p) => p.trim()).filter(Boolean)) {
    const hit = byNumber(part) ?? byText(part);
    if (hit != null) {
      result.add(hit);
      continue;
    }
    for (const ref of part.split(/\s+/).filter(Boolean)) {
      const one = byNumber(ref) ?? byText(ref);
      if (one == null) return null;
      result.add(one);
    }
  }
  return result;
}

/** [lineNo, record] pairs, keeping a quoted field's line breaks inside its record (RFC-4180).
 *  A quote never closed falls back to one record per line instead of swallowing the file. */
export function csvRecords(content) {
  const records = [];
  const pending = [];
  let startLine = 1;
  let inQuotes = false;
  lines(content).forEach((line, index) => {
    if (!pending.length) startLine = index + 1;
    pending.push(line);
    for (const ch of line) if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes) {
      records.push([startLine, pending.join("\n")]);
      pending.length = 0;
    }
  });
  pending.forEach((line, i) => records.push([startLine + i, line]));
  return records;
}

/** Minimal RFC-4180 split: commas inside "…" are literal, "" is an escaped quote. */
export function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes && c === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (c === '"') inQuotes = !inQuotes;
    else if (c === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else current += c;
  }
  cells.push(current);
  return cells;
}

// ── Shared ────────────────────────────────────────────────────────────────

function addOrSkip(sourceLine, text, options, allowNoCorrect, questions, skipped, limits) {
  if (
    limits &&
    (text.length > limits.maxQuestionChars ||
      options.length > limits.maxOptions ||
      options.some((o) => o.text.length > limits.maxOptionChars))
  ) {
    skipped.push({ sourceLine, issue: IMPORT_ISSUES.OVER_LIMIT });
    return;
  }
  const type = detectType(options);
  // TRUE_FALSE options are stored with the app's fixed capitalisation, whatever the file used.
  const normalised = type === TRUE_FALSE ? options.map((o) => ({ ...o, text: sameText(o.text, "true") ? "True" : "False" })) : options;
  const issue = issueOf(type, text, normalised, allowNoCorrect);
  if (issue) skipped.push({ sourceLine, issue });
  else questions.push({ sourceLine, type, text, options: normalised });
}

/** validateQuestionForm's order for the choice types: text → 2 options → duplicates → correct. */
export function issueOf(type, text, options, allowNoCorrect = false) {
  if (!text.trim()) return IMPORT_ISSUES.EMPTY_QUESTION;
  if (options.filter((o) => o.text.trim()).length < 2) return IMPORT_ISSUES.TOO_FEW_OPTIONS;
  const texts = options.map((o) => o.text.trim()).filter(Boolean);
  if (new Set(texts).size !== texts.length) return IMPORT_ISSUES.DUPLICATE_OPTIONS;
  if (allowNoCorrect) return null;
  if (!options.some((o) => o.correct && o.text.trim())) return IMPORT_ISSUES.NO_CORRECT;
  return null;
}

export function detectType(options) {
  const texts = options.map((o) => o.text.toLowerCase());
  if (texts.length === 2 && texts.includes("true") && texts.includes("false")) return TRUE_FALSE;
  if (options.filter((o) => o.correct).length >= 2) return MULTIPLE_CORRECT;
  return SINGLE_CHOICE;
}

/** A parsed question as a real question row for the quiz (buildQuestionFromForm). */
export function toQuestion(parsed, { timeSec, orderIndex }) {
  const question = newQuestion(parsed.type, { timeSec, orderIndex });
  question.text = parsed.text.trim();
  question.options = parsed.options.map((o) => o.text.trim());
  question.correct = parsed.options.filter((o) => o.correct).map((o) => o.text.trim());
  return question;
}

// ── Sample file (SampleFileBuilder + QuestionFileWriter) ──────────────────

export const sampleFileName = (format) => `quizoma-sample.${format}`;

/** Two example questions per type, so the pattern shows twice. */
const SAMPLES = {
  [SINGLE_CHOICE]: [
    ["What is the capital of Pakistan?", [["Islamabad", true], ["Lahore", false], ["Karachi", false], ["Peshawar", false]]],
    ["Which planet is known as the Red Planet?", [["Venus", false], ["Mars", true], ["Jupiter", false]]],
  ],
  [MULTIPLE_CORRECT]: [
    ["Which of these are prime numbers?", [["2", true], ["3", true], ["4", false], ["9", false]]],
    ["Which are programming languages?", [["Kotlin", true], ["Python", true], ["HTML", false]]],
  ],
  [TRUE_FALSE]: [
    ["The Earth is flat.", [["True", false], ["False", true]]],
    ["Water boils at 100°C at sea level.", [["True", true], ["False", false]]],
  ],
};

/** A ready-to-edit sample in exactly the shape parse() reads back. */
export function buildSample(types, format) {
  const blocks = SAMPLE_QUESTION_TYPES.filter((t) => types.includes(t)).flatMap((t) => SAMPLES[t]);
  if (format === SAMPLE_FORMATS.CSV) return writeCsv(blocks);
  return writeTxt(blocks, [S.IMP_SAMPLE_NOTE_1, S.IMP_SAMPLE_NOTE_2, S.IMP_SAMPLE_NOTE_3, S.IMP_SAMPLE_NOTE_4]);
}

// ── Question Bank export (BankExportBuilder.kt + QuestionFileWriter.exportableBlock) ──

/** A saved question as a [text, [[option, correct]…]] block, or null when the format can't
 *  hold it: only Single, Multiple and True/False with text, 2+ options and a correct answer
 *  survive the trip. Markup is stripped — a trailing "*" would read back as "correct". */
export function exportableBlock(question, stripMarkup = (s) => s) {
  if (!SAMPLE_QUESTION_TYPES.includes(question.type)) return null;
  const options = (question.options ?? []).filter((o) => String(o).trim());
  const correct = new Set(question.correct ?? []);
  const text = stripMarkup(String(question.text ?? "")).replace(/\n/g, " ").trim();
  if (!text || options.length < 2 || !options.some((o) => correct.has(o))) return null;
  return [text, options.map((o) => [o, correct.has(o)])];
}

export const bankExportFileName = (format) => `quizoma-question-bank.${format}`;

/**
 * The whole bank as .txt or .csv in exactly the shape parse() reads back. Returns
 * { content, writtenCount, skippedCount, skippedTypes } — skippedTypes in the fixed type order,
 * only the ones actually present, so the notice can name them.
 */
export function buildBankExport(questions, format, stripMarkup) {
  const blocks = [];
  const skipped = [];
  for (const q of questions) {
    const block = exportableBlock(q, stripMarkup);
    if (block) blocks.push(block);
    else skipped.push(q);
  }
  const content =
    format === SAMPLE_FORMATS.CSV
      ? writeCsv(blocks)
      : writeTxt(blocks, [S.BANK_EXPORT_NOTE_1, S.BANK_EXPORT_NOTE_2, S.BANK_EXPORT_NOTE_3, S.BANK_EXPORT_NOTE_4]);
  const types = new Set(skipped.map((q) => q.type));
  return {
    content,
    writtenCount: blocks.length,
    skippedCount: skipped.length,
    skippedTypes: Object.values(QUESTION_TYPES).filter((type) => types.has(type)),
  };
}

function writeTxt(blocks, headerLines) {
  let out = "";
  for (const line of headerLines) out += `# ${line}\n`;
  if (headerLines.length) out += "\n";
  blocks.forEach(([text, options], i) => {
    out += `${i + 1}. ${text}\n`;
    for (const [option, correct] of options) out += correct ? `${option} *\n` : `${option}\n`;
    out += "\n";
  });
  return `${out.trimEnd()}\n`;
}

function writeCsv(blocks) {
  const columns = blocks.length ? Math.max(...blocks.map(([, options]) => options.length)) : 4;
  let out = "question";
  for (let i = 0; i < columns; i++) out += `,option${i + 1}`;
  out += ",correct\n";
  for (const [text, options] of blocks) {
    out += csvCell(text);
    for (let i = 0; i < columns; i++) out += `,${options[i] ? csvCell(options[i][0]) : ""}`;
    out += `,${options.map(([, ok], i) => (ok ? i + 1 : null)).filter(Boolean).join("|")}\n`;
  }
  return out;
}

const csvCell = (value) => (/[,"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
