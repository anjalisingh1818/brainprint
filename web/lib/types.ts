export const NETWORKS = ["visual", "auditory", "language", "attention", "default_mode", "motor", "other"] as const;
export type NetworkName = (typeof NETWORKS)[number];

export const NETWORK_LABEL: Record<NetworkName, string> = {
  visual: "Visual",
  auditory: "Auditory",
  language: "Language",
  attention: "Attention",
  default_mode: "Default mode",
  motor: "Motor",
  other: "Other",
};

export type OverviewRow = {
  project: string; stimulus: string; source: string; seconds: number; mean_engagement: number; insights: number;
};
export type LensRow = {
  lens: string; name: string; description: string; weights: { network: NetworkName; w: number; base_w: number }[];
};
export type StimulusMeta = {
  stimulus: string; title: string; source: string; warning: string | null; modality: string; seconds: number;
  script: string | null; project: string | null; region_names: string[];
  revisions: { revision: string | null; role: string | null }[];
};
export type SecondRow = {
  segment: string; t: number; text: string; score: number; base_score: number;
  acts: { network: NetworkName; strength: number; local_z: number }[]; regions_z: number[];
};
export type InsightRow = {
  insight: string; kind: string; t_start: number; t_end: number; severity: number;
  drivers: { network: NetworkName; z: number }[]; summary: string;
  feedback: { id: string; verdict: "CONFIRMS" | "CONTRADICTS"; comment: string | null; lens: string }[];
};
export type Triple = {
  a: string; a_label: string; a_name: string; rel: string; b: string; b_label: string; b_name: string; w: number | null;
};

export const INSIGHT_LABEL: Record<string, string> = {
  attention_dip: "Attention dip",
  drift: "Possible drift",
  overload: "Possible overload",
};

export async function q<T>(name: string, params: Record<string, string> = {}): Promise<T[]> {
  const sp = new URLSearchParams({ name, ...params });
  const res = await fetch(`/api/query?${sp}`, { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body.rows as T[];
}

export type FeedbackLogRow = {
  feedback: string; verdict: "CONFIRMS" | "CONTRADICTS"; comment: string | null; created_at: string; insight: string;
  stimulus: string; lens: string; networks: NetworkName[]; w_before: number[]; w_after: number[];
};
export type RevisionImpact = {
  revision: string; before: string; after: string; before_mean: number; after_mean: number; before_min: number; after_min: number;
  insights_before: number; insights_after: number; claimed_fixes: number; confirmed_fixes: number;
};
export type RevisionFix = { insight: string; kind: string; t_start: number; t_end: number; severity: number; feedback: string[] };
export type FeedbackResult = {
  feedback: string; verdict: "CONFIRMS" | "CONTRADICTS"; insight: string; lens: string;
  changes: { network: NetworkName; before: number; after: number; base: number }[];
  insight_score: { before: number; after: number }; pitch_mean: { before: number; after: number };
};

export async function send<T>(method: "POST" | "DELETE", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}
