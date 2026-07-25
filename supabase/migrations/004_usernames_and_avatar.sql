-- Username table (uniqueness enforced at the DB level) + avatar preference.
-- Run this in the Supabase SQL editor before this sprint's app code can work.

create table if not exists public.usernames (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade unique not null,
  username      text unique not null,
  created_at    timestamptz default now()
);

alter table public.usernames enable row level security;

create policy "Anyone can check username availability" on public.usernames
  for select using (true);
create policy "Users insert own username" on public.usernames
  for insert with check (auth.uid() = user_id);
create policy "Users update own username" on public.usernames
  for update using (auth.uid() = user_id);

-- Enforce format at the database level too, not just client-side.
alter table public.usernames add constraint username_format
  check (username ~ '^[a-z0-9_]{3,20}$');

-- Avatar preference lives on the existing per-user preferences table.
alter table public.user_data add column if not exists avatar_choice text default null;
