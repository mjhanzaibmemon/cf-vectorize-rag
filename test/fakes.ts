/**
 * In-memory stand-ins for Workers AI and Vectorize.
 *
 * These exist so the whole pipeline can be exercised end to end without a
 * Cloudflare account, a paid plan or a network: ingest, embed, store, filter,
 * retrieve, refuse, answer. A reviewer can clone the repo and watch tenant
 * isolation hold rather than take a screenshot's word for it.
 *
 * The fake embedding is a hashed bag of words, normalised. That is not a real
 * language model, and it is not pretending to be: what it reproduces faithfully
 * is the property the application logic depends on, which is that text sharing
 * vocabulary scores higher than text that does not.
 */
import type { Env } from "../src/types";

const DIMENSIONS = 64;

export function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);

  for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash * 31 + token.charCodeAt(i)) | 0;
    }
    const slot = Math.abs(hash) % DIMENSIONS;
    vector[slot] = (vector[slot] ?? 0) + 1;
  }

  const length = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return length === 0 ? vector : vector.map((v) => v / length);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

interface Stored {
  id: string;
  values: number[];
  metadata: Record<string, unknown>;
}

export class FakeIndex {
  readonly vectors = new Map<string, Stored>();

  async upsert(vectors: Stored[]): Promise<{ count: number }> {
    for (const v of vectors) this.vectors.set(v.id, v);
    return { count: vectors.length };
  }

  async query(
    vector: number[],
    options: { topK: number; filter?: Record<string, unknown> },
  ): Promise<{ matches: { id: string; score: number; metadata: Record<string, unknown> }[] }> {
    const filter = options.filter ?? {};

    const matches = [...this.vectors.values()]
      .filter((stored) =>
        Object.entries(filter).every(([key, value]) => stored.metadata[key] === value),
      )
      .map((stored) => ({
        id: stored.id,
        score: cosine(vector, stored.values),
        metadata: stored.metadata,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK);

    return { matches };
  }
}

export class FakeAI {
  readonly calls: { model: string; input: unknown }[] = [];

  async run(model: string, input: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ model, input });

    if (Array.isArray(input.text) || typeof input.text === "string") {
      const texts = Array.isArray(input.text) ? (input.text as string[]) : [input.text as string];
      return { data: texts.map(fakeEmbedding) };
    }

    // Generation. The answer echoes the context it was given, which lets a test
    // assert that the right chunks reached the model and no others.
    const messages = (input.messages ?? []) as { role: string; content: string }[];
    const prompt = messages.map((m) => m.content).join("\n");
    const cited = [...prompt.matchAll(/\[(\d+)\]/g)].map((m) => m[1]);

    return { response: `answered from ${cited.length} source(s) ${cited.map((c) => `[${c}]`).join("")}`.trim() };
  }
}

export function fakeEnv(tokens: Record<string, string> = { tok_acme: "acme", tok_globex: "globex" }) {
  const index = new FakeIndex();
  const ai = new FakeAI();

  const env = {
    AI: ai,
    INDEX: index,
    TENANT_TOKENS: JSON.stringify(tokens),
  } as unknown as Env;

  return { env, index, ai };
}

export function request(path: string, token: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;

  return new Request(`https://worker.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
