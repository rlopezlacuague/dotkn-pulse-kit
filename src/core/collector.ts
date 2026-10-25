// POST /__pulse/e — the event collector for iOS apps (PulseKit) and browser beacons.
// Body: {"app": "<id>", "source"?: "ios"|"web", "events": [{event, path?, outcome?, ct?, value?, duration?}]}.
// At most 25 events per request; the app must equal the mounted id; anything invalid is dropped.
// Always 204 + no-store: a probe cannot learn what was accepted. x-pulse-key is NOT a secret (an
// app binary cannot hide one): it filters casual junk; a bot can inflate counts, never read.
// Hardened in v0.1.1: a body over 64 KB is never buffered (content-length, then a byte-counted
// read that stops), only application/json is read (a cross-site form or no-cors fetch cannot
// send it without a CORS preflight), client numbers are clamped, and a path keeps no query.
// Its points carry source web or ios, which app code cannot write (events.ts): client-claimed.
import { CONTRACT, EVENT_NAME, assertAppId, type ClientSource } from '../contract.ts';
import { writeClientPoint, type AnalyticsEngineDataset } from './events.ts';

export const MAX_BATCH = 25;
export const MAX_BODY = 64 * 1024;
export const MAX_VALUE = 1_000_000;
export const MAX_DURATION_MS = 86_400_000;

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
const num = (x: unknown, max: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(Math.max(x, 0), max) : undefined);
/** A client path is a path: no query string, no fragment (tokens and emails live there). */
const pathOnly = (p: string | undefined) => p?.replace(/[?#].*$/s, '') || undefined;

/** The body as text, or undefined when it is over MAX_BODY bytes: refused from content-length
 * before reading, and otherwise read chunk by chunk and abandoned once past the limit. */
async function boundedText(request: Request): Promise<string | undefined> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) return undefined;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

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
      if (!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '')) return done();
      const text = await boundedText(request);
      if (text === undefined) return done();
      const body = JSON.parse(text) as { app?: unknown; source?: unknown; events?: unknown };
      if (body.app !== o.app || !Array.isArray(body.events)) return done();
      const source: ClientSource = body.source === 'web' || body.source === 'ios' ? body.source : origin ? 'web' : 'ios';
      for (const e of (body.events as RawEvent[]).slice(0, MAX_BATCH)) {
        const event = str(e?.event);
        if (!event || !EVENT_NAME.test(event)) continue;
        const path = pathOnly(str(e.path));
        const outcome = str(e.outcome);
        const campaign = str(e.ct);
        const value = num(e.value, MAX_VALUE);
        const size = num(e.duration, MAX_DURATION_MS);
        writeClientPoint(o.dataset, o.app, source, {
          event,
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
