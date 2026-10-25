// Next.js route handlers (Workers runtime via OpenNext; no Node API here). `_`-prefixed app
// folders are private in Next, so /health and /__build reach these through rewrites:
//   app/api/pulse/health/route.ts:  export const GET = healthGET();  export const dynamic = 'force-dynamic';
//   app/api/pulse/build/route.ts:   export const GET = buildGET();
//   next.config:  env: pulseEnv(), rewrites: async () => pulseRewrites()   (from 'dotkn-pulse-kit/next-config')
import { assertBuild, buildResponse } from './core/build.ts';
import { healthResponse, type Checks } from './core/health.ts';

export function healthGET(checks?: () => Checks): () => Promise<Response> {
  return async () => healthResponse(checks?.());
}

/** Reads the values next.config's `env: pulseEnv()` inlined at build; fails when the module
 * loads (a missing stamp is a broken build, not a probe-time surprise). */
export function buildGET(env: Record<string, string | undefined> = { PULSE_BUILD_COMMIT: process.env.PULSE_BUILD_COMMIT, PULSE_BUILT_AT: process.env.PULSE_BUILT_AT }): () => Promise<Response> {
  if (!env.PULSE_BUILD_COMMIT) throw new Error('PULSE_BUILD_COMMIT is not set: add env: pulseEnv() to next.config');
  const b = assertBuild({ commit: env.PULSE_BUILD_COMMIT, builtAt: env.PULSE_BUILT_AT ?? '' });
  return async () => buildResponse(b);
}
