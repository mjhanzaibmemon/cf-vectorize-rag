import { describe, expect, it, vi } from "vitest";
import { answerQuestion, buildPrompt, toCitations, usable } from "../src/answer";
import type { Env, Match } from "../src/types";

const match = (id: string, score: number, text = "some context"): Match => ({
  id,
  score,
  docId: "handbook",
  text,
});

function fakeEnv(response: string | undefined): Env {
  return {
    AI: { run: vi.fn(async () => ({ response })) },
    INDEX: {} as never,
    TENANT_TOKENS: "{}",
  } as unknown as Env;
}

describe("usable", () => {
  it("keeps only matches at or above the threshold", () => {
    const kept = usable([match("a", 0.9), match("b", 0.55), match("c", 0.4)], 0.55);

    expect(kept.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("answerQuestion", () => {
  it("refuses rather than guessing when nothing retrieved well enough", async () => {
    const env = fakeEnv("this should never be used");

    const result = await answerQuestion(env, "what is the policy?", [match("a", 0.2)]);

    expect(result.refused).toBe(true);
    expect(result.citations).toEqual([]);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("still reports what it considered when it refuses", async () => {
    const result = await answerQuestion(fakeEnv("x"), "q", [match("a", 0.2), match("b", 0.1)]);

    expect(result.considered).toEqual([
      { id: "a", score: 0.2 },
      { id: "b", score: 0.1 },
    ]);
  });

  it("answers and cites when retrieval is good enough", async () => {
    const result = await answerQuestion(fakeEnv("Holiday is 25 days [1]."), "how much holiday?", [
      match("a", 0.81, "Staff get 25 days of holiday."),
      match("b", 0.3, "Unrelated text about parking."),
    ]);

    expect(result.refused).toBe(false);
    expect(result.answer).toContain("25 days");
    // Only the match above the threshold is citable.
    expect(result.citations.map((c) => c.id)).toEqual(["a"]);
    // But the weak one is still recorded, so a reviewer can see what was near.
    expect(result.considered.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("treats an empty model response as a failure rather than an answer", async () => {
    await expect(answerQuestion(fakeEnv("   "), "q", [match("a", 0.9)])).rejects.toThrow(/no text/);
  });

  // The error has to name the envelope it actually received. Workers AI returns
  // different response shapes across its catalog, so when a model swap breaks
  // parsing, "empty answer" sends you looking in the wrong place.
  it("names the envelope keys it saw when it cannot find any text", async () => {
    await expect(answerQuestion(fakeEnv("   "), "q", [match("a", 0.9)])).rejects.toThrow(
      /envelope keys were \[response\]/,
    );
  });
});

describe("buildPrompt", () => {
  it("numbers the context so citations can be traced back", () => {
    const prompt = buildPrompt("q", [match("a", 0.9, "first"), match("b", 0.8, "second")]);

    expect(prompt).toContain("[1]");
    expect(prompt).toContain("[2]");
    expect(prompt).toContain("first");
    expect(prompt).toContain("second");
  });

  it("tells the model to say so when the context does not answer the question", () => {
    expect(buildPrompt("q", [match("a", 0.9)])).toMatch(/does not contain the answer/i);
  });
});

describe("toCitations", () => {
  it("truncates long excerpts and rounds scores", () => {
    const [citation] = toCitations([match("a", 0.123456789, "z".repeat(400))]);

    expect(citation!.excerpt.endsWith("...")).toBe(true);
    expect(citation!.excerpt.length).toBeLessThan(250);
    expect(citation!.score).toBe(0.1235);
  });
});
