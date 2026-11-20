create extension if not exists "hypopg" with schema "extensions";

create extension if not exists "index_advisor" with schema "extensions";

create extension if not exists "wrappers" with schema "extensions";

drop extension if exists "pg_net";

drop policy "dorm_question_upvotes_select_all" on "public"."dorm_question_upvotes";


  create policy "dorm_question_upvotes_select_all"
  on "public"."dorm_question_upvotes"
  as permissive
  for select
  to anon, authenticated
using (true);


CREATE TRIGGER check_pitt_email_on_signup BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.validate_pitt_email();

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER on_auth_user_created_checklist AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_checklist();


  create policy "Authenticated Upload"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'dorm-setups'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Authenticated users can upload academic planners"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'academic-planners'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Authenticated users can upload avatars"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Authenticated users can upload business banners"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'business-banners'::text));



  create policy "Authenticated users can upload business logos"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'business-logos'::text));



  create policy "Authenticated users can upload marketplace images"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'marketplace-images'::text));



  create policy "Authenticated users can upload roommate post photos"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'roommate-post-photos'::text));



  create policy "Authenticated users can upload setup photos"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'setup-photos'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Avatar Upload Policy"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "Avatar View Policy"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'avatars'::text));



  create policy "Public Access"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'dorm-setups'::text));



  create policy "Public can view academic planners"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'academic-planners'::text));



  create policy "Public can view avatars"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'avatars'::text));



  create policy "Public can view business banners"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'business-banners'::text));



  create policy "Public can view business logos"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'business-logos'::text));



  create policy "Public can view dining review photos"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'dining-review-photos'::text));



  create policy "Public can view marketplace images"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'marketplace-images'::text));



  create policy "Public can view roommate post photos"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'roommate-post-photos'::text));



  create policy "Public can view setup photos"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'setup-photos'::text));



  create policy "Users can delete dining review photos"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'dining-review-photos'::text) AND (EXISTS ( SELECT 1
   FROM public.dining_reviews dr
  WHERE (((dr.id)::text = split_part(split_part(objects.name, '/'::text, 2), '.'::text, 1)) AND ((dr.spot_id)::text = split_part(objects.name, '/'::text, 1)) AND (dr.user_id = auth.uid()))))));



  create policy "Users can delete own academic planners"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'academic-planners'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can delete own business banners"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'business-banners'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can delete own business logos"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'business-logos'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can delete own marketplace images"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'marketplace-images'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can delete own roommate post photos"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'roommate-post-photos'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can delete their own avatars"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can delete their own setup photos"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'setup-photos'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can update dining review photos"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'dining-review-photos'::text) AND (EXISTS ( SELECT 1
   FROM public.dining_reviews dr
  WHERE (((dr.id)::text = split_part(split_part(objects.name, '/'::text, 2), '.'::text, 1)) AND ((dr.spot_id)::text = split_part(objects.name, '/'::text, 1)) AND (dr.user_id = auth.uid()))))))
with check (((bucket_id = 'dining-review-photos'::text) AND (EXISTS ( SELECT 1
   FROM public.dining_reviews dr
  WHERE (((dr.id)::text = split_part(split_part(objects.name, '/'::text, 2), '.'::text, 1)) AND ((dr.spot_id)::text = split_part(objects.name, '/'::text, 1)) AND (dr.user_id = auth.uid()))))));



  create policy "Users can update own academic planners"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'academic-planners'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])))
with check (((bucket_id = 'academic-planners'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can update own business banners"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'business-banners'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can update own business logos"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'business-logos'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can upload dining review photos"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'dining-review-photos'::text) AND (EXISTS ( SELECT 1
   FROM public.dining_reviews dr
  WHERE (((dr.id)::text = split_part(split_part(objects.name, '/'::text, 2), '.'::text, 1)) AND ((dr.spot_id)::text = split_part(objects.name, '/'::text, 1)) AND (dr.user_id = auth.uid()))))));



  create policy "Users can upload listing images"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'marketplace-images'::text));



  create policy "Users can upload own avatar"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "Users can upload their own avatar"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'avatars'::text) AND (auth.uid() = owner)));



  create policy "admins_delete_dorm_photos"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'dorm-photos'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.is_admin = true))))));



  create policy "admins_update_dorm_photos"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'dorm-photos'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.is_admin = true))))));



  create policy "admins_upload_dorm_photos"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'dorm-photos'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.is_admin = true))))));



  create policy "public_read_dorm_photos"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'dorm-photos'::text));



