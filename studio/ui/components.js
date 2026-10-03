// Shared UI pieces for the studio pages. DOM-direct and small: el() builds nodes, and every
// piece of user text goes in through textContent — never innerHTML.

import { S } from "../core/strings.js";
import { signInWithGoogle, signInWithIdToken } from "../core/supabase.js";
import { emptyArt, googleMark, icon } from "./icons.js";

/** Escapes text destined for an HTML string. Prefer el()/textContent; this exists for the
 *  rare place a template is genuinely clearer. */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * el(tag, attrs, children)
 *  - class, text (textContent), on<event> handlers, any other attribute;
 *  - vars: { name: value } sets CSS custom properties (--name) — the one way a page passes a
 *    dynamic colour (a quiz's theme) without an inline style attribute in its code;
 *  - value / checked / disabled / selected are set as properties so they reflect live state;
 *  - false / null / undefined attributes and children are skipped.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "vars") {
      for (const [name, v] of Object.entries(value)) node.style.setProperty(`--${name}`, v);
    } else if (key === "value" || key === "checked" || key === "selected" || key === "indeterminate") {
      node[key] = value;
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? "" : String(value));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
}

/** Replaces [region]'s content and puts keyboard focus back on the same logical control
 *  (matched by data-fk), with its caret, so a re-render never yanks focus away. */
export function swap(region, ...nodes) {
  const active = document.activeElement;
  const key = active && region.contains(active) ? active.dataset?.fk : null;
  const caret =
    key && typeof active.selectionStart === "number"
      ? [active.selectionStart, active.selectionEnd]
      : null;
  region.replaceChildren(...nodes.filter(Boolean));
  if (key) {
    const next = region.querySelector(`[data-fk="${CSS.escape(key)}"]`);
    if (next) {
      next.focus({ preventScroll: true });
      if (caret && typeof next.setSelectionRange === "function") {
        try {
          next.setSelectionRange(caret[0], caret[1]);
        } catch {
          /* some input types (number) don't support selection */
        }
      }
    }
  }
}

// ── Buttons ─────────────────────────────────────────────────────────────────

/** button({ label, icon, variant: primary|secondary|ghost|soft|danger|danger-ghost|success,
 *  size: sm|lg, onClick, kbd, title, ariaLabel, iconOnly, href, disabled, type, cls }) */
export function button({
  label,
  icon: iconName,
  iconRight,
  variant = "secondary",
  size,
  onClick,
  kbd: kbdText,
  title,
  ariaLabel,
  iconOnly = false,
  href,
  disabled = false,
  cls = "",
  attrs = {},
}) {
  const classes = ["btn", `btn-${variant}`, size ? `btn-${size}` : "", iconOnly ? "btn-icon" : "", cls]
    .filter(Boolean)
    .join(" ");
  const content = [
    iconName ? icon(iconName) : null,
    iconOnly ? null : label ? el("span", { text: label }) : null,
    iconRight ? icon(iconRight) : null,
    kbdText ? kbd(kbdText) : null,
  ];
  const common = {
    class: classes,
    title: title ?? (iconOnly ? label : undefined),
    "aria-label": ariaLabel ?? (iconOnly ? label : undefined),
    ...attrs,
  };
  if (href) return el("a", { ...common, href }, content);
  return el("button", { ...common, type: "button", disabled, onclick: onClick }, content);
}

/** Shows a spinner on [btn] while [work] runs; re-enables it after. Returns work's result. */
export async function withLoading(btn, work) {
  btn.classList.add("is-loading");
  btn.disabled = true;
  try {
    return await work();
  } finally {
    btn.classList.remove("is-loading");
    btn.disabled = false;
  }
}

export function kbd(text) {
  return el("kbd", { class: "kbd", text });
}

// ── Small display pieces ────────────────────────────────────────────────────

export function pill(text, tone = "", { dot = false, pulse = false, iconName, cls = "" } = {}) {
  return el(
    "span",
    { class: `pill ${tone ? `pill-${tone}` : ""} ${dot ? "pill-dot" : ""} ${pulse ? "pill-pulse" : ""} ${cls}` },
    [iconName ? icon(iconName, "icon icon-sm") : null, text]
  );
}

