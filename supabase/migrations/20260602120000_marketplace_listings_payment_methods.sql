-- Accepted payment methods on marketplace listings (buy/sell handoff)
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS payment_methods text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_payment_methods_check;

ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_payment_methods_check
  CHECK (payment_methods <@ ARRAY['zelle'::text, 'venmo'::text, 'cash'::text]);

COMMENT ON COLUMN public.marketplace_listings.payment_methods IS 'Seller-accepted payment types: zelle, venmo, cash (subset enforced by check constraint).';
