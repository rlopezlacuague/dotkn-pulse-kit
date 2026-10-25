// Static sites (no server code): /health and /__build are files written at build, served by the
// CDN with the contract's headers through Cloudflare Pages' _headers. /__build is the honest
// deploy marker of a static deploy; /health proves the CDN serves this site.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Build } from './core/build.ts';

const RULES = ['/health', '/__build'].map((p) => `${p}\n  Content-Type: application/json\n  Cache-Control: no-store\n`).join('');
const MARK = '# dotkn-pulse-kit\n';

export function writeStatic(dir: string, b: Build): void {
  writeFileSync(join(dir, 'health'), JSON.stringify({ ok: true }));
  writeFileSync(join(dir, '__build'), JSON.stringify({ commit: b.commit, built_at: b.builtAt }));
  const file = join(dir, '_headers');
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (before.includes(MARK)) return;
  writeFileSync(file, `${before}${before && !before.endsWith('\n') ? '\n' : ''}${MARK}${RULES}`);
}
