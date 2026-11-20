-- Variant memory: remember the specific variant (e.g. a color) a user picked in the
-- Shop Essentials detail modal, from the moment they like it through My Picks and onto
-- the checklist item. Denormalized snapshot columns (not just a variant_id FK) so the
-- pick/checklist survive a later edit or deletion of the amazon_product_variations row,
-- and reads need no join.
-- All columns nullable + additive (expand step): a like with no chosen variant keeps
-- every column null and behaves exactly as before.
-- Rollback:
--   alter table public.explore_picks
--     drop column variant_id, drop column variant_label,
--     drop column variant_image_url, drop column variant_affiliate_link,
--     drop column variant_asin;
--   alter table public.checklist_items drop column variant_label;

alter table public.explore_picks
  add column if not exists variant_id             uuid,
  add column if not exists variant_label          text,
  add column if not exists variant_image_url      text,
  add column if not exists variant_affiliate_link text,
  add column if not exists variant_asin           text;

comment on column public.explore_picks.variant_id is
  'amazon_product_variations.id the user chose (snapshot ref; not FK-enforced). Null = no specific variant.';

-- The checklist item only needs the human label to render a variant badge; the variant
-- image reuses image_url and the variant link reuses link (already-present columns).
alter table public.checklist_items
  add column if not exists variant_label text;

comment on column public.checklist_items.variant_label is
  'Chosen Shop Essentials variant label (e.g. "Pink"). Rendered as a badge; image_url/link already carry the variant image/link.';
