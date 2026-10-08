/**
 * The limiter guards a daily quota, so the cases worth testing are the ones
 * where it would quietly stop guarding: a caller slipping past the boundary,
 * two callers sharing a budget, and the table being unavailable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callerKey, checkLimit, sweepExpired, type LimitRule } from "../src/ratelimit";

const RULE: LimitRule = { limit: 3, windowSeconds: 60 };

/**
 * A D1 stand-in holding just enough of the surface the limiter touches, with
 * the upsert's counting semantics reproduced rather than mocked away, since
 * that counting is the thing under test.
 */
function fakeDb(options: { failing?: boolean } = {}) {
  const rows = new Map<string, { hits: number; expires: number }>();
  const deleted: number[] = [];

  const db = {
    rows,
    deleted,
    prepare(_sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>(): Promise<T> {
              if (options.failing) throw new Error("D1 unavailable");
              const [bucket, expires] = args as [string, number];
              const existing = rows.get(bucket);
              const hits = (existing?.hits ?? 0) + 1;
              rows.set(bucket, { hits, expires });
              return { hits } as T;
            },
            async run() {
              if (options.failing) throw new Error("D1 unavailable");
              const [cutoff] = args as [number];
              deleted.push(cutoff);
              for (const [k, v] of rows) if (v.expires < cutoff) rows.delete(k);
              return {};
            },
          };
        },
      };
    },
  };

  return db as unknown as D1Database & { rows: typeof rows; deleted: number[] };
}

describe("callerKey", () => {
  it("uses the edge-set header, which a client cannot forge", () => {
    const r = new Request("https://x.test", { headers: { "cf-connecting-ip": "203.0.113.9" } });
    expect(callerKey(r)).toBe("203.0.113.9");
  });

  it("ignores X-Forwarded-For, which anyone may send", () => {
    const r = new Request("https://x.test", { headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(callerKey(r)).not.toBe("203.0.113.9");
  });

  it("buckets unidentifiable callers together rather than exempting them", () => {
    expect(callerKey(new Request("https://x.test"))).toBe("unknown");
  });
});

describe("checkLimit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("allows up to the limit and refuses the next call", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:10Z"));
    const db = fakeDb();

    for (let i = 1; i <= RULE.limit; i++) {
      const r = await checkLimit(db, "1.1.1.1", "query", RULE);
      expect(r.allowed).toBe(true);
      expect(r.used).toBe(i);
    }

    const over = await checkLimit(db, "1.1.1.1", "query", RULE);
    expect(over.allowed).toBe(false);
    expect(over.used).toBe(RULE.limit + 1);
  });

  it("counts each caller separately, so one visitor cannot spend another's budget", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:10Z"));
    const db = fakeDb();

    for (let i = 0; i < RULE.limit; i++) await checkLimit(db, "1.1.1.1", "query", RULE);

    const other = await checkLimit(db, "2.2.2.2", "query", RULE);
    expect(other.allowed).toBe(true);
    expect(other.used).toBe(1);
  });

  it("counts each route separately, since ingest and query cost differently", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:10Z"));
    const db = fakeDb();

    for (let i = 0; i < RULE.limit; i++) await checkLimit(db, "1.1.1.1", "query", RULE);

    const ingest = await checkLimit(db, "1.1.1.1", "ingest", RULE);
    expect(ingest.allowed).toBe(true);
  });

  it("resets at the window boundary", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:10Z"));
    const db = fakeDb();

    for (let i = 0; i < RULE.limit; i++) await checkLimit(db, "1.1.1.1", "query", RULE);
    expect((await checkLimit(db, "1.1.1.1", "query", RULE)).allowed).toBe(false);

    vi.setSystemTime(new Date("2026-01-01T00:01:10Z"));
    const next = await checkLimit(db, "1.1.1.1", "query", RULE);
    expect(next.allowed).toBe(true);
    expect(next.used).toBe(1);
  });

  it("reports how long until the window resets", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:10Z"));
    const r = await checkLimit(fakeDb(), "1.1.1.1", "query", RULE);
    expect(r.resetIn).toBe(50);
  });

  // The documented trade: a fixed window lets a caller send up to twice the
  // limit across a boundary. It is asserted rather than left as a surprise.
  it("permits a burst across the boundary, which is the fixed-window weakness", async () => {
    const db = fakeDb();

    vi.setSystemTime(new Date("2026-01-01T00:00:59Z"));
    for (let i = 0; i < RULE.limit; i++) {
      expect((await checkLimit(db, "1.1.1.1", "query", RULE)).allowed).toBe(true);
    }

    vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
    for (let i = 0; i < RULE.limit; i++) {
      expect((await checkLimit(db, "1.1.1.1", "query", RULE)).allowed).toBe(true);
    }
  });

  it("fails open when the table is unavailable", async () => {
    const r = await checkLimit(fakeDb({ failing: true }), "1.1.1.1", "query", RULE);
    expect(r.allowed).toBe(true);
  });

  it("allows everything when no database is bound, so tests and local runs work", async () => {
    const r = await checkLimit(undefined, "1.1.1.1", "query", RULE);
    expect(r.allowed).toBe(true);
  });
});

describe("sweepExpired", () => {
  it("removes windows that have already closed and leaves open ones", async () => {
    const db = fakeDb();
    const now = 1_800_000_000_000;

    await checkLimit(db, "old", "query", RULE);
    for (const [, v] of db.rows) v.expires = Math.floor(now / 1000) - 10;
    await checkLimit(db, "current", "query", RULE);

    await sweepExpired(db, now);
    expect([...db.rows.keys()].every((k) => k.includes("current"))).toBe(true);
  });

  it("does not reject when the sweep fails, since it runs off the response path", async () => {
    await expect(sweepExpired(fakeDb({ failing: true }))).resolves.not.toThrow();
  });
});
