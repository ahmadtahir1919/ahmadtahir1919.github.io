// The Question Bank's smaller dialogs: Import (file vs. existing quizzes, then the quiz list),
// Export (.txt / .csv), the import result and the help card. Ports of ImportSourceSheet.kt and
// the dialogs at the bottom of QuestionBankScreen.kt.

import { dedupeForBank, saveAllToBank, stripMarkdown } from "../core/bank.js";
import { themeColor } from "../core/models.js";
import { route } from "../core/paths.js";
import { SAMPLE_FORMATS, bankExportFileName, buildBankExport } from "../core/question-file.js";
import { listMyQuizzes, questionsFor } from "../core/quizzes.js";
import { S, t } from "../core/strings.js";
import { button, el, openDialog, swap, toast } from "../ui/components.js";
import { emptyArt, icon } from "../ui/icons.js";
import { bankTypeLabel } from "./bank-views.js";
import { notice } from "./use-in-quiz.js";

/** "How to reuse questions". */
export function openHelp() {
  const dlg = openDialog({
    cls: "bk-help",
    badge: S.BANK_HELP_BADGE,
    badgeTone: "primary",
    title: S.BANK_HELP_TITLE,
    content: [emptyArt("bank"), el("p", { class: "dialog-body bk-help-body", text: S.BANK_HELP_BODY })],
    actions: [button({ label: S.BANK_HELP_OK, variant: "primary", onClick: () => dlg.close("ok") })],
  });
}

/** The bank can't take any more — named with its cap, like the app's "Question Bank is full". */
export function bankFull(limit, { importing = false } = {}) {
  notice({ badge: S.BANK_FULL_BADGE, title: S.BANK_FULL_TITLE, body: t(importing ? S.BANK_FULL_IMPORT_BODY : S.BANK_FULL_BODY, { n: limit }) });
}

function optionTile({ iconName, title, sub, onClick, fk }) {
  return el("button", { type: "button", class: "bk-option", "data-fk": fk, onclick: onClick }, [
    el("span", { class: "bk-option-ico" }, [icon(iconName)]),
    el("span", { class: "grow" }, [el("b", { text: title }), el("small", { text: sub })]),
    icon("chevron-right", "icon"),
  ]);
}

/**
 * Import Questions: step 1 picks the source; "From File" goes to /import/?target=bank, "From
 * Existing Quizzes" opens a multi-select list. Copying skips anything whose text is already in
 * the bank (or earlier in the same batch) and reports by name what was skipped.
 * opts: { user, limits, bank (current entries), onImported(count) }
 */
