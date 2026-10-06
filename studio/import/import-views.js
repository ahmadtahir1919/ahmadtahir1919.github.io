// The pieces of the import screen — a port of the app's ImportQuestionsScreen.kt composables
// (DraftsBanner, TitleCard, UploadCard, CheatSheetCard, TemplateCard, ReviewTitleCard, FileRow,
// SummaryRow, SkippedCard, ParsedQuestionCard, EditableQuestionCard). Render only: every
// action goes back to import-page.js through [h] (the handlers).

import { QUESTION_TYPES } from "../core/models.js";
import { IMPORT_ISSUES, SAMPLE_FORMATS, SAMPLE_QUESTION_TYPES } from "../core/question-file.js";
import { route } from "../core/paths.js";
import { S, t } from "../core/strings.js";
import { el } from "../ui/components.js";
import { icon } from "../ui/icons.js";

const { SINGLE_CHOICE, MULTIPLE_CORRECT, TRUE_FALSE } = QUESTION_TYPES;

/** Material outlined glyphs the app uses here that ui/icons.js doesn't have. Static only. */
const GLYPHS = {
  lockOpen: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/>',
  fileDown: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6m0 0-3-3m3 3 3-3"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
};
function glyph(name, size = 20) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const attrs = { width: String(size), height: String(size), viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.9", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  svg.innerHTML = GLYPHS[name]; // static constants above
  return svg;
}

const card = (children, cls = "") => el("section", { class: `imp-card ${cls}` }, children);
const accentCircle = (child) => el("span", { class: "imp-circle", "aria-hidden": "true" }, [child]);
const stepPill = (n) => el("span", { class: "imp-step-pill", "aria-hidden": "true", text: String(n) });

export const ISSUE_LABEL = {
  [IMPORT_ISSUES.EMPTY_QUESTION]: () => S.IMP_ISSUE_EMPTY_QUESTION,
  [IMPORT_ISSUES.TOO_FEW_OPTIONS]: () => S.IMP_ISSUE_TOO_FEW_OPTIONS,
  [IMPORT_ISSUES.NO_CORRECT]: () => S.IMP_ISSUE_NO_CORRECT,
  [IMPORT_ISSUES.DUPLICATE_OPTIONS]: () => S.IMP_ISSUE_DUPLICATE_OPTIONS,
  [IMPORT_ISSUES.BAD_CORRECT_REF]: () => S.IMP_ISSUE_BAD_CORRECT_REF,
  [IMPORT_ISSUES.OVER_LIMIT]: () => S.IMP_ISSUE_OVER_LIMIT,
};

const TYPE_LABEL = {
  [SINGLE_CHOICE]: () => S.IMP_TYPE_SINGLE,
  [MULTIPLE_CORRECT]: () => S.IMP_TYPE_MULTIPLE,
  [TRUE_FALSE]: () => S.IMP_TYPE_TF,
};

// ── Step 1: choose file ───────────────────────────────────────────────────

export function draftsBanner() {
  return card(
    [
      el("div", { class: "imp-row" }, [
        accentCircle(glyph("lockOpen")),
        el("p", { class: "imp-banner-text" }, [el("b", { text: S.IMP_BANNER_LEAD }), S.IMP_BANNER_REST]),
      ]),
    ],
    "imp-banner"
  );
}

export function titleCard(state, h) {
  const counter = el("span", { class: "imp-counter", text: `${state.title.length} / ${state.limits.maxQuizTitleChars}` });
  const input = el("input", {
    class: `imp-title-input ${state.titleError ? "is-error" : ""}`,
    type: "text",
    value: state.title,
    maxlength: String(state.limits.maxQuizTitleChars),
    placeholder: S.IMP_TITLE_PLACEHOLDER,
    "aria-label": S.IMP_TITLE_CARD,
    "data-fk": "imp-title",
  });
  input.addEventListener("input", () => {
    h.onTitle(input.value);
    counter.textContent = `${input.value.length} / ${state.limits.maxQuizTitleChars}`;
    input.classList.remove("is-error");
    errorNode.hidden = true;
  });
  const errorNode = el("p", { class: "imp-error", text: S.IMP_TITLE_REQUIRED, hidden: !state.titleError });
  return card([
    el("div", { class: "imp-row" }, [stepPill(1), el("h2", { class: "imp-card-title grow", text: S.IMP_TITLE_CARD }), counter]),
    input,
    errorNode,
  ]);
}

