import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { RouteMeta } from "./RouteMeta";

/**
 * These assert the behaviour the SEO fix actually depends on, which is a React
 * 19 runtime guarantee rather than anything this component implements: a
 * `<title>` / `<link rel="canonical">` rendered inside a route is hoisted into
 * `<head>`, WINS over the static `<title>` already in `index.html`, and is
 * replaced (not accumulated) on navigation. If a React upgrade ever changes
 * that, per-route titles silently stop working — these tests are the tripwire.
 */

const STATIC_TITLE = "DormCheck | The verified student hub for move-in";

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/about" element={<RouteMeta title="About | DormCheck" />} />
        <Route path="/partners" element={<RouteMeta title="Partners | DormCheck" />} />
        <Route path="/marketplace" element={<RouteMeta title="Student Market | DormCheck" />} />
        <Route path="/settings" element={<p>no meta here</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const canonicals = () =>
  Array.from(document.querySelectorAll('link[rel="canonical"]')).map((l) => l.getAttribute("href"));

beforeEach(() => {
  cleanup();
  // Stand in for index.html's static tag.
  document.head.innerHTML = `<title>${STATIC_TITLE}</title>`;
});

describe("RouteMeta", () => {
  it("beats the static index.html <title>", () => {
    renderAt("/about");
    expect(document.title).toBe("About | DormCheck");
  });

  it("emits exactly one self-referencing canonical", () => {
    renderAt("/about");
    expect(canonicals()).toEqual(["https://dormcheck.com/about"]);
  });

  it("strips query params from the canonical", () => {
    renderAt("/marketplace?tab=buy-sell&utm_source=ig");
    expect(document.title).toBe("Student Market | DormCheck");
    expect(canonicals()).toEqual(["https://dormcheck.com/marketplace"]);
  });

  it("swaps rather than accumulates across navigation", () => {
    const { unmount } = renderAt("/about");
    expect(canonicals()).toEqual(["https://dormcheck.com/about"]);
    unmount();

    renderAt("/partners");
    expect(document.title).toBe("Partners | DormCheck");
    expect(canonicals()).toEqual(["https://dormcheck.com/partners"]);
  });

  it("falls back to the static title on a route that declares none", () => {
    // Auth-gated routes deliberately render no RouteMeta.
    renderAt("/settings");
    expect(document.title).toBe(STATIC_TITLE);
    expect(canonicals()).toEqual([]);
  });

  it("honours an explicit canonicalPath override", () => {
    render(
      <MemoryRouter initialEntries={["/features"]}>
        <RouteMeta title="For students | DormCheck" canonicalPath="/for-students" />
      </MemoryRouter>,
    );
    expect(canonicals()).toEqual(["https://dormcheck.com/for-students"]);
  });
});
