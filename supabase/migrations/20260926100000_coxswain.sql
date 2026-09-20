-- =====================================================================================================
-- Coxswain (Dümenci) and crew order.
--   * boats.has_coxswain: the C4X is rowed by 4 rowers + 1 dümenci (a separate role, not a fifth seat).
--   * program_crew.is_cox marks the dümenci's row. Rowers keep their seat number = their order in the boat.
--   * A dümenci may be a member or a coach; members can read the coaches' names (coach_directory) to see who steers.
-- =====================================================================================================

-- 1. boats
alter table public.boats add column has_coxswain boolean not null default false;
update public.boats set has_coxswain = true where name = 'C4X';
grant insert (has_coxswain), update (has_coxswain) on table public.boats to authenticated;

-- 2. crew rows
alter table public.program_crew add column is_cox boolean not null default false;
alter table public.program_crew add constraint program_crew_cox_has_no_seat check (not is_cox or seat is null);
create unique index program_crew_one_cox_per_session on public.program_crew (assignment_id) where is_cox;

-- The guard: rowers are members and fill the capacity; the cox is a member or a coach, on a boat that has one, and does not.
create or replace function public.program_crew_guard() returns trigger
language plpgsql as $$
declare
  v_capacity smallint;
  v_boat     text;
  v_has_cox  boolean;
  v_count    integer;
begin
  select b.capacity, b.name, b.has_coxswain into v_capacity, v_boat, v_has_cox
    from public.program_assignments a join public.boats b on b.id = a.boat_id
   where a.id = new.assignment_id;

  if new.is_cox then
    if not v_has_cox then
      raise exception '% teknesinde dümenci olmaz', v_boat using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.profiles p where p.id = new.member_id and p.role in ('member', 'coach')) then
      raise exception 'Dümenci bir üye veya antrenör olmalı' using errcode = 'P0001';
    end if;
    return new;
  end if;

  select count(*) into v_count from public.program_crew where assignment_id = new.assignment_id and not is_cox;
  if v_count + 1 > v_capacity then
    raise exception '% teknesine en fazla % kişi atanabilir', v_boat, v_capacity using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles p where p.id = new.member_id and p.role = 'member') then
    raise exception 'Ekip yalnızca üyelerden oluşabilir' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- 3. the coaches' names, for members (a coach can steer): names only, like member_directory
create view public.coach_directory as
  select p.id, p.full_name
  from public.profiles p
  where p.is_active
    and p.role = 'coach'
    and public.is_active_user();

revoke all on table public.coach_directory from anon, authenticated;
grant select on table public.coach_directory to authenticated;

-- 4. save_program
-- ---------------------------------------------------------------------------
-- save_program: each assignment may carry "cox": uuid | null (the dümenci), next to "crew": [uuid, ...] (the rowers, in seat order).
--   * "crew" is the seating order and is stored as given (seat 1 = first): it is never sorted.
--   * The cox is stored as an extra program_crew row with is_cox = true (no seat); it does not count towards the capacity.
--   * Boats with has_coxswain must have a cox to be PUBLISHED (like requires_full_crew); other boats cannot have one.
--   * The cox can be a member or a coach (the coach steering the boat), and follows the same "nobody is in two boats at
--     once" rule as the rowers.
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
  v_cox_text     text;
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

    -- The coxswain (dümenci) is a separate role, not a fifth rowing seat: at most one per session, only on boats that have one.
    v_cox_text := nullif(btrim(coalesce(v_item->>'cox', '')), '');
    if v_cox_text is not null then
      if not v_boat.has_coxswain then
        raise exception '% teknesinde dümenci olmaz', v_boat.name using errcode = 'P0001';
      end if;
      if v_cox_text !~ v_uuid_re then
        raise exception 'Geçersiz dümenci' using errcode = 'P0001';
      end if;
      if exists (select 1 from jsonb_array_elements_text(v_crew) e where lower(e) = lower(v_cox_text)) then
        raise exception 'Dümenci aynı seansta kürekçi olamaz (%)', public.tr_span(v_start, v_end) using errcode = 'P0001';
      end if;
    elsif p_publish and v_boat.has_coxswain then
      raise exception '% teknesinde dümenci olmalı (% seansı). Dümencisiz yayınlanamaz.', v_boat.name, public.tr_span(v_start, v_end) using errcode = 'P0001';
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

    if v_cox_text is not null then
      select full_name into v_member_name from public.profiles where id = v_cox_text::uuid and role in ('member', 'coach');
      if not found then
        raise exception 'Dümenci bir üye veya antrenör olmalı' using errcode = 'P0001';
      end if;
      if (v_slot || ':' || v_cox_text::uuid) = any (v_seen_members) then
        raise exception '% aynı seansta iki teknede olamaz', v_member_name using errcode = 'P0001';
      end if;
      if not exists (select 1 from public.profiles where id = v_cox_text::uuid and is_active)
         and not ((v_slot || ':' || v_cox_text::uuid) = any (v_prev_members)) then
        raise exception '% devre dışı bırakılmış', v_member_name using errcode = 'P0001';
      end if;
      v_seen_members := v_seen_members || (v_slot || ':' || v_cox_text::uuid);

      insert into public.program_crew (assignment_id, training_id, slot_index, member_id, seat, is_cox)
      values (v_assignment, p_training_id, v_slot, v_cox_text::uuid, null, true);
    end if;
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

-- 5. the settings log knows the new boat field, and the personal program message names the dümenci
--    (patched in place; the patch fails loudly if it did not apply)
do $$
declare
  v_def text;
  v_new text;
  v_name text;
  v_touched integer := 0;
begin
  for v_name, v_def in
    select p.proname, pg_get_functiondef(p.oid) from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('audit_boats', 'notify_program')
  loop
    v_new := v_def;
    v_new := replace(v_new,
      'if new.requires_full_crew is distinct from old.requires_full_crew then v_changed := array_append(v_changed, ''requires_full_crew''); end if;',
      'if new.requires_full_crew is distinct from old.requires_full_crew then v_changed := array_append(v_changed, ''requires_full_crew''); end if;'
      || E'\n    if new.has_coxswain is distinct from old.has_coxswain then v_changed := array_append(v_changed, ''has_coxswain''); end if;');
    -- the crew mates are the OTHER rowers, in seat order; the dümenci is named on its own
    v_new := replace(v_new, 'and c2.member_id <> v_user', 'and c2.member_id <> v_user and not c2.is_cox');
    v_new := replace(v_new, 'b.name || '' · '' ||',
      'b.name || '' · '' || case when c.is_cox then ''dümenci · '''
      || ' when exists (select 1 from public.program_crew cx where cx.assignment_id = a.id and cx.is_cox)'
      || ' then ''dümenci: '' || (select p3.full_name from public.program_crew cx join public.profiles p3 on p3.id = cx.member_id where cx.assignment_id = a.id and cx.is_cox) || '' · '''
      || ' else '''' end ||');
    if v_new = v_def then
      raise exception 'coxswain: nothing to patch in %', v_name;
    end if;
    execute v_new;
    v_touched := v_touched + 1;
  end loop;
  if v_touched <> 2 then
    raise exception 'coxswain: expected to patch 2 functions, patched %', v_touched;
  end if;
end;
$$;
