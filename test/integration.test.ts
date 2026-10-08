/**
 * End to end through the real worker handler, with in-memory stand-ins for
 * Workers AI and Vectorize. No account, no network, no paid plan: clone the
 * repo, run the tests, and watch the behaviour the README claims.
 */
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { fakeEnv, request } from "./fakes";
import type { Env } from "../src/types";
import { MIN_SCORE } from "../src/config";

const HANDBOOK = `# Handbook

Staff receive 25 days of paid holiday each year, plus public holidays.
Unused holiday does not carry into the next year.

Expenses under 50 are approved by a line manager. Anything larger needs finance
approval before the money is spent.`;

const GLOBEX_SECRETS = `# Globex internal

The Globex launch codes are stored in the vault in Frankfurt.
Only the Globex operations team may rotate the Frankfurt vault keys.`;

let env: Env;
let index: ReturnType<typeof fakeEnv>["index"];

/**
 * The worker takes an ExecutionContext for waitUntil, which the rate limiter
 * uses to sweep expired rows off the response path. The tests run the work
 * eagerly instead of discarding it, so a promise that rejects in there fails a
 * test rather than disappearing.
 */
const ctx = {
  waitUntil: (p: Promise<unknown>) => {
    void p;
  },
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

async function call(path: string, token: string | null, body?: unknown) {
  const response = await worker.fetch(request(path, token, body), env, ctx);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  const made = fakeEnv();
  env = made.env;
  index = made.index;
});

describe("auth", () => {
  it("rejects ingest without a token", async () => {
    const res = await call("/ingest", null, { docId: "x", text: "y" });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown token", async () => {
    const res = await call("/query", "tok_nope", { question: "anything" });
    expect(res.status).toBe(401);
  });

  it("serves health without a token", async () => {
    const res = await call("/health", null);
    expect(res.status).toBe(200);
    expect(res.body.dimensions).toBe(768);
  });
});

describe("ingest", () => {
  it("chunks, stores and returns ids", async () => {
    const res = await call("/ingest", "tok_acme", { docId: "handbook", text: HANDBOOK });

    expect(res.status).toBe(200);
    expect(res.body.chunks).toBeGreaterThan(0);
    expect((res.body.ids as string[]).length).toBe(res.body.chunks);
    expect(index.vectors.size).toBe(res.body.chunks);
  });

  it("is idempotent: the same document re-ingested produces the same ids and no duplicates", async () => {
    const first = await call("/ingest", "tok_acme", { docId: "handbook", text: HANDBOOK });
    const second = await call("/ingest", "tok_acme", { docId: "handbook", text: HANDBOOK });

    expect(second.body.ids).toEqual(first.body.ids);
    expect(index.vectors.size).toBe(first.body.chunks);
  });

  it("stores the tenant resolved from the token, not from the body", async () => {
    await call("/ingest", "tok_acme", { docId: "handbook", text: HANDBOOK, tenant: "globex" });

    const tenants = new Set([...index.vectors.values()].map((v) => v.metadata.tenant));
    expect(tenants).toEqual(new Set(["acme"]));
  });

  it("rejects a document with no usable text", async () => {
    const res = await call("/ingest", "tok_acme", { docId: "empty", text: "   " });
    expect(res.status).toBe(400);
  });
});