export function uploadCard(state, h) {
  const fileInput = el("input", { type: "file", accept: ".txt,.csv,text/plain,text/csv", hidden: true, "data-fk": "imp-file" });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) h.onFile(file);
    fileInput.value = "";
  });

  const parsed = state.parsed;
  let inner;
  if (state.fileName && parsed) {
    const clear = el("button", { type: "button", class: "imp-icon-btn", "aria-label": S.IMP_CLEAR_FILE, title: S.IMP_CLEAR_FILE }, [icon("x", "icon icon-sm")]);
    clear.addEventListener("click", (e) => {
      e.stopPropagation();
      h.onClearFile();
    });
    const none = !parsed.questions.length;
    inner = [
      el("img", { class: "imp-drop-art is-small", src: route("ui/upload-file.png"), alt: "", width: "56", height: "56" }),
      el("div", { class: "imp-file-name" }, [el("b", { class: "ellipsis", text: state.fileName }), clear]),
      el("p", { class: `imp-summary ${none ? "is-bad" : "is-good"}`, text: t(S.IMP_SUMMARY, { ready: parsed.questions.length, skipped: parsed.skipped.length }) }),
      none && !parsed.skipped.length ? el("p", { class: "imp-error", text: S.IMP_NOTHING_FOUND }) : null,
    ];
  } else if (state.reading) {
    inner = [el("div", { class: "spinner", role: "status", "aria-label": S.IMP_READING }), el("p", { class: "imp-sub", text: S.IMP_READING })];
  } else {
    const paste = el("button", { type: "button", class: "imp-link", text: S.IMP_PASTE_LINK });
    paste.addEventListener("click", (e) => {
      e.stopPropagation();
      h.onPaste();
    });
    inner = [
      el("img", { class: "imp-drop-art", src: route("ui/upload-file.png"), alt: "", width: "76", height: "76" }),
      el("p", { class: "imp-drop-title", text: state.dragging ? S.IMP_DROP_HERE : S.IMP_DROPZONE_TITLE }),
      el("p", { class: "imp-sub", text: S.IMP_DROPZONE_SUB }),
      el("hr", { class: "imp-divider" }),
      el("div", { class: "imp-chips" }, [el("span", { class: "imp-file-chip", text: S.IMP_CHIP_TXT }), el("span", { class: "imp-file-chip", text: S.IMP_CHIP_CSV })]),
      el("p", { class: "imp-or" }, [el("span", { text: S.IMP_OR }), paste]),
    ];
  }

  // The whole dashed zone is the file button (and a drop target on the web).
  const zone = el(
    "div",
    {
      class: `imp-drop ${state.dragging ? "is-over" : ""}`,
      role: "button",
      tabindex: "0",
      "aria-label": S.IMP_DROPZONE_TITLE,
      "aria-busy": state.reading ? "true" : undefined,
      "data-fk": "imp-drop",
    },
    inner
  );
  const pick = () => !state.reading && fileInput.click();
  zone.addEventListener("click", pick);
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick();
    }
  });
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!state.dragging) h.onDrag(true);
  });
  zone.addEventListener("dragleave", (e) => {
    if (!zone.contains(e.relatedTarget)) h.onDrag(false);
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    h.onDrag(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) h.onFile(file);
  });

  return card([
    el("div", { class: "imp-row" }, [
      stepPill(state.isNew ? 2 : 1),
      el("h2", { class: "imp-card-title grow", text: S.IMP_UPLOAD_CARD }),
      el("span", { class: "imp-size-chip", text: S.IMP_SIZE_CHIP }),
    ]),
    zone,
    fileInput,
    state.readError || state.tooLarge ? el("p", { class: "imp-error", role: "alert", text: state.tooLarge ? S.IMP_FILE_TOO_LARGE : S.IMP_READ_ERROR }) : null,
  ]);
}

