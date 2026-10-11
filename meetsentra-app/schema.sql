-- MeetSentra database. Paste into Supabase: SQL Editor -> New query -> Run.

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,20}$')
);

create table meetings (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles(id),
  title text not null,
  duration_min int not null default 60,
  -- unguessable room id; only the host and invited users can ever read it
  room_code text not null default replace(gen_random_uuid()::text, '-', ''),
  started_at timestamptz,
  created_at timestamptz not null default now()
);

create table invites (
  meeting_id uuid references meetings(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  joined_at timestamptz,
  primary key (meeting_id, user_id)
);

-- helper functions avoid policy recursion between meetings and invites
create or replace function is_host(mid uuid) returns boolean
language sql security definer set search_path = public as
$$ select exists (select 1 from meetings where id = mid and host_id = auth.uid()) $$;

create or replace function is_invited(mid uuid) returns boolean
language sql security definer set search_path = public as
$$ select exists (select 1 from invites where meeting_id = mid and user_id = auth.uid()) $$;

alter table profiles enable row level security;
alter table meetings enable row level security;
alter table invites  enable row level security;

create policy "profiles read"        on profiles for select to authenticated using (true);
create policy "profiles insert own"  on profiles for insert to authenticated with check (id = auth.uid());

-- THE access-control rule: you only see a meeting (and its room code) if you host it or are invited
create policy "meetings read"        on meetings for select to authenticated using (host_id = auth.uid() or is_invited(id));
create policy "meetings insert"      on meetings for insert to authenticated with check (host_id = auth.uid());
create policy "meetings update host" on meetings for update to authenticated using (host_id = auth.uid());

create policy "invites read"         on invites for select to authenticated using (user_id = auth.uid() or is_host(meeting_id));
create policy "invites insert host"  on invites for insert to authenticated with check (is_host(meeting_id));
create policy "invites update own"   on invites for update to authenticated using (user_id = auth.uid());

-- live in-app invite notifications
alter publication supabase_realtime add table invites;
