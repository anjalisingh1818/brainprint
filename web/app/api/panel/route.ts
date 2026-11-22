// Brain Panel API
// GET  /api/panel?idea=..                          -> stored responses (with cited beliefs), synthesis, graph triples
// POST /api/panel {action: "ask", title, text, kind} -> store the problem/idea (split into claims) and return its id
// POST /api/panel {action: "respond", idea, brain}   -> one brain's response in its own voice (GraphRAG, cites beliefs)
// POST /api/panel {action: "synthesize", idea}       -> consensus, conflicts and a joint solution across brains
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureSeeded } from "@/lib/brains";
import { createIdea } from "@/lib/ideas";
import { panelState, respond, synthesize } from "@/lib/panel";
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
    return NextResponse.json(panelState(idea));
  } catch (e) {
    return fail(e);
  }
}

const Ask = z.object({ action: z.literal("ask"), title: z.string().min(1).max(120), text: z.string().min(15).max(6000), kind: z.enum(["problem", "idea"]) });
const Respond = z.object({ action: z.literal("respond"), idea: z.string(), brain: z.string() });
const Synth = z.object({ action: z.literal("synthesize"), idea: z.string() });

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  try {
    await ensureSeeded();
    const a = Ask.safeParse(body);
    if (a.success) return NextResponse.json(await createIdea(a.data));
    const r = Respond.safeParse(body);
    if (r.success) return NextResponse.json(await respond(r.data.idea, r.data.brain));
    const s = Synth.safeParse(body);
    if (s.success) return NextResponse.json(await synthesize(s.data.idea));
    return NextResponse.json({ error: "Give it a title and a few sentences describing the problem or idea." }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
