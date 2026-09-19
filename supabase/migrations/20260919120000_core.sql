-- Core schema: profiles, club settings, boats, roles helpers, baseline RLS.
-- Conventions
--   * Every table has RLS enabled (default deny) and explicit grants; we never rely on
--     Supabase's default privileges.
--   * Only the service role (Edge Functions) creates/deactivates users and changes roles.
--   * Roles: 'coach' | 'member'. Members are deactivated, never deleted.

create type public.user_role as enum ('coach', 'member');

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete restrict,
  full_name            text not null,
  username             text not null,
  role                 public.user_role not null default 'member',
  phone                text,
  is_active            boolean not null default true,
  must_change_password boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9._-]{3,30}$'),
  constraint profiles_username_unique unique (username),
  constraint profiles_full_name_len check (char_length(btrim(full_name)) between 2 and 80),
  constraint profiles_phone_len check (phone is null or char_length(phone) <= 30)
);

alter table public.profiles enable row level security;

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- role helpers (SECURITY DEFINER so RLS policies can call them without recursion)
-- ---------------------------------------------------------------------------
create function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_active
  );
$$;

create function public.is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'coach' and p.is_active
  );
$$;

-- Supabase grants EXECUTE on new functions to anon/authenticated by default, so revoke explicitly.
revoke all on function public.is_active_user() from public, anon, authenticated;
revoke all on function public.is_coach() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_coach() to authenticated;

-- ---------------------------------------------------------------------------
-- Guard: the last active coach can never be demoted, deactivated or deleted.
-- Fires for every caller, including the service role.
-- ---------------------------------------------------------------------------
create function public.protect_last_coach() returns trigger
language plpgsql as $$
declare
  other_active_coaches integer;
begin
  if old.role = 'coach' and old.is_active then
    if tg_op = 'DELETE'
       or new.role <> 'coach'
       or new.is_active = false then
      select count(*) into other_active_coaches
      from public.profiles
      where role = 'coach' and is_active and id <> old.id;
      if other_active_coaches = 0 then
        raise exception 'Son aktif antrenör devre dışı bırakılamaz veya rolü değiştirilemez'
          using errcode = 'P0001';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_last_coach
  before update or delete on public.profiles
  for each row execute function public.protect_last_coach();

revoke all on function public.protect_last_coach() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- profiles: privileges + policies
--   read   : own row, or every row for coaches
--   update : coaches only, and only full_name / phone (column-level grant).
--            role, username, is_active, must_change_password change only via
--            the service role (Edge Functions) or the RPC below.
--   insert / delete : service role only.
-- ---------------------------------------------------------------------------
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name, phone) on table public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_coach on public.profiles
  for select to authenticated
  using (public.is_coach());

create policy profiles_update_coach on public.profiles
  for update to authenticated
  using (public.is_coach())
  with check (public.is_coach());

-- The member confirms they chose a new password (UX enforcement of the forced change).
create function public.complete_password_change() returns void
language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;

revoke all on function public.complete_password_change() from public, anon, authenticated;
grant execute on function public.complete_password_change() to authenticated;

-- ---------------------------------------------------------------------------
-- member_directory: names only, so members can see crew names / leaderboard names
-- without ever reading phone numbers or usernames of others.
-- ---------------------------------------------------------------------------
create view public.member_directory as
  select p.id, p.full_name
  from public.profiles p
  where p.is_active
    and p.role = 'member'
    and public.is_active_user();

revoke all on table public.member_directory from anon, authenticated;
grant select on table public.member_directory to authenticated;

-- ---------------------------------------------------------------------------
-- club_settings (singleton)
-- ---------------------------------------------------------------------------
create table public.club_settings (
  id                      boolean primary key default true,
  club_name               text not null,
  timezone                text not null default 'Europe/Istanbul',
  site_name               text not null,
  site_lat                double precision not null,
  site_lng                double precision not null,
  default_rsvp_lead_hours integer not null default 12,
  -- Warning thresholds are chosen by the coaches after launch (null = no advisory).
  wind_gust_warn_kmh      numeric,
  wave_warn_m             numeric,
  updated_at              timestamptz not null default now(),
  constraint club_settings_singleton check (id),
  constraint club_settings_lat check (site_lat between -90 and 90),
  constraint club_settings_lng check (site_lng between -180 and 180),
  constraint club_settings_lead check (default_rsvp_lead_hours between 0 and 168)
);

alter table public.club_settings enable row level security;

create trigger club_settings_touch_updated_at
  before update on public.club_settings
  for each row execute function public.touch_updated_at();

revoke all on table public.club_settings from anon, authenticated;
grant select on table public.club_settings to authenticated;
grant update (site_name, site_lat, site_lng, default_rsvp_lead_hours, wind_gust_warn_kmh, wave_warn_m)
  on table public.club_settings to authenticated;

create policy club_settings_select on public.club_settings
  for select to authenticated
  using (public.is_active_user());

create policy club_settings_update_coach on public.club_settings
  for update to authenticated
  using (public.is_coach())
  with check (public.is_coach());

insert into public.club_settings (club_name, site_name, site_lat, site_lng)
values ('Kdz. Ereğli Yeni Mahalle Kürek Kulübü', 'Kdz. Ereğli açık deniz', 41.285318, 31.407823);

-- ---------------------------------------------------------------------------
-- boats
-- ---------------------------------------------------------------------------
create table public.boats (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  capacity   smallint not null,
  is_active  boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint boats_name_len check (char_length(btrim(name)) between 1 and 40),
  constraint boats_name_unique unique (name),
  constraint boats_capacity_range check (capacity between 1 and 8)
);

alter table public.boats enable row level security;

create trigger boats_touch_updated_at
  before update on public.boats
  for each row execute function public.touch_updated_at();

revoke all on table public.boats from anon, authenticated;
grant select on table public.boats to authenticated;
grant insert (name, capacity, is_active, sort_order) on table public.boats to authenticated;
grant update (name, capacity, is_active, sort_order) on table public.boats to authenticated;

create policy boats_select on public.boats
  for select to authenticated
  using (public.is_active_user());

create policy boats_insert_coach on public.boats
  for insert to authenticated
  with check (public.is_coach());

create policy boats_update_coach on public.boats
  for update to authenticated
  using (public.is_coach())
  with check (public.is_coach());

insert into public.boats (name, capacity, sort_order) values
  ('Mavi', 2, 1),
  ('Turuncu', 2, 2),
  ('C4X', 4, 3);
