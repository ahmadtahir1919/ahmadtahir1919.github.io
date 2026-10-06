// The reference's toast: fixed bottom-centre, springs up, gone after 1.8 s — or 4 s, and
// clickable, when it carries an action ({ label, fn }). One element, reused.

import { el } from "../ui/components.js";

let node = null;
let timer = null;

export function mountToast(root) {
  node = el("div", { class: "gtoast", role: "status", "aria-live": "polite" });
  root.appendChild(node);
}

export function toast(message, action) {
  if (!node) return;
  node.replaceChildren(document.createTextNode(message));
  node.classList.toggle("act", !!action);
  if (action) {
    node.appendChild(
      el("button", {
        type: "button",
        text: action.label,
        onclick: () => {
          node.classList.remove("show");
          action.fn();
        },
      })
    );
  }
  node.classList.add("show");
  clearTimeout(timer);
  timer = setTimeout(() => node.classList.remove("show"), action ? 4000 : 1800);
}
