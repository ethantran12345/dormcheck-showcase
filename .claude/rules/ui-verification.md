---
description: UI verification loop — verify every UI change in the browser via Playwright MCP
paths:
  - "src/**/*.tsx"
---

# UI verification loop (Playwright MCP)

After **any** UI change, verify it in a real browser before considering the work done. This is a
standing agent loop, not a CI step — drive it with the read-only Playwright MCP tools
(`browser_navigate`, `browser_resize`, `browser_snapshot`, `browser_take_screenshot`,
`browser_console_messages`, `browser_network_requests`), which are allowlisted in
`.claude/settings.json`.

## The loop

1. **Use the running dev server at `http://localhost:8080`.** Ethan owns that server — **never
   start, stop, or restart it.** If it isn't up (navigation fails / connection refused), say so and
   stop; don't spin up your own.
2. **Check mobile first: resize to `390x844` (iPhone).** Unprefixed Tailwind classes are the
   mobile/iOS baseline (see `.claude/rules/design-system.md`), so the phone width is the source of
   truth. Then resize to a desktop width (e.g. `1280x800`) and confirm the `md:`/`lg:` overrides.
3. **Check the console for errors** (`browser_console_messages`) **and confirm the page actually
   rendered** (`browser_snapshot` shows real content, not an empty shell). A present-but-crashing
   page — route mounts, error boundary or blank body — is this repo's known failure mode; a clean
   navigation is not proof it rendered.
4. **Verify safe-area insets aren't clipped on the native shell** — content must respect
   `env(safe-area-inset-*)` (notch / home indicator) and not sit under the status bar or
   `BottomNav`.
5. **Never hard-code a hex.** Every color must map to a token per `.claude/rules/figma-mcp.md`
   (nearest `malachite-*` for greens; `malachite-800` for solid fills on light).

Report what you checked at each width and the console state. If verification surfaces a problem,
fix it and run the loop again.
