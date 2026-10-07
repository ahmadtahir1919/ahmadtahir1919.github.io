// The Studio's one sidebar — every signed-in page draws this same menu (ui/shell.js for the
// dashboard, bank, import, grading and results; create/builder-page.js for the editor).
//
//   Desktop: 240px, collapsible to a 72px icon rail (remembered, and the same on every page —
//            the state lives on <html> as .sb-collapsed so any page grid can follow it).
//   Phone (≤860px): a slim top bar with ☰; the same sidebar slides in from the left as a
//            drawer over a dimmed backdrop.
//
// Contents, top to bottom: brand + collapse, New quiz / import, Workspace nav, Help links,
// then theme (Light / Dark / System), the quota card and the account button.
//
//   const nav = buildSidebar({ user, active: "dashboard" });
//   container.append(nav.sidebar, nav.scrim) · mainColumn.prepend(nav.mobileBar)
//   nav.setPendingCount(n) · nav.setQuota({ used, limit, maxQuestions })

import { S, t } from "../core/strings.js";
import { displayNameOf, signOut } from "../core/auth.js";
import { fetchLimits } from "../core/limits.js";
import { listMyQuizzes } from "../core/quizzes.js";
import { displayNames, pendingMarking } from "../core/results.js";
import { route } from "../core/paths.js";
import { avatar, el, openMenu } from "./components.js";
import { icon } from "./icons.js";
import { applyPalette, applyTheme, PALETTES, storedPalette, storedTheme } from "./theme.js";

const SITE = "https://quizoma.com";
const COLLAPSE_KEY = "quizoma.studio.sidebarCollapsed";
const PHONE = window.matchMedia("(max-width: 860px)");

const NAV = [
  { key: "dashboard", href: route(""), label: () => S.NAV_DASHBOARD, iconName: "grid" },
  { key: "grading", href: route("grading/"), label: () => S.NAV_GRADING, iconName: "marking", badge: true },
  { key: "bank", href: route("bank/"), label: () => S.NAV_BANK, iconName: "book" },
];

const HELP = [
  { href: `${SITE}/how-it-works/`, label: () => S.QE_USER_GUIDE, iconName: "guide" },
  { href: `${SITE}/contact/`, label: () => S.QE_SUPPORT, iconName: "support" },
];

/** Help & FAQs and feedback are written in Studio itself, so they open in the same tab like the nav. */
const FAQ = { key: "faq", href: route("faq/"), label: () => S.QE_FAQS, iconName: "help" };

const FEEDBACK = { key: "feedback", href: route("feedback/"), label: () => S.QE_FEEDBACK, iconName: "feedback" };

const THEMES = [
  { value: "light", label: () => S.QE_THEME_LIGHT, iconName: "sun" },
  { value: "dark", label: () => S.QE_THEME_DARK, iconName: "moon" },
  { value: "", label: () => S.QE_THEME_SYSTEM, iconName: "monitor" },
];

/** The two glyphs drawn exactly as in the reference (heavier strokes than ui/icons.js). */
function glyph(paths, strokeWidth) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const attrs = { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": strokeWidth, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  svg.innerHTML = paths; // static constants below, never user text
  return svg;
}
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const IMPORT = '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/>';

