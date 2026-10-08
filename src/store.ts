import { EMBEDDING_MODEL, TOP_K } from "./config";
import { getIndex } from "./d1-index";
import type { Chunk, Env, Match } from "./types";

/**
 * Embed text with Workers AI.
 *
 * Queries and documents go through the same model, which sounds obvious and is
 * the single easiest way to break a RAG system: embed documents with one model,
 * queries with another, and retrieval quietly returns noise while every service
 * reports healthy.
 */
export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const result = (await env.AI.run(EMBEDDING_MODEL, { text: texts })) as { data: number[][] };

  if (!result?.data || result.data.length !== texts.length) {
    throw new Error(
      `embedding returned ${result?.data?.length ?? 0} vectors for ${texts.length} inputs`,
    );
  }
  return result.data;
}

export async function upsertChunks(env: Env, tenant: string, chunks: Chunk[]): Promise<number> {
  if (chunks.length === 0) return 0;

  const vectors = await embed(
    env,
    chunks.map((c) => c.text),
  );

  await getIndex(env).upsert(
    chunks.map((chunk, i) => {
      const values = vectors[i];
      if (!values) {
        // embed() already checks the count, so this is unreachable. It stays
        // because the alternative is silently upserting an undefined vector.
        throw new Error(`no embedding returned for chunk ${chunk.id}`);
      }

      return {
        id: chunk.id,
        values,
        metadata: {
          tenant,
          docId: chunk.docId,
          index: chunk.index,
          text: chunk.text,
        },
      };
    }),
  );

  return chunks.length;
}

/**
 * Retrieve for one tenant.
 *
 * The tenant filter is applied inside this function from a value the caller
 * never supplied, so there is no request shape that reaches another tenant's
 * vectors. Filtering after retrieval would be worse than useless here: the
 * scores would already have been computed against someone else's data.
 */
export async function retrieve(env: Env, tenant: string, question: string): Promise<Match[]> {
  const [vector] = await embed(env, [question]);
  if (!vector) throw new Error("the question produced no embedding");

  const result = await getIndex(env).query(vector, {
    topK: TOP_K,
    filter: { tenant },
    returnMetadata: "all",
  });

  return (result.matches ?? []).map((m) => ({
    id: m.id,
    score: m.score,
    docId: String(m.metadata?.docId ?? "unknown"),
    text: String(m.metadata?.text ?? ""),
  }));
}

/**
 * Deletion is deliberately not implemented here, and the README says so rather
 * than the code pretending.
 *
 * Vectorize deletes by vector id. It is a vector index, not a database you can
 * scan by metadata, so "delete document X" needs a docId to chunk-ids map kept
 * somewhere else, usually KV or D1. That is a real design decision an app has
 * to make up front, and faking it with a zero-vector probe would look like a
 * feature while quietly missing chunks.
 */
