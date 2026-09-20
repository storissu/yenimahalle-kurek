-- 1. member_training_history(): a member's own COMPLETE training history, for their profile page.
-- 2. delete_member(): the coach's "delete this member" — removes the person, keeps the club's history.
--
-- Deleting a member
--   * Everything about the PERSON goes: login, username, phone, push devices, notifications, and their answers and
--     places in trainings that have not happened yet.
--   * The club's HISTORY stays intact. Attendance, past crews and past answers point at the member with
--     `on delete restrict` foreign keys, so a member who ever trained cannot simply be removed. Instead the profile row
--     stays as an anonymous tombstone ("Eski üye", deleted_at set, unusable username, no phone, inactive). Monthly
--     numbers, other members' shared history and coach exports therefore do not change; the tombstone never appears in
--     the member list, the directory or the leaderboard (it is inactive).
--   * A member who never trained (nothing refers to them) is really deleted, row and all.
-- Only the service role may call delete_member (the admin-delete-member Edge Function, which also removes the login).

alter table public.profiles add column deleted_at timestamptz;

-- ---------------------------------------------------------------------------
-- member_training_history
-- Every session the member was PRESENT in, in completed trainings, newest first (at most 500), with the boat when a
-- published program put them in one. Any signed-in active user may ask about an active member (this is what the
-- profile page shows: "their complete training history"). Drafts and unfinished trainings never appear.
-- ---------------------------------------------------------------------------
create function public.member_training_history(p_member uuid)
returns table (training_id uuid, starts_at timestamptz, title text, slot_index smallint, boat_id uuid, boat_name text)
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
    select t.id, t.starts_at, t.title, ar.slot_index, x.boat_id, x.boat_name
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
     order by t.starts_at desc, ar.slot_index
     limit 500;
end;
$$;

revoke all on function public.member_training_history(uuid) from public, anon, authenticated;
grant execute on function public.member_training_history(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_member: returns 'deleted' (nothing referred to the member, the row is gone) or 'anonymized' (history kept).
-- Refuses the last active coach (the protect_last_coach trigger), like deactivation does.
-- ---------------------------------------------------------------------------
create function public.delete_member(p_member uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = p_member and deleted_at is null) then
    raise exception 'Üye bulunamadı' using errcode = 'P0001';
  end if;

  -- Trainings that have not happened yet: the member's answer and place simply disappear.
  delete from public.training_responses r
   using public.trainings t
   where r.member_id = p_member and t.id = r.training_id and t.status = 'scheduled' and t.starts_at > now();
  delete from public.program_crew c
   using public.trainings t
   where c.member_id = p_member and t.id = c.training_id and t.status = 'scheduled' and t.starts_at > now();

  begin
    delete from public.profiles where id = p_member; -- cascades push devices and notifications
    return 'deleted';
  exception when restrict_violation or foreign_key_violation then -- ON DELETE RESTRICT reports 23001
    -- History refers to this member: keep the row, but only as an anonymous tombstone.
    update public.profiles
       set full_name = 'Eski üye',
           username = 'silinen-' || right(replace(id::text, '-', ''), 12),
           phone = null,
           is_active = false,
           must_change_password = false,
           deleted_at = now()
     where id = p_member;
    delete from public.push_subscriptions where user_id = p_member;
    delete from public.notification_outbox where user_id = p_member;
    return 'anonymized';
  end;
end;
$$;

revoke all on function public.delete_member(uuid) from public, anon, authenticated;
