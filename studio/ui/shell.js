// App shell for every signed-in page except the editor: the shared sidebar (ui/sidebar.js — the
// same one the editor draws), and beside it the beta banner, a top bar holding the page title /
// breadcrumb and the page's own actions, and the page body. The dashboard hides the top bar
// (its greeting is the header). On a phone the sidebar becomes a ☰ drawer.
//
//   const shell = mountShell(root, { user, active: "dashboard", title, crumbs, actions });
//   shell.content.replaceChildren(...)    // the page body
//   shell.setActions([...]) / shell.setTitle("…") / shell.setPendingCount(n)
//   shell.setQuota({ used, limit, maxQuestions })

import { S } from "../core/strings.js";
import { betaBar, button, el } from "./components.js";
import { buildSidebar } from "./sidebar.js";

export function mountShell(root, { user, active, title, crumbs = [], actions = [], backHref, width = "", fetchPending = true, hideTopbar = false }) {
  const nav = buildSidebar({ user, active, fetchPending });

  const titleNode = el("h1", { class: "ellipsis", text: title ?? "" });
  const crumbsNode = el("nav", { class: "crumbs", "aria-label": S.BREADCRUMB });
  const actionsNode = el("div", { class: "topbar-actions" });
  const backNode = backHref
    ? button({ label: S.BACK, icon: "arrow-left", variant: "ghost", iconOnly: true, href: backHref, cls: "topbar-back" })
    : null;

  const topbar = hideTopbar
    ? null
    : el("header", { class: "topbar" }, [backNode, el("div", { class: "topbar-title grow" }, [crumbsNode, titleNode]), actionsNode]);

  const content = el("main", { class: `page ${width ? `page-${width}` : ""}`, id: "content" });

  const shell = el("div", { class: "shell" }, [nav.sidebar, el("div", { class: "main" }, [nav.mobileBar, betaBar(), topbar, content]), nav.scrim]);
  root.replaceChildren(shell);

  const api = {
    content,
    setTitle(text) {
      titleNode.textContent = text ?? "";
      document.title = text ? `${text} — ${S.APP_NAME} ${S.STUDIO} (${S.BETA})` : `${S.APP_NAME} ${S.STUDIO} (${S.BETA})`;
    },
    setCrumbs(list) {
      crumbsNode.replaceChildren();
      list.forEach((crumb, i) => {
        if (i) crumbsNode.appendChild(el("span", { class: "sep", text: "/" }));
        crumbsNode.appendChild(
          crumb.href ? el("a", { href: crumb.href, text: crumb.label }) : el("span", { class: "ellipsis", text: crumb.label })
        );
      });
    },
    setActions(nodes) {
      actionsNode.replaceChildren(...nodes.filter(Boolean));
    },
    setPendingCount: nav.setPendingCount,
    setQuota: nav.setQuota,
  };

  api.setTitle(title);
  api.setCrumbs(crumbs);
  api.setActions(actions);
  return api;
}
