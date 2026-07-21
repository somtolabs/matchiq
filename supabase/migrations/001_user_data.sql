-- MatchIQ per-user state, one row per user, guarded by Row Level Security.
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tracked jsonb not null default '[]'::jsonb,
  analysis_cache jsonb not null default '{}'::jsonb,
  agent_perf jsonb not null default '{}'::jsonb,
  theme text,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

create policy "Users can read own data"
  on public.user_data for select
  using (auth.uid() = user_id);

create policy "Users can insert own data"
  on public.user_data for insert
  with check (auth.uid() = user_id);

create policy "Users can update own data"
  on public.user_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
