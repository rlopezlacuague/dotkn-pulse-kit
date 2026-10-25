// pulse.metrics() — an app's business metrics, versioned in the app's own repo. Pulse calls it
// as supabase_read_only_user over the Management API; schema `pulse` is not exposed by
// PostgREST and the function is revoked from PUBLIC/anon/authenticated, so the anon key cannot
// reach it. `security definer` reads RLS-protected tables while the caller stays read-only.
export interface YamlMetric {
  name: string;
  label: string;
  sql: string;
  dims?: string[];
  unit?: string;
}

const NAME = /^[a-z][a-z0-9_]*$/;
const IDENT = /^[a-z_][a-z0-9_]*$/;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'::text`;

/** One select of the union: (name, label, unit, value, dims). */
export function metricSelect(m: YamlMetric): string {
  if (!NAME.test(m.name)) throw new Error(`metric "${m.name}" must be a snake_case name`);
  const body = m.sql.trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(body) || body.includes(';')) throw new Error(`metric ${m.name}: sql must be one select/with statement`);
  const head = `select ${lit(m.name)}, ${lit(m.label)}, ${lit(m.unit ?? 'count')}`;
  if (m.dims?.length) {
    for (const d of m.dims) if (!IDENT.test(d)) throw new Error(`metric ${m.name}: dim "${d}" must be a plain identifier`);
    return `${head}, t.value::numeric, jsonb_build_object(${m.dims.map((d) => `'${d}', t.${d}`).join(', ')}) from (${body}) t`;
  }
  // Scalar: the column named "value", else the single column (the same rule Pulse applies).
  return `${head}, (select coalesce(j->>'value', (select e.value from jsonb_each_text(j) e limit 1))::numeric from (select to_jsonb(t) as j from (${body}) t limit 1) x), null::jsonb`;
}

const DEFAULT = `select 'users_total'::text, 'Users'::text, 'count'::text, count(*)::numeric, null::jsonb from auth.users`;

export function metricsMigration(o: { app: string; metrics?: YamlMetric[] }): string {
  const selects = o.metrics?.length ? o.metrics.map(metricSelect) : [DEFAULT];
  return `-- pulse.metrics() for ${o.app} (dotkn-pulse-kit, contract v1). One select per metric; Pulse reads
-- the rows as supabase_read_only_user. Unreachable with the anon key: schema pulse is not exposed
-- and the function is revoked from public, anon and authenticated.
create schema if not exists pulse;

create or replace function pulse.metrics()
returns table(name text, label text, unit text, value numeric, dims jsonb)
language sql stable security definer set search_path = public as $$
  ${selects.join('\n  union all\n  ')}
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
`;
}
