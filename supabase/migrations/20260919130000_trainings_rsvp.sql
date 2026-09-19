-- Phase 2: trainings and RSVP ("Katılıyorum / Katılmıyorum" + optional note).
--
-- A training is one event made of 1..6 consecutive 1-hour sessions ("seans"):
--   starts_at = first session start, ends at starts_at + slot_count hours.
-- RSVP is per TRAINING (not per hour): "attending" means present that day, whichever hour the
-- coach assigns. The optional note carries special wishes ("9'dan sonraya yazar mısınız?").
--
-- Rules enforced here (the UI only mirrors them):
--   * Only coaches create/edit/cancel trainings. Cancelling goes through cancel_training().
--   * Members answer only through set_rsvp(): allowed while now() < rsvp_deadline (SERVER time)
--     and the training is still scheduled. Nobody can write training_responses directly.
--   * After the deadline only a coach can record an answer on a member's behalf (coach_set_rsvp()).

create type public.training_status as enum ('scheduled', 'cancelled', 'completed');
create type public.rsvp_response as enum ('attending', 'not_attending');

-- ---------------------------------------------------------------------------
-- helper: active member (role = member)
-- ---------------------------------------------------------------------------
create function public.is_active_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'member' and p.is_active
  );
$$;

revoke all on function public.is_active_member() from public, anon, authenticated;
grant execute on function public.is_active_member() to authenticated;

-- Lets the app show deadline countdowns in server time even when a phone's clock is wrong.
create function public.server_now() returns timestamptz
language sql stable as $$
  select now();
$$;

revoke all on function public.server_now() from public, anon, authenticated;
grant execute on function public.server_now() to authenticated;

-- ---------------------------------------------------------------------------
-- trainings
-- ---------------------------------------------------------------------------
create table public.trainings (
  id                        uuid primary key default gen_random_uuid(),
  title                     text,
  starts_at                 timestamptz not null,
  slot_count                smallint not null default 1,
  rsvp_deadline             timestamptz not null,
  status                    public.training_status not null default 'scheduled',
  cancel_reason             text,
  notes                     text,
  deadline_reminder_sent_at timestamptz,
  created_by                uuid not null references public.profiles (id) on delete restrict,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint trainings_slot_count_range check (slot_count between 1 and 6),
  constraint trainings_deadline_before_start check (rsvp_deadline <= starts_at),
  constraint trainings_title_len check (title is null or char_length(btrim(title)) between 1 and 80),
  constraint trainings_notes_len check (notes is null or char_length(notes) <= 500),
  constraint trainings_cancel_reason_consistent check (
    (status = 'cancelled') = (cancel_reason is not null)
  ),
  constraint trainings_cancel_reason_len check (
    cancel_reason is null or char_length(cancel_reason) between 3 and 200
  )
);

create index trainings_starts_at_idx on public.trainings (starts_at desc);

alter table public.trainings enable row level security;

create trigger trainings_touch_updated_at
  before update on public.trainings
  for each row execute function public.touch_updated_at();

-- created_by always comes from the session, never from the client.
create function public.trainings_set_created_by() returns trigger
language plpgsql as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end;
$$;

create trigger trainings_set_created_by
  before insert on public.trainings
  for each row execute function public.trainings_set_created_by();

revoke all on function public.trainings_set_created_by() from public, anon, authenticated;

-- Clients may read everything and edit only the plain fields of a still-scheduled training.
-- status / cancel_reason change only through cancel_training() (and later the attendance RPC).
revoke all on table public.trainings from anon, authenticated;
grant select on table public.trainings to authenticated;
grant insert (title, starts_at, slot_count, rsvp_deadline, notes) on table public.trainings to authenticated;
grant update (title, starts_at, slot_count, rsvp_deadline, notes) on table public.trainings to authenticated;

create policy trainings_select on public.trainings
  for select to authenticated
  using (public.is_active_user());

create policy trainings_insert_coach on public.trainings
  for insert to authenticated
  with check (public.is_coach());

create policy trainings_update_coach on public.trainings
  for update to authenticated
  using (public.is_coach() and status = 'scheduled')
  with check (public.is_coach());

create function public.cancel_training(p_training_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_coach() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 200 then
    raise exception 'İptal nedeni 3–200 karakter olmalı' using errcode = 'P0001';
  end if;

  update public.trainings
     set status = 'cancelled', cancel_reason = v_reason
   where id = p_training_id and status = 'scheduled';

  if not found then
    raise exception 'Antrenman bulunamadı veya zaten iptal edilmiş / tamamlanmış' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.cancel_training(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_training(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- training_responses (RSVP). No row = "no answer yet".
-- ---------------------------------------------------------------------------
create table public.training_responses (
  training_id  uuid not null references public.trainings (id) on delete cascade,
  member_id    uuid not null references public.profiles (id) on delete restrict,
  response     public.rsvp_response not null,
  note         text,
  responded_at timestamptz not null default now(),
  set_by_coach boolean not null default false,
  primary key (training_id, member_id),
  constraint training_responses_note_len check (note is null or char_length(note) <= 200)
);

create index training_responses_member_idx on public.training_responses (member_id);

alter table public.training_responses enable row level security;

-- Read-only for clients: a member sees their own answers, a coach sees everyone's.
-- All writes go through set_rsvp() / coach_set_rsvp() below.
revoke all on table public.training_responses from anon, authenticated;
grant select on table public.training_responses to authenticated;

create policy training_responses_select_own on public.training_responses
  for select to authenticated
  using (member_id = auth.uid() and public.is_active_user());

create policy training_responses_select_coach on public.training_responses
  for select to authenticated
  using (public.is_coach());

-- A member answers (or changes their answer / note) for themselves — until the deadline.
create function public.set_rsvp(
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

revoke all on function public.set_rsvp(uuid, public.rsvp_response, text) from public, anon, authenticated;
grant execute on function public.set_rsvp(uuid, public.rsvp_response, text) to authenticated;

-- A coach records an answer for a member (e.g. they phoned in) — allowed after the deadline too.
create function public.coach_set_rsvp(
  p_training_id uuid,
  p_member_id   uuid,
  p_response    public.rsvp_response,
  p_note        text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_training public.trainings;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_coach() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  select * into v_training from public.trainings where id = p_training_id;
  if not found then
    raise exception 'Antrenman bulunamadı' using errcode = 'P0001';
  end if;
  if v_training.status <> 'scheduled' then
    raise exception 'Bu antrenman iptal edildi veya tamamlandı' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_member_id and p.role = 'member' and p.is_active
  ) then
    raise exception 'Üye bulunamadı veya devre dışı' using errcode = 'P0001';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'Not en fazla 200 karakter olabilir' using errcode = 'P0001';
  end if;

  insert into public.training_responses (training_id, member_id, response, note, responded_at, set_by_coach)
  values (p_training_id, p_member_id, p_response, v_note, now(), true)
  on conflict (training_id, member_id) do update
    set response = excluded.response,
        note = excluded.note,
        responded_at = excluded.responded_at,
        set_by_coach = true;
end;
$$;

revoke all on function public.coach_set_rsvp(uuid, uuid, public.rsvp_response, text) from public, anon, authenticated;
grant execute on function public.coach_set_rsvp(uuid, uuid, public.rsvp_response, text) to authenticated;
