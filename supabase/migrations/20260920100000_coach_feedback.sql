-- Changes requested after the first field tests.
--
--   1. RSVP locks as soon as the program is PUBLISHED (not only at the deadline).
--   2. Some boats must always be full: boats.requires_full_crew (C4X = exactly 4). Enforced when publishing.
--   3. The coach no longer decides the number of sessions up front. A training starts with
--      slot_count = 0 ("not planned yet"); saving a program (or recording attendance) sets it from what is
--      actually there: highest session with a crew / a record + 1, at most 12. Clients can no longer write it.
--   4. Members can see each other's phone numbers (member_directory gains `phone`; nothing else).
--   5. The RSVP deadline remembers how the coach chose it ("12 saat önce", "Bir önceki akşam 20:00", ...):
--      for an 08:00 training those two are the same instant, and editing the start time must keep the rule.

-- ---------------------------------------------------------------------------
-- 3. sessions come from the program
-- ---------------------------------------------------------------------------
alter table public.trainings drop constraint trainings_slot_count_range;
alter table public.trainings add constraint trainings_slot_count_range check (slot_count between 0 and 12);
alter table public.trainings alter column slot_count set default 0;
revoke insert (slot_count), update (slot_count) on table public.trainings from authenticated;

-- "08:00" while the length is unknown (0 sessions), otherwise "08:00–10:00".
create or replace function public.tr_range(p timestamptz, hours integer) returns text
language sql stable as $$
  select case
    when coalesce(hours, 0) <= 0 then public.tr_time(p)
    else public.tr_time(p) || '–' || public.tr_time(p + hours * interval '1 hour')
  end;
$$;

-- A training cannot lose a session that still has a crew or an attendance record.
create or replace function public.trainings_guard_slot_count() returns trigger
language plpgsql as $$
declare
  v_slot smallint;
begin
  if new.slot_count < old.slot_count then
    select max(s.slot_index) into v_slot from (
      select slot_index from public.program_assignments where training_id = new.id and slot_index >= new.slot_count
      union all
      select slot_index from public.attendance_records where training_id = new.id and slot_index >= new.slot_count
    ) s;
    if v_slot is not null then
      raise exception '% numaralı seansta programda ekip veya yoklama kaydı var. Seans sayısını azaltmadan önce kaldırın.', v_slot + 1
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- The session count is now a by-product of the program, so it no longer counts as "the training changed"
-- (members would otherwise get an "Antrenman güncellendi" message every time the coach saves a draft).
drop trigger trainings_notify_update on public.trainings;

create or replace function public.trainings_notify_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_lines text[] := '{}';
begin
  if old.status = 'scheduled' and new.status = 'cancelled' then
    perform public.notify_active_members(
      'training_cancelled', new.id,
      'Antrenman iptal edildi',
      public.tr_date(new.starts_at) || ' ' || public.tr_range(new.starts_at, new.slot_count)
        || E'\nNeden: ' || coalesce(new.cancel_reason, '-'),
      '/uye/antrenmanlar/' || new.id,
      'training-cancelled:' || new.id
    );
  elsif old.status = 'scheduled' and new.status = 'scheduled'
        and (new.starts_at is distinct from old.starts_at
             or new.rsvp_deadline is distinct from old.rsvp_deadline) then
    if new.starts_at is distinct from old.starts_at then
      v_lines := v_lines || ('Yeni zaman: ' || public.tr_date(new.starts_at) || ' ' || public.tr_range(new.starts_at, new.slot_count));
    end if;
    if new.rsvp_deadline is distinct from old.rsvp_deadline then
      v_lines := v_lines || ('Son yanıt: ' || public.tr_date(new.rsvp_deadline) || ' ' || public.tr_time(new.rsvp_deadline));
    end if;
    perform public.notify_active_members(
      'training_changed', new.id,
      'Antrenman güncellendi',
      array_to_string(v_lines, E'\n'),
      '/uye/antrenmanlar/' || new.id,
      -- every edit is its own event, so the key carries the moment of the change
      'training-changed:' || new.id || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    );
  end if;
  return new;
end;
$$;

create trigger trainings_notify_update
  after update of status, starts_at, rsvp_deadline on public.trainings
  for each row execute function public.trainings_notify_update();

