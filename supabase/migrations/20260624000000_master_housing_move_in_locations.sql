-- Move-in arrival/unloading locations for each residence hall.
--
-- Source: Pitt Arrival - "Getting to Campus" (arrival.pitt.edu/day-of-arrival/
-- getting-campus), captured 2026-06-24. `move_in_parking_lot` is the short-term
-- UNLOADING spot a student drives to on arrival day; `move_in_notes` carries the
-- long-term relocation guidance + any building-specific warnings. Surfaced in the
-- app via MoveInInfoCard (the parking row gets a tap-to-navigate Directions link).
--
-- Update annually - Pitt's arrival logistics change each year, and exact
-- per-building/floor times are assigned separately. Idempotent: re-running just
-- re-sets the same values. Matched on trim(residence_hall) to tolerate stray
-- whitespace, and covers every row per hall (one row per room type).

DO $$
DECLARE
  reloc text := 'After ~1 hour to unload, relocate to free arrival-day long-term parking: Soldiers & Sailors Garage (4101 Fifth Ave), Posvar Garage (122 Roberto Clemente Dr), or OC Lot (3505 Allequippa St). A printed Pitt arrival parking pass is required.';
BEGIN
  UPDATE public.master_housing SET move_in_parking_lot = 'Soldiers & Sailors Garage (4390 Bigelow Blvd)', move_in_notes = reloc WHERE trim(residence_hall) = 'Amos Hall';
  UPDATE public.master_housing SET move_in_parking_lot = 'Sennott St & Oakland Ave lot', move_in_notes = reloc WHERE trim(residence_hall) LIKE 'Bouquet Gardens%';
  UPDATE public.master_housing SET move_in_parking_lot = 'Soldiers & Sailors Garage (4390 Bigelow Blvd)', move_in_notes = reloc WHERE trim(residence_hall) = 'Brackenridge Hall';
  UPDATE public.master_housing SET move_in_parking_lot = 'The Bridge on Forbes garage (3423 Forbes Ave)', move_in_notes = reloc WHERE trim(residence_hall) = 'The Bridge on Forbes';
  UPDATE public.master_housing SET move_in_parking_lot = 'Soldiers & Sailors Garage (4390 Bigelow Blvd)', move_in_notes = reloc WHERE trim(residence_hall) = 'Bruce Hall';
  UPDATE public.master_housing SET move_in_parking_lot = 'Centre Ave garage (5032 Centre Ave), plus 10 spaces in front of the building', move_in_notes = reloc || ' Do not park opposite Amberson Apartments or in the lower parking areas - vehicles there are towed immediately.' WHERE trim(residence_hall) = 'Centre Plaza';
  UPDATE public.master_housing SET move_in_parking_lot = 'Euler Way, directly behind the building', move_in_notes = reloc WHERE trim(residence_hall) = 'Forbes Hall';
  UPDATE public.master_housing SET move_in_parking_lot = 'Forbes-Craig parking garage', move_in_notes = reloc WHERE trim(residence_hall) = 'Forbes Craig';
  UPDATE public.master_housing SET move_in_parking_lot = 'U Lot behind Sutherland Hall', move_in_notes = reloc WHERE trim(residence_hall) IN ('Fraternity Complex', 'House 7');
  UPDATE public.master_housing SET move_in_parking_lot = 'Behind the building (305 Atwood St)', move_in_notes = reloc WHERE trim(residence_hall) = 'Franklin Apartments';
  UPDATE public.master_housing SET move_in_parking_lot = '3315 Hamlet St', move_in_notes = reloc WHERE trim(residence_hall) = 'Hampton Inn';
  UPDATE public.master_housing SET move_in_parking_lot = 'Soldiers & Sailors Garage (4390 Bigelow Blvd)', move_in_notes = reloc WHERE trim(residence_hall) = 'Holland Hall';
  UPDATE public.master_housing SET move_in_parking_lot = 'U Lot behind Sutherland Hall', move_in_notes = reloc WHERE trim(residence_hall) = 'Irvis Hall';
  UPDATE public.master_housing SET move_in_parking_lot = 'Towers Garage (enter from Forbes Ave)', move_in_notes = reloc WHERE trim(residence_hall) IN ('Litchfield Towers A', 'Litchfield Towers B');
  UPDATE public.master_housing SET move_in_parking_lot = 'BQ Lot (Fifth Ave & S. Bouquet St)', move_in_notes = reloc WHERE trim(residence_hall) = 'Litchfield Towers C';
  UPDATE public.master_housing SET move_in_parking_lot = 'UPMC Victoria Garage (free; height limit 6''6")', move_in_notes = 'Victoria Garage is free but only available Aug 17 & 23. Limited metered street parking during the week due to nearby hospital construction.' WHERE trim(residence_hall) = 'Lothrop Hall';
  UPDATE public.master_housing SET move_in_parking_lot = 'Soldiers & Sailors Garage (4390 Bigelow Blvd)', move_in_notes = reloc WHERE trim(residence_hall) = 'McCormick Hall';
  UPDATE public.master_housing SET move_in_parking_lot = 'University Pl, beside the building (111 University Pl)', move_in_notes = reloc WHERE trim(residence_hall) = 'Nordenberg Hall';
  UPDATE public.master_housing SET move_in_parking_lot = 'Sennott St & Oakland Ave lot', move_in_notes = reloc WHERE trim(residence_hall) = 'Oakwood Apartments';
  UPDATE public.master_housing SET move_in_parking_lot = 'U Lot behind Sutherland Hall', move_in_notes = reloc WHERE trim(residence_hall) = 'Panther Hall';
  UPDATE public.master_housing SET move_in_parking_lot = '300 N. Dithridge St', move_in_notes = 'Relocate to the Residences on Bigelow Garage (3896 Bigelow Blvd). A printed Pitt arrival parking pass is required.' WHERE trim(residence_hall) = 'Pennsylvania Apartments';
  UPDATE public.master_housing SET move_in_parking_lot = 'Ruskin Ave, in front of the hall', move_in_notes = reloc WHERE trim(residence_hall) = 'Ruskin Hall';
  UPDATE public.master_housing SET move_in_parking_lot = '3609 Forbes Ave, in front of the building', move_in_notes = reloc WHERE trim(residence_hall) = 'The Strand';
  UPDATE public.master_housing SET move_in_parking_lot = 'U Lot behind the building', move_in_notes = reloc WHERE trim(residence_hall) = 'Sutherland Hall';
  UPDATE public.master_housing SET move_in_parking_lot = 'University Club parking lot', move_in_notes = reloc WHERE trim(residence_hall) = 'University Hall';
  UPDATE public.master_housing SET move_in_parking_lot = '108 N. Dithridge St (also the 400 block of S. Dithridge St)', move_in_notes = reloc WHERE trim(residence_hall) = 'Webster Hall';
END $$;
