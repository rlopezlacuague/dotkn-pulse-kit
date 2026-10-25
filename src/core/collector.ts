// POST /__pulse/e — the event collector for iOS apps (PulseKit) and browser beacons.
// Body: {"app": "<id>", "source"?: "ios"|"web", "events": [{event, path?, outcome?, ct?, value?, duration?}]}.
// At most 25 events per request; the app must equal the mounted id; anything invalid is dropped.
// Always 204 + no-store: a probe cannot learn what was accepted. x-pulse-key is NOT a secret (an
// app binary cannot hide one): it filters casual junk; a bot can inflate counts, never read.
import { CONTRACT, EVENT_NAME, assertAppId, type Source } from '../contract.ts';
import { track, type AnalyticsEngineDataset } from './events.ts';

export const MAX_BATCH = 25;
export const MAX_BODY = 64 * 1024;

export interface CollectorOptions {
  app: string;
  dataset: AnalyticsEngineDataset | undefined;
  /** Origins allowed to POST from a browser (CORS). */
  origins?: string[];
  /** Optional x-pulse-key value (not a secret). */
  key?: string;
}

interface RawEvent {
  event?: unknown;
  path?: unknown;
  outcome?: unknown;
  ct?: unknown;
  value?: unknown;
  duration?: unknown;
}

const str = (x: unknown) => (typeof x === 'string' && x.length > 0 ? x : undefined);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

function cors(origin: string | null, origins: string[] | undefined): Record<string, string> {
  if (!origin || !origins?.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-pulse-key',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

export function collector(o: CollectorOptions): (request: Request) => Promise<Response> {
  assertAppId(o.app);
  return async (request) => {
    const origin = request.headers.get('origin');
    const done = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...cors(origin, o.origins) } });
    if (request.method === 'OPTIONS') return done();
    if (request.method !== 'POST') return done();
    try {
      if (o.key !== undefined && request.headers.get('x-pulse-key') !== o.key) return done();
      const text = await request.text();
      if (text.length > MAX_BODY) return done();
      const body = JSON.parse(text) as { app?: unknown; source?: unknown; events?: unknown };
      if (body.app !== o.app || !Array.isArray(body.events)) return done();
      const source: Source = body.source === 'web' || body.source === 'ios' ? body.source : origin ? 'web' : 'ios';
      for (const e of (body.events as RawEvent[]).slice(0, MAX_BATCH)) {
        const event = str(e?.event);
        if (!event || !EVENT_NAME.test(event)) continue;
        const path = str(e.path);
        const outcome = str(e.outcome);
        const campaign = str(e.ct);
        const value = num(e.value);
        const size = num(e.duration);
        track(o.dataset, o.app, {
          event,
          source,
          path: path ?? '-',
          ...(outcome ? { outcome } : {}),
          ...(campaign ? { campaign } : {}),
          ...(value !== undefined ? { value } : {}),
          ...(size !== undefined ? { size } : {}),
        }, request);
      }
    } catch {
      // Malformed input is dropped like any other invalid event.
    }
    return done();
  };
}

export const COLLECTOR_PATH = CONTRACT.collector;