export function openImportSource({ user, limits, bank, onImported }) {
  const st = { step: "source", quizzes: null, questions: null, loadError: false, query: "", picked: new Set(), busy: false };
  const head = el("div", { class: "uq-head" });
  const body = el("div", { class: "uq-body" });
  const foot = el("div", { class: "uq-foot" });
  const dlg = openDialog({ cls: "uq-dialog", wide: true, content: [head, body, foot], beforeClose: () => !st.busy });
  dlg.node.setAttribute("aria-label", S.BANK_IMPORT_TITLE);

  const close = () => el("button", { type: "button", class: "btn btn-ghost btn-icon", "aria-label": S.CLOSE, title: S.CLOSE, onclick: () => !st.busy && dlg.close("cancel") }, [icon("x")]);

  function render() {
    if (st.step === "source") {
      head.replaceChildren(
        el("span", { class: "uq-mark" }, [icon("upload")]),
        el("div", { class: "grow" }, [el("h2", { text: S.BANK_IMPORT_TITLE }), el("p", { text: S.BANK_IMPORT_SUB })]),
        close()
      );
      swap(
        body,
        el("div", { class: "bk-options" }, [
          optionTile({ iconName: "file", title: S.BANK_IMPORT_FILE_TITLE, sub: S.BANK_IMPORT_FILE_BODY, fk: "imp-src-file", onClick: () => (window.location.href = route("import/?target=bank")) }),
          optionTile({ iconName: "layers", title: S.BANK_IMPORT_QUIZZES_TITLE, sub: S.BANK_IMPORT_QUIZZES_BODY, fk: "imp-src-quizzes", onClick: toQuizzes }),
        ])
      );
      foot.replaceChildren(button({ label: S.CANCEL, variant: "secondary", onClick: () => dlg.close("cancel") }));
      return;
    }

    head.replaceChildren(
      el("button", { type: "button", class: "btn btn-ghost btn-icon", "aria-label": S.BACK, title: S.BACK, disabled: st.busy, onclick: () => ((st.step = "source"), render()) }, [icon("arrow-left")]),
      el("div", { class: "grow" }, [el("h2", { text: S.BANK_IMPORT_PICK_TITLE }), el("p", { text: S.BANK_IMPORT_PICK_SUB })]),
      close()
    );

    let list;
    if (st.loadError) list = el("p", { class: "uq-empty", text: S.ERR_LOAD_FAILED });
    else if (!st.quizzes) list = el("div", { class: "uq-loading" }, [el("div", { class: "spinner", role: "status", "aria-label": S.LOADING })]);
    else if (!st.quizzes.length) list = el("p", { class: "uq-empty", text: S.BANK_IMPORT_PICK_EMPTY });
    else {
      const needle = st.query.trim().toLowerCase();
      const rows = needle ? st.quizzes.filter((q) => (q.title || S.UNTITLED_QUIZ).toLowerCase().includes(needle)) : st.quizzes;
      list = rows.length
        ? el(
            "div",
            { class: "uq-list" },
            rows.map((quiz) => {
              const on = st.picked.has(quiz.id);
              const n = st.questions.get(quiz.id)?.length ?? 0;
              return el(
                "button",
                {
                  type: "button",
                  role: "checkbox",
                  "aria-checked": on ? "true" : "false",
                  class: `uq-row is-check ${on ? "is-on" : ""}`,
                  vars: { "uq-color": themeColor(quiz.themeColorName) },
                  "data-fk": `imp-quiz-${quiz.id}`,
                  disabled: st.busy,
                  onclick: () => {
                    if (on) st.picked.delete(quiz.id);
                    else st.picked.add(quiz.id);
                    render();
                  },
                },
                [
                  el("span", { class: "uq-box" }, [icon("check", "icon")]),
                  el("span", { class: "uq-swatch", text: (quiz.title?.trim() || "?").slice(0, 1).toUpperCase() }),
                  el("span", { class: "uq-row-text" }, [
                    el("b", { class: "ellipsis", dir: "auto", text: quiz.title?.trim() || S.UNTITLED_QUIZ }),
                    el("small", { text: n === 1 ? S.BANK_QUIZ_COUNT_ONE : t(S.BANK_QUIZ_COUNT_MANY, { n }) }),
                  ]),
                ]
              );
            })
          )
        : el("p", { class: "uq-empty", text: S.BANK_NO_QUIZ_MATCHES });
    }
    const search =
      st.quizzes?.length > 5
        ? el("label", { class: "bk-search uq-search" }, [
            icon("search"),
            el("input", {
              class: "input",
              type: "search",
              value: st.query,
              placeholder: S.BANK_QUIZ_SEARCH,
              "aria-label": S.BANK_QUIZ_SEARCH,
              "data-fk": "imp-search",
              oninput: (e) => ((st.query = e.target.value), render()),
            }),
          ])
        : null;
    swap(body, search, list);

    const count = [...st.picked].reduce((sum, id) => sum + (st.questions?.get(id)?.length ?? 0), 0);
    foot.replaceChildren(
      button({ label: S.CANCEL, variant: "secondary", disabled: st.busy, onClick: () => dlg.close("cancel") }),
      button({
        label: count === 1 ? S.BANK_IMPORT_CONFIRM_ONE : t(S.BANK_IMPORT_CONFIRM_MANY, { n: count }),
        icon: "download",
        variant: "primary",
        disabled: !count || st.busy,
        cls: st.busy ? "is-loading" : "",
        onClick: confirm,
      })
    );
  }

  async function toQuizzes() {
    st.step = "quizzes";
    render();
    if (st.quizzes) return;
    try {
      const quizzes = await listMyQuizzes(user.id);
      const questions = await questionsFor(quizzes.map((q) => q.id));
      // A quiz with no questions is pointless to offer as a source.
      st.quizzes = quizzes.filter((q) => questions.get(q.id)?.length);
      st.questions = questions;
    } catch (error) {
      console.error(error);
      st.loadError = true;
    }
    render();
  }

  async function confirm() {
    if (st.busy || !st.picked.size) return;
    st.busy = true;
    render();
    const chosen = st.quizzes.filter((q) => st.picked.has(q.id)).flatMap((q) => st.questions.get(q.id) ?? []);
    const { toImport, skippedTexts } = dedupeForBank(bank, chosen);
    try {
      const result = await saveAllToBank(user.id, toImport, limits);
      st.busy = false;
      dlg.close("done");
      if (result.atCap) {
        bankFull(result.atCap, { importing: true });
        return;
      }
      onImported?.(result.saved);
      importResult(result.saved, skippedTexts);
    } catch (error) {
      console.error(error);
      st.busy = false;
      render();
      toast(S.ERR_SAVE_FAILED, { tone: "error" });
    }
  }

  render();
  return dlg;
}

