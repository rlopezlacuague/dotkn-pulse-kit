import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { metricsMigration, metricSelect } from '../src/supabase.ts';

const template = readFileSync(new URL('../sql/pulse_metrics.sql', import.meta.url), 'utf8');

test('the shipped template: schema pulse, the v1 signature, security invoker with a pinned search_path, revoked from PUBLIC/anon/authenticated, granted only to the read-only role (guarded)', () => {
  for (const sql of [template, metricsMigration({ app: 'canary' })]) {
    assert.match(sql, /create schema if not exists pulse;/);
    assert.match(sql, /create or replace function pulse\.metrics\(\)\s+returns table\(name text, label text, unit text, value numeric, dims jsonb\)/);
    assert.match(sql, /language sql stable security invoker set search_path = pg_catalog, public, pg_temp as/);
    assert.ok(!/security definer/.test(sql), 'never runs with the owner\'s rights');
    assert.match(sql, /revoke all on function pulse\.metrics\(\) from public, anon, authenticated;/);
    assert.match(sql, /if exists \(select 1 from pg_roles where rolname = 'supabase_read_only_user'\) then\s+grant usage on schema pulse to supabase_read_only_user;\s+grant execute on function pulse\.metrics\(\) to supabase_read_only_user;/);
    assert.ok(!/\bbegin;|\bcommit;/i.test(sql.replace(/do \$\$ begin/g, '')), 'no explicit transaction: the migration runner wraps each file in one');
    assert.ok(!/to (anon|authenticated|public)\b/.test(sql.replace(/from public, anon, authenticated/, '')), 'nothing granted to API roles');
  }
});

test('metricsMigration names the app and defaults to the users_total metric', () => {
  const sql = metricsMigration({ app: 'canary' });
  assert.match(sql, /-- pulse\.metrics\(\) for canary/);
  assert.match(sql, /select 'users_total'::text, 'Users'::text, 'count'::text, count\(\*\)::numeric, null::jsonb from auth\.users/);
});

test('seeded from apps.yaml metrics: a scalar takes column "value" or the single column; a dims metric builds a jsonb per row', () => {
  assert.equal(
    metricSelect({ name: 'pro_users', label: "Pro users (Rolo's)", sql: 'select count(*) from profiles where is_pro' }),
    "select 'pro_users'::text, 'Pro users (Rolo''s)'::text, 'count'::text, (select coalesce(j->>'value', (select e.value from jsonb_each_text(j) e limit 1))::numeric from (select to_jsonb(t) as j from (select count(*) from profiles where is_pro) t limit 1) x), null::jsonb",
  );
  assert.equal(
    metricSelect({ name: 'paywall_7d', label: 'Paywall', unit: 'count', dims: ['event', 'tag'], sql: 'select event, tag, count(*) as value from funnel_events group by 1, 2' }),
    "select 'paywall_7d'::text, 'Paywall'::text, 'count'::text, t.value::numeric, jsonb_build_object('event', t.event, 'tag', t.tag) from (select event, tag, count(*) as value from funnel_events group by 1, 2) t",
  );
  const sql = metricsMigration({ app: 'habitants', metrics: [{ name: 'a', label: 'A', sql: 'select 1' }, { name: 'b', label: 'B', sql: 'select 2 as value' }] });
  assert.match(sql, /select 'a'[^\n]*\n {2}union all\n {2}select 'b'/);
  assert.throws(() => metricSelect({ name: 'Bad', label: 'x', sql: 'select 1' }), /snake_case/);
  assert.throws(() => metricSelect({ name: 'x', label: 'x', sql: 'delete from t' }), /select/);
});

test('metricsFromEntry: yaml metrics, then one count per key table, then the subscriptions split for a revenue block', async () => {
  const { metricsFromEntry } = await import('../src/supabase.ts');
  const ms = metricsFromEntry({
    id: 'promptarch',
    supabase: { metrics: [{ name: 'dau', label: 'Active today', sql: 'select 1' }], keyTables: ['profiles', 'api_keys'] },
    revenue: { creditTransactions: true },
  });
  assert.deepEqual(ms.map((m) => [m.name, m.label]), [
    ['dau', 'Active today'],
    ['rows_profiles', 'Rows in profiles'],
    ['rows_api_keys', 'Rows in api_keys'],
    ['subscriptions', 'Subscriptions by plan and status'],
  ]);
  assert.equal(ms[1]!.sql, 'select count(*) from public."profiles"');
  assert.deepEqual(ms[3]!.dims, ['plan', 'status']);
  assert.deepEqual(metricsFromEntry({ id: 'anx', supabase: { keyTables: [] } }), []);
  assert.throws(() => metricsFromEntry({ id: 'x', supabase: { keyTables: ['bad name'] } }), /key table/);
});
