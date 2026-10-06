import { describe, expect, it } from "vitest";
import { buildChunks, chunkId, splitText } from "../src/chunk";

describe("splitText", () => {
  it("returns nothing for empty input", () => {
    expect(splitText("")).toEqual([]);
    expect(splitText("   \n  ")).toEqual([]);
  });

  it("leaves short text as one chunk", () => {
    expect(splitText("one short paragraph", 900, 150)).toEqual(["one short paragraph"]);
  });

  it("overlaps consecutive chunks so a sentence on a boundary is not lost", () => {
    const text = "word ".repeat(600).trim();
    const chunks = splitText(text, 200, 50);

    expect(chunks.length).toBeGreaterThan(1);

    // The tail of one chunk should reappear at the head of the next.
    const tail = chunks[0]!.slice(-20);
    expect(chunks[1]!.includes(tail.trim().split(" ")[0]!)).toBe(true);
  });

  it("prefers paragraph breaks over cutting mid-word", () => {
    const first = "a".repeat(120);
    const second = "b".repeat(120);
    const chunks = splitText(`${first}\n\n${second}`, 160, 20);

    expect(chunks[0]).toBe(first);
  });

  it("refuses an overlap that would stop it advancing", () => {
    expect(() => splitText("x".repeat(500), 100, 100)).toThrow(/overlap/);
  });

  it("always terminates, even on text with no break characters", () => {
    const chunks = splitText("x".repeat(5000), 300, 60);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("").length).toBeGreaterThanOrEqual(5000 - 300);
  });
});

describe("chunk ids", () => {
  it("is stable for identical input, which is what makes re-ingest idempotent", async () => {
    const a = await chunkId("acme", "handbook", 3, "same text");
    const b = await chunkId("acme", "handbook", 3, "same text");

    expect(a).toBe(b);
  });

  it("changes when the text changes", async () => {
    const a = await chunkId("acme", "handbook", 3, "original");
    const b = await chunkId("acme", "handbook", 3, "edited");

    expect(a).not.toBe(b);
  });

  it("differs between tenants, so two tenants with identical files never collide", async () => {
    const a = await chunkId("acme", "handbook", 0, "shared boilerplate");
    const b = await chunkId("globex", "handbook", 0, "shared boilerplate");

    expect(a).not.toBe(b);
  });

  it("numbers chunks in order and carries the document id", async () => {
    const chunks = await buildChunks("acme", "handbook", "para one.\n\n" + "y".repeat(2000));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    expect(new Set(chunks.map((c) => c.docId))).toEqual(new Set(["handbook"]));
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });
});
