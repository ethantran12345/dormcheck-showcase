-- Multi-angle product gallery for Shop Essentials.
-- amazon_products has a single image_url today; add an ordered array of extra angle
-- photos (front/back/detail/in-use) captured from the Amazon listing. Nullable and
-- additive: existing clients ignore it, and the UI falls back to [image_url] when empty.
-- Rollback: alter table public.amazon_products drop column image_urls;

alter table public.amazon_products
  add column if not exists image_urls text[];

comment on column public.amazon_products.image_urls is
  'Ordered extra gallery photos (angles) from the Amazon listing. Falls back to [image_url] in the UI when null/empty.';
