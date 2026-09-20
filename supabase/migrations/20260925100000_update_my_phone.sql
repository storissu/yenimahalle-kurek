-- Members may change THEIR OWN phone number (from their profile). Nothing else about them.
--
-- A plain UPDATE grant on profiles would also let a member change their own name (the column grant is shared with the
-- coaches' policy), so the only write path is this function: it changes the caller's own row, the phone column only.
-- The number is shown to the other members (crew cards, the member list), so it must look like a phone number: digits,
-- spaces and + ( ) . / - only, at least 7 digits, at most 30 characters. An empty value removes the number.
-- The audit trigger on profiles records that the phone was edited (never the number itself).

create function public.update_my_phone(p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if not public.is_active_user() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  if v_phone is not null then
    if char_length(v_phone) > 30 then
      raise exception 'Telefon en fazla 30 karakter olabilir' using errcode = 'P0001';
    end if;
    if v_phone !~ '^[0-9 +().\/-]+$' or char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 7 then
      raise exception 'Geçerli bir telefon numarası yazın' using errcode = 'P0001';
    end if;
  end if;
  update public.profiles set phone = v_phone where id = auth.uid();
end;
$$;

revoke all on function public.update_my_phone(text) from public, anon, authenticated;
grant execute on function public.update_my_phone(text) to authenticated;
