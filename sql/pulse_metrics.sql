-- pulse.metrics() template (dotkn-pulse-kit, contract v1). `npx dotkn-pulse-kit supabase --app <id>`
-- prints it for an app (`--from-yaml <apps.yaml>` seeds it from Pulse's entry). One select per metric; Pulse reads
-- the rows as supabase_read_only_user. Unreachable with the anon key: schema pulse is not exposed
-- and the function is revoked from public, anon and authenticated. security invoker: it runs with
-- the caller's rights (the read-only role reads every table), never the owner's.
create schema if not exists pulse;

create or replace function pulse.metrics()
returns table(name text, label text, unit text, value numeric, dims jsonb)
language sql stable security invoker set search_path = pg_catalog, public, pg_temp as $$
  select 'users_total'::text, 'Users'::text, 'count'::text, count(*)::numeric, null::jsonb from auth.users
$$;

revoke all on function pulse.metrics() from public, anon, authenticated;

do $$ begin
  -- The read-only role exists on hosted projects; guarded so a local stack (supabase start,
  -- CI db reset) applies this migration too.
  if exists (select 1 from pg_roles where rolname = 'supabase_read_only_user') then
    grant usage on schema pulse to supabase_read_only_user;
    grant execute on function pulse.metrics() to supabase_read_only_user;
  end if;
end $$;
