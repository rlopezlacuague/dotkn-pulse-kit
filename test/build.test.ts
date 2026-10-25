import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCommit, stampBuild } from '../src/build-node.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);
const git = (out: string) => () => out;
const noGit = () => {
  throw new Error('fatal: not a git repository');
};

test('commit precedence: PULSE_BUILD_COMMIT, then GITHUB_SHA, then WORKERS_CI_COMMIT_SHA, then git', () => {
  assert.equal(resolveCommit({ PULSE_BUILD_COMMIT: A, GITHUB_SHA: B, WORKERS_CI_COMMIT_SHA: C }, git(D)), A);
  assert.equal(resolveCommit({ GITHUB_SHA: B, WORKERS_CI_COMMIT_SHA: C }, git(D)), B);
  assert.equal(resolveCommit({ WORKERS_CI_COMMIT_SHA: C }, git(D)), C);
  assert.equal(resolveCommit({}, git(`${D}\n`)), D, 'git output is trimmed');
  assert.equal(resolveCommit({ GITHUB_SHA: '' }, git(D)), D, 'an empty variable is absent');
});

test('fails closed: a short sha, an uppercase or garbage value, or no git at all throws (never "unknown")', () => {
  assert.throws(() => resolveCommit({ PULSE_BUILD_COMMIT: '696f48d' }, git(D)), /PULSE_BUILD_COMMIT is "696f48d", not a 40-hex commit/);
  assert.throws(() => resolveCommit({ GITHUB_SHA: A.toUpperCase() }, git(D)), /GITHUB_SHA/);
  assert.throws(() => resolveCommit({}, noGit), /no commit: set PULSE_BUILD_COMMIT .* or build inside a git checkout/);
  assert.throws(() => resolveCommit({}, git('unknown')), /git rev-parse HEAD/);
});

test('stampBuild: the resolved commit and an ISO built_at from the clock', () => {
  assert.deepEqual(stampBuild({ GITHUB_SHA: B }, noGit, () => Date.UTC(2026, 9, 25, 1, 2, 3)), { commit: B, builtAt: '2026-10-25T01:02:03.000Z' });
});

test('the real git of this checkout yields 40 hex (the default exec runs git rev-parse HEAD)', () => {
  assert.match(resolveCommit({}), /^[0-9a-f]{40}$/);
});
