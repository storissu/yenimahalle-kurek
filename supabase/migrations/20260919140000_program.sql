-- Phase 3: the boat program of a training.
--
-- A training has 1..6 one-hour sessions ("slots", index 0..slot_count-1). For each session the coach
-- puts crews into boats; boats can be on the water at the same time, and the same boat can carry
-- a different crew in another session:
--   Mavi    08:00-09:00 Alex + Ashley   09:00-10:00 John + Jamie
--   Turuncu 08:00-09:00 Ali + Becca
--
-- Rules enforced here (the UI mirrors them):
--   * a boat is used at most once per session                       (unique training/slot/boat)
--   * a member is in at most one boat per session                   (unique training/slot/member)
--   * a boat never carries more people than its capacity            (trigger)
--   * crew are members, sessions exist in the training              (triggers)
--   * members only see PUBLISHED programs; drafts are coach-only    (RLS)
--   * a program is saved atomically through save_program(), so members never see a half-edited crew
--   * a training's session count cannot shrink below a session that still has a crew

create type public.program_status as enum ('draft', 'published');

create table public.training_programs (
  training_id    uuid primary key references public.trainings (id) on delete cascade,
  status         public.program_status not null default 'draft',
  -- number of times the program has been published; lets members/notifications tell "new" from "updated"
  version        integer not null default 0,
  weather_note   text,
  training_notes text,
  published_at   timestamptz,
  published_by   uuid references public.profiles (id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint training_programs_weather_len check (weather_note is null or char_length(weather_note) <= 500),
  constraint training_programs_notes_len check (training_notes is null or char_length(training_notes) <= 1000),
  constraint training_programs_published_consistent check ((status = 'published') = (published_at is not null))
);

create table public.program_assignments (
  id          uuid primary key default gen_random_uuid(),
  training_id uuid not null references public.training_programs (training_id) on delete cascade,
  slot_index  smallint not null,
  boat_id     uuid not null references public.boats (id) on delete restrict,
  notes       text,
  constraint program_assignments_slot_nonneg check (slot_index >= 0),
  constraint program_assignments_notes_len check (notes is null or char_length(notes) <= 200),
  constraint program_assignments_ref unique (id, training_id, slot_index),
  constraint program_assignments_boat_once_per_slot unique (training_id, slot_index, boat_id)
);

create table public.program_crew (
  assignment_id uuid not null,
  training_id   uuid not null,
  slot_index    smallint not null,
  member_id     uuid not null references public.profiles (id) on delete restrict,
  seat          smallint,
  primary key (assignment_id, member_id),
  constraint program_crew_assignment_fk foreign key (assignment_id, training_id, slot_index)
    references public.program_assignments (id, training_id, slot_index) on delete cascade,
  constraint program_crew_member_once_per_slot unique (training_id, slot_index, member_id)
);

create index program_crew_member_idx on public.program_crew (member_id);

alter table public.training_programs enable row level security;
alter table public.program_assignments enable row level security;
alter table public.program_crew enable row level security;

create trigger training_programs_touch_updated_at
  before update on public.training_programs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- integrity triggers (defence in depth: writes only happen through save_program(), but the
-- database must stay consistent even if that function is ever changed or bypassed)
-- ---------------------------------------------------------------------------
create function public.program_assignments_guard() returns trigger
language plpgsql as $$
declare
  v_slots smallint;
begin
  select slot_count into v_slots from public.trainings where id = new.training_id;
  if v_slots is null or new.slot_index >= v_slots then
    raise exception 'Seans numarası antrenmanın seans sayısını aşıyor' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger program_assignments_guard
  before insert or update of slot_index, training_id on public.program_assignments
  for each row execute function public.program_assignments_guard();

create function public.program_crew_guard() returns trigger
language plpgsql as $$
declare
  v_capacity smallint;
  v_boat     text;
  v_count    integer;
begin
  select b.capacity, b.name into v_capacity, v_boat
    from public.program_assignments a join public.boats b on b.id = a.boat_id
   where a.id = new.assignment_id;

  select count(*) into v_count from public.program_crew where assignment_id = new.assignment_id;
  if v_count + 1 > v_capacity then
    raise exception '% teknesine en fazla % kişi atanabilir', v_boat, v_capacity using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles p where p.id = new.member_id and p.role = 'member') then
    raise exception 'Ekip yalnızca üyelerden oluşabilir' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger program_crew_guard
  before insert on public.program_crew
  for each row execute function public.program_crew_guard();

