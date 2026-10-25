// next.config helpers (Node, build time).
import { stampBuild, type Env, type Exec } from './build-node.ts';
import { CONTRACT } from './contract.ts';

export function pulseRewrites(): Array<{ source: string; destination: string }> {
  return [
    { source: CONTRACT.health, destination: '/api/pulse/health' },
    { source: CONTRACT.build, destination: '/api/pulse/build' },
  ];
}

/** `env:` for next.config: the commit and build time, inlined into the route handlers. */
export function pulseEnv(env?: Env, exec?: Exec, now?: () => number): { PULSE_BUILD_COMMIT: string; PULSE_BUILT_AT: string } {
  const b = stampBuild(env, exec, now);
  return { PULSE_BUILD_COMMIT: b.commit, PULSE_BUILT_AT: b.builtAt };
}
