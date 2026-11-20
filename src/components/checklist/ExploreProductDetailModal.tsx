import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Package, Plus, Star, Truck } from "lucide-react";
import { toast } from 'sonner';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useAnalytics } from "@/hooks/useAnalytics";
import { getProvider } from "@/lib/products/provider";
import { supabase } from "@/integrations/supabase/client";
import type { ExploreProduct } from "@/types/exploreProduct";
import { AMAZON_PRODUCTS_QUERY_KEY, useAmazonProductsForModal } from "@/hooks/useAmazonProducts";
import { useProductVariations } from "@/hooks/useProductVariations";

function formatReviewCount(n: number): string {
  return n.toLocaleString("en-US");
}

function updateProductHeartsInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  productId: string,
  delta: number
) {
  queryClient.setQueryData<ExploreProduct[]>(AMAZON_PRODUCTS_QUERY_KEY, (prev) =>
    (prev ?? []).map((p) =>
      p.id === productId
        ? {
            ...p,
            hearts: Math.max((p.hearts ?? 0) + delta, 0),
          }
        : p
    )
  );
}

export interface ExploreProductDetailModalProps {
  product: ExploreProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savedNames: ReadonlySet<string>;
  setSavedNames: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** Badge honesty: parent caps "Trending" to genuinely top items; defaults to the raw DB flag. */
  showTrendingBadge?: boolean;
}