/** [active]: "dashboard" | "grading" | "bank" | "feedback" | "faq" | "create" | "import" — the page being shown. */
export function buildSidebar({ user, active, fetchPending = true }) {
  const html = document.documentElement;
  const badges = [];

  const navLink = (item, { external = false } = {}) => {
    const on = !external && active === item.key;
    const badge = item.badge ? el("span", { class: "sb-count", hidden: true }) : null;
    if (badge) badges.push(badge);
    return el(
      "a",
      {
        class: `sb-navi ${on ? "on" : ""}`,
        href: item.href,
        title: item.label(),
        "aria-current": on ? "page" : undefined,
        target: external ? "_blank" : undefined,
        rel: external ? "noopener" : undefined,
      },
      [icon(item.iconName, "icon sb-ico"), el("span", { class: "sb-label", text: item.label() }), badge]
    );
  };

  // ── Theme: a segmented switch, or one cycling button in the collapsed rail ──
  const themeBtns = THEMES.map((th) =>
    el("button", { type: "button", role: "radio", "data-th": th.value, title: th.label(), onclick: () => setTheme(th.value) }, [icon(th.iconName), el("span", { text: th.label() })])
  );
  const themeCycle = el("button", { type: "button", class: "sb-theme-cycle", onclick: () => setTheme(THEMES[(themeIndex() + 1) % THEMES.length].value) });
  const themeIndex = () => Math.max(0, THEMES.findIndex((th) => th.value === storedTheme()));
  const syncTheme = () => {
    const current = THEMES[themeIndex()];
    for (const b of themeBtns) {
      const on = b.dataset.th === current.value;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
    }
    const label = t(S.THEME_CYCLE, { theme: current.label() });
    themeCycle.replaceChildren(icon(current.iconName));
    themeCycle.setAttribute("aria-label", label);
    themeCycle.setAttribute("title", label);
  };
  function setTheme(value) {
    applyTheme(value, { animate: true, remember: true });
    syncTheme();
  }
  syncTheme();

  // ── Colour palette trial: one swatch per palette in ui/palette.css ──
  const paletteBtns = PALETTES.map((p) =>
    el("button", { type: "button", role: "radio", "data-pal": p.value, title: p.name, "aria-label": p.name, style: `--sw:${p.swatch}`, onclick: () => setPalette(p.value) })
  );
  const paletteName = el("span", { class: "sb-pal-name" });
  const syncPalette = () => {
    const current = PALETTES.find((p) => p.value === storedPalette()) ?? PALETTES[0];
    for (const b of paletteBtns) {
      const on = b.dataset.pal === current.value;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
    }
    paletteName.textContent = current.name;
  };
  function setPalette(value) {
    applyPalette(value, { remember: true });
    syncPalette();
  }
  syncPalette();
  const paletteRow = el("div", { class: "sb-pal" }, [
    el("span", { class: "sb-pal-label", text: "Colour" }),
    paletteName,
    el("div", { class: "sb-pal-sw", role: "radiogroup", "aria-label": "Colour" }, paletteBtns),
  ]);

  // ── Account ──
  const name = displayNameOf(user) || user?.email || "";
  const nameEl = el("span", { class: "sb-user-name ellipsis", text: name });
  const userBtn = el("button", { type: "button", class: "sb-user", title: name, "aria-label": `${S.ACCOUNT_MENU}: ${name}`, "aria-haspopup": "menu" }, [
    avatar(name),
    el("span", { class: "sb-user-text" }, [
      nameEl,
      user?.email && user.email !== name ? el("span", { class: "sb-user-email ellipsis", text: user.email }) : null,
    ]),
    icon("chevron-up", "icon sb-user-chev"),
  ]);
  // The name the app shows and lets you rename (profiles.display_name); Google's name until it arrives.
  if (user?.id) {
    displayNames([user.id])
      .then((names) => {
        const own = names.get(user.id);
        if (!own || own === name) return;
        nameEl.textContent = own;
        userBtn.title = own;
        userBtn.setAttribute("aria-label", `${S.ACCOUNT_MENU}: ${own}`);
        userBtn.firstChild.replaceWith(avatar(own));
      })
      .catch(() => {});
  }
  userBtn.addEventListener("click", () => {
    userBtn.setAttribute("aria-expanded", "true");
    openMenu(userBtn, [
      {
        label: S.SIGN_OUT,
        iconName: "logout",
        onSelect: async () => {
          await signOut();
          window.location.href = route("");
        },
      },
      "sep",
      { label: S.QE_DELETE_ACCOUNT, iconName: "trash", danger: true, onSelect: () => window.open(`${SITE}/delete-account/`, "_blank", "noopener") },
    ]);
  });

  const quotaNode = el("div", { class: "sb-quota", hidden: true });

  const toggle = el("button", { type: "button", class: "sb-toggle", "aria-controls": "studio-sidebar" }, [icon("panel-left", "icon")]);
  const close = el("button", { type: "button", class: "sb-close", "aria-label": S.NAV_CLOSE_MENU, title: S.NAV_CLOSE_MENU }, [icon("x", "icon")]);
  const brand = () =>
    el("a", { class: "sb-brand", href: route(""), title: S.APP_NAME }, [
      el("span", { class: "sb-logo" }, [el("img", { src: route("ui/logo.webp"), alt: "", width: "36", height: "36" })]),
      el("div", { class: "sb-brand-text" }, [el("b", { text: S.APP_NAME }), el("span", { class: "sb-beta", text: S.BETA.toUpperCase() })]),
    ]);

  const sidebar = el("aside", { class: "sb", id: "studio-sidebar", "aria-label": S.NAV_LABEL }, [
    el("div", { class: "sb-head" }, [brand(), toggle, close]),
    el("div", { class: "sb-split" }, [
      el("a", { class: "sb-new", href: route("create/"), title: S.NEW_QUIZ, "aria-current": active === "create" ? "page" : undefined }, [glyph(PLUS, "2.5"), el("span", { class: "sb-label", text: S.NEW_QUIZ })]),
      el("span", { class: "sb-sep", "aria-hidden": "true" }),
      el("a", { class: "sb-import", href: route("import/"), title: S.IMPORT_TITLE, "aria-label": S.IMPORT_LABEL, "aria-current": active === "import" ? "page" : undefined }, [glyph(IMPORT, "2.2")]),
    ]),
    el("nav", { class: "sb-nav", "aria-label": S.NAV_SECTION }, [el("div", { class: "sb-navlabel", text: S.NAV_SECTION }), ...NAV.map((item) => navLink(item))]),
    el("nav", { class: "sb-nav sb-help", "aria-label": S.QE_HELP }, [el("div", { class: "sb-navlabel", text: S.QE_HELP }), ...HELP.slice(0, 1).map((item) => navLink(item, { external: true })), navLink(FAQ), ...HELP.slice(1).map((item) => navLink(item, { external: true })), navLink(FEEDBACK)]),
    el("div", { class: "sb-foot" }, [
      paletteRow,
      el("div", { class: "sb-theme", role: "radiogroup", "aria-label": S.QE_THEME }, themeBtns),
      themeCycle,
      quotaNode,
      userBtn,
    ]),
  ]);

  // ── Collapse (desktop) ──
  const setCollapsed = (collapsed, { remember = true } = {}) => {
    html.classList.toggle("sb-collapsed", collapsed);
    const label = collapsed ? S.EXPAND_SIDEBAR : S.COLLAPSE_SIDEBAR;
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    if (remember) {
      try {
        localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
      } catch {
        /* not remembered */
      }
    }
  };
  let collapsed = false;
  try {
    collapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    /* default open */
  }
  setCollapsed(collapsed, { remember: false });
  // A restored state shows without the slide; only a click animates.
  requestAnimationFrame(() => requestAnimationFrame(() => html.classList.add("sb-ready")));
  toggle.addEventListener("click", () => setCollapsed(!html.classList.contains("sb-collapsed")));

  // ── Drawer (phone) ──
  const burger = el("button", { type: "button", class: "sb-burger", "aria-controls": "studio-sidebar", "aria-expanded": "false", "aria-label": S.NAV_OPEN_MENU, title: S.NAV_OPEN_MENU }, [icon("menu", "icon")]);
  const mobileBar = el("header", { class: "sb-mbar" }, [
    burger,
    brand(),
    el("a", { class: "sb-mnew", href: route("create/"), "aria-label": S.NEW_QUIZ, title: S.NEW_QUIZ }, [glyph(PLUS, "2.5")]),
  ]);
  const scrim = el("div", { class: "sb-scrim", "aria-hidden": "true" });

  const isOpen = () => html.classList.contains("sb-open");
  const setOpen = (open) => {
    html.classList.toggle("sb-open", open);
    burger.setAttribute("aria-expanded", String(open));
    if (open) {
      sidebar.setAttribute("role", "dialog");
      sidebar.setAttribute("aria-modal", "true");
      requestAnimationFrame(() => close.focus());
    } else {
      sidebar.removeAttribute("role");
      sidebar.removeAttribute("aria-modal");
    }
  };
  burger.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", () => {
    setOpen(false);
    burger.focus();
  });
  scrim.addEventListener("click", () => setOpen(false));
  // Following a link (or opening a help page in a new tab) closes the drawer behind it.
  sidebar.addEventListener("click", (e) => {
    if (isOpen() && e.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      burger.focus();
    } else if (e.key === "Tab") {
      // Keep focus inside the open drawer.
      const items = [...sidebar.querySelectorAll("a[href], button:not([disabled])")].filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  // Growing past the phone width with the drawer open must not leave the page locked.
  PHONE.addEventListener("change", (e) => {
    if (!e.matches && isOpen()) setOpen(false);
  });

  // The last numbers this tab showed, so the next page draws them at once instead of blank-then-filled.
  const cacheKey = user ? `quizoma.studio.sidebar:${user.id}` : null;
  const cached = () => {
    if (!cacheKey) return null;
    try {
      return JSON.parse(sessionStorage.getItem(cacheKey) ?? "null");
    } catch {
      return null;
    }
  };
  const remember = (patch) => {
    if (!cacheKey) return;
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ ...cached(), ...patch }));
    } catch {
      // storage blocked: the sidebar simply fills in after the refresh, as before
    }
  };

  const showPending = (count) => {
    for (const badge of badges) {
      badge.hidden = !count;
      badge.textContent = count > 99 ? "99+" : String(count || "");
    }
  };
  /** The quota card: "used of limit" with a bar once a quiz exists, the allowance before. The bar
   *  grows in only the first time; a page drawing a known value shows it at its width straight away. */
  const showQuota = ({ used, limit, maxQuestions }, grow) => {
    quotaNode.hidden = false;
    if (!used) {
      quotaNode.className = "sb-quota is-empty";
      quotaNode.replaceChildren(
        el("small", {}, [S.QUOTA_EMPTY_PRE, el("b", { text: t(S.QUOTA_EMPTY_N, { n: limit }) }), t(S.QUOTA_EMPTY_POST, { q: maxQuestions })])
      );
      return;
    }
    const ratio = limit > 0 ? Math.min(1, used / limit) : 1;
    const fill = el("i");
    quotaNode.className = `sb-quota ${ratio >= 0.8 ? "is-warn" : ""}`;
    quotaNode.replaceChildren(
      el("small", {}, [el("b", { text: t(S.QUOTA_USED_OF, { used, limit }) }), S.QUOTA_USED_POST]),
      el("div", { class: "sb-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(limit), "aria-valuenow": String(used), "aria-label": S.QUOTA_LABEL }, [fill]),
      el("small", { text: S.QUOTA_HELP })
    );
    const width = `${Math.round(ratio * 100)}%`;
    if (grow) requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = width)));
    else fill.style.width = width;
  };

  const known = cached();
  if (known?.quota) showQuota(known.quota, false);
  if (known?.pending != null) showPending(known.pending);

  const api = {
    sidebar,
    mobileBar,
    scrim,
    setPendingCount(count) {
      showPending(count);
      remember({ pending: count });
    },
    setQuota(quota) {
      showQuota(quota, !cached()?.quota);
      remember({ quota });
    },
  };

  if (fetchPending && user) refresh(user, api);
  return api;
}

/** Fills the Grading badge and the quota card in the background; a failure leaves them hidden. */
async function refresh(user, api) {
  try {
    const [quizzes, limits] = await Promise.all([listMyQuizzes(user.id), fetchLimits()]);
    api.setQuota({ used: quizzes.length, limit: limits.maxQuizzes, maxQuestions: limits.maxQuestions });
    const pending = await pendingMarking(quizzes.filter((q) => !q.isDraft).map((q) => q.id));
    let total = 0;
    for (const entry of pending.values()) total += entry.answers;
    api.setPendingCount(total);
  } catch (error) {
    console.error(error);
  }
}
