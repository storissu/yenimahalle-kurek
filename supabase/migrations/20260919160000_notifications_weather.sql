-- Phase 5: notifications (outbox + inbox) and cached weather.
--
-- NOTIFICATIONS. Every event that concerns people inserts one row per recipient into
-- notification_outbox. That table is BOTH the in-app inbox (members read their own rows) and the
-- push queue (an Edge Function sends rows whose push_done_at is null). Inserts are idempotent through
-- dedupe_key, so a retry or a re-run never notifies twice.
--
--   event                      recipients                               where it fires
--   -------------------------  ---------------------------------------  -----------------------------
--   training_new               all active members                       trigger: training inserted
--   training_changed           all active members                       trigger: time/sessions/deadline edited
--   training_cancelled         all active members                       trigger: status -> cancelled
--   deadline_reminder          members WITHOUT an answer                run_scheduled_notifications()
--   deadline_summary           active coaches                           run_scheduled_notifications()
--   program_published          crew + attending members without a boat  save_program(publish, notify)
--   program_updated            members whose boat/hour/crew changed     save_program(publish, notify)
--
-- WEATHER. weather_snapshots holds one forecast row per (training, session), written by the
-- refresh-weather Edge Function (service role) and readable by every signed-in user.

-- ---------------------------------------------------------------------------
-- settings / bookkeeping columns
-- ---------------------------------------------------------------------------
alter table public.club_settings
  add column reminder_lead_hours integer not null default 3,
  add constraint club_settings_reminder_lead check (reminder_lead_hours between 1 and 24);

grant update (reminder_lead_hours) on table public.club_settings to authenticated;

alter table public.trainings add column deadline_summary_sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- Turkish text helpers (club time). Internal: only the definer functions below use them.
-- ---------------------------------------------------------------------------
create function public.tr_date(p timestamptz) returns text
language sql stable as $$
  select extract(day from p at time zone 'Europe/Istanbul')::integer::text
      || ' ' || (array['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'])[extract(month from p at time zone 'Europe/Istanbul')::integer]
      || ' ' || (array['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'])[extract(dow from p at time zone 'Europe/Istanbul')::integer + 1];
$$;

create function public.tr_time(p timestamptz) returns text
language sql stable as $$
  select to_char(p at time zone 'Europe/Istanbul', 'HH24:MI');
$$;

/** "08:00–10:00" for `hours` one-hour sessions starting at p. */
create function public.tr_range(p timestamptz, hours integer) returns text
language sql stable as $$
  select public.tr_time(p) || '–' || public.tr_time(p + hours * interval '1 hour');
$$;

/** "tek başına" / "Jamie ile" / "Jamie ve Ali ile" / "Jamie, Ali ve Becca ile" */
create function public.tr_mates(p_names text[]) returns text
language sql immutable as $$
  select case coalesce(array_length(p_names, 1), 0)
    when 0 then 'tek başına'
    when 1 then p_names[1] || ' ile'
    else array_to_string(p_names[1:array_length(p_names, 1) - 1], ', ') || ' ve ' || p_names[array_length(p_names, 1)] || ' ile'
  end;
$$;

