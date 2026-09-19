-- Phase 6: audit log ("who changed what") + a tiny keep-alive endpoint.
--
-- The log is written ONLY by the database itself (triggers and the internal log_audit() function), so
-- no client can add, change or delete entries, and members cannot read them at all. Coaches read it in
-- the app (Diğer → Değişiklik geçmişi). Nothing secret is stored: no passwords, no phone numbers, only
-- names of people/trainings and which fields changed.
--
-- What is recorded (category / action):
--   training    training.create | training.edit | training.cancel | training.complete | rsvp.coach
--   program     program.draft | program.publish | program.update | program.unpublish
--   attendance  attendance.save
--   settings    boat.create | boat.update | settings.update
--   member      member.edit (name/phone, by a coach)  — create / reset password / (de)activate are written by
--               the Edge Functions through log_audit(..., p_actor)
-- Repeated identical events inside ONE transaction (e.g. the many rows of one attendance save) are merged
-- into a single entry with a running count, so a save is one line, not thirty.

create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  tx         bigint not null default txid_current(),
  actor_id   uuid references public.profiles (id) on delete set null,
  actor_name text,
  category   text not null,
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  summary    text not null,
  detail     jsonb not null default '{}'::jsonb,
  constraint audit_log_category check (category in ('training', 'program', 'attendance', 'member', 'settings')),
  constraint audit_log_summary_len check (char_length(summary) between 1 and 300)
);

create unique index audit_log_merge_idx on public.audit_log (tx, action, entity_id) where entity_id is not null;
create index audit_log_at_idx on public.audit_log (at desc, id desc);
create index audit_log_category_idx on public.audit_log (category, at desc);

alter table public.audit_log enable row level security;

-- Coaches read; nobody writes from the client.
revoke all on table public.audit_log from anon, authenticated;
grant select on table public.audit_log to authenticated;

create policy audit_log_select_coach on public.audit_log
  for select to authenticated
  using (public.is_coach());

