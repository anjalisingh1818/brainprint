"use client";
import { useState } from "react";

type Ev = { claim: string; text: string; stance: number; note: string | null; similarity: number };
export type Cell = {
  brain: string; claim: string; stance: number | null; label: string; confidence: number; by: string; because: string[];
  evidence: Ev[]; concepts: { concept: string; name: string; mean: number; n: number }[];
};
export type BrainSum = {
  brain: string; name: string; example: boolean; answers: number; checks: number; accuracy: number | null;
  cv: { accuracy: number; n: number; baseline: number } | null; lands: number; puts_off: number; neutral: number;
};
export type Evaluation = { claims: { claim: string; text: string; concepts: string[] }[]; brains: BrainSum[]; cells: Cell[] };

const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const ICON: Record<string, string> = { "1": "✓", "0": "○", "-1": "✗" };
const LAND: Record<string, string> = { "1": "lands", "0": "neutral", "-1": "puts off" };
const VERB: Record<string, string> = { "1": "land", "0": "leave it neutral", "-1": "put it off" };

type Props = { ev: Evaluation; busy: boolean; onTeach: (brain: string, claim: string, value: 1 | 0 | -1) => void };

/** Point-by-point: every brain's predicted reaction to every claim of the question, with the evidence behind each cell. */
export default function PointMatrix({ ev, busy, onTeach }: Props) {
  const [cell, setCell] = useState<{ brain: string; claim: string } | null>(null);
  const cur = cell && ev.cells.find((c) => c.brain === cell.brain && c.claim === cell.claim);
  const curBrain = cell && ev.brains.find((b) => b.brain === cell.brain);
  const curClaim = cell && ev.claims.find((c) => c.claim === cell.claim);
  return (
    <div>
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
              <tr key={c.claim}>
                <td>{c.text}<div className="chips">{c.concepts.map((x) => <span key={x} className="chip">{x}</span>)}</div></td>
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
              {ev.brains.map((b) => <td key={b.brain} className="small">✓ {b.lands} · ○ {b.neutral} · ✗ {b.puts_off}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
      {cur && curBrain && curClaim && (
        <div className="why">
          <p><b>{curBrain.name}</b>: “{curClaim.text}” is predicted to <b>{cur.stance == null ? "be unclear" : VERB[String(cur.stance)]}</b>
            {cur.stance != null && <> (confidence {Math.round(cur.confidence * 100)}%)</>}. <span className="muted small">by {cur.by}</span></p>
          <ul className="small">
            {cur.evidence.slice(0, 4).map((e) => (
              <li key={e.claim} className={cur.because.includes(e.claim) ? "" : "muted"}>
                {cur.because.includes(e.claim) ? "★ " : ""}“{e.text}” → {e.stance === 1 ? "agree" : e.stance === -1 ? "disagree" : "neutral"}
                {" "}(similarity {e.similarity}){e.note ? `, in their words: “${e.note}”` : ""}
              </li>
            ))}
          </ul>
          <div className="answers">
            <span className="muted small">Wrong? Teach this brain:</span>
            <button className="good" disabled={busy} onClick={() => onTeach(cur.brain, cur.claim, 1)}>✓ Lands</button>
            <button disabled={busy} onClick={() => onTeach(cur.brain, cur.claim, 0)}>○ Neutral</button>
            <button className="bad" disabled={busy} onClick={() => onTeach(cur.brain, cur.claim, -1)}>✗ Puts off</button>
          </div>
        </div>
      )}
    </div>
  );
}
