-- 022: Durable idempotency — Phase 2 · Step 1
--
-- Webhooks (Telegram/Instagram) and order submissions can be re-delivered after
-- a network hiccup or provider retry. The old guard was an in-memory Set in
-- routes/webhook.js: single-instance and wiped on every restart. This table +
-- atomic claim_event() RPC give us durable, cross-instance "process at most
-- once" semantics.

create table if not exists public.idempotency_keys (
  key         text        primary key,
  scope       text,
  shop_id     text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_idempotency_created on public.idempotency_keys(created_at);

-- Lock the table down: only the SECURITY DEFINER RPC below and the service role
-- (which bypasses RLS) ever touch it. No policies => no anon/authenticated access.
alter table public.idempotency_keys enable row level security;

-- Atomically claim a key. Returns TRUE the first time a key is seen (caller
-- should process the event) and FALSE on any subsequent delivery (caller skips).
-- SECURITY DEFINER so it works under RLS and in legacy (anon-key) mode alike.
create or replace function public.claim_event(
  p_key     text,
  p_scope   text default null,
  p_shop_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.idempotency_keys(key, scope, shop_id)
  values (p_key, p_scope, p_shop_id);
  return true;   -- newly claimed -> safe to process
exception
  when unique_violation then
    return false; -- already processed -> skip (idempotent)
end;
$$;

grant execute on function public.claim_event(text, text, text) to anon, authenticated, service_role;

-- Retention helper: purge keys older than an interval (default 7 days).
-- Run from a scheduled job (pg_cron) or manually; old keys are no longer needed
-- once providers have stopped retrying.
create or replace function public.purge_idempotency_keys(p_older_than interval default '7 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.idempotency_keys where created_at < now() - p_older_than;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.purge_idempotency_keys(interval) to service_role;
