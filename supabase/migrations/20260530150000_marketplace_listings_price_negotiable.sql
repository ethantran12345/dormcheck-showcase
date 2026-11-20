-- Whether the seller is open to negotiating price on buy/sell listings
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS price_negotiable boolean DEFAULT false;
