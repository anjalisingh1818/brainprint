"use client";
import { useCallback, useEffect, useState } from "react";
import Timeline from "@/components/Timeline";
import BrainMap from "@/components/BrainMap";
import GraphView from "@/components/GraphView";
import AgentChat from "@/components/AgentChat";
import InsightCard from "@/components/InsightCard";
import Compare from "@/components/Compare";
import LearningLog from "@/components/LearningLog";
import {
  NETWORK_LABEL, q, send,
  type FeedbackLogRow, type FeedbackResult, type InsightRow, type LensRow, type OverviewRow, type SecondRow,
  type StimulusMeta, type Triple,
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
  // bumped after every graph write (feedback, undo, reset) so all panels re-query Relate
  const [version, setVersion] = useState(0);
  const [log, setLog] = useState<FeedbackLogRow[]>([]);
  const [lastFb, setLastFb] = useState<FeedbackResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([q<OverviewRow>("overview"), q<LensRow>("lenses"), q<FeedbackLogRow>("feedback_log")])
      .then(([o, l, f]) => { setOverview(o); setLenses(l); setLog(f); })
      .catch((e) => setError(String(e.message ?? e)));
  }, [version]);

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
  }, [stimulus, version]);

  useEffect(() => {
    let live = true;
    q<SecondRow>("stimulus_seconds", { stimulus, lens })
      .then((s) => live && setSeconds(s))
      .catch((e) => setError(String(e.message ?? e)));
    return () => { live = false; };
  }, [stimulus, lens, version]);

  const write = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); setVersion((v) => v + 1); setError(null); }
    catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  }, []);
  const giveFeedback = (insight: string, verdict: "confirm" | "contradict", comment: string) =>
    write(async () => setLastFb(await send<FeedbackResult>("POST", "/api/feedback", { insight, verdict, comment: comment || undefined, lens })));
  const undoFeedback = (id: string) => write(async () => { await send("DELETE", `/api/feedback?id=${encodeURIComponent(id)}`); setLastFb(null); });
  const resetLens = () => write(async () => { await send("POST", "/api/feedback", { action: "reset", lens }); setLastFb(null); });

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
  const revision = meta?.revisions.find((r) => r.revision)?.revision ?? "rev_ledgerly_v2";
  const calibrated = lensRow?.weights.some((w) => Math.abs(w.w - w.base_w) > 1e-6);

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
            {calibrated && <b title="weights changed by your feedback">calibrated · </b>}
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
          <h2>Insights <span className="r">select one to give feedback</span></h2>
          <div className="insights">
            {insights.length === 0 && <p className="empty">No insights for this pitch.</p>}
            {insights.map((i) => (
              <InsightCard key={i.insight} ins={i} selected={selected === i.insight} lensName={lensRow?.name ?? lens} busy={busy}
                onSelect={() => pickInsight(i.insight)}
                onFeedback={(verdict, comment) => giveFeedback(i.insight, verdict, comment)}
                onUndo={undoFeedback} />
            ))}
          </div>
        </section>

      </div>

      <div className="grid" style={{ marginTop: 14 }}>
        <section className="card">
          <h2>Before / after <span className="r">Revision <code>{revision}</code> · {lensRow?.name ?? lens} lens</span></h2>
          <Compare revision={revision} lens={lens} lensName={lensRow?.name ?? lens} version={version}
            onPick={(sid, tt) => { setStimulus(sid); setT(tt); }} />
        </section>
        <section className="card">
          <h2>Calibration <span className="r">learns from your feedback</span></h2>
          <LearningLog lens={lensRow} log={log} last={lastFb} busy={busy} onUndo={undoFeedback} onReset={resetLens}
            onPick={(id) => onCite("Insight", id)} />
        </section>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <h2>Ask the graph <span className="r">graph-grounded answers · citations verified</span></h2>
        <AgentChat context={{ stimulus, insight: selected, t, lens }} onCite={onCite} />
      </section>

      <footer className="note">
        Every panel is a named Cypher query from <code>graph/queries.cypher</code>, run on <code>graph/brainprint.rl</code> (a
        single-file Relate store) through <code>/api/query</code>.
      </footer>
    </main>
  );
}
