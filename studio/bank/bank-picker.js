// "Add from Question Bank" — the quiz builder's way into the bank (the app opens its Question
// Bank in picker mode from a quiz's editor). Search + type pills + tick as many as fit; the
// builder then appends copies of them, and its own save/autosave writes them. The bank keeps
// its entries — a copy in a quiz is never the same row.

import { filterBank, listMyBank, typeFilters } from "../core/bank.js";
import { route } from "../core/paths.js";
import { S, t } from "../core/strings.js";
import { button, el, openDialog, swap } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { questionCard, toolbar } from "./bank-views.js";

/** openBankPicker({ user, room, onPick(entries) }) — room = how many more the quiz can take. */
export function openBankPicker({ user, room, onPick }) {
  const st = { all: null, loadError: false, query: "", type: null, open: new Set(), selected: [] };
  const body = el("div", { class: "uq-body bk-picker" });
  const foot = el("div", { class: "uq-foot" });

  const dlg = openDialog({
    cls: "uq-dialog",
    wide: true,
    content: [
      el("div", { class: "uq-head" }, [
        el("span", { class: "uq-mark" }, [icon("book")]),
        el("div", { class: "grow" }, [el("h2", { text: S.BANK_PICK_TITLE }), el("p", { text: S.BANK_PICK_SUB })]),
        el("button", { type: "button", class: "btn btn-ghost btn-icon", "aria-label": S.CLOSE, title: S.CLOSE, onclick: () => dlg.close("cancel") }, [icon("x")]),
      ]),
      body,
      foot,
    ],
  });
  dlg.node.setAttribute("aria-label", S.BANK_PICK_TITLE);

  const h = {
    onQuery: (value) => ((st.query = value), render()),
    onType: (type) => ((st.type = st.type === type ? null : type), render()),
    onToggleOpen: (id) => (st.open.has(id) ? st.open.delete(id) : st.open.add(id), render()),
    onToggleSelect: (id) => {
      st.selected = st.selected.includes(id) ? st.selected.filter((x) => x !== id) : [...st.selected, id];
      render();
    },
  };

  function render() {
    if (st.loadError) {
      swap(body, el("p", { class: "uq-empty", text: S.ERR_LOAD_FAILED }));
    } else if (!st.all) {
      swap(body, el("div", { class: "uq-loading" }, [el("div", { class: "spinner", role: "status", "aria-label": S.LOADING })]));
    } else if (!st.all.length) {
      swap(body, el("div", { class: "bk-nomatch" }, [el("span", { class: "bk-nomatch-ico" }, [icon("book")]), el("p", { text: S.BANK_PICK_EMPTY })]));
    } else {
      const filters = typeFilters(st.all);
      const visible = filterBank(st.all, { query: st.query, type: st.type });
      swap(
        body,
        toolbar({ query: st.query, type: st.type, filters }, h),
        visible.length
          ? el(
              "div",
              { class: "bk-picker-list" },
              visible.map((entry) => questionCard(entry, { selected: st.selected.includes(entry.id), open: st.open.has(entry.id), selectionMode: true, picker: true }, h))
            )
          : el("p", { class: "uq-empty", text: S.BANK_NO_MATCHES })
      );
    }

    const n = st.selected.length;
    const over = n > room;
    foot.replaceChildren(
      el("span", { class: `bk-picker-room ${over ? "is-over" : ""}`, text: t(S.BANK_PICK_ROOM, { n: room }) }),
      st.all && !st.all.length
        ? button({ label: S.BANK_OPEN_FULL, icon: "book", variant: "secondary", href: route("bank/") })
        : button({ label: S.CANCEL, variant: "secondary", onClick: () => dlg.close("cancel") }),
      button({
        label: n === 1 ? S.BANK_PICK_ADD_ONE : t(S.BANK_PICK_ADD, { n }),
        icon: "plus-circle",
        variant: "primary",
        disabled: !n || over,
        onClick: () => {
          const byId = new Map(st.all.map((e) => [e.id, e]));
          dlg.close("done");
          onPick(st.selected.map((id) => byId.get(id)).filter(Boolean));
        },
      })
    );
  }

  render();
  listMyBank(user.id)
    .then((all) => (st.all = all))
    .catch((error) => {
      console.error(error);
      st.loadError = true;
    })
    .finally(render);
  return dlg;
}
