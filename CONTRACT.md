# Pulse kit contract, version 1

Every dotkn app that adopts `dotkn-pulse-kit` answers this contract. Pulse reads it with no
per-app code, and dotkn-lab's factory (watch, release probe, manifest) probes the same two routes.
The constants live in `src/contract.ts`; a test asserts this document and the constants agree.

## Routes

| Route | Method | Status | Body | Headers |
|---|---|---|---|---|
| `/health` | GET, HEAD | 200 | `{"ok":true}`, or `{"ok":true,"checks":{"<name>":"ok"}}` | `content-type: application/json`, `cache-control: no-store` |
| `/health` | GET, HEAD | 503 | `{"ok":false,"checks":{"<name>":"failed"\|"timeout"}}` when a check fails | same |
| `/__build` | GET, HEAD | 200 | `{"commit":"<40 hex>","built_at":"<ISO 8601>"}` | same |
| `/__pulse/e` | POST, OPTIONS | 204 | the event collector (below) | `cache-control: no-store` |

- `commit` is resolved at **build** time: `PULSE_BUILD_COMMIT`, then `GITHUB_SHA`, then
  `WORKERS_CI_COMMIT_SHA`, then `git rev-parse HEAD`. The build fails when none yields 40 lowercase
  hex characters. Never a short sha, never "unknown".
- `checks` is additive: dotkn-lab's watch reads only the status; Pulse's target asserts `ok == true`.
- `/health` is public, so a check reports one of three fixed words, `ok`, `failed` or `timeout`, never
  its error text. A check that has not settled after 2 seconds is `timeout`.
- Static sites (no server code) serve both routes as files written at build, with the headers set
  through Cloudflare Pages `_headers`; `/__build` is then the deploy marker of the static deploy.

## Events: `pulse_events`

One Analytics Engine dataset for every app (`pulse_events`), bound as `PULSE`. `index1` is the
Pulse app id, so sampling and queries are per app (`WHERE index1 = '<id>'`). Event names match
`^[a-z][a-z0-9_.]{0,63}$`. Missing values are `-`.

Counts are estimates. Analytics Engine samples at write time when points arrive quickly on one
index, and keeps a weight per stored row in `_sample_interval`. Count with
`SUM(_sample_interval)`, never `count()`, and do not expect any single event to be stored. The
canary measured this on 2026-10-25: 20 requests in about 2 seconds were stored as 6 rows, read as
21, and a batch of 5 iOS events was stored as 1 row, read as 4.

| Column | Field | Meaning |
|---|---|---|
| index1 | `app` | the Pulse app id (at most 96 bytes) |
| blob1 | `app` | the Pulse app id |
| blob2 | `event` | event name |
| blob3 | `country` | `request.cf.country` |
| blob4 | `os` | `ios`, `android`, `mac`, `win`, `other`, `bot` from the user agent |
| blob5 | `path` | URL path (at most 512 characters) |
| blob6 | `source` | `worker`, `server`: written by app code. `web`, `ios`: written only by the collector, as the client claimed |
| blob7 | `lang` | first `Accept-Language` tag |
| blob8 | `campaign` | campaign tag (at most 64) |
| blob9 | `outcome` | outcome or status, free text (at most 64) |
| blob10 | `layout` | `v1` |
| double1 | `value` | default 1 |
| double2 | `size` | bytes or milliseconds, default 0 |

Blobs 11 to 20 are free for a v2 that keeps v1 readers working.

## The collector: `/__pulse/e`

For clients that cannot write to Analytics Engine themselves: iOS apps (PulseKit) and browser
beacons. Body: `{"app":"<id>","source"?:"ios"|"web","events":[{"event","path"?,"outcome"?,"ct"?,"value"?,"duration"?}]}`.

- It always answers 204 with `cache-control: no-store`, so a probe cannot learn what was accepted.
- It reads a body only when `content-type` is `application/json`. Browsers cannot send that type
  across origins without a CORS preflight, and the preflight succeeds only for the configured
  origins.
- The body is at most 64 KB. A larger `content-length` is refused before reading, and a body
  without one is read until it passes 64 KB, then abandoned.
- `app` must equal the mounted app id. At most 25 events are read, and events with an invalid name
  are dropped.
- A client `path` keeps no query string or fragment. `value` is clamped to 0..1,000,000 and
  `duration` to 0..86,400,000 ms.
- Its points carry `source` `web` or `ios`, as the client claimed. App code cannot write those
  values, so a forged event never passes for a server-side one.
- `x-pulse-key` is optional and not a secret, because an app binary cannot hide one. It filters
  casual junk; anyone can still send events, but nobody can read them through the collector.

## Business metrics: `pulse.metrics()`

A migration in the app's own repo (`npx dotkn-pulse-kit supabase --app <id>`):

- `create or replace function pulse.metrics() returns table(name text, label text, unit text, value numeric, dims jsonb)`,
  `language sql stable security invoker set search_path = pg_catalog, public, pg_temp`, one `select` per metric.
- `security invoker`: the function runs with the caller's rights, never the owner's.
  `supabase_read_only_user` already reads every table (`pg_read_all_data`, `bypassrls`). Before
  v0.1.1 it was `security definer` with `search_path = public`, and a temporary view planted by that
  role ran as the owner.
- `revoke all on function pulse.metrics() from public, anon, authenticated`; `grant usage on schema pulse`
  and `grant execute on function pulse.metrics()` to `supabase_read_only_user`, guarded by a
  `pg_roles` check so local stacks apply it too. A function the metrics call that `PUBLIC` cannot
  execute gets the same guarded grant (`--grant-execute schema.fn()`).
- Schema `pulse` is not exposed by PostgREST, so the anon key cannot call it
  (`/rest/v1/rpc/metrics` answers 404).
- `name` is snake_case; `unit` is one of `count`, `ms`, `bytes`, `ratio`, `bool`, `days`, `usd`;
  `dims` is null or a flat object of strings. A later version is a new function
  (`pulse.metrics_v2()`), so readers of v1 keep working.
