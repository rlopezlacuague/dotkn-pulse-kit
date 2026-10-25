import { astroBuild } from '../astro-routes.ts';

declare const __PULSE_COMMIT__: string;
declare const __PULSE_BUILT_AT__: string;

export const prerender = false;
export const GET = astroBuild({ commit: __PULSE_COMMIT__, builtAt: __PULSE_BUILT_AT__ });