-- ---------------------------------------------------------------------------
-- 5. how the RSVP deadline was chosen (informational for the form; the deadline itself is rsvp_deadline)
-- ---------------------------------------------------------------------------
alter table public.trainings add column rsvp_deadline_rule text;
alter table public.trainings add constraint trainings_rsvp_deadline_rule_values
  check (rsvp_deadline_rule is null or rsvp_deadline_rule in ('12', '24', '48', 'evening', 'custom'));
grant insert (rsvp_deadline_rule), update (rsvp_deadline_rule) on table public.trainings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. boats that must always be full
-- ---------------------------------------------------------------------------
alter table public.boats add column requires_full_crew boolean not null default false;
update public.boats set requires_full_crew = true where name = 'C4X';
grant insert (requires_full_crew), update (requires_full_crew) on table public.boats to authenticated;

-- ---------------------------------------------------------------------------
-- 1. RSVP is locked once the program is published
-- ---------------------------------------------------------------------------
create or replace function public.set_rsvp(
  p_training_id uuid,
  p_response    public.rsvp_response,
  p_note        text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_training public.trainings;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_active_member() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  select * into v_training from public.trainings where id = p_training_id;
  if not found then
    raise exception 'Antrenman bulunamadı' using errcode = 'P0001';
  end if;
  if v_training.status <> 'scheduled' then
    raise exception 'Bu antrenman iptal edildi veya tamamlandı' using errcode = 'P0001';
  end if;
  if public.program_is_published(p_training_id) then
    raise exception 'Program yayınlandığı için yanıtlar kilitlendi. Değişiklik için antrenörünüzle görüşün.' using errcode = 'P0001';
  end if;
  if now() >= v_training.rsvp_deadline then
    raise exception 'Yanıt süresi doldu. Değişiklik için antrenörünüzle görüşün.' using errcode = 'P0001';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'Not en fazla 200 karakter olabilir' using errcode = 'P0001';
  end if;

  insert into public.training_responses (training_id, member_id, response, note, responded_at, set_by_coach)
  values (p_training_id, auth.uid(), p_response, v_note, now(), false)
  on conflict (training_id, member_id) do update
    set response = excluded.response,
        note = excluded.note,
        responded_at = excluded.responded_at,
        set_by_coach = false;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_program: derives the session count, and refuses to publish a boat that must be full but isn't
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
  v_max_slots constant integer := 12;
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

  -- The training is as long as the last session that has a crew (or an attendance record).
  select coalesce(max((e->>'slot_index')::integer) + 1, 0) into v_program_slots
    from jsonb_array_elements(v_assignments) e
   where jsonb_typeof(e->'slot_index') = 'number'
     and jsonb_typeof(e->'crew') = 'array'
     and jsonb_array_length(e->'crew') > 0;
  if v_program_slots > v_max_slots then
    raise exception 'Bir antrenman en fazla % seans olabilir', v_max_slots using errcode = 'P0001';
  end if;
  select coalesce(max(slot_index) + 1, 0) into v_attendance_slots
    from public.attendance_records where training_id = p_training_id;

  select coalesce(array_agg(slot_index || ':' || boat_id), '{}') into v_prev_boats
    from public.program_assignments where training_id = p_training_id;
  select coalesce(array_agg(slot_index || ':' || member_id), '{}') into v_prev_members
    from public.program_crew where training_id = p_training_id;
  -- slot:boat:member triples before the change, to tell who is affected afterwards
  select coalesce(array_agg(a.slot_index || ':' || a.boat_id || ':' || c.member_id), '{}') into v_old_pairs
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

  -- A program with crews decides the length (an empty draft leaves it as it was).
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
    continue when jsonb_array_length(v_crew) = 0;

    v_slot := (v_item->>'slot_index')::integer;
    if v_slot < 0 or v_slot >= v_max_slots then
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

    -- Boats such as the C4X cannot be rowed short-handed: a published program must have them full.
    if p_publish and v_boat.requires_full_crew and jsonb_array_length(v_crew) <> v_boat.capacity then
      raise exception '% teknesinde tam % kişi olmalı (%. seansta % kişi var). Eksik veya fazla ekiple yayınlanamaz.',
        v_boat.name, v_boat.capacity, v_slot + 1, jsonb_array_length(v_crew) using errcode = 'P0001';
    end if;

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

  -- Tell the members (only when publishing, and only if the coach wants to).
  if p_publish and p_notify then
    select version into v_version from public.training_programs where training_id = p_training_id;
    select coalesce(array_agg(a.slot_index || ':' || a.boat_id || ':' || c.member_id), '{}') into v_new_pairs
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
      -- update: everyone (before or after) in a boat-hour whose crew changed — that includes people who were
      -- taken out and people whose boat mate changed, but not members of untouched boats
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
-- save_attendance: recording more sessions than planned extends the training (no program needed)
-- ---------------------------------------------------------------------------
create or replace function public.save_attendance(p_training_id uuid, p_rows jsonb, p_complete boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_training    public.trainings;
  v_item        jsonb;
  v_slot        integer;
  v_member_text text;
  v_member_name text;
  v_status      text;
  v_note        text;
  v_count       integer := 0;
  v_needed      integer;
  v_prev        text[];
  v_seen        text[] := '{}';
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if not public.is_coach() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  select * into v_training from public.trainings where id = p_training_id for update;
  if not found then
    raise exception 'Antrenman bulunamadı' using errcode = 'P0001';
  end if;
  if v_training.status = 'cancelled' then
    raise exception 'İptal edilen antrenmanın yoklaması alınamaz' using errcode = 'P0001';
  end if;
  if now() < v_training.starts_at then
    raise exception 'Yoklama antrenman başladıktan sonra alınabilir' using errcode = 'P0001';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Geçersiz yoklama verisi' using errcode = 'P0001';
  end if;

  -- A training whose length was never planned (or was planned shorter) grows to what was actually rowed.
  select coalesce(max((e->>'slot_index')::integer) + 1, 0) into v_needed
    from jsonb_array_elements(p_rows) e
   where jsonb_typeof(e->'slot_index') = 'number';
  if v_needed > 12 then
    raise exception 'Bir antrenman en fazla 12 seans olabilir' using errcode = 'P0001';
  end if;
  if v_needed > v_training.slot_count then
    update public.trainings set slot_count = v_needed where id = p_training_id;
    v_training.slot_count := v_needed;
  end if;

  -- Members deactivated after being recorded may stay in the record (history) but cannot be newly added.
  select coalesce(array_agg(slot_index || ':' || member_id), '{}') into v_prev
    from public.attendance_records where training_id = p_training_id;

  delete from public.attendance_records where training_id = p_training_id;

  for v_item in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(jsonb_typeof(v_item->'slot_index'), '') <> 'number'
       or coalesce(jsonb_typeof(v_item->'member_id'), '') <> 'string'
       or coalesce(jsonb_typeof(v_item->'status'), '') <> 'string' then
      raise exception 'Geçersiz yoklama verisi' using errcode = 'P0001';
    end if;

    v_slot := (v_item->>'slot_index')::integer;
    if v_slot < 0 or v_slot >= v_training.slot_count then
      raise exception 'Geçersiz seans numarası' using errcode = 'P0001';
    end if;

    v_status := v_item->>'status';
    if v_status not in ('present', 'absent') then
      raise exception 'Geçersiz yoklama durumu' using errcode = 'P0001';
    end if;

    v_member_text := v_item->>'member_id';
    if v_member_text !~ v_uuid_re then
      raise exception 'Geçersiz üye' using errcode = 'P0001';
    end if;
    select full_name into v_member_name from public.profiles where id = v_member_text::uuid and role = 'member';
    if not found then
      raise exception 'Yoklama yalnızca üyeler için alınabilir' using errcode = 'P0001';
    end if;
    if (v_slot || ':' || v_member_text::uuid) = any (v_seen) then
      raise exception '% aynı seans için iki kez girilemez', v_member_name using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.profiles where id = v_member_text::uuid and is_active)
       and not ((v_slot || ':' || v_member_text::uuid) = any (v_prev)) then
      raise exception '% devre dışı bırakılmış', v_member_name using errcode = 'P0001';
    end if;
    v_seen := v_seen || (v_slot || ':' || v_member_text::uuid);

    v_note := nullif(btrim(coalesce(v_item->>'note', '')), '');
    if char_length(coalesce(v_note, '')) > 200 then
      raise exception 'Not en fazla 200 karakter olabilir' using errcode = 'P0001';
    end if;

    insert into public.attendance_records (training_id, slot_index, member_id, status, note, recorded_by)
    values (p_training_id, v_slot, v_member_text::uuid, v_status::public.attendance_status, v_note, auth.uid());
    v_count := v_count + 1;
  end loop;

  if (p_complete or v_training.status = 'completed') and v_count = 0 then
    raise exception 'Yoklamayı tamamlamak için en az bir kayıt girin' using errcode = 'P0001';
  end if;
  if p_complete then
    update public.trainings set status = 'completed' where id = p_training_id and status = 'scheduled';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- reminders: no point asking for an answer once the program is out (the answer is locked)
-- ---------------------------------------------------------------------------
create or replace function public.run_scheduled_notifications()
returns table (reminders integer, summaries integer, pruned integer)
language plpgsql security definer set search_path = public as $$
declare
  v_lead      integer;
  v_reminders integer := 0;
  v_summaries integer := 0;
  v_pruned    integer := 0;
  v_t         public.trainings;
  v_att       integer;
  v_not       integer;
  v_none      integer;
begin
  select reminder_lead_hours into v_lead from public.club_settings;
  v_lead := coalesce(v_lead, 3);

  -- 1) "Yanıt süresi dolmak üzere" — members who have not answered, once per training.
  --    Trainings announced less than an hour ago were just announced with their deadline: no second ping.
  for v_t in
    select * from public.trainings t
     where t.status = 'scheduled'
       and t.deadline_reminder_sent_at is null
       and t.rsvp_deadline > now()
       and t.rsvp_deadline <= now() + v_lead * interval '1 hour'
       and t.created_at <= now() - interval '1 hour'
       and not public.program_is_published(t.id)
     for update
  loop
    insert into public.notification_outbox (user_id, type, training_id, title, body, url, dedupe_key)
    select p.id, 'deadline_reminder', v_t.id,
           'Yanıt süresi dolmak üzere',
           public.tr_date(v_t.starts_at) || ' ' || public.tr_range(v_t.starts_at, v_t.slot_count)
             || E'\nSon yanıt: ' || public.tr_time(v_t.rsvp_deadline) || '. Katılacak mısınız?',
           '/uye/antrenmanlar/' || v_t.id,
           'deadline-reminder:' || v_t.id || ':' || p.id
      from public.profiles p
     where p.role = 'member' and p.is_active
       and not exists (select 1 from public.training_responses r where r.training_id = v_t.id and r.member_id = p.id)
    on conflict (dedupe_key) do nothing;
    update public.trainings set deadline_reminder_sent_at = now() where id = v_t.id;
    v_reminders := v_reminders + 1;
  end loop;

  -- 2) "Yanıt süresi doldu" summary for the coaches (only for deadlines that just passed, not old backlog).
  for v_t in
    select * from public.trainings t
     where t.status = 'scheduled'
       and t.deadline_summary_sent_at is null
       and t.rsvp_deadline <= now()
       and t.rsvp_deadline > now() - interval '12 hours'
       and t.starts_at > now()
     for update
  loop
    select count(*) filter (where r.response = 'attending'),
           count(*) filter (where r.response = 'not_attending')
      into v_att, v_not
      from public.training_responses r
      join public.profiles p on p.id = r.member_id and p.role = 'member' and p.is_active
     where r.training_id = v_t.id;
    select count(*) into v_none
      from public.profiles p
     where p.role = 'member' and p.is_active
       and not exists (select 1 from public.training_responses r where r.training_id = v_t.id and r.member_id = p.id);

    insert into public.notification_outbox (user_id, type, training_id, title, body, url, dedupe_key)
    select c.id, 'deadline_summary', v_t.id,
           'Yanıt süresi doldu',
           public.tr_date(v_t.starts_at) || ' ' || public.tr_range(v_t.starts_at, v_t.slot_count)
             || E'\n' || v_att || ' katılıyor, ' || v_not || ' katılmıyor, ' || v_none || ' yanıt yok.',
           '/antrenor/antrenmanlar/' || v_t.id,
           'deadline-summary:' || v_t.id || ':' || c.id
      from public.profiles c
     where c.role = 'coach' and c.is_active
    on conflict (dedupe_key) do nothing;
    update public.trainings set deadline_summary_sent_at = now() where id = v_t.id;
    v_summaries := v_summaries + 1;
  end loop;

  -- 3) housekeeping: the inbox keeps 60 days
  delete from public.notification_outbox where created_at < now() - interval '60 days';
  get diagnostics v_pruned = row_count;

  return query select v_reminders, v_summaries, v_pruned;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. members can see each other's phone number — and still nothing else (no username, role or status)
-- ---------------------------------------------------------------------------
create or replace view public.member_directory as
  select p.id, p.full_name, p.phone
  from public.profiles p
  where p.is_active
    and p.role = 'member'
    and public.is_active_user();
