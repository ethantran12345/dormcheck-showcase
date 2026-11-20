import { describe, it, expect } from "vitest";
import { canonicalUrl, pageTitle, DEFAULT_TITLE, SITE_ORIGIN } from "./seo";

describe("canonicalUrl", () => {
  it("is self-referencing and absolute against the production origin", () => {
    // Never the preview/localhost host: a Vercel preview must not canonicalise
    // to itself, or the preview competes with prod in the index.
    expect(canonicalUrl("/about")).toBe("https://dormcheck.com/about");
    expect(canonicalUrl("/about").startsWith(SITE_ORIGIN)).toBe(true);
  });

  it("strips the query string — the duplicate-page bug this exists to fix", () => {
    expect(canonicalUrl("/marketplace?tab=buy-sell")).toBe("https://dormcheck.com/marketplace");
    expect(canonicalUrl("/marketplace?listing=abc-123")).toBe("https://dormcheck.com/marketplace");
    expect(canonicalUrl("/?utm_source=instagram&utm_campaign=movein")).toBe("https://dormcheck.com/");
    expect(canonicalUrl("/waitlist?school=pitt")).toBe("https://dormcheck.com/waitlist");
  });

  it("strips the hash", () => {
    expect(canonicalUrl("/partners#contact")).toBe("https://dormcheck.com/partners");
    // hash before query, and query before hash, both collapse
    expect(canonicalUrl("/partners#contact?x=1")).toBe("https://dormcheck.com/partners");
    expect(canonicalUrl("/partners?x=1#contact")).toBe("https://dormcheck.com/partners");
  });

  it("normalises trailing and duplicated slashes, but keeps the root slash", () => {
    expect(canonicalUrl("/")).toBe("https://dormcheck.com/");
    expect(canonicalUrl("/about/")).toBe("https://dormcheck.com/about");
    expect(canonicalUrl("/about///")).toBe("https://dormcheck.com/about");
    expect(canonicalUrl("//about")).toBe("https://dormcheck.com/about");
    expect(canonicalUrl("about")).toBe("https://dormcheck.com/about");
  });

  it("never emits two different canonicals for the same page", () => {
    const variants = [
      "/marketplace",
      "/marketplace/",
      "/marketplace?tab=buy-sell",
      "/marketplace?tab=buy-sell&utm_source=x",
      "/marketplace?listing=1#top",
    ];
    expect(new Set(variants.map(canonicalUrl)).size).toBe(1);
  });
});

describe("pageTitle", () => {
  it("suffixes the brand", () => {
    expect(pageTitle("Dorm Database")).toBe("Dorm Database | DormCheck");
  });

  it("keeps the homepage title as the index.html default", () => {
    // If this fails, index.html's static <title>/og:title drifted from the app.
    expect(DEFAULT_TITLE).toBe("DormCheck | The verified student hub for move-in");
  });

  it("gives every public route a distinct title", () => {
    // The defect this lane fixes: every route reported the same <title>.
    const titles = [
      DEFAULT_TITLE,
      pageTitle("For students"),
      pageTitle("For universities"),
      pageTitle("Partners"),
      pageTitle("Contact us"),
      pageTitle("Help & feedback"),
      pageTitle("About"),
      pageTitle("Dorm Database"),
      pageTitle("Local Business Portal"),
      pageTitle("Waitlist"),
      pageTitle("Privacy Policy"),
      pageTitle("Terms of Service"),
      pageTitle("Moderation Guidelines"),
      pageTitle("Open-source licenses"),
      pageTitle("Delete Your Account"),
      pageTitle("Student Market"),
    ];
    expect(new Set(titles).size).toBe(titles.length);
  });
});