export function cheatSheetCard(state, h) {
  const txt = state.sampleFormat === SAMPLE_FORMATS.TXT;
  const example = txt ? S.IMP_FORMAT_TXT_EXAMPLE : S.IMP_FORMAT_CSV_EXAMPLE;
  const tabs = el(
    "div",
    { class: "imp-seg", role: "tablist", "aria-label": S.IMP_CHEAT_TITLE },
    [
      [SAMPLE_FORMATS.TXT, S.IMP_CHEAT_TXT_TAB],
      [SAMPLE_FORMATS.CSV, S.IMP_CHEAT_CSV_TAB],
    ].map(([format, label]) => {
      const on = format === state.sampleFormat;
      const tab = el("button", { type: "button", role: "tab", class: `imp-seg-btn ${on ? "on" : ""}`, "aria-selected": String(on), "data-fk": `imp-fmt-${format}`, text: label });
      tab.addEventListener("click", () => h.onFormat(format));
      return tab;
    })
  );

  const copy = el("button", { type: "button", class: "imp-code-copy", "aria-label": S.IMP_SAMPLE_COPY, title: S.IMP_SAMPLE_COPY }, [icon("copy", "icon icon-sm")]);
  copy.addEventListener("click", () => h.onCopySample(example));

  const codeLines = example.split("\n").map((line, index) => {
    if (!txt && index > 0) {
      const cut = line.lastIndexOf(",");
      return el("div", { class: "imp-code-line" }, [line.slice(0, cut + 1), el("b", { class: "is-correct", text: line.slice(cut + 1) })]);
    }
    const correct = txt && line.trimEnd().endsWith("*");
    return el("div", { class: `imp-code-line ${correct ? "is-correct" : ""}`, text: line || " " });
  });

  return card([
    el("div", { class: "imp-row" }, [el("h2", { class: "imp-card-title grow", text: S.IMP_CHEAT_TITLE }), el("span", { class: "imp-tag", text: S.IMP_CHEAT_TAG })]),
    tabs,
    el(
      "p",
      { class: "imp-rule" },
      txt ? [S.IMP_CHEAT_TXT_RULE_A, el("b", { class: "imp-accent", text: S.IMP_CHEAT_STAR }), S.IMP_CHEAT_TXT_RULE_B] : [S.IMP_CHEAT_CSV_RULE]
    ),
    el("div", { class: "imp-code" }, [
      el("div", { class: "imp-code-head" }, [
        el("span", { class: "grow", text: txt ? S.IMP_SAMPLE_HEADER_TXT : S.IMP_SAMPLE_HEADER_CSV }),
        el("span", { class: "is-correct", text: t(S.IMP_SAMPLE_COUNT, { n: 2 }) }),
        copy,
      ]),
      el("div", { class: "imp-code-body" }, codeLines),
    ]),
  ]);
}

export function templateCard(state, h) {
  const chips = SAMPLE_QUESTION_TYPES.map((type) => {
    const on = state.sampleTypes.includes(type);
    const chip = el("button", { type: "button", class: `imp-type-toggle ${on ? "on" : ""}`, "aria-pressed": String(on), "data-fk": `imp-type-${type}`, text: TYPE_LABEL[type]() });
    chip.addEventListener("click", () => h.onSampleType(type));
    return chip;
  });
  const download = el("button", { type: "button", class: "imp-download", "data-fk": "imp-download" }, [
    glyph("fileDown", 18),
    t(S.IMP_TEMPLATE_DOWNLOAD, { ext: `.${state.sampleFormat}` }),
  ]);
  download.addEventListener("click", h.onDownloadSample);
  return card(
    [
      el("div", { class: "imp-row" }, [
        accentCircle(glyph("fileDown")),
        el("div", {}, [el("h2", { class: "imp-card-title", text: S.IMP_TEMPLATE_TITLE }), el("p", { class: "imp-sub", text: S.IMP_TEMPLATE_SUB })]),
      ]),
      el("p", { class: "imp-section-label", text: S.IMP_TEMPLATE_TYPES }),
      el("div", { class: "imp-type-toggles" }, chips),
      download,
    ],
    "imp-template"
  );
}

// ── Step 2: review ────────────────────────────────────────────────────────