export function avatar(name, { large = false } = {}) {
  const initials =
    String(name ?? "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("") || "?";
  return el("span", { class: `avatar ${large ? "avatar-lg" : ""}`, "aria-hidden": "true", text: initials });
}

export function progressBar(value, total, { label } = {}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const fill = el("div", { class: "progress-fill" });
  fill.style.width = `${pct}%`;
  return el(
    "div",
    {
      class: "progress",
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": String(total),
      "aria-valuenow": String(value),
      "aria-label": label,
    },
    [fill]
  );
}

export function emptyState({ art = "quizzes", title, body, actions = [] }) {
  return el("div", { class: "empty" }, [
    emptyArt(art),
    el("h2", { text: title }),
    body ? el("p", { text: body }) : null,
    actions.length ? el("div", { class: "row row-wrap" }, actions) : null,
  ]);
}

export function banner(message, { tone = "info", title, iconName, actions = [] } = {}) {
  const defaultIcon = { info: "info", warn: "alert", error: "alert", success: "check-circle" }[tone];
  return el("div", { class: `banner banner-${tone}`, role: tone === "error" ? "alert" : "status" }, [
    icon(iconName ?? defaultIcon),
    el("div", { class: "grow stack-sm" }, [
      title ? el("div", { class: "banner-title", text: title }) : null,
      message ? el("div", { text: message }) : null,
    ]),
    actions.length ? el("div", { class: "row" }, actions) : null,
  ]);
}

/** A labelled character counter that turns amber near the cap and red past it. */
export function counter(length, max) {
  const node = el("span", { class: "counter" });
  updateCounter(node, length, max);
  return node;
}

export function updateCounter(node, length, max) {
  node.textContent = `${length} / ${max}`;
  node.classList.toggle("is-near", length >= max * 0.85 && length <= max);
  node.classList.toggle("is-over", length > max);
}

// ── Form controls ───────────────────────────────────────────────────────────

/** A switch. onChange(checked) fires on toggle; the caller decides whether to accept it
 *  (return false from onChange to snap it back — used for "ask first" settings). */
export function switchControl({ checked, onChange, disabled = false, label, fk }) {
  const input = el("input", {
    type: "checkbox",
    role: "switch",
    checked: checked === true,
    disabled,
    "aria-label": label,
    "data-fk": fk,
  });
  input.addEventListener("change", async () => {
    const wanted = input.checked;
    const accepted = await onChange?.(wanted);
    if (accepted === false) input.checked = !wanted;
  });
  return el("span", { class: "switch" }, [input, el("span", { class: "switch-track" })]);
}

/** Segmented control: options [{ value, label, count?, iconName? }]. */
export function segmented({ options, value, onChange, label }) {
  return el(
    "div",
    { class: "seg", role: "tablist", "aria-label": label },
    options.map((option) =>
      el(
        "button",
        {
          type: "button",
          role: "tab",
          class: `seg-btn ${option.value === value ? "is-active" : ""}`,
          "aria-selected": option.value === value ? "true" : "false",
          "data-fk": `seg-${label}-${option.value}`,
          onclick: () => onChange(option.value),
        },
        [
          option.iconName ? icon(option.iconName, "icon icon-sm") : null,
          el("span", { text: option.label }),
          option.count !== undefined ? el("span", { class: "seg-count", text: String(option.count) }) : null,
        ]
      )
    )
  );
}

export function field({ label, control, hint, error, counterNode, id }) {
  return el("div", { class: "field" }, [
    label || counterNode
      ? el("div", { class: "label-row" }, [
          label ? el("label", { class: "label", for: id, text: label }) : el("span"),
          counterNode ?? null,
        ])
      : null,
    control,
    hint ? el("p", { class: "hint-text", text: hint }) : null,
    error ? el("p", { class: "field-error", text: error }) : null,
  ]);
}

// ── Clipboard ───────────────────────────────────────────────────────────────

export async function copyText(text, message = S.COPIED) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message, { tone: "success" });
    return true;
  } catch {
    toast(S.ERR_COPY_FAILED, { tone: "error" });
    return false;
  }
}

/** The share code in Space Mono with a copy button that morphs into a tick. */
export function codeChip(code) {
  const btn = el("button", { type: "button", title: S.COPY_CODE, "aria-label": S.COPY_CODE }, [icon("copy")]);
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (await copyText(code, S.CODE_COPIED)) {
      btn.replaceChildren(icon("check"));
      setTimeout(() => btn.replaceChildren(icon("copy")), 1400);
    }
  });
  return el("span", { class: "code-chip" }, [el("span", { text: code || "——" }), btn]);
}

// ── Toasts ──────────────────────────────────────────────────────────────────

function toastStack() {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = el("div", { class: "toast-stack", role: "status", "aria-live": "polite" });
    document.body.appendChild(stack);
  }
  return stack;
}

/** toast(message, { tone: success|error|info, action: { label, onClick }, duration }).
 *  Returns a function that dismisses it early. */
