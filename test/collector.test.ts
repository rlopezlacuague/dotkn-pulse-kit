// POST /__pulse/e: the collector for iOS apps and browser beacons. Always 204 + no-store (a
// probe cannot learn what was accepted); everything invalid is dropped, nothing throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collector } from '../src/core/collector.ts';
import { pulse } from '../src/worker.ts';
import { pagesCollect } from '../src/pages.ts';

const IOS_BATCH = readFileSync(new URL('../fixtures/ios-batch.json', import.meta.url), 'utf8');
const BUILD = { commit: '0'.repeat(40), builtAt: '1970-01-01T00:00:00.000Z' };
const IOS_UA = 'Habitants/1.6 CFNetwork/1568.100.1 Darwin/24.0.0';

function sink() {
  const points: Array<{ indexes?: string[]; blobs?: string[]; doubles?: number[] }> = [];
  return { points, ds: { writeDataPoint: (p: { indexes?: string[]; blobs?: string[]; doubles?: number[] }) => void points.push(p) } };
}
const post = (body: string, headers: Record<string, string> = {}) => {
  const r = new Request('https://canary.example/__pulse/e', { method: 'POST', body, headers: { 'content-type': 'application/json', 'user-agent': IOS_UA, 'accept-language': 'es-CL', ...headers } });
  Object.defineProperty(r, 'cf', { value: { country: 'CL' } });
  return r;
};
async function is204(res: Response) {
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(await res.text(), '');
}

test('the Swift-produced batch (fixtures/ios-batch.json) becomes 5 points, blob by blob', async () => {
  const { points, ds } = sink();
  await is204(await collector({ app: 'pulse-kit-canary', dataset: ds })(post(IOS_BATCH)));
  assert.deepEqual(points.map((p) => p.indexes), Array(5).fill(['pulse-kit-canary']));
  assert.deepEqual(points.map((p) => p.blobs), [
    ['pulse-kit-canary', 'app_opened', 'CL', 'ios', '/', 'ios', 'es-CL', '-', '-', 'v1'],
    ['pulse-kit-canary', 'paywall_viewed', 'CL', 'ios', '/onboarding/paywall', 'ios', 'es-CL', '-', 'shown', 'v1'],
    ['pulse-kit-canary', 'habit_completed', 'CL', 'ios', '/today', 'ios', 'es-CL', '-', '-', 'v1'],
    ['pulse-kit-canary', 'signup', 'CL', 'ios', '/signup', 'ios', 'es-CL', 'tt-oct', 'apple', 'v1'],
    ['pulse-kit-canary', 'session_end', 'CL', 'ios', '-', 'ios', 'es-CL', '-', '-', 'v1'],
  ]);
  assert.deepEqual(points.map((p) => p.doubles), [[1, 0], [1, 0], [2, 1.5], [1, 0], [1, 0]]);
});

test('dropped, still 204: a wrong app, a bad event name, the 26th event, non-JSON, a wrong key, an oversize body', async () => {
  const { points, ds } = sink();
  const c = collector({ app: 'pulse-kit-canary', dataset: ds, key: 'not-a-secret' });
  const ok = (events: unknown[], app = 'pulse-kit-canary') => JSON.stringify({ app, events });
  const k = { 'x-pulse-key': 'not-a-secret' };
  await is204(await c(post(ok([{ event: 'a' }], 'other-app'), k)));
  await is204(await c(post(ok([{ event: 'Bad Name' }, { event: 'good' }]), k)));
  await is204(await c(post(ok(Array.from({ length: 26 }, (_, i) => ({ event: `e${i}` }))), k)));
  await is204(await c(post('{not json', k)));
  await is204(await c(post(ok([{ event: 'nokey' }]))));
  await is204(await c(post(ok([{ event: 'x', path: 'p'.repeat(70_000) }]), k)));
  await is204(await c(post(ok([{ event: 'x', value: 'NaN' }, { event: 'y', value: 1e308 * 10 }]), k)));
  const events = points.map((p) => p.blobs?.[1]);
  assert.deepEqual(events.slice(0, 26), ['good', ...Array.from({ length: 25 }, (_, i) => `e${i}`)]);
  assert.equal(points.length, 28, 'value not a finite number -> default 1, the event is kept');
  assert.deepEqual(points.slice(26).map((p) => p.doubles), [[1, 0], [1, 0]]);
});

test('source: ios unless the request comes from a browser (Origin): web; a body source of web|ios is honoured', async () => {
  const { points, ds } = sink();
  const c = collector({ app: 'pulse-kit-canary', dataset: ds, origins: ['https://canary.example'] });
  await c(post(JSON.stringify({ app: 'pulse-kit-canary', events: [{ event: 'view' }] }), { origin: 'https://canary.example', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }));
  await c(post(JSON.stringify({ app: 'pulse-kit-canary', events: [{ event: 'tap' }] })));
  assert.deepEqual(points.map((p) => [p.blobs?.[1], p.blobs?.[3], p.blobs?.[5]]), [['view', 'mac', 'web'], ['tap', 'ios', 'ios']]);
});

test('CORS preflight only for configured origins; GET and other paths are not the collector', async () => {
  const { ds } = sink();
  const c = collector({ app: 'pulse-kit-canary', dataset: ds, origins: ['https://canary.example'] });
  const pre = (origin: string) => new Request('https://canary.example/__pulse/e', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } });
  const yes = await c(pre('https://canary.example'));
  assert.equal(yes.status, 204);
  assert.equal(yes.headers.get('access-control-allow-origin'), 'https://canary.example');
  assert.equal(yes.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.match(yes.headers.get('access-control-allow-headers') ?? '', /content-type/);
  const no = await c(pre('https://evil.example'));
  assert.equal(no.status, 204);
  assert.equal(no.headers.get('access-control-allow-origin'), null);
  const h = pulse({ app: 'pulse-kit-canary', build: BUILD, collect: {} });
  assert.equal(await h(new Request('https://canary.example/__pulse/e'), { PULSE: ds }), null, 'GET is not collected');
  assert.equal(await h(new Request('https://canary.example/__pulse/x', { method: 'POST', body: '{}' }), { PULSE: ds }), null);
});

test('mounted: worker pulse({collect}) and pagesCollect write through the PULSE binding', async () => {
  const w = sink();
  const h = pulse({ app: 'pulse-kit-canary', build: BUILD, collect: {} });
  await is204((await h(post(IOS_BATCH), { PULSE: w.ds }))!);
  assert.equal(w.points.length, 5);
  const noCollect = pulse({ app: 'pulse-kit-canary', build: BUILD });
  assert.equal(await noCollect(post(IOS_BATCH), { PULSE: w.ds }), null, 'the collector is opt-in');
  const p = sink();
  await is204(await pagesCollect({ app: 'pulse-kit-canary' })({ request: post(IOS_BATCH), env: { PULSE: p.ds } }));
  assert.equal(p.points.length, 5);
  await is204(await pagesCollect({ app: 'pulse-kit-canary' })({ request: post(IOS_BATCH), env: {} }));
});
