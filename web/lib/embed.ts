// Free, local sentence embeddings (all-MiniLM-L6-v2, 384 dims, quantized, CPU).
// The model (~23 MB) is downloaded from Hugging Face on first use and cached under node_modules.
import "server-only";

type Extractor = (texts: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
const g = globalThis as unknown as { __bpEmbed?: Promise<Extractor> };

export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBED_DIMS = 384;

function extractor(): Promise<Extractor> {
  g.__bpEmbed ??= import("@huggingface/transformers").then(
    ({ pipeline }) => pipeline("feature-extraction", EMBED_MODEL, { dtype: "q8" }) as unknown as Promise<Extractor>
  );
  return g.__bpEmbed;
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const fe = await extractor();
  const out = (await fe(texts, { pooling: "mean", normalize: true })).tolist();
  return out.map((v) => v.map((x) => Math.round(x * 1e6) / 1e6));
}
