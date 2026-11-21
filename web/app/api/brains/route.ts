// Brain Library API
// GET  /api/brains                        -> all brains with stats
// GET  /api/brains?id=..                  -> one brain: stats, concept profile, recent self-checks, graph triples
// GET  /api/brains?id=..&next=1[&idea=..] -> next training question (least-confident unanswered claim)
// POST /api/brains {name, description}    -> create a brain
// POST /api/brains {brain, claim, value: 1|0|-1, note?} -> answer (resolves the pending held-out self-check)
// POST /api/brains {brain, action: "crossvalidate"} -> 4-fold CV accuracy vs majority baseline, stored on the Brain
import { NextResponse } from "next/server";
import { z } from "zod";
import { answer, brainStats, createBrain, crossValidate, ensureSeeded, nextQuestion } from "@/lib/brains";
import { connection, StoreLockedError, type Row } from "@/lib/relate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const q = (c: string, p: Record<string, unknown> = {}) => connection().query(c, p as never).rows as Row[];
const fail = (e: unknown) =>
  NextResponse.json({ error: String((e as Error).message ?? e) }, { status: e instanceof StoreLockedError ? 503 : 400 });

export async function GET(req: Request) {
  try {
    await ensureSeeded();
    const u = new URL(req.url);
    const id = u.searchParams.get("id");
    if (!id) {
      const brains = q(`MATCH (b:Brain) RETURN b.id AS id, b.name AS name, b.description AS description, b.example AS example ORDER BY example, name`);
      return NextResponse.json({ brains: brains.map((b) => ({ ...b, ...brainStats(String(b.id)) })) });
    }
    if (u.searchParams.get("next")) return NextResponse.json({ question: await nextQuestion(id, u.searchParams.get("idea") ?? undefined) });
    const brain = q(`MATCH (b:Brain {id: $id}) RETURN b.id AS id, b.name AS name, b.description AS description, b.example AS example`, { id })[0];
    if (!brain) return NextResponse.json({ error: "unknown brain" }, { status: 404 });
    const profile = q(
      `MATCH (:Brain {id: $id})-[s:STANCE]->(:Claim)-[:MENTIONS]->(x:Concept)
       RETURN x.id AS concept, x.name AS name, round(avg(s.value), 2) AS mean, count(*) AS n ORDER BY n DESC, name LIMIT 14`, { id });
    const checks = q(
      `MATCH (k:Check)-[:OF]->(:Brain {id: $id}), (k)-[:ON]->(c:Claim)
       WHERE k.pending = false
       RETURN k.id AS id, c.id AS claim, c.text AS text, k.predicted AS predicted, k.actual AS actual, k.correct AS correct,
              k.abstained AS abstained, k.confidence AS confidence, k.by AS by, k.answered_at AS at ORDER BY at DESC LIMIT 12`, { id });
    const triples = q(
      `MATCH (b:Brain {id: $id})-[s:STANCE]->(c:Claim)-[:MENTIONS]->(x:Concept)
       RETURN b.id AS a, 'Brain' AS a_label, b.name AS a_name, 'STANCE' AS rel, c.id AS b, 'Claim' AS b_label, left(c.text, 40) AS b_name, s.value AS w
       UNION ALL
       MATCH (:Brain {id: $id})-[:STANCE]->(c:Claim)-[r:MENTIONS]->(x:Concept)
       RETURN c.id AS a, 'Claim' AS a_label, left(c.text, 40) AS a_name, 'MENTIONS' AS rel, x.id AS b, 'Concept' AS b_label, x.name AS b_name, null AS w`, { id });
    return NextResponse.json({ brain: { ...brain, ...brainStats(id) }, profile, checks, triples });
  } catch (e) {
    return fail(e);
  }
}

const Create = z.object({ name: z.string().min(1).max(80), description: z.string().max(400).default("") });
const Evaluate = z.object({ brain: z.string(), action: z.literal("crossvalidate") });
const Answer = z.object({ brain: z.string(), claim: z.string(), value: z.union([z.literal(1), z.literal(0), z.literal(-1)]), note: z.string().max(300).optional() });

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  try {
    await ensureSeeded();
    const ev = Evaluate.safeParse(body);
    if (ev.success) return NextResponse.json(await crossValidate(ev.data.brain));
    const a = Answer.safeParse(body);
    if (a.success) return NextResponse.json(await answer(a.data.brain, a.data.claim, a.data.value, a.data.note));
    const c = Create.safeParse(body);
    if (c.success) return NextResponse.json(createBrain(c.data.name, c.data.description));
    return NextResponse.json({ error: "bad request body" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
