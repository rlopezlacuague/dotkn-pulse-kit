// Astro integration: integrations: [pulseAstro()]. Static output writes /health and /__build at
// build:done (with _headers); server output injects the two endpoints. Both define the globals.
import { fileURLToPath } from 'node:url';
import { defineValues, stampBuild, type Env, type Exec } from './build-node.ts';
import type { Build } from './core/build.ts';
import { writeStatic } from './static.ts';

export interface PulseAstroOptions {
  env?: Env;
  exec?: Exec;
  now?: () => number;
}

interface SetupArgs {
  config: { output?: string };
  injectRoute: (r: { pattern: string; entrypoint: string; prerender?: boolean }) => void;
  updateConfig: (c: { vite: { define: Record<string, string> } }) => void;
}

export function pulseAstro(o: PulseAstroOptions = {}) {
  let build: Build | undefined;
  let isStatic = true;
  return {
    name: 'dotkn-pulse-kit',
    hooks: {
      'astro:config:setup': async ({ config, injectRoute, updateConfig }: SetupArgs) => {
        build = stampBuild(o.env, o.exec, o.now);
        updateConfig({ vite: { define: defineValues(build) } });
        isStatic = (config.output ?? 'static') === 'static';
        if (!isStatic) {
          injectRoute({ pattern: '/health', entrypoint: 'dotkn-pulse-kit/astro/health', prerender: false });
          injectRoute({ pattern: '/__build', entrypoint: 'dotkn-pulse-kit/astro/build', prerender: false });
        }
      },
      'astro:build:done': async ({ dir }: { dir: URL }) => {
        if (isStatic && build) writeStatic(fileURLToPath(dir), build);
      },
    },
  };
}
