# dotkn-pulse-kit

One contract for every dotkn app, so Pulse (the local monitoring dashboard) reads its health,
deploys, product events and business metrics with no per-app code, and dotkn-lab's factory
(watch, release probe, manifest) probes it unchanged. The contract is [CONTRACT.md](CONTRACT.md).

| What | Route or object | Read by |
|---|---|---|
| Health | `GET /health` → `{"ok":true}` (503 `{"ok":false,"checks":…}`) | Pulse http target, dotkn-lab watch |
| Build | `GET /__build` → `{"commit":"<40 hex>","built_at":"<ISO>"}` | Pulse deploy markers, dotkn-lab release |
| Events | Analytics Engine `pulse_events`, `index1` = app id | Pulse Events card |
| Metrics | Supabase `pulse.metrics()` | Pulse "App metrics" |

## Install

```sh
npm i dotkn-pulse-kit
# until the first npm release, from a git tag:
npm i github:rlopezlacuague/dotkn-pulse-kit#v0.1.0
```

The app id you pass below is the Pulse app id (by default the wrangler `name`). Add the dataset
binding to `wrangler.jsonc` / `wrangler.toml` wherever you track events:

```jsonc
"analytics_engine_datasets": [{ "binding": "PULSE", "dataset": "pulse_events" }]
```

## Per runtime

**Worker (fetch handler or Hono).** Stamp the build before deploy, mount first:

```jsonc
// package.json
"predeploy": "dotkn-pulse-kit stamp --out src/pulse-build.ts"   // git-ignore that file
```
```ts
import { pulse, track } from 'dotkn-pulse-kit/worker';
import { PULSE_BUILD } from './pulse-build';
const kit = pulse({ app: 'my-app', build: PULSE_BUILD });
export default {
  async fetch(req: Request, env: Env) {
    track(env.PULSE, 'my-app', { event: 'request' }, req);
    return (await kit(req, env)) ?? handle(req, env);
  },
};
```

**React Router / Vite.** `vite.config.ts`: `plugins: [pulseBuild(), …]` from `dotkn-pulse-kit/vite`;
`app/routes.ts`: `...pulseRoutes(route)` from `dotkn-pulse-kit/react-router`;
`app/routes/pulse.health.ts`: `export const loader = healthLoader();`
`app/routes/pulse.build.ts`: `export const loader = buildLoader({ commit: __PULSE_COMMIT__, builtAt: __PULSE_BUILT_AT__ });`

**Next.js (OpenNext).** `next.config`: `env: pulseEnv()` and `rewrites: async () => pulseRewrites()`
from `dotkn-pulse-kit/next-config`; `app/api/pulse/health/route.ts`: `export const GET = healthGET();`
`app/api/pulse/build/route.ts`: `export const GET = buildGET();` (from `dotkn-pulse-kit/next`).

**Cloudflare Pages Functions.** `functions/health.ts`: `export const onRequestGet = pagesHealth();`
`functions/__build.ts`: `export const onRequestGet = pagesBuild(PULSE_BUILD);` and
`trackPages(context, 'my-app', { event: 'signup' })` in any function (from `dotkn-pulse-kit/pages`).

**Astro.** `integrations: [pulseAstro()]` from `dotkn-pulse-kit/astro`. Static output writes
`/health` and `/__build` files with their `_headers`; server output injects the two endpoints.

**Static Vite site on Pages.** `plugins: [pulseBuild({ emit: true })]` writes the two files and headers.

The build fails when no commit is found (`PULSE_BUILD_COMMIT`, `GITHUB_SHA`,
`WORKERS_CI_COMMIT_SHA`, then `git rev-parse HEAD`): a deploy never reports a guess.

## Supabase metrics

```sh
npx dotkn-pulse-kit supabase --app my-app > supabase/migrations/<ts>_pulse_metrics.sql
npx dotkn-pulse-kit supabase --app my-app --from-yaml ../pulse/config/apps.yaml   # seed from Pulse
```

One `select` per metric (`name, label, unit, value, dims`). The function lives in schema `pulse`
(not exposed by PostgREST), is revoked from `public, anon, authenticated` and granted only to
`supabase_read_only_user`, the role Pulse reads with.

## Check a deploy

```sh
npx dotkn-pulse-kit check https://my-app.example
```

Probes `/health` and `/__build` and names every deviation (status, headers, body shape).

## Canary

`canary/` is a minimal Worker (`pulse-kit-canary`) deployed from this repo with
`npm run canary:deploy` and left running as the kit's integration target.

## Is it safe to be public?

Nothing secret lives here by construction: route handlers, a build stamp, a column layout, a SQL
template. A test greps everything that ships for keys, tokens, 32-hex ids and project refs, and the
release workflow runs it on `dist/` before publishing.
