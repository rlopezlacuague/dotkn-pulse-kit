import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDataPoint, track, classifyOs } from '../src/core/events.ts';
import { CONTRACT } from '../src/contract.ts';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const request = (ua = IPHONE) => {
  const r = new Request('https://habitants.app/onboarding/paywall?utm=x', { headers: { 'user-agent': ua, 'accept-language': 'es-CL,es;q=0.9,en;q=0.8' } });
  Object.defineProperty(r, 'cf', { value: { country: 'CL' } });
  return r;
};

test('toDataPoint: index1 = app, blobs in the frozen v1 order, doubles value and size', () => {
  const p = toDataPoint('habitants', { event: 'paywall_viewed', campaign: 'tt-oct', outcome: 'shown', value: 2, size: 340 }, request());
  assert.deepEqual(p.indexes, ['habitants']);
  assert.deepEqual(p.blobs, ['habitants', 'paywall_viewed', 'CL', 'ios', '/onboarding/paywall', 'worker', 'es-CL', 'tt-oct', 'shown', 'v1']);
  assert.deepEqual(p.doubles, [2, 340]);
  assert.equal(p.blobs.length, CONTRACT.events.blobs.length);
  assert.equal(p.doubles.length, CONTRACT.events.doubles.length);
});

test('defaults: value 1, size 0, missing request fields are "-", explicit path and source win', () => {
  const p = toDataPoint('canary', { event: 'request' });
  assert.deepEqual(p.blobs, ['canary', 'request', '-', '-', '-', 'worker', '-', '-', '-', 'v1']);
  assert.deepEqual(p.doubles, [1, 0]);
  const q = toDataPoint('canary', { event: 'tap', path: '/x', source: 'ios' }, request());
  assert.equal(q.blobs[4], '/x');
  assert.equal(q.blobs[5], 'ios');
});

test('UA classification: ios, android, mac, win, bot, other', () => {
  assert.equal(classifyOs(IPHONE), 'ios');
  assert.equal(classifyOs('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'ios');
  assert.equal(classifyOs('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), 'android');
  assert.equal(classifyOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'mac');
  assert.equal(classifyOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'win');
  assert.equal(classifyOs('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), 'bot');
  assert.equal(classifyOs('curl/8.7.1'), 'bot');
  assert.equal(classifyOs('Mozilla/5.0 (X11; Linux x86_64)'), 'other');
  assert.equal(classifyOs(''), '-');
});

test('limits: the index is at most 96 bytes, blobs are capped, event names follow the contract', () => {
  assert.throws(() => toDataPoint('a'.repeat(97), { event: 'x' }), /app id/);
  assert.throws(() => toDataPoint('canary', { event: 'Bad Event' }), /event name/);
  const long = toDataPoint('canary', { event: 'e', outcome: 'o'.repeat(500), path: `/${'p'.repeat(2000)}` });
  assert.equal(long.blobs[8]!.length, 64, 'outcome ≤ 64');
  assert.equal(long.blobs[4]!.length, 512, 'path ≤ 512');
});

test('track never throws: no dataset, a throwing dataset or an invalid event are dropped and reported', () => {
  assert.equal(track(undefined, 'canary', { event: 'request' }), false);
  assert.equal(track({ writeDataPoint: () => { throw new Error('boom'); } }, 'canary', { event: 'request' }), false);
  assert.equal(track({ writeDataPoint: () => {} }, 'canary', { event: 'NOPE NOPE' }), false);
  const seen: unknown[] = [];
  assert.equal(track({ writeDataPoint: (p) => seen.push(p) }, 'canary', { event: 'request' }, request()), true);
  assert.equal(seen.length, 1);
});
