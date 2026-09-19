-- Phase 4: attendance, history and monthly statistics.
--
-- Attendance is what ACTUALLY happened, recorded by a coach per 1-hour session (slot) and member.
-- It is deliberately separate from the RSVP ("Katılıyorum") and from the planned program:
--   * one row per (training, session, member) with status present | absent
--   * statistics count PRESENT rows: rowing 2 sessions counts as 2 ("seans"); training days are
--     counted separately as a secondary figure
--   * only COMPLETED trainings count, and a training belongs to the calendar month of its start
--     in club time (Europe/Istanbul) — the leaderboard "resets" simply because it is month-bucketed
--
-- Rules enforced here (the UI mirrors them):
--   * only coaches record attendance, only through save_attendance(), and only once the training
--     has started; cancelled trainings have no attendance
--   * a coach can save progress (training stays "scheduled") or finish (training becomes "completed")
--   * members read only their own rows; leaderboard numbers reach everyone only as aggregates

create type public.attendance_status as enum ('present', 'absent');

create table public.attendance_records (
  training_id uuid not null references public.trainings (id) on delete cascade,
  slot_index  smallint not null,
  member_id   uuid not null references public.profiles (id) on delete restrict,
  status      public.attendance_status not null,
  note        text,
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  recorded_at timestamptz not null default now(),
  primary key (training_id, slot_index, member_id),
  constraint attendance_slot_nonneg check (slot_index >= 0),
  constraint attendance_note_len check (note is null or char_length(note) <= 200)
);

create index attendance_records_member_idx on public.attendance_records (member_id, training_id);

alter table public.attendance_records enable row level security;

create function public.attendance_records_guard() returns trigger
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

create trigger attendance_records_guard
  before insert or update of slot_index, training_id on public.attendance_records
  for each row execute function public.attendance_records_guard();

revoke all on function public.attendance_records_guard() from public, anon, authenticated;

-- Read-only for clients: a member sees their own rows, a coach sees everyone's.
revoke all on table public.attendance_records from anon, authenticated;
grant select on table public.attendance_records to authenticated;

create policy attendance_select_own on public.attendance_records
  for select to authenticated
  using (member_id = auth.uid() and public.is_active_user());

create policy attendance_select_coach on public.attendance_records
  for select to authenticated
  using (public.is_coach());

-- ---------------------------------------------------------------------------
-- save_attendance(): replaces the attendance of a training atomically.
--   p_rows     = [ { "slot_index": 0, "member_id": uuid, "status": "present" | "absent", "note": text? } ]
--   p_complete = true  -> the training becomes "completed" and enters the statistics
--              = false -> progress is saved, the training stays as it is
-- A completed training can be corrected later (it stays completed).
-- ---------------------------------------------------------------------------
create function public.save_attendance(p_training_id uuid, p_rows jsonb, p_complete boolean default false) returns void
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

