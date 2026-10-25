// Astro endpoints (server output): the bodies behind the integration's injected routes.
import { assertBuild, buildResponse, type Build } from './core/build.ts';
import { healthResponse } from './core/health.ts';

export function astroHealth(): () => Promise<Response> {
  return async () => healthResponse();
}

export function astroBuild(build: Build): () => Promise<Response> {
  const b = assertBuild(build);
  return async () => buildResponse(b);
}
