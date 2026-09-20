-- Independent schedules per boat.
--
-- Until now every boat session sat on ONE hourly grid: session i of the training = start + i hours, the same for all
-- boats. From now on every boat session has its OWN start and end (minute precision), so Mavi can start at 08:00,
-- Turuncu at 08:15 and C4X at 08:30, with sessions of any length (one hour by default).
--
--   * program_assignments gets starts_at / ends_at. `slot_index` stays as the session's IDENTITY (attendance, history,
--     weather and statistics keep joining on it); a new-style program gives every boat session its own number.
--     Programs saved without times (older clients, older data) keep the old grid: the times are derived from slot_index.
--   * trainings.ends_at = the end of the last session (server-derived, like slot_count). Moving the training moves its
--     sessions with it.
--   * A boat cannot have two overlapping sessions, and nobody can be in two boats at overlapping times.
--   * attendance_records remember the time of their session (what actually happened stays even if the program changes).
--   * The history functions and the attendance export report the session times.

-- ---------------------------------------------------------------------------
-- 1. times on sessions
-- ---------------------------------------------------------------------------
alter table public.program_assignments add column starts_at timestamptz, add column ends_at timestamptz;

update public.program_assignments a
   set starts_at = t.starts_at + a.slot_index * interval '1 hour',
       ends_at   = t.starts_at + (a.slot_index + 1) * interval '1 hour'
  from public.trainings t
 where t.id = a.training_id;

alter table public.program_assignments alter column starts_at set not null, alter column ends_at set not null;
alter table public.program_assignments add constraint program_assignments_times check (ends_at > starts_at and ends_at - starts_at <= interval '8 hours');

-- Inserts without times (direct inserts, older callers) get the old grid: an hour per session number.
create function public.program_assignments_default_times() returns trigger
language plpgsql as $$
begin
  if new.starts_at is null then
    select t.starts_at + new.slot_index * interval '1 hour' into new.starts_at from public.trainings t where t.id = new.training_id;
  end if;
  if new.ends_at is null then
    new.ends_at := new.starts_at + interval '1 hour';
  end if;
  return new;
end;
$$;

create trigger program_assignments_default_times
  before insert on public.program_assignments
  for each row execute function public.program_assignments_default_times();

revoke all on function public.program_assignments_default_times() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. the training's own end, and up to 30 sessions
-- ---------------------------------------------------------------------------
alter table public.trainings add column ends_at timestamptz;
update public.trainings set ends_at = starts_at + slot_count * interval '1 hour' where slot_count > 0;
alter table public.trainings add constraint trainings_ends_after_start check (ends_at is null or ends_at > starts_at);

-- three boats with several sessions each need more numbers than one hourly grid did
alter table public.trainings drop constraint trainings_slot_count_range;
alter table public.trainings add constraint trainings_slot_count_range check (slot_count between 0 and 30);

-- Moving the training moves its whole schedule with it (the boats keep their offsets: 08:15 stays a quarter past).
create function public.trainings_shift_schedule() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.starts_at is distinct from old.starts_at then
    if old.ends_at is not null then
      new.ends_at := old.ends_at + (new.starts_at - old.starts_at);
    end if;
    update public.program_assignments
       set starts_at = starts_at + (new.starts_at - old.starts_at),
           ends_at   = ends_at   + (new.starts_at - old.starts_at)
     where training_id = new.id;
  end if;
  return new;
end;
$$;

create trigger trainings_shift_schedule
  before update of starts_at on public.trainings
  for each row execute function public.trainings_shift_schedule();

revoke all on function public.trainings_shift_schedule() from public, anon, authenticated;

-- A training that has sessions but no stored end (older rows, direct inserts, attendance-only trainings) ends where the
-- old hourly grid says: start + slot_count hours, and that end follows the count when attendance adds sessions.
create function public.trainings_default_end() returns trigger
language plpgsql as $$
begin
  if new.slot_count > 0 and new.ends_at is null then
    new.ends_at := new.starts_at + new.slot_count * interval '1 hour';
  elsif tg_op = 'UPDATE' and new.slot_count > old.slot_count and old.ends_at is not null
        and old.ends_at = old.starts_at + old.slot_count * interval '1 hour' and new.ends_at = old.ends_at then
    new.ends_at := new.starts_at + new.slot_count * interval '1 hour';
  end if;
  return new;
end;
$$;

create trigger trainings_default_end
  before insert or update of slot_count on public.trainings
  for each row execute function public.trainings_default_end();

revoke all on function public.trainings_default_end() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. attendance remembers the time of its session
-- ---------------------------------------------------------------------------
alter table public.attendance_records add column starts_at timestamptz, add column ends_at timestamptz;

