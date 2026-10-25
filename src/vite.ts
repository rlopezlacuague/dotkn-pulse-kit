// Vite plugin: bakes __PULSE_COMMIT__ / __PULSE_BUILT_AT__ (the build fails without a commit) and,
// with emit: true (static sites), writes /health and /__build plus their _headers rules.
//   vite.config:  plugins: [pulseBuild()]            (Workers / React Router: the loaders read the globals)
//                 plugins: [pulseBuild({ emit: true })]  (static prerendered sites on Pages)
import { resolve } from 'node:path';
import { defineValues, stampBuild, type Env, type Exec } from './build-node.ts';
import type { Build } from './core/build.ts';
import { writeStatic } from './static.ts';

export interface PulseBuildOptions {
  emit?: boolean;
  env?: Env;
  exec?: Exec;
  now?: () => number;
}

export function pulseBuild(o: PulseBuildOptions = {}) {
  let build: Build | undefined;
  let outDir: string | undefined;
  const stamp = () => (build ??= stampBuild(o.env, o.exec, o.now));
  return {
    name: 'dotkn-pulse-kit',
    config() {
      return { define: defineValues(stamp()) };
    },
    configResolved(c: { build: { outDir: string }; root: string }) {
      outDir = resolve(c.root, c.build.outDir);
    },
    writeBundle() {
      if (o.emit && outDir) writeStatic(outDir, stamp());
    },
  };
}
