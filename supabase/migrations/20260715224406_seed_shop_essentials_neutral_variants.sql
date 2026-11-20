-- Seed a few obvious neutral ProductVariant[] rows (size/color) so the provider seam and the
-- next Shop Essentials UI handoff have something to render. Keyed on name (stable), never on a
-- generated id. Variants route to the parent listing (providerItemId null) - honest placeholders,
-- not fabricated per-variant ASINs. Idempotent: overwrites variants for exactly these two rows.

-- Sheet set: colorway options on one Twin XL listing.
update public.amazon_products p
set variants = jsonb_build_array(
  jsonb_build_object('id','seed-sheet-twinxl-darkgray','label','Twin XL / Dark Gray','imageUrl',null,
    'price','$'||to_char(p.price,'FM999990.00'),'priceValue',p.price,'providerItemId',null,'url',p.affiliate_link),
  jsonb_build_object('id','seed-sheet-twinxl-white','label','Twin XL / White','imageUrl',null,
    'price','$'||to_char(p.price,'FM999990.00'),'priceValue',p.price,'providerItemId',null,'url',p.affiliate_link),
  jsonb_build_object('id','seed-sheet-twinxl-navy','label','Twin XL / Navy','imageUrl',null,
    'price','$'||to_char(p.price,'FM999990.00'),'priceValue',p.price,'providerItemId',null,'url',p.affiliate_link)
)
where p.name = 'Amazon Basics Lightweight Breathable Brushed Microfiber 3-Piece Bed Sheet Set With 14-Inch Deep Pockets, Wrinkle Resistant, Twin XL, Dark Gray, Solid';

-- Towel set: color options on one 6-piece listing.
update public.amazon_products p
set variants = jsonb_build_array(
  jsonb_build_object('id','seed-towel-white','label','White','imageUrl',null,
    'price','$'||to_char(p.price,'FM999990.00'),'priceValue',p.price,'providerItemId',null,'url',p.affiliate_link),
  jsonb_build_object('id','seed-towel-aqua','label','Aqua Blue','imageUrl',null,
    'price','$'||to_char(p.price,'FM999990.00'),'priceValue',p.price,'providerItemId',null,'url',p.affiliate_link),
  jsonb_build_object('id','seed-towel-charcoal','label','Charcoal Grey','imageUrl',null,
    'price','$'||to_char(p.price,'FM999990.00'),'priceValue',p.price,'providerItemId',null,'url',p.affiliate_link)
)
where p.name = 'American Soft Linen 100% Cotton Luxury Turkish Towels, 6 Piece Towel Set, Quick Dry';