-- the program's window for that session number; without one, the old grid (an hour per number)
update public.attendance_records r
   set starts_at = coalesce(
         (select min(a.starts_at) from public.program_assignments a where a.training_id = r.training_id and a.slot_index = r.slot_index),
         (select t.starts_at + r.slot_index * interval '1 hour' from public.trainings t where t.id = r.training_id)),
       ends_at = coalesce(
         (select max(a.ends_at) from public.program_assignments a where a.training_id = r.training_id and a.slot_index = r.slot_index),
         (select t.starts_at + (r.slot_index + 1) * interval '1 hour' from public.trainings t where t.id = r.training_id));

alter table public.attendance_records alter column starts_at set not null, alter column ends_at set not null;

create function public.attendance_records_default_times() returns trigger
language plpgsql as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
begin
  if new.starts_at is null or new.ends_at is null then
    select min(a.starts_at), max(a.ends_at) into v_start, v_end
      from public.program_assignments a where a.training_id = new.training_id and a.slot_index = new.slot_index;
    if v_start is null then
      select t.starts_at + new.slot_index * interval '1 hour' into v_start from public.trainings t where t.id = new.training_id;
      v_end := v_start + interval '1 hour';
    end if;
    new.starts_at := coalesce(new.starts_at, v_start);
    new.ends_at := coalesce(new.ends_at, v_end);
  end if;
  return new;
end;
$$;

create trigger attendance_records_default_times
  before insert on public.attendance_records
  for each row execute function public.attendance_records_default_times();

revoke all on function public.attendance_records_default_times() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. text helper: "08:15–09:15", or just "08:15" while the end is not known
-- ---------------------------------------------------------------------------
create function public.tr_span(p timestamptz, e timestamptz) returns text
language sql stable as $$
  select case when e is null then public.tr_time(p) else public.tr_time(p) || '–' || public.tr_time(e) end;
$$;