-- Internal writer. The actor is the signed-in user, or p_actor when an Edge Function (service role) records
-- something on a coach's behalf. Not callable by app users.
create function public.log_audit(
  p_category  text,
  p_action    text,
  p_entity    text,
  p_entity_id uuid,
  p_summary   text,
  p_detail    jsonb default '{}'::jsonb,
  p_actor     uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_name  text;
begin
  select full_name into v_name from public.profiles where id = v_actor;
  if not found then
    v_actor := null;
  end if;

  insert into public.audit_log (actor_id, actor_name, category, action, entity, entity_id, summary, detail)
  values (v_actor, v_name, p_category, p_action, p_entity, p_entity_id, left(p_summary, 300), coalesce(p_detail, '{}'::jsonb))
  on conflict (tx, action, entity_id) where entity_id is not null
  do update set detail = jsonb_set(
    public.audit_log.detail,
    '{count}',
    to_jsonb(coalesce((public.audit_log.detail ->> 'count')::integer, 1) + 1)
  );
end;
$$;

revoke all on function public.log_audit(text, text, text, uuid, text, jsonb, uuid) from public, anon, authenticated;

-- Entries older than a year are dropped (called daily by pg_cron, see the *_schedule migration).
create function public.prune_audit_log() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_deleted integer;
begin
  delete from public.audit_log where at < now() - interval '1 year';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_audit_log() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- trainings
-- ---------------------------------------------------------------------------
create function public.audit_trainings() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_when    text := public.tr_date(new.starts_at) || ' ' || public.tr_time(new.starts_at);
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('training', 'training.create', 'training', new.id, 'Antrenman oluşturuldu: ' || v_when, '{}'::jsonb, new.created_by);
  elsif old.status = 'scheduled' and new.status = 'cancelled' then
    perform public.log_audit('training', 'training.cancel', 'training', new.id,
      'Antrenman iptal edildi: ' || v_when || coalesce(' — ' || new.cancel_reason, ''));
  elsif old.status = 'scheduled' and new.status = 'completed' then
    perform public.log_audit('training', 'training.complete', 'training', new.id, 'Yoklama tamamlandı: ' || v_when);
  else
    if new.title is distinct from old.title then v_changed := array_append(v_changed, 'title'); end if;
    if new.starts_at is distinct from old.starts_at then v_changed := array_append(v_changed, 'starts_at'); end if;
    if new.rsvp_deadline is distinct from old.rsvp_deadline then v_changed := array_append(v_changed, 'rsvp_deadline'); end if;
    if new.notes is distinct from old.notes then v_changed := array_append(v_changed, 'notes'); end if;
    if array_length(v_changed, 1) is not null then
      perform public.log_audit('training', 'training.edit', 'training', new.id, 'Antrenman düzenlendi: ' || v_when,
        jsonb_build_object('fields', to_jsonb(v_changed)));
    end if;
  end if;
  return null;
end;
$$;

create trigger audit_trainings
  after insert or update on public.trainings
  for each row execute function public.audit_trainings();

-- ---------------------------------------------------------------------------
-- programs: draft saved / published / updated / taken back
-- ---------------------------------------------------------------------------
create function public.audit_programs() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_when   text;
  v_action text;
  v_text   text;
begin
  select public.tr_date(starts_at) || ' ' || public.tr_time(starts_at) into v_when from public.trainings where id = new.training_id;

  if tg_op = 'INSERT' then
    v_action := case when new.status = 'published' then 'program.publish' else 'program.draft' end;
  elsif old.status = 'draft' and new.status = 'published' then
    v_action := 'program.publish';
  elsif old.status = 'published' and new.status = 'published' then
    v_action := 'program.update';
  elsif old.status = 'published' and new.status = 'draft' then
    v_action := 'program.unpublish';
  else
    v_action := 'program.draft';
  end if;

  v_text := case v_action
    when 'program.publish'   then 'Program yayınlandı (sürüm ' || new.version || '): '
    when 'program.update'    then 'Program güncellendi (sürüm ' || new.version || '): '
    when 'program.unpublish' then 'Program yayından kaldırıldı: '
    else 'Program taslağı kaydedildi: '
  end || coalesce(v_when, '');

  perform public.log_audit('program', v_action, 'training', new.training_id, v_text, jsonb_build_object('version', new.version));
  return null;
end;
$$;

create trigger audit_programs
  after insert or update on public.training_programs
  for each row execute function public.audit_programs();

-- ---------------------------------------------------------------------------
-- RSVPs a coach entered on a member's behalf (members' own answers are not logged)
-- ---------------------------------------------------------------------------
create function public.audit_coach_rsvp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_member text;
  v_when   text;
begin
  select full_name into v_member from public.profiles where id = new.member_id;
  select public.tr_date(starts_at) || ' ' || public.tr_time(starts_at) into v_when from public.trainings where id = new.training_id;
  perform public.log_audit('training', 'rsvp.coach', 'training', new.training_id,
    coalesce(v_member, 'Üye') || ' için yanıt girildi (' || case new.response when 'attending' then 'Katılıyor' else 'Katılmıyor' end || '): ' || coalesce(v_when, ''),
    jsonb_build_object('member_id', new.member_id, 'response', new.response));
  return null;
end;
$$;

create trigger audit_coach_rsvp
  after insert or update on public.training_responses
  for each row when (new.set_by_coach)
  execute function public.audit_coach_rsvp();

-- ---------------------------------------------------------------------------
-- attendance: one entry per save (the rows of a save are merged, see log_audit)
-- ---------------------------------------------------------------------------
create function public.audit_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_when text;
begin
  select public.tr_date(starts_at) || ' ' || public.tr_time(starts_at) into v_when from public.trainings where id = new.training_id;
  perform public.log_audit('attendance', 'attendance.save', 'training', new.training_id, 'Yoklama kaydedildi: ' || coalesce(v_when, ''), '{"count": 1}'::jsonb);
  return null;
end;
$$;

create trigger audit_attendance
  after insert on public.attendance_records
  for each row execute function public.audit_attendance();

