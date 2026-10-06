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

export const GENERATION_MODEL = "@cf/meta/llama-3.1-8b-instruct";

/** How many chunks to retrieve before filtering by score. */
export const TOP_K = 5;

/**
 * Below this cosine score we treat the corpus as not containing an answer and
 * refuse, rather than letting the model invent one from weak context.
 *
 * This number is a product decision, not a technical one. Raise it and the app
 * says "I don't know" more often. Lower it and it starts guessing. The eval
 * harness exists so you can change it and measure what happened.
 */
export const MIN_SCORE = 0.55;

export const CHUNK_SIZE = 900;
export const CHUNK_OVERLAP = 150;

/** Generation is capped so a runaway answer cannot quietly cost a fortune. */
export const MAX_ANSWER_TOKENS = 512;
