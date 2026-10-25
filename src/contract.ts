// The Pulse kit contract, version 1. CONTRACT.md is the document; these are the constants both
// the writer (this kit, in every app) and the reader (Pulse) import, so they cannot drift.
export const CONTRACT = {
  version: 1,
  health: '/health',
  build: '/__build',
  collector: '/__pulse/e',
  events: {
    dataset: 'pulse_events',
    /** index1 holds the app id: sampling and every query are per app. */
    index: 'app',
    /** blob1..blob10, in order. */
    blobs: ['app', 'event', 'country', 'os', 'path', 'source', 'lang', 'campaign', 'outcome', 'layout'],
    /** double1..double2. */
    doubles: ['value', 'size'],
    layout: 'v1',
  },
  metrics: { fn: 'pulse.metrics()', schema: 'pulse', readRole: 'supabase_read_only_user' },
} as const;

/** A Pulse app id; also the index1 value (Analytics Engine caps an index at 96 bytes). */
export const APP_ID = /^[a-z][a-z0-9-]{0,95}$/;
export const EVENT_NAME = /^[a-z][a-z0-9_.]{0,63}$/;
export const COMMIT = /^[0-9a-f]{40}$/;
export const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export type Os = 'ios' | 'android' | 'mac' | 'win' | 'other' | 'bot' | '-';
export type Source = 'web' | 'worker' | 'ios' | 'server';

export function assertAppId(app: string): string {
  if (!APP_ID.test(app)) throw new Error(`"${app}" is not a Pulse app id (lowercase letters, digits and dashes, at most 96 bytes)`);
  return app;
}
