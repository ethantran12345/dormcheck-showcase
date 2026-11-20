import { CONTROLS, CONTROLS_BY_ID, deltas, type TweakState } from "./controls";

/**
 * Apply / persist / export for the dev Tweaks panel.
 *
 * The ONLY thing this writes to the page is CSS custom properties on
 * `document.documentElement`. No component is forked, no class is toggled, no
 * stylesheet is injected — the app keeps rendering through the same token layer
 * it always did, and an inline property on :root simply outranks the stylesheet
 * default. That is the whole mechanism.
 *
 * DEV ONLY.
 */

const STORAGE_KEY = "dc-tweaks";

/**
 * Storage is best-effort on purpose. The primary way this panel gets used is
 * inside Command Center's iframe at 127.0.0.1:4321, which is a cross-origin
 * embed of localhost:8080 — browsers partition (and can outright block) storage
 * for a third-party frame. A panel that throws when storage is unavailable
 * would be broken in exactly its main use case, so every access is guarded and
 * the in-memory state stays authoritative.
 */
export function loadState(): TweakState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as TweakState;
    if (!parsed || typeof parsed !== "object") return {};
    // Drop anything that is not a known control, so a stale key from an older
    // build can never write an unknown custom property.
    return Object.fromEntries(Object.entries(parsed).filter(([k]) => k in CONTROLS_BY_ID));
  } catch {
    return {};
  }
}

export function saveState(state: TweakState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* partitioned or disabled storage — in-memory state still works */
  }
}

export function clearState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Write the state to :root. Anything at its default is REMOVED, not re-set, so
 *  the stylesheet value takes over again and reset is genuinely clean. */
export function applyState(state: TweakState): void {
  const root = document.documentElement;
  for (const c of CONTROLS) {
    const v = state[c.id];
    const atDefault = v === undefined || v === c.def;
    if (atDefault) {
      root.style.removeProperty(c.cssVar);
      for (const k of Object.keys(c.alsoVars?.(c.def) ?? {})) root.style.removeProperty(k);
      continue;
    }
    root.style.setProperty(c.cssVar, c.toCss(v));
    for (const [k, val] of Object.entries(c.alsoVars?.(v) ?? {})) root.style.setProperty(k, val);
  }
}

/** Remove every property this panel could have set. */
export function resetDom(): void {
  const root = document.documentElement;
  for (const c of CONTROLS) {
    root.style.removeProperty(c.cssVar);
    for (const k of Object.keys(c.alsoVars?.(c.def) ?? {})) root.style.removeProperty(k);
  }
}

/**
 * The export. This is the point of the panel: a decision you can paste.
 *
 * Emits the changed values three ways — a human-readable summary, a CSS block
 * that can go straight into `src/index.css`, and a JSON patch keyed by real
 * `tokens.json` paths where the value maps onto one, so it can be applied to
 * the canonical token file rather than retyped by hand.
 */
export function buildPatch(state: TweakState): string {
  const changed = deltas(state);
  if (!changed.length) return "No changes — everything is at its shipped token value.";

  const summary = changed.map(
    ({ control, value }) => `  ${control.label}: ${control.def}${control.unit ?? ""} → ${value}${control.unit ?? ""}   (${control.source})`,
  );

  // Include the companion properties too, or pasting the patch would reproduce
  // only half of what you were looking at when you decided.
  const css = changed.flatMap(({ control, value }) => [
    `  ${control.cssVar}: ${control.toCss(value)};`,
    ...Object.entries(control.alsoVars?.(value) ?? {}).map(([k, v]) => `  ${k}: ${v};`),
  ]);

  const json: Record<string, unknown> = {};
  for (const { control, value } of changed) {
    if (control.toTokenPatch) {
      Object.assign(json, control.toTokenPatch(value));
      continue;
    }
    if (!control.tokenPath) continue;
    json[control.tokenPath] = control.kind === "hue"
      ? { hsl: control.toCss(value), note: "hue changed in the Tweaks panel; hex needs regenerating" }
      : value;
  }

  const jsonBlock = Object.keys(json).length
    ? `\n// tokens.json patch (paths are real, apply then rebuild + npm run figma:tokens)\n${JSON.stringify(json, null, 2)}`
    : "\n// No tokens.json path for these — they live in index.css / landing tokens.ts only.";

  return [
    `/* DormCheck tweak patch — ${changed.length} value(s) changed from the shipped tokens */`,
    ...summary,
    "",
    "/* CSS — paste into the :root block in src/index.css */",
    ":root {",
    ...css,
    "}",
    jsonBlock,
  ].join("\n");
}

/** Copy helper that degrades to a textarea select when the clipboard API is
 *  unavailable — which it is in a cross-origin iframe without permission. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
