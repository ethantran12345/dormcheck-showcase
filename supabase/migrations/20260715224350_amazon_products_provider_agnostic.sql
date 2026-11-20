-- Provider-agnostic Shop Essentials product layer (expand step, additive + nullable).
-- Adds a retail-provider tag + neutral variant/offer stores so Amazon PA-API and a future
-- Walmart/Impact adapter plug in without a UI rewrite. RLS unchanged (public read, admin write).
-- Rollback:
--   alter table public.amazon_products drop column offers, drop column variants, drop column provider;

alter table public.amazon_products
  add column if not exists provider text not null default 'amazon',
  add column if not exists variants jsonb,
  add column if not exists offers  jsonb;

comment on column public.amazon_products.provider is
  'Retail provider backing this row (extensible union: amazon | walmart | ...). Defaults to amazon.';
comment on column public.amazon_products.variants is
  'Neutral provider-agnostic ProductVariant[] (size/color/count). Live Amazon variants still come from amazon_product_variations; this jsonb is the forward-looking denormalized store ProductProvider.getVariants reads when the table has no rows (and where non-Amazon providers store theirs).';
comment on column public.amazon_products.offers is
  'Reserved: future multi-retailer offers for one essential (same item on Amazon + Walmart). Unused today.';
