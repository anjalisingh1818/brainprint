"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation,
  type SimulationLinkDatum, type SimulationNodeDatum,
} from "d3-force";
import type { Triple } from "@/lib/types";

type N = SimulationNodeDatum & { id: string; label: string; name: string };
type L = SimulationLinkDatum<N> & { rel: string; w: number | null };

const COLOR: Record<string, string> = {
  Project: "#5b5bd6", Stimulus: "#3b7dd8", Segment: "#9aa0a6", Insight: "#d98a00",
  Lens: "#149c8c", Network: "#9b51e0", Revision: "#3a9d4a", Feedback: "#d64545",
  Brain: "#5b5bd6", Claim: "#d98a00", Concept: "#149c8c", Idea: "#3b7dd8",
};
const R: Record<string, number> = { Project: 11, Stimulus: 10, Insight: 9, Lens: 8, Network: 7, Revision: 9, Feedback: 7, Segment: 4, Brain: 12, Claim: 5, Concept: 7, Idea: 10 };
const W = 760, H = 520;

type Props = { triples: Triple[]; onSegment: (id: string) => void; onInsight: (id: string) => void };

export default function GraphView({ triples, onSegment, onInsight }: Props) {
  const [tick, setTick] = useState(0);
  const [info, setInfo] = useState("");
  const simRef = useRef<ReturnType<typeof forceSimulation<N>> | null>(null);

  const { nodes, links } = useMemo(() => {
    const m = new Map<string, N>();
    const add = (id: string, label: string, name: string) => {
      if (!m.has(id)) m.set(id, { id, label, name });
    };
    triples.forEach((r) => {
      add(r.a, r.a_label, r.a_name);
      add(r.b, r.b_label, r.b_name);
    });
    const links: L[] = triples.map((r) => ({ source: r.a, target: r.b, rel: r.rel, w: r.w }));
    return { nodes: [...m.values()], links };
  }, [triples]);

  useEffect(() => {
    simRef.current?.stop();
    const sim = forceSimulation<N>(nodes)
      .force("link", forceLink<N, L>(links).id((d) => d.id).distance((l) => (l.rel === "SIMILAR_TO" ? 70 : l.rel === "ABOUT" ? 34 : 80)).strength(0.6))
      .force("charge", forceManyBody().strength(-160))
      .force("center", forceCenter(W / 2, H / 2))
      .force("collide", forceCollide<N>().radius((d) => (R[d.label] ?? 5) + 3))
      .on("tick", () => setTick((t) => t + 1));
    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [nodes, links]);

  const legend = [...new Set(nodes.map((n) => n.label))];
  const clamp = (v: number | undefined, lo: number, hi: number) => Math.max(lo, Math.min(hi, v ?? 0));

  return (
    <div className="graph" data-tick={tick}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Graph neighbourhood of this pitch in Relate">
        {links.map((l, i) => {
          const s = l.source as N, t = l.target as N;
          return (
            <line key={i} className={`edge${l.rel === "SIMILAR_TO" ? " sim" : ""}`}
              x1={clamp(s.x, 8, W - 8)} y1={clamp(s.y, 8, H - 8)} x2={clamp(t.x, 8, W - 8)} y2={clamp(t.y, 8, H - 8)}
              onMouseEnter={() => setInfo(`(${s.label} ${s.name})-[:${l.rel}${l.w != null ? ` {${l.rel === "WEIGHTS" ? "w" : l.rel === "STANCE" ? "value" : "score"}: ${l.w}}` : ""}]->(${t.label} ${t.name})`)} />
          );
        })}
        {nodes.map((n) => (
          <g key={n.id} className="node" transform={`translate(${clamp(n.x, 8, W - 8)},${clamp(n.y, 8, H - 8)})`}
            style={{ cursor: n.label === "Segment" || n.label === "Insight" ? "pointer" : "default" }}
            onMouseEnter={() => setInfo(`(:${n.label} {id: "${n.id}"})  ${n.name}`)}
            onClick={() => (n.label === "Segment" ? onSegment(n.id) : n.label === "Insight" ? onInsight(n.id) : null)}>
            <circle r={R[n.label] ?? 5} fill={COLOR[n.label] ?? "#888"} stroke="var(--panel)" strokeWidth="1.5" />
            {n.label !== "Segment" && n.label !== "Claim" && <text x={(R[n.label] ?? 5) + 3} y={3}>{n.name}</text>}
          </g>
        ))}
      </svg>
      <div className="legend">
        {legend.map((l) => <span key={l} style={{ ["--c" as string]: COLOR[l] }}>{l}</span>)}
        <span style={{ ["--c" as string]: "var(--accent)" }}>SIMILAR_TO (vector index)</span>
      </div>
      <div className="info"><code>{info || "Hover nodes and edges. Click a segment or insight to jump to it."}</code></div>
    </div>
  );
}