/** What "import from quizzes" did: how many landed and, by name, which were duplicates. */
export function importResult(added, skippedTexts, onClose) {
  notice({
    onClose,
    badge: t(S.BANK_IMPORT_RESULT_BADGE, { n: added }),
    badgeTone: "success",
    title: S.BANK_IMPORT_RESULT_TITLE,
    body: skippedTexts.length
      ? skippedTexts.length === 1
        ? S.BANK_IMPORT_RESULT_SKIPPED_ONE
        : t(S.BANK_IMPORT_RESULT_SKIPPED_MANY, { n: skippedTexts.length })
      : S.BANK_IMPORT_RESULT_ALL,
    list: skippedTexts.map(stripMarkdown),
  });
}

/**
 * Export Question Bank: always the whole bank, never the filtered view — an export is a backup
 * of the library. Written / Poll / Fill-blank can't go into the format; the notice names them
 * once the file is down.
 */
export function openExport(bank) {
  const choose = (format) => {
    dlg.close("done");
    const out = buildBankExport(bank, format, stripMarkdown);
    if (!out.writtenCount) {
      notice({ badge: S.BANK_EXPORT_PARTIAL_BADGE, title: S.BANK_EXPORT_PARTIAL_TITLE, body: S.BANK_EXPORT_NOTHING });
      return;
    }
    download(out.content, bankExportFileName(format), format === SAMPLE_FORMATS.CSV ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8");
    toast(S.BANK_EXPORT_SAVED, { tone: "success" });
    if (out.skippedCount) {
      const types = out.skippedTypes.map(bankTypeLabel).join(", ");
      notice({
        badge: S.BANK_EXPORT_PARTIAL_BADGE,
        title: S.BANK_EXPORT_PARTIAL_TITLE,
        body: t(out.skippedCount === 1 ? S.BANK_EXPORT_PARTIAL_ONE : S.BANK_EXPORT_PARTIAL_MANY, { n: out.skippedCount, types }),
      });
    }
  };
  const dlg = openDialog({
    badge: S.BANK_EXPORT_BADGE,
    badgeTone: "primary",
    title: S.BANK_EXPORT_TITLE,
    content: [
      el("p", { class: "dialog-body", text: S.BANK_EXPORT_BODY }),
      el("div", { class: "bk-options" }, [
        optionTile({ iconName: "file", title: S.BANK_EXPORT_TXT, sub: S.BANK_EXPORT_TXT_SUB, fk: "exp-txt", onClick: () => choose(SAMPLE_FORMATS.TXT) }),
        optionTile({ iconName: "grid", title: S.BANK_EXPORT_CSV, sub: S.BANK_EXPORT_CSV_SUB, fk: "exp-csv", onClick: () => choose(SAMPLE_FORMATS.CSV) }),
      ]),
    ],
    actions: [button({ label: S.CANCEL, variant: "secondary", onClick: () => dlg.close("cancel") })],
  });
}

function download(content, fileName, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = el("a", { href: url, download: fileName, hidden: true });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
