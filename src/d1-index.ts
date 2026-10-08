/**
 * A brute-force vector index backed by D1, so the demo runs on Cloudflare's
 * free plan.
 *
 * Vectorize is the production path and `getIndex` below still prefers it
 * whenever the binding is present. This exists because Vectorize needs a paid
 * plan, and a demo nobody can run is worth less than a demo with an honest
 * index behind it.
 *
 * What it does: pulls one tenant's vectors out of D1 and computes cosine
 * similarity in the Worker. That is the right trade at demo scale, where a few
 * hundred chunks cost about a millisecond, and the wrong one somewhere past ten
 * thousand, which is where an approximate index starts earning its keep. The
 * switch between the two is a binding, not a rewrite.
 *
 * What it does NOT do: filter after scoring. The tenant predicate runs in SQL,
 * so another tenant's vectors are never loaded and never scored. That is the
 * same property the Vectorize path has, and it is the one worth preserving,
 * because an isolation bug that only shows up in the demo is still an isolation
 * bug somebody will copy.
 */

export interface StoredVector {
  id: string;
  values: number[];
  metadata: Record<string, unknown>;
}

export interface IndexMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/** The slice of the Vectorize surface this application actually uses. */
export interface VectorIndex {
  upsert(vectors: StoredVector[]): Promise<unknown>;
  query(
    vector: number[],
    options: { topK: number; filter?: Record<string, unknown>; returnMetadata?: string },
  ): Promise<{ matches: IndexMatch[] }>;
}

/** Columns the SQL filter understands. Anything else fails loudly. */
const FILTERABLE: Record<string, string> = { tenant: "tenant", docId: "doc_id" };

/** D1 caps how much one batch may carry, so large ingests go up in pieces. */
const BATCH_SIZE = 50;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  // A zero vector has no direction, so it has no similarity to anything. The
  // alternative is dividing by zero and returning NaN, which sorts unpredictably
  // and would quietly corrupt the ranking.
  return magnitude === 0 ? 0 : dot / magnitude;
}

export class D1VectorIndex implements VectorIndex {
  constructor(private readonly db: D1Database) {}

  async upsert(vectors: StoredVector[]): Promise<{ count: number }> {
    if (vectors.length === 0) return { count: 0 };

    const sql = `INSERT OR REPLACE INTO vectors (id, tenant, doc_id, idx, text, vector)
                 VALUES (?, ?, ?, ?, ?, ?)`;

    for (let start = 0; start < vectors.length; start += BATCH_SIZE) {
      const slice = vectors.slice(start, start + BATCH_SIZE);

      await this.db.batch(
        slice.map((v) =>
          this.db
            .prepare(sql)
            .bind(
              v.id,
              String(v.metadata.tenant ?? ""),
              String(v.metadata.docId ?? ""),
              Number(v.metadata.index ?? 0),
              String(v.metadata.text ?? ""),
              JSON.stringify(v.values),
            ),
        ),
      );
    }

    // INSERT OR REPLACE on a deterministic id is what makes re-ingesting an
    // unchanged document a no-op rather than a second copy competing at query
    // time. The ids come from a content hash, so this is the same idempotency
    // the Vectorize path relies on.
    return { count: vectors.length };
  }

  async query(
    vector: number[],
    options: { topK: number; filter?: Record<string, unknown>; returnMetadata?: string },
  ): Promise<{ matches: IndexMatch[] }> {
    const clauses: string[] = [];
    const bindings: unknown[] = [];

    for (const [key, value] of Object.entries(options.filter ?? {})) {
      const column = FILTERABLE[key];
      if (!column) {
        throw new Error(
          `cannot filter on "${key}": the demo index understands ${Object.keys(FILTERABLE).join(", ")}`,
        );
      }
      clauses.push(`${column} = ?`);
      bindings.push(value);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db
      .prepare(`SELECT id, tenant, doc_id, idx, text, vector FROM vectors ${where}`)
      .bind(...bindings)
      .all<{
        id: string;
        tenant: string;
        doc_id: string;
        idx: number;
        text: string;
        vector: string;
      }>();

    const matches = (rows.results ?? [])
      .map((row) => ({
        id: row.id,
        score: cosine(vector, JSON.parse(row.vector) as number[]),
        metadata: {
          tenant: row.tenant,
          docId: row.doc_id,
          index: row.idx,
          text: row.text,
        },
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK);

    return { matches };
  }
}

/**
 * Prefer Vectorize when it is configured, fall back to D1 otherwise.
 *
 * Moving this deployment onto Vectorize means adding the binding and creating
 * the index. No application code changes, which is the point of keeping the
 * two behind one interface.
 */
export function getIndex(env: { INDEX?: VectorizeIndex; DB?: D1Database }): VectorIndex {
  if (env.INDEX) return env.INDEX as unknown as VectorIndex;
  if (env.DB) return new D1VectorIndex(env.DB);

  throw new Error("no vector index is configured: bind either INDEX (Vectorize) or DB (D1)");
}