export function reviewTitleCard(state, h) {
  const editing = state.titleEditing || state.titleError;
  const toggle = el("button", { type: "button", class: `imp-icon-btn ${editing ? "is-on" : ""}`, "aria-label": S.IMP_EDIT_TITLE, title: S.IMP_EDIT_TITLE }, [icon(editing ? "check" : "pencil", "icon icon-sm")]);
  toggle.addEventListener("click", () => h.onTitleEditing(!editing));
  let body;
  if (editing) {
    body = el("input", { class: "imp-review-title-input", type: "text", value: state.title, maxlength: String(state.limits.maxQuizTitleChars), placeholder: S.IMP_TITLE_PLACEHOLDER, "aria-label": S.IMP_TITLE_CARD, "data-fk": "imp-review-title" });
    body.addEventListener("input", () => h.onTitle(body.value));
    body.addEventListener("keydown", (e) => {
      if (e.key === "Enter") h.onTitleEditing(false);
    });
  } else {
    body = el("p", { class: `imp-review-title ellipsis ${state.title.trim() ? "" : "is-placeholder"}`, dir: "auto", text: state.title.trim() || S.IMP_TITLE_PLACEHOLDER });
  }
  return el("div", {}, [
    card([el("p", { class: "imp-label-accent", text: S.IMP_REVIEW_TITLE_LABEL }), el("div", { class: "imp-row" }, [el("div", { class: "grow imp-min0" }, [body]), toggle])], `imp-review-title-card ${state.titleError ? "is-error" : ""}`),
    state.titleError ? el("p", { class: "imp-error imp-error-out", text: S.IMP_TITLE_REQUIRED }) : null,
  ]);
}

export function fileRow(state, h) {
  const remove = el("button", { type: "button", class: "imp-link", text: S.IMP_REMOVE_FILE });
  remove.addEventListener("click", h.onRemoveFile);
  return el("div", { class: "imp-file-row" }, [
    el("span", { class: "imp-file-icon", "aria-hidden": "true" }, [glyph("file", 18)]),
    el("b", { class: "grow ellipsis", text: state.fileName }),
    remove,
  ]);
}

export function summaryRow(parsed) {
  return el("div", { class: "imp-summary-row" }, [
    el("span", { class: "imp-dot is-good", "aria-hidden": "true" }),
    el("b", { text: t(S.IMP_READY_COUNT, { n: parsed.questions.length }) }),
    el("span", { class: "imp-dot is-muted", "aria-hidden": "true" }),
    el("span", { class: "imp-muted", text: t(S.IMP_SKIPPED_COUNT, { n: parsed.skipped.length }) }),
    el("span", { class: "grow" }),
    parsed.questions.length >= 2 ? el("span", { class: "imp-hint", text: S.IMP_REORDER_HINT }) : null,
  ]);
}

export function skippedCard(skipped) {
  return card(
    [
      el("h3", { class: "imp-skipped-title", text: S.IMP_SKIPPED_TITLE }),
      ...skipped.map((row) => el("p", { class: "imp-skipped-line", text: t(S.IMP_SKIPPED_LINE, { line: row.sourceLine, reason: ISSUE_LABEL[row.issue]() }) })),
    ],
    "imp-skipped"
  );
}

function typeChip(type) {
  const label = type === SINGLE_CHOICE ? S.IMP_TYPE_SINGLE_CHIP : TYPE_LABEL[type]();
  return el("span", { class: `imp-type-chip t-${type.toLowerCase()}` }, [el("i", { "aria-hidden": "true" }), label]);
}

function action(iconName, label, onClick, enabled = true) {
  const btn = el("button", { type: "button", class: "imp-card-action", "aria-label": label, title: label, disabled: !enabled }, [icon(iconName)]);
  btn.addEventListener("click", onClick);
  return btn;
}

