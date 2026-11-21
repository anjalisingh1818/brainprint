"use client";
import { NETWORK_LABEL, type FeedbackLogRow, type FeedbackResult, type LensRow } from "@/lib/types";

type Props = {
  lens: LensRow | undefined;
  log: FeedbackLogRow[];
  last: FeedbackResult | null;
  busy: boolean;
  onUndo: (id: string) => void;
  onReset: () => void;
  onPick: (insight: string) => void;
};

const f2 = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}`;

export default function LearningLog({ lens, log, last, busy, onUndo, onReset, onPick }: Props) {
  const calibrated = lens?.weights.some((w) => Math.abs(w.w - w.base_w) > 1e-6);
  return (
    <div className="learn">
      {lens && (
        <table className="metrics">
          <thead><tr><th>{lens.name} weight</th><th>base</th><th>now</th><th>drift</th></tr></thead>
          <tbody>
            {lens.weights.map((w) => (
              <tr key={w.network}>
                <td>{NETWORK_LABEL[w.network]}</td><td>{f2(w.base_w)}</td><td><b>{f2(w.w)}</b></td>
                <td className={Math.abs(w.w - w.base_w) > 1e-6 ? "" : "muted"}>{f2(w.w - w.base_w)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {calibrated && <button className="chip-btn" disabled={busy} onClick={onReset}>Reset {lens?.name} to base weights</button>}

      {last && (
        <p className="lastFb">
          {last.verdict === "CONFIRMS" ? "✓ Confirmed" : "✗ Contradicted"} → <b>{last.lens}</b> recalibrated:{" "}
          {last.changes.filter((c) => Math.abs(c.after - c.before) >= 0.005)
            .map((c) => `${NETWORK_LABEL[c.network]} ${f2(c.before)}→${f2(c.after)}`).join(", ")}.{" "}
          This insight&apos;s mean score {f2(last.insight_score.before)}→{f2(last.insight_score.after)}; pitch mean{" "}
          {f2(last.pitch_mean.before)}→{f2(last.pitch_mean.after)}.
        </p>
      )}

      <h4>Learning log <span className="muted">(Feedback nodes in the graph)</span></h4>
      {log.length === 0 && <p className="empty">No feedback yet. Select an insight and mark it “Real issue” or “Not an issue”.</p>}
      <ol className="log">
        {log.map((r) => (
          <li key={r.feedback}>
            <span className={`fb ${r.verdict === "CONFIRMS" ? "yes" : "no"}`}>{r.verdict}</span>{" "}
            <button className="link" onClick={() => onPick(r.insight)}><code>{r.insight}</code></button>
            {r.comment ? ` “${r.comment}”` : ""}
            <span className="muted"> · {r.lens}: {r.networks.map((n, i) => `${NETWORK_LABEL[n]} ${f2(r.w_after[i] - r.w_before[i])}`).join(", ")}</span>
            <button className="x" disabled={busy} onClick={() => onUndo(r.feedback)}>undo</button>
          </li>
        ))}
      </ol>
      <p className="muted small">
        Only these lens weights learn (±0.1 per feedback, at most ±{0.5} from base). TRIBE&apos;s predictions are never changed.
      </p>
    </div>
  );
}
