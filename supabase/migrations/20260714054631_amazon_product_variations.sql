-- Shop Essentials product variations (color / size / count options shown in the detail modal).
-- One amazon_products row can have N variants; items with no real Amazon variants get a
-- small synthesized fallback set (is_synthetic = true) so every product has something to pick.
-- Read policy mirrors amazon_products (public read, admin-only writes).

create table if not exists public.amazon_product_variations (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.amazon_products(id) on delete cascade,
  dimension      text not null default 'Option',   -- variant axis: Size / Color / Count / Style / Option
  label          text not null,                     -- e.g. "Queen", "Black", "6-Pack"
  price          numeric,                           -- variant-specific price (nullable; falls back to product price)
  image_url      text,                              -- variant-specific image (nullable; falls back to product image)
  affiliate_link text not null,                     -- per-variant ASIN link, or the base product link for synthesized
  asin           text,                              -- variant ASIN when real (null for synthesized)
  is_synthetic   boolean not null default false,    -- true = generated fallback, not a real distinct SKU
  position       integer not null default 0,        -- display order within the product
  created_at     timestamptz not null default now()
);

create index if not exists amazon_product_variations_product_id_idx
  on public.amazon_product_variations (product_id, position);

-- Guard against inserting the same real variant ASIN twice under one product.
create unique index if not exists amazon_product_variations_product_asin_uidx
  on public.amazon_product_variations (product_id, asin)
  where asin is not null;

alter table public.amazon_product_variations enable row level security;

create policy "Anyone can view amazon product variations"
  on public.amazon_product_variations for select
  using (true);

create policy "Only admins can insert amazon product variations"
  on public.amazon_product_variations for insert
  with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true));

create policy "Only admins can update amazon product variations"
  on public.amazon_product_variations for update
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true));

create policy "Only admins can delete amazon product variations"
  on public.amazon_product_variations for delete
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true));
