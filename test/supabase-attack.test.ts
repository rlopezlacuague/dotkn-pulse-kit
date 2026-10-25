// pulse.metrics() under attack, on a real Postgres (PGlite: Postgres 17 in WASM). The review of
// 2026-10-25 showed the v0.1.0 function (security definer, search_path = public) running a
// caller's temporary view as its owner: supabase_read_only_user can log in, create temp objects
// and turn its read-only default off (checked on hosted habitants), so it wrote public.pwned as
// the owner and granted anon access. The role already has pg_read_all_data and bypassrls, so the
// function needs no rights of its own: security invoker, and pg_temp searched last.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { metricsMigration } from '../src/supabase.ts';

const template = readFileSync(new URL('../sql/pulse_metrics.sql', import.meta.url), 'utf8');
// A habitants-style metric: an unqualified table name, the case a temp view can shadow.
const generated = metricsMigration({ app: 'habitants', metrics: [{ name: 'pro_users', label: 'Pro users', sql: 'select count(*) from profiles where is_pro' }] });

/** Supabase's roles in miniature: the owner is not a superuser (as `postgres` on hosted projects). */
async function project(migration: string) {
  const db = new PGlite();
  await db.exec(`
    create role app_owner nosuperuser createrole;
    create role anon nologin; create role authenticated nologin;
    create role supabase_read_only_user login bypassrls;
    grant pg_read_all_data to supabase_read_only_user;
    alter role supabase_read_only_user set default_transaction_read_only = on;
    do $$ begin execute format('grant create on database %I to app_owner', current_database()); end $$;
    grant all on schema public to app_owner;
    create schema auth authorization app_owner;
    set role app_owner;
    create table auth.users(id int); insert into auth.users values (1), (2), (3);
    create table profiles(id int, is_pro bool); insert into profiles values (1, true), (2, false);
    reset role;`);
  await db.exec(`set role app_owner; ${migration}; reset role;`);
  return db;
}
const rows = async (db: PGlite, sql: string) => ((await db.exec(sql)).at(-1)?.rows ?? []) as Array<Record<string, unknown>>;
const denied = async (db: PGlite, role: string) => {
  try {
    await db.exec(`set role ${role}; select * from pulse.metrics();`);
    return 'allowed';
  } catch (e) {
    return (e as Error).message;
  } finally {
    await db.exec('reset role');
  }
};

for (const [label, migration, metric, value] of [['the shipped template', template, 'users_total', '3'], ['a generated migration (unqualified table)', generated, 'pro_users', '1']] as const) {
  test(`${label}: the read-only role reads it, anon and authenticated cannot`, async () => {
    const db = await project(migration);
    const got = await rows(db, `set role supabase_read_only_user; select name, value::text from pulse.metrics();`);
    await db.exec('reset role');
    assert.deepEqual(got, [{ name: metric, value }]);
    assert.match(await denied(db, 'anon'), /permission denied for schema pulse/);
    assert.match(await denied(db, 'authenticated'), /permission denied for schema pulse/);
  });

  test(`${label}: a temp view planted by the read-only role never runs with the owner's rights`, async () => {
    const db = await project(migration);
    await db.exec(`set role supabase_read_only_user; set default_transaction_read_only = off;
      create function pg_temp.evil() returns bool language plpgsql as $f$ begin
        execute 'create table if not exists public.pwned as select current_user::text as who';
        execute 'grant usage on schema pulse to anon';
        execute 'grant execute on function pulse.metrics() to anon';
        return true; end $f$;
      create temp view profiles as select 1 as id, pg_temp.evil() as is_pro;
      create temp view users as select 1 as id where pg_temp.evil();
      grant select on pg_temp.profiles, pg_temp.users to public;`);
    let call = 'ok';
    try {
      await db.exec('select * from pulse.metrics();');
    } catch (e) {
      call = (e as Error).message;
    }
    await db.exec('reset role');
    const pwned = await rows(db, `select to_regclass('public.pwned')::text as t`);
    assert.deepEqual(pwned, [{ t: null }], `public.pwned exists (the call said: ${call})`);
    assert.match(await denied(db, 'anon'), /permission denied for schema pulse/);
  });
}