-- A training cannot lose a session that still has a crew.
create function public.trainings_guard_slot_count() returns trigger
language plpgsql as $$
declare
  v_slot smallint;
begin
  if new.slot_count < old.slot_count then
    select max(slot_index) into v_slot
      from public.program_assignments where training_id = new.id and slot_index >= new.slot_count;
    if v_slot is not null then
      raise exception '% numaralı seansta programda ekip var. Seans sayısını azaltmadan önce programdan çıkarın.', v_slot + 1
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger trainings_guard_slot_count
  before update of slot_count on public.trainings
  for each row execute function public.trainings_guard_slot_count();

revoke all on function public.program_assignments_guard() from public, anon, authenticated;
revoke all on function public.program_crew_guard() from public, anon, authenticated;
revoke all on function public.trainings_guard_slot_count() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- visibility: coaches see everything, members only PUBLISHED programs
-- ---------------------------------------------------------------------------
create function public.program_is_published(p_training_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.training_programs p where p.training_id = p_training_id and p.status = 'published'
  );
$$;

revoke all on function public.program_is_published(uuid) from public, anon, authenticated;
grant execute on function public.program_is_published(uuid) to authenticated;

revoke all on table public.training_programs, public.program_assignments, public.program_crew from anon, authenticated;
grant select on table public.training_programs, public.program_assignments, public.program_crew to authenticated;

create policy training_programs_select on public.training_programs
  for select to authenticated
  using (public.is_coach() or (public.is_active_user() and status = 'published'));

create policy program_assignments_select on public.program_assignments
  for select to authenticated
  using (public.is_coach() or (public.is_active_user() and public.program_is_published(training_id)));

create policy program_crew_select on public.program_crew
  for select to authenticated
  using (public.is_coach() or (public.is_active_user() and public.program_is_published(training_id)));

