// /health (runtime side): {ok:true} with no checks (the archetype's exact body), {ok, checks}
// with them; any failing check answers 503 {ok:false}. /health is public, so a check's result is
// one of three fixed words ("ok", "failed", "timeout"), never its error text (hosts, users, ports),
// and a check that does not settle within CHECK_TIMEOUT_MS cannot hold the answer.
export type Check = () => unknown | Promise<unknown>;
export type Checks = Record<string, Check>;

export const CHECK_TIMEOUT_MS = 2000;
const HEADERS = { 'cache-control': 'no-store' } as const;
const TIMEOUT = Symbol('timeout');

/** Runs every check; a check passes unless it throws, returns false or outlives the timeout. */
export async function runChecks(checks: Checks, timeoutMs = CHECK_TIMEOUT_MS): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    Object.entries(checks).map(async ([name, fn]) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const late = new Promise<typeof TIMEOUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
        });
        const r = await Promise.race([Promise.resolve().then(fn), late]);
        out[name] = r === TIMEOUT ? 'timeout' : r === false ? 'failed' : 'ok';
      } catch {
        out[name] = 'failed';
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return Object.fromEntries(Object.keys(checks).map((k) => [k, out[k] ?? 'failed']));
}

export async function healthResponse(checks?: Checks, method = 'GET'): Promise<Response> {
  let res: Response;
  if (!checks || Object.keys(checks).length === 0) res = Response.json({ ok: true }, { headers: HEADERS });
  else {
    const results = await runChecks(checks);
    const ok = Object.values(results).every((v) => v === 'ok');
    res = Response.json({ ok, checks: results }, { status: ok ? 200 : 503, headers: HEADERS });
  }
  return method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}
