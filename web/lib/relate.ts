// Server-only access to the BrainPrint Relate store (graph/brainprint.rl).
//
// Why a singleton: @relate/relate 1.2.0 has no close() for a Database handle, so a Node
// process keeps the store's lock until it exits (verified, see docs/RELATE_NOTES.md §12).
// We therefore open ONE writable handle per server process and reuse it for every read and
// write. Consequence: stop the web server before running graph/ingest.py or graph/queries.py.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Database, type Connection } from "@relate/relate";

const ROOT = path.resolve(process.cwd(), "..");
export const DB_PATH = process.env.BRAINPRINT_DB ?? path.join(ROOT, "graph", "brainprint.rl");
const QUERIES_PATH = path.join(ROOT, "graph", "queries.cypher");

export type NamedQuery = { name: string; description: string; params: Record<string, string>; cypher: string };
export type Row = Record<string, unknown>;

type State = { db?: Database; conn?: Connection; queries?: Record<string, NamedQuery>; queriesMtime?: number };
// globalThis survives Next.js dev hot-reloads, so we never try to open a second writer.
const g = globalThis as unknown as { __brainprint?: State };
const state: State = (g.__brainprint ??= {});

export class StoreLockedError extends Error {}

export function connection(): Connection {
  if (state.conn) return state.conn;
  if (!fs.existsSync(DB_PATH)) throw new Error(`Relate store not found at ${DB_PATH}. Run: python graph/ingest.py`);
  try {
    state.db = Database.open(DB_PATH);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (msg.includes("locked")) {
      throw new StoreLockedError(
        "graph/brainprint.rl is locked by another process (ingest.py, queries.py or relate serve). Stop it and reload."
      );
    }
    throw e;
  }
  state.conn = state.db.connect();
  return state.conn;
}

/** Parse graph/queries.cypher, the same file Python's graph/queries.py reads. Reloaded on change. */
export function namedQueries(): Record<string, NamedQuery> {
  const mtime = fs.statSync(QUERIES_PATH).mtimeMs;
  if (state.queries && state.queriesMtime === mtime) return state.queries;
  const text = fs.readFileSync(QUERIES_PATH, "utf8").replace(/\r\n/g, "\n");
  const out: Record<string, NamedQuery> = {};
  for (const block of text.split(/^\/\/ name:/m).slice(1)) {
    const lines = block.split("\n");
    const name = lines[0].trim();
    let description = "";
    let params: Record<string, string> = {};
    const body: string[] = [];
    for (const line of lines.slice(1)) {
      const m = /^\/\/ (description|params):\s*(.*)$/.exec(line);
      if (m && body.length === 0) {
        if (m[1] === "description") description = m[2].trim();
        else
          params = Object.fromEntries(
            m[2].split(",").map((s) => s.trim()).filter(Boolean).map((kv) => {
              const i = kv.indexOf("=");
              return [kv.slice(0, i), kv.slice(i + 1)];
            })
          );
      } else if (!line.startsWith("//")) body.push(line);
    }
    out[name] = { name, description, params, cypher: body.join("\n").trim().replace(/;\s*$/, "").trim() };
  }
  state.queries = out;
  state.queriesMtime = mtime;
  return out;
}

export function runNamed(name: string, params: Record<string, string> = {}): Row[] {
  const q = namedQueries()[name];
  if (!q) throw new Error(`unknown query ${name}`);
  return connection().query(q.cypher, { ...q.params, ...params }).rows as Row[];
}

export function runCypher(cypher: string, params: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return connection().query(cypher, params as any);
}
