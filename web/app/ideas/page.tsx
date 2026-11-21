"use client";
import { useCallback, useEffect, useState } from "react";
import RichText, { type Citation } from "@/components/RichText";
import { q, type OverviewRow, type StimulusMeta } from "@/lib/types";

type IdeaRow = { id: string; title: string; claims: number; stimulus: string | null };
type Ev = { claim: string; text: string; stance: number; note: string | null; similarity: number };
type Cell = {
  brain: string; claim: string; stance: number | null; label: string; confidence: number; by: string; because: string[];
  evidence: Ev[]; concepts: { concept: string; name: string; mean: number; n: number }[];
};
type BrainSum = {
  brain: string; name: string; example: boolean; answers: number; checks: number; accuracy: number | null;
  cv: { accuracy: number; n: number; baseline: number } | null; lands: number; puts_off: number; neutral: number;
  strongest_objection: string | null;
};
type Evaluation = {
  idea: { id: string; title: string; text: string; extracted_by: string; stimulus: string | null };
  claims: { claim: string; text: string; concepts: string[] }[];
  brains: BrainSum[]; cells: Cell[]; advice?: string; citations?: Citation[]; model?: string;
};

const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const ICON: Record<string, string> = { "1": "✓", "0": "○", "-1": "✗" };
const LAND: Record<string, string> = { "1": "lands", "0": "neutral", "-1": "puts off" };

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}

