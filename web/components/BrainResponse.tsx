"use client";
import { useState } from "react";

export type Brainwave = {
  scan: null | {
    source: string; warning: string | null; duration: number; imported_at: string;
    series: { t: number; text: string; z: number[] }[];
  };
  moments: {
    id: string; text: string; start: number; end: number; z: Record<string, number>;
    claim: { id: string; text: string; sim: number } | null;
    reactions: { brain: string; name: string; stance: number }[];
  }[];
  networks: string[];
  pending: string[];
  hasFile: boolean;
};

// Coarse groupings of brain regions (see legacy/tribe/networks.py); "other" is left out of the view.
const LABEL: Record<string, string> = {
  visual: "Visual", auditory: "Hearing", language: "Language", attention: "Attention / effort",
  default_mode: "Meaning (default mode)", motor: "Motor",
};
const SHOWN = ["language", "attention", "default_mode", "auditory", "visual", "motor"];
const LAND: Record<string, string> = { "1": "✓", "0": "○", "-1": "✗" };
const Z_MAX = 2;

/** Diverging fill: below this text's own average -> blue, above -> red, around average -> neutral gray. */
function fill(z: number) {
  const p = Math.round((Math.min(Math.abs(z), Z_MAX) / Z_MAX) * 100);
  return `color-mix(in oklab, var(${z >= 0 ? "--div-hi" : "--div-lo"}) ${p}%, var(--div-mid))`;
}
const fmt = (z: number) => `${z > 0 ? "+" : ""}${z.toFixed(1)}`;

export default function BrainResponse({ bw, busy, onImport }: { bw: Brainwave; busy: boolean; onImport: () => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [moment, setMoment] = useState<number | null>(null);
  const s = bw.scan;
  if (!s) {
    return (
      <div>
        <p className="muted small">
          No TRIBE v2 result for this question yet. Run <code>brainwave/colab_brainwave.ipynb</code> on a Colab GPU, put the
          JSON files into <code>brainwave/results/</code>, then import them.
        </p>
        {bw.pending.length > 0 && (
          <button className="chip-btn" disabled={busy} onClick={onImport}>Import TRIBE results ({bw.pending.length} new file{bw.pending.length > 1 ? "s" : ""})</button>
        )}
      </div>
    );
  }
  const T = s.series.length;
  const idx = (n: string) => bw.networks.indexOf(n);
  const inMoment = (t: number) => moment != null && t >= bw.moments[moment].start && t <= bw.moments[moment].end;
  const cur = hover != null ? s.series[hover] : null;

  return (
    <div className="bw">
      {s.source !== "tribe-v2" && <p className="banner err small">Not real TRIBE output: source is “{s.source}”. {s.warning}</p>}
      <p className="muted small">
        Meta’s TRIBE v2 predicts how an <b>average brain</b> would respond to hearing this text, second by second. Colours show
        each network <b>relative to its own average over this text</b>: <span className="sw hi" /> above, <span className="sw lo" /> below.
        It is a prediction for an average person, not a measurement, and not what any persona brain thinks.
      </p>

      <div className="bwgrid" style={{ gridTemplateColumns: `150px repeat(${T}, minmax(0, 1fr))` }} onMouseLeave={() => setHover(null)}>
        <div className="bwlab muted small">sentence</div>
        {s.series.map((_, t) => {
          let m = -1; // sentences can share a boundary second: the later sentence owns it
          bw.moments.forEach((x, k) => { if (t >= x.start && t <= x.end) m = k; });
          const first = m >= 0 && bw.moments[m].start === t;
          return (
            <div key={`m${t}`} className={`bwmom${m >= 0 ? " on" : ""}${m % 2 ? " alt" : ""}${moment === m && m >= 0 ? " sel" : ""}`}
              onMouseEnter={() => { setHover(t); if (m >= 0) setMoment(m); }}>{first ? m + 1 : ""}</div>
          );
        })}
        {SHOWN.map((n) => (
          <div key={n} style={{ display: "contents" }}>
            <div className="bwlab small">{LABEL[n]}</div>
            {s.series.map((x, t) => (
              <div key={t} className={`bwcell${hover === t ? " hov" : ""}${inMoment(t) ? " inm" : ""}`}
                style={{ background: fill(x.z[idx(n)]) }} onMouseEnter={() => setHover(t)} />
            ))}
          </div>
        ))}
        <div className="bwlab muted small">seconds</div>
        {s.series.map((x, t) => <div key={`t${t}`} className="bwtick muted">{t % 10 === 0 ? x.t : ""}</div>)}
      </div>
      <div className="bwtip small">
        {cur ? (
          <>
            <b>{cur.t}s</b> “{cur.text || "…"}” ·{" "}
            {SHOWN.map((n) => <span key={n} className="bwv">{LABEL[n]} {fmt(cur.z[idx(n)])}</span>)}
          </>
        ) : <span className="muted">Hover the grid to see the words heard at each second and every network’s value.</span>}
      </div>

      <h4>Sentence by sentence, next to the persona brains</h4>
      <table className="bwtable small">
        <thead><tr><th>#</th><th>sentence</th><th>strongest response</th><th>same point for the brains</th></tr></thead>
        <tbody>
          {bw.moments.map((m, i) => {
            const top = SHOWN.map((n) => [n, m.z[n]] as const).filter(([, z]) => z >= 0.3).sort((a, b) => b[1] - a[1]).slice(0, 2);
            const off = m.reactions.filter((r) => r.stance === -1).length;
            return (
              <tr key={m.id} className={moment === i ? "sel" : ""} onMouseEnter={() => setMoment(i)}>
                <td>{i + 1}</td>
                <td>{m.text}<div className="muted">{m.start}–{m.end + 1}s</div></td>
                <td>{top.length === 0 && <span className="muted">close to average</span>}{top.map(([n, z]) => <div key={n}><span className="sw" style={{ background: fill(z) }} /> {LABEL[n]} {fmt(z)}</div>)}</td>
                <td>
                  {m.claim ? <div className="muted">“{m.claim.text}”</div> : <span className="muted">no matching point</span>}
                  {m.reactions.length > 0 && (
                    <div className="chips">
                      {m.reactions.map((r) => (
                        <span key={r.brain} className={`chip ${r.stance === 1 ? "yes" : r.stance === -1 ? "no" : ""}`}>
                          {LAND[String(r.stance)]} {r.name.replace(/ \(example\)$/, "")}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.claim && m.reactions.length === 0 && <span className="muted"> · run “Point-by-point reactions” to compare</span>}
                  {off >= 2 && <div className="bwflag">puts off {off} brains</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        Source: {s.source}, {s.duration} s, imported {s.imported_at.slice(0, 16).replace("T", " ")}. Stored in Relate as
        (:Idea)-[:SCANNED_AS]-&gt;(:Scan)-[:HAS_MOMENT]-&gt;(:Moment)-[:ABOUT]-&gt;(:Claim)&lt;-[:PREDICTS]-(:Brain).
        {bw.pending.length > 0 && <> <button className="chip-btn" disabled={busy} onClick={onImport}>Import {bw.pending.length} new result file{bw.pending.length > 1 ? "s" : ""}</button></>}
      </p>
    </div>
  );
}
