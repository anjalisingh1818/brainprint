"use client";
import { useCallback, useEffect, useState } from "react";
import Timeline from "@/components/Timeline";
import BrainMap from "@/components/BrainMap";
import GraphView from "@/components/GraphView";
import AgentChat from "@/components/AgentChat";
import {
  INSIGHT_LABEL, NETWORK_LABEL, q,
  type InsightRow, type LensRow, type OverviewRow, type SecondRow, type StimulusMeta, type Triple,
} from "@/lib/types";

export default function Home() {
  const [overview, setOverview] = useState<OverviewRow[]>([]);
  const [lenses, setLenses] = useState<LensRow[]>([]);
  const [stimulus, setStimulus] = useState("pitch_jargon");
  const [lens, setLens] = useState("engagement");
  const [mode, setMode] = useState<"lens" | "networks">("lens");
  const [meta, setMeta] = useState<StimulusMeta | null>(null);
  const [seconds, setSeconds] = useState<SecondRow[]>([]);
  const [insights, setInsights] = useState<InsightRow[]>([]);
  const [triples, setTriples] = useState<Triple[]>([]);
  const [t, setT] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([q<OverviewRow>("overview"), q<LensRow>("lenses")])
      .then(([o, l]) => { setOverview(o); setLenses(l); })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([
      q<StimulusMeta>("stimulus_meta", { stimulus }),
      q<InsightRow>("insight_evidence", { stimulus }),
      q<Triple>("graph_neighborhood", { stimulus }),
    ])
      .then(([m, i, g]) => {
        if (!live) return;
        setMeta(m[0] ?? null); setInsights(i); setTriples(g); setError(null);
      })
      .catch((e) => setError(String(e.message ?? e)));
    return () => { live = false; };
  }, [stimulus]);

  useEffect(() => {
    let live = true;
    q<SecondRow>("stimulus_seconds", { stimulus, lens })
      .then((s) => live && setSeconds(s))
      .catch((e) => setError(String(e.message ?? e)));
    return () => { live = false; };
  }, [stimulus, lens]);

  const pickInsight = useCallback((id: string) => {
    setSelected(id);
    const ins = insights.find((i) => i.insight === id);
    if (ins) setT(ins.t_start);
  }, [insights]);

  const pickSegment = useCallback((id: string) => {
    const i = id.lastIndexOf(":");
    const sid = id.slice(0, i), tt = Number(id.slice(i + 1));
    if (sid !== stimulus) { setStimulus(sid); setSelected(null); }
    setT(tt);
  }, [stimulus]);

  // Citation chips from the agent: jump to the cited node where the UI can show it.
  const onCite = useCallback((label: string, id: string) => {
    if (label === "Segment") pickSegment(id);
    else if (label === "Insight") {
      const sid = id.split(":")[0];
      const start = Number(id.split(":").at(-1));
      if (sid !== stimulus) setStimulus(sid);
      setSelected(id);
      if (!Number.isNaN(start)) setT(start);
    } else if (label === "Stimulus") { setStimulus(id); setSelected(null); setT(0); }
    else if (label === "Lens") setLens(id);
    else if (label === "Network") setMode("networks");
  }, [pickSegment, stimulus]);

  const lensRow = lenses.find((l) => l.lens === lens);
  const current = seconds.find((s) => s.t === t);
  const placeholder = meta?.source === "synthetic-placeholder";

  return (
    <main className="wrap">
      <header className="top">
        <h1>BrainPrint</h1>
        <span className="sub" style={{ margin: 0 }}>predicted attention and processing signals, per second, from a Relate graph</span>
      </header>
      <p className="sub">
        Meta&apos;s TRIBE v2 predicts how an <em>average</em> brain would respond to each second of a pitch. These are model
        predictions, not measurements, opinions or buying intent. Lenses are weightings over brain networks, not people.
      </p>

      {error && <p className="banner err">{error}</p>}
      {placeholder && <p className="banner">⚠ {meta?.warning}</p>}

      <section className="pitches" aria-label="Pitches">
        {overview.map((o) => (
          <button key={o.stimulus} className="pitch" aria-pressed={o.stimulus === stimulus}
            onClick={() => { setStimulus(o.stimulus); setSelected(null); setT(0); }}>
            <div className="p">{o.project}{o.source !== "tribe-v2" ? " · placeholder data" : ""}</div>
            <div className="t">{o.stimulus}</div>
            <div className="stats">
              <span><b>{o.seconds}s</b> long</span>
              <span>Engagement <b>{o.mean_engagement > 0 ? "+" : ""}{o.mean_engagement.toFixed(2)}</b></span>
              <span><b>{o.insights}</b> insights</span>
            </div>
          </button>
        ))}
      </section>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Lens">
          {lenses.map((l) => (
            <button key={l.lens} aria-pressed={l.lens === lens} onClick={() => setLens(l.lens)} title={l.description}>{l.name}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Timeline mode">
          <button aria-pressed={mode === "lens"} onClick={() => setMode("lens")}>Lens score</button>
          <button aria-pressed={mode === "networks"} onClick={() => setMode("networks")}>7 networks</button>
        </div>
        {lensRow && (
          <span className="hint">
            {lensRow.name} = {lensRow.weights.map((w) => `${w.w > 0 ? "+" : "−"}${Math.abs(w.w).toFixed(2)}·${NETWORK_LABEL[w.network]}`).join(" ")}
          </span>
        )}
      </div>

      <div className="grid">
        <section className="card">
          <h2>{meta?.title ?? stimulus} <span className="r">drag to scrub · click a band</span></h2>
          <Timeline seconds={seconds} insights={insights} mode={mode} lensName={lensRow?.name ?? lens}
            t={t} onT={setT} selectedInsight={selected} onInsight={pickInsight} />
        </section>

        <section className="card">
          <h2>Predicted regional response <span className="r">t={t}s</span></h2>
          <BrainMap regionsZ={current?.regions_z} regionNames={meta?.region_names ?? []} t={t} />
        </section>

        <section className="card">
          <h2>Graph explorer <span className="r">Relate · <code>graph_neighborhood</code></span></h2>
          <GraphView triples={triples} onSegment={pickSegment} onInsight={pickInsight} />
        </section>
        <section className="card">
          <h2>Insights <span className="r">rule-based, from graph queries</span></h2>
          <div className="insights">
            {insights.length === 0 && <p className="empty">No insights for this pitch.</p>}
            {insights.map((i) => (
              <button key={i.insight} className="insight" aria-pressed={selected === i.insight}
                style={{ ["--k" as string]: `var(--kind-${i.kind})` }} onClick={() => pickInsight(i.insight)}>
                <div className="h">
                  <span>{INSIGHT_LABEL[i.kind] ?? i.kind}</span>
                  <small>t={i.t_start}–{i.t_end}s · severity {i.severity.toFixed(2)}</small>
                </div>
                <p>{i.summary}</p>
                <div className="chips">
                  {i.drivers.map((d) => (
                    <span key={d.network} className="chip">{NETWORK_LABEL[d.network]} {d.z > 0 ? "+" : ""}{d.z.toFixed(2)}</span>
                  ))}
                  {i.feedback.map((f, k) => <span key={k} className="chip">{f.toLowerCase()}</span>)}
                  <span className="chip"><code>{i.insight}</code></span>
                </div>
              </button>
            ))}
          </div>
        </section>

      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <h2>Ask the graph <span className="r">Claude + Relate tools · answers cite graph nodes</span></h2>
        <AgentChat context={{ stimulus, insight: selected, t, lens }} onCite={onCite} />
      </section>

      <footer className="note">
        Every panel is a named Cypher query from <code>graph/queries.cypher</code>, run on <code>graph/brainprint.rl</code> (a
        single-file Relate store) through <code>/api/query</code>.
      </footer>
    </main>
  );
}
