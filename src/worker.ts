// Workers (a plain fetch handler, or Hono via app.use): mount pulse() first in fetch(); it answers
// the contract routes and returns null for everything else.
//
//   const kit = pulse({ app: 'my-app', build: PULSE_BUILD, checks: { db: () => env.DB.prepare('select 1').first() } });
//   export default { async fetch(req, env) { return (await kit(req, env)) ?? app(req, env); } };
import { CONTRACT, assertAppId } from './contract.ts';
import { assertBuild, buildResponse, type Build } from './core/build.ts';
import { healthResponse, type Checks } from './core/health.ts';
import { collector } from './core/collector.ts';
import type { AnalyticsEngineDataset } from './core/events.ts';

export { track, toDataPoint, type PulseEvent, type AnalyticsEngineDataset } from './core/events.ts';
export type { Build } from './core/build.ts';

export interface PulseOptions {
  /** The Pulse app id (= the index1 value of its events). */
  app: string;
  /** The build stamp: `dotkn-pulse-kit stamp --out src/pulse-build.ts`, or the Vite plugin's globals. */
  build: Build;
  checks?: Checks;
  /** Mount the POST /__pulse/e collector (iOS apps, browser beacons), writing env[binding]. */
  collect?: { origins?: string[]; key?: string; binding?: string };
}

export type PulseHandler = (request: Request, env?: unknown) => Promise<Response | null>;

export function pulse(o: PulseOptions): PulseHandler {
  assertAppId(o.app);
  const build = assertBuild(o.build);
  return async (request, env) => {
    const path = new URL(request.url).pathname;
    if (o.collect && path === CONTRACT.collector && (request.method === 'POST' || request.method === 'OPTIONS')) {
      const dataset = (env as Record<string, AnalyticsEngineDataset | undefined> | undefined)?.[o.collect.binding ?? 'PULSE'];
      return collector({ app: o.app, dataset, ...(o.collect.origins ? { origins: o.collect.origins } : {}), ...(o.collect.key !== undefined ? { key: o.collect.key } : {}) })(request);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    if (path === CONTRACT.health) return healthResponse(o.checks, request.method);
    if (path === CONTRACT.build) return buildResponse(build, request.method);
    return null;
  };
}
