// Idea Lab API
// GET  /api/ideas                     -> list ideas
// GET  /api/ideas?id=..               -> claims x brains predictions (+ evidence), stored as PREDICTS edges
// GET  /api/ideas?id=..&refresh=1     -> re-predict, ignoring cached PREDICTS edges
// GET  /api/ideas?id=..&advice=1      -> the same plus recommendations with verified citations
// POST /api/ideas {title, text, kind?} -> split into claims (Groq, or offline splitter) and store
import { NextResponse } from "next/server";
import { z } from "zod";
import { createIdea, evaluateIdea, listIdeas, recommend } from "@/lib/ideas";
import { ensureSeeded } from "@/lib/brains";
import { StoreLockedError } from "@/lib/relate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const fail = (e: unknown) =>
  NextResponse.json({ error: String((e as Error).message ?? e) }, { status: e instanceof StoreLockedError ? 503 : 400 });

export async function GET(req: Request) {
  try {
    await ensureSeeded();
    const u = new URL(req.url);
    const id = u.searchParams.get("id");
    if (!id) return NextResponse.json({ ideas: listIdeas() });
    if (u.searchParams.get("advice")) return NextResponse.json(await recommend(id));
    return NextResponse.json(await evaluateIdea(id, { refresh: Boolean(u.searchParams.get("refresh")) }));
  } catch (e) {
    return fail(e);
  }
}

const Create = z.object({ title: z.string().min(1).max(120), text: z.string().min(20).max(6000), kind: z.enum(["problem", "idea"]).optional() });

export async function POST(req: Request) {
  const c = Create.safeParse(await req.json().catch(() => null));
  if (!c.success) return NextResponse.json({ error: "Give the idea a title and at least a couple of sentences." }, { status: 400 });
  try {
    return NextResponse.json(await createIdea(c.data));
  } catch (e) {
    return fail(e);
  }
}
