"use client";
import { useCallback, useEffect, useState } from "react";
import GraphView from "@/components/GraphView";
import TalkPanel from "@/components/TalkPanel";
import type { Triple } from "@/lib/types";

type Cv = { accuracy: number; n: number; baseline: number; by: string; at: string } | null;
type BrainRow = {
  id: string; name: string; description: string; example: boolean; answers: number; checks: number;
  accuracy: number | null; last10: number | null; cv: Cv;
};
type Question = { claim: string; text: string; source: string; concepts: string[]; remaining: number; check: string } | null;
type Reveal = {
  prediction: { stance: number | null; label: string; confidence: number; by: string; because: { claim: string; text: string; stance: number | null }[] };
  actual: number; correct: boolean; abstained: boolean; updated?: boolean; previous?: number;
};
type Style = { tone: string; vocabulary: string; sentence_length: string; signature_phrases: string[] } | null;
type Detail = {
  brain: BrainRow & { style: Style; utterances: number }; profile: { concept: string; name: string; mean: number; n: number }[];
  checks: { id: string; text: string; predicted: number; actual: number; correct: boolean; abstained: boolean; confidence: number; by: string }[];
  triples: Triple[];
};
type IdeaRow = { id: string; title: string };

const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const STANCE = (v: number | null | undefined, idea = false) =>
  v == null || v === -9 ? "unsure" : v === 1 ? (idea ? "lands" : "agree") : v === -1 ? (idea ? "puts off" : "disagree") : "neutral";

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}

