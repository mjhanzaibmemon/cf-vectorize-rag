/**
 * End to end through the real worker handler, with in-memory stand-ins for
 * Workers AI and Vectorize. No account, no network, no paid plan: clone the
 * repo, run the tests, and watch the behaviour the README claims.
 */
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { fakeEnv, request } from "./fakes";
import type { Env } from "../src/types";

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

async function call(path: string, token: string | null, body?: unknown) {
  const response = await worker.fetch(request(path, token, body), env);
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

  it("answers from the tenant's own document and cites it", async () => {
    const res = await call("/query", "tok_acme", {
      question: "How many days of paid holiday do staff receive each year?",
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
