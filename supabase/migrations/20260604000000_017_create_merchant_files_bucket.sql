-- 017_create_merchant_files_bucket.sql
-- STAGE 30: public storage bucket for product images and payment receipts,
-- plus an image_url column on products. Idempotent / safe to re-run.

insert into storage.buckets (id, name, public)
values ('merchant-files', 'merchant-files', true)
on conflict (id) do update set public = true;

alter table products add column if not exists image_url text;

drop policy if exists "merchant-files public read" on storage.objects;
create policy "merchant-files public read"
  on storage.objects for select
  to public
  using (bucket_id = 'merchant-files');

drop policy if exists "merchant-files insert" on storage.objects;
create policy "merchant-files insert"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'merchant-files');

drop policy if exists "merchant-files update" on storage.objects;
create policy "merchant-files update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'merchant-files');

drop policy if exists "merchant-files delete" on storage.objects;
create policy "merchant-files delete"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'merchant-files');
