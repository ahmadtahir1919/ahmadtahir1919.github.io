// App shell for every signed-in page: a sidebar on desktop (collapsible to an icon rail, the
// choice remembered), an icon rail on tablet, and a bottom tab bar on phone. The top bar holds
// the page title / breadcrumb and the page's own actions.
//
//   const shell = mountShell(root, { user, active: "dashboard", title, crumbs, actions });
//   shell.content.replaceChildren(...)    // the page body
//   shell.setActions([...]) / shell.setTitle("…") / shell.setPendingCount(n)

import { S } from "../core/strings.js";
import { displayNameOf, signOut } from "../core/supabase.js";
import { listMyQuizzes } from "../core/quizzes.js";
import { pendingMarking } from "../core/results.js";
import { avatar, betaBar, button, el, openMenu } from "./components.js";
import { icon } from "./icons.js";
import { route } from "../core/paths.js";

const COLLAPSE_KEY = "quizoma.studio.sidebarCollapsed";

const NAV = [
  { key: "dashboard", href: route(""), label: () => S.NAV_DASHBOARD, iconName: "grid" },
  { key: "grading", href: route("grading/"), label: () => S.NAV_GRADING, iconName: "marking", badge: true },
];

export function mountShell(root, { user, active, title, crumbs = [], actions = [], backHref, width = "", fetchPending = true }) {
  const collapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
  const badges = [];
  const dots = [];

  const navLink = (item) => {
    const badge = item.badge ? el("span", { class: "badge-count", hidden: true }) : null;
    const dot = item.badge ? el("span", { class: "rail-dot", hidden: true }) : null;
    if (badge) badges.push(badge);
    if (dot) dots.push(dot);
    return el(
      "a",
      {
        class: `nav-item ${active === item.key ? "is-active" : ""}`,
        href: item.href,
        title: item.label(),
        "aria-current": active === item.key ? "page" : undefined,
      },
      [icon(item.iconName), el("span", { class: "nav-label", text: item.label() }), badge, dot]
    );
  };

  const name = displayNameOf(user) || user?.email || "";
  const userBtn = el("button", { type: "button", class: "user-chip", title: name }, [
    avatar(name),
    el("span", { class: "user-chip-text" }, [
      el("span", { class: "user-chip-name ellipsis", text: name }),
      user?.email && user.email !== name ? el("span", { class: "user-chip-email ellipsis", text: user.email }) : null,
    ]),
  ]);
  userBtn.addEventListener("click", () =>
    openMenu(userBtn, [
      {
        label: S.SIGN_OUT,
        iconName: "logout",
        onSelect: async () => {
          await signOut();
          window.location.href = route("");
        },
      },
    ])
  );

  const collapseBtn = button({
    label: S.COLLAPSE_SIDEBAR,
    icon: "panel-left",
    variant: "ghost",
    iconOnly: true,
    size: "sm",
    cls: "collapse-btn",
    onClick: () => {
      const next = !shell.classList.contains("is-collapsed");
      shell.classList.toggle("is-collapsed", next);
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    },
  });

  const sidebar = el("aside", { class: "sidebar", "aria-label": S.NAV_LABEL }, [
    el("a", { class: "brand", href: route("") }, [
      el("span", { class: "brand-mark", text: "Q" }),
      el("span", { class: "brand-text" }, [
        el("span", { class: "brand-name", text: S.APP_NAME }),
        el("span", { class: "brand-sub" }, [S.STUDIO, el("span", { class: "beta-tag", text: S.BETA })]),
      ]),
    ]),
    el("a", { class: `btn btn-primary nav-new ${active === "create" ? "is-active" : ""}`, href: route("create/"), title: S.NEW_QUIZ }, [
      icon("plus"),
      el("span", { class: "nav-label", text: S.NEW_QUIZ }),
    ]),
    el("nav", { class: "stack-sm" }, NAV.map(navLink)),
    el("div", { class: "sidebar-foot" }, [collapseBtn, userBtn]),
  ]);

  const titleNode = el("h1", { class: "ellipsis", text: title ?? "" });
  const crumbsNode = el("nav", { class: "crumbs", "aria-label": S.BREADCRUMB });
  const actionsNode = el("div", { class: "topbar-actions" });
  const backNode = backHref
    ? button({ label: S.BACK, icon: "arrow-left", variant: "ghost", iconOnly: true, href: backHref, cls: "topbar-back" })
    : null;

  const topbar = el("header", { class: "topbar" }, [
    backNode,
    el("div", { class: "topbar-title grow" }, [crumbsNode, titleNode]),
    actionsNode,
  ]);

  const content = el("main", { class: `page ${width ? `page-${width}` : ""}`, id: "content" });

  const tabbar = el("nav", { class: "tabbar", "aria-label": S.NAV_LABEL }, [
    tabLink("dashboard", route(""), S.NAV_DASHBOARD, "grid"),
    el("a", { class: `tab-item tab-new ${active === "create" ? "is-active" : ""}`, href: route("create/") }, [
      el("span", { class: "tab-new-mark" }, [icon("plus")]),
      el("span", { text: S.NAV_NEW }),
    ]),
    tabLink("grading", route("grading/"), S.NAV_GRADING, "marking", true),
  ]);

  function tabLink(key, href, label, iconName, withBadge = false) {
    const badge = withBadge ? el("span", { class: "badge-count", hidden: true }) : null;
    if (badge) badges.push(badge);
    return el("a", { class: `tab-item ${active === key ? "is-active" : ""}`, href, "aria-current": active === key ? "page" : undefined }, [
      icon(iconName),
      el("span", { text: label }),
      badge,
    ]);
  }

  const shell = el("div", { class: `shell ${collapsed ? "is-collapsed" : ""}` }, [
    sidebar,
    el("div", { class: "main" }, [betaBar(), topbar, content]),
    tabbar,
  ]);
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
    setPendingCount(count) {
      for (const badge of badges) {
        badge.hidden = !count;
        badge.textContent = count > 99 ? "99+" : String(count || "");
      }
      for (const dot of dots) dot.hidden = !count;
    },
  };

  api.setTitle(title);
  api.setCrumbs(crumbs);
  api.setActions(actions);
  if (fetchPending && user) refreshPendingBadge(user, api);
  return api;
}

/** Fills the Grading badge in the background; a failure just leaves it hidden. */
async function refreshPendingBadge(user, api) {
  try {
    const quizzes = await listMyQuizzes(user.id);
    const pending = await pendingMarking(quizzes.filter((q) => !q.isDraft).map((q) => q.id));
    let total = 0;
    for (const entry of pending.values()) total += entry.answers;
    api.setPendingCount(total);
  } catch (error) {
    console.error(error);
  }
}
