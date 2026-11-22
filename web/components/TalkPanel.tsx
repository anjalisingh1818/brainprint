"use client";
import { useEffect, useRef, useState } from "react";

type Learned = { claim: string; text: string; stance: number; quote: string | null; label: string; shared: boolean };
type Style = { tone: string; vocabulary: string; sentence_length: string; signature_phrases: string[] } | null;
type Turn =
  | { who: "you"; text: string }
  | { who: "ai"; ack: string; learned: Learned[]; dropped: number; follow_up: string | null; by: string };
type TalkResult = { learned: Learned[]; dropped_unverifiable?: number; style: Style; ack: string; follow_up: string | null; by: string };

const ICON: Record<string, string> = { "1": "✓", "0": "○", "-1": "✗" };

/** Talk mode: chat as the persona; the brain extracts beliefs (with verbatim quotes) and talking style into the graph. */
export default function TalkPanel({ brain, name, onLearned }: { brain: string; name: string; onLearned: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTurns([]); setError(null);
    fetch(`/api/brains?id=${encodeURIComponent(brain)}&conversation=1`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setTurns((d.conversation ?? []).map((u: { text: string }) => ({ who: "you", text: u.text }) as Turn)))
      .catch(() => null);
  }, [brain]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [turns]);

  const send = async () => {
    const text = input.trim();
    if (text.length < 3 || busy) return;
    setTurns((t) => [...t, { who: "you", text }]);
    setInput(""); setBusy(true); setError(null);
    try {
      const res = await fetch("/api/brains", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ brain, action: "talk", message: text }) });
      const d = (await res.json()) as TalkResult & { error?: string };
      if (!res.ok) throw new Error(d.error ?? res.statusText);
      setTurns((t) => [...t, { who: "ai", ack: d.ack, learned: d.learned ?? [], dropped: d.dropped_unverifiable ?? 0, follow_up: d.follow_up, by: d.by }]);
      onLearned();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="talk">
      <p className="muted small">
        Talk as <b>{name}</b>: share opinions, complaints, how you decide, or paste something this person wrote. Each message is
        turned into beliefs with the exact words that support them, plus a profile of how this person talks. Answer the
        follow-up questions to fill the gaps.
      </p>
      <div className="msgs">
        {turns.length === 0 && <p className="empty">No conversation yet. Try: “Honestly I hate subscriptions, I want to pay once and own it.”</p>}
        {turns.map((t, i) =>
          t.who === "you" ? (
            <div key={i} className="msg user"><p>{t.text}</p></div>
          ) : (
            <div key={i} className="msg assistant">
              {t.ack && <p>{t.ack}</p>}
              {t.learned.length > 0 && (
                <ul className="small learned">
                  {t.learned.map((l) => (
                    <li key={l.claim}>
                      <span className={`fb ${l.stance === 1 ? "yes" : l.stance === -1 ? "no" : ""}`}>{ICON[String(l.stance)]} {l.label}</span>{" "}
                      “{l.text}”{l.quote ? <span className="muted">, from “{l.quote}”</span> : null}
                      {l.shared && <span className="chip" title="Another brain has a stance on the same claim: the brains are connected here">shared</span>}
                    </li>
                  ))}
                </ul>
              )}
              {t.dropped > 0 && <p className="muted small">{t.dropped} extracted belief(s) dropped: their quote was not literally in your message.</p>}
              {t.follow_up && <p className="followup">↪ {t.follow_up}</p>}
              <p className="muted small">by {t.by}</p>
            </div>
          )
        )}
        {busy && <div className="msg assistant"><p className="muted">Reading and updating the brain’s graph…</p></div>}
        <div ref={bottom} />
      </div>
      {error && <p className="err small">{error}</p>}
      <form className="ask" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={4000}
          placeholder={`Say something as ${name}…`} disabled={busy}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button type="submit" disabled={busy || input.trim().length < 3}>Send</button>
      </form>
    </div>
  );
}
