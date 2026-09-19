-- Web Push subscriptions (one row per browser/device installation).
-- The endpoint is globally unique; if a phone is handed to another member, the
-- subscription is re-assigned to whoever registers it last (see RPC below).

create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  endpoint        text not null,
  p256dh          text not null,
  auth            text not null,
  user_agent      text,
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  constraint push_subscriptions_endpoint_unique unique (endpoint),
  constraint push_subscriptions_endpoint_len check (char_length(endpoint) <= 2048)
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Users may see and remove only their own subscriptions.
-- Inserts/updates go through the RPC; the service role reads all for sending.
revoke all on table public.push_subscriptions from anon, authenticated;
grant select, delete on table public.push_subscriptions to authenticated;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());

create function public.register_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent;
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
