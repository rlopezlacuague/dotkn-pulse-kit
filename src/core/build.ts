// /__build (runtime side, Web APIs only): the commit and build time baked in at build.
import { COMMIT, ISO_8601 } from '../contract.ts';

export interface Build {
  /** The full 40-hex commit the deploy was built from. */
  commit: string;
  /** ISO 8601 build time. */
  builtAt: string;
}

const HEADERS = { 'cache-control': 'no-store' } as const;

export function assertBuild(b: Build): Build {
  if (typeof b?.commit !== 'string' || !COMMIT.test(b.commit)) throw new Error(`build commit "${b?.commit}" is not 40 hex: the build stamp is missing or short`);
  if (typeof b.builtAt !== 'string' || !ISO_8601.test(b.builtAt) || !Number.isFinite(Date.parse(b.builtAt))) throw new Error(`build time "${b.builtAt}" is not ISO 8601`);
  return b;
}

/** `{"commit": …, "built_at": …}`, the dotkn-lab archetype's exact body. */
export function buildResponse(b: Build, method = 'GET'): Response {
  const res = Response.json({ commit: b.commit, built_at: b.builtAt }, { headers: HEADERS });
  return method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}
