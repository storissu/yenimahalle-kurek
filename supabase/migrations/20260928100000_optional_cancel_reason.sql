-- The reason for cancelling a training is optional.
--   * A cancelled training may have no reason (cancel_reason is null). A reason, when given, is still 3–200 characters
--     and is shown in the training's details; blank text counts as "no reason".
--   * A reason can only exist on a cancelled training (the old rule "cancelled <=> has a reason" becomes "reason => cancelled").
--   * The "training cancelled" message to the members leaves the "Neden:" line out when there is no reason.

alter table public.trainings drop constraint trainings_cancel_reason_consistent;
alter table public.trainings add constraint trainings_cancel_reason_only_cancelled check (cancel_reason is null or status = 'cancelled');

create or replace function public.cancel_training(p_training_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_coach() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  if v_reason is not null and (char_length(v_reason) < 3 or char_length(v_reason) > 200) then
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

-- The message body is patched in place (the function was already patched by earlier migrations); it fails loudly if
-- the text to change is not there.
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'trainings_notify_update';
  v_new := replace(v_def, $old$|| E'\nNeden: ' || coalesce(new.cancel_reason, '-')$old$, $new$|| coalesce(E'\nNeden: ' || new.cancel_reason, '')$new$);
  if v_new = v_def then
    raise exception 'optional_cancel_reason: nothing to patch in trainings_notify_update';
  end if;
  execute v_new;
end;
$$;
