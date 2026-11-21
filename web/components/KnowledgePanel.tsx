"use client";
import GraphView from "@/components/GraphView";
import type { Triple } from "@/lib/types";

export type Knowledge = {
  concepts: {
    concept: string; name: string; qid: string | null; label: string | null; description: string | null; url: string | null;
    wikipedia: string | null; summary: string | null; match: string | null; parents: { qid: string; label: string }[]; claims: string[];
  }[];
  bridges: { hub: string; hub_label: string; here: string[]; claims: string[]; examples: string[]; n: number }[];
  checks: { claim: string; verdict: string; summary: string; sources: { url: string; title: string; used: boolean }[] }[];
  triples: Triple[];
};

type Props = { k: Knowledge; claimText: (id: string) => string; busy: boolean; onLink: () => void };

export default function KnowledgePanel({ k, claimText, busy, onLink }: Props) {
  const unlinked = k.concepts.filter((c) => !c.qid).length;
  return (
    <div className="knowledge">
      <p className="muted small">
        Concepts are entity-linked to <b>Wikidata</b> (candidate search + in-context disambiguation) with their parent classes and a
        Wikipedia summary, so this idea connects to world knowledge and to other ideas in the graph.
      </p>
      <table className="metrics kt">
        <thead><tr><th>concept</th><th>Wikidata</th><th>is a / subclass of</th></tr></thead>
        <tbody>
          {k.concepts.map((c) => (
            <tr key={c.concept}>
              <td>{c.name}</td>
              <td>
                {c.qid ? (
                  <>
                    <a href={c.url ?? "#"} target="_blank" rel="noreferrer">{c.label}</a> <code className="muted">{c.qid}</code>
                    <div className="muted small">{c.description}</div>
                    {c.summary && (
                      <details className="small"><summary>Wikipedia</summary>{c.summary}{" "}
                        {c.wikipedia && <a href={c.wikipedia} target="_blank" rel="noreferrer">source</a>}</details>
                    )}
                  </>
                ) : <span className="muted small">not linked</span>}
              </td>
              <td><div className="chips">{c.parents.map((p) => <span key={p.qid} className="chip">{p.label}</span>)}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
      {unlinked > 0 && (
        <button className="chip-btn" disabled={busy} onClick={onLink}>Link {unlinked} concept{unlinked > 1 ? "s" : ""} to Wikidata</button>
      )}

      {k.bridges.length > 0 && (
        <>
          <h4>Bridges to other statements in the graph</h4>
          <ul className="small">
            {k.bridges.map((b) => (
              <li key={b.hub}>
                via <b>{b.hub_label}</b> ({b.here.join(", ")}): {b.n} other statement{b.n > 1 ? "s" : ""}, e.g. “{b.examples[0]}”
              </li>
            ))}
          </ul>
        </>
      )}

      {k.checks.length > 0 && (
        <>
          <h4>Web checks</h4>
          {k.checks.map((c) => (
            <div key={c.claim} className={`webcheck v-${c.verdict}`}>
              <div><span className="verdict">{c.verdict}</span> “{claimText(c.claim)}”</div>
              <div className="small">{c.summary}</div>
              <ul className="small">
                {c.sources.filter((s) => s.url).map((s) => (
                  <li key={s.url} className={s.used ? "" : "muted"}>
                    {s.used ? "★ " : ""}<a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="muted small">★ = sources the judging model relied on. Search results come from Groq&apos;s browser_search (Exa); vendor pages are weak evidence.</p>
        </>
      )}

      {k.triples.length > 0 && (
        <>
          <h4>Idea knowledge graph</h4>
          <GraphView triples={k.triples} onSegment={() => null} onInsight={() => null} />
        </>
      )}
    </div>
  );
}
