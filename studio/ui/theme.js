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
