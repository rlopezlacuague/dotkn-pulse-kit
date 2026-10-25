// Cloudflare Pages Functions: one file per route, each a re-export.
//   functions/health.ts:   export const onRequestGet = pagesHealth();
//   functions/__build.ts:  import { PULSE_BUILD } from '../src/pulse-build'; export const onRequestGet = pagesBuild(PULSE_BUILD);
// trackPages(context, app, ev) writes an event from any function (binding PULSE).
import { assertBuild, buildResponse, type Build } from './core/build.ts';
import { healthResponse, type Checks } from './core/health.ts';
import { track, type AnalyticsEngineDataset, type PulseEvent } from './core/events.ts';
import { collector } from './core/collector.ts';

export interface PagesContext {
  request: Request;
  env: unknown;
}
export type PagesFunction = (context: PagesContext) => Promise<Response>;

export function pagesHealth(checks?: (env: unknown) => Checks): PagesFunction {
  return async (ctx) => healthResponse(checks?.(ctx.env), ctx.request.method);
}

export function pagesBuild(build: Build): PagesFunction {
  const b = assertBuild(build);
  return async (ctx) => buildResponse(b, ctx.request.method);
}

export function trackPages(ctx: PagesContext, app: string, ev: PulseEvent, binding = 'PULSE'): boolean {
  const ds = (ctx.env as Record<string, AnalyticsEngineDataset | undefined> | undefined)?.[binding];
  return track(ds, app, ev, ctx.request);
}

/** functions/__pulse/e.ts:  export const onRequest = pagesCollect({ app: 'my-app', origins: ['https://my-app.example'] }); */
export function pagesCollect(o: { app: string; origins?: string[]; key?: string; binding?: string }): PagesFunction {
  return async (ctx) => {
    const dataset = (ctx.env as Record<string, AnalyticsEngineDataset | undefined> | undefined)?.[o.binding ?? 'PULSE'];
    return collector({ app: o.app, dataset, ...(o.origins ? { origins: o.origins } : {}), ...(o.key !== undefined ? { key: o.key } : {}) })(ctx.request);
  };
}