revoke all on function public.tr_span(timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. save_program(): sessions with their own times
--
--   p_payload = { "weather_note": text?, "training_notes": text?,
--                 "assignments": [ { "slot_index": 3, "boat_id": uuid, "starts_at": timestamptz?, "ends_at": timestamptz?,
--                                    "notes": text?, "crew": [uuid, ...] } ] }
--   Without starts_at the session is on the old grid (training start + slot_index hours); without ends_at it lasts an hour.
--   Rules: a session ends after it starts, lasts at most 8 hours and does not start before the training; one boat's
--   sessions never overlap; nobody is in two boats at overlapping times. Everything else is as before.
-- ---------------------------------------------------------------------------
create or replace function public.save_program(p_training_id uuid, p_payload jsonb, p_publish boolean, p_notify boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_training     public.trainings;
  v_weather      text;
  v_notes        text;
  v_assignments  jsonb;
  v_item         jsonb;
  v_crew         jsonb;
  v_slot         integer;
  v_start        timestamptz;
  v_end          timestamptz;
  v_boat_text    text;
  v_boat         public.boats;
  v_member_text  text;
  v_member_name  text;
  v_assignment   uuid;
  v_note         text;
  v_position     integer;
  v_used         integer := 0;
  v_version      integer;
  v_prev_boats   text[];
  v_prev_members text[];
  v_old_pairs    text[];
  v_new_pairs    text[];
  v_targets      uuid[];
  v_seen_boats   text[] := '{}';
  v_seen_members text[] := '{}';
  v_program_slots integer;
  v_attendance_slots integer;
  v_clash        record;
  v_max_slots constant integer := 30;
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

  -- The session numbers in use decide the bound for attendance (slot_count): highest number with a crew + 1.
  select coalesce(max((e->>'slot_index')::integer) + 1, 0) into v_program_slots
    from jsonb_array_elements(v_assignments) e
   where jsonb_typeof(e->'slot_index') = 'number'
     and jsonb_typeof(e->'crew') = 'array'
     and jsonb_array_length(e->'crew') > 0;
  if v_program_slots > v_max_slots then
    raise exception 'Bir antrenmanda en fazla % seans numarası kullanılabilir', v_max_slots using errcode = 'P0001';
  end if;
  select coalesce(max(slot_index) + 1, 0) into v_attendance_slots
    from public.attendance_records where training_id = p_training_id;

  select coalesce(array_agg(slot_index || ':' || boat_id), '{}') into v_prev_boats
    from public.program_assignments where training_id = p_training_id;
  select coalesce(array_agg(slot_index || ':' || member_id), '{}') into v_prev_members
    from public.program_crew where training_id = p_training_id;
  -- slot:boat:member:start:end tuples before the change, to tell who is affected afterwards (a moved session counts)
  select coalesce(array_agg(a.slot_index || ':' || a.boat_id || ':' || c.member_id || ':' ||
                            extract(epoch from a.starts_at)::bigint || ':' || extract(epoch from a.ends_at)::bigint), '{}') into v_old_pairs
    from public.program_crew c join public.program_assignments a on a.id = c.assignment_id
   where c.training_id = p_training_id;

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

  -- A program with crews decides the session bound (an empty draft leaves it as it was).
  if v_program_slots > 0 and greatest(v_program_slots, v_attendance_slots) <> v_training.slot_count then
    update public.trainings set slot_count = greatest(v_program_slots, v_attendance_slots) where id = p_training_id;
  end if;

  for v_item in select value from jsonb_array_elements(v_assignments) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(jsonb_typeof(v_item->'slot_index'), '') <> 'number'
       or coalesce(jsonb_typeof(v_item->'crew'), '') <> 'array' then
      raise exception 'Geçersiz program verisi' using errcode = 'P0001';
    end if;

    v_crew := v_item->'crew';
    continue when jsonb_array_length(v_crew) = 0;  -- an empty session is simply not part of the program

    v_slot := (v_item->>'slot_index')::integer;
    if v_slot < 0 or v_slot >= v_max_slots then
      raise exception 'Geçersiz seans numarası' using errcode = 'P0001';
    end if;

    -- the session's own time (or the old grid when the caller sends none)
    begin
      v_start := case when jsonb_typeof(v_item->'starts_at') = 'string'
                      then (v_item->>'starts_at')::timestamptz
                      else v_training.starts_at + v_slot * interval '1 hour' end;
      v_end   := case when jsonb_typeof(v_item->'ends_at') = 'string'
                      then (v_item->>'ends_at')::timestamptz
                      else v_start + interval '1 hour' end;
    exception when others then
      raise exception 'Geçersiz seans saati' using errcode = 'P0001';
    end;
    if v_end <= v_start then
      raise exception 'Seansın bitişi başlangıcından sonra olmalı (%)', public.tr_span(v_start, null) using errcode = 'P0001';
    end if;
    if v_end - v_start > interval '8 hours' then
      raise exception 'Bir seans en fazla 8 saat sürebilir (%)', public.tr_span(v_start, v_end) using errcode = 'P0001';
    end if;
    if v_start < v_training.starts_at then
      raise exception 'Seans, antrenmanın başlangıcından (%) önce başlayamaz. Önce antrenman saatini düzenleyin.', public.tr_time(v_training.starts_at) using errcode = 'P0001';
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

    -- Boats such as the C4X cannot be rowed short-handed: a published program must have them full.
    if p_publish and v_boat.requires_full_crew and jsonb_array_length(v_crew) <> v_boat.capacity then
      raise exception '% teknesinde tam % kişi olmalı (% seansında % kişi var). Eksik veya fazla ekiple yayınlanamaz.',
        v_boat.name, v_boat.capacity, public.tr_span(v_start, v_end), jsonb_array_length(v_crew) using errcode = 'P0001';
    end if;

    v_note := nullif(btrim(coalesce(v_item->>'notes', '')), '');
    if char_length(coalesce(v_note, '')) > 200 then
      raise exception 'Tekne notu en fazla 200 karakter olabilir' using errcode = 'P0001';
    end if;

    insert into public.program_assignments (training_id, slot_index, boat_id, notes, starts_at, ends_at)
    values (p_training_id, v_slot, v_boat.id, v_note, v_start, v_end)
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

  -- One boat cannot be on the water twice at the same time ...
  select b.name as boat, a1.starts_at as s1, a1.ends_at as e1, a2.starts_at as s2, a2.ends_at as e2 into v_clash
    from public.program_assignments a1
    join public.program_assignments a2 on a2.training_id = a1.training_id and a2.boat_id = a1.boat_id and a1.id < a2.id
                                      and a1.starts_at < a2.ends_at and a2.starts_at < a1.ends_at
    join public.boats b on b.id = a1.boat_id
   where a1.training_id = p_training_id
   limit 1;
  if found then
    raise exception '% teknesinin seansları çakışıyor: %', v_clash.boat,
      case when v_clash.s1 <= v_clash.s2
           then public.tr_span(v_clash.s1, v_clash.e1) || ' ve ' || public.tr_span(v_clash.s2, v_clash.e2)
           else public.tr_span(v_clash.s2, v_clash.e2) || ' ve ' || public.tr_span(v_clash.s1, v_clash.e1) end
      using errcode = 'P0001';
  end if;
  -- ... and nobody rows two boats at once.
  select p.full_name as person, a1.starts_at as s1, a1.ends_at as e1, a2.starts_at as s2, a2.ends_at as e2 into v_clash
    from public.program_crew c1
    join public.program_assignments a1 on a1.id = c1.assignment_id
    join public.program_crew c2 on c2.training_id = c1.training_id and c2.member_id = c1.member_id and c2.assignment_id <> c1.assignment_id
    join public.program_assignments a2 on a2.id = c2.assignment_id and a1.id < a2.id
                                      and a1.starts_at < a2.ends_at and a2.starts_at < a1.ends_at
    join public.profiles p on p.id = c1.member_id
   where c1.training_id = p_training_id
   limit 1;
  if found then
    raise exception '% aynı saatte iki teknede olamaz: %', v_clash.person,
      case when v_clash.s1 <= v_clash.s2
           then public.tr_span(v_clash.s1, v_clash.e1) || ' ve ' || public.tr_span(v_clash.s2, v_clash.e2)
           else public.tr_span(v_clash.s2, v_clash.e2) || ' ve ' || public.tr_span(v_clash.s1, v_clash.e1) end
      using errcode = 'P0001';
  end if;

  if p_publish and v_used = 0 then
    raise exception 'Yayınlamak için en az bir tekneye ekip atayın' using errcode = 'P0001';
  end if;

  -- The training lasts until its last session ends.
  if v_used > 0 then
    update public.trainings
       set ends_at = (select max(a.ends_at) from public.program_assignments a where a.training_id = p_training_id)
     where id = p_training_id;
  end if;

  -- Tell the members (only when publishing, and only if the coach wants to).
  if p_publish and p_notify then
    select version into v_version from public.training_programs where training_id = p_training_id;
    select coalesce(array_agg(a.slot_index || ':' || a.boat_id || ':' || c.member_id || ':' ||
                              extract(epoch from a.starts_at)::bigint || ':' || extract(epoch from a.ends_at)::bigint), '{}') into v_new_pairs
      from public.program_crew c join public.program_assignments a on a.id = c.assignment_id
     where c.training_id = p_training_id;

    if v_version = 1 then
      -- first publication: everybody in a boat, plus attendees who got no boat
      select coalesce(array_agg(distinct m), '{}') into v_targets from (
        select c.member_id as m from public.program_crew c where c.training_id = p_training_id
        union
        select r.member_id from public.training_responses r where r.training_id = p_training_id and r.response = 'attending'
      ) t;
      perform public.notify_program(p_training_id, v_version, v_targets, true);
    else
      -- update: everyone (before or after) in a session whose crew or time changed — people taken out, people whose
      -- boat mate changed, people whose session moved — but not members of untouched sessions
      select coalesce(array_agg(distinct split_part(p.e, ':', 3)::uuid), '{}') into v_targets
        from (select unnest(v_new_pairs) as e union all select unnest(v_old_pairs)) p
       where split_part(p.e, ':', 1) || ':' || split_part(p.e, ':', 2) in (
               select split_part(d.e, ':', 1) || ':' || split_part(d.e, ':', 2) from (
                 (select unnest(v_new_pairs) as e except select unnest(v_old_pairs))
                 union all
                 (select unnest(v_old_pairs) as e except select unnest(v_new_pairs))
               ) d
             );
      perform public.notify_program(p_training_id, v_version, v_targets, false);
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. functions that wrote "start + N hours" into messages now use the real times.
--    (Their bodies are patched in place instead of being copied here; the patch fails loudly if it did not apply.)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
  v_name text;
  v_touched integer := 0;
begin
  for v_name, v_def in
    select p.proname, pg_get_functiondef(p.oid) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('trainings_notify_insert', 'trainings_notify_update', 'run_scheduled_notifications', 'notify_program', 'save_attendance')
  loop
    v_new := v_def;
    v_new := replace(v_new, 'public.tr_range(new.starts_at, new.slot_count)', 'public.tr_span(new.starts_at, new.ends_at)');
    v_new := replace(v_new, 'public.tr_range(v_t.starts_at, v_t.slot_count)', 'public.tr_span(v_t.starts_at, v_t.ends_at)');
    v_new := replace(v_new, 'public.tr_range(v_training.starts_at + a.slot_index * interval ''1 hour'', 1)', 'public.tr_span(a.starts_at, a.ends_at)');
    v_new := replace(v_new, 'if v_needed > 12 then', 'if v_needed > 30 then');
    v_new := replace(v_new, 'Bir antrenman en fazla 12 seans olabilir', 'Bir antrenmanda en fazla 30 seans numarası kullanılabilir');
    if v_new = v_def then
      raise exception 'boat_schedules: nothing to patch in %', v_name;
    end if;
    execute v_new;
    v_touched := v_touched + 1;
  end loop;
  if v_touched <> 5 then
    raise exception 'boat_schedules: expected to patch 5 functions, patched %', v_touched;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. history and export report the session times
-- ---------------------------------------------------------------------------
drop function public.shared_boat_history(uuid);
create function public.shared_boat_history(p_member uuid)
returns table (training_id uuid, starts_at timestamptz, title text, slot_index smallint, boat_id uuid, boat_name text,
               session_starts_at timestamptz, session_ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_active_user() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  if p_member is null or p_member = auth.uid() then
    return;
  end if;
  if not exists (select 1 from public.profiles pf where pf.id = p_member and pf.is_active and pf.role = 'member') then
    raise exception 'Üye bulunamadı' using errcode = 'P0001';
  end if;

  return query
    select t.id, t.starts_at, t.title, a.slot_index, b.id, b.name, a.starts_at, a.ends_at
      from public.program_crew mine
      join public.program_crew theirs on theirs.assignment_id = mine.assignment_id and theirs.member_id = p_member
      join public.program_assignments a on a.id = mine.assignment_id
      join public.training_programs pr on pr.training_id = a.training_id and pr.status = 'published'
      join public.trainings t on t.id = a.training_id and t.status = 'completed'
      join public.boats b on b.id = a.boat_id
      join public.attendance_records am on am.training_id = a.training_id and am.slot_index = a.slot_index
                                        and am.member_id = auth.uid() and am.status = 'present'
      join public.attendance_records ao on ao.training_id = a.training_id and ao.slot_index = a.slot_index
                                        and ao.member_id = p_member and ao.status = 'present'
     where mine.member_id = auth.uid()
     order by t.starts_at desc, a.starts_at, a.slot_index
     limit 200;
end;
$$;

revoke all on function public.shared_boat_history(uuid) from public, anon, authenticated;
grant execute on function public.shared_boat_history(uuid) to authenticated;

drop function public.member_training_history(uuid);
create function public.member_training_history(p_member uuid)
returns table (training_id uuid, starts_at timestamptz, title text, slot_index smallint, boat_id uuid, boat_name text,
               session_starts_at timestamptz, session_ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_active_user() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  if p_member is null then
    return;
  end if;
  if not exists (select 1 from public.profiles pf where pf.id = p_member and pf.is_active and pf.role = 'member') then
    raise exception 'Üye bulunamadı' using errcode = 'P0001';
  end if;

  return query
    select t.id, t.starts_at, t.title, ar.slot_index, x.boat_id, x.boat_name, ar.starts_at, ar.ends_at
      from public.attendance_records ar
      join public.trainings t on t.id = ar.training_id and t.status = 'completed'
      left join (
        select pc.training_id, pc.slot_index, pc.member_id, b.id as boat_id, b.name as boat_name
          from public.program_crew pc
          join public.program_assignments a on a.id = pc.assignment_id
          join public.training_programs pr on pr.training_id = a.training_id and pr.status = 'published'
          join public.boats b on b.id = a.boat_id
      ) x on x.training_id = ar.training_id and x.slot_index = ar.slot_index and x.member_id = ar.member_id
     where ar.member_id = p_member and ar.status = 'present'
     order by t.starts_at desc, ar.starts_at, ar.slot_index
     limit 500;
end;
$$;

revoke all on function public.member_training_history(uuid) from public, anon, authenticated;
grant execute on function public.member_training_history(uuid) to authenticated;

drop function public.attendance_export(date);
create function public.attendance_export(p_month date)
returns table (training_id uuid, starts_at timestamptz, slot_index smallint, member_id uuid, full_name text, status public.attendance_status, note text,
               session_starts_at timestamptz, session_ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_coach() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  return query
    select a.training_id, t.starts_at, a.slot_index, a.member_id, p.full_name, a.status, a.note, a.starts_at, a.ends_at
      from public.attendance_records a
      join public.trainings t on t.id = a.training_id
      join public.profiles p on p.id = a.member_id
     where t.status = 'completed'
       and t.starts_at >= (date_trunc('month', p_month::timestamp) at time zone 'Europe/Istanbul')
       and t.starts_at <  ((date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'Europe/Istanbul')
     order by t.starts_at, a.starts_at, a.slot_index, p.full_name;
end;
$$;

revoke all on function public.attendance_export(date) from public, anon, authenticated;
grant execute on function public.attendance_export(date) to authenticated;
