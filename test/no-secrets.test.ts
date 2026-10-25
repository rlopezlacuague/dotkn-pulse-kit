// The repo is public (founder decision Q3): nothing shipped or deployed may carry a key, a token,
// an account id or a Supabase project ref. Runs over the source tree and, when built, dist/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN = ['src', 'bin', 'sql', 'canary', 'swift', 'dist', 'CONTRACT.md', 'README.md'];
const PATTERNS: Array<[string, RegExp]> = [
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}/],
  ['sk- key', /\bsk-[A-Za-z0-9_-]{16,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{20,}/],
  ['32-hex id', /\b[0-9a-f]{32}\b/],
  ['Supabase ref', /\b[a-z]{20}\.supabase\.co\b|projectRef:\s*[a-z]{20}\b/],
];

function files(p: string): string[] {
  const abs = join(ROOT, p);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs).filter((n) => n !== 'node_modules' && n !== '.wrangler' && n !== '.build').flatMap((n) => files(join(p, n)));
}

test('no key, token, 32-hex id or project ref in src, bin, sql, canary, swift, dist, docs', () => {
  const hits: string[] = [];
  for (const f of SCAN.flatMap(files)) {
    if (/\.(png|jpg|ico)$/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const [name, re] of PATTERNS) if (re.test(text)) hits.push(`${f.slice(ROOT.length)}: ${name}`);
  }
  assert.deepEqual(hits, []);
});
