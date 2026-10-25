// Build-time adapters (Node): the Vite plugin, Next config helpers, the Astro integration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pulseBuild } from '../src/vite.ts';
import { pulseRewrites, pulseEnv } from '../src/next-config.ts';
import { pulseAstro } from '../src/astro.ts';

const SHA = '1234567890abcdef1234567890abcdef12345678';
const noGit = () => {
  throw new Error('not a git repository');
};
const fixed = () => Date.UTC(2026, 9, 25, 2, 0, 0);
const tmp = () => mkdtempSync(join(tmpdir(), 'pulse-kit-'));

test('vite: define bakes __PULSE_COMMIT__ / __PULSE_BUILT_AT__; GITHUB_SHA wins without git; no commit fails the build', () => {
  const p = pulseBuild({ env: { GITHUB_SHA: SHA }, exec: noGit, now: fixed });
  assert.equal(p.name, 'dotkn-pulse-kit');
  assert.deepEqual(p.config(), { define: { __PULSE_COMMIT__: JSON.stringify(SHA), __PULSE_BUILT_AT__: JSON.stringify('2026-10-25T02:00:00.000Z') } });
  assert.throws(() => pulseBuild({ env: {}, exec: noGit }).config(), /no commit/);
});

test('vite emit (static sites): writes health and __build into the out dir and appends their headers to _headers', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, '_headers'), '/*\n  X-Frame-Options: DENY\n');
    const p = pulseBuild({ env: { GITHUB_SHA: SHA }, exec: noGit, now: fixed, emit: true });
    p.config();
    p.configResolved({ build: { outDir: dir }, root: '/' });
    p.writeBundle();
    assert.equal(readFileSync(join(dir, 'health'), 'utf8'), '{"ok":true}');
    assert.equal(readFileSync(join(dir, '__build'), 'utf8'), `{"commit":"${SHA}","built_at":"2026-10-25T02:00:00.000Z"}`);
    const h = readFileSync(join(dir, '_headers'), 'utf8');
    assert.ok(h.startsWith('/*\n  X-Frame-Options: DENY\n'), 'existing rules kept first');
    assert.match(h, /\/health\n {2}Content-Type: application\/json\n {2}Cache-Control: no-store\n/);
    assert.match(h, /\/__build\n {2}Content-Type: application\/json\n {2}Cache-Control: no-store\n/);
    p.writeBundle();
    assert.equal(readFileSync(join(dir, '_headers'), 'utf8').match(/\/__build\n/g)?.length, 1, 'idempotent');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('next: the rewrite pair to the route handlers, and env baked at build', () => {
  assert.deepEqual(pulseRewrites(), [
    { source: '/health', destination: '/api/pulse/health' },
    { source: '/__build', destination: '/api/pulse/build' },
  ]);
  assert.deepEqual(pulseEnv({ GITHUB_SHA: SHA }, noGit, fixed), { PULSE_BUILD_COMMIT: SHA, PULSE_BUILT_AT: '2026-10-25T02:00:00.000Z' });
  assert.throws(() => pulseEnv({}, noGit), /no commit/);
});

test('astro static: build:done writes both files and headers; server output injects the two endpoints', async () => {
  const dir = tmp();
  try {
    const i = pulseAstro({ env: { GITHUB_SHA: SHA }, exec: noGit, now: fixed });
    const injected: Array<{ pattern: string; entrypoint: string; prerender?: boolean }> = [];
    let updated: unknown;
    await i.hooks['astro:config:setup']({ config: { output: 'static' }, injectRoute: (r) => injected.push(r), updateConfig: (c) => (updated = c) });
    assert.deepEqual(injected, [], 'static: files, not routes');
    assert.deepEqual(updated, { vite: { define: { __PULSE_COMMIT__: JSON.stringify(SHA), __PULSE_BUILT_AT__: JSON.stringify('2026-10-25T02:00:00.000Z') } } });
    await i.hooks['astro:build:done']({ dir: new URL(`file://${dir}/`) });
    assert.equal(readFileSync(join(dir, '__build'), 'utf8'), `{"commit":"${SHA}","built_at":"2026-10-25T02:00:00.000Z"}`);
    assert.ok(existsSync(join(dir, '_headers')));
    const s = pulseAstro({ env: { GITHUB_SHA: SHA }, exec: noGit, now: fixed });
    const inj2: Array<{ pattern: string; entrypoint: string }> = [];
    await s.hooks['astro:config:setup']({ config: { output: 'server' }, injectRoute: (r) => inj2.push(r), updateConfig: () => {} });
    assert.deepEqual(inj2, [
      { pattern: '/health', entrypoint: 'dotkn-pulse-kit/astro/health', prerender: false },
      { pattern: '/__build', entrypoint: 'dotkn-pulse-kit/astro/build', prerender: false },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