revoke all on function public.tr_date(timestamptz) from public, anon, authenticated;
revoke all on function public.tr_time(timestamptz) from public, anon, authenticated;
revoke all on function public.tr_range(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.tr_mates(text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- notification_outbox = inbox + push queue
-- ---------------------------------------------------------------------------
create type public.notification_type as enum (
  'training_new', 'training_changed', 'training_cancelled',
  'deadline_reminder', 'deadline_summary',
  'program_published', 'program_updated'
);

create table public.notification_outbox (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  type          public.notification_type not null,
  training_id   uuid references public.trainings (id) on delete cascade,
  title         text not null,
  body          text not null,
  url           text not null default '/',
  dedupe_key    text not null,
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  push_done_at  timestamptz,           -- null = still to be pushed
  push_attempts smallint not null default 0,
  push_error    text,
  constraint notification_outbox_dedupe unique (dedupe_key),
  constraint notification_outbox_url_internal check (url like '/%' and url not like '//%')
);

create index notification_outbox_user_idx on public.notification_outbox (user_id, created_at desc);
create index notification_outbox_pending_idx on public.notification_outbox (created_at) where push_done_at is null;

alter table public.notification_outbox enable row level security;

-- A user reads their own rows and may mark them read. Nothing else is client-writable.
revoke all on table public.notification_outbox from anon, authenticated;
grant select on table public.notification_outbox to authenticated;
grant update (read_at) on table public.notification_outbox to authenticated;

create policy notification_outbox_select_own on public.notification_outbox
  for select to authenticated
  using (user_id = auth.uid() and public.is_active_user());

create policy notification_outbox_mark_read on public.notification_outbox
  for update to authenticated
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid());

-- Same message to every active member (idempotent per recipient).
create function public.notify_active_members(
  p_type public.notification_type, p_training uuid, p_title text, p_body text, p_url text, p_dedupe_prefix text
) returns void
language sql security definer set search_path = public as $$
  insert into public.notification_outbox (user_id, type, training_id, title, body, url, dedupe_key)
  select p.id, p_type, p_training, p_title, p_body, p_url, p_dedupe_prefix || ':' || p.id
    from public.profiles p
   where p.role = 'member' and p.is_active
  on conflict (dedupe_key) do nothing;
$$;

revoke all on function public.notify_active_members(public.notification_type, uuid, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- training events
-- ---------------------------------------------------------------------------
create function public.trainings_notify_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'scheduled' then
    perform public.notify_active_members(
      'training_new', new.id,
      'Yeni antrenman' || coalesce(': ' || new.title, ''),
      public.tr_date(new.starts_at) || ' ' || public.tr_range(new.starts_at, new.slot_count)
        || E'\nSon yanıt: ' || public.tr_date(new.rsvp_deadline) || ' ' || public.tr_time(new.rsvp_deadline),
      '/uye/antrenmanlar/' || new.id,
      'training-new:' || new.id
    );
  end if;
  return new;
end;
$$;

create function public.trainings_notify_update() returns trigger
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
             or new.slot_count is distinct from old.slot_count
             or new.rsvp_deadline is distinct from old.rsvp_deadline) then
    if new.starts_at is distinct from old.starts_at or new.slot_count is distinct from old.slot_count then
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

create trigger trainings_notify_insert
  after insert on public.trainings
  for each row execute function public.trainings_notify_insert();

create trigger trainings_notify_update
  after update of status, starts_at, slot_count, rsvp_deadline on public.trainings
  for each row execute function public.trainings_notify_update();

revoke all on function public.trainings_notify_insert() from public, anon, authenticated;
revoke all on function public.trainings_notify_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- program events: personal messages ("Mavi · 09:00–10:00 · Jamie ile")
-- ---------------------------------------------------------------------------
create function public.notify_program(p_training uuid, p_version integer, p_targets uuid[], p_first boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_training public.trainings;
  v_user     uuid;
  v_lines    text;
  v_title    text;
  v_body     text;
begin
  select * into v_training from public.trainings where id = p_training;
  if not found then
    return;
  end if;

  for v_user in
    select p.id from public.profiles p where p.id = any (p_targets) and p.role = 'member' and p.is_active
  loop
    select string_agg(
             public.tr_range(v_training.starts_at + a.slot_index * interval '1 hour', 1) || ' · ' || b.name || ' · ' ||
             public.tr_mates(array(
               select p2.full_name from public.program_crew c2
                 join public.profiles p2 on p2.id = c2.member_id
                where c2.assignment_id = a.id and c2.member_id <> v_user
                order by c2.seat
             )),
             E'\n' order by a.slot_index)
      into v_lines
      from public.program_crew c
      join public.program_assignments a on a.id = c.assignment_id
      join public.boats b on b.id = a.boat_id
     where c.training_id = p_training and c.member_id = v_user;

    if v_lines is not null then
      v_title := case when p_first then 'Programınız hazır' else 'Programınız güncellendi' end;
      v_body := public.tr_date(v_training.starts_at) || E'\n' || v_lines;
    elsif p_first then
      v_title := 'Program yayınlandı';
      v_body := 'Henüz bir tekneye atanmadınız. Antrenörünüzle görüşün.';
    else
      v_title := 'Programınız güncellendi';
      v_body := 'Bu antrenmanda artık bir tekneye atanmadınız.';
    end if;

    insert into public.notification_outbox (user_id, type, training_id, title, body, url, dedupe_key)
    values (
      v_user,
      case when p_first then 'program_published'::public.notification_type else 'program_updated'::public.notification_type end,
      p_training, v_title, v_body, '/uye/antrenmanlar/' || p_training,
      'program-v' || p_version || ':' || p_training || ':' || v_user
    )
    on conflict (dedupe_key) do nothing;
  end loop;
end;
$$;

revoke all on function public.notify_program(uuid, integer, uuid[], boolean) from public, anon, authenticated;

-- save_program gains p_notify (default true). The old 3-argument version is replaced.
drop function public.save_program(uuid, jsonb, boolean);

create function public.save_program(p_training_id uuid, p_payload jsonb, p_publish boolean, p_notify boolean default true) returns void
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

  for v_item in select value from jsonb_array_elements(v_assignments) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(jsonb_typeof(v_item->'slot_index'), '') <> 'number'
       or coalesce(jsonb_typeof(v_item->'crew'), '') <> 'array' then
      raise exception 'Geçersiz program verisi' using errcode = 'P0001';
    end if;

    v_crew := v_item->'crew';
    continue when jsonb_array_length(v_crew) = 0;

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

revoke all on function public.save_program(uuid, jsonb, boolean, boolean) from public, anon, authenticated;
grant execute on function public.save_program(uuid, jsonb, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- scheduled events (run every few minutes by pg_cron, see the *_schedule migration)
-- ---------------------------------------------------------------------------
create function public.run_scheduled_notifications()
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

revoke all on function public.run_scheduled_notifications() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- weather_snapshots: one forecast row per (training, session)
-- ---------------------------------------------------------------------------
create table public.weather_snapshots (
  training_id   uuid not null references public.trainings (id) on delete cascade,
  slot_index    smallint not null,
  fetched_at    timestamptz not null default now(),
  source        text not null,
  forecast_for  timestamptz not null,        -- start of the hour the values describe
  temperature_c numeric,
  apparent_c    numeric,
  wind_kmh      numeric,
  gust_kmh      numeric,
  wind_dir_deg  numeric,
  precip_prob   numeric,
  precip_mm     numeric,
  weather_code  smallint,                    -- WMO code
  cloud_pct     numeric,
  wave_height_m numeric,
  wave_period_s numeric,
  wave_dir_deg  numeric,
  primary key (training_id, slot_index),
  constraint weather_slot_nonneg check (slot_index >= 0)
);

alter table public.weather_snapshots enable row level security;

-- Written only by the refresh-weather Edge Function (service role); readable by every signed-in user.
revoke all on table public.weather_snapshots from anon, authenticated;
grant select on table public.weather_snapshots to authenticated;

create policy weather_snapshots_select on public.weather_snapshots
  for select to authenticated
  using (public.is_active_user());
