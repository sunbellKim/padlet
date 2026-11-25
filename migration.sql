-- MINDLET: migration for an EXISTING database that already has public.memos.
-- For a new empty database use schema.sql instead.
--
-- PRECONDITIONS (read before running)
--   1. Take a backup / snapshot first (Supabase Dashboard > Database > Backups,
--      or `pg_dump`). This script is transactional, but backups are still required.
--   2. Run STEP 0 (read-only) and check that the existing structure matches the
--      assumptions below. If anything differs, do NOT run STEP 1; adapt it first.
--        - public.memos exists with columns id (uuid), title, content.
--        - Optional columns: color, position, created_at, updated_at,
--          password_hash (bcrypt hash of the author's 4-digit password).
--        - public.memo_credentials may or may not exist; if it exists it must have
--          (memo_id uuid, password_hash text).
--   3. Only memos, memo_credentials, admin_sessions, rate_limits and the
--      functions created below are touched. Other tables and the schema-wide
--      privileges of `public` are left alone.
--   4. Existing policies on those four tables are dropped and replaced, so old
--      permissive policies cannot linger.
--   5. Run it in the SQL Editor as a whole (it is one transaction; any failed
--      check rolls everything back).

-- =============================================================== STEP 0
-- Read-only inspection. Run these separately first.
--
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name in ('memos', 'memo_credentials')
--  order by table_name, ordinal_position;
--
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid in ('public.memos'::regclass);
--
-- select tablename, policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname = 'public';
--
-- select grantee, table_name, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name in ('memos', 'memo_credentials');
--
-- select count(*) as memos,
--        count(*) filter (where password_hash is not null) as with_hash
--   from public.memos;          -- only if memos.password_hash exists

-- =============================================================== STEP 1
begin;

-- 1) Preconditions
do $$
begin
  if to_regclass('public.memos') is null then
    raise exception 'public.memos does not exist. Use schema.sql for a new database.';
  end if;

  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'memos'
         and column_name in ('id', 'title', 'content')) < 3 then
    raise exception 'public.memos must have id, title and content columns.';
  end if;
end $$;

-- 2) Missing columns on memos (existing columns and data are preserved)
alter table public.memos add column if not exists color text not null default '#fef3c7';
alter table public.memos add column if not exists position integer not null default 0;
alter table public.memos add column if not exists created_at timestamptz not null default now();
alter table public.memos add column if not exists updated_at timestamptz not null default now();

-- 3) Private credential table
create table if not exists public.memo_credentials (
  memo_id uuid primary key references public.memos(id) on delete cascade,
  password_hash text not null
);

-- 4) Move legacy hashes out of the public table, verify, then drop the column
do $$
declare
  legacy_total bigint;
  missing bigint;
  duplicated bigint;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'memos'
       and column_name = 'password_hash'
  ) then
    execute 'select count(*) from public.memos where password_hash is not null'
      into legacy_total;

    execute $q$
      insert into public.memo_credentials (memo_id, password_hash)
      select id, password_hash from public.memos where password_hash is not null
      on conflict (memo_id) do nothing
    $q$;

    -- verification: every legacy hash must now exist, unchanged, in memo_credentials
    execute $q$
      select count(*) from public.memos m
       where m.password_hash is not null
         and not exists (
           select 1 from public.memo_credentials c
            where c.memo_id = m.id and c.password_hash = m.password_hash)
    $q$ into missing;

    select count(*) into duplicated from (
      select memo_id from public.memo_credentials group by memo_id having count(*) > 1
    ) d;

    if missing > 0 or duplicated > 0 then
      raise exception 'Hash migration check failed (missing=%, duplicated=%)', missing, duplicated;
    end if;

    raise notice 'Migrated % legacy password hashes.', legacy_total;

    -- dropping the column also removes constraints/indexes that depended on it
    execute 'alter table public.memos drop column password_hash';
  end if;

  if exists (select 1 from public.memos m
              where not exists (select 1 from public.memo_credentials c where c.memo_id = m.id)) then
    raise notice 'Some memos have no author password (admin can still delete them).';
  end if;
end $$;

-- 5) Constraints (existing rows are validated; failure rolls everything back)
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.memos'::regclass and conname = 'memos_title_length') then
    alter table public.memos
      add constraint memos_title_length check (char_length(title) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.memos'::regclass and conname = 'memos_content_length') then
    alter table public.memos
      add constraint memos_content_length check (char_length(content) between 1 and 2000);
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.memos'::regclass and conname = 'memos_color_not_empty') then
    alter table public.memos
      add constraint memos_color_not_empty check (char_length(color) > 0);
  end if;
end $$;

-- 6) Server-only tables
create table if not exists public.admin_sessions (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hit_count integer not null default 0
);

create index if not exists memos_created_at_idx on public.memos (created_at desc);
create index if not exists memos_position_idx on public.memos (position asc, created_at desc);
create index if not exists admin_sessions_expires_at_idx on public.admin_sessions (expires_at);

-- 7) Functions (SECURITY INVOKER; executable only by service_role)
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

drop trigger if exists memos_set_updated_at on public.memos;
create trigger memos_set_updated_at
before update on public.memos
for each row
execute function public.set_updated_at();

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

-- 8) RLS + remove every pre-existing policy on the app tables
alter table public.memos enable row level security;
alter table public.memo_credentials enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.rate_limits enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('memos', 'memo_credentials', 'admin_sessions', 'rate_limits')
  loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

create policy "Public memos are readable"
on public.memos
for select
to anon, authenticated
using (true);

-- 9) Grants (only on the app's own objects)
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

-- =============================================================== STEP 2
-- Verification (read-only). Expect: no password_hash column on memos, anon has only
-- SELECT on memos, no privileges on the other three tables, and equal counts.
--
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='memos' and column_name='password_hash';
-- select grantee, table_name, privilege_type from information_schema.role_table_grants
--  where table_schema='public' and grantee in ('anon','authenticated')
--    and table_name in ('memos','memo_credentials','admin_sessions','rate_limits');
-- select (select count(*) from public.memos) memos,
--        (select count(*) from public.memo_credentials) credentials;
