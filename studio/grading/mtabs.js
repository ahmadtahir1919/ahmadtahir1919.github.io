// Phones (≤ 860px): the reference's bottom tab bar — Dashboard / New / Grading / More — in
// place of the ☰ top bar, on the grading pages only. More opens the shared sidebar drawer.

import { S } from "../core/strings.js";
import { route } from "../core/paths.js";
import { el } from "../ui/components.js";
import { G } from "./gx-util.js";

export function bottomTabs({ onMore }) {
  const more = el("a", { href: "#", role: "button" }, [G.tabMore(), S.GX_TAB_MORE]);
  more.addEventListener("click", (e) => {
    e.preventDefault();
    onMore();
  });
  return el("nav", { class: "mtabs", "aria-label": S.GX_TABS_LABEL }, [
    el("a", { href: route("") }, [G.tabDash(), S.NAV_DASHBOARD]),
    el("a", { href: route("create/") }, [el("span", { class: "plus" }, [G.tabPlus()]), S.GX_TAB_NEW]),
    el("a", { href: route("grading/"), class: "on", "aria-current": "page" }, [G.tabGrade(), S.NAV_GRADING]),
    more,
  ]);
}
