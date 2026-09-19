-- 1. The monthly leaderboard now lists EVERY active member, also those with 0 sessions that month.
--    Members without sessions keep rank = null (no place); they come after the ranked ones, by name.
--    (my_month_stats keeps its meaning: `participants` = members who rowed at least once.)
-- 2. shared_boat_history(): what two members rowed TOGETHER — the sessions in which both were in the same boat.

create or replace function public.monthly_leaderboard(p_month date)
returns table (member_id uuid, full_name text, sessions integer, training_days integer, rank integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_user() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  return query
    select m.member_id, m.full_name, m.sessions, m.training_days, m.rank
      from public.attendance_month_internal(p_month) m
     order by m.rank nulls last, m.full_name;
end;
$$;

-- "Trained together" = the caller and p_member were in the SAME CREW of the SAME session of a published program,
-- both are recorded as present, and the training is completed. Newest first, at most 200 sessions.
-- It reveals nothing about trainings the caller did not row in: every row needs the caller in that very crew.
-- Drafts and unfinished trainings never appear. Asking about yourself returns nothing.
create function public.shared_boat_history(p_member uuid)
returns table (training_id uuid, starts_at timestamptz, title text, slot_index smallint, boat_id uuid, boat_name text)
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
    select t.id, t.starts_at, t.title, a.slot_index, b.id, b.name
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
     order by t.starts_at desc, a.slot_index
     limit 200;
end;
$$;

revoke all on function public.shared_boat_history(uuid) from public, anon, authenticated;
grant execute on function public.shared_boat_history(uuid) to authenticated;
