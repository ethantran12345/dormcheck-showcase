-- Harden the admin-managed `templates` download bucket (issue #43).
-- Stays public-READ (app fetches official templates unauthenticated) but is now size- and
-- type-capped so a future INSERT policy cannot make it an arbitrary public upload target.
-- No user INSERT path exists or is intended; this is an admin/service-role shelf.
-- Idempotent: an `update ... where id=` is safe to re-run.
update storage.buckets
  set file_size_limit = 15728640,  -- 15 MB, matching academic-planners; 35 KB in use today
      allowed_mime_types = array[
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', -- xlsx
        'application/pdf',
        'text/csv',
        'application/vnd.ms-excel'  -- legacy xls
      ]
  where id = 'templates';
