// Exports every panel question / pitch from the running app (web/, port 3000) as a text file for TRIBE v2.
//
//   node brainwave/export.mjs                 -> brainwave/inputs/<idea_id>.txt + brainwave/inputs/manifest.json
//
// Then commit + push brainwave/inputs/ so the Colab notebook (brainwave/colab_brainwave.ipynb) can read them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "inputs");
fs.mkdirSync(DIR, { recursive: true });

const get = async (url) => { const r = await fetch(BASE + url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); };
const { ideas } = await get("/api/ideas");
const manifest = [];
for (const i of ideas) {
  const s = await get(`/api/panel?idea=${encodeURIComponent(i.id)}`);
  const text = (s.idea?.text ?? "").trim();
  if (text.length < 20) continue;
  fs.writeFileSync(path.join(DIR, `${i.id}.txt`), text + "\n");
  manifest.push({ id: i.id, title: i.title, kind: i.kind, words: text.split(/\s+/).length });
  console.log(`${i.id}  (${text.split(/\s+/).length} words)  ${i.title}`);
}
fs.writeFileSync(path.join(DIR, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(`wrote ${manifest.length} inputs to brainwave/inputs/`);
