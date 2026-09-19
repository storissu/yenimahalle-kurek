-- Scheduling (Supabase hosted only: needs the pg_cron and pg_net extensions and the Vault).
-- The rules themselves live in 20260919160000_notifications_weather.sql and are tested there; this
-- file only wires the clock. The local test harness skips files named *_schedule.sql.
--
-- One-time setup after deploying (see docs/RUNBOOK.md): store the project URL and a shared secret in the Vault
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<the same value as the CRON_SECRET function secret>', 'cron_secret');
-- Until both exist the jobs below do nothing (they never fail).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Calls an Edge Function with the shared secret. Returns null (and does nothing) if the Vault is not set up yet.
create or replace function public.invoke_edge_function(p_name text) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if v_url is null or v_secret is null then
    raise notice 'invoke_edge_function(%): Vault secrets project_url / cron_secret are not set', p_name;
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;

revoke all on function public.invoke_edge_function(text) from public, anon, authenticated;

-- Every 5 minutes: deadline reminders, deadline summaries, inbox clean-up (pure SQL, no HTTP).
select cron.schedule('club-scheduled-notifications', '*/5 * * * *', $$select public.run_scheduled_notifications()$$);

-- Every minute, but only when something is waiting to be pushed.
select cron.schedule(
  'club-send-push',
  '* * * * *',
  $$select public.invoke_edge_function('send-notifications')
     where exists (select 1 from public.notification_outbox where push_done_at is null and push_attempts < 5)$$
);

-- Every 3 hours, but only when a training within the forecast horizon exists.
select cron.schedule(
  'club-refresh-weather',
  '15 */3 * * *',
  $$select public.invoke_edge_function('refresh-weather')
     where exists (select 1 from public.trainings where status = 'scheduled' and starts_at > now() and starts_at < now() + interval '16 days')$$
);
