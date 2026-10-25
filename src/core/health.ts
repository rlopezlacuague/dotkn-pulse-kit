// /health (runtime side): {ok:true} with no checks (the archetype's exact body), {ok, checks}
// with them; any failing check answers 503 {ok:false} and names its reason.
export type Check = () => unknown | Promise<unknown>;
export type Checks = Record<string, Check>;

const HEADERS = { 'cache-control': 'no-store' } as const;

/** Runs every check; a check passes unless it throws or returns false. */
export async function runChecks(checks: Checks): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    Object.entries(checks).map(async ([name, fn]) => {
      try {
        out[name] = (await fn()) === false ? 'failed' : 'ok';
      } catch (e) {
        out[name] = (e instanceof Error ? e.message : String(e)).slice(0, 200) || 'failed';
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
