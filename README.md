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
npm i github:rlopezlacuague/dotkn-pulse-kit#v0.1.2
```

Install from the git tag. The package is not on npm, and an npm package of this name is not ours.

The app id you pass below is the Pulse app id (by default the wrangler `name`). Add the dataset
binding to `wrangler.jsonc` / `wrangler.toml` wherever you track events:

```jsonc
"analytics_engine_datasets": [{ "binding": "PULSE", "dataset": "pulse_events" }]
```

## Work on the kit from a new Mac

> **The whole Mac, in order:** jox, then the dotkn-lab factory, then Pulse, then dotkn home (dotkn-pulse-kit only if you work on the kit). The overview is in dotkn-lab's README, "Install on a new Mac".

The kit is a library, not a service: nothing runs under launchd, nothing listens on a port, and
there is nothing to carry over from the old Mac. You need this checkout only to change the kit,
cut a release, or redeploy the canary. Apps and Pulse do **not** need it: they install the kit
from its git tag on GitHub (`npm ci` in Pulse fetches it by itself).

How it is consumed:

- **npm, from the git tag** (it is not on npm; an npm package of this name is not ours):
  `"dotkn-pulse-kit": "github:rlopezlacuague/dotkn-pulse-kit#v0.1.2"` in Pulse and habitants-web.
  npm runs the kit's `prepare` script, which builds `dist/`.
- **SwiftPM** for the iOS apps: `https://github.com/rlopezlacuague/dotkn-pulse-kit`, from `0.1.0`,
  product `PulseKit`.
- **Pulse** imports `CONTRACT` from `dotkn-pulse-kit/contract` (Pulse's `shared/kit-contract.ts`)
  and probes each app's `/health` and `/__build`. The canary Worker is one of Pulse's apps.

### 1. What it needs

- macOS with Xcode (Swift 6 toolchain: `Package.swift` declares `swift-tools-version: 6.0`). The
  Command Line Tools alone are enough for the Node side.
- Node 24 (the kit asks for 20 or newer; CI and the rest of the factory use 24). Through nvm:
  install nvm by its own instructions (<https://github.com/nvm-sh/nvm#installing-and-updating>),
  open a new terminal, then `nvm install 24 && nvm alias default 24`.
- git with the personal SSH alias (`github.com-p`) to push. The repo is public, so reading it
  needs no account.
- Only to redeploy the canary: a Cloudflare login with Workers access on the dotkn account.

Check it worked:

```sh
node -v                   # v24.x (20 or newer works)
swift --version           # Apple Swift version 6.x
ssh -T git@github.com-p   # "Hi rlopezlacuague!"
```

### 2. Clone

```sh
mkdir -p ~/Github && cd ~/Github
git clone git@github.com-p:rlopezlacuague/dotkn-pulse-kit.git
cd dotkn-pulse-kit
git config user.name "Rodrigo López (Rolo)"
git config user.email rlopezlacuague@gmail.com
```

Check it worked: `git -C ~/Github/dotkn-pulse-kit tag` lists `v0.1.0`, `v0.1.1` and `v0.1.2`.

### 3. Install and build

```sh
cd ~/Github/dotkn-pulse-kit
npm ci          # also runs `prepare`, which is `npm run build` (tsc into dist/)
```

Check it worked: `ls dist` shows `src` and `bin`, and
`node dist/bin/cli.js` prints the usage line (`usage: dotkn-pulse-kit check <base-url> | stamp …`).

### 4. Run the tests

```sh
npm test        # typecheck + every node:test file, including the secret scan
swift test      # the iOS side (PulseKit)
```

Check it worked: both end green. These are the same checks CI runs on every push (`ci.yml`:
`npm test` and `npm run build` on Ubuntu with Node 24; `swift test` on macOS 15).

### 5. The canary (only if you will redeploy it)

The canary is a small Worker, `pulse-kit-canary`, at
<https://pulse-kit-canary.rlopezlacuague.workers.dev>. It is already deployed and keeps running
without this Mac. Its `wrangler.jsonc` names no account id (the repo is public), so wrangler
deploys to whichever account you are logged into.

Log in once on the new Mac, with the same wrangler version the scripts use:

```sh
npx --yes wrangler@4.152.0 login
npx --yes wrangler@4.152.0 whoami     # shows the dotkn account
```

Then, to deploy:

```sh
npm run canary:deploy    # build, stamp canary/src/pulse-build.ts with this commit, wrangler deploy
```

Check it worked (with or without a deploy, this reads the live canary):

```sh
node dist/bin/cli.js check https://pulse-kit-canary.rlopezlacuague.workers.dev --collector
# ok https://pulse-kit-canary.rlopezlacuague.workers.dev: /health ok, /__build <40-hex commit> built <date>, collector ok
```

In Pulse, the `pulse-kit-canary` app should show its build chip with that commit.

### 6. Cutting a release

Releases are git tags. Nothing is published to npm.

```sh
# 1. bump "version" in package.json (for example to 0.1.3), commit
git tag v0.1.3
git push origin main v0.1.3
```

The `release` workflow runs on the tag: tests, build, the secret scan over `dist/`, and a check
that the tag equals `v` + the package.json version. Then each consumer moves its pin
(`github:rlopezlacuague/dotkn-pulse-kit#v0.1.3` in Pulse and habitants-web, then `npm install`
there; the iOS apps update their SwiftPM version).

### What to bring from the old Mac, and what not

| Bring | Why |
|---|---|
| Nothing | Everything is in git. |
| Any commit or tag not yet pushed | Clone gets only what is on GitHub. |

| Do not bring | Why |
|---|---|
| wrangler's login (`~/Library/Preferences/.wrangler/`) | Log in again (step 5). |
| `dist/`, `node_modules/`, `.build/`, `.wrangler/`, `canary/src/pulse-build.ts` | Generated; all git-ignored. |

### Settings and secrets

The kit holds no secret. Apps that embed it read these at **their own** build time:

| Name | Where it lives | How to get it | Required |
|---|---|---|---|
| `PULSE_BUILD_COMMIT` | the app's build environment | The 40-hex commit; first in line for `stamp` and the plugins. | No (falls back below) |
| `GITHUB_SHA` | set by GitHub Actions | Automatic in CI. | No |
| `WORKERS_CI_COMMIT_SHA` | set by Cloudflare Workers Builds | Automatic there. | No |
| (none of the three) | | `git rev-parse HEAD` of the checkout; the build fails if no commit is found. | One source is required |
| `PULSE_BUILT_AT` | Next.js apps, written by `pulseEnv()` | Automatic. | Set for you |
| `PULSE` binding | the app's `wrangler.jsonc` / `wrangler.toml` | `"analytics_engine_datasets": [{ "binding": "PULSE", "dataset": "pulse_events" }]` | To track events |
| wrangler login | `~/Library/Preferences/.wrangler/` | `npx --yes wrangler@4.152.0 login` | Only for `canary:deploy` |

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
`supabase_read_only_user`, the role Pulse reads with. It is `security invoker`, so it runs with
that role's rights.

If a metric calls one of your functions that `PUBLIC` cannot execute, add
`--grant-execute public.my_fn()` (comma-separated for several). Grant only a function that
schema-qualifies every table it reads, or whose `search_path` lists `pg_temp` last.

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
