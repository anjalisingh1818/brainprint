"use client";
import { useMemo, useRef } from "react";
import { INSIGHT_LABEL, NETWORKS, NETWORK_LABEL, type InsightRow, type NetworkName, type SecondRow } from "@/lib/types";

const W = 800;
const H = 240;
const PAD = { l: 34, r: 8, t: 10, b: 22 };

type Props = {
  seconds: SecondRow[];
  insights: InsightRow[];
  mode: "lens" | "networks";
  lensName: string;
  t: number;
  onT: (t: number) => void;
  selectedInsight: string | null;
  onInsight: (id: string) => void;
};

export default function Timeline({ seconds, insights, mode, lensName, t, onT, selectedInsight, onInsight }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const tMax = Math.max(1, (seconds.at(-1)?.t ?? 1));

  const series = useMemo(() => {
    if (mode === "lens") {
      const out = [{ key: "lens", color: "var(--accent)", values: seconds.map((s) => s.score), dashed: false }];
      // after feedback has recalibrated the lens, also show the score under the hand-set base weights
      if (seconds.some((s) => Math.abs(s.base_score - s.score) > 1e-3))
        out.unshift({ key: "base", color: "var(--muted)", values: seconds.map((s) => s.base_score), dashed: true });
      return out;
    }
    return NETWORKS.map((n) => ({
      key: n,
      color: `var(--net-${n})`,
      values: seconds.map((s) => s.acts.find((a) => a.network === n)?.strength ?? 0),
      dashed: false,
    }));
  }, [seconds, mode]);

  const all = series.flatMap((s) => s.values);
  const ext = Math.max(1, ...all.map(Math.abs));
  const x = (tt: number) => PAD.l + (tt / tMax) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v + ext) / (2 * ext)) * (H - PAD.t - PAD.b);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(seconds[i].t).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const pick = (clientX: number) => {
    const el = svg.current;
    if (!el || !seconds.length) return;
    const r = el.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    const tt = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * tMax);
    onT(Math.max(0, Math.min(tMax, tt)));
  };

  const current = seconds.find((s) => s.t === t);
  const ticks = Array.from({ length: Math.floor(tMax / 10) + 1 }, (_, i) => i * 10);

  return (
    <div className="timeline">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={mode === "lens" ? `${lensName} score per second` : "Predicted network signal per second"}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerMove={(e) => e.buttons && pick(e.clientX)}
      >
        {insights.map((i) => (
          <rect
            key={i.insight}
            x={x(i.t_start - 0.5)}
            y={PAD.t}
            width={Math.max(2, x(i.t_end + 0.5) - x(i.t_start - 0.5))}
            height={H - PAD.t - PAD.b}
            fill={`var(--kind-${i.kind})`}
            opacity={selectedInsight === i.insight ? 0.22 : 0.09}
            style={{ cursor: "pointer" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onInsight(i.insight);
            }}
          >
            <title>{`${INSIGHT_LABEL[i.kind] ?? i.kind} t=${i.t_start}-${i.t_end}s`}</title>
          </rect>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="var(--line)" />
        {[-ext, ext].map((v) => (
          <text key={v} x={PAD.l - 4} y={y(v) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">
            {v > 0 ? "+" : ""}{v.toFixed(1)}
          </text>
        ))}
        <text x={PAD.l - 4} y={y(0) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">0</text>
        {ticks.map((tt) => (
          <text key={tt} x={x(tt)} y={H - 6} fontSize="10" textAnchor="middle" fill="var(--muted)">{tt}s</text>
        ))}
        {series.map((s) => (
          <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={mode === "lens" && !s.dashed ? 2.2 : 1.5}
            strokeDasharray={s.dashed ? "4 4" : undefined} strokeLinejoin="round" />
        ))}
        <line x1={x(t)} x2={x(t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink)" strokeWidth="1" opacity="0.6" />
      </svg>
      <div className="words" aria-live="polite">
        <span className="t">t={t}s</span>
        {current?.text ? `“${current.text}”` : <span className="empty">no words in this second</span>}
        {current && mode === "lens" && <span className="t" style={{ marginLeft: 10 }}>{lensName} {current.score > 0 ? "+" : ""}{current.score.toFixed(2)}</span>}
      </div>
      {mode === "networks" ? (
        <div className="legend">
          {NETWORKS.map((n: NetworkName) => (
            <span key={n} style={{ ["--c" as string]: `var(--net-${n})` }}>{NETWORK_LABEL[n]}</span>
          ))}
        </div>
      ) : (
        <div className="legend">
          <span style={{ ["--c" as string]: "var(--accent)" }}>{lensName} score (z vs. all pitches)</span>
          {series.some((s) => s.dashed) && <span style={{ ["--c" as string]: "var(--muted)" }}>before calibration (base weights)</span>}
          {Object.entries(INSIGHT_LABEL).map(([k, v]) => (
            <span key={k} style={{ ["--c" as string]: `var(--kind-${k})` }}>{v}</span>
          ))}
        </div>
      )}
    </div>
  );
}
