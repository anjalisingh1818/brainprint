"use client";
import { useEffect, useState } from "react";
import { INSIGHT_LABEL, q, type RevisionFix, type RevisionImpact, type SecondRow } from "@/lib/types";

const W = 800, H = 200, PAD = { l: 34, r: 8, t: 10, b: 22 };

type Props = { revision: string; lens: string; lensName: string; version: number; onPick: (stimulus: string, t: number) => void };

export default function Compare({ revision, lens, lensName, version, onPick }: Props) {
  const [impact, setImpact] = useState<RevisionImpact | null>(null);
  const [fixes, setFixes] = useState<RevisionFix[]>([]);
  const [before, setBefore] = useState<SecondRow[]>([]);
  const [after, setAfter] = useState<SecondRow[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const [imp] = await q<RevisionImpact>("revision_impact", { revision, lens });
      if (!imp || !live) return;
      const [fx, b, a, rv] = await Promise.all([
        q<RevisionFix>("revision_fixes", { revision }),
        q<SecondRow>("stimulus_seconds", { stimulus: imp.before, lens }),
        q<SecondRow>("stimulus_seconds", { stimulus: imp.after, lens }),
        q<{ revision: string; role: string }>("stimulus_meta", { stimulus: imp.after }),
      ]);
      if (!live) return;
      setImpact(imp); setFixes(fx); setBefore(b); setAfter(a);
      setNote(String((rv[0] as unknown as { title?: string })?.title ?? ""));
    })().catch(() => null);
    return () => { live = false; };
  }, [revision, lens, version]);

  if (!impact) return <p className="empty">Loading revision…</p>;
  const tMax = Math.max(1, before.at(-1)?.t ?? 1, after.at(-1)?.t ?? 1);
  const ext = Math.max(1, ...[...before, ...after].map((s) => Math.abs(s.score)));
  const x = (t: number) => PAD.l + (t / tMax) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v + ext) / (2 * ext)) * (H - PAD.t - PAD.b);
  const path = (rows: SecondRow[]) => rows.map((s, i) => `${i ? "L" : "M"}${x(s.t).toFixed(1)},${y(s.score).toFixed(1)}`).join("");
  const delta = (a: number, b: number) => `${b - a >= 0 ? "+" : ""}${(b - a).toFixed(2)}`;

  return (
    <div className="compare">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${lensName} score before and after ${revision}`}>
        {fixes.map((f) => (
          <rect key={f.insight} x={x(f.t_start - 0.5)} y={PAD.t} width={Math.max(2, x(f.t_end + 0.5) - x(f.t_start - 0.5))}
            height={H - PAD.t - PAD.b} fill={`var(--kind-${f.kind})`} opacity="0.08" />
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="var(--line)" />
        <text x={PAD.l - 4} y={y(ext) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">+{ext.toFixed(1)}</text>
        <text x={PAD.l - 4} y={y(-ext) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">-{ext.toFixed(1)}</text>
        {Array.from({ length: Math.floor(tMax / 10) + 1 }, (_, i) => i * 10).map((tt) => (
          <text key={tt} x={x(tt)} y={H - 6} fontSize="10" textAnchor="middle" fill="var(--muted)">{tt}s</text>
        ))}
        <path d={path(before)} fill="none" stroke="var(--net-default_mode)" strokeWidth="2" opacity="0.85" />
        <path d={path(after)} fill="none" stroke="var(--net-motor)" strokeWidth="2.2" />
      </svg>
      <div className="legend">
        <span style={{ ["--c" as string]: "var(--net-default_mode)" }}>before: {impact.before}</span>
        <span style={{ ["--c" as string]: "var(--net-motor)" }}>after: {impact.after}{note ? ` (${note})` : ""}</span>
        <span className="muted">aligned by second; the scripts differ, so this compares overall shape, not word-for-word</span>
      </div>
      <table className="metrics">
        <thead><tr><th></th><th>before</th><th>after</th><th>change</th></tr></thead>
        <tbody>
          <tr><td>mean {lensName}</td><td>{impact.before_mean}</td><td>{impact.after_mean}</td><td>{delta(impact.before_mean, impact.after_mean)}</td></tr>
          <tr><td>worst second</td><td>{impact.before_min}</td><td>{impact.after_min}</td><td>{delta(impact.before_min, impact.after_min)}</td></tr>
          <tr><td>rule insights</td><td>{impact.insights_before}</td><td>{impact.insights_after}</td><td>{impact.insights_after - impact.insights_before}</td></tr>
        </tbody>
      </table>
      <div className="fixes">
        <b>Claimed fixes</b> ({impact.confirmed_fixes}/{impact.claimed_fixes} confirmed by your feedback):
        {fixes.map((f) => (
          <button key={f.insight} className="chip-btn" onClick={() => onPick(impact.before, f.t_start)}>
            {INSIGHT_LABEL[f.kind] ?? f.kind} t={f.t_start}–{f.t_end}s{" "}
            {f.feedback.includes("CONFIRMS") ? "✓" : f.feedback.includes("CONTRADICTS") ? "✗" : "· no feedback"}
          </button>
        ))}
      </div>
    </div>
  );
}
