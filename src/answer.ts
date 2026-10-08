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
  })) as unknown;

  const answer = extractText(result);
  if (answer.length === 0) {
    throw new Error(
      `the generation model returned no text; envelope keys were [${Object.keys(
        (result as Record<string, unknown>) ?? {},
      ).join(", ")}]`,
    );
  }

  return { answer, refused: false, citations: toCitations(good), considered };
}

/**
 * Pull the answer text out of whatever envelope the model returned.
 *
 * Workers AI does not use one response shape across its catalog: older models
 * return { response }, OpenAI-compatible ones return choices[].message.content,
 * and some wrap the whole thing in { result }. Hard-coding one of those is how
 * a model swap turns into a 500 that says nothing useful, which is exactly what
 * happened here on the first deploy after a model retirement.
 *
 * When none of the shapes match, the caller raises an error naming the keys it
 * actually saw, so the next person reads the answer instead of guessing it.
 */
function extractText(result: unknown): string {
  if (typeof result === "string") return result.trim();
  if (!result || typeof result !== "object") return "";

  const r = result as Record<string, unknown>;

  if (typeof r.response === "string") return r.response.trim();

  const choice = Array.isArray(r.choices) ? (r.choices[0] as Record<string, unknown>) : undefined;
  const message = choice?.message as Record<string, unknown> | undefined;
  if (typeof message?.content === "string") return message.content.trim();
  if (typeof choice?.text === "string") return choice.text.trim();

  if (r.result && typeof r.result === "object") return extractText(r.result);

  return "";
}
