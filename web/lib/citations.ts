// [[Label:id]] citations in model output, verified against the ids the graph queries actually returned.
export type Citation = { label: string; id: string; verified: boolean };

export function extractCitations(text: string, seen: Set<string>): Citation[] {
  const out = new Map<string, Citation>();
  for (const m of text.matchAll(/\[\[([A-Za-z]+):([^\]\s]+)\]\]/g)) {
    const key = `${m[1]}:${m[2]}`;
    if (!out.has(key)) out.set(key, { label: m[1], id: m[2], verified: seen.has(m[2]) });
  }
  return [...out.values()];
}
