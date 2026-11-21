// POST   /api/feedback {insight, verdict: "confirm"|"contradict", comment?, lens}  -> weight changes + before/after scores
// POST   /api/feedback {action: "reset", lens}                                     -> lens back to base weights
// DELETE /api/feedback?id=fb_...                                                    -> undo one feedback exactly
import { NextResponse } from "next/server";
import { z } from "zod";
import { addFeedback, removeFeedback, resetLens } from "@/lib/feedback";
import { StoreLockedError } from "@/lib/relate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Add = z.object({
  insight: z.string().min(1).max(200),
  verdict: z.enum(["confirm", "contradict"]),
  comment: z.string().max(500).optional(),
  lens: z.string().min(1).max(64),
});
const Reset = z.object({ action: z.literal("reset"), lens: z.string().min(1).max(64) });

const fail = (e: unknown) =>
  NextResponse.json({ error: String((e as Error).message ?? e) }, { status: e instanceof StoreLockedError ? 503 : 400 });

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  try {
    const reset = Reset.safeParse(body);
    if (reset.success) return NextResponse.json(resetLens(reset.data.lens));
    const add = Add.safeParse(body);
    if (!add.success) return NextResponse.json({ error: "bad request body" }, { status: 400 });
    return NextResponse.json(addFeedback(add.data));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  try {
    return NextResponse.json(removeFeedback(id));
  } catch (e) {
    return fail(e);
  }
}
