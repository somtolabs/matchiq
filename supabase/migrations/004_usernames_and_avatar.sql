-- Username table (uniqueness enforced at the DB level) + avatar preference.
-- Run this in the Supabase SQL editor before this sprint's app code can work.
--
-- Safe to re-run: policies and the constraint are dropped before being created,
-- because `create policy` and `add constraint` both error if the object already
-- exists. Migration 005 later replaces the open SELECT policy below with an
-- RPC-based availability check.

create table if not exists public.usernames (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade unique not null,
  username      text unique not null,
  created_at    timestamptz default now()
);

alter table public.usernames enable row level security;

drop policy if exists "Anyone can check username availability" on public.usernames;
drop policy if exists "Users insert own username"              on public.usernames;
drop policy if exists "Users update own username"              on public.usernames;

-- Open SELECT so the client can test whether an arbitrary handle is taken.
-- Superseded by migration 005 — see the note there on enumerability.
create policy "Anyone can check username availability" on public.usernames
  for select using (true);

create policy "Users insert own username" on public.usernames
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users update own username" on public.usernames
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Enforce format at the database level too, not just client-side.
-- Periods and underscores are both permitted, matching USERNAME_RE in
-- src/lib/profile.js exactly. An earlier version of this constraint omitted the
-- period, so handles like "john.doe" passed client validation and were then
-- rejected by the database.
alter table public.usernames drop constraint if exists username_format;
alter table public.usernames add constraint username_format
  check (username ~ '^[a-z0-9._]{3,20}$');

-- Avatar preference lives on the existing per-user preferences table.
alter table public.user_data add column if not exists avatar_choice text default null;
