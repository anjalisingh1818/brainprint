"use client";
import { useState } from "react";
import RichText, { type Citation } from "@/components/RichText";

type TraceStep = { tool: string; input: unknown; rows: number; ms: number; error?: string };
type Msg = { role: "user" | "assistant"; content: string; citations?: Citation[]; trace?: TraceStep[]; model?: string; error?: boolean };
type Ctx = { stimulus: string; insight: string | null; t: number; lens: string };
type Props = { context: Ctx; onCite: (label: string, id: string) => void };

const PROMPTS = [
  "Explain the selected insight: what happens here and which networks drive it?",
  "Why does the predicted attention signal drop around the cursor?",
  "Suggest a concrete rewrite for the weakest moment of this pitch.",
  "What happened at similar moments in other pitches, and what fixed them?",
];

function Answer({ m, onCite }: { m: Msg; onCite: Props["onCite"] }) {
  const verified = (m.citations ?? []).filter((c) => c.verified).length;
  return (
    <div className="answer">
      <RichText text={m.content} citations={m.citations} onCite={onCite} />
      {m.citations && (
        <div className="meta">
          {verified}/{m.citations.length} citations verified against graph query results
          {m.model ? ` · ${m.model}` : ""}
        </div>
      )}
      {m.trace && m.trace.length > 0 && (
        <details className="trace">
          <summary>Graph queries used ({m.trace.length})</summary>
          <ol>
            {m.trace.map((s, i) => (
              <li key={i}>
                <code>{s.tool}</code> <span className="muted">{s.rows} rows · {s.ms} ms{s.error ? ` · error: ${s.error}` : ""}</span>
                <pre>{typeof s.input === "object" && s.input && "statement" in s.input ? String((s.input as { statement: string }).statement) : JSON.stringify(s.input)}</pre>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

export default function AgentChat({ context, onCite }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [graphOnly, setGraphOnly] = useState(false);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text.trim() }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.filter((m) => !m.error).map(({ role, content }) => ({ role, content })),
          context,
          mode: graphOnly ? "graph-only" : "auto",
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setMsgs([...next, { role: "assistant", content: body.answer, citations: body.citations, trace: body.trace, model: body.model }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: String((e as Error).message ?? e), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat">
      <div className="prompts">
        {PROMPTS.map((p) => (
          <button key={p} className="chip-btn" disabled={busy} onClick={() => send(p)}>{p}</button>
        ))}
      </div>
      <div className="msgs">
        {msgs.length === 0 && (
          <p className="empty">
            Ask about this pitch. The agent queries the Relate graph (named queries, read-only Cypher, live vector search) and cites
            the nodes it used. Context sent: pitch <code>{context.stimulus}</code>, t={context.t}s
            {context.insight ? <>, insight <code>{context.insight}</code></> : null}.
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}${m.error ? " err" : ""}`}>
            {m.role === "assistant" && !m.error ? <Answer m={m} onCite={onCite} /> : <p>{m.content}</p>}
          </div>
        ))}
        {busy && <div className="msg assistant"><p className="muted">Querying the graph…</p></div>}
      </div>
      <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={graphOnly} onChange={(e) => setGraphOnly(e.target.checked)} />
        Graph only (no language model): answer straight from Relate queries
      </label>
      <form className="ask" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about this pitch…" disabled={busy} aria-label="Ask the agent" />
        <button type="submit" disabled={busy || !input.trim()}>Ask</button>
      </form>
    </div>
  );
}
