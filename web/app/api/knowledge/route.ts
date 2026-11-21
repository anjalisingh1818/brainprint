// World knowledge API (P7)
// GET  /api/knowledge?idea=..                -> concepts with Wikidata links, Wikipedia summaries, bridges, web checks, graph triples
// POST /api/knowledge {action: "link", idea?, relink?} -> entity-link concepts to Wikidata (+ parents, Wikipedia summary)
// POST /api/knowledge {action: "check", claim} -> web check of one claim (Groq browser_search), sources stored as graph nodes
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkClaim, ideaKnowledge, linkConcepts } from "@/lib/knowledge";
import { ensureSeeded } from "@/lib/brains";
import { StoreLockedError } from "@/lib/relate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const fail = (e: unknown) =>
  NextResponse.json({ error: String((e as Error).message ?? e) }, { status: e instanceof StoreLockedError ? 503 : 400 });

export async function GET(req: Request) {
  const idea = new URL(req.url).searchParams.get("idea");
  if (!idea) return NextResponse.json({ error: "missing idea" }, { status: 400 });
  try {
    await ensureSeeded();
    return NextResponse.json(ideaKnowledge(idea));
  } catch (e) {
    return fail(e);
  }
}

const Link = z.object({ action: z.literal("link"), idea: z.string().optional(), relink: z.boolean().optional() });
const Check = z.object({ action: z.literal("check"), claim: z.string() });

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  try {
    await ensureSeeded();
    const l = Link.safeParse(body);
    if (l.success) return NextResponse.json(await linkConcepts(l.data.idea, l.data.relink ?? false));
    const c = Check.safeParse(body);
    if (c.success) return NextResponse.json(await checkClaim(c.data.claim));
    return NextResponse.json({ error: "bad request body" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
