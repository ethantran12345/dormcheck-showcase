import { describe, expect, it } from "vitest";
import {
  AmazonProvider,
  WalmartProvider,
  StaticProvider,
  NotImplementedError,
  buildAffiliateUrl,
  detectProviderFromUrl,
  getProvider,
  mapProductRow,
} from "@/lib/products/provider";

describe("getProvider", () => {
  it("resolves the amazon adapter", () => {
    expect(getProvider("amazon")).toBe(AmazonProvider);
  });
  it("resolves the walmart adapter", () => {
    expect(getProvider("walmart")).toBe(WalmartProvider);
  });
  it("defaults to amazon for null/undefined", () => {
    expect(getProvider(null)).toBe(AmazonProvider);
    expect(getProvider()).toBe(AmazonProvider);
  });
  it("static provider is the amazon read implementation", () => {
    expect(StaticProvider.search).toBe(AmazonProvider.search);
  });
});

describe("buildAffiliateUrl (amazon)", () => {
  it("tags amazon.com links with dormcheck-20 (identical to legacy)", () => {
    expect(AmazonProvider.buildAffiliateUrl("https://amazon.com/dp/B096")).toContain("tag=dormcheck-20");
    expect(buildAffiliateUrl("https://www.amazon.com/dp/B096")).toContain("tag=dormcheck-20");
  });
  it("passes amzn.to short links through unchanged", () => {
    expect(buildAffiliateUrl("https://amzn.to/3P")).toBe("https://amzn.to/3P");
  });
  it("passes non-amazon links through unchanged", () => {
    expect(buildAffiliateUrl("https://example.com/shop")).toBe("https://example.com/shop");
  });
  it("accepts a product-shaped input", () => {
    expect(AmazonProvider.buildAffiliateUrl({ affiliateLink: "https://amazon.com/dp/X" })).toContain(
      "tag=dormcheck-20"
    );
  });
  it("accepts a variant-shaped input", () => {
    expect(AmazonProvider.buildAffiliateUrl({ url: "https://amazon.com/dp/Y" })).toContain("tag=dormcheck-20");
  });
});

describe("detectProviderFromUrl", () => {
  it("classifies amazon links", () => {
    expect(detectProviderFromUrl("https://amazon.com/dp/B0")).toBe("amazon");
    expect(detectProviderFromUrl("https://amzn.to/abc")).toBe("amazon");
  });
  it("defaults unknown links to amazon (legacy passthrough behavior)", () => {
    expect(detectProviderFromUrl("https://example.com")).toBe("amazon");
    expect(detectProviderFromUrl(null)).toBe("amazon");
  });
});

describe("WalmartProvider", () => {
  it("buildAffiliateUrl guards unsafe schemes", () => {
    expect(WalmartProvider.buildAffiliateUrl("javascript:alert(1)")).toBe("javascript:alert(1)");
  });
  it("buildAffiliateUrl returns a valid http url unchanged when no publisher id is set", () => {
    // VITE_WALMART_PUBLISHER_ID is unset in test - so no publisherId query is appended.
    expect(WalmartProvider.buildAffiliateUrl("https://walmart.com/ip/123")).toBe("https://walmart.com/ip/123");
  });
  it("reads reject with NotImplementedError", async () => {
    await expect(WalmartProvider.search()).rejects.toBeInstanceOf(NotImplementedError);
    await expect(WalmartProvider.getItem("x")).rejects.toBeInstanceOf(NotImplementedError);
    await expect(WalmartProvider.getVariants("x")).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe("mapProductRow", () => {
  const base = {
    id: "p1",
    name: "Test Sheet Set",
    price: "11.99",
    category: "Bedding",
    is_trending: true,
    image_url: "https://img/p.jpg",
    image_urls: ["https://img/a.jpg", "https://img/b.jpg"],
    affiliate_link: "https://amazon.com/dp/B0?tag=dormcheck-20",
    hearts: 4,
    rating: "4.6",
    review_count: 120,
  };

  it("defaults provider to amazon when the column is absent", () => {
    expect(mapProductRow({ ...base }).provider).toBe("amazon");
  });
  it("carries a walmart provider through", () => {
    expect(mapProductRow({ ...base, provider: "walmart" }).provider).toBe("walmart");
  });
  it("formats price and preserves gallery", () => {
    const p = mapProductRow({ ...base });
    expect(p.price).toBe("$11.99");
    expect(p.priceValue).toBe(11.99);
    expect(p.imageUrls).toEqual(["https://img/a.jpg", "https://img/b.jpg"]);
    expect(p.trending).toBe(true);
    expect(p.hearts).toBe(4);
    expect(p.rating).toBe(4.6);
    expect(p.reviews).toBe(120);
  });
  it("parses the neutral variants jsonb", () => {
    const p = mapProductRow({
      ...base,
      variants: [
        {
          id: "seed-1",
          label: "Twin XL / Navy",
          imageUrl: null,
          price: "$11.99",
          priceValue: 11.99,
          providerItemId: null,
          url: "https://amazon.com/dp/B0?tag=dormcheck-20",
        },
      ],
    });
    expect(p.variants).toHaveLength(1);
    expect(p.variants?.[0].label).toBe("Twin XL / Navy");
    expect(p.variants?.[0].url).toContain("tag=dormcheck-20");
  });
  it("leaves variants undefined when the column is empty/malformed", () => {
    expect(mapProductRow({ ...base, variants: null }).variants).toBeUndefined();
    expect(mapProductRow({ ...base, variants: [] }).variants).toBeUndefined();
    expect(mapProductRow({ ...base, variants: [{ label: "no id" }] }).variants).toBeUndefined();
  });
});