-- ---------------------------------------------------------------------------
-- save_program(): the ONLY way to change a program. Replaces the whole program atomically.
--
--   p_payload = { "weather_note": text?, "training_notes": text?,
--                 "assignments": [ { "slot_index": 0, "boat_id": uuid, "notes": text?, "crew": [uuid, ...] } ] }
--   p_publish = true  -> the program is (or stays) published, version + 1
--             = false -> saved as a draft; a published program is taken back to draft (members stop seeing it)
--
-- Assignments with an empty crew are ignored. Any error rolls the whole save back.
-- ---------------------------------------------------------------------------
create function public.save_program(p_training_id uuid, p_payload jsonb, p_publish boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_training     public.trainings;
  v_weather      text;
  v_notes        text;
  v_assignments  jsonb;
  v_item         jsonb;
  v_crew         jsonb;
  v_slot         integer;
  v_boat_text    text;
  v_boat         public.boats;
  v_member_text  text;
  v_member_name  text;
  v_assignment   uuid;
  v_note         text;
  v_position     integer;
  v_used         integer := 0;
  v_prev_boats   text[];
  v_prev_members text[];
  v_seen_boats   text[] := '{}';
  v_seen_members text[] := '{}';
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if not public.is_coach() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  select * into v_training from public.trainings where id = p_training_id for update;
  if not found then
    raise exception 'Antrenman bulunamadı' using errcode = 'P0001';
  end if;
  if v_training.status <> 'scheduled' then
    raise exception 'Yalnızca planlanmış antrenmanların programı düzenlenebilir' using errcode = 'P0001';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Geçersiz program verisi' using errcode = 'P0001';
  end if;
  v_weather := nullif(btrim(coalesce(p_payload->>'weather_note', '')), '');
  v_notes   := nullif(btrim(coalesce(p_payload->>'training_notes', '')), '');
  if char_length(coalesce(v_weather, '')) > 500 then
    raise exception 'Hava durumu notu en fazla 500 karakter olabilir' using errcode = 'P0001';
  end if;
  if char_length(coalesce(v_notes, '')) > 1000 then
    raise exception 'Antrenman notu en fazla 1000 karakter olabilir' using errcode = 'P0001';
  end if;

  v_assignments := coalesce(p_payload->'assignments', '[]'::jsonb);
  if jsonb_typeof(v_assignments) <> 'array' then
    raise exception 'Geçersiz program verisi' using errcode = 'P0001';
  end if;

  -- What the program already contained: inactive boats / deactivated members that are already in it
  -- may stay (history), but cannot be newly assigned.
  select coalesce(array_agg(slot_index || ':' || boat_id), '{}') into v_prev_boats
    from public.program_assignments where training_id = p_training_id;
  select coalesce(array_agg(slot_index || ':' || member_id), '{}') into v_prev_members
    from public.program_crew where training_id = p_training_id;

  insert into public.training_programs (training_id, status, version, weather_note, training_notes, published_at, published_by)
  values (
    p_training_id,
    case when p_publish then 'published'::public.program_status else 'draft'::public.program_status end,
    case when p_publish then 1 else 0 end,
    v_weather, v_notes,
    case when p_publish then now() end,
    case when p_publish then auth.uid() end
  )
  on conflict (training_id) do update
    set status         = excluded.status,
        version        = public.training_programs.version + case when p_publish then 1 else 0 end,
        weather_note   = excluded.weather_note,
        training_notes = excluded.training_notes,
        published_at   = excluded.published_at,
        published_by   = excluded.published_by;

  delete from public.program_assignments where training_id = p_training_id;  -- crew rows cascade

  for v_item in select value from jsonb_array_elements(v_assignments) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(jsonb_typeof(v_item->'slot_index'), '') <> 'number'
       or coalesce(jsonb_typeof(v_item->'crew'), '') <> 'array' then
      raise exception 'Geçersiz program verisi' using errcode = 'P0001';
    end if;

    v_crew := v_item->'crew';
    continue when jsonb_array_length(v_crew) = 0;  -- an empty boat is simply not part of the program

    v_slot := (v_item->>'slot_index')::integer;
    if v_slot < 0 or v_slot >= v_training.slot_count then
      raise exception 'Geçersiz seans numarası' using errcode = 'P0001';
    end if;

    v_boat_text := v_item->>'boat_id';
    if v_boat_text is null or v_boat_text !~ v_uuid_re then
      raise exception 'Geçersiz tekne' using errcode = 'P0001';
    end if;
    select * into v_boat from public.boats where id = v_boat_text::uuid;
    if not found then
      raise exception 'Tekne bulunamadı' using errcode = 'P0001';
    end if;
    if not v_boat.is_active and not ((v_slot || ':' || v_boat.id) = any (v_prev_boats)) then
      raise exception '% teknesi kullanım dışı', v_boat.name using errcode = 'P0001';
    end if;
    if (v_slot || ':' || v_boat.id) = any (v_seen_boats) then
      raise exception '% teknesi aynı seansta iki kez kullanılamaz', v_boat.name using errcode = 'P0001';
    end if;
    v_seen_boats := v_seen_boats || (v_slot || ':' || v_boat.id);

    v_note := nullif(btrim(coalesce(v_item->>'notes', '')), '');
    if char_length(coalesce(v_note, '')) > 200 then
      raise exception 'Tekne notu en fazla 200 karakter olabilir' using errcode = 'P0001';
    end if;

    insert into public.program_assignments (training_id, slot_index, boat_id, notes)
    values (p_training_id, v_slot, v_boat.id, v_note)
    returning id into v_assignment;
    v_used := v_used + 1;

    v_position := 0;
    for v_member_text in select value #>> '{}' from jsonb_array_elements(v_crew) loop
      if v_member_text is null or v_member_text !~ v_uuid_re then
        raise exception 'Geçersiz üye' using errcode = 'P0001';
      end if;
      select full_name into v_member_name from public.profiles where id = v_member_text::uuid and role = 'member';
      if not found then
        raise exception 'Ekip yalnızca üyelerden oluşabilir' using errcode = 'P0001';
      end if;
      if (v_slot || ':' || v_member_text::uuid) = any (v_seen_members) then
        raise exception '% aynı seansta iki teknede olamaz', v_member_name using errcode = 'P0001';
      end if;
      if not exists (select 1 from public.profiles where id = v_member_text::uuid and is_active)
         and not ((v_slot || ':' || v_member_text::uuid) = any (v_prev_members)) then
        raise exception '% devre dışı bırakılmış', v_member_name using errcode = 'P0001';
      end if;
      v_seen_members := v_seen_members || (v_slot || ':' || v_member_text::uuid);

      v_position := v_position + 1;
      insert into public.program_crew (assignment_id, training_id, slot_index, member_id, seat)
      values (v_assignment, p_training_id, v_slot, v_member_text::uuid, v_position);
    end loop;
  end loop;

  if p_publish and v_used = 0 then
    raise exception 'Yayınlamak için en az bir tekneye ekip atayın' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.save_program(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.save_program(uuid, jsonb, boolean) to authenticated;
