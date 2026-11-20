-- Variant grouping for Shop Essentials (`amazon_products`).
--
-- Problem: near-duplicate / size / color / quantity-pack products were seeded as separate
-- rows, so the same item shows up as several cards in the grid. A full variant model already
-- exists (`amazon_product_variations`) but was only populated for a minority of products.
--
-- This adds a NON-destructive grouping seam: a child row keeps all of its data (name, price,
-- image, affiliate link) but points at a canonical parent via `parent_id`. The grid renders
-- only parents (`parent_id IS NULL`); the parent's detail modal surfaces each child as a
-- selectable variant. Un-grouping is a single `UPDATE ... SET parent_id = NULL`.
--
-- Additive + idempotent; no data touched here (backfill is a separate data step).

alter table public.amazon_products
  add column if not exists parent_id uuid references public.amazon_products(id) on delete set null,
  add column if not exists variant_label text,
  add column if not exists variant_dimension text;

create index if not exists amazon_products_parent_id_idx
  on public.amazon_products(parent_id)
  where parent_id is not null;

comment on column public.amazon_products.parent_id is
  'Self-reference. When set, this row is a selectable variant of parent_id: hidden from the Shop Essentials grid and surfaced as a variant option in the parent''s detail modal. NULL = a standalone/parent product.';
comment on column public.amazon_products.variant_label is
  'Option label for the variant picker (e.g. "40 oz", "Slate Blue", "6-Pack"). Set on child rows; also set on the parent so its own SKU is a labeled option.';
comment on column public.amazon_products.variant_dimension is
  'Variant axis shown as the picker header: Size | Color | Count | Style | Option. Uniform per variant group.';
