import { GENERATION_MODEL, MAX_ANSWER_TOKENS, MIN_SCORE } from "./config";
import type { Citation, Env, Match, QueryResult } from "./types";

const REFUSAL =
  "I don't have anything in this corpus that answers that. Rather than guess, here is nothing.";

/** Matches worth answering from. Everything else is recorded but not used. */
export function usable(matches: Match[], minScore = MIN_SCORE): Match[] {
  return matches.filter((m) => m.score >= minScore);
}

export function toCitations(matches: Match[]): Citation[] {
  return matches.map((m) => ({
    id: m.id,
    docId: m.docId,
    score: Number(m.score.toFixed(4)),
    excerpt: m.text.length > 240 ? `${m.text.slice(0, 240)}...` : m.text,
  }));
}

/**
 * The context block is numbered so the model can cite by number, and every
 * number maps back to a chunk id in the response. An answer nobody can trace to
 * a source is just a confident sentence.
 */
export function buildPrompt(question: string, matches: Match[]): string {
  const context = matches
    .map((m, i) => `[${i + 1}] (source: ${m.docId})\n${m.text}`)
    .join("\n\n");

  return [
    "Answer the question using only the context below.",
    "Cite the sources you used by their bracket numbers, like [1] or [2].",
    "If the context does not contain the answer, say so plainly instead of guessing.",
    "Be brief.",
    "",
    "Context:",
    context,
    "",
    `Question: ${question}`,
  ].join("\n");
}

export async function answerQuestion(
  env: Env,
  question: string,
  matches: Match[],
): Promise<QueryResult> {
  const considered = matches.map((m) => ({ id: m.id, score: Number(m.score.toFixed(4)) }));
  const good = usable(matches);

  // Refusing is a feature. A RAG system that always answers is a system that
  // has quietly started making things up, and the eval harness cannot tell the
  // difference unless refusal is a real, reachable state.
  if (good.length === 0) {
    return { answer: REFUSAL, refused: true, citations: [], considered };
  }

  const result = (await env.AI.run(GENERATION_MODEL, {
    messages: [
      {
        role: "system",
        content:
          "You answer strictly from the provided context and cite sources by bracket number.",
      },
      { role: "user", content: buildPrompt(question, good) },
    ],
    max_tokens: MAX_ANSWER_TOKENS,
  })) as { response?: string };

  const answer = (result.response ?? "").trim();
  if (answer.length === 0) {
    throw new Error("the generation model returned an empty answer");
  }

  return { answer, refused: false, citations: toCitations(good), considered };
}