function optionRow(option, { showTag, editable = false, onText, onToggle, fixedText = false }) {
  const mark = el(onToggle ? "button" : "span", { class: "imp-opt-mark", type: onToggle ? "button" : undefined, "aria-label": onToggle ? S.IMP_MARK_CORRECT : undefined, "aria-pressed": onToggle ? String(option.correct) : undefined }, [
    option.correct ? icon("check", "icon") : null,
  ]);
  if (onToggle) mark.addEventListener("click", onToggle);
  let text;
  if (editable && !fixedText) {
    text = el("input", { class: "imp-opt-input", type: "text", value: option.text, placeholder: S.IMP_OPTION_PLACEHOLDER, "aria-label": S.IMP_OPTION_PLACEHOLDER, "data-fk": `opt-${option.key}` });
    text.addEventListener("input", () => onText(text.value));
  } else {
    text = el("span", { class: "imp-opt-text", dir: "auto", text: option.text });
  }
  return el("div", { class: `imp-opt ${option.correct ? "is-correct" : ""} ${editable ? "is-editable" : ""}` }, [
    mark,
    text,
    option.correct && showTag ? el("span", { class: "imp-correct-tag", text: S.IMP_CORRECT_TAG }) : null,
  ]);
}

export function questionCard(question, index, total, h) {
  return card(
    [
      el("div", { class: "imp-row imp-q-head" }, [
        typeChip(question.type),
        el("span", { class: "imp-line grow", text: t(S.IMP_LINE_NUMBER, { n: question.sourceLine }) }),
        action("chevron-up", S.IMP_MOVE_UP, () => h.onMove(question.sourceLine, -1), index > 0),
        action("chevron-down", S.IMP_MOVE_DOWN, () => h.onMove(question.sourceLine, 1), index < total - 1),
        el("span", { class: "imp-action-sep", "aria-hidden": "true" }),
        action("pencil", S.IMP_EDIT_QUESTION, () => h.onEdit(question.sourceLine)),
        action("trash", S.IMP_DELETE_QUESTION, () => h.onDelete(question.sourceLine)),
      ]),
      el("p", { class: "imp-q-text", dir: "auto", text: question.text }),
      el("div", { class: "imp-opts" }, question.options.map((o) => optionRow(o, { showTag: question.type !== MULTIPLE_CORRECT }))),
    ],
    "imp-q"
  );
}

export function editableCard(draft, h) {
  const text = el("textarea", { class: "imp-q-input", rows: "2", placeholder: S.IMP_QUESTION_PLACEHOLDER, "aria-label": S.IMP_QUESTION_PLACEHOLDER, "data-fk": "imp-edit-text" });
  text.value = draft.text;
  text.addEventListener("input", () => h.onDraftText(text.value));
  const cancel = el("button", { type: "button", class: "imp-text-btn", text: S.IMP_EDIT_CANCEL });
  cancel.addEventListener("click", h.onEditCancel);
  const save = el("button", { type: "button", class: "imp-pill-btn", "data-fk": "imp-edit-save", text: S.IMP_EDIT_SAVE });
  save.addEventListener("click", h.onEditSave);
  return card(
    [
      el("div", { class: "imp-row imp-q-head" }, [typeChip(draft.type), el("span", { class: "imp-line grow", text: t(S.IMP_LINE_NUMBER, { n: draft.sourceLine }) })]),
      text,
      el(
        "div",
        { class: "imp-opts" },
        draft.options.map((o) =>
          optionRow(o, {
            showTag: draft.type !== MULTIPLE_CORRECT,
            editable: true,
            fixedText: draft.type === TRUE_FALSE,
            onText: (value) => h.onDraftOption(o.key, value),
            onToggle: () => h.onDraftToggle(o.key),
          })
        )
      ),
      draft.error ? el("p", { class: "imp-error", role: "alert", text: capitalise(ISSUE_LABEL[draft.error]()) }) : null,
      el("div", { class: "imp-edit-actions" }, [cancel, save]),
    ],
    "imp-q is-editing"
  );
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Bottom bar ────────────────────────────────────────────────────────────

export function bottomBar({ label, disabled, busy, onClick }) {
  const btn = el("button", { type: "button", class: "imp-primary", disabled, "aria-busy": busy ? "true" : undefined, "data-fk": "imp-primary" }, [
    el("span", { text: label }),
    icon("arrow-right", "icon"),
  ]);
  btn.addEventListener("click", onClick);
  return el("div", { class: "imp-bar" }, [btn]);
}
