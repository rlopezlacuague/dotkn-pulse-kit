// pulse_events (runtime side): one Analytics Engine point per event, in the frozen v1 layout.
// index1 = app; blobs app, event, country, os, path, source, lang, campaign, outcome, layout;
// doubles value, size. track() never throws: analytics must not break a request.
// App code writes source worker (default) or server; web and ios are written only by the
// collector (writeClientPoint), so an event a client forged can never pass for a server one.
import { CONTRACT, EVENT_NAME, assertAppId, type ClientSource, type Os, type ServerSource, type Source } from '../contract.ts';

export interface AnalyticsEngineDataset {
  writeDataPoint(p: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}

export interface PulseEvent {
  event: string;
  /** Defaults to the request's pathname. */
  path?: string;
  /** Defaults to "worker". web and ios belong to the collector. */
  source?: ServerSource;
  campaign?: string;
  outcome?: string;
  /** double1, default 1. */
  value?: number;
  /** double2 (bytes, ms), default 0. */
  size?: number;
}

export interface DataPoint {
  indexes: [string];
  blobs: string[];
  doubles: [number, number];
}

const DASH = '-';
const cap = (s: string | undefined | null, n: number) => (s ? s.slice(0, n) : DASH);

export function classifyOs(ua: string | null | undefined): Os {
  if (!ua) return DASH;
  if (/bot|crawler|spider|crawling|curl\/|wget\/|python-requests|httpclient|headless|preview/i.test(ua)) return 'bot';
  if (/iPhone|iPad|iPod|\bCFNetwork\b/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'win';
  return 'other';
}

function lang(header: string | null): string {
  const first = header?.split(',')[0]?.split(';')[0]?.trim();
  return first ? first.slice(0, 16) : DASH;
}

const SERVER_SOURCES: readonly string[] = ['worker', 'server'] satisfies ServerSource[];

export function toDataPoint(app: string, ev: PulseEvent, request?: Request): DataPoint {
  if (ev.source !== undefined && !SERVER_SOURCES.includes(ev.source)) throw new Error(`source "${String(ev.source)}" is the collector's: app code writes worker or server`);
  return point(app, ev, ev.source ?? 'worker', request);
}

function point(app: string, ev: Omit<PulseEvent, 'source'>, source: Source, request?: Request): DataPoint {
  assertAppId(app);
  if (typeof ev.event !== 'string' || !EVENT_NAME.test(ev.event)) throw new Error(`"${String(ev.event)}" is not a Pulse event name (${EVENT_NAME})`);
  const cf = (request as (Request & { cf?: { country?: string } }) | undefined)?.cf;
  const path = ev.path ?? (request ? new URL(request.url).pathname : undefined);
  const blobs = [
    app,
    ev.event,
    cap(cf?.country, 8),
    classifyOs(request?.headers.get('user-agent')),
    cap(path, 512),
    source,
    request ? lang(request.headers.get('accept-language')) : DASH,
    cap(ev.campaign, 64),
    cap(ev.outcome, 64),
    CONTRACT.events.layout,
  ];
  const num = (x: number | undefined, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  return { indexes: [app], blobs, doubles: [num(ev.value, 1), num(ev.size, 0)] };
}

/** Writes one event; false (never a throw) when there is no dataset or the event is invalid. */
export function track(dataset: AnalyticsEngineDataset | undefined, app: string, ev: PulseEvent, request?: Request): boolean {
  if (!dataset) return false;
  try {
    dataset.writeDataPoint(toDataPoint(app, ev, request));
    return true;
  } catch {
    return false;
  }
}

/** The collector's writer: the one place a point gets source web or ios. Never throws. */
export function writeClientPoint(dataset: AnalyticsEngineDataset | undefined, app: string, source: ClientSource, ev: Omit<PulseEvent, 'source'>, request?: Request): boolean {
  if (!dataset) return false;
  try {
    dataset.writeDataPoint(point(app, ev, source, request));
    return true;
  } catch {
    return false;
  }
}
