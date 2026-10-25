// The adapter contract suite: every runtime adapter answers /health and /__build with exactly the
// archetype's status, headers and bytes, so dotkn-lab's watch/release/manifest work unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pulse } from '../src/worker.ts';
import { runChecks, CHECK_TIMEOUT_MS } from '../src/core/health.ts';
import { pagesHealth, pagesBuild } from '../src/pages.ts';
import { healthLoader, buildLoader, pulseRoutes } from '../src/react-router.ts';
import { healthGET, buildGET } from '../src/next.ts';
import { astroHealth, astroBuild } from '../src/astro-routes.ts';

const fx = JSON.parse(readFileSync(new URL('../fixtures/archetype.json', import.meta.url), 'utf8'));
const build = fx.build as { commit: string; builtAt: string };

async function same(res: Response | null, want: { status: number; headers: Record<string, string>; body: string }, who: string) {
  assert.ok(res, `${who}: no response`);
  assert.equal(res.status, want.status, `${who}: status`);
  for (const [k, v] of Object.entries(want.headers)) assert.equal(res.headers.get(k), v, `${who}: ${k}`);
  assert.equal(await res.text(), want.body, `${who}: body`);
}

const req = (path: string, method = 'GET') => new Request(`https://app.example${path}`, { method });

test('worker: pulse() serves /health and /__build, and passes every other request through (null)', async () => {
  const h = pulse({ app: 'canary', build });
  await same(await h(req('/health')), fx.health, 'worker /health');
  await same(await h(req('/__build')), fx.__build, 'worker /__build');
  assert.equal(await h(req('/')), null);
  assert.equal(await h(req('/healthz')), null);
  assert.equal(await h(req('/health', 'POST')), null, 'only GET/HEAD are the contract');
  const head = await h(req('/health', 'HEAD'));
  assert.equal(head?.status, 200);
  assert.equal(head?.headers.get('cache-control'), 'no-store');
});

test('pages functions, react-router loaders, next route handlers and astro endpoints answer the same bytes', async () => {
  const ctx = (path: string) => ({ request: req(path), env: {} });
  await same(await pagesHealth()(ctx('/health')), fx.health, 'pages /health');
  await same(await pagesBuild(build)(ctx('/__build')), fx.__build, 'pages /__build');
  await same(await healthLoader()(), fx.health, 'react-router /health');
  await same(await buildLoader(build)(), fx.__build, 'react-router /__build');
  await same(await healthGET()(), fx.health, 'next /health');
  await same(await buildGET({ PULSE_BUILD_COMMIT: build.commit, PULSE_BUILT_AT: build.builtAt })(), fx.__build, 'next /__build');
  await same(await astroHealth()(), fx.health, 'astro /health');
  await same(await astroBuild(build)(), fx.__build, 'astro /__build');
});

test('checks: all ok adds "checks" (additive field), one failing is 503 {ok:false} with a fixed reason, never the error text', async () => {
  const ok = pulse({ app: 'canary', build, checks: { db: async () => true } });
  const r1 = await ok(req('/health'));
  assert.equal(r1?.status, 200);
  assert.deepEqual(await r1?.json(), { ok: true, checks: { db: 'ok' } });
  const bad = pulse({ app: 'canary', build, checks: { db: async () => { throw new Error('connect ECONNREFUSED 10.0.3.7:5432 user=app_admin'); }, env: () => false } });
  const r2 = await bad(req('/health'));
  assert.equal(r2?.status, 503);
  assert.equal(r2?.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await r2?.json(), { ok: false, checks: { db: 'failed', env: 'failed' } });
});

test('a check that never settles answers "timeout" after CHECK_TIMEOUT_MS (2 s), so /health cannot hang', async () => {
  assert.equal(CHECK_TIMEOUT_MS, 2000);
  const t0 = Date.now();
  const results = await runChecks({ hang: () => new Promise(() => {}), fine: () => true }, 50);
  assert.deepEqual(results, { hang: 'timeout', fine: 'ok' });
  assert.ok(Date.now() - t0 < 1000, 'answered at the timeout, not at the hang');
});

test('a build that is not the contract fails when the handler is created, not when probed', () => {
  assert.throws(() => pulse({ app: 'canary', build: { commit: '696f48d', builtAt: build.builtAt } }), /40 hex/);
  assert.throws(() => pulse({ app: 'canary', build: { commit: build.commit, builtAt: 'today' } }), /ISO 8601/);
  assert.throws(() => pulse({ app: 'Not An Id', build }), /app id/);
  assert.throws(() => buildGET({})(), /PULSE_BUILD_COMMIT/);
});

test('react-router: pulseRoutes declares the two routes with the module files the docs name', () => {
  const calls: string[][] = [];
  const out = pulseRoutes((path: string, file: string) => (calls.push([path, file]), { path, file }));
  assert.deepEqual(calls, [['health', 'routes/pulse.health.ts'], ['__build', 'routes/pulse.build.ts']]);
  assert.equal(out.length, 2);
});
