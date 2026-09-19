-- Phase 6: daily pruning of the audit log (entries older than a year).
-- Like 20260919160100_schedule.sql this only wires pg_cron, which exists on Supabase but not in the local
-- PGlite test database (the test harness skips every *_schedule.sql file).
create extension if not exists pg_cron;

select cron.schedule('club-prune-audit-log', '30 3 * * *', $$select public.prune_audit_log()$$);
