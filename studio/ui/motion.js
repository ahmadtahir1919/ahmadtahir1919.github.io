// Motion helpers. Calm and quick: motion only explains what changed. Every helper becomes
// instant under prefers-reduced-motion (the CSS side collapses durations to 0 as well).

export function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Fade + rise in. [index] staggers lists 30ms per item, capped at 8 items. */
export function enter(node, index = 0) {
  if (!node || prefersReducedMotion()) return node;
  node.style.setProperty("--i", String(Math.min(index, 8)));
  node.classList.add("anim-enter");
  node.addEventListener("animationend", () => node.classList.remove("anim-enter"), { once: true });
  return node;
}

/** Applies enter() to each child of [container] with a stagger. */
export function stagger(container) {
  [...(container?.children ?? [])].forEach((child, i) => enter(child, i));
  return container;
}

/** Brief "pop" on a node whose state just changed (a mark button, a save tick). */
export function pop(node) {
  if (!node || prefersReducedMotion()) return;
  node.classList.remove("anim-pop");
  void node.offsetWidth; // restart the animation
  node.classList.add("anim-pop");
}

/** Animates [node] out, resolving once it is gone from view (does not remove it). */
export function exit(node, { duration = 160 } = {}) {
  if (!node || prefersReducedMotion() || !node.animate) return Promise.resolve();
  return node
    .animate(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "translateY(4px) scale(0.98)" },
      ],
      { duration, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" }
    )
    .finished.catch(() => {});
}

/** FLIP: records child positions keyed by data-flip, runs [mutate] (which may replace the
 *  container's children), then animates every keyed child from its old spot to its new one.
 *  Used for reordering questions. */
export function flip(container, mutate) {
  if (!container || prefersReducedMotion()) {
    mutate();
    return;
  }
  const before = new Map();
  for (const child of container.querySelectorAll("[data-flip]")) {
    before.set(child.dataset.flip, child.getBoundingClientRect());
  }
  mutate();
  for (const child of container.querySelectorAll("[data-flip]")) {
    const old = before.get(child.dataset.flip);
    if (!old) continue;
    const now = child.getBoundingClientRect();
    const dy = old.top - now.top;
    if (!dy) continue;
    child.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
      duration: 200,
      easing: "cubic-bezier(.2,.8,.2,1)",
    });
  }
}

/** Runs a DOM update inside a View Transition where supported; plain call otherwise. */
export function withViewTransition(update) {
  if (document.startViewTransition && !prefersReducedMotion()) {
    return document.startViewTransition(update);
  }
  update();
  return null;
}

/** A small confetti burst — only used when the marking queue empties and on a first publish. */
export function confetti() {
  if (prefersReducedMotion()) return;
  const colors = ["#3525cd", "#10b981", "#f59e0b", "#ec4899", "#0ea5e9", "#8b5cf6"];
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "80", overflow: "hidden" });
  document.body.appendChild(layer);
  const originX = window.innerWidth / 2;
  const originY = window.innerHeight / 3;
  for (let i = 0; i < 70; i++) {
    const bit = document.createElement("span");
    const size = 6 + Math.random() * 6;
    Object.assign(bit.style, {
      position: "absolute",
      left: `${originX}px`,
      top: `${originY}px`,
      width: `${size}px`,
      height: `${size * 0.45}px`,
      background: colors[i % colors.length],
      borderRadius: "2px",
    });
    layer.appendChild(bit);
    const angle = Math.random() * Math.PI * 2;
    const distance = 120 + Math.random() * 260;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance - 80;
    bit.animate(
      [
        { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${dx}px, ${dy + 260}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
      ],
      { duration: 1200 + Math.random() * 500, easing: "cubic-bezier(.2,.6,.4,1)", fill: "forwards" }
    );
  }
  setTimeout(() => layer.remove(), 1900);
}
