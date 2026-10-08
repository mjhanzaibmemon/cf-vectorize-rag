/**
 * Everything tunable lives here, including the model IDs.
 *
 * Model IDs on Workers AI change as models are added and retired. Keeping them
 * in one file means a rename is a one-line fix rather than a hunt through the
 * codebase, and it makes the index dimensions impossible to get silently wrong:
 * the embedding model and the Vectorize index must agree, and if they ever
 * disagree the upsert fails at runtime rather than producing garbage results.
 */

export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

/** bge-base-en-v1.5 returns 768 dimensions. The Vectorize index is created with the same number. */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Model ids on Workers AI retire. This one replaced a Llama 3.1 id that was
 * deprecated on 2026-05-30, and the first live deploy failed on it with
 * "5028: ... was deprecated". That failure is the argument for this file:
 * retirement is a one-line fix here, and the error names the model rather than
 * degrading quietly, which is the behaviour you want from a dependency you do
 * not control.
 */
export const GENERATION_MODEL = "@cf/ibm-granite/granite-4.0-h-micro";

/** How many chunks to retrieve before filtering by score. */
export const TOP_K = 5;

/**
 * Below this cosine score we treat the corpus as not containing an answer and
 * refuse, rather than letting the model invent one from weak context.
 *
 * This number is a product decision, not a technical one. Raise it and the app
 * says "I don't know" more often. Lower it and it starts guessing. The eval
 * harness exists so you can change it and measure what happened, and on
 * 2026-10-08 it did. At 0.55 the eval scored 5/5 retrieval, 5/5 grounding and
 * 0/3 refusal: every unanswerable question was answered anyway. The run is
 * committed under eval/results/ rather than deleted, because it is the evidence
 * that the harness works.
 *
 * On this corpus and this embedding model, loosely related text scores around
 * 0.60 and genuinely relevant text starts around 0.66, so 0.55 sat below the
 * noise floor. 0.65 separates them.
 *
 * Two honest caveats. Eight questions is a small sample, and the margin between
 * the highest unanswerable (0.633) and the lowest answerable (0.663) is 0.03,
 * which is not much. A larger corpus will move both. And a fixed threshold is
 * the crude form of this decision: comparing the top score against the gap to
 * the next one adapts better to a question whose whole neighbourhood scores
 * high. That is a change worth measuring rather than assuming, which is the
 * same discipline that produced this number.
 */
export const MIN_SCORE = 0.65;

export const CHUNK_SIZE = 900;
export const CHUNK_OVERLAP = 150;

/** Generation is capped so a runaway answer cannot quietly cost a fortune. */
export const MAX_ANSWER_TOKENS = 512;
