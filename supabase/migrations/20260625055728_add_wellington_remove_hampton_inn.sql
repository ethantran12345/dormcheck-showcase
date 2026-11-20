-- Add "The Wellington" (University-affiliated apartment-style housing, 245 Melwood Ave)
-- and remove "Hampton Inn" (Pitt no longer uses it).
-- Source: https://www.pc.pitt.edu/housing-services/university-affiliated-housing/wellington
-- One row per room-type variant, matching the master_housing convention.

DELETE FROM public.master_housing WHERE trim(residence_hall) = 'Hampton Inn';

INSERT INTO public.master_housing (
  id, residence_hall, accomodation, rate_per_term, meal_plan_options, housing_type,
  address, capacity, floors, terms, details, resident_director, who_lives_here,
  community_type, important_dates, wifi_and_cable, heat_and_air_conditioning,
  window_coverings, latitude, longitude, inroom_amenities, building_amenities,
  mailing_services, mailing_address, laundry, floorplan, image_url, rent_period,
  building_llc, move_in_parking_lot, move_in_time_window, move_in_entrance,
  move_in_cart_location, move_in_notes, move_in_date
)
SELECT
  v.id,
  'The Wellington',
  v.accomodation,
  v.rate,
  false,                                                   -- meal_plan_options (Meal Plan: Not Required)
  'Leased Apartments, Apartment Style Housing',            -- housing_type
  '245 Melwood Ave, Pittsburgh, PA 15213',                 -- address
  NULL,                                                    -- capacity (not published)
  NULL,                                                    -- floors (not published)
  NULL,                                                    -- terms (not published)
  'The Wellington is University-affiliated apartment-style housing in North Oakland, ideal for upperclassmen who want the independence of a real apartment with a private kitchen and bathroom. Studios and one-person units offer total privacy, while the two-person base and elevated doubles trade some space for a lower per-term rate. Every unit comes with its own kitchen, refrigerator, and stove plus window A/C and radiant heat, so it feels more like off-campus living while staying inside the Pitt housing system, a short walk up Melwood Avenue from central campus.',
  NULL,                                                    -- resident_director (not published)
  'Upperclass Students',                                   -- who_lives_here
  'Single Gender or Gender Inclusive Housing based on room',
  NULL,                                                    -- important_dates (not published)
  true,                                                    -- wifi_and_cable
  true,                                                    -- heat_and_air_conditioning (window A/C + radiant heat)
  false,                                                   -- window_coverings (curtain rod only, no curtains)
  40.45157989544,
  -79.950572984656,
  E'Kitchen\nRefrigerator\nStove\nTwin Bed (XL)\nDresser\nDesk\nDesk Chair\nWindow Curtain Rod\nWardrobe/Closet - not all rooms will be provided wardrobe if closet is present*\nTrash and Recycling Receptacle\nShower Curtain or Glass Door\nSofa* (Elevated Double and 1-Person Apartment only)\nCoffee Table* (Elevated Double and 1-Person Apartment only)\nDining Table with 2 Chairs\nNo ceiling fans',
  E'Laundry (Building)\nAir Conditioning (Building - window unit, at least 1 per unit)\nRadiant Heat (Building)',
  'The Wellington',                                        -- mailing_services
  E'Student Name\nThe Wellington Room #\n245 Melwood Ave.\nPittsburgh, PA 15213',
  'TRUE',                                                  -- laundry
  NULL,                                                    -- floorplan
  'https://www.pc.pitt.edu/sites/default/files/img-cards/wellington_entrance.jpg',
  'semester',                                              -- rent_period (rates quoted per term)
  NULL,                                                    -- building_llc
  NULL, NULL, NULL, NULL, NULL, NULL                       -- move_in_* (not published)
FROM (VALUES
  (146, 'Studio Apartment',                                       '6,025.00'),
  (147, '1-Person Apartment - Private Room',                      '6,180.00'),
  (148, '2-Person Base Double Apartment - Shared Room (2 people)', '5,000.00'),
  (149, '2-Person Elevated Double Apartment - Shared Room (2 people)', '5,885.00')
) AS v(id, accomodation, rate);
