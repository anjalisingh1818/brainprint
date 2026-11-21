// GET /api/query?name=<named query>&<param>=<value>...
// Runs ONLY the named queries from graph/queries.cypher (no arbitrary Cypher from the browser).
import { NextResponse } from "next/server";
import { namedQueries, runNamed, StoreLockedError } from "@/lib/relate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  if (!name) {
    const list = Object.values(namedQueries()).map(({ name, description, params }) => ({ name, description, params }));
    return NextResponse.json({ queries: list });
  }
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    if (k !== "name") params[k] = v;
  });
  try {
    const t0 = performance.now();
    const rows = runNamed(name, params);
    return NextResponse.json({ name, params, rows, ms: Math.round((performance.now() - t0) * 10) / 10 });
  } catch (e) {
    const status = e instanceof StoreLockedError ? 503 : 400;
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status });
  }
}
