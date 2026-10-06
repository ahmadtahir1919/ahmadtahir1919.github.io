// Create / edit one Question Bank entry in a side drawer — the app's Question Builder in bank
// mode (QuestionBuilderViewModel.bankMode). The form is the quiz builder's own (editorPane +
// questionPanel), so every type edits exactly as it does in a quiz; what changes is around it:
//  • answers are never required — a bank question has no quiz yet, so it is validated the way
//    a hand-marked quiz's question is (no correct option / written key / blank answer needed);
//  • creating counts against the bank's cap, editing never does (saveBankQuestion).

import { saveBankQuestion } from "../core/bank.js";
import { QUESTION_TYPE_ORDER } from "../core/models.js";
import { S, t } from "../core/strings.js";
import { normalizeQuestion, validateQuestion } from "../core/validate.js";
import { button, confirmDialog, el, openDialog, swap, toast } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { editorPane, fillErrors } from "../create/editor-pane.js";
import { convertType, fromForm, newForm, toForm } from "../create/form.js";
import { TYPE_META } from "../create/outline.js";
import { questionPanel } from "../create/question-panel.js";

/** No quiz behind a bank entry. The editors show everything an auto-marked quiz offers (the
 *  entry may well go into one — answer checking for a written key, say), while validation
 *  treats it like a hand-marked quiz's question, which is what makes answers optional. */
const EDIT_AS = { manualMarkingDefault: false };
const VALIDATE_AS = { manualMarkingDefault: true };

/**
 * openBankEditor({ user, limits, entry, type, onSaved(saved, isNew), onFull(limit) })
 * entry: an existing bank entry to edit, or null for a new one of [type].
 */
export function openBankEditor({ user, limits, entry = null, type = QUESTION_TYPE_ORDER[0], onSaved, onFull }) {
  const isNew = !entry;
  let form = isNew ? newForm(type) : toForm(entry);
  let dirty = false;
  let saving = false;
  let showErrors = false;

  const body = el("div", { class: "bk-drawer-body" });
  const errorsNode = el("div", { class: "bk-drawer-errors" });
  const saveBtn = button({ label: isNew ? S.BANK_SAVE : S.BANK_SAVE_CHANGES, icon: "save", variant: "primary", onClick: save });

  const ctx = {
    get: () => form,
    update: (key, change, { structural = false } = {}) => {
      change(form);
      dirty = true;
      if (structural) render();
      else if (showErrors) fillErrors(errorsNode, currentErrors());
    },
    limits,
    quiz: EDIT_AS,
  };

  const question = () => normalizeQuestion(fromForm(form));
  const currentErrors = () => validateQuestion(question(), limits, VALIDATE_AS);

  function render() {
    const { node } = editorPane({
      ctx,
      index: 0,
      total: 1,
      readOnly: false,
      errors: [],
      standalone: true,
      kicker: S.BANK_EDITOR_KICKER,
      onChangeType: changeType,
    });
    swap(
      body,
      node,
      el("section", { class: "card bk-drawer-settings" }, [el("h3", { class: "bk-drawer-h", text: S.BANK_SETTINGS }), questionPanel(ctx)])
    );
    fillErrors(errorsNode, showErrors ? currentErrors() : []);
  }

  async function changeType(next) {
    if (next === form.type) return;
    const { form: converted, losesContent } = convertType(form, next);
    if (losesContent) {
      const ok = await confirmDialog({
        title: S.CHANGE_TYPE_TITLE,
        body: t(S.CHANGE_TYPE_BODY, { type: TYPE_META[next].label() }),
        confirmLabel: S.CHANGE_TYPE_CONFIRM,
        danger: false,
      });
      if (!ok) {
        render();
        return;
      }
    }
    form = converted;
    dirty = true;
    render();
  }

  async function save() {
    if (saving) return;
    const errors = currentErrors();
    if (errors.length) {
      showErrors = true;
      fillErrors(errorsNode, errors);
      errorsNode.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      return;
    }
    saving = true;
    saveBtn.classList.add("is-loading");
    saveBtn.disabled = true;
    try {
      const result = await saveBankQuestion(user.id, question(), limits);
      if (result.atCap) {
        dlg.close("full");
        onFull?.(result.atCap);
        return;
      }
      dirty = false;
      dlg.close("saved");
      toast(isNew ? S.BANK_SAVED : S.BANK_UPDATED, { tone: "success" });
      onSaved?.(question(), isNew);
    } catch (error) {
      console.error(error);
      toast(S.ERR_SAVE_FAILED, { tone: "error" });
    } finally {
      saving = false;
      saveBtn.classList.remove("is-loading");
      saveBtn.disabled = false;
    }
  }

  const confirmDiscard = async () =>
    !dirty ||
    confirmDialog({ title: S.BANK_DISCARD_TITLE, body: S.BANK_DISCARD_BODY, confirmLabel: S.BANK_DISCARD, cancelLabel: S.BANK_KEEP_EDITING });

  const closeBtn = el("button", { type: "button", class: "btn btn-ghost btn-icon", "aria-label": S.CLOSE, title: S.CLOSE, onclick: async () => (await confirmDiscard()) && dlg.close("cancel") }, [icon("x")]);

  const dlg = openDialog({
    cls: "bk-drawer",
    overlayCls: "bk-drawer-overlay",
    content: [
      el("header", { class: "bk-drawer-head" }, [
        el("span", { class: "bk-drawer-mark" }, [icon("book")]),
        el("div", { class: "grow" }, [el("small", { text: S.BANK_TITLE }), el("h2", { text: isNew ? S.BANK_NEW_TITLE : S.BANK_EDIT_TITLE })]),
        closeBtn,
      ]),
      el("p", { class: "bk-drawer-note" }, [icon("info", "icon"), el("span", { text: S.BANK_EDITOR_NOTE })]),
      body,
      el("footer", { class: "bk-drawer-foot" }, [
        errorsNode,
        el("div", { class: "bk-drawer-buttons" }, [button({ label: S.CANCEL, variant: "secondary", onClick: async () => (await confirmDiscard()) && dlg.close("cancel") }), saveBtn]),
      ]),
    ],
    beforeClose: confirmDiscard,
    initialFocus: () => body.querySelector('[data-fk="question-text"], [data-fk="fb-title"]'),
  });
  dlg.node.setAttribute("aria-label", isNew ? S.BANK_NEW_TITLE : S.BANK_EDIT_TITLE);
  render();
  requestAnimationFrame(() => body.querySelector('[data-fk="question-text"], [data-fk="fb-title"]')?.focus());
  // Ctrl/Cmd+S saves from anywhere inside the drawer.
  dlg.node.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  });
  return dlg;
}
