// Brainwave API (TRIBE v2 average-brain response, joined with the persona brains)
// GET  /api/brainwave?idea=..          -> scan series, sentence moments with linked point + persona reactions, graph triples
// POST /api/brainwave {action:"import"} -> import every JSON in brainwave/results/ (written by the Colab notebook)
import { NextResponse } from "next/server";
import { z } from "zod";
import { brainwaveState, importResults } from "@/lib/brainwave";
import { ensureSeeded } from "@/lib/brains";
import { StoreLockedError } from "@/lib/relate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const fail = (e: unknown) =>
  NextResponse.json({ error: String((e as Error).message ?? e) }, { status: e instanceof StoreLockedError ? 503 : 400 });

export async function GET(req: Request) {
  const idea = new URL(req.url).searchParams.get("idea");
  if (!idea) return NextResponse.json({ error: "missing idea" }, { status: 400 });
  try {
    await ensureSeeded();
    return NextResponse.json(brainwaveState(idea));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!z.object({ action: z.literal("import") }).safeParse(body).success)
    return NextResponse.json({ error: "bad request body" }, { status: 400 });
  try {
    await ensureSeeded();
    return NextResponse.json(await importResults());
  } catch (e) {
    return fail(e);
  }
}
