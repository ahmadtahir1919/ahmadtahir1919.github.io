// Light / Dark / System for the studio. The choice lives in localStorage "qz-theme" ("light",
// "dark", or absent for System) and is applied as data-theme on <html>; CSS does the rest.

const KEY = "qz-theme";

export function storedTheme() {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

/** Applies [theme] ("" = follow the system). With [animate], colours cross-fade for 450ms. */
export function applyTheme(theme, { animate = false, remember = false } = {}) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theming");
    clearTimeout(applyTheme._t);
    applyTheme._t = setTimeout(() => root.classList.remove("theming"), 450);
  }
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
  if (remember) {
    try {
      if (theme) localStorage.setItem(KEY, theme);
      else localStorage.removeItem(KEY);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  }
}

applyTheme(storedTheme());

// Colour palette trial (ui/palette.css): localStorage "qz-palette", applied as data-palette on
// <html>; absent = the default (Teal). Remove with the sidebar's swatch row once one is chosen.
const PALETTE_KEY = "qz-palette";

export const PALETTES = [
  { value: "", name: "Teal", swatch: "#0f766e" },
  { value: "forest", name: "Forest", swatch: "#166534" },
  { value: "terracotta", name: "Terracotta", swatch: "#c2410c" },
  { value: "graphite", name: "Graphite", swatch: "#292524" },
  { value: "indigo", name: "Indigo (old)", swatch: "#4f46e5" },
];

export function storedPalette() {
  try {
    return localStorage.getItem(PALETTE_KEY) || "";
  } catch {
    return "";
  }
}

export function applyPalette(palette, { remember = false } = {}) {
  const root = document.documentElement;
  root.classList.add("theming");
  clearTimeout(applyPalette._t);
  applyPalette._t = setTimeout(() => root.classList.remove("theming"), 450);
  if (palette) root.dataset.palette = palette;
  else delete root.dataset.palette;
  if (remember) {
    try {
      if (palette) localStorage.setItem(PALETTE_KEY, palette);
      else localStorage.removeItem(PALETTE_KEY);
    } catch {
      /* not remembered */
    }
  }
}

{
  const p = storedPalette();
  if (p) document.documentElement.dataset.palette = p;
}