export function toast(message, { tone = "info", action, duration } = {}) {
  const stack = toastStack();
  while (stack.children.length >= 3) stack.firstChild.remove();
  const iconName = { success: "check-circle", error: "alert", info: "info" }[tone];
  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    if (!node.isConnected) return;
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 160);
  };
  const node = el("div", { class: `toast toast-${tone}` }, [
    icon(iconName),
    el("span", { class: "grow", text: message }),
    action
      ? el("button", {
          type: "button",
          class: "toast-action",
          text: action.label,
          onclick: () => {
            dismiss();
            action.onClick();
          },
        })
      : null,
  ]);
  stack.appendChild(node);
  timer = setTimeout(dismiss, duration ?? (action ? 5000 : 3200));
  return dismiss;
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog with a focus trap, Esc / backdrop to dismiss, and focus returned to where it
 * was. Bottom sheet on phones. Returns { close, node }.
 * content: nodes; actions: nodes; onClose(reason) runs once.
 */
export function openDialog({ title, badge, badgeTone = "warn", content = [], actions = [], wide = false, onClose, initialFocus }) {
  const previouslyFocused = document.activeElement;
  let closed = false;

  const close = (reason) => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    overlay.classList.add("is-leaving");
    setTimeout(() => overlay.remove(), 150);
    previouslyFocused?.focus?.({ preventScroll: true });
    onClose?.(reason);
  };

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close("dismiss");
    } else if (e.key === "Tab") {
      const items = [...dialog.querySelectorAll(FOCUSABLE)];
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
  };

  const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
  const dialog = el("div", { class: `dialog ${wide ? "dialog-wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-labelledby": titleId }, [
    badge ? pill(badge, badgeTone, { cls: "dialog-badge" }) : null,
    title ? el("h2", { id: titleId, text: title }) : null,
    ...[].concat(content),
    actions.length ? el("div", { class: "dialog-actions" }, actions) : null,
  ]);

  const overlay = el("div", { class: "overlay is-sheet" }, [dialog]);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close("dismiss");
  });

  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  (initialFocus?.() ?? dialog.querySelector(FOCUSABLE))?.focus();
  return { close, node: dialog };
}

/** Resolves true if confirmed. Used before every destructive or answer-leaking action. */
export function confirmDialog({ title, body, confirmLabel = S.DELETE, cancelLabel = S.CANCEL, danger = true, badge }) {
  return new Promise((resolve) => {
    let result = false;
    const confirmBtn = button({
      label: confirmLabel,
      variant: danger ? "danger" : "primary",
      onClick: () => {
        result = true;
        dlg.close("confirm");
      },
    });
    const dlg = openDialog({
      title,
      badge,
      content: body ? [el("p", { class: "dialog-body", text: body })] : [],
      actions: [button({ label: cancelLabel, variant: "secondary", onClick: () => dlg.close("cancel") }), confirmBtn],
      initialFocus: () => confirmBtn,
      onClose: () => resolve(result),
    });
  });
}

// ── Popover menu ────────────────────────────────────────────────────────────

/** Opens a menu next to [anchor]. items: { label, iconName, onSelect, danger, disabled } or
 *  "sep". Closes on outside click, Esc, scroll; arrow keys move between items. */
export function openMenu(anchor, items) {
  document.querySelector(".menu")?.remove();
  const buttons = [];
  const menu = el(
    "div",
    { class: "menu", role: "menu" },
    items.filter(Boolean).map((item) => {
      if (item === "sep") return el("div", { class: "menu-sep", role: "separator" });
      const btn = el(
        "button",
        {
          type: "button",
          role: "menuitem",
          class: `menu-item ${item.danger ? "is-danger" : ""}`,
          disabled: item.disabled === true,
          title: item.title,
          onclick: () => {
            close();
            item.onSelect();
          },
        },
        [item.iconName ? icon(item.iconName) : null, el("span", { text: item.label })]
      );
      buttons.push(btn);
      return btn;
    })
  );

  const close = () => {
    menu.remove();
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("resize", close);
    anchor.setAttribute("aria-expanded", "false");
  };
  const onOutside = (e) => {
    if (!menu.contains(e.target) && !anchor.contains(e.target)) close();
  };
  const onKey = (e) => {
    const enabled = buttons.filter((b) => !b.disabled);
    const index = enabled.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      anchor.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      enabled[(index + 1) % enabled.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      enabled[(index - 1 + enabled.length) % enabled.length]?.focus();
    } else if (e.key === "Tab") close();
  };

  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  const below = rect.bottom + 6;
  const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  anchor.setAttribute("aria-expanded", "true");

  setTimeout(() => {
    document.addEventListener("mousedown", onOutside, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
  });
  document.addEventListener("keydown", onKey, true);
  buttons.find((b) => !b.disabled)?.focus();
  return close;
}

/** An icon button that opens [items()] as a menu. items is a function so it's built fresh. */
export function menuButton(items, { label = S.MORE_ACTIONS, iconName = "more", size = "sm" } = {}) {
  const btn = button({ label, icon: iconName, variant: "ghost", iconOnly: true, size, attrs: { "aria-haspopup": "menu", "aria-expanded": "false" } });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (btn.getAttribute("aria-expanded") === "true") return;
    openMenu(btn, items());
  });
  return btn;
}

// ── Whole-page states ───────────────────────────────────────────────────────

/** Shown on every page when nobody is signed in — a prompt rather than a redirect, so
 *  someone opening a link sees what this is before being bounced to Google. */
export function renderSignInGate(container) {
  const slot = el("div", { class: "gate-signin" }, [el("div", { class: "spinner", role: "status", "aria-label": S.LOADING })]);
  container.replaceChildren(
    el("div", { class: "bare" }, [
      el("div", { class: "card gate-card anim-enter" }, [
        betaBar(),
        el("span", { class: "brand-mark", text: "Q" }),
        el("h1", { text: S.GATE_TITLE }),
        el("p", { text: S.GATE_BODY }),
        slot,
        el("p", { class: "small faint", text: S.GATE_NOTE }),
      ]),
    ])
  );
  renderGoogleSignIn(slot);
}

/** The redirect button — used locally and whenever Google's own button can't be shown. */
function redirectSignInButton() {
  return el(
    "button",
    { class: "btn btn-secondary btn-lg google-btn", type: "button", onclick: () => signInWithGoogle(window.location.href) },
    [googleMark(), el("span", { text: S.SIGN_IN })]
  );
}

/** On quizoma.com the site root serves /google-signin.js (Google Identity Services, the same
 *  sign-in the take page uses), which needs no Supabase redirect URL for /studio/. Anywhere it
 *  isn't available — the local dev server, a blocker — fall back to the redirect button. */
function renderGoogleSignIn(slot) {
  const fallback = () => slot.replaceChildren(redirectSignInButton());
  const render = () => {
    const gsi = window.QuizomaGoogleSignIn;
    if (!gsi) return fallback();
    slot.replaceChildren();
    gsi.renderButton(slot, {
      onCredential: async (credential, rawNonce) => {
        try {
          await signInWithIdToken(credential, rawNonce);
          window.location.reload();
        } catch (error) {
          console.error(error);
          toast(S.ERR_SIGN_IN_FAILED, { tone: "error" });
          fallback();
        }
      },
      onUnavailable: fallback,
    });
  };
  if (window.QuizomaGoogleSignIn) return render();
  const script = document.createElement("script");
  script.src = "/google-signin.js";
  script.onload = render;
  script.onerror = fallback;
  document.head.appendChild(script);
}

/** "Beta · Test mode" strip shown at the top of every studio page and on the sign-in card. */
export function betaBar() {
  return el("div", { class: "beta-bar", role: "note" }, [
    el("span", { class: "beta-tag", text: S.BETA }),
    el("span", { text: S.BETA_NOTE }),
  ]);
}

export function loadingBlock() {
  return el("div", { class: "center-fill" }, [el("div", { class: "spinner", role: "status", "aria-label": S.LOADING })]);
}

export function renderSpinner(container) {
  container.replaceChildren(el("div", { class: "bare" }, [el("div", { class: "spinner", role: "status", "aria-label": S.LOADING })]));
}

export function errorBlock(message, onRetry) {
  return el("div", { class: "stack anim-enter" }, [
    banner(message, { tone: "error" }),
    onRetry ? el("div", {}, [button({ label: S.RETRY, icon: "refresh", onClick: onRetry })]) : null,
  ]);
}

export function skeletonCards(count = 6, cls = "quiz-card") {
  return Array.from({ length: count }, () =>
    el("div", { class: `card ${cls} is-skeleton`, "aria-hidden": "true" }, [
      el("div", { class: "skeleton skeleton-title" }),
      el("div", { class: "skeleton skeleton-line" }),
      el("div", { class: "skeleton skeleton-line skeleton-short" }),
    ])
  );
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** "Oct 1" this year, "Oct 1, 2025" otherwise. */
export function formatDate(ms) {
  if (!ms) return "";
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function formatDateTime(ms) {
  if (!ms) return "";
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** "just now", "5 min ago", "3 h ago", then a date. */
export function timeAgo(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return S.JUST_NOW;
  if (min < 60) return S.MIN_AGO.replace("{n}", min);
  const hours = Math.round(min / 60);
  if (hours < 24) return S.HOURS_AGO.replace("{n}", hours);
  return formatDate(ms);
}

/** "1m 05s" for durations in seconds. */
export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  const rest = String(s % 60).padStart(2, "0");
  return m ? `${m}m ${rest}s` : `${s}s`;
}