export default function IdeasPage() {
  const [ideas, setIdeas] = useState<IdeaRow[]>([]);
  const [pitches, setPitches] = useState<OverviewRow[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [ev, setEv] = useState<Evaluation | null>(null);
  const [cell, setCell] = useState<{ brain: string; claim: string } | null>(null);
  const [focusClaim, setFocusClaim] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [stimulus, setStimulus] = useState("");

  const loadIdeas = useCallback(async () => {
    const r = await api<{ ideas: IdeaRow[] }>("/api/ideas");
    setIdeas(r.ideas);
    setSel((s) => s ?? r.ideas[0]?.id ?? null);
  }, []);
  useEffect(() => {
    loadIdeas().catch((e) => setError(String(e.message ?? e)));
    q<OverviewRow>("overview").then(setPitches).catch(() => null);
  }, [loadIdeas]);

  const evaluate = useCallback(async (id: string, advice = false) => {
    setBusy(advice ? "Writing advice from the graph predictions…" : "Predicting how each brain reacts to each point (one call per brain)…");
    try {
      setEv(await api<Evaluation>(`/api/ideas?id=${encodeURIComponent(id)}${advice ? "&advice=1" : ""}`));
    } catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(null); }
  }, []);
  useEffect(() => { if (sel) { setCell(null); setEv(null); evaluate(sel); } }, [sel, evaluate]);

  const loadExample = async (sid: string) => {
    const m = (await q<StimulusMeta>("stimulus_meta", { stimulus: sid }))[0];
    if (m) { setTitle(m.title.replace(/\s*\(.*\)$/, "")); setText(m.script ?? ""); setStimulus(sid); }
  };
  const create = async () => {
    setBusy("Splitting the idea into points and linking them to concepts…");
    try {
      const r = await api<{ id: string }>("/api/ideas", { title, text, stimulus: stimulus || null });
      setTitle(""); setText(""); setStimulus("");
      await loadIdeas(); setSel(r.id);
    } catch (e) { setError(String((e as Error).message ?? e)); setBusy(null); }
  };
  const teach = async (brain: string, claim: string, value: 1 | 0 | -1) => {
    setBusy("Teaching the brain…");
    try {
      await api("/api/brains", { brain, claim, value });
      if (sel) await evaluate(sel);
    } catch (e) { setError(String((e as Error).message ?? e)); setBusy(null); }
  };
  const onCite = (label: string, id: string) => {
    if (label === "Claim") setFocusClaim(id);
    else if (label === "Brain" && ev) setCell({ brain: id, claim: focusClaim ?? ev.claims[0]?.claim });
  };

  const cur = cell && ev?.cells.find((c) => c.brain === cell.brain && c.claim === cell.claim);
  const curBrain = cell && ev?.brains.find((b) => b.brain === cell.brain);
  const curClaim = cell && ev?.claims.find((c) => c.claim === cell.claim);

  return (
    <main className="wrap">
      <header className="top"><h1>Idea Lab</h1></header>
      <p className="sub">
        Paste an idea or pitch. It is split into points (claims linked to concepts in the graph), and every brain in the Brain
        Library predicts whether each point <b>lands</b> or <b>puts it off</b>. These are predictions of <i>mindsets you trained</i>,
        each shown with its measured accuracy; they are not market research.
      </p>
      {error && <p className="banner err" onClick={() => setError(null)}>{error}</p>}

      <div className="grid brains">
        <section className="card">
          <h2>Ideas</h2>
          <div className="blist">
            {ideas.map((i) => (
              <button key={i.id} className="pitch" aria-pressed={i.id === sel} onClick={() => setSel(i.id)}>
                <div className="t">{i.title}</div>
                <div className="stats"><span><b>{i.claims}</b> points</span>{i.stimulus && <span>TRIBE: {i.stimulus}</span>}</div>
              </button>
            ))}
            {ideas.length === 0 && <p className="empty">No ideas yet. Add one below.</p>}
          </div>
          <h4>New idea</h4>
          <div className="chips">
            <span className="muted small">Load a demo pitch:</span>
            {pitches.map((p) => <button key={p.stimulus} className="chip-btn" onClick={() => loadExample(p.stimulus)}>{p.stimulus}</button>)}
          </div>
          <div className="form">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={120} />
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} maxLength={6000}
              placeholder="Your idea or pitch script (a few sentences or more)" />
            <label className="muted small">Same pitch analysed by TRIBE (optional):{" "}
              <select value={stimulus} onChange={(e) => setStimulus(e.target.value)}>
                <option value="">none</option>
                {pitches.map((p) => <option key={p.stimulus} value={p.stimulus}>{p.stimulus}</option>)}
              </select>
            </label>
            <button className="primary" disabled={!title.trim() || text.trim().length < 20 || !!busy} onClick={create}>Analyse idea</button>
          </div>
        </section>

        <div className="col">
          {busy && <p className="banner">{busy}</p>}
          {ev && (
            <section className="card">
              <h2>{ev.idea.title} <span className="r">points extracted by {ev.idea.extracted_by}</span></h2>
              {ev.idea.stimulus && (
                <p className="small">
                  The predicted attention timeline (TRIBE) of this pitch is on the <a href={`/?stimulus=${ev.idea.stimulus}`}>Pitch timeline</a>.
                </p>
              )}
              <div className="matrixwrap">
                <table className="matrix">
                  <thead>
                    <tr>
                      <th>Point</th>
                      {ev.brains.map((b) => (
                        <th key={b.brain} title={b.name}>
                          {b.name.replace(" (example)", "")}
                          <div className="muted small">{b.cv ? `CV ${pct(b.cv.accuracy)} vs ${pct(b.cv.baseline)}` : `${b.answers} answers`}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ev.claims.map((c) => (
                      <tr key={c.claim} className={focusClaim === c.claim ? "focus" : ""}>
                        <td>
                          {c.text}
                          <div className="chips">{c.concepts.map((x) => <span key={x} className="chip">{x}</span>)}</div>
                        </td>
                        {ev.brains.map((b) => {
                          const x = ev.cells.find((y) => y.brain === b.brain && y.claim === c.claim);
                          const k = x?.stance == null ? "u" : String(x.stance);
                          return (
                            <td key={b.brain} className={`cell s${k}${cell?.brain === b.brain && cell?.claim === c.claim ? " on" : ""}`}
                              onClick={() => setCell({ brain: b.brain, claim: c.claim })} title="Click for why">
                              <span className="ic">{x?.stance == null ? "?" : ICON[String(x.stance)]}</span>
                              <span className="small">{x?.stance == null ? "unsure" : LAND[String(x.stance)]}</span>
                              {x && x.stance != null && <span className="conf">{Math.round(x.confidence * 100)}%</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="muted small">Totals</td>
                      {ev.brains.map((b) => (
                        <td key={b.brain} className="small">✓ {b.lands} · ○ {b.neutral} · ✗ {b.puts_off}</td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}

          {cur && curBrain && curClaim && (
            <section className="card">
              <h2>Why: {curBrain.name} <span className="r">predicted by {cur.by}</span></h2>
              <p>“{curClaim.text}” is predicted to <b>{cur.stance == null ? "be unclear" : ({ "1": "land", "0": "leave it neutral", "-1": "put it off" } as Record<string, string>)[String(cur.stance)]}</b>
                {cur.stance != null && <> (confidence {Math.round(cur.confidence * 100)}%)</>}.</p>
              <p className="muted small">Evidence from the graph: this brain&apos;s most similar answers (vector index) and shared concepts.</p>
              <ul className="small">
                {cur.evidence.slice(0, 4).map((e) => (
                  <li key={e.claim} className={cur.because.includes(e.claim) ? "" : "muted"}>
                    {cur.because.includes(e.claim) ? "★ " : ""}“{e.text}” → {e.stance === 1 ? "agree" : e.stance === -1 ? "disagree" : "neutral"}
                    {" "}(similarity {e.similarity}){e.note ? `, note: “${e.note}”` : ""}
                  </li>
                ))}
              </ul>
              {cur.concepts.length > 0 && (
                <p className="small">Concepts: {cur.concepts.slice(0, 4).map((x) => `${x.name} (mean ${x.mean}, n=${x.n})`).join(", ")}</p>
              )}
              <div className="answers">
                <span className="muted small">Wrong? Teach this brain:</span>
                <button className="good" disabled={!!busy} onClick={() => teach(cur.brain, cur.claim, 1)}>✓ Lands</button>
                <button disabled={!!busy} onClick={() => teach(cur.brain, cur.claim, 0)}>○ Neutral</button>
                <button className="bad" disabled={!!busy} onClick={() => teach(cur.brain, cur.claim, -1)}>✗ Puts off</button>
              </div>
              <p className="muted small">★ = answers the model said it relied on. Teaching records a self-check and re-predicts this brain.</p>
            </section>
          )}

          {ev && (
            <section className="card">
              <h2>Advice <span className="r">{ev.model ? `by ${ev.model} · citations verified` : "graph-grounded, cites nodes"}</span></h2>
              {ev.advice ? (
                <div className="answer">
                  <RichText text={ev.advice} citations={ev.citations} onCite={onCite} />
                  {ev.citations && (
                    <div className="meta">{ev.citations.filter((c) => c.verified).length}/{ev.citations.length} citations verified against the graph facts</div>
                  )}
                </div>
              ) : (
                <button className="primary" disabled={!!busy} onClick={() => sel && evaluate(sel, true)}>Get advice</button>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