export default function BrainsPage() {
  const [brains, setBrains] = useState<BrainRow[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [question, setQuestion] = useState<Question>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [revealIdea, setRevealIdea] = useState(false);
  const [note, setNote] = useState("");
  const [ideas, setIdeas] = useState<IdeaRow[]>([]);
  const [ideaFilter, setIdeaFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [mode, setMode] = useState<"talk" | "quiz">("talk");

  const loadList = useCallback(async () => {
    const [b, i] = await Promise.all([api<{ brains: BrainRow[] }>("/api/brains"), api<{ ideas: IdeaRow[] }>("/api/ideas")]);
    setBrains(b.brains);
    setIdeas(i.ideas);
    setSel((s) => s ?? b.brains[0]?.id ?? null);
  }, []);
  const loadDetail = useCallback(async (id: string) => setDetail(await api<Detail>(`/api/brains?id=${encodeURIComponent(id)}`)), []);
  const loadQuestion = useCallback(async (id: string, idea: string) => {
    setBusy("Brain is committing to a prediction…");
    try {
      const r = await api<{ question: Question }>(`/api/brains?id=${encodeURIComponent(id)}&next=1${idea ? `&idea=${encodeURIComponent(idea)}` : ""}`);
      setQuestion(r.question);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { loadList().catch((e) => setError(String(e.message ?? e))); }, [loadList]);
  useEffect(() => {
    if (!sel) return;
    setReveal(null); setQuestion(null);
    loadDetail(sel).catch((e) => setError(String(e.message ?? e)));
    if (mode === "quiz") loadQuestion(sel, ideaFilter).catch((e) => setError(String(e.message ?? e)));
  }, [sel, ideaFilter, mode, loadDetail, loadQuestion]);

  const answer = async (value: 1 | 0 | -1) => {
    if (!sel || !question) return;
    setBusy("Recording…");
    try {
      const r = await api<Reveal>("/api/brains", { brain: sel, claim: question.claim, value, note: note || undefined });
      setRevealIdea(question.source === "idea");
      setQuestion(null); // never re-show an answered question
      setReveal(r); setNote("");
      await Promise.all([loadDetail(sel), loadList()]);
    } catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(null); }
  };
  const next = async () => { setReveal(null); setQuestion(null); if (sel) await loadQuestion(sel, ideaFilter).catch((e) => setError(String(e.message ?? e))); };
  const crossValidate = async () => {
    if (!sel) return;
    setBusy("Cross-validating (4 folds, about 30 s)…");
    try { await api("/api/brains", { brain: sel, action: "crossvalidate" }); await Promise.all([loadDetail(sel), loadList()]); }
    catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(null); }
  };
  const create = async () => {
    if (!newName.trim()) return;
    setBusy("Creating…");
    try {
      const r = await api<{ id: string }>("/api/brains", { name: newName.trim(), description: newDesc.trim() });
      setNewName(""); setNewDesc("");
      await loadList(); setSel(r.id);
    } catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(null); }
  };

  const b = detail?.brain;
  const isIdea = question?.source === "idea";
  return (
    <main className="wrap">
      <header className="top"><h1>Brain Library</h1></header>
      <p className="sub">
        A brain is a model of <b>one mindset, trained by your answers</b>. Before each question it commits to a prediction, so
        its accuracy is measured on answers it has not seen. It is not a real person, a customer survey or a market.
      </p>
      {error && <p className="banner err" onClick={() => setError(null)}>{error}</p>}

      <div className="grid brains">
        <section className="card">
          <h2>Brains</h2>
          <div className="blist">
            {brains.map((x) => (
              <button key={x.id} className="pitch" aria-pressed={x.id === sel} onClick={() => setSel(x.id)}>
                <div className="p">{x.example ? "example (scripted answers)" : "trained by you"}</div>
                <div className="t">{x.name}</div>
                <div className="stats">
                  <span><b>{x.answers}</b> answers</span>
                  <span>self-test <b>{pct(x.accuracy)}</b> ({x.checks})</span>
                  {x.cv && <span>CV <b>{pct(x.cv.accuracy)}</b> vs {pct(x.cv.baseline)}</span>}
                </div>
              </button>
            ))}
          </div>
          <h4>New brain</h4>
          <div className="form">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name, e.g. Skeptical CFO" maxLength={80} />
            <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2} maxLength={400}
              placeholder="One line describing this mindset (helps the predictions)" />
            <button className="primary" disabled={!newName.trim() || !!busy} onClick={create}>Create brain</button>
          </div>
        </section>

        <div className="col">
          {b && (
            <section className="card">
              <h2>{b.name} <span className="r">{b.example ? "scripted example" : "your brain"}</span></h2>
              <p className="muted small">{b.description || "No description."}</p>
              <div className="kpis">
                <div><b>{b.answers}</b><span>answers</span></div>
                <div><b>{pct(b.accuracy)}</b><span>self-test accuracy ({b.checks} checks)</span></div>
                <div><b>{pct(b.last10)}</b><span>last 10 checks</span></div>
                <div>
                  <b>{b.cv ? pct(b.cv.accuracy) : "–"}</b>
                  <span>{b.cv ? `4-fold CV, baseline ${pct(b.cv.baseline)}, n=${b.cv.n}` : "cross-validation not run"}</span>
                </div>
              </div>
              <button className="chip-btn" disabled={!!busy || b.answers < 8} onClick={crossValidate}
                title="Hide a quarter of the answers, predict them from the rest, repeat 4 times">
                Run cross-validation {b.answers < 8 ? "(needs 8 answers)" : ""}
              </button>
            </section>
          )}

          {b && (
            <div className="seg" role="group" aria-label="Training mode">
              <button aria-pressed={mode === "talk"} onClick={() => setMode("talk")}>Talk (natural conversation)</button>
              <button aria-pressed={mode === "quiz"} onClick={() => setMode("quiz")}>Quiz (predict, then check)</button>
            </div>
          )}

          {b && mode === "talk" && (
            <section className="card">
              <h2>Talk <span className="r">builds beliefs and style from what you say</span></h2>
              <TalkPanel brain={b.id} name={b.name} onLearned={() => { if (sel) { loadDetail(sel).catch(() => null); loadList().catch(() => null); } }} />
            </section>
          )}

          {mode === "quiz" && (
          <section className="card">
            <h2>Quiz <span className="r">the brain predicts first, then you answer</span></h2>
            <div className="toolbar">
              <label className="muted small">Ask about:{" "}
                <select value={ideaFilter} onChange={(e) => setIdeaFilter(e.target.value)}>
                  <option value="">any statement (probe bank + ideas)</option>
                  {ideas.map((i) => <option key={i.id} value={i.id}>points of idea “{i.title}”</option>)}
                </select>
              </label>
            </div>
            {busy && <p className="muted">{busy}</p>}
            {!busy && !question && !reveal && <p className="empty">Nothing left to ask. Ask the panel a new question for new points, or switch to Talk.</p>}
            {question && !reveal && (
              <div className="question">
                <p className="qtext">“{question.text}”</p>
                <div className="chips">
                  <span className="chip">{isIdea ? "point from an idea" : "probe statement"}</span>
                  {question.concepts.map((c) => <span key={c} className="chip">{c}</span>)}
                  <span className="chip muted">{question.remaining} unanswered</span>
                </div>
                <p className="muted small">
                  {isIdea ? "As this brain, does this point land with you?" : "As this brain, do you agree?"} The brain&apos;s
                  prediction is already locked in (check <code>{question.check}</code>).
                </p>
                <input className="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional: why? (helps future predictions)" maxLength={300} />
                <div className="answers">
                  <button className="good" disabled={!!busy} onClick={() => answer(1)}>{isIdea ? "✓ Lands" : "✓ Agree"}</button>
                  <button disabled={!!busy} onClick={() => answer(0)}>○ Neutral</button>
                  <button className="bad" disabled={!!busy} onClick={() => answer(-1)}>{isIdea ? "✗ Puts me off" : "✗ Disagree"}</button>
                </div>
              </div>
            )}
            {reveal && (
              <div className={`reveal ${reveal.abstained ? "" : reveal.correct ? "ok" : "miss"}`}>
                {reveal.updated ? (
                  <p>Answer updated from <b>{STANCE(reveal.previous, revealIdea)}</b> to <b>{STANCE(reveal.actual, revealIdea)}</b>. The brain had already
                    seen this answer, so this is not counted as a self-check.</p>
                ) : <p>
                  You said <b>{STANCE(reveal.actual, revealIdea)}</b>. The brain had predicted <b>{STANCE(reveal.prediction.stance, revealIdea)}</b>
                  {reveal.prediction.stance != null && ` (confidence ${Math.round(reveal.prediction.confidence * 100)}%)`}:{" "}
                  <b>{reveal.abstained ? "no prediction (not enough evidence yet)" : reveal.correct ? "✓ correct" : "✗ wrong, it learns from this"}</b>
                </p>}
                {reveal.prediction.because.length > 0 && (
                  <>
                    <p className="muted small">It based the prediction on these earlier answers (from the graph):</p>
                    <ul className="small">
                      {reveal.prediction.because.map((x) => <li key={x.claim}>“{x.text}” → {STANCE(x.stance)} <code>{x.claim}</code></li>)}
                    </ul>
                  </>
                )}
                <p className="muted small">Predicted by {reveal.prediction.by}.</p>
                <button className="primary" onClick={next}>Next question →</button>
              </div>
            )}
          </section>
          )}

          {detail?.brain.style && (
            <section className="card">
              <h2>How {detail.brain.name} talks <span className="r">learned from {detail.brain.utterances} message{detail.brain.utterances === 1 ? "" : "s"}</span></h2>
              <div className="kpis">
                <div><b className="small">{detail.brain.style.tone || "–"}</b><span>tone</span></div>
                <div><b className="small">{detail.brain.style.vocabulary || "–"}</b><span>vocabulary</span></div>
                <div><b className="small">{detail.brain.style.sentence_length || "–"}</b><span>sentences</span></div>
              </div>
              {detail.brain.style.signature_phrases?.length > 0 && (
                <div className="chips">{detail.brain.style.signature_phrases.map((x) => <span key={x} className="chip">“{x}”</span>)}</div>
              )}
            </section>
          )}

          {detail && (
            <div className="grid two">
              <section className="card">
                <h2>What this brain cares about <span className="r">mean stance per concept</span></h2>
                {detail.profile.length === 0 && <p className="empty">No answers yet.</p>}
                <div className="bars">
                  {detail.profile.map((p) => (
                    <div key={p.concept} className="barrow" title={`${p.n} answers`}>
                      <span className="lbl">{p.name}</span>
                      <span className="track">
                        <span className={`fill ${p.mean >= 0 ? "pos" : "neg"}`}
                          style={{ left: p.mean >= 0 ? "50%" : `${50 + p.mean * 50}%`, width: `${Math.abs(p.mean) * 50}%` }} />
                      </span>
                      <span className="val">{p.mean > 0 ? "+" : ""}{p.mean.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="card">
                <h2>Recent self-checks</h2>
                {detail.checks.length === 0 && <p className="empty">Answer a question to record the first check.</p>}
                <ol className="log">
                  {detail.checks.map((c) => (
                    <li key={c.id}>
                      <span className={`fb ${c.abstained ? "" : c.correct ? "yes" : "no"}`}>{c.abstained ? "–" : c.correct ? "✓" : "✗"}</span>{" "}
                      “{c.text}” <span className="muted">predicted {STANCE(c.predicted)}, answer {STANCE(c.actual)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          )}

          {detail && detail.triples.length > 0 && (
            <section className="card">
              <h2>Brain as a graph <span className="r">(:Brain)-[:STANCE]-&gt;(:Claim)-[:MENTIONS]-&gt;(:Concept)</span></h2>
              <GraphView triples={detail.triples} onSegment={() => null} onInsight={() => null} />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
