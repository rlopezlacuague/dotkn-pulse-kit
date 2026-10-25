// The canary: mounts the kit first and tracks one `request` event per request, nothing else.
import { pulse, track, type AnalyticsEngineDataset } from '../../src/worker.ts';
import { PULSE_BUILD } from './pulse-build.ts';

interface Env {
  PULSE: AnalyticsEngineDataset;
}

const APP = 'pulse-kit-canary';
// The collector is mounted so PulseKit's smoke tool (and browser beacons) can write here too.
const kit = pulse({ app: APP, build: PULSE_BUILD, collect: {} });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== '/__pulse/e') track(env.PULSE, APP, { event: 'request', outcome: path === '/' ? 'home' : 'route' }, request);
    return (await kit(request, env)) ?? new Response('pulse-kit-canary: the dotkn-pulse-kit integration target\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};
