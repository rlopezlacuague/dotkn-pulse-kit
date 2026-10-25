// `dotkn-pulse-kit check <base>`: probes a deployed app against the contract and names every
// deviation (status, headers, body shape), the way dotkn-lab's watch and Pulse will read it.
import { COMMIT, CONTRACT, ISO_8601 } from './contract.ts';

export interface CheckReport {
  ok: boolean;
  failures: string[];
  commit: string | null;
  builtAt: string | null;
}

export async function checkContract(base: string, f: typeof fetch = fetch): Promise<CheckReport> {
  const failures: string[] = [];
  let commit: string | null = null;
  let builtAt: string | null = null;
  const get = async (path: string): Promise<unknown> => {
    let res: Response;
    try {
      res = await f(new URL(path, base), { redirect: 'manual', headers: { 'user-agent': 'dotkn-pulse-kit check' } });
    } catch (e) {
      failures.push(`${path}: ${(e as Error).message}`);
      return undefined;
    }
    if (res.status !== 200) {
      failures.push(`${path}: status ${res.status}, expected 200`);
      return undefined;
    }
    const ct = res.headers.get('content-type');
    if (!ct?.toLowerCase().startsWith('application/json')) failures.push(`${path}: content-type is ${ct === null ? 'missing' : `"${ct}"`}, expected application/json`);
    const cc = res.headers.get('cache-control');
    if (!cc?.split(',').map((x) => x.trim()).includes('no-store')) failures.push(`${path}: cache-control is ${cc === null ? 'missing' : `"${cc}"`}, expected no-store`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      failures.push(`${path}: body is not JSON`);
      return undefined;
    }
  };
  const h = (await get(CONTRACT.health)) as { ok?: unknown } | undefined;
  if (h !== undefined && h?.ok !== true) failures.push(`${CONTRACT.health}: ok is ${JSON.stringify(h?.ok)}, expected true`);
  const b = (await get(CONTRACT.build)) as { commit?: unknown; built_at?: unknown } | undefined;
  if (b !== undefined) {
    if (typeof b.commit === 'string' && COMMIT.test(b.commit)) commit = b.commit;
    else failures.push(`${CONTRACT.build}: commit is ${JSON.stringify(b.commit)}, expected 40 hex`);
    if (typeof b.built_at === 'string' && ISO_8601.test(b.built_at) && Number.isFinite(Date.parse(b.built_at))) builtAt = b.built_at;
    else failures.push(`${CONTRACT.build}: built_at is ${JSON.stringify(b.built_at)}, expected ISO 8601`);
  }
  return { ok: failures.length === 0, failures, commit, builtAt };
}
