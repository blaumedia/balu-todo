import type { Theme } from "@balu/domain";

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", resolveTheme(theme));
}
