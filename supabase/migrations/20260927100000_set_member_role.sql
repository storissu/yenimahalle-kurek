-- A coach changes a club member's role: member <-> coach.
--   * Coaches only (checked here, not just in the app). An active account only; never one's own (a coach cannot demote
--     themselves, so the club can never be left without a coach by a slip) and never a deleted member.
--   * Only profiles.role changes. The account, username, name, phone and every training, answer, program, attendance and
--     history row stay exactly as they are: nothing else stores the role, and every permission check (RLS, is_coach(),
--     the Edge Functions) reads the role from profiles on each request, so the change is in force at once.
--   * The last-active-coach trigger stays as the backstop for the demotion.
--   * The change is written to the audit log ("member.role_change").

create function public.set_member_role(p_member uuid, p_role public.user_role) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_target public.profiles;
  v_word   text;
begin
  if not public.is_coach() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  if p_member is null or p_role is null then
    raise exception 'Geçersiz istek' using errcode = 'P0001';
  end if;
  if p_member = auth.uid() then
    raise exception 'Kendi rolünüzü değiştiremezsiniz' using errcode = 'P0001';
  end if;

  select * into v_target from public.profiles where id = p_member for update;
  if not found or v_target.deleted_at is not null then
    raise exception 'Kullanıcı bulunamadı' using errcode = 'P0001';
  end if;
  if not v_target.is_active then
    raise exception 'Devre dışı hesabın rolü değiştirilemez. Önce hesabı etkinleştirin.' using errcode = 'P0001';
  end if;
  if v_target.role = p_role then
    return; -- already what was asked: nothing to do, nothing to log
  end if;

  update public.profiles set role = p_role where id = p_member;

  v_word := case p_role when 'coach' then 'antrenör' else 'üye' end;
  perform public.log_audit(
    'member', 'member.role_change', 'profile', p_member,
    'Rol değiştirildi: ' || v_target.full_name || ' (@' || v_target.username || ') → ' || v_word,
    jsonb_build_object('from', v_target.role, 'to', p_role)
  );
end;
$$;

revoke all on function public.set_member_role(uuid, public.user_role) from public, anon, authenticated;
grant execute on function public.set_member_role(uuid, public.user_role) to authenticated;