-- ---------------------------------------------------------------------------
-- boats, club settings
-- ---------------------------------------------------------------------------
create function public.audit_boats() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('settings', 'boat.create', 'boat', new.id, 'Tekne eklendi: ' || new.name || ' (' || new.capacity || ' kişilik)');
  else
    if new.name is distinct from old.name then v_changed := array_append(v_changed, 'name'); end if;
    if new.capacity is distinct from old.capacity then v_changed := array_append(v_changed, 'capacity'); end if;
    if new.is_active is distinct from old.is_active then v_changed := array_append(v_changed, 'is_active'); end if;
    if new.requires_full_crew is distinct from old.requires_full_crew then v_changed := array_append(v_changed, 'requires_full_crew'); end if;
    if array_length(v_changed, 1) is not null then
      perform public.log_audit('settings', 'boat.update', 'boat', new.id, 'Tekne güncellendi: ' || new.name, jsonb_build_object('fields', to_jsonb(v_changed)));
    end if;
  end if;
  return null;
end;
$$;

create trigger audit_boats
  after insert or update on public.boats
  for each row execute function public.audit_boats();

create function public.audit_club_settings() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_changed text[] := '{}';
begin
  if new.default_rsvp_lead_hours is distinct from old.default_rsvp_lead_hours then v_changed := array_append(v_changed, 'default_rsvp_lead_hours'); end if;
  if new.reminder_lead_hours is distinct from old.reminder_lead_hours then v_changed := array_append(v_changed, 'reminder_lead_hours'); end if;
  if new.wind_gust_warn_kmh is distinct from old.wind_gust_warn_kmh then v_changed := array_append(v_changed, 'wind_gust_warn_kmh'); end if;
  if new.wave_warn_m is distinct from old.wave_warn_m then v_changed := array_append(v_changed, 'wave_warn_m'); end if;
  if array_length(v_changed, 1) is not null then
    perform public.log_audit('settings', 'settings.update', 'settings', null, 'Kulüp ayarları güncellendi', jsonb_build_object('fields', to_jsonb(v_changed)));
  end if;
  return null;
end;
$$;

create trigger audit_club_settings
  after update on public.club_settings
  for each row execute function public.audit_club_settings();

-- ---------------------------------------------------------------------------
-- members: a coach editing a name or phone (values are NOT stored, only which fields changed)
-- Account creation, password resets and (de)activation happen in Edge Functions, which log them themselves.
-- ---------------------------------------------------------------------------
create function public.audit_profiles() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_changed text[] := '{}';
begin
  if auth.uid() is null then
    return null; -- service-role writes are logged by the Edge Function that made them
  end if;
  if new.full_name is distinct from old.full_name then v_changed := array_append(v_changed, 'full_name'); end if;
  if new.phone is distinct from old.phone then v_changed := array_append(v_changed, 'phone'); end if;
  if array_length(v_changed, 1) is not null then
    perform public.log_audit('member', 'member.edit', 'profile', new.id, 'Üye bilgisi düzenlendi: ' || new.full_name, jsonb_build_object('fields', to_jsonb(v_changed)));
  end if;
  return null;
end;
$$;

create trigger audit_profiles
  after update on public.profiles
  for each row execute function public.audit_profiles();

revoke all on function public.audit_trainings() from public, anon, authenticated;
revoke all on function public.audit_programs() from public, anon, authenticated;
revoke all on function public.audit_coach_rsvp() from public, anon, authenticated;
revoke all on function public.audit_attendance() from public, anon, authenticated;
revoke all on function public.audit_boats() from public, anon, authenticated;
revoke all on function public.audit_club_settings() from public, anon, authenticated;
revoke all on function public.audit_profiles() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- keep-alive: a public, data-free endpoint the "keep-alive" GitHub workflow calls so the free project
-- never gets paused for inactivity. It returns the server time and nothing else.
-- ---------------------------------------------------------------------------
create function public.ping() returns timestamptz
language sql stable as $$
  select now();
$$;

revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
