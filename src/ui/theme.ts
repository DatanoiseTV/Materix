// Theme preference: system / light / dark, persisted.

export type ThemePref = "system" | "light" | "dark";

const KEY = "materix.theme";

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function setThemePref(pref: ThemePref): void {
  if (pref === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, pref);
  applyTheme();
}

export function applyTheme(): void {
  const pref = getThemePref();
  if (pref === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
}
