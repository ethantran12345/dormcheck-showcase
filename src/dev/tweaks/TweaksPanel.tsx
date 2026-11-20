import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  BRAND_HEX,
  BRAND_HUE,
  CONTROLS,
  accentIsOffBrand,
  deltas,
  type TweakControl,
  type TweakState,
} from "./controls";
import { applyState, buildPatch, clearState, copyText, loadState, resetDom, saveState } from "./store";

/**
 * DEV-ONLY design tweak panel.
 *
 * A decision tool, not a feature: drag a control, watch the REAL app change,
 * keep the value you like, then copy it out as a patch. It writes CSS custom
 * properties on :root and nothing else — see store.ts.
 *
 * FRAMED-FIRST. The primary way this gets used is inside Command Center's
 * iframe at 127.0.0.1:4321, so:
 *   - no `window.top` / `window.parent` access anywhere (it would throw or
 *     silently no-op cross-origin, and the panel must not depend on its embed);
 *   - no popout-window control — a `window.open` from a framed dev server is
 *     both blocked by popup heuristics and useless for judging the frame;
 *   - the panel is width-capped against the VIEWPORT it is actually in, so it
 *     stays fully reachable down to a ~320px-wide frame;
 *   - clipboard failure is expected (a cross-origin frame has no permission by
 *     default), so "Copy tokens" always falls back to a selectable textarea.
 *
 * The panel resets every tweakable variable on its own subtree, so turning the
 * radius to 0 or the density to 1.2 does not deform the controls you are using
 * to do it. Its own sizing is in px for the same reason.
 */

const PANEL_VAR_RESET: React.CSSProperties = {
  // Local restore of the shipped defaults, so the panel is immune to itself.
  ["--type-scale" as string]: "1",
  ["--radius-scale" as string]: "1",
  ["--radius-control" as string]: "12px",
  ["--radius-card" as string]: "16px",
  ["--radius-editorial" as string]: "24px",
  ["--dur-fast" as string]: "0.35s",
  ["--dur-base" as string]: "0.7s",
  ["--dur-slow" as string]: "1s",
  ["--ease" as string]: "cubic-bezier(0.22,1,0.36,1)",
  ["--reveal-distance" as string]: "1.5rem",
  ["--border" as string]: "40 10% 90%",
};

function ControlRow({
  control,
  value,
  onChange,
}: {
  control: TweakControl;
  value: number | string;
  onChange: (v: number | string) => void;
}) {
  const id = `tweak-${control.id}`;
  const changed = value !== control.def;
  const offBrand = control.id === "accentHue" && Number(value) !== BRAND_HUE;

  return (
    <div className="border-t border-stone-200 py-3 first:border-t-0">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[12.5px] font-semibold text-stone-800">
          {control.label}
        </label>
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums",
            changed ? "font-bold text-malachite-800" : "text-stone-500",
          )}
        >
          {control.kind === "select"
            ? control.options?.find((o) => o.value === value)?.label ?? String(value)
            : `${value}${control.unit ?? ""}`}
        </span>
      </div>

      {control.kind === "select" ? (
        <select
          id={id}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 w-full rounded-control border border-stone-300 bg-white px-2 py-1.5 text-[12.5px] text-stone-900"
        >
          {control.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
              {o.hint ? ` — ${o.hint}` : ""}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={Number(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="mt-2 w-full accent-malachite-800"
          aria-describedby={control.hint ? `${id}-hint` : undefined}
        />
      )}

      {offBrand && (
        <p className="mt-2 rounded-control border border-amber-500 bg-amber-50 px-2 py-1.5 text-[11px] font-bold text-amber-900">
          Off-brand. DormCheck primary is {BRAND_HEX} (hue {BRAND_HUE}°, malachite-600). Do not ship
          this without a decision that changes the brand.
        </p>
      )}
      {control.hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-[11px] leading-snug text-stone-500">
          {control.hint}
        </p>
      )}
    </div>
  );
}

