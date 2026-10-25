// React Router (framework mode), the dotkn-lab archetype's shape:
//   app/routes.ts:               ...pulseRoutes(route)
//   app/routes/pulse.health.ts:  export const loader = healthLoader();
//   app/routes/pulse.build.ts:   export const loader = buildLoader({ commit: __PULSE_COMMIT__, builtAt: __PULSE_BUILT_AT__ });
// (the two globals come from the kit's Vite plugin, pulseBuild()).
import { assertBuild, buildResponse, type Build } from './core/build.ts';
import { healthResponse, type Checks } from './core/health.ts';

export function healthLoader(checks?: () => Checks): () => Promise<Response> {
  return async () => healthResponse(checks?.());
}

export function buildLoader(build: Build): () => Promise<Response> {
  const b = assertBuild(build);
  return async () => buildResponse(b);
}

export function pulseRoutes<R>(route: (path: string, file: string) => R): R[] {
  return [route('health', 'routes/pulse.health.ts'), route('__build', 'routes/pulse.build.ts')];
}