revoke all on function public.save_attendance(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.save_attendance(uuid, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Monthly statistics. Internal helper: every ACTIVE member with their numbers for the calendar
-- month (club time) that contains p_month. Rank is standard competition ranking (1,2,2,4): members
-- with equal sessions share a rank; members without any session have no rank.
-- Not callable by clients: the public functions below decide who may see what.
-- ---------------------------------------------------------------------------
create function public.attendance_month_internal(p_month date)
returns table (member_id uuid, full_name text, sessions integer, training_days integer, rank integer)
language sql stable security definer set search_path = public as $$
  with bounds as (
    select (date_trunc('month', p_month::timestamp) at time zone 'Europe/Istanbul') as lo,
           ((date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'Europe/Istanbul') as hi
  ),
  counts as (
    select a.member_id,
           count(*)::integer as sessions,
           count(distinct a.training_id)::integer as training_days
      from public.attendance_records a
      join public.trainings t on t.id = a.training_id
      cross join bounds b
     where a.status = 'present'
       and t.status = 'completed'
       and t.starts_at >= b.lo and t.starts_at < b.hi
     group by a.member_id
  )
  select p.id,
         p.full_name,
         coalesce(c.sessions, 0),
         coalesce(c.training_days, 0),
         case when coalesce(c.sessions, 0) > 0
              then (rank() over (order by coalesce(c.sessions, 0) desc))::integer
         end
    from public.profiles p
    left join counts c on c.member_id = p.id
   where p.role = 'member' and p.is_active;
$$;

revoke all on function public.attendance_month_internal(date) from public, anon, authenticated;

-- Leaderboard: visible to every signed-in user; only members with at least one session, best first.
create function public.monthly_leaderboard(p_month date)
returns table (member_id uuid, full_name text, sessions integer, training_days integer, rank integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_user() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  return query
    select m.member_id, m.full_name, m.sessions, m.training_days, m.rank
      from public.attendance_month_internal(p_month) m
     where m.sessions > 0
     order by m.rank, m.full_name;
end;
$$;

-- The caller's own month: sessions, training days, rank (null without sessions) and how many members rowed.
create function public.my_month_stats(p_month date)
returns table (sessions integer, training_days integer, rank integer, participants integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_user() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  return query
    select coalesce(me.sessions, 0),
           coalesce(me.training_days, 0),
           me.rank,
           (select count(*)::integer from public.attendance_month_internal(p_month) x where x.sessions > 0)
      from (select 1) one
      left join public.attendance_month_internal(p_month) me on me.member_id = auth.uid();
end;
$$;

-- Coach: every active member for the month, including those with zero sessions.
create function public.coach_month_table(p_month date)
returns table (member_id uuid, full_name text, sessions integer, training_days integer, rank integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_coach() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  return query
    select m.member_id, m.full_name, m.sessions, m.training_days, m.rank
      from public.attendance_month_internal(p_month) m
     order by m.sessions desc, m.full_name;
end;
$$;

-- Coach: the raw records of a month (for the CSV export). Includes members who have since left.
create function public.attendance_export(p_month date)
returns table (training_id uuid, starts_at timestamptz, slot_index smallint, member_id uuid, full_name text, status public.attendance_status, note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_coach() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  return query
    select a.training_id, t.starts_at, a.slot_index, a.member_id, p.full_name, a.status, a.note
      from public.attendance_records a
      join public.trainings t on t.id = a.training_id
      join public.profiles p on p.id = a.member_id
     where t.status = 'completed'
       and t.starts_at >= (date_trunc('month', p_month::timestamp) at time zone 'Europe/Istanbul')
       and t.starts_at <  ((date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'Europe/Istanbul')
     order by t.starts_at, a.slot_index, p.full_name;
end;
$$;

-- Coach: "5 kişi · 9 seans" for a list of trainings (avoids downloading every record).
create function public.training_attendance_counts(p_training_ids uuid[])
returns table (training_id uuid, sessions integer, members integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_coach() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  return query
    select a.training_id,
           (count(*) filter (where a.status = 'present'))::integer,
           (count(distinct a.member_id) filter (where a.status = 'present'))::integer
      from public.attendance_records a
     where a.training_id = any (p_training_ids)
     group by a.training_id;
end;
$$;

revoke all on function public.monthly_leaderboard(date) from public, anon, authenticated;
revoke all on function public.my_month_stats(date) from public, anon, authenticated;
revoke all on function public.coach_month_table(date) from public, anon, authenticated;
revoke all on function public.attendance_export(date) from public, anon, authenticated;
revoke all on function public.training_attendance_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.monthly_leaderboard(date) to authenticated;
grant execute on function public.my_month_stats(date) to authenticated;
grant execute on function public.coach_month_table(date) to authenticated;
grant execute on function public.attendance_export(date) to authenticated;
grant execute on function public.training_attendance_counts(uuid[]) to authenticated;