export function ExploreProductDetailModal({
  product,
  open,
  onOpenChange,
  savedNames,
  setSavedNames,
  showTrendingBadge,
}: ExploreProductDetailModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { track } = useAnalytics();
  const queryClient = useQueryClient();
  const { data: products = [] } = useAmazonProductsForModal();
  const [imageLoadErrors, setImageLoadErrors] = useState<Set<string>>(() => new Set());

  const detailProduct = useMemo((): ExploreProduct | null => {
    if (!product) return null;
    const fromCache = products.find((p) => p.id === product.id);
    return fromCache ?? product;
  }, [product, products]);

  const { data: variations = [] } = useProductVariations(detailProduct?.id, open);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  // Reset the chosen variant whenever the modal switches to a different product.
  useEffect(() => {
    setSelectedVariantId(null);
  }, [detailProduct?.id]);

  const selectedVariant = useMemo(
    () => variations.find((v) => v.id === selectedVariantId) ?? null,
    [variations, selectedVariantId]
  );

  // Variant price/image are usually null → fall back to the parent product.
  const effectiveImageUrl = selectedVariant?.imageUrl ?? detailProduct?.imageUrl ?? null;

  // Gallery: base photo + extra angle photos from the Amazon listing. When a variant is
  // chosen its image leads so the user sees the exact SKU they picked.
  const baseGallery = useMemo(() => {
    const urls: string[] = [];
    const push = (u: string | null | undefined) => {
      if (u && u.trim() && !urls.includes(u)) urls.push(u);
    };
    push(detailProduct?.imageUrl);
    (detailProduct?.imageUrls ?? []).forEach(push);
    return urls;
  }, [detailProduct?.imageUrl, detailProduct?.imageUrls]);

  const galleryImages = useMemo(() => {
    if (selectedVariant?.imageUrl) {
      const rest = baseGallery.filter((u) => u !== selectedVariant.imageUrl);
      return [selectedVariant.imageUrl, ...rest];
    }
    return baseGallery;
  }, [baseGallery, selectedVariant?.imageUrl]);

  const [activeImageIndex, setActiveImageIndex] = useState(0);
  // Reset the active photo when the product changes or a variant is (de)selected.
  useEffect(() => {
    setActiveImageIndex(0);
  }, [detailProduct?.id, selectedVariant?.imageUrl]);

  const activeImageUrl = galleryImages[activeImageIndex] ?? galleryImages[0] ?? effectiveImageUrl;

  const effectivePrice =
    selectedVariant?.price != null
      ? `$${selectedVariant.price.toFixed(2)}`
      : detailProduct?.price ?? "";
  const effectiveAffiliateLink = selectedVariant?.affiliateLink ?? detailProduct?.affiliateLink ?? "";
  const variationDimension = variations[0]?.dimension ?? "Option";

  const toggleSaved = async (p: ExploreProduct) => {
    const isSaved = savedNames.has(p.name);

    setSavedNames((prev) => {
      const next = new Set(prev);
      if (isSaved) next.delete(p.name);
      else next.add(p.name);
      return next;
    });
    if (user?.id) {
      updateProductHeartsInCache(queryClient, p.id, isSaved ? -1 : 1);
    }
    if (!user?.id) return;
    if (isSaved) {
      const { error } = await supabase
        .from("explore_picks")
        .delete()
        .eq("user_id", user.id)
        .eq("product_name", p.name);
      if (error) {
        setSavedNames((prev) => {
          const next = new Set(prev);
          next.add(p.name);
          return next;
        });
        updateProductHeartsInCache(queryClient, p.id, 1);
        toast.error('Could not remove pick', {
          description: error.message,
        });
        return;
      }
    } else {
      // Denormalized variant snapshot so the picked SKU (e.g. "Pink") persists into
      // My Picks and the checklist even if the variation row later changes. `merge`
      // (not ignoreDuplicates) so re-saving after choosing a different variant updates
      // it; still avoids the unique-constraint (explore_picks_pkey) error.
      const pickRow = {
        user_id: user.id,
        product_name: p.name,
        variant_id: selectedVariant?.id ?? null,
        variant_label: selectedVariant?.label ?? null,
        variant_image_url: selectedVariant?.imageUrl ?? null,
        variant_affiliate_link: selectedVariant?.affiliateLink ?? null,
        variant_asin: selectedVariant?.asin ?? null,
      };
      const { error } = await supabase.from("explore_picks").upsert(pickRow, {
        onConflict: "user_id,product_name",
      });
      if (error) {
        setSavedNames((prev) => {
          const next = new Set(prev);
          next.delete(p.name);
          return next;
        });
        updateProductHeartsInCache(queryClient, p.id, -1);
        toast.error('Could not save pick', {
          description: error.message,
        });
        return;
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {product && detailProduct && (
        <DialogContent className="inset-0 m-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-h-[90vh] sm:w-full sm:max-w-6xl sm:translate-x-[-50%] sm:translate-y-[-50%] sm:flex-row sm:rounded-xl sm:border sm:border-border [&>button:last-of-type]:hidden">
          <DialogTitle className="sr-only">{detailProduct.name}</DialogTitle>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            // [&_svg]:size-5 keeps the 20px chevron off the base [&_svg]:size-4.
            className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 inline-flex h-auto min-h-[44px] items-center gap-1 rounded-full bg-card/95 py-2 pl-2 pr-3.5 text-sm font-medium text-foreground shadow-raised ring-1 ring-black/10 backdrop-blur transition-colors hover:bg-card hover:text-foreground [&_svg]:size-5"
            aria-label="Back to Shop Essentials"
          >
            <ChevronLeft className="h-5 w-5" />
            {t("common:actions.back", "Back")}
          </Button>
          {/* Image pane - fixed, never scrolls; object-contain keeps the whole product visible. */}
          <div className="flex w-full shrink-0 flex-col bg-card px-4 pt-14 pb-4 sm:w-1/2 sm:p-6">
              <div className="flex h-64 w-full items-center justify-center sm:h-[62vh]">
                {activeImageUrl && !imageLoadErrors.has(activeImageUrl) ? (
                  <img
                    src={activeImageUrl}
                    alt={detailProduct.name}
                    className="h-full w-full object-contain"
                    loading="lazy"
                    onError={() =>
                      setImageLoadErrors((prev) => {
                        const next = new Set(prev);
                        next.add(activeImageUrl);
                        return next;
                      })
                    }
                  />
                ) : (
                  <Package className="h-16 w-16 text-muted-foreground/40" strokeWidth={1.25} />
                )}
              </div>
              {galleryImages.length > 1 && (
                <div
                  className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  role="group"
                  aria-label={t("checklist:explore.productPhotos", "Product photos")}
                >
                  {galleryImages.map((url, i) => (
                    <Button
                      key={url}
                      type="button"
                      variant="ghost"
                      onClick={() => setActiveImageIndex(i)}
                      aria-label={t("checklist:explore.viewPhotoN", "View photo {{n}}", { n: i + 1 })}
                      aria-current={i === activeImageIndex ? "true" : undefined}
                      className={cn(
                        "h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border bg-card p-0 transition-colors hover:bg-card",
                        i === activeImageIndex
                          ? "border-malachite-600 ring-2 ring-malachite-600/30"
                          : "border-border hover:border-malachite-600/60"
                      )}
                    >
                      <img
                        src={url}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        className="h-full w-full object-contain"
                      />
                    </Button>
                  ))}
                </div>
              )}
            </div>
            {/* Details - the only scroll container so the image pane never crops or drifts. */}
            <div className="relative z-0 flex min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto px-4 pb-5 pt-4 sm:w-1/2 sm:px-5 sm:pb-5 sm:pt-6">
              <h3 className="text-2xl font-semibold text-foreground">{detailProduct.name}</h3>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground min-w-0">
                <span className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={cn(
                        "h-4 w-4",
                        i < Math.round(detailProduct.rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
                      )}
                    />
                  ))}
                </span>
                <span>
                  {detailProduct.rating.toFixed(1)} ({formatReviewCount(detailProduct.reviews)})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                {(showTrendingBadge ?? detailProduct.trending) && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    Trending
                  </span>
                )}
                <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                  {detailProduct.category}
                </span>
              </div>
              <p className="text-3xl font-semibold text-foreground">{effectivePrice}</p>
              {variations.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium text-foreground">{variationDimension}</p>
                  <Select
                    value={selectedVariantId ?? undefined}
                    onValueChange={(id) => setSelectedVariantId(id)}
                  >
                    <SelectTrigger
                      className="h-auto min-h-[3rem] py-2"
                      aria-label={`Choose ${variationDimension.toLowerCase()}`}
                    >
                      <SelectValue placeholder={`Select a ${variationDimension.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {variations.map((v) => (
                        <SelectItem key={v.id} value={v.id} className="py-2">
                          <span className="flex items-center gap-3">
                            <img
                              src={v.imageUrl ?? detailProduct.imageUrl ?? ""}
                              alt=""
                              aria-hidden="true"
                              loading="lazy"
                              className="h-10 w-10 flex-shrink-0 rounded-md border border-border bg-card object-contain"
                            />
                            <span className="text-sm">{v.label}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                type="button"
                haptic="light"
                className={cn(
                  "h-11 w-full rounded-xl text-base font-semibold shadow-raised",
                  savedNames.has(detailProduct.name)
                    ? "border border-border bg-muted text-foreground hover:bg-accent"
                    : "bg-foreground text-background hover:opacity-90"
                )}
                onClick={() => void toggleSaved(detailProduct)}
                aria-label={
                  savedNames.has(detailProduct.name)
                    ? `Remove ${detailProduct.name} from My Picks`
                    : `Add ${detailProduct.name} to My Picks`
                }
              >
                {savedNames.has(detailProduct.name) ? (
                  <span className="inline-flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
                    {t("checklist:explore.addedToPicks")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Plus className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
                    {t("checklist:explore.addToMyPicks")}
                  </span>
                )}
              </Button>
              <a
                href={getProvider(detailProduct.provider).buildAffiliateUrl(effectiveAffiliateLink)}
                target="_blank"
                rel="noopener noreferrer sponsored"
                onClick={() => {
                  const partner = detailProduct.provider;
                  track("affiliate_link_clicked", {
                    partner,
                    product_id: detailProduct.id,
                    source: "product_modal",
                    variant_asin: selectedVariant?.asin ?? null,
                    variant_label: selectedVariant?.label ?? null,
                  });
                }}
                className="cursor-pointer rounded-xl border border-border bg-card p-4 shadow-raised transition-all hover:shadow-overlay"
              >
                <div className="flex items-center justify-between gap-3">
                  <img
                    src="https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg"
                    alt="Amazon"
                    className="h-6 w-auto object-contain"
                    loading="lazy"
                  />
                  <span className="text-xl font-bold text-[#FF9900]">{effectivePrice}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                    <Truck className="h-3.5 w-3.5" />
                    {t("checklist:explore.freeShippingWithPrime")}
                  </span>
                </div>
              </a>
              <p className="text-xs text-muted-foreground">
                {t("checklist:explore.affiliateDisclosure")}
              </p>
            </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
