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

// ── Quiz editor motion (design-reference/editor.html) ───────────────────────
// Every show, hide, add, remove, reorder and resize in the editor goes through these four, so
// nothing appears or disappears instantly. Values are the reference's.

/** Expand/collapse (height + opacity), or a pop (translateY(6px) scale(.98)). Sets [hidden]
 *  at the end of a hide; cancels an animation already running on the node. */
export function reveal(node, show, { pop: popIn = false } = {}) {
  if (!node) return;
  const visible = !node.hidden && node.style.display !== "none";
  if (show === visible && !node._anim) return;
  if (prefersReducedMotion() || !node.animate) {
    node.hidden = !show;
    return;
  }
  node._anim?.cancel();
  const collapsed = { opacity: 0, height: "0px", marginTop: "0px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px", overflow: "hidden" };
  if (show) {
    node.hidden = false;
    const h = node.offsetHeight;
    node._anim = node.animate(
      popIn ? [{ opacity: 0, transform: "translateY(6px) scale(.98)" }, { opacity: 1, transform: "none" }] : [collapsed, { opacity: 1, height: `${h}px`, overflow: "hidden" }],
      { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" }
    );
    node._anim.onfinish = () => (node._anim = null);
  } else {
    const h = node.offsetHeight;
    node._anim = node.animate(
      popIn ? [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(6px) scale(.98)" }] : [{ opacity: 1, height: `${h}px`, overflow: "hidden" }, collapsed],
      { duration: 200, easing: "cubic-bezier(.4,0,1,1)" }
    );
    node._anim.onfinish = () => {
      node.hidden = true;
      node._anim = null;
    };
  }
}

/** Fade + scale(.96), then collapse the height to 0; [done] runs at the end. */
export function animateOut(node, done) {
  if (!node || prefersReducedMotion() || !node.animate) {
    done();
    return;
  }
  const h = node.offsetHeight;
  const anim = node.animate(
    [
      { opacity: 1, transform: "none", height: `${h}px` },
      { opacity: 0, transform: "scale(.96)", height: `${h}px`, offset: 0.6 },
      { opacity: 0, transform: "scale(.96)", height: "0px", marginTop: "0px", marginBottom: "0px" },
    ],
    { duration: 260, easing: "cubic-bezier(.4,0,.2,1)" }
  );
  anim.onfinish = done;
}

/** FLIP reorder keyed by data-k (the question's stable id): measures the tops of [selector]
 *  children, runs [render], then animates each from its old position; new items fade in. */
export function flipKeyed(container, selector, render) {
  const before = new Map();
  container.querySelectorAll(selector).forEach((node) => before.set(node.dataset.k, node.getBoundingClientRect().top));
  render();
  if (prefersReducedMotion()) return;
  container.querySelectorAll(selector).forEach((node) => {
    const top = before.get(node.dataset.k);
    if (top === undefined) {
      node.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "ease-out" });
      return;
    }
    const d = top - node.getBoundingClientRect().top;
    if (d) node.animate([{ transform: `translateY(${d}px)` }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(.2,.8,.2,1)" });
  });
}

/** Animates [node]'s height from before to after [render], using its CSS height transition;
 *  the inline height is cleared after 340ms. Anything that changes the height (character
 *  counters included) must happen inside [render]. */
export function smooth(node, render) {
  if (prefersReducedMotion() || !node.isConnected || !node.offsetHeight) {
    render();
    return;
  }
  const h0 = node.offsetHeight;
  node.style.height = `${h0}px`;
  node.style.overflow = "hidden";
  render();
  node.style.height = "auto";
  const h1 = node.offsetHeight;
  node.style.height = `${h0}px`;
  void node.offsetHeight;
  if (h0 === h1) {
    node.style.height = "";
    node.style.overflow = "";
    return;
  }
  node.style.height = `${h1}px`;
  clearTimeout(node._st);
  node._st = setTimeout(() => {
    node.style.height = "";
    node.style.overflow = "";
  }, 340);
}

/** The editor's canvas confetti burst (skipped under reduced motion). */
export function confettiCanvas(canvas) {
  if (prefersReducedMotion() || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const W = (canvas.width = innerWidth);
  const H = (canvas.height = innerHeight);
  const cols = ["#4f46e5", "#7c74ff", "#10b981", "#f59e0b", "#e11d48", "#0ea5e9"];
  const ps = [...Array(160)].map(() => ({
    x: W / 2 + (Math.random() - 0.5) * 120,
    y: H * 0.42,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    r: Math.random() * 6 + 4,
    c: cols[(Math.random() * 6) | 0],
    a: Math.random() * 6,
    va: (Math.random() - 0.5) * 0.3,
  }));
  let t = 0;
  (function frame() {
    ctx.clearRect(0, 0, W, H);
    ps.forEach((p) => {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.a += p.va;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      ctx.restore();
    });
    if (++t < 170) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W, H);
  })();
}
