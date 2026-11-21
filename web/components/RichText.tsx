"use client";
// Tiny renderer shared by the agent chat and the Idea Lab: paragraphs, "- " bullets, **bold**, `code`, ### headings,
// _italic notes_, and [[Label:id]] citation chips (solid = verified against graph query results, dashed red = not).
import { Fragment, type ReactNode } from "react";

export type Citation = { label: string; id: string; verified: boolean };
type OnCite = (label: string, id: string) => void;

function inline(text: string, cites: Map<string, Citation>, onCite: OnCite): ReactNode[] {
  return text.split(/(\[\[[A-Za-z]+:[^\]\s]+\]\]|\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
    const c = /^\[\[([A-Za-z]+):([^\]\s]+)\]\]$/.exec(p);
    if (c) {
      const ok = cites.get(`${c[1]}:${c[2]}`)?.verified ?? false;
      return (
        <button key={i} className={`cite${ok ? "" : " unverified"}`} onClick={() => onCite(c[1], c[2])}
          title={ok ? `(:${c[1]} {id: "${c[2]}"}) was returned by a graph query` : "Not found in this turn's graph results"}>
          {c[1]}:{c[2]}{ok ? "" : " ?"}
        </button>
      );
    }
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

export default function RichText({ text, citations = [], onCite }: { text: string; citations?: Citation[]; onCite: OnCite }) {
  const cites = new Map(citations.map((c) => [`${c.label}:${c.id}`, c]));
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`u${blocks.length}`}>{list}</ul>);
    list = [];
  };
  text.split("\n").forEach((line, i) => {
    const l = line.trim();
    if (/^[-*] /.test(l)) list.push(<li key={i}>{inline(l.slice(2), cites, onCite)}</li>);
    else {
      flush();
      if (/^#{1,4} /.test(l)) blocks.push(<h4 key={i}>{inline(l.replace(/^#+ /, ""), cites, onCite)}</h4>);
      else if (/^_.+_$/.test(l)) blocks.push(<p key={i} className="muted"><em>{inline(l.slice(1, -1), cites, onCite)}</em></p>);
      else if (l) blocks.push(<p key={i}>{inline(l, cites, onCite)}</p>);
    }
  });
  flush();
  return <>{blocks}</>;
}
