"use client";
import { useState } from "react";
import { INSIGHT_LABEL, NETWORK_LABEL, type InsightRow } from "@/lib/types";

type Props = {
  ins: InsightRow;
  selected: boolean;
  lensName: string;
  busy: boolean;
  onSelect: () => void;
  onFeedback: (verdict: "confirm" | "contradict", comment: string) => void;
  onUndo: (feedbackId: string) => void;
};

export default function InsightCard({ ins, selected, lensName, busy, onSelect, onFeedback, onUndo }: Props) {
  const [comment, setComment] = useState("");
  return (
    <div className="insight" role="button" tabIndex={0} aria-pressed={selected}
      style={{ ["--k" as string]: `var(--kind-${ins.kind})` }}
      onClick={onSelect} onKeyDown={(e) => (e.key === "Enter" ? onSelect() : null)}>
      <div className="h">
        <span>{INSIGHT_LABEL[ins.kind] ?? ins.kind}</span>
        <small>t={ins.t_start}–{ins.t_end}s · severity {ins.severity.toFixed(2)}</small>
      </div>
      <p>{ins.summary}</p>
      <div className="chips">
        {ins.drivers.map((d) => (
          <span key={d.network} className="chip">{NETWORK_LABEL[d.network]} {d.z > 0 ? "+" : ""}{d.z.toFixed(2)}</span>
        ))}
        <span className="chip"><code>{ins.insight}</code></span>
      </div>
      {ins.feedback.length > 0 && (
        <div className="fbList">
          {ins.feedback.map((f) => (
            <span key={f.id} className={`fb ${f.verdict === "CONFIRMS" ? "yes" : "no"}`} onClick={(e) => e.stopPropagation()}>
              {f.verdict === "CONFIRMS" ? "✓ confirmed" : "✗ contradicted"} ({f.lens}){f.comment ? `: “${f.comment}”` : ""}
              <button className="x" disabled={busy} title="Undo this feedback and revert its weight change" onClick={() => onUndo(f.id)}>undo</button>
            </span>
          ))}
        </div>
      )}
      {selected && (
        <div className="fbForm" onClick={(e) => e.stopPropagation()}>
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional note (why?)" maxLength={500}
            aria-label="Feedback note" disabled={busy} />
          <button className="good" disabled={busy} onClick={() => { onFeedback("confirm", comment); setComment(""); }}
            title={`CONFIRMS edge; recalibrates the ${lensName} lens to score moments like this lower`}>✓ Real issue</button>
          <button className="bad" disabled={busy} onClick={() => { onFeedback("contradict", comment); setComment(""); }}
            title={`CONTRADICTS edge; recalibrates the ${lensName} lens to score moments like this higher`}>✗ Not an issue</button>
        </div>
      )}
    </div>
  );
}
