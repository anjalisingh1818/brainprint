// Server-only access to the BrainPrint Relate store (graph/brainprint.rl): one embedded, single-file graph.
//
// Why a singleton: @relate/relate 1.2.0 has no close() for a Database handle, so a Node process keeps the store's
// lock until it exits (verified, see docs/RELATE_NOTES.md §12). We therefore open ONE writable handle per server
// process and reuse it for every read and write. Stop the web server before opening the file with another tool.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Database, type Connection } from "@relate/relate";

const ROOT = path.resolve(process.cwd(), "..");
export const DB_PATH = process.env.BRAINPRINT_DB ?? path.join(ROOT, "graph", "brainprint.rl");

export type Row = Record<string, unknown>;

type State = { db?: Database; conn?: Connection };
// globalThis survives Next.js dev hot-reloads, so we never try to open a second writer.
const g = globalThis as unknown as { __brainprint?: State };
const state: State = (g.__brainprint ??= {});

export class StoreLockedError extends Error {}

export function connection(): Connection {
  if (state.conn) return state.conn;
  // A missing file is fine: Relate creates the store, and the app seeds it on first use.
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  try {
    state.db = Database.open(DB_PATH);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    // The Node client reports a lock held by another process as a generic "internal error".
    if (msg.includes("locked") || msg.includes("internal error")) {
      throw new StoreLockedError(
        "Cannot open graph/brainprint.rl for writing: another process probably has it open " +
          "(a Python script, or a `relate serve --mcp` server started by an MCP host). Stop it and reload."
      );
    }
    throw e;
  }
  state.conn = state.db.connect();
  return state.conn;
}

/** Flush the WAL into the .rl snapshot so the committed file reflects the latest writes. */
export function checkpoint() {
  connection();
  state.db?.checkpoint();
}
