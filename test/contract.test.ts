import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTRACT } from '../src/contract.ts';

test('CONTRACT v1 matches CONTRACT.md (the document and the constants cannot drift)', () => {
  const md = readFileSync(new URL('../CONTRACT.md', import.meta.url), 'utf8');
  assert.equal(CONTRACT.version, 1);
  assert.match(md, /^# Pulse kit contract, version 1$/m);
  for (const p of [CONTRACT.health, CONTRACT.build, CONTRACT.collector, CONTRACT.events.dataset, CONTRACT.metrics.fn]) assert.ok(md.includes(`\`${p}\``), p);
  CONTRACT.events.blobs.forEach((b, i) => assert.match(md, new RegExp(`\\| blob${i + 1} \\| \`${b}\` \\|`), `blob${i + 1}`));
  CONTRACT.events.doubles.forEach((d, i) => assert.match(md, new RegExp(`\\| double${i + 1} \\| \`${d}\` \\|`), `double${i + 1}`));
});

test('swift/Sources/PulseKit/Contract.swift is exactly what npm run contract:swift generates from CONTRACT', async () => {
  const { swiftContract } = await import('../scripts/contract-swift.ts');
  const committed = readFileSync(new URL('../swift/Sources/PulseKit/Contract.swift', import.meta.url), 'utf8');
  assert.equal(committed, swiftContract());
  assert.match(committed, /static let eventName = "\^\[a-z\]\[a-z0-9_\.\]\{0,63\}\$"/);
  assert.match(committed, /static let maxBatch = 25/);
});
