-- Stop the usernames table being publicly enumerable.
--
-- Migration 004's SELECT policy was `using (true)`, which the availability check
-- needed in order to test an arbitrary handle against other users' rows. But it
-- also let any client read the whole table and harvest every handle with its
-- user_id. This replaces that with a security-definer function that answers the
-- one question the client actually needs — "is this handle free for me?" — and
-- returns nothing else.
--
-- Order matters, and the failure mode is worth knowing precisely. The live
-- client still reads the table directly. Once this migration lands, that read
-- returns no rows for a handle belonging to someone else — no error, just an
-- empty result — which isUsernameAvailable interprets as "free". So between this
-- migration and the client deploy, every handle reads as Available and the save
-- then fails as taken. Not destructive, but visibly wrong, so run this and ship
-- the client change together rather than leaving a gap.

-- ---------------------------------------------------------------------------
-- 1. The function
-- ---------------------------------------------------------------------------
-- security definer so it can see rows the caller cannot. search_path is pinned
-- so the definer's privileges can't be turned against us via a shadowed table.
-- stable, not volatile: it only reads.
--
-- `user_id is distinct from auth.uid()` is what makes re-saving your own handle
-- read as available. That check now lives server-side rather than being passed
-- in by the client, which also removes the chance of it being spoofed.
create or replace function public.is_username_available(candidate text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select not exists (
    select 1
    from public.usernames
    where username = lower(btrim(candidate))
      and user_id is distinct from auth.uid()
  );
$$;

-- Only signed-in users need this: the handle is claimed after Google sign-in,
-- so there is no anonymous path that requires it.
revoke all on function public.is_username_available(text) from public, anon;
grant execute on function public.is_username_available(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Lock the table down
-- ---------------------------------------------------------------------------
-- getMyUsername still reads the caller's own row directly, so SELECT is narrowed
-- to that rather than removed. Anything broader now has to go through the RPC.
drop policy if exists "Anyone can check username availability" on public.usernames;
drop policy if exists "Users read own username"                on public.usernames;

create policy "Users read own username" on public.usernames
  for select to authenticated
  using (auth.uid() = user_id);

-- Insert and update policies from migration 004 are unchanged and still apply.