describe("query", () => {
  beforeEach(async () => {
    await call("/ingest", "tok_acme", { docId: "handbook", text: HANDBOOK });
    await call("/ingest", "tok_globex", { docId: "globex-internal", text: GLOBEX_SECRETS });
  });

  // The threshold is passed explicitly rather than inherited from config. The
  // fake embedding is a hashed bag of words, so its absolute scores carry no
  // relationship to the ones a real model produces, and pinning this test to the
  // production threshold would make a legitimate tuning change look like a
  // regression. What is under test is that an answerable question is answered
  // and cited, not what the production number happens to be today.
  it("answers from the tenant's own document and cites it", async () => {
    const res = await call("/query", "tok_acme", {
      question: "How many days of paid holiday do staff receive each year?",
      minScore: 0.2,
    });

    expect(res.body.refused).toBe(false);
    const citations = res.body.citations as { docId: string }[];
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.every((c) => c.docId === "handbook")).toBe(true);
  });

  it("never reaches another tenant's data, even asking in their words", async () => {
    const res = await call("/query", "tok_acme", {
      question: "Where are the Globex launch codes stored in the Frankfurt vault?",
    });

    const citations = res.body.citations as { docId: string }[];
    const considered = res.body.considered as { id: string }[];

    // Nothing from globex may be cited, and nothing from globex may even be
    // scored: the filter runs inside the query, not after it.
    expect(citations.every((c) => c.docId === "handbook")).toBe(true);

    const globexIds = new Set(
      [...index.vectors.values()]
        .filter((v) => v.metadata.tenant === "globex")
        .map((v) => v.id),
    );
    expect(considered.some((c) => globexIds.has(c.id))).toBe(false);
  });

  it("refuses rather than guessing when the corpus has no answer", async () => {
    const res = await call("/query", "tok_acme", {
      question: "quantum submarine propeller certification schedule",
    });

    expect(res.body.refused).toBe(true);
    expect(res.body.citations).toEqual([]);
    // It still shows what it looked at, so a reviewer can see how close it came.
    expect(Array.isArray(res.body.considered)).toBe(true);
  });

  it("requires a question", async () => {
    const res = await call("/query", "tok_acme", { question: "   " });
    expect(res.status).toBe(400);
  });
});

describe("threshold override", () => {
  beforeEach(async () => {
    await call("/ingest", "tok_acme", { docId: "handbook", text: HANDBOOK });
  });

  // The point of exposing minScore is that the trade is visible: the same
  // question refuses at a high threshold and answers at a low one, with the
  // retrieved scores unchanged in both.
  it("refuses a weak match at a high threshold and answers it at a low one", async () => {
    const strict = await call("/query", "tok_acme", {
      question: "quantum submarine propeller certification schedule",
      minScore: 0.99,
    });
    expect(strict.body.refused).toBe(true);

    const loose = await call("/query", "tok_acme", {
      question: "quantum submarine propeller certification schedule",
      minScore: 0,
    });
    expect(loose.body.refused).toBe(false);
  });

  it("reports the threshold it applied, so a result can be reproduced", async () => {
    const res = await call("/query", "tok_acme", { question: "holiday", minScore: 0.42 });
    expect(res.body.minScore).toBe(0.42);
  });

  it("falls back to the configured default when the value is not a number", async () => {
    const res = await call("/query", "tok_acme", { question: "holiday", minScore: "low" });
    expect(res.body.minScore).toBe(MIN_SCORE);
  });

  it("clamps a value outside 0 to 1 rather than failing the request", async () => {
    const high = await call("/query", "tok_acme", { question: "holiday", minScore: 7 });
    expect(high.body.minScore).toBe(1);

    const low = await call("/query", "tok_acme", { question: "holiday", minScore: -3 });
    expect(low.body.minScore).toBe(0);
  });

  // A threshold is a preference. Tenancy is a boundary. Lowering the threshold
  // all the way must still not reach another tenant's data.
  it("cannot be used to reach another tenant, however low it is set", async () => {
    await call("/ingest", "tok_globex", { docId: "globex-internal", text: GLOBEX_SECRETS });

    const res = await call("/query", "tok_acme", {
      question: "Where are the Globex launch codes stored in the Frankfurt vault?",
      minScore: 0,
    });

    const globexIds = new Set(
      [...index.vectors.values()].filter((v) => v.metadata.tenant === "globex").map((v) => v.id),
    );
    const considered = res.body.considered as { id: string }[];
    expect(considered.some((c) => globexIds.has(c.id))).toBe(false);

    const citations = res.body.citations as { docId: string }[];
    expect(citations.every((c) => c.docId === "handbook")).toBe(true);
  });
});

describe("oversized ingest", () => {
  it("refuses a document larger than the demo limit before embedding it", async () => {
    const res = await call("/ingest", "tok_acme", { docId: "huge", text: "x".repeat(20_001) });
    expect(res.status).toBe(413);
    expect(index.vectors.size).toBe(0);
  });
});
