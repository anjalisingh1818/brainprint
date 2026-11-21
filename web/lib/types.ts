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
  segment: string; t: number; text: string; score: number;
  acts: { network: NetworkName; strength: number; local_z: number }[]; regions_z: number[];
};
export type InsightRow = {
  insight: string; kind: string; t_start: number; t_end: number; severity: number;
  drivers: { network: NetworkName; z: number }[]; feedback: string[]; summary: string;
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