export default function TweaksPanel() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TweakState>({});
  const [patch, setPatch] = useState<string | null>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "manual">("idle");
  const panelRef = useRef<HTMLElement>(null);

  // Restore on mount, before first paint of the app is judged.
  useEffect(() => {
    const restored = loadState();
    setState(restored);
    applyState(restored);
  }, []);

  const set = useCallback((id: string, v: number | string) => {
    setState((prev) => {
      const next = { ...prev, [id]: v };
      applyState(next);
      saveState(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setState({});
    resetDom();
    clearState();
    setPatch(null);
    setCopied("idle");
  }, []);

  const changed = useMemo(() => deltas(state), [state]);
  const offBrand = accentIsOffBrand(state);

  // Escape closes. Bound on the panel NODE rather than as a JSX handler on a
  // non-interactive <aside>: same behaviour, but it does not ask a landmark to
  // pretend to be a control (jsx-a11y is a blocking gate here). Scoped to the
  // panel, not window, so it cannot swallow an Escape meant for an app dialog.
  useEffect(() => {
    const el = panelRef.current;
    if (!el || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [open]);

  const doCopy = async () => {
    const text = buildPatch(state);
    setPatch(text);
    setCopied((await copyText(text)) ? "ok" : "manual");
  };

  if (!open) {
    return (
      <div className="fixed bottom-3 right-3 z-[60]" style={PANEL_VAR_RESET}>
        <Button
          type="button"
          size="sm"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls="dc-tweaks-panel"
          className="bg-stone-900 text-white shadow-overlay hover:bg-stone-800"
        >
          Tweaks
          {changed.length > 0 && (
            <span className="ml-1.5 rounded-pill bg-malachite-600 px-1.5 text-[11px] font-black text-stone-950 dark:bg-malachite-500">
              {changed.length}
            </span>
          )}
        </Button>
      </div>
    );
  }

  return (
    <aside
      id="dc-tweaks-panel"
      ref={panelRef}
      aria-label="Design tweaks (development only)"
      style={PANEL_VAR_RESET}
      // Width is capped against the viewport this document is in — inside a
      // narrow Command Center frame that is the frame's width, not the screen's.
      className="fixed bottom-3 right-3 z-[60] flex max-h-[min(78vh,560px)] w-[min(340px,calc(100vw-24px))] flex-col rounded-card border border-stone-300 bg-white text-stone-900 shadow-overlay"
    >
      <header className="flex items-center justify-between gap-2 border-b border-stone-200 px-3 py-2.5">
        <div>
          <h2 className="text-[13px] font-extrabold">Tweaks</h2>
          <p className="text-[11px] text-stone-500">
            dev only · writes CSS variables on :root
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          aria-label="Close design tweaks"
        >
          ✕
        </Button>
      </header>

      {offBrand && (
        <p className="border-b border-amber-500 bg-amber-100 px-3 py-2 text-[11.5px] font-bold text-amber-900">
          ⚠ Accent is off-brand — the app is not showing {BRAND_HEX} right now.
        </p>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-1">
        {CONTROLS.map((c) => (
          <ControlRow
            key={c.id}
            control={c}
            value={state[c.id] ?? c.def}
            onChange={(v) => set(c.id, v)}
          />
        ))}
      </div>

      <footer className="border-t border-stone-200 px-3 py-2.5">
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={doCopy} className="flex-1 bg-malachite-800 hover:bg-malachite-900 dark:bg-malachite-700 dark:hover:bg-malachite-800">
            Copy tokens{changed.length ? ` (${changed.length})` : ""}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={reset} disabled={!changed.length}>
            Reset
          </Button>
        </div>
        {patch !== null && (
          <div className="mt-2">
            <label htmlFor="dc-tweaks-patch" className="text-[11px] font-semibold text-stone-600">
              {copied === "ok"
                ? "Copied to the clipboard."
                : "Clipboard unavailable (expected in a cross-origin frame) — select and copy:"}
            </label>
            <textarea
              id="dc-tweaks-patch"
              readOnly
              value={patch}
              rows={7}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-1 w-full rounded-control border border-stone-300 bg-stone-50 p-2 font-mono text-[10.5px] leading-snug text-stone-800"
            />
          </div>
        )}
      </footer>
    </aside>
  );
}
