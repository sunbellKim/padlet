-- MINDLET: schema for a NEW, EMPTY database.
-- For a database that already has a `memos` table, run migration.sql instead.
-- Run in the Supabase SQL Editor. No sample data is inserted.
-- Only objects used by this app are touched; the whole `public` schema's
-- privileges are NOT changed.

begin;

-- ---------------------------------------------------------------- tables
create table public.memos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  color text not null default '#fef3c7',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memos_title_length check (char_length(title) between 1 and 80),
  constraint memos_content_length check (char_length(content) between 1 and 2000),
  constraint memos_color_not_empty check (char_length(color) > 0)
);

create table public.memo_credentials (
  memo_id uuid primary key references public.memos(id) on delete cascade,
  password_hash text not null
);

create table public.admin_sessions (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hit_count integer not null default 0
);

create index memos_created_at_idx on public.memos (created_at desc);
create index memos_position_idx on public.memos (position asc, created_at desc);
create index admin_sessions_expires_at_idx on public.admin_sessions (expires_at);

-- ------------------------------------------------------------- functions
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger memos_set_updated_at
before update on public.memos
for each row
execute function public.set_updated_at();

-- SECURITY INVOKER (default): only the server role (service_role) can execute
-- it and it already has table privileges, so no privilege elevation is needed.
create or replace function public.create_memo_with_credentials(
  p_title text,
  p_content text,
  p_password_hash text,
  p_color text default '#fef3c7'
)
returns public.memos
language plpgsql
set search_path = public
as $$
declare
  inserted_memo public.memos;
begin
  if char_length(p_title) < 1 or char_length(p_title) > 80 then
    raise exception 'Invalid title length';
  end if;

  if char_length(p_content) < 1 or char_length(p_content) > 2000 then
    raise exception 'Invalid content length';
  end if;

  if p_password_hash is null or char_length(p_password_hash) < 50 then
    raise exception 'Invalid password hash';
  end if;

  insert into public.memos (title, content, color)
  values (p_title, p_content, coalesce(nullif(p_color, ''), '#fef3c7'))
  returning * into inserted_memo;

  insert into public.memo_credentials (memo_id, password_hash)
  values (inserted_memo.id, p_password_hash);

  return inserted_memo;
end;
$$;

-- Atomic fixed-window counter. Returns true while the caller is within the limit.
create or replace function public.rate_limit_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  current_hits integer;
begin
  if p_key is null or char_length(p_key) > 200
     or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit arguments';
  end if;

  insert into public.rate_limits as r (key, window_start, hit_count)
  values (p_key, now(), 1)
  on conflict (key) do update
  set window_start = case
        when r.window_start <= now() - make_interval(secs => p_window_seconds)
        then now() else r.window_start end,
      hit_count = case
        when r.window_start <= now() - make_interval(secs => p_window_seconds)
        then 1 else r.hit_count + 1 end
  returning r.hit_count into current_hits;

  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return current_hits <= p_limit;
end;
$$;

create or replace function public.rate_limit_reset(p_key text)
returns void
language sql
set search_path = public
as $$
  delete from public.rate_limits where key = p_key;
$$;

-- ------------------------------------------------------------------ RLS
alter table public.memos enable row level security;
alter table public.memo_credentials enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.rate_limits enable row level security;

-- Public read of memos only. memo_credentials / admin_sessions / rate_limits
-- get NO policy for anon/authenticated (default deny) plus revoked grants.
create policy "Public memos are readable"
on public.memos
for select
to anon, authenticated
using (true);

-- ---------------------------------------------------------------- grants
revoke all on table public.memos from public, anon, authenticated;
revoke all on table public.memo_credentials from public, anon, authenticated;
revoke all on table public.admin_sessions from public, anon, authenticated;
revoke all on table public.rate_limits from public, anon, authenticated;

grant select on table public.memos to anon, authenticated;

grant select, insert, update, delete on table public.memos to service_role;
grant select, insert, update, delete on table public.memo_credentials to service_role;
grant select, insert, update, delete on table public.admin_sessions to service_role;
grant select, insert, update, delete on table public.rate_limits to service_role;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.create_memo_with_credentials(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.rate_limit_hit(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.rate_limit_reset(text)
  from public, anon, authenticated;

grant execute on function public.create_memo_with_credentials(text, text, text, text)
  to service_role;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
grant execute on function public.rate_limit_reset(text) to service_role;

commit;
