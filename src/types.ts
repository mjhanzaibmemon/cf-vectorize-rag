export interface Env {
  AI: Ai;
  INDEX: VectorizeIndex;

  /**
   * JSON mapping of API token to tenant id, for example:
   *   {"tok_acme_live":"acme","tok_globex_live":"globex"}
   *
   * Set with `wrangler secret put TENANT_TOKENS`. Tenancy is resolved from this
   * map on the server. The caller never gets to say which tenant they are.
   */
  TENANT_TOKENS: string;
}

/** A chunk of a source document, ready to embed. */
export interface Chunk {
  /** Deterministic: the same text in the same position produces the same id. */
  id: string;
  text: string;
  docId: string;
  index: number;
}

/** One retrieved chunk with its similarity score. */
export interface Match {
  id: string;
  score: number;
  docId: string;
  text: string;
}

export interface Citation {
  id: string;
  docId: string;
  score: number;
  excerpt: string;
}

export interface QueryResult {
  answer: string;
  /** True when nothing retrieved well enough to answer from. */
  refused: boolean;
  citations: Citation[];
  /** Scores of everything retrieved, including what fell below the threshold. */
  considered: { id: string; score: number }[];
}
