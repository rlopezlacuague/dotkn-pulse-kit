# Pulse kit contract, version 1

Every dotkn app that adopts `dotkn-pulse-kit` answers this contract. Pulse reads it with no
per-app code, and dotkn-lab's factory (watch, release probe, manifest) probes the same two routes.
The constants live in `src/contract.ts`; a test asserts this document and the constants agree.

## Routes

| Route | Method | Status | Body | Headers |
|---|---|---|---|---|
| `/health` | GET, HEAD | 200 | `{"ok":true}`, or `{"ok":true,"checks":{"<name>":"ok"}}` | `content-type: application/json`, `cache-control: no-store` |
| `/health` | GET, HEAD | 503 | `{"ok":false,"checks":{"<name>":"<reason>"}}` when a check fails | same |
| `/__build` | GET, HEAD | 200 | `{"commit":"<40 hex>","built_at":"<ISO 8601>"}` | same |
| `/__pulse/e` | POST, OPTIONS | 204 | the event collector (wave 5c) | `cache-control: no-store` |

- `commit` is resolved at **build** time: `PULSE_BUILD_COMMIT`, then `GITHUB_SHA`, then
  `WORKERS_CI_COMMIT_SHA`, then `git rev-parse HEAD`. The build fails when none yields 40 lowercase
  hex characters. Never a short sha, never "unknown".
- `checks` is additive: dotkn-lab's watch reads only the status; Pulse's target asserts `ok == true`.
- Static sites (no server code) serve both routes as files written at build, with the headers set
  through Cloudflare Pages `_headers`; `/__build` is then the deploy marker of the static deploy.

## Events: `pulse_events`

One Analytics Engine dataset for every app (`pulse_events`), bound as `PULSE`. `index1` is the
Pulse app id, so sampling and queries are per app (`WHERE index1 = '<id>'`). Event names match
`^[a-z][a-z0-9_.]{0,63}$`. Missing values are `-`.

| Column | Field | Meaning |
|---|---|---|
| index1 | `app` | the Pulse app id (at most 96 bytes) |
| blob1 | `app` | the Pulse app id |
| blob2 | `event` | event name |
| blob3 | `country` | `request.cf.country` |
| blob4 | `os` | `ios`, `android`, `mac`, `win`, `other`, `bot` from the user agent |
| blob5 | `path` | URL path (at most 512 characters) |
| blob6 | `source` | `web`, `worker`, `ios`, `server` |
| blob7 | `lang` | first `Accept-Language` tag |
| blob8 | `campaign` | campaign tag (at most 64) |
| blob9 | `outcome` | outcome or status, free text (at most 64) |
| blob10 | `layout` | `v1` |
| double1 | `value` | default 1 |
| double2 | `size` | bytes or milliseconds, default 0 |

Blobs 11 to 20 are free for a v2 that keeps v1 readers working.

## Business metrics: `pulse.metrics()`

A migration in the app's own repo (`npx dotkn-pulse-kit supabase --app <id>`):

- `create or replace function pulse.metrics() returns table(name text, label text, unit text, value numeric, dims jsonb)`,
  `language sql stable security definer set search_path = public`, one `select` per metric.
- `revoke all on function pulse.metrics() from public, anon, authenticated`; `grant usage on schema pulse`
  and `grant execute on function pulse.metrics()` to `supabase_read_only_user`, guarded by a
  `pg_roles` check so local stacks apply it too.
- Schema `pulse` is not exposed by PostgREST, so the anon key cannot call it
  (`/rest/v1/rpc/metrics` answers 404).
- `name` is snake_case; `unit` is one of `count`, `ms`, `bytes`, `ratio`, `bool`, `days`, `usd`;
  `dims` is null or a flat object of strings. A later version is a new function
  (`pulse.metrics_v2()`), so readers of v1 keep working.
