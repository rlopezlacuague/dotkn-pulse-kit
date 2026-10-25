// `dotkn-pulse-kit check <base>` against real local HTTP servers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { checkContract } from '../src/check.ts';

const SHA = 'fedcba9876543210fedcba9876543210fedcba98';

async function serve(routes: Record<string, { status: number; headers: Record<string, string>; body: string }>): Promise<{ base: string; server: Server }> {
  const server = createServer((req, res) => {
    const r = routes[new URL(req.url ?? '/', 'http://x').pathname];
    if (!r) {
      res.writeHead(404).end('nope');
      return;
    }
    res.writeHead(r.status, r.headers).end(r.body);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${port}`, server };
}

const J = { 'content-type': 'application/json', 'cache-control': 'no-store' };

test('a server that meets the contract passes, and the report names the commit', async () => {
  const { base, server } = await serve({
    '/health': { status: 200, headers: J, body: '{"ok":true}' },
    '/__build': { status: 200, headers: J, body: `{"commit":"${SHA}","built_at":"2026-10-25T02:00:00.000Z"}` },
  });
  try {
    const r = await checkContract(base);
    assert.deepEqual(r.failures, []);
    assert.equal(r.ok, true);
    assert.equal(r.commit, SHA);
  } finally {
    server.close();
  }
});

test('wrong headers, a short sha, a bad date and a missing route are named failures', async () => {
  const { base, server } = await serve({
    '/health': { status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' },
    '/__build': { status: 200, headers: J, body: '{"commit":"696f48d","built_at":"yesterday"}' },
  });
  try {
    const r = await checkContract(base);
    assert.equal(r.ok, false);
    assert.deepEqual(r.failures, [
      '/health: content-type is "text/plain", expected application/json',
      '/health: cache-control is missing, expected no-store',
      '/health: body is not JSON',
      '/__build: commit is "696f48d", expected 40 hex',
      '/__build: built_at is "yesterday", expected ISO 8601',
    ]);
  } finally {
    server.close();
  }
  const empty = await serve({});
  try {
    const r = await checkContract(empty.base);
    assert.deepEqual(r.failures, ['/health: status 404, expected 200', '/__build: status 404, expected 200']);
  } finally {
    empty.server.close();
  }
});

test('the collector is probed when mounted: OPTIONS and an empty POST must be 204 + no-store; absent is reported, not failed', async () => {
  const ok = { '/health': { status: 200, headers: J, body: '{"ok":true}' }, '/__build': { status: 200, headers: J, body: `{"commit":"${SHA}","built_at":"2026-10-25T02:00:00.000Z"}` } };
  const withC = await serve({ ...ok, '/__pulse/e': { status: 204, headers: { 'cache-control': 'no-store' }, body: '' } });
  try {
    const r = await checkContract(withC.base);
    assert.equal(r.collector, 'ok');
    assert.equal(r.ok, true);
  } finally {
    withC.server.close();
  }
  const without = await serve(ok);
  try {
    const r = await checkContract(without.base);
    assert.equal(r.collector, 'absent');
    assert.equal(r.ok, true);
    const strict = await checkContract(without.base, fetch, { collector: true });
    assert.equal(strict.ok, false);
    assert.deepEqual(strict.failures, ['/__pulse/e: status 404, expected 204 (the collector is not mounted)']);
  } finally {
    without.server.close();
  }
  const cached = await serve({ ...ok, '/__pulse/e': { status: 204, headers: {}, body: '' } });
  try {
    const r = await checkContract(cached.base);
    assert.deepEqual(r.failures, ['/__pulse/e: cache-control is missing, expected no-store']);
  } finally {
    cached.server.close();
  }
});
