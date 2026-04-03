/**
 * Reads theme tokens from :root (see `styles/globals.scss` + `_variables.scss`).
 * Use for Chart.js, Leaflet HTML strings, or anywhere CSS `var()` is not available.
 */
export function readAdminCssVar(name: `--${string}`, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
